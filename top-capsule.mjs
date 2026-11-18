#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeConversationMetrics, isValidConversationId, parseTranscriptJsonl } from './sidecars/context-monitor/metrics.mjs';
import { CURRENCY_RATES } from './sidecars/context-monitor/pricing.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HOME = homedir();

export function resolveDevToolsPortFile({
  platform = process.platform,
  home = HOME,
  env = process.env,
} = {}) {
  if (env.ANTIGRAVITY_DEVTOOLS_PORT_FILE) {
    return env.ANTIGRAVITY_DEVTOOLS_PORT_FILE;
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || join(home, 'AppData', 'Roaming');
    return join(appData, 'Antigravity', 'DevToolsActivePort');
  }
  if (platform === 'linux') {
    const configHome = env.XDG_CONFIG_HOME || join(home, '.config');
    return join(configHome, 'Antigravity', 'DevToolsActivePort');
  }
  return join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
}

const DEVTOOLS_PORT_FILE = resolveDevToolsPortFile();
const SIDECAR_DATA_DIR = process.env.ANTIGRAVITY_SIDECAR_DATA_DIR
  || join(HOME, '.gemini', 'antigravity', 'sidecar_data', 'context-monitor', 'context-monitor');
const RUNTIME_FILE = join(SIDECAR_DATA_DIR, 'data', 'runtime.json');
const SIDECAR_LOG = join(SIDECAR_DATA_DIR, 'logs', 'sidecar.log');
const DESKTOP_BRAIN_DIR = process.env.ANTIGRAVITY_BRAIN_DIR
  || (process.env.ANTIGRAVITY_APP_DATA_DIR
    ? join(process.env.ANTIGRAVITY_APP_DATA_DIR, 'brain')
    : join(HOME, '.gemini', 'antigravity', 'brain'));

const POLL_MS = 1800;

function readCdpPort() {
  if (!existsSync(DEVTOOLS_PORT_FILE)) return null;
  try {
    const firstLine = readFileSync(DEVTOOLS_PORT_FILE, 'utf8').split(/\r?\n/)[0].trim();
    const port = Number(firstLine);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

function readSidecarPort() {
  try {
    if (existsSync(RUNTIME_FILE)) {
      const d = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
      if (d?.port) return Number(d.port);
    }
  } catch {}
  try {
    if (existsSync(SIDECAR_LOG)) {
      const txt = readFileSync(SIDECAR_LOG, 'utf8');
      const matches = [...txt.matchAll(/\[sidecar\] listening on 127\.0\.0\.1:(\d+)/g)];
      if (matches.length) return Number(matches[matches.length - 1][1]);
    }
  } catch {}
  return null;
}

export function extractConvIdFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const m = u.pathname.match(/\/c\/([0-9a-f-]{8,64})/i);
    if (m && isValidConversationId(m[1])) return m[1];
    const q = u.searchParams.get('conversationId');
    if (q && isValidConversationId(q)) return q;
  } catch {}
  return '';
}

const fallbackCache = new Map();
function getFallbackMetrics(convId) {
  if (!isValidConversationId(convId)) return null;
  const p = join(DESKTOP_BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(p)) return null;
  try {
    const st = statSync(p);
    const cached = fallbackCache.get(p);
    if (cached && cached.sig === `${st.size}:${st.mtimeMs}`) return cached.data;
    const recs = parseTranscriptJsonl(readFileSync(p, 'utf8'));
    const data = computeConversationMetrics({ conversationId: convId, transcriptRecords: recs });
    fallbackCache.set(p, { sig: `${st.size}:${st.mtimeMs}`, data });
    return data;
  } catch {
    return null;
  }
}

