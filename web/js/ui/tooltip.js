// Floating map hover tooltip with O(1) cell lookup & zero-reflow transform positioning

import { COVER_META, getLensCellValue } from '../terrain.js?v=20261127-4';
import { escHtml, fmtField, fmtNum } from '../format.js';
import { RESOURCE_STYLES } from '../render/art/resources.js';

let cachedWondersSrc = null;
let wondersByCell = new Map();
let cachedResourcesSrc = null;
let resourcesByCell = new Map();

function getWonderAtCell(data, cellIdx) {
  const list = data.wonders?.wonders;
  if (!Array.isArray(list)) return null;
  if (list !== cachedWondersSrc) {
    cachedWondersSrc = list;
    wondersByCell = new Map();
    for (let i = 0; i < list.length; i++) {
      const wn = list[i];
      if (wn.cell >= 0 && !wondersByCell.has(wn.cell)) wondersByCell.set(wn.cell, wn);
    }
  }
  return wondersByCell.get(cellIdx) || null;
}

function getResourceAtCell(data, cellIdx) {
  const list = data.resources?.items;
  if (!Array.isArray(list)) return null;
  if (list !== cachedResourcesSrc) {
    cachedResourcesSrc = list;
    resourcesByCell = new Map();
    for (let i = 0; i < list.length; i++) {
      const res = list[i];
      if (res.cell >= 0 && !resourcesByCell.has(res.cell)) resourcesByCell.set(res.cell, res);
    }
  }
  return resourcesByCell.get(cellIdx) || null;
}

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
    if (lens.id === 'precip') {
      const pVal = typeof val === 'number' && Number.isFinite(val) ? Math.round(val) : 0;
      const [zoneTxt, zoneCol] =
        pVal < 200
          ? ['干旱区 (<200mm)', '#e4a85a']
          : pVal < 400
            ? ['半干旱区 (200–400mm)', '#e4cf8b']
            : pVal < 800
              ? ['半湿润区 (400–800mm)', '#6cd4b8']
              : ['湿润区 (>800mm)', '#5eb8f0'];
      html += `<div class="tt-row"><span class="tt-k">年降水量</span><span class="tt-v">${fmtNum(pVal, 0)} mm/年</span></div>`;
      html += `<div class="tt-row"><span class="tt-k">干湿分区</span><span class="tt-v" style="color:${zoneCol}">${zoneTxt}</span></div>`;
    } else if (lens.id === 'elevation') {
      const eMax = Math.round(w.elev_max?.[cellIdx] ?? elev);
      const [stepTxt, stepCol] =
        elev >= 3500
          ? ['第一级阶梯 (青藏高原)', '#e2b8c4']
          : elev >= 500
            ? ['第二级阶梯 (高原盆地)', '#e2ad63']
            : ['第三级阶梯 (平原丘陵)', '#7cc98a'];
      html += `<div class="tt-row"><span class="tt-k">最高海拔</span><span class="tt-v">${fmtNum(eMax, 0)} m</span></div>`;
      html += `<div class="tt-row"><span class="tt-k">地势阶梯</span><span class="tt-v" style="color:${stepCol}">${stepTxt}</span></div>`;
    } else {
      const fieldSpec = app.data.counties?.fields?.find((f) => f.key === (lens.countyField || lens.field || lens.id)) || lens;
      html += `<div class="tt-row"><span class="tt-k">${escHtml(lens.label || lens.name)}</span><span class="tt-v">${escHtml(fmtField(val, fieldSpec))}</span></div>`;
    }
  } else if (county?.population != null) {
    html += `<div class="tt-row"><span class="tt-k">县域人口</span><span class="tt-v">${escHtml(fmtField(county.population, { format: 'pop' }))}</span></div>`;
  }

  if (app.state.layers.wonders) {
    const wn = getWonderAtCell(app.data, cellIdx);
    if (wn) {
      html += `<div class="tt-row"><span class="tt-k">奇观</span><span class="tt-v" style="color:#f2cb72">★ ${escHtml(wn.short || wn.name)}</span></div>`;
    }
  }
  if (app.state.showResources) {
    const res = getResourceAtCell(app.data, cellIdx);
    if (res) {
      const stMeta = RESOURCE_STYLES[res.type];
      html += `<div class="tt-row"><span class="tt-k">${escHtml(stMeta?.label || '资源')}</span><span class="tt-v" style="color:${stMeta?.color || '#ecd08e'}">${escHtml(res.name || '')}</span></div>`;
    }
  }

  return html;
}

export function initTooltip(app) {
  const el = document.getElementById('map-tooltip');
  let lastHtml = '';
  let tipW = 200;
  let tipH = 100;
  let visible = false;

  function moveTooltip(x, y) {
    if (!visible) return;
    const pad = 14;
    let left = x + 14;
    let top = y + 14;
    if (left + tipW + pad > window.innerWidth) {
      left = Math.max(pad, x - tipW - 14);
    }
    if (top + tipH + pad > window.innerHeight) {
      top = Math.max(pad, y - tipH - 14);
    }
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function showHtmlTooltip(x, y, html) {
    if (!html) {
      hideTooltip();
      return;
    }
    if (html !== lastHtml || !visible) {
      if (html !== lastHtml) {
        lastHtml = html;
        el.innerHTML = html;
      }
      if (!visible) {
        el.classList.remove('hidden');
        visible = true;
      }
      tipW = el.offsetWidth || 200;
      tipH = el.offsetHeight || 100;
    }
    moveTooltip(x, y);
  }

  function hideTooltip() {
    if (!visible) return;
    visible = false;
    el.classList.add('hidden');
  }

  app.ui.showHtmlTooltip = showHtmlTooltip;
  app.ui.moveTooltip = moveTooltip;
  app.ui.hideTooltip = hideTooltip;
}
