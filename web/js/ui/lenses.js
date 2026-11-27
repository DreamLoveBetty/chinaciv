// Bottom Lens Dock: Resource toggle, quick lens pills, 19-lens grouped picker, clickable legend bands

import { buildLensColorizer, COVER_META } from '../terrain.js?v=20261127-4';
import { escHtml, fmtCompact } from '../format.js';
import { ICONS } from '../icons.js?v=20261127-4';

const QUICK_LENS_IDS = ['density', 'income', 'bachelors', 'stem', 'forest'];

export function initLenses(app) {
  const dock = document.getElementById('lens-dock');
  let pickerOpen = false;

  function formatBandLabel(band) {
    if (band.fullLabel || band.label) return band.label || band.fullLabel;
    return `${fmtCompact(band.min)}`;
  }

  function render() {
    const lenses = app.data.lenses?.lenses || [];
    const groups = app.data.lenses?.groups || [];
    const activeLens = app.state.lens;
    const activeBand = app.state.band;
    const showRes = app.state.showResources;

    const quickList = QUICK_LENS_IDS
      .map((id) => lenses.find((l) => l.id === id))
      .filter(Boolean);
    if (!quickList.length && lenses.length) {
      quickList.push(...lenses.slice(0, 5));
    }

    // Include active lens as pill if not in quick list
    if (activeLens && !quickList.some((l) => l.id === activeLens.id)) {
      quickList.push(activeLens);
    }

    let legendHtml = '';
    if (!activeLens) {
      const swatchCovers = [3, 7, 5, 4, 2, 9];
      legendHtml = `
        <div class="lens-legend">
          <div class="legend-meta">
            <span class="legend-name">自然地理 · 地形地貌</span>
            <span class="legend-unit">AWS DEM 海拔晕渲 + 地表覆被</span>
          </div>
          <div class="legend-bands">
            ${swatchCovers
              .map((cid) => {
                const cm = COVER_META[cid];
                return `<span class="legend-band" style="cursor:default;"><span class="legend-swatch" style="background:${cm.color};"></span><span>${escHtml(cm.name.slice(0, 2))}</span></span>`;
              })
              .join('')}
          </div>
        </div>`;
    } else if (app.w) {
      const colorizer = buildLensColorizer(app.w, app.data, activeLens);
      const bands = colorizer?.bands || [];
      const isIso400 = activeLens.id === 'precip';
      legendHtml = `
        <div class="lens-legend">
          <div class="legend-meta">
            <span class="legend-name">${escHtml(activeLens.label || activeLens.name)}</span>
            <span class="legend-unit">${escHtml(activeLens.unit || '点击色块筛选区间')}</span>
          </div>
          ${
            isIso400
              ? `<span class="legend-isohyet-tag" title="WorldClim v2.1 实测400毫米等降水量线（大兴安岭—张家口—兰州—拉萨）">
                   <span class="legend-isohyet-swatch"></span>
                   <span>400mm线</span>
                 </span>`
              : ''
          }
          <div class="legend-bands">
            ${bands
              .map((b) => {
                const isAct = activeBand && activeBand.index === b.index && activeBand.value === b.value;
                return `
                  <button class="legend-band ${isAct ? 'active' : ''}" type="button" data-band-idx="${b.index}" title="${escHtml(b.fullLabel || `${fmtCompact(b.min)} – ${fmtCompact(b.max)}`)}">
                    <span class="legend-swatch" style="background:${b.color};"></span>
                    <span>${escHtml(formatBandLabel(b))}</span>
                  </button>`;
              })
              .join('')}
          </div>
        </div>`;
    }

    dock.innerHTML = `
      <div class="lens-bar-left">
        <button id="res-toggle-btn" class="lens-pill ${showRes ? 'resource-on' : ''}" type="button" title="显示/隐藏能源与矿产资源 (快捷键 R)">
          ${ICONS.resource} <span>资源${showRes ? ' · 开' : ''}</span>
        </button>

        <button class="lens-pill ${!activeLens ? 'active' : ''}" type="button" data-lens-id="terrain">
          🏔️ 地形地貌
        </button>

        ${quickList
          .map(
            (l) => `
          <button class="lens-pill ${activeLens?.id === l.id ? 'active' : ''}" type="button" data-lens-id="${escHtml(l.id)}">
            ${escHtml(l.short || l.label || l.name)}
          </button>`
          )
          .join('')}

        <div class="lens-picker-wrap">
          <button id="lens-more-btn" class="lens-pill" type="button">
            🧭 ${lenses.length || 21}种视角 ▾
          </button>
          <div id="lens-picker-pop" class="lens-picker-pop ${pickerOpen ? '' : 'hidden'}">
            <div class="lp-header">
              <span class="lp-title">全部专题地图视角（${groups.length || 7}大类 · ${lenses.length || 21}种）</span>
              <button id="lens-pop-close" class="qp-close" type="button">✕</button>
            </div>
            <div class="lp-groups">
              ${groups
                .map((g) => {
                  const items = lenses.filter((l) => l.group === g.id);
                  if (!items.length) return '';
                  return `
                    <div class="lp-group">
                      <div class="lp-group-title">${escHtml(g.label || g.name || g.id)}</div>
                      <div class="lp-items">
                        ${items
                          .map(
                            (l) => `
                          <button class="lp-item ${activeLens?.id === l.id ? 'active' : ''}" type="button" data-lens-id="${escHtml(l.id)}">
                            <span>${escHtml(l.label || l.name)}</span>
                            <span class="lp-item-unit">${escHtml(l.unit || '')}</span>
                          </button>`
                          )
                          .join('')}
                      </div>
                    </div>`;
                })
                .join('')}
            </div>
          </div>
        </div>
      </div>
      ${legendHtml}
    `;

    // Bind events
    dock.querySelector('#res-toggle-btn')?.addEventListener('click', () => {
      app.setShowResources(!app.state.showResources);
    });

    dock.querySelectorAll('[data-lens-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const lid = btn.dataset.lensId;
        pickerOpen = false;
        const picked = lenses.find((x) => x.id === lid);
        if (lid !== 'terrain' && !picked?.cellField && !app.data.counties) {
          await app.loadData('counties').catch(() => {});
        }
        app.setLens(lid === 'terrain' ? null : lid);
      });
    });

    dock.querySelector('#lens-more-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pickerOpen = !pickerOpen;
      dock.querySelector('#lens-picker-pop')?.classList.toggle('hidden', !pickerOpen);
    });

    dock.querySelector('#lens-pop-close')?.addEventListener('click', () => {
      pickerOpen = false;
      dock.querySelector('#lens-picker-pop')?.classList.add('hidden');
    });

    if (activeLens && app.w) {
      const colorizer = buildLensColorizer(app.w, app.data, activeLens);
      dock.querySelectorAll('[data-band-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.bandIdx);
          const band = colorizer?.bands?.[idx];
          if (band) app.setBand(band);
        });
      });
    }
  }

  document.addEventListener('click', (e) => {
    if (pickerOpen && !e.target.closest('.lens-picker-wrap')) {
      pickerOpen = false;
      dock.querySelector('#lens-picker-pop')?.classList.add('hidden');
    }
  });

  app.on('lens', render);
  app.on('band', render);
  app.on('resources:change', render);
  app.on('data:lenses', render);
  app.on('data:counties', () => {
    if (app.state.lens) render();
  });

  render();
  return { render };
}