async function fetchMetrics(convId) {
  const scPort = readSidecarPort();
  if (scPort) {
    try {
      const res = await fetch(`http://127.0.0.1:${scPort}/api/metrics?conversationId=${encodeURIComponent(convId || '')}`, {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return await res.json();
    } catch {
      // Fall through to local transcript fallback
    }
  }
  return getFallbackMetrics(convId);
}

function fmtTok(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtMoney(usd, currency = 'CNY') {
  const cur = CURRENCY_RATES[currency] || CURRENCY_RATES.CNY;
  const val = Number(usd || 0) * cur.rate;
  const digits = currency === 'JPY' ? 0 : (val > 0 && val < 0.01 ? 3 : 2);
  return `${cur.symbol}${val.toFixed(digits)}`;
}

export function buildPayload(metrics) {
  if (!metrics || metrics.empty || !metrics.budget) {
    return { active: false };
  }
  const lang = metrics.prefs?.lang === 'en' ? 'en' : 'zh-CN';
  const isEn = lang === 'en';
  const currency = metrics.prefs?.currency || 'CNY';
  const latest = metrics.latestStep;
  const st = metrics.sessionTotals || {};
  const b = metrics.budget;

  const modelLabel = metrics.model?.label || '—';
  const modelShort = modelLabel.replace(/\s*\((Low|Medium|High|XHigh)\)\s*$/i, '').trim() || modelLabel;
  const quotas = Array.isArray(metrics.account?.quotas) ? metrics.account.quotas : [];
  const matchedQuota = quotas.find((q) => {
    const g = String(q.group || '').toLowerCase();
    const s = modelShort.toLowerCase();
    return g && s && (g === s || s.includes(g) || g.includes(s));
  });

  let modelUsageText = `${modelShort} —`;
  let quotaTooltip = isEn ? 'Model quota: N/A' : '模型配额: 暂无';
  if (matchedQuota && matchedQuota.remainingPercent != null) {
    const remainingPct = Number(matchedQuota.remainingPercent);
    const usedPct = Number(Math.max(0, 100 - remainingPct).toFixed(1));
    modelUsageText = `${modelShort} ${usedPct}%/100%`;
    quotaTooltip = isEn
      ? `Model quota (${matchedQuota.group}): ${usedPct}% used / 100% (${remainingPct}% left)`
      : `当前模型配额 (${matchedQuota.group}): 已用 ${usedPct}% / 100% (剩余 ${remainingPct}%)`;
  }

  const usedText = fmtTok(b.used);
  const limitText = fmtTok(b.limit);
  const percent = b.percent ?? 0;
  const cacheRate = latest ? `${latest.cacheHitRate}%` : '—';
  const speedText = latest?.tokensPerSec ? `${latest.tokensPerSec} tok/s` : '—';
  const ttftText = latest?.ttftMs != null ? `${(latest.ttftMs / 1000).toFixed(1)}s` : '—';
  const costText = fmtMoney(st.costUSD || 0, currency);
  const roundCostText = latest ? fmtMoney(latest.costUSD || 0, currency) : '—';
  const steps = st.plannerCount || 0;
  const totalIn = fmtTok(st.inputTokens);
  const totalCache = fmtTok(st.cacheReadTokens);
  const totalOut = fmtTok(st.outputTokens);

  const tooltip = isEn
    ? [
        `Model: ${modelLabel}`,
        `Context: ${usedText} / ${limitText} (${percent}%)`,
        quotaTooltip,
        `Cache Hit Rate: ${cacheRate}`,
        `Output Speed: ${speedText} (TTFT ${ttftText})`,
        `Session Totals (${steps} turns): In ${totalIn} · Cache ${totalCache} · Out ${totalOut}`,
        `Session Est. Cost: ${costText} (turn ${roundCostText})`,
        'Click to toggle Context & Tokens side panel',
      ].join('\n')
    : [
        `模型: ${modelLabel}`,
        `Context: ${usedText} / ${limitText} (${percent}%)`,
        quotaTooltip,
        `缓存命中率: ${cacheRate}`,
        `输出速度: ${speedText} (TTFT ${ttftText})`,
        `当前会话累计 (${steps} 步): In ${totalIn} · Cache ${totalCache} · Out ${totalOut}`,
        `当前会话合计: ${costText} (本轮 ${roundCostText})`,
        '点击切换右侧 Context & Tokens 面板',
      ].join('\n');

  const costCapsuleText = isEn ? `Session(${costText})` : `当前会话合计(${costText})`;

  return {
    active: true,
    lang,
    health: b.health || 'normal',
    percent,
    usedText,
    limitText,
    cacheRate,
    speedText,
    ttftText,
    costText,
    roundCostText,
    modelLabel,
    modelShort,
    modelUsageText,
    quotaTooltip,
    costCapsuleText,
    tooltip,
    steps,
    totalIn,
    totalCache,
    totalOut,
  };
}

const INJECT_FN = (payload) => `(() => {
  const data = ${JSON.stringify(payload)};
  const ID = 'ag-cm-top-capsule';
  const STYLE_ID = 'ag-cm-top-capsule-style';
  const CAPSULE_VER = '6';

  let styleEl = document.getElementById(STYLE_ID);
  if (!styleEl || styleEl.dataset.cmVer !== CAPSULE_VER) {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    styleEl.dataset.cmVer = CAPSULE_VER;
    styleEl.textContent = \`
      #\${ID} {
        -webkit-app-region: no-drag;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 24px;
        padding: 0 10px;
        margin: 0 4px 0 auto;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
        flex-shrink: 1;
        min-width: 0;
        overflow: hidden;
        border: 1px solid rgba(128, 128, 128, 0.24);
        background: rgba(128, 128, 128, 0.08);
        color: inherit;
        transition: background 140ms ease, border-color 140ms ease;
      }
      #\${ID}:hover {
        background: rgba(128, 128, 128, 0.16);
        border-color: rgba(128, 128, 128, 0.4);
      }
      #\${ID} .cm-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        flex: none;
        background: #4c9a57;
      }
      #\${ID}[data-health="warn"] .cm-dot { background: #d99b26; }
      #\${ID}[data-health="critical"] .cm-dot,
      #\${ID}[data-health="error"] .cm-dot { background: #d14343; }
      #\${ID} .cm-sep { opacity: 0.42; margin: 0 2px; }
      #\${ID} .cm-muted { opacity: 0.82; }
      @media (max-width: 1120px) {
        #\${ID} .cm-hide-sm { display: none; }
      }
      @media (max-width: 920px) {
        #\${ID} .cm-hide-xs { display: none; }
      }
    \`;
  }

  // Locate main conversation titlebar row
  const titlebar = [...document.querySelectorAll('div')].find((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (!cls.includes('titlebar')) return false;
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.top <= 12 && r.height >= 28 && r.height <= 56 && r.width >= 320;
  });
  if (!titlebar) return 'no-titlebar';

  let el = document.getElementById(ID);
  if (el && el.dataset.cmVer !== CAPSULE_VER) {
    el.remove();
    el = null;
  }

  if (!data.active) {
    if (el) el.style.display = 'none';
    return 'hidden';
  }

  if (!el) {
    el = document.createElement('button');
    el.id = ID;
    el.type = 'button';
    el.dataset.cmVer = CAPSULE_VER;
    let cmBusy = false;
    el.addEventListener('click', () => {
      if (cmBusy) return;
      cmBusy = true;
      setTimeout(() => { cmBusy = false; }, 450);

      const iw = window.innerWidth;
      const isVisibleRect = (r) =>
        r.width > 20 && r.height > 20 && r.right > 0 && r.left < iw - 10;
      const isPanelVisible = () =>
        [...document.querySelectorAll('iframe[src*="context-monitor"]')].some((frame) =>
          isVisibleRect(frame.getBoundingClientRect())
        );

      const findVisibleBtnByAria = (label) =>
        [...document.querySelectorAll('button[aria-label="' + label + '"]')].find((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top >= 0 && r.top <= 45;
        });

      const findTopTabs = () =>
        [...document.querySelectorAll('button, [role="tab"]')].filter((b) => {
          const ttl = b.getAttribute('title') || '';
          const txt = (b.textContent || '').trim();
          if (ttl !== 'Context & Tokens' && txt !== 'Context & Tokens') return false;
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top >= 0 && r.top <= 45;
        });

      const findVisibleTopTab = () =>
        findTopTabs().find((b) => {
          const r = b.getBoundingClientRect();
          return r.left >= 0 && r.left < iw - 10;
        });

      const findCollapsedTopTab = () =>
        findTopTabs().find((b) => b.getBoundingClientRect().left >= iw - 10);

      const findVisInBody = (selector, text) =>
        [...document.querySelectorAll(selector)].find((node) => {
          if ((node.textContent || '').trim() !== text) return false;
          const r = node.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top > 45;
        });

      const openViaOverviewMenu = () => {
        const extBtn0 = findVisInBody('button', 'Extensions');
        const ovBtn0 = findVisibleBtnByAria('Toggle Overview Panel');
        if (!extBtn0 && ovBtn0) {
          if (ovBtn0.getAttribute('aria-pressed') !== 'true') {
            el.dataset.cmAutoOv = '1';
          }
          ovBtn0.click();
        }
        setTimeout(() => {
          if (isPanelVisible()) return;
          const menuItem0 = findVisInBody('[role="menuitem"], button', 'Context & Tokens');
          if (menuItem0) {
            menuItem0.click();
            return;
          }
          const extBtn = findVisInBody('button', 'Extensions');
          if (extBtn) extBtn.click();
          setTimeout(() => {
            if (isPanelVisible()) return;
            const menuItem = findVisInBody('[role="menuitem"], button', 'Context & Tokens');
            if (menuItem) menuItem.click();
          }, 140);
        }, extBtn0 ? 20 : 160);
      };

      const toggleBtn = findVisibleBtnByAria('Toggle Side Panel');
      const closeBtn = findVisibleBtnByAria('Close Context & Tokens');

      if (isPanelVisible()) {
        if (toggleBtn) toggleBtn.click();
        else if (closeBtn) closeBtn.click();
        if (el.dataset.cmAutoOv === '1') {
          el.dataset.cmAutoOv = '';
          setTimeout(() => {
            const ovBtnAfter = findVisibleBtnByAria('Toggle Overview Panel');
            if (ovBtnAfter && ovBtnAfter.getAttribute('aria-pressed') === 'true') {
              ovBtnAfter.click();
            }
          }, 360);
        }
        return;
      }

      const visTab = findVisibleTopTab();
      if (visTab) {
        visTab.click();
        return;
      }

      const collapsedTab = findCollapsedTopTab();
      if (collapsedTab && toggleBtn) {
        toggleBtn.click();
        setTimeout(() => {
          if (isPanelVisible()) return;
          const tabAfter = findVisibleTopTab();
          if (tabAfter) tabAfter.click();
          else openViaOverviewMenu();
        }, 320);
        return;
      }

      openViaOverviewMenu();
    });
    const lastChild = titlebar.lastElementChild;
    if (lastChild) titlebar.insertBefore(el, lastChild);
    else titlebar.appendChild(el);
  } else if (el.parentElement !== titlebar) {
    const lastChild = titlebar.lastElementChild;
    if (lastChild) titlebar.insertBefore(el, lastChild);
    else titlebar.appendChild(el);
  }

  el.style.display = 'inline-flex';
  el.dataset.health = data.health;
  el.title = data.tooltip || '';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  el.innerHTML =
    '<span class="cm-dot"></span>' +
    '<span>Context:' + esc(data.usedText) + '/' + esc(data.limitText) + '(' + esc(data.percent) + '%)</span>' +
    '<span class="cm-sep cm-hide-xs">||</span>' +
    '<span class="cm-muted cm-hide-xs">' + esc(data.modelUsageText) + '</span>' +
    '<span class="cm-sep cm-hide-sm">||</span>' +
    '<span class="cm-hide-sm">' + esc(data.speedText) + '</span>' +
    '<span class="cm-sep cm-hide-sm">||</span>' +
    '<span class="cm-muted cm-hide-sm">' + esc(data.costCapsuleText) + '</span>';

  return 'ok';
})()`;

const wsMap = new Map(); // targetId -> { ws, url, seq }

async function getWs(target) {
  const existing = wsMap.get(target.id);
  if (existing && existing.ws.readyState === WebSocket.OPEN) {
    return existing;
  }
  if (existing) {
    try { existing.ws.close(); } catch {}
    wsMap.delete(target.id);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws open timeout')), 2500);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
    ws.addEventListener('error', (e) => { clearTimeout(t); reject(e); }, { once: true });
  });
  const entry = { ws, seq: 0 };
  ws.addEventListener('close', () => wsMap.delete(target.id));
  wsMap.set(target.id, entry);
  return entry;
}

async function evalCdp(entry, expression) {
  const id = ++entry.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.ws.removeEventListener('message', handler);
      reject(new Error('cdp eval timeout'));
    }, 2500);
    const handler = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.id === id) {
          clearTimeout(timer);
          entry.ws.removeEventListener('message', handler);
          resolve(d.result?.result?.value);
        }
      } catch {}
    };
    entry.ws.addEventListener('message', handler);
    entry.ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true },
    }));
  });
}

