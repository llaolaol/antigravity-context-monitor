(function () {
const { CURRENCY_RATES, SUBSCRIPTION_PRESETS } = window.__CM_PRICING;
const { normalizeLang, t: translate } = window.__CM_I18N;
const {
  renderBarChart,
  renderCumulativeLine,
  renderDailyHeatmap,
  renderMonthlyCalendar,
} = window.__CM_CHARTS;

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  tab: 'live',
  chartTab: 'daily',
  sourceFilter: 'all',
  overrideConvId: null,
  liveEtag: '',
  metrics: null,
  overview: null,
  prefs: {
    lang: 'zh-CN',
    budgetPref: 'auto',
    currency: 'CNY',
    subscriptionPreset: 'ai_pro',
    customPaidMonthly: 19.99,
    referenceModel: 'gemini-3.8-flash',
    heatmapTheme: 'emerald',
  },
  isDark: false,
};

const t = (key, vars) => translate(state.prefs.lang, key, vars);

function applyStaticI18n() {
  document.documentElement.lang = normalizeLang(state.prefs.lang);
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.title = t(key);
  });
}

function syncScheme() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
  document.documentElement.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  const nums = (c.match(/[\d.]+/g) || []).map(Number);
  if (nums.length >= 3) {
    const scale = c.startsWith('color(') ? 1 : 255;
    const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    state.isDark = lum < 0.5;
    document.documentElement.dataset.theme = state.isDark ? 'dark' : 'light';
  }
}
syncScheme();
new MutationObserver(() => {
  const prev = state.isDark;
  syncScheme();
  if (prev !== state.isDark && state.tab === 'overview') renderChart();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTok(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtExact(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function fmtMoney(usd, currency = state.prefs.currency) {
  const cur = CURRENCY_RATES[currency] || CURRENCY_RATES.USD;
  const converted = Number(usd || 0) * cur.rate;
  const digits = currency === 'JPY' ? 0 : (converted < 0.01 && converted > 0 ? 4 : 2);
  return `${cur.symbol}${converted.toFixed(digits)}`;
}

function fmtDur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtTime(isoOrMs) {
  if (!isoOrMs) return '';
  const d = new Date(isoOrMs);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showTip(ev, html) {
  const tip = $('tooltip');
  tip.innerHTML = html;
  tip.classList.remove('hidden');
  const x = Math.min(window.innerWidth - 250, ev.clientX + 12);
  const y = Math.min(window.innerHeight - 90, ev.clientY + 12);
  tip.style.left = `${Math.max(6, x)}px`;
  tip.style.top = `${Math.max(6, y)}px`;
}
function hideTip() { $('tooltip').classList.add('hidden'); }

const activeConvId = () => state.overrideConvId || window.sidecar?.conversationId || params.get('conversationId') || '';

async function apiGet(path) {
  const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
  const res = await f(path, { method: 'GET' });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const f = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : fetch;
  const res = await f(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function syncPrefsToControls() {
  const prevLang = document.documentElement.lang;
  state.prefs.lang = normalizeLang(state.prefs.lang);
  $('sel-lang').value = state.prefs.lang;
  $('sel-budget').value = state.prefs.budgetPref || 'auto';
  $('sel-currency').value = state.prefs.currency || 'CNY';
  $('sel-ref-model').value = state.prefs.referenceModel || 'gemini-3.8-flash';
  $('sel-theme').value = state.prefs.heatmapTheme || 'emerald';
  if (prevLang !== state.prefs.lang) {
    applyStaticI18n();
  }
}

function formatModelLabel(model) {
  if (!model) return '—';
  if (model.isFallback && !model.raw) return t('model.unknownFallback');
  return model.label || '—';
}

function formatErrorLabel(err) {
  if (!err) return t('health.err.other');
  const key = `health.err.${err.code}`;
  const mapped = t(key);
  return mapped !== key ? mapped : (err.label || t('health.err.other'));
}

function formatSubPresetLabel(preset) {
  if (preset.id === 'free') return t('sub.preset.free');
  if (preset.id === 'custom') return t('sub.preset.custom');
  return preset.label;
}

function renderAccount(account) {
  const badge = $('acct-badge');
  const body = $('acct-body');
  if (!account) {
    badge.className = 'badge badge-muted';
    badge.textContent = t('acct.disconnected');
    body.innerHTML = `<div class="muted">${esc(t('acct.disconnectedDesc'))}</div>`;
    return;
  }

  badge.className = 'badge badge-primary';
  badge.textContent = account.tierName || 'Active';

  const pc = account.promptCredits || {};
  const fc = account.flowCredits || {};
  const creditsHtml = `
    <div class="kv-list">
      <span class="kv-k">${esc(t('acct.tier'))}</span><span class="kv-v">${esc(account.tierName)}</span>
      ${pc.available !== null ? `<span class="kv-k">Prompt Credits</span><span class="kv-v">${fmtExact(pc.available)} / ${fmtExact(pc.monthly)}</span>` : ''}
      ${fc.available !== null ? `<span class="kv-k">Flow Credits</span><span class="kv-v">${fmtExact(fc.available)} / ${fmtExact(fc.monthly)}</span>` : ''}
    </div>
  `;

  const quotasHtml = (account.quotas || []).map((q) => {
    const pct = q.remainingPercent;
    const cls = pct <= 10 ? 'empty' : (pct <= 30 ? 'low' : '');
    const resetTxt = q.resetTime ? t('acct.reset', { time: fmtTime(q.resetTime) }) : '';
    return `
      <div class="quota-row">
        <div class="quota-top">
          <span>${esc(q.group)}</span>
          <span class="muted">${pct}%${esc(resetTxt)}</span>
        </div>
        <div class="quota-bar"><div class="quota-fill ${cls}" style="width:${pct}%"></div></div>
      </div>
    `;
  }).join('');

  body.innerHTML = `${creditsHtml}<div class="section-sub">${esc(t('acct.quotaHeader'))}</div>${quotasHtml || `<div class="muted">${esc(t('acct.quotaEmpty'))}</div>`}`;
}

function renderLive() {
  const m = state.metrics;
  $('btn-back-live').classList.toggle('hidden', !state.overrideConvId);

  if (!m || m.empty) {
    $('live-dot').className = 'status-dot';
    $('conv-title').textContent = t('title.app');
    $('conv-sub').textContent = t('live.noConv');
    $('model-badge').textContent = '—';
    renderAccount(m?.account);
    return;
  }

  $('live-dot').className = `status-dot ${m.budget?.health === 'error' ? 'err' : 'ok'}`;
  $('conv-title').textContent = m.title || t('live.convTitle', { id: m.conversationId.slice(0, 8) });
  const srcTxt = m.dataSource === 'language_server' ? t('live.sourceLs') : t('live.sourceLog');
  $('conv-sub').textContent = `${state.overrideConvId ? t('live.previewPrefix') : ''}${m.conversationId.slice(0, 8)}… · ${t('live.sourceLabel')}: ${srcTxt}`;
  $('model-badge').textContent = formatModelLabel(m.model);

  const latest = m.latestStep;
  const st = m.sessionTotals;

  // Cost strip
  $('round-cost-text').textContent = latest
    ? t('cost.round', { money: fmtMoney(latest.costUSD), usd: latest.costUSD.toFixed(4) })
    : t('cost.roundEmpty');
  $('session-cost-text').textContent = t('cost.session', { money: fmtMoney(st.costUSD), usd: st.costUSD.toFixed(4) });

  // Budget card
  const b = m.budget;
  $('ctx-used').textContent = fmtTok(b.used);
  $('ctx-limit').textContent = fmtTok(b.limit);
  $('ctx-remaining').textContent = fmtTok(b.remaining);
  const pctClamped = Math.min(100, Math.max(0, b.percent));
  const bar = $('ctx-bar');
  bar.style.width = `${pctClamped}%`;
  bar.className = `progress-fill ${b.health === 'critical' || b.health === 'error' ? 'critical' : (b.health === 'warn' ? 'warn' : '')}`;

  const ctxBadge = $('ctx-badge');
  if (b.health === 'error') {
    ctxBadge.className = 'badge badge-err';
    ctxBadge.textContent = formatErrorLabel(st.lastError);
  } else if (b.health === 'critical') {
    ctxBadge.className = 'badge badge-err';
    ctxBadge.textContent = t('health.nearLimit', { pct: b.percent });
  } else if (b.health === 'warn') {
    ctxBadge.className = 'badge badge-warn';
    ctxBadge.textContent = t('health.high', { pct: b.percent });
  } else {
    ctxBadge.className = 'badge badge-ok';
    ctxBadge.textContent = `${b.percent}%`;
  }

  $('ctx-takeaway').textContent = latest
    ? t('ctx.takeaway', {
      inp: fmtTok(latest.inputTokens),
      cache: fmtTok(latest.cacheReadTokens),
      rate: latest.cacheHitRate,
      next: fmtTok(b.nextBaseline),
    })
    : t('ctx.noResponse');

  // Speed card
  const spdBadge = $('speed-badge');
  if (latest) {
    $('spd-val').textContent = latest.tokensPerSec ? `${latest.tokensPerSec} tok/s` : '—';
    $('spd-dur').textContent = fmtDur(latest.totalDurationMs);
    $('spd-ttft').textContent = fmtDur(latest.ttftMs);
    $('spd-out').textContent = fmtTok(latest.outputTokens);
    spdBadge.className = 'badge badge-primary';
    spdBadge.textContent = latest.speedMode === 'stream' ? t('spd.stream') : t('spd.step');

    const splitTxt = latest.thinkingTokens > 0
      ? t('spd.splitThinking', { thinking: fmtExact(latest.thinkingTokens), response: fmtExact(latest.responseTokens) })
      : t('spd.splitOut', { out: fmtExact(latest.outputTokens) });
    $('spd-takeaway').textContent = t('spd.takeaway', {
      step: latest.stepIndex,
      time: fmtTime(latest.createdAt),
      split: splitTxt,
    });
  } else {
    $('spd-val').textContent = '—';
    $('spd-dur').textContent = '—';
    $('spd-ttft').textContent = '—';
    $('spd-out').textContent = '—';
    spdBadge.className = 'badge badge-muted';
    spdBadge.textContent = t('card.pending');
    $('spd-takeaway').textContent = t('card.waitingSpeed');
  }

  renderAccount(m.account);

  // Audit drawer
  const audit = m.contentAudit;
  $('audit-badge').textContent = t('audit.rounds', { n: st.plannerCount });
  $('audit-body').innerHTML = `
    <div class="section-sub">${esc(t('audit.serverHeader'))}</div>
    <div class="kv-list">
      <span class="kv-k">${esc(t('audit.totalInput'))}</span><span class="kv-v">${fmtExact(st.inputTokens)}</span>
      <span class="kv-k">${esc(t('audit.totalCache'))}</span><span class="kv-v">${fmtExact(st.cacheReadTokens)} (${st.cacheHitRate}%)</span>
      <span class="kv-k">${esc(t('audit.totalOutput'))}</span><span class="kv-v">${fmtExact(st.outputTokens)}</span>
      <span class="kv-k">${esc(t('audit.thinkResp'))}</span><span class="kv-v">${fmtExact(st.thinkingTokens)} / ${fmtExact(st.responseTokens)}</span>
      <span class="kv-k">${esc(t('audit.stepsToolsErr'))}</span><span class="kv-v">${st.totalSteps} / ${st.toolCalls} / ${st.errorCount}</span>
    </div>
    <div class="section-sub">${esc(t('audit.charsHeader'))}</div>
    <div class="kv-list">
      <span class="kv-k">${esc(t('audit.userChars'))}</span><span class="kv-v">${esc(t('audit.charsUnit', { n: fmtExact(audit.userChars) }))}</span>
      <span class="kv-k">${esc(t('audit.assistantChars'))}</span><span class="kv-v">${esc(t('audit.charsUnit', { n: fmtExact(audit.assistantChars) }))}</span>
      <span class="kv-k">${esc(t('audit.thinkingChars'))}</span><span class="kv-v">${esc(t('audit.charsUnit', { n: fmtExact(audit.thinkingChars) }))}</span>
      <span class="kv-k">${esc(t('audit.toolChars'))}</span><span class="kv-v">${esc(t('audit.charsUnit', { n: fmtExact(audit.toolChars) }))}</span>
    </div>
    <div class="note-box">${esc(t('audit.note'))}</div>
  `;

  // Timeline drawer
  $('timeline-badge').textContent = t('drawer.stepsCount', { n: m.timeline.length });
  $('timeline-body').innerHTML = m.timeline.length
    ? m.timeline.map((item) => `
      <div class="tl-item">
        <div class="tl-top">
          <span>#${item.stepIndex} · ${esc(item.modelLabel || t('model.unknownFallback'))}</span>
          <span>${fmtTime(item.createdAt)} · ${fmtMoney(item.costUSD)}</span>
        </div>
        <div class="tl-sub">
          <span>Ctx ${fmtTok(item.contextUsed)} (In ${fmtTok(item.inputTokens)} + Cache ${fmtTok(item.cacheReadTokens)})</span>
          <span>Out ${fmtTok(item.outputTokens)}${item.tokensPerSec ? ` · ${item.tokensPerSec} tok/s` : ''}${item.toolCalls ? esc(t('tl.tools', { n: item.toolCalls })) : ''}</span>
        </div>
      </div>
    `).join('')
    : `<div class="muted" style="margin-top:8px">${esc(t('tl.empty'))}</div>`;
}

function renderChart() {
  if (!state.overview) return;
  const c = state.overview.charts;
  const container = $('chart-container');
  const opts = {
    theme: state.prefs.heatmapTheme,
    isDark: state.isDark,
    fmtTok,
    fmtMoney,
    showTip,
    hideTip,
    t,
  };
  if (state.chartTab === 'daily') {
    renderDailyHeatmap(container, c.dailySeries, opts);
  } else if (state.chartTab === 'weekly') {
    renderBarChart(container, c.weeklySeries, { ...opts, labelKey: 'weekStart', valueKey: 'total', isYearly: false });
  } else if (state.chartTab === 'monthly') {
    renderMonthlyCalendar(container, c.monthlyCalendar, opts);
  } else if (state.chartTab === 'yearly') {
    renderBarChart(container, c.yearlyMonths, { ...opts, labelKey: 'label', valueKey: 'total', isYearly: true });
  } else {
    renderCumulativeLine(container, c.cumulativeSeries, opts);
  }
}

function renderOverview() {
  const ov = state.overview;
  if (!ov) return;

  const cards = [
    { key: 'total', title: t('ov.total'), tag: 'Total', showAvg: true },
    { key: 'today', title: t('ov.today'), tag: 'Today', showAvg: false },
    { key: 'month', title: t('ov.month'), tag: 'Month', showAvg: true },
    { key: 'year', title: t('ov.year'), tag: 'Year', showAvg: true },
  ];

  $('overview-cards').innerHTML = cards.map((cfg) => {
    const b = ov.cards[cfg.key];
    const avgCost = cfg.showAvg && b.activeDays > 0 ? t('ov.dailyAvg', { money: fmtMoney(b.costUSD / b.activeDays) }) : '';
    return `
      <div class="sum-card">
        <div class="sum-head"><span>${esc(cfg.title)}</span><span>${cfg.tag}</span></div>
        <div class="sum-val">${fmtTok(b.total)}</div>
        <div class="sum-sub">In ${fmtTok(b.input)} · Cache ${fmtTok(b.cache)} · Out ${fmtTok(b.output)}</div>
        <div class="sum-cost">≈ ${fmtMoney(b.costUSD)}${esc(avgCost)}</div>
      </div>
    `;
  }).join('');

  renderChart();

  // Subscription vs API Reference Cost
  const mCard = ov.cards.month;
  const curPreset = SUBSCRIPTION_PRESETS.find((p) => p.id === state.prefs.subscriptionPreset) || SUBSCRIPTION_PRESETS[0];
  const paidUSD = curPreset.monthlyUSD !== null ? curPreset.monthlyUSD : Number(state.prefs.customPaidMonthly || 0);
  const ratio = paidUSD > 0 ? (mCard.costUSD / paidUSD).toFixed(2) : '∞';

  const ratioBadge = $('sub-ratio-badge');
  ratioBadge.className = `badge ${paidUSD > 0 && mCard.costUSD >= paidUSD ? 'badge-ok' : 'badge-muted'}`;
  ratioBadge.textContent = paidUSD > 0 ? t('sub.ratio', { ratio }) : t('sub.free');

  $('sub-compare-body').innerHTML = `
    <div class="sub-controls">
      <span>${esc(t('sub.plan'))}</span>
      <select id="sel-sub-preset" class="select-sm">
        ${SUBSCRIPTION_PRESETS.map((p) => `<option value="${p.id}" ${p.id === state.prefs.subscriptionPreset ? 'selected' : ''}>${esc(formatSubPresetLabel(p))}${p.monthlyUSD !== null ? ` ($${p.monthlyUSD}${esc(t('sub.perMonth'))})` : ''}</option>`).join('')}
      </select>
      ${state.prefs.subscriptionPreset === 'custom'
        ? `<input id="inp-custom-paid" class="input-sm" type="number" step="0.01" min="0" value="${Number(state.prefs.customPaidMonthly || 0)}" title="${esc(t('sub.customTitle'))}" /> <span class="muted">${esc(t('sub.customUnit'))}</span>`
        : ''}
    </div>
    <div class="kv-list">
      <span class="kv-k">${esc(t('sub.monthInput'))}</span><span class="kv-v">${fmtTok(mCard.input)} · ${fmtMoney(mCard.inputCostUSD)}</span>
      <span class="kv-k">${esc(t('sub.monthCache'))}</span><span class="kv-v">${fmtTok(mCard.cache)} · ${fmtMoney(mCard.cacheCostUSD)}</span>
      <span class="kv-k">${esc(t('sub.monthOutput'))}</span><span class="kv-v">${fmtTok(mCard.output)} · ${fmtMoney(mCard.outputCostUSD)}</span>
      <span class="kv-k">${esc(t('sub.monthTotalVs'))}</span><span class="kv-v">${fmtMoney(mCard.costUSD)} vs ${fmtMoney(paidUSD)}</span>
    </div>
    <div class="note-box">${esc(t('sub.note'))}</div>
  `;

  $('sel-sub-preset').addEventListener('change', async (e) => {
    await updatePrefs({ subscriptionPreset: e.target.value });
    renderOverview();
  });
  const customInp = $('inp-custom-paid');
  if (customInp) {
    customInp.addEventListener('change', async (e) => {
      await updatePrefs({ customPaidMonthly: Number(e.target.value || 0) });
      renderOverview();
    });
  }

  // Recent conversations
  $('conv-count-badge').textContent = t('ov.convCount', {
    total: ov.conversationCount,
    desktop: ov.desktopCount,
    cli: ov.cliCount,
  });
  $('recent-conv-list').innerHTML = ov.recentConversations.map((c) => `
    <button class="conv-row" data-cid="${esc(c.conversationId)}" type="button">
      <div class="conv-row-main">
        <div class="conv-row-title">${esc(c.title || t('live.convTitle', { id: c.conversationId.slice(0, 8) }))}</div>
        <div class="conv-row-meta">${c.source === 'cli' ? t('src.cli') : t('src.desktop')} · ${esc(t('drawer.stepsCount', { n: c.plannerSteps }))} · ${new Date(c.updatedAtMs).toLocaleString()}</div>
      </div>
      <div class="conv-row-right">
        <div>${fmtTok(c.totalTokens)}</div>
        <div class="muted">Ctx ${fmtTok(c.latestContextUsed)} · ${fmtMoney(c.costUSD)}</div>
      </div>
    </button>
  `).join('');

  $('recent-conv-list').querySelectorAll('.conv-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.overrideConvId = btn.dataset.cid;
      state.liveEtag = '';
      switchTab('live');
      pollLive(true);
    });
  });
}

async function updatePrefs(patch) {
  state.prefs = await apiPost('/api/prefs', patch);
  syncPrefsToControls();
}

async function pollLive(force = false) {
  const cid = activeConvId();
  try {
    const qs = new URLSearchParams();
    if (cid) qs.set('conversationId', cid);
    if (!force && state.liveEtag) qs.set('etag', state.liveEtag);
    const data = await apiGet(`/api/metrics?${qs.toString()}`);
    if (data.prefs) {
      state.prefs = data.prefs;
      syncPrefsToControls();
    }
    if (data.unchanged) {
      if (state.metrics) {
        state.metrics.account = data.account;
        renderAccount(data.account);
      }
      return;
    }
    state.liveEtag = data.etag || '';
    state.metrics = data;
    renderLive();
  } catch (err) {
    $('live-dot').className = 'status-dot err';
    $('conv-sub').textContent = t('live.readError', { msg: err.message });
  }
}

async function loadOverview() {
  try {
    const data = await apiGet(`/api/overview?source=${encodeURIComponent(state.sourceFilter)}`);
    if (data.prefs) {
      state.prefs = data.prefs;
      syncPrefsToControls();
    }
    state.overview = data;
    renderOverview();
  } catch (err) {
    $('overview-cards').innerHTML = `<div class="muted">${esc(t('ov.loadErr', { msg: err.message }))}</div>`;
  }
}

function switchTab(next) {
  state.tab = next;
  document.querySelectorAll('.tab').forEach((b) => {
    const active = b.dataset.tab === next;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  $('view-live').classList.toggle('hidden', next !== 'live');
  $('view-overview').classList.toggle('hidden', next !== 'overview');
  if (next === 'overview') loadOverview();
}

// Event bindings
applyStaticI18n();

document.querySelectorAll('.tab').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

$('btn-refresh').addEventListener('click', () => {
  if (state.tab === 'live') pollLive(true);
  else loadOverview();
});

$('btn-back-live').addEventListener('click', () => {
  state.overrideConvId = null;
  state.liveEtag = '';
  pollLive(true);
});

$('sel-lang').addEventListener('change', async (e) => {
  await updatePrefs({ lang: e.target.value });
  applyStaticI18n();
  if (state.metrics) renderLive();
  if (state.overview) renderOverview();
});

$('sel-budget').addEventListener('change', async (e) => {
  await updatePrefs({ budgetPref: e.target.value });
  state.liveEtag = '';
  pollLive(true);
});

$('sel-currency').addEventListener('change', async (e) => {
  await updatePrefs({ currency: e.target.value });
  if (state.metrics) renderLive();
  if (state.overview) renderOverview();
});

$('sel-ref-model').addEventListener('change', async (e) => {
  await updatePrefs({ referenceModel: e.target.value });
  loadOverview();
});

$('sel-theme').addEventListener('change', async (e) => {
  await updatePrefs({ heatmapTheme: e.target.value });
  renderChart();
});

document.querySelectorAll('#source-filter .seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    state.sourceFilter = b.dataset.source;
    document.querySelectorAll('#source-filter .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    loadOverview();
  });
});

document.querySelectorAll('#chart-tabs .seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    state.chartTab = b.dataset.chart;
    document.querySelectorAll('#chart-tabs .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
    renderChart();
  });
});

// Poll loop (pauses while tab/pane is hidden)
let lastConvSeen = activeConvId();
pollLive(true);
setInterval(() => {
  if (document.hidden) return;
  const cur = activeConvId();
  if (cur !== lastConvSeen) {
    lastConvSeen = cur;
    state.liveEtag = '';
  }
  if (state.tab === 'live') pollLive(false);
}, 1500);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (state.tab === 'live') pollLive(true);
    else loadOverview();
  }
});
})();
