// Floating map hover tooltip with smart screen-edge clamping

import { COVER_META, getLensCellValue } from '../terrain.js';
import { escHtml, fmtField, fmtNum } from '../format.js';
import { RESOURCE_STYLES } from '../render/art/resources.js';

export function buildCellTooltipHtml(app, cellIdx) {
  const w = app.w;
  if (!w || cellIdx < 0 || cellIdx >= w.N) return '';
  const ow = w.owner[cellIdx];
  if (ow === -1) return '';
  if (ow === -2) {
    const elev = w.elev ? Math.round(w.elev[cellIdx]) : 0;
    return `<div class="tt-title">邻国陆地</div><div class="tt-row"><span class="tt-k">海拔</span><span class="tt-v">${elev.toLocaleString('zh-CN')} m</span></div>`;
  }

  const st = app.state.states[ow] || w.states[ow];
  const ctIdx = w.county ? w.county[cellIdx] : -1;
  const county = ctIdx >= 0 ? app.data.counties?.rows?.[ctIdx] || w.counties?.[ctIdx] : null;
  const cover = COVER_META[w.cover?.[cellIdx]]?.name || '陆地';
  const elev = w.elev ? Math.round(w.elev[cellIdx]) : 0;

  let html = `<div class="tt-title">${escHtml(county?.name || st?.name || '中国')}</div>`;
  html += `<div class="tt-sub">${escHtml(st?.name || '')}${county?.region ? ' · ' + escHtml(county.region) : ''}</div>`;
  html += `<div class="tt-row"><span class="tt-k">地表覆被</span><span class="tt-v">${escHtml(cover)}</span></div>`;
  html += `<div class="tt-row"><span class="tt-k">平均海拔</span><span class="tt-v">${fmtNum(elev, 0)} m</span></div>`;

  if (app.state.lens) {
    const lens = app.state.lens;
    const val = getLensCellValue(w, app.data, lens, cellIdx);
    const fieldSpec = app.data.counties?.fields?.find((f) => f.key === (lens.countyField || lens.field || lens.id)) || lens;
    html += `<div class="tt-row"><span class="tt-k">${escHtml(lens.label || lens.name)}</span><span class="tt-v">${escHtml(fmtField(val, fieldSpec))}</span></div>`;
  } else if (county?.population != null) {
    html += `<div class="tt-row"><span class="tt-k">县域人口</span><span class="tt-v">${escHtml(fmtField(county.population, { format: 'pop' }))}</span></div>`;
  }

  // Check if a wonder or resource sits on this cell
  if (app.state.layers.wonders && app.data.wonders?.wonders) {
    const wn = app.data.wonders.wonders.find((x) => x.cell === cellIdx);
    if (wn) {
      html += `<div class="tt-row"><span class="tt-k">奇观</span><span class="tt-v" style="color:#f2cb72">★ ${escHtml(wn.short || wn.name)}</span></div>`;
    }
  }
  if (app.state.showResources && app.data.resources?.items) {
    const res = app.data.resources.items.find((x) => x.cell === cellIdx);
    if (res) {
      const stMeta = RESOURCE_STYLES[res.type];
      html += `<div class="tt-row"><span class="tt-k">${escHtml(stMeta?.label || '资源')}</span><span class="tt-v" style="color:${stMeta?.color || '#ecd08e'}">${escHtml(res.name || '')}</span></div>`;
    }
  }

  return html;
}

export function initTooltip(app) {
  const el = document.getElementById('map-tooltip');

  function showHtmlTooltip(x, y, html) {
    if (!html) {
      hideTooltip();
      return;
    }
    el.innerHTML = html;
    el.classList.remove('hidden');

    const pad = 14;
    const rect = el.getBoundingClientRect();
    let left = x + 14;
    let top = y + 14;
    if (left + rect.width + pad > window.innerWidth) {
      left = Math.max(pad, x - rect.width - 14);
    }
    if (top + rect.height + pad > window.innerHeight) {
      top = Math.max(pad, y - rect.height - 14);
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function hideTooltip() {
    el.classList.add('hidden');
  }

  app.ui.showHtmlTooltip = showHtmlTooltip;
  app.ui.hideTooltip = hideTooltip;
}
