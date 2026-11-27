// Application entry point: boots world, renderer, camera, UI panels, extensions & URL hash sync

import { Camera } from './camera.js?v=20261127-5';
import { prepareWorld } from './world.js?v=20261127-5';
import { createMapRenderer } from './render/map.js?v=20261127-5';
import { isElevation25D, pickCell25D } from './render/art/elevation25d.js?v=20261127-5';
import { createApp } from './app/api.js?v=20261127-5';
import { initTopbar } from './ui/topbar.js?v=20261127-4';
import { initSearch } from './ui/search.js';
import { initLenses } from './ui/lenses.js?v=20261127-5';
import { initTooltip, buildCellTooltipHtml } from './ui/tooltip.js?v=20261127-4';
import { initYieldReport } from './ui/yieldReport.js';
import { initPedia } from './ui/pedia.js?v=20261127-4';
import { initHelp } from './ui/help.js';
import { initMinimap } from './ui/minimap.js';
import { renderQuickStatePanel } from './ui/statePanel.js';
import { renderQuickCityPanel } from './ui/cityPanel.js';
import { loadExtensions } from './ext/index.js?v=20261127-4';

async function boot() {
  const canvas = document.getElementById('map-canvas');
  const viewportEl = document.getElementById('viewport');
  const quickPanelEl = document.getElementById('quick-panel');
  const dockLeftEl = document.getElementById('dock-left');
  const dockRightEl = document.getElementById('dock-right');
  const bootOverlay = document.getElementById('boot-loading');
  const bootStatus = document.getElementById('boot-status');
  const bootBar = document.getElementById('boot-bar-fill');
  const toastEl = document.getElementById('toast');

  let renderer = null;
  let minimap = null;
  let toastTimer = null;
  let canvasRect = canvas.getBoundingClientRect();

  const rendererProxy = {
    target: null,
    requestDraw() {
      this.target?.requestDraw();
    },
    invalidateStatic() {
      this.target?.invalidateStatic();
    },
    onCameraSettle(zoomed) {
      this.target?.onCameraSettle?.(zoomed);
    },
    registerStaticLayer(layer) {
      return this.target?.registerStaticLayer(layer);
    },
    registerOverlay(overlay) {
      return this.target?.registerOverlay(overlay);
    },
    unregisterOverlay(id) {
      return this.target?.unregisterOverlay(id);
    },
  };

  const cam = new Camera(canvas, {
    onFrame: () => {
      renderer?.requestDraw();
      minimap?.draw();
    },
    onSettle: ({ zoomed } = {}) => {
      renderer?.onCameraSettle(Boolean(zoomed));
      minimap?.draw();
    },
  });

  const app = createApp({ cam, renderer: rendererProxy });
  renderer = createMapRenderer({ canvas, cam, app });
  rendererProxy.target = renderer;
  app.registerOverlay = (overlay) => renderer.registerOverlay(overlay);
  app.unregisterOverlay = (id) => renderer.unregisterOverlay(id);
  app.registerStaticLayer = (layer) => renderer.registerStaticLayer(layer);

  // Wire UI Docks, Toast, and Quick Panels
  app.ui.setDock = (side, widthPx) => {
    const wNum = Math.max(0, Number(widthPx) || 0);
    if (!side || wNum === 0) {
      if (!side || side === 'left') {
        dockLeftEl.classList.add('hidden');
        document.documentElement.style.setProperty('--dock-left', '0px');
        cam.setDocks(0, cam.dockRight);
      }
      if (!side || side === 'right') {
        dockRightEl.classList.add('hidden');
        document.documentElement.style.setProperty('--dock-right', '0px');
        cam.setDocks(cam.dockLeft, 0);
      }
      renderer.requestDraw();
      minimap?.draw();
      return null;
    }

    const target = side === 'left' ? dockLeftEl : dockRightEl;
    const cssVar = side === 'left' ? '--dock-left' : '--dock-right';
    target.classList.remove('hidden');
    document.documentElement.style.setProperty(cssVar, `${wNum}px`);
    if (side === 'left') cam.setDocks(wNum, cam.dockRight);
    else cam.setDocks(cam.dockLeft, wNum);
    renderer.requestDraw();
    minimap?.draw();
    return target;
  };

  app.ui.getDock = (side) => (side === 'left' ? dockLeftEl : dockRightEl);
  app.ui.closeDock = (side) => app.ui.setDock(side || null, 0);

  app.ui.showToast = (msg, durationMs = 2400) => {
    if (!toastEl) return;
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), durationMs);
  };

  app.panels = {
    element: quickPanelEl,
    city(city) {
      renderQuickCityPanel(app, quickPanelEl, city);
    },
    state(idx) {
      renderQuickStatePanel(app, quickPanelEl, idx);
    },
    close() {
      quickPanelEl.classList.add('hidden');
      quickPanelEl.innerHTML = '';
    },
  };

  // Initialize Core UI components
  initTooltip(app);
  initTopbar(app);
  const searchCtrl = initSearch(app);
  initYieldReport(app);
  initPedia(app);
  initHelp(app);
  initLenses(app);
  minimap = initMinimap(app);

  // Resize Handling (keeps cached canvasRect fresh with zero pointermove reflows)
  const updateSize = () => {
    const rect = viewportEl.getBoundingClientRect();
    cam.resize(rect.width, rect.height);
    canvasRect = canvas.getBoundingClientRect();
    renderer.invalidateStatic();
    renderer.requestDraw();
    minimap?.draw();
  };
  new ResizeObserver(updateSize).observe(viewportEl);
  window.addEventListener('resize', () => {
    canvasRect = canvas.getBoundingClientRect();
  }, { passive: true });
  updateSize();

  // Load Core Datasets
  const setProgress = (pct, msg) => {
    if (bootBar) bootBar.style.width = `${pct}%`;
    if (bootStatus && msg) bootStatus.textContent = msg;
  };

  try {
    setProgress(25, '正在加载中国25公里六边形世界网格…');
    const [rawWorld, rawGeoLookup, rawNation, rawStates, rawCities] = await Promise.all([
      app.loadData('world'),
      app.loadData('geo_lookup').catch(() => null),
      app.loadData('nation').catch(() => null),
      app.loadData('states').catch(() => []),
      app.loadData('cities').catch(() => []),
      app.loadData('lenses').catch(() => []),
    ]);

    setProgress(70, '正在构建中国省县空间索引与地形晕渲…');
    app.w = prepareWorld(rawWorld, rawGeoLookup);

    if (Array.isArray(rawCities)) {
      for (const c of rawCities) {
        if ((c.cell == null || c.cell < 0) && c.x != null && c.y != null) c.cell = app.w.cellAt(c.x, c.y);
        if ((!c.footprint || !c.footprint.length) && c.cell >= 0) {
          c.footprint = [c.cell, ...app.w.neighbors(c.cell).filter((n) => n >= 0 && app.w.owner[n] >= 0)];
        }
        if (c.badge) app.state.cityBadges[c.id] = c.badge;
      }
      app.state.cities = rawCities;
    }
    if (Array.isArray(rawStates)) {
      for (let i = 0; i < rawStates.length; i++) {
        const s = rawStates[i];
        if (!s) continue;
        s.idx = s.idx ?? i;
        s.cells = app.w.stateCells[i] || [];
        if (s.x == null && app.w.stateBounds[i]) {
          s.x = app.w.stateBounds[i].labelX;
          s.y = app.w.stateBounds[i].labelY;
        }
        if ((s.cell == null || s.cell < 0) && s.x != null && s.y != null) {
          s.cell = app.w.cellAt(s.x, s.y);
        }
      }
      app.state.states = rawStates;
    }

    minimap?.bakeBackground();
    app.fitChina({ instant: true });
    setProgress(90, '正在加载扩展模块与地图图层…');

    await loadExtensions(app);

    Promise.allSettled([
      app.loadData('districts'),
      app.loadData('counties'),
      app.loadData('resources'),
      app.loadData('infrastructure'),
      app.loadData('military'),
      app.loadData('wonders'),
      app.loadData('trade'),
      app.loadData('sources'),
    ]).then(() => {
      renderer.invalidateStatic();
      renderer.requestDraw();
    });

    const h = app.hash.all();
    if (h.res === '0') app.setShowResources(false);
    if (h.lens) {
      await app.loadData('counties').catch(() => {});
      app.setLens(h.lens, { silentHash: true });
      if (h.lens === 'elevation' && !h.city && !h.province) {
        app.fitChina({ instant: true });
      }
    }

    setProgress(100, '载入完成');
    setTimeout(() => {
      bootOverlay.style.opacity = '0';
      setTimeout(() => bootOverlay.classList.add('hidden'), 280);
    }, 80);

    if (h.city) {
      app.selectCity(h.city, { source: 'hash', openCityView: h.view === 'city' });
    } else if (h.province) {
      app.selectState(h.province, { source: 'hash', openCityView: h.view === 'city' });
    }
  } catch (err) {
    console.error('[boot]', err);
    setProgress(100, `数据载入异常：${err.message}`);
  }

  // ==================== POINTER & KEYBOARD CONTROLS ====================
  let isDragging = false;
  let dragStart = null;
  let lastPt = null;
  let didDrag = false;
  const activeTouches = new Map();
  let lastPinchDist = null;
  let prevBannerCity = null;
  let lastTipKey = '';
  let lastHoverPointerClass = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    canvasRect = canvas.getBoundingClientRect();
    canvas.setPointerCapture(e.pointerId);
    activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouches.size === 1) {
      isDragging = true;
      didDrag = false;
      dragStart = { x: e.clientX, y: e.clientY };
      lastPt = { x: e.clientX, y: e.clientY };
      canvas.classList.add('dragging');
    } else if (activeTouches.size === 2) {
      isDragging = false;
      const pts = [...activeTouches.values()];
      lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const sx = e.clientX - canvasRect.left;
    const sy = e.clientY - canvasRect.top;

    if (activeTouches.has(e.pointerId)) {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activeTouches.size === 2) {
      const pts = [...activeTouches.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (lastPinchDist && dist > 0) {
        const midX = (pts[0].x + pts[1].x) * 0.5 - canvasRect.left;
        const midY = (pts[0].y + pts[1].y) * 0.5 - canvasRect.top;
        cam.zoomAtScreen(midX, midY, dist / lastPinchDist);
      }
      lastPinchDist = dist;
      didDrag = true;
      return;
    }

    if (isDragging && lastPt) {
      const dx = e.clientX - lastPt.x;
      const dy = e.clientY - lastPt.y;
      if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 5) {
        didDrag = true;
      }
      lastPt = { x: e.clientX, y: e.clientY };
      cam.panByScreen(dx, dy);
      app.ui.hideTooltip();
      return;
    }

    if (!app.w) return;
    const bannerCity = renderer.hitBannerAt(sx, sy);
    const wantPointer = Boolean(bannerCity);
    if (wantPointer !== lastHoverPointerClass) {
      lastHoverPointerClass = wantPointer;
      canvas.classList.toggle('pointer', wantPointer);
    }

    const worldPt = cam.screenToWorld(sx, sy);
    const cell = isElevation25D(app.state)
      ? pickCell25D(app.w, worldPt.x, worldPt.y)
      : app.w.cellAt(worldPt.x, worldPt.y);
    const prevCell = app.state.hoverCell;
    const cellChanged = cell !== prevCell;

    if (cellChanged) {
      app.state.hoverCell = cell;
      renderer.requestDraw();
    }

    const tipKey = `${cell}:${app.state.lens?.id || ''}:${app.state.elevation25D ? 1 : 0}:${app.state.layers.wonders ? 1 : 0}:${app.state.showResources ? 1 : 0}`;
    if (tipKey !== lastTipKey) {
      lastTipKey = tipKey;
      const html = buildCellTooltipHtml(app, cell);
      if (html) app.ui.showHtmlTooltip(e.clientX, e.clientY, html);
      else app.ui.hideTooltip();
    } else {
      app.ui.moveTooltip(e.clientX, e.clientY);
    }

    if (cellChanged || bannerCity !== prevBannerCity) {
      prevBannerCity = bannerCity;
      const ow = cell >= 0 ? app.w.owner[cell] : -1;
      const ctIdx = cell >= 0 ? app.w.county?.[cell] ?? -1 : -1;
      const hoverPayload = {
        cell,
        prevCell,
        wx: worldPt.x,
        wy: worldPt.y,
        sx,
        sy,
        pos: { x: e.clientX, y: e.clientY },
        clientX: e.clientX,
        clientY: e.clientY,
        state: ow >= 0 ? app.state.states[ow] : null,
        county: ctIdx >= 0 ? app.data.counties?.rows?.[ctIdx] || app.w.counties?.[ctIdx] : null,
        city: bannerCity,
      };
      app.emit('hover', hoverPayload);
      if (cellChanged) app.emit('hoverCell', hoverPayload);
    }
  });

  const endPointer = (e) => {
    activeTouches.delete(e.pointerId);
    if (activeTouches.size < 2) lastPinchDist = null;
    if (!isDragging) return;
    isDragging = false;
    canvas.classList.remove('dragging');

    if (!didDrag && app.w) {
      const sx = e.clientX - canvasRect.left;
      const sy = e.clientY - canvasRect.top;

      const bannerCity = renderer.hitBannerAt(sx, sy);
      if (bannerCity) {
        app.emit('banner:click', { city: bannerCity, sx, sy });
        app.selectCity(bannerCity, { source: 'banner', openCityView: true });
        return;
      }

      const worldPt = cam.screenToWorld(sx, sy);
      const cell = isElevation25D(app.state)
        ? pickCell25D(app.w, worldPt.x, worldPt.y)
        : app.w.cellAt(worldPt.x, worldPt.y);
      const ow = cell >= 0 ? app.w.owner[cell] : -1;
      const ctIdx = cell >= 0 ? app.w.county?.[cell] ?? -1 : -1;
      const cityAtCell = cell >= 0 ? app.state.cities.find((c) => c.cell === cell) || null : null;

      let consumed = false;
      const payload = {
        cell,
        wx: worldPt.x,
        wy: worldPt.y,
        sx,
        sy,
        stateIdx: ow >= 0 ? ow : null,
        state: ow >= 0 ? app.state.states[ow] : null,
        countyIdx: ctIdx >= 0 ? ctIdx : null,
        county: ctIdx >= 0 ? app.data.counties?.rows?.[ctIdx] || app.w.counties?.[ctIdx] : null,
        city: cityAtCell,
        originalEvent: e,
        consume() {
          consumed = true;
        },
      };
      app.emit('mapclick', payload);
      app.emit('click', payload);

      if (!consumed && app.modes.current === 'map') {
        if (cityAtCell) {
          app.selectCity(cityAtCell, { source: 'map' });
        } else if (ow >= 0) {
          app.selectState(ow, { source: 'map', cell });
        } else {
          app.clearSelection();
        }
      }
    }
  };

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    app.state.hoverCell = -1;
    prevBannerCity = null;
    lastTipKey = '';
    app.ui.hideTooltip();
    renderer.requestDraw();
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const sx = e.clientX - canvasRect.left;
      const sy = e.clientY - canvasRect.top;
      const factor = Math.exp(-e.deltaY * 0.0014);
      cam.zoomAtScreen(sx, sy, factor);
    },
    { passive: false }
  );

  // Zoom Buttons
  document.getElementById('zoom-in')?.addEventListener('click', () => {
    const c = cam.viewportCenterScreen();
    cam.zoomAtScreen(c.sx, c.sy, 1.38);
  });
  document.getElementById('zoom-out')?.addEventListener('click', () => {
    const c = cam.viewportCenterScreen();
    cam.zoomAtScreen(c.sx, c.sy, 1 / 1.38);
  });
  document.getElementById('zoom-home')?.addEventListener('click', () => app.fitChina());

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchCtrl.focus();
      return;
    }

    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-root');
      if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        modal.innerHTML = '';
        return;
      }
      if (!app.modes.handleEscape()) {
        app.clearSelection();
        app.setHighlight(null);
      }
      return;
    }

    if (isInput) return;

    if (e.key === '/') {
      e.preventDefault();
      searchCtrl.focus();
    } else if (e.key.toLowerCase() === 'r') {
      app.setShowResources(!app.state.showResources);
    } else if (e.key.toLowerCase() === 'h' || e.key === 'Home') {
      app.fitChina();
    } else if (e.key === '+' || e.key === '=') {
      const c = cam.viewportCenterScreen();
      cam.zoomAtScreen(c.sx, c.sy, 1.35);
    } else if (e.key === '-' || e.key === '_') {
      const c = cam.viewportCenterScreen();
      cam.zoomAtScreen(c.sx, c.sy, 1 / 1.35);
    } else if (e.key === '?') {
      app.openHelp();
    }
  });
}

boot();