async function tick() {
  const cdpPort = readCdpPort();
  if (!cdpPort) return;

  let pages;
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return;
    pages = await res.json();
  } catch {
    return;
  }

  const targets = pages.filter((p) => p.type === 'page' && /^https:\/\/127\.0\.0\.1:\d+\//.test(p.url));
  const activeIds = new Set(targets.map((t) => t.id));
  for (const [id, entry] of wsMap.entries()) {
    if (!activeIds.has(id)) {
      try { entry.ws.close(); } catch {}
      wsMap.delete(id);
    }
  }

  for (const target of targets) {
    try {
      const entry = await getWs(target);
      // Read live SPA pathname directly because React Router changes URL via pushState
      const livePath = await evalCdp(entry, 'location.pathname + location.search');
      const convId = extractConvIdFromUrl(`https://127.0.0.1${livePath || ''}`) || extractConvIdFromUrl(target.url);
      const metrics = convId ? await fetchMetrics(convId) : null;
      const payload = buildPayload(metrics);
      await evalCdp(entry, INJECT_FN(payload));
    } catch {
      wsMap.delete(target.id);
    }
  }
}

async function loop() {
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const isMainModule = Boolean(process.argv[1]) && resolve(process.argv[1]) === __filename;
if (isMainModule) {
  console.log('[context-monitor] top-capsule daemon started');
  loop();
}
