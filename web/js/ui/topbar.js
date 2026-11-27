// Topbar: Brand reset, 5 National Yield pills, Extension slots, Layers menu, Share popover, Pedia, Help

import { ICONS, hydrateIcons } from '../icons.js?v=20261127-4';
import { escHtml } from '../format.js';
import { fmtYieldPill } from './yieldReport.js';

const YIELD_SPECS = [
  { key: 'food', label: '粮食', title: '全国粮食与农业产出报告' },
  { key: 'production', label: '生产力', title: '全国工业与建筑业生产力报告' },
  { key: 'gold', label: '金币/GDP', title: '全国GDP与财政产出报告' },
  { key: 'science', label: '科技', title: '全国科创与研发产出报告' },
  { key: 'culture', label: '文化', title: '全国文旅与遗产产出报告' },
];

export function initTopbar(app) {
  hydrateIcons(document.getElementById('topbar'));

  const brandBtn = document.getElementById('brand-btn');
  const yieldsStrip = document.getElementById('yields-strip');
  const extSlots = document.getElementById('ext-top-slots');
  const layersBtn = document.getElementById('layers-btn');
  const layersMenu = document.getElementById('layers-menu');
  const shareBtn = document.getElementById('share-btn');
  const shareMenu = document.getElementById('share-menu');
  const pediaBtn = document.getElementById('pedia-btn');
  const helpBtn = document.getElementById('help-btn');

  const mapToggles = [];

  brandBtn?.addEventListener('click', () => {
    app.modes.leave();
    app.clearSelection();
    app.setHighlight(null);
    app.fitChina();
  });

  function renderYields() {
    const nat = app.data.nation;
    const yields = nat?.yields || {};
    yieldsStrip.innerHTML = YIELD_SPECS.map((sp) => {
      const valStr = nat ? fmtYieldPill(yields[sp.key], sp.key) : '—';
      return `
        <button class="yield-pill" type="button" data-yield="${sp.key}" title="${escHtml(sp.title)}">
          <span class="yp-ico">${ICONS[sp.key] || ''}</span>
          <span class="yp-lbl">${escHtml(sp.label)}</span>
          <span class="yp-val">${escHtml(valStr)}</span>
        </button>`;
    }).join('');

    yieldsStrip.querySelectorAll('.yield-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        app.openYieldReport(btn.dataset.yield);
      });
    });
  }

  function syncLayersBtn() {
    const lid = app.state.lens?.id;
    const isThematic = lid === 'precip' || lid === 'elevation';
    layersBtn?.classList.toggle('active', isThematic);
  }

  function renderToggleRows(items) {
    return items
      .map((t) => {
        const on = Boolean(t.get());
        const isThematic = t.group === 'thematic';
        return `
          <div class="menu-toggle-item ${on ? 'on' : ''} ${isThematic ? 'thematic' : ''}" data-tid="${escHtml(t.id)}" title="${escHtml(t.title || '')}" role="menuitemcheckbox" aria-checked="${on}">
            <span class="menu-toggle-left">
              <span class="btn-ico">${ICONS[t.icon] || ''}</span>
              <span>${escHtml(t.label)}</span>
            </span>
            <span class="menu-check ${isThematic ? 'radio' : ''}">${on ? (isThematic ? '●' : '✓') : ''}</span>
          </div>`;
      })
      .join('');
  }

  function renderLayersMenu() {
    const thematic = mapToggles.filter((t) => t.group === 'thematic');
    const overlays = mapToggles.filter((t) => t.group !== 'thematic');

    layersMenu.innerHTML = `
      ${
        thematic.length
          ? `<div class="menu-head">自然地理专题图层</div>
             ${renderToggleRows(thematic)}`
          : ''
      }
      <div class="menu-head ${thematic.length ? 'menu-head-sub' : ''}">地图战略图层开关</div>
      ${renderToggleRows(overlays)}
    `;

    layersMenu.querySelectorAll('.menu-toggle-item').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = mapToggles.find((x) => x.id === row.dataset.tid);
        if (!item) return;
        item.set(!item.get());
        renderLayersMenu();
        syncLayersBtn();
        if (item.group === 'thematic') {
          layersMenu.classList.add('hidden');
        }
      });
    });
  }

  function renderShareMenu() {
    shareMenu.innerHTML = `
      <div class="menu-head">分享与导出</div>
      <button class="menu-action-btn" id="share-copy-url" type="button">🔗 复制当前视角分享链接</button>
      <button class="menu-action-btn" id="share-save-png" type="button">📷 导出当前高清地图截图 (PNG)</button>
    `;
    shareMenu.querySelector('#share-copy-url')?.addEventListener('click', async () => {
      shareMenu.classList.add('hidden');
      try {
        await navigator.clipboard.writeText(window.location.href);
        app.ui.showToast('已复制当前视角链接到剪贴板');
      } catch {
        app.ui.showToast('请从浏览器地址栏复制链接');
      }
    });
    shareMenu.querySelector('#share-save-png')?.addEventListener('click', () => {
      shareMenu.classList.add('hidden');
      const canvas = document.getElementById('map-canvas');
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `chinaciv-map-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      app.ui.showToast('已下载高清地图 PNG 截图');
    });
  }

  layersBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    shareMenu.classList.add('hidden');
    renderLayersMenu();
    layersMenu.classList.toggle('hidden');
  });

  shareBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    layersMenu.classList.add('hidden');
    renderShareMenu();
    shareMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#layers-wrap')) layersMenu.classList.add('hidden');
    if (!e.target.closest('#share-wrap')) shareMenu.classList.add('hidden');
  });

  pediaBtn?.addEventListener('click', () => app.openPedia('yields'));
  helpBtn?.addEventListener('click', () => app.openHelp());

  app.on('layer:change', () => {
    if (!layersMenu.classList.contains('hidden')) renderLayersMenu();
  });
  app.on('lens', () => {
    syncLayersBtn();
    if (!layersMenu.classList.contains('hidden')) renderLayersMenu();
  });
  app.on('data:nation', renderYields);

  // Wire extension Topbar API
  app.ui.addTopButton = ({ id, label, icon, title, onClick }) => {
    const existing = extSlots.querySelector(`[data-ext-btn="${id}"]`);
    if (existing) existing.remove();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'top-btn';
    btn.dataset.extBtn = id || '';
    if (title) btn.title = title;
    btn.innerHTML = `${icon && ICONS[icon] ? `<span class="btn-ico">${ICONS[icon]}</span>` : ''}<span class="btn-lbl">${escHtml(label || id)}</span>`;
    if (typeof onClick === 'function') btn.addEventListener('click', onClick);
    btn.setActive = (active) => btn.classList.toggle('active', Boolean(active));
    extSlots.appendChild(btn);
    return btn;
  };

  app.ui.addMapToggle = (spec) => {
    const idx = mapToggles.findIndex((t) => t.id === spec.id);
    if (idx >= 0) mapToggles[idx] = spec;
    else mapToggles.push(spec);
    syncLayersBtn();
    renderLayersMenu();
  };

  syncLayersBtn();
  renderYields();
  return { renderYields };
}
