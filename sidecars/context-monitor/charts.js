(function () {
  const HEATMAP_PALETTES = {
    emerald: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
    ocean: ['#ebedf0', '#bae6fd', '#38bdf8', '#0284c7', '#0369a1'],
    violet: ['#ebedf0', '#ddd6fe', '#a78bfa', '#7c3aed', '#5b21b6'],
    amber: ['#ebedf0', '#fde68a', '#fbbf24', '#d97706', '#92400e'],
  };

  function levelFor(val, maxVal) {
    if (!val || val <= 0 || !maxVal) return 0;
    const r = val / maxVal;
    if (r < 0.2) return 1;
    if (r < 0.45) return 2;
    if (r < 0.75) return 3;
    return 4;
  }

  function colorAt(theme, level, isDark) {
    if (level === 0) return isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const pal = HEATMAP_PALETTES[theme] || HEATMAP_PALETTES.emerald;
    return pal[level];
  }

  function renderDailyHeatmap(container, dailySeries, { theme, isDark, fmtTok, fmtMoney, showTip, hideTip, t }) {
    const cols = 52;
    const rows = 7;
    const cell = 9;
    const gap = 2;
    const padLeft = 18;
    const padTop = 16;
    const width = padLeft + cols * (cell + gap) + 4;
    const height = padTop + rows * (cell + gap) + 4;

    const maxVal = dailySeries.reduce((m, d) => Math.max(m, d.total || 0), 0);
    const items = dailySeries.slice(-cols * rows);
    const firstWd = items[0]?.weekday ?? 0;
    const padded = new Array(firstWd).fill(null).concat(items);

    const months = t('chart.months');
    const rects = [];
    const monthLabels = [];
    let lastMonth = '';

    padded.forEach((item, idx) => {
      const col = Math.floor(idx / 7);
      const row = idx % 7;
      if (col >= cols) return;
      const x = padLeft + col * (cell + gap);
      const y = padTop + row * (cell + gap);
      if (!item) return;

      const m = item.date.slice(0, 7);
      if (row === 0 && m !== lastMonth) {
        lastMonth = m;
        const mIdx = Number(item.date.slice(5, 7)) - 1;
        const mLabel = months[mIdx] || `${mIdx + 1}`;
        monthLabels.push(`<text x="${x}" y="10" fill="var(--cm-muted)" font-size="9">${mLabel}</text>`);
      }

      const lvl = levelFor(item.total, maxVal);
      const fill = colorAt(theme, lvl, isDark);
      rects.push(
        `<rect class="hm-cell" data-idx="${idx}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"/>`
      );
    });

    const dayLabels = t('chart.weekdaysShort')
      .map((lbl, r) => lbl ? `<text x="0" y="${padTop + r * (cell + gap) + 8}" fill="var(--cm-muted)" font-size="8.5">${lbl}</text>` : '')
      .join('');

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="width:100%;min-width:460px;height:auto;display:block">${monthLabels.join('')}${dayLabels}${rects.join('')}</svg>`;

    container.querySelectorAll('.hm-cell').forEach((el) => {
      const item = padded[Number(el.dataset.idx)];
      if (!item) return;
      el.addEventListener('mouseenter', (ev) => {
        showTip(ev, `<b>${item.date}</b><br>${t('chart.tipTotal')}: ${fmtTok(item.total)}<br>In ${fmtTok(item.input)} · Cache ${fmtTok(item.cache)} · Out ${fmtTok(item.output)}<br>${t('chart.tipCost')}: ${fmtMoney(item.costUSD)}`);
      });
      el.addEventListener('mouseleave', hideTip);
    });
  }

  function renderBarChart(container, items, { labelKey, valueKey, isYearly, theme, fmtTok, showTip, hideTip, t }) {
    if (!items.length) {
      container.innerHTML = `<div class="muted" style="padding:12px 0">${t('chart.empty')}</div>`;
      return;
    }
    const width = Math.max(320, items.length * 28);
    const height = 136;
    const padB = 22;
    const padT = 14;
    const chartH = height - padB - padT;
    const maxVal = items.reduce((m, x) => Math.max(m, x[valueKey] || 0), 0) || 1;
    const pal = HEATMAP_PALETTES[theme] || HEATMAP_PALETTES.emerald;
    const barColor = pal[3];

    const barW = Math.max(10, Math.floor((width - 16) / items.length) - 6);
    const step = (width - 16) / items.length;
    const months = t('chart.months');

    const getLabel = (item, i) => {
      if (isYearly) {
        const mNum = Number(String(item.month || '').slice(5, 7)) || (i + 1);
        return months[mNum - 1] || item[labelKey];
      }
      return String(item[labelKey] || '');
    };

    const bars = items.map((item, i) => {
      const v = item[valueKey] || 0;
      const h = Math.max(v > 0 ? 3 : 0, Math.round((v / maxVal) * chartH));
      const x = Math.round(8 + i * step + (step - barW) / 2);
      const y = padT + chartH - h;
      const lbl = getLabel(item, i).slice(-5);
      return `
        <g class="bar-g" data-i="${i}" style="cursor:pointer">
          <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${barColor}" opacity="0.88"/>
          <text x="${x + barW / 2}" y="${height - 6}" text-anchor="middle" fill="var(--cm-muted)" font-size="8.5">${lbl}</text>
        </g>
      `;
    }).join('');

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block">${bars}</svg>`;

    container.querySelectorAll('.bar-g').forEach((el) => {
      const i = Number(el.dataset.i);
      const item = items[i];
      el.addEventListener('mouseenter', (ev) => {
        const title = isYearly ? `${item.month} (${getLabel(item, i)})` : item[labelKey];
        showTip(ev, `<b>${title}</b><br>${t('chart.tipTotal')}: ${fmtTok(item.total)}<br>In ${fmtTok(item.input)} · Cache ${fmtTok(item.cache)} · Out ${fmtTok(item.output)}`);
      });
      el.addEventListener('mouseleave', hideTip);
    });
  }

  function renderMonthlyCalendar(container, cal, { theme, isDark, fmtTok, showTip, hideTip, t }) {
    const headers = t('chart.weekdays').map((d) => `<div class="cal-hdr">${d}</div>`).join('');
    const blanks = new Array(cal.firstWeekday || 0).fill('<div></div>').join('');
    const maxVal = cal.days.reduce((m, d) => Math.max(m, d.total || 0), 0);

    const cells = cal.days.map((d, idx) => {
      const lvl = levelFor(d.total, maxVal);
      const bg = lvl > 0 ? colorAt(theme, lvl, isDark) : 'var(--cm-fill)';
      const textCol = lvl >= 3 ? '#fff' : 'var(--cm-fg)';
      return `
        <div class="cal-cell" data-i="${idx}" style="background:${bg};color:${textCol}">
          <span class="cal-cell-num" style="color:${lvl >= 3 ? 'rgba(255,255,255,0.85)' : 'var(--cm-muted)'}">${d.day}</span>
          <span class="cal-cell-val">${d.total > 0 ? fmtTok(d.total) : ''}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="cal-grid">${headers}${blanks}${cells}</div>`;
    container.querySelectorAll('.cal-cell').forEach((el) => {
      const d = cal.days[Number(el.dataset.i)];
      if (!d) return;
      el.addEventListener('mouseenter', (ev) => {
        showTip(ev, `<b>${d.date}</b><br>${t('chart.tipTotal')}: ${fmtTok(d.total)}<br>In ${fmtTok(d.input)} · Cache ${fmtTok(d.cache)} · Out ${fmtTok(d.output)}`);
      });
      el.addEventListener('mouseleave', hideTip);
    });
  }

  function renderCumulativeLine(container, series, { theme, fmtTok, showTip, hideTip, t }) {
    if (!series.length) {
      container.innerHTML = `<div class="muted" style="padding:12px 0">${t('chart.emptyCum')}</div>`;
      return;
    }
    const width = 460;
    const height = 140;
    const padL = 8;
    const padR = 8;
    const padT = 14;
    const padB = 22;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const maxVal = series[series.length - 1]?.cumulative || 1;
    const pal = HEATMAP_PALETTES[theme] || HEATMAP_PALETTES.emerald;
    const stroke = pal[3];

    const pts = series.map((pt, i) => {
      const x = series.length === 1 ? padL + w / 2 : padL + (i / (series.length - 1)) * w;
      const y = padT + h - (pt.cumulative / maxVal) * h;
      return { x, y, pt };
    });

    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${padT + h} L${pts[0].x.toFixed(1)},${padT + h} Z`;

    const dots = pts.map((p, i) => `<circle class="cum-pt" data-i="${i}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${stroke}" opacity="0.85"/>`).join('');
    const firstLbl = series[0].date.slice(5);
    const lastLbl = series[series.length - 1].date.slice(5);

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block">
        <path d="${areaPath}" fill="${stroke}" opacity="0.14"/>
        <path d="${linePath}" fill="none" stroke="${stroke}" stroke-width="2"/>
        ${dots}
        <text x="${padL}" y="${height - 5}" fill="var(--cm-muted)" font-size="9">${firstLbl}</text>
        <text x="${width - padR}" y="${height - 5}" text-anchor="end" fill="var(--cm-muted)" font-size="9">${t('chart.cumLabel', { date: lastLbl, val: fmtTok(maxVal) })}</text>
      </svg>
    `;

    container.querySelectorAll('.cum-pt').forEach((el) => {
      const p = pts[Number(el.dataset.i)].pt;
      el.addEventListener('mouseenter', (ev) => {
        showTip(ev, `<b>${p.date}</b><br>${t('chart.tipDay')}: ${fmtTok(p.dayTotal)}<br>${t('chart.tipCum')}: ${fmtTok(p.cumulative)}`);
      });
      el.addEventListener('mouseleave', hideTip);
    });
  }

  window.__CM_CHARTS = {
    renderDailyHeatmap,
    renderBarChart,
    renderMonthlyCalendar,
    renderCumulativeLine,
  };
})();
