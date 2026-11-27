// High-level application actions: lenses, bands, selection, camera framing, layers, highlights

import { TILT_25D, isElevation25D, elevLiftKm } from '../render/art/elevation25d.js?v=20261127-5';

export function createActions(app, renderer) {
  function computeChinaFitZoom(pad = 28) {
    if (!app.w || !app.cam) return 0.12;
    const b = app.w.chinaBounds;
    const avail = app.cam.availableSize();
    const bw = Math.max(40, b.x1 - b.x0);
    const bh = Math.max(40, (b.y1 - b.y0) * (app.cam.yScale || 1));
    const zx = Math.max(0.05, (avail.w - pad * 2) / bw);
    const zy = Math.max(0.05, (avail.h - pad * 2) / bh);
    return Math.min(zx, zy);
  }

  function syncMinZoom() {
    if (!app.w || !app.cam) return;
    app.cam.setMinZoom(computeChinaFitZoom(28));
  }

  function syncCameraTilt() {
    if (typeof app.cam?.setYScale === 'function') {
      app.cam.setYScale(isElevation25D(app.state) ? TILT_25D : 1.0);
    }
    syncMinZoom();
  }

  function findLens(lensOrId) {
    if (!lensOrId || lensOrId === 'terrain') return null;
    if (typeof lensOrId === 'object') return lensOrId;
    const list = app.data.lenses?.lenses || [];
    return list.find((l) => l.id === lensOrId) || null;
  }

  function resolveCity(cityOrId) {
    if (!cityOrId) return null;
    if (typeof cityOrId === 'object') return cityOrId;
    const key = String(cityOrId).toLowerCase();
    return (
      app.state.cities.find(
        (c) =>
          String(c.id).toLowerCase() === key ||
          String(c.code || '').toLowerCase() === key ||
          String(c.name) === String(cityOrId) ||
          String(c.full) === String(cityOrId)
      ) || null
    );
  }

  function resolveStateIdx(idxOrCodeOrName) {
    if (idxOrCodeOrName == null) return null;
    if (typeof idxOrCodeOrName === 'number') {
      return idxOrCodeOrName >= 0 && idxOrCodeOrName < (app.state.states.length || 34) ? idxOrCodeOrName : null;
    }
    const key = String(idxOrCodeOrName).trim();
    if (/^\d+$/.test(key)) {
      const n = Number(key);
      if (n >= 0 && n < 34) return n;
    }
    const idx = app.state.states.findIndex(
      (s, i) =>
        String(s.code) === key ||
        s.name === key ||
        s.abbr === key ||
        String(i) === key
    );
    return idx >= 0 ? idx : null;
  }

  const actions = {
    requestDraw() {
      renderer.requestDraw();
    },
    requestStatic() {
      renderer.invalidateStatic();
      renderer.requestDraw();
    },
    setLens(lensOrId, opts = {}) {
      const prev = app.state.lens;
      const next = findLens(lensOrId);
      app.state.lens = next;
      app.state.band = null;
      if (!opts.silentHash) {
        if (next) app.hash.set('lens', next.id);
        else app.hash.del('lens');
      }
      syncCameraTilt();
      renderer.invalidateStatic();
      renderer.requestDraw();
      app.emit('lens', { lens: next, prev });
      app.emit('lens:change', { lens: next, prev });
      app.emit('band', { band: null });
      return next;
    },
    setElevation25D(enabled) {
      const next = Boolean(enabled);
      if (app.state.elevation25D === next) return next;
      app.state.elevation25D = next;
      syncCameraTilt();
      renderer.invalidateStatic();
      renderer.requestDraw();
      app.emit('elevation25d', { enabled: next });
      return next;
    },
    setBand(band) {
      const same =
        band &&
        app.state.band &&
        band.index === app.state.band.index &&
        band.value === app.state.band.value;
      app.state.band = same ? null : band || null;
      renderer.invalidateStatic();
      renderer.requestDraw();
      app.emit('band', { band: app.state.band });
      app.emit('band:change', { band: app.state.band });
      return app.state.band;
    },
    setHighlight(hl) {
      app.state.highlight = hl || null;
      renderer.requestDraw();
      app.emit('highlight', app.state.highlight);
    },
    setResourceFilter(rf) {
      app.state.resourceFilter = rf ?? null;
      renderer.invalidateStatic();
      renderer.requestDraw();
      app.emit('resources:filter', app.state.resourceFilter);
    },
    setShowResources(b) {
      app.state.showResources = Boolean(b);
      if (!app.state.showResources) app.hash.del('res');
      else app.hash.set('res', '1');
      renderer.invalidateStatic();
      renderer.requestDraw();
      app.emit('resources:change', app.state.showResources);
    },
    setLayer(id, enabled) {
      const next = Boolean(enabled);
      if (app.state.layers[id] === next) return next;
      app.state.layers[id] = next;
      renderer.invalidateStatic();
      renderer.requestDraw();
      app.emit('layer:change', { id, enabled: next });
      return next;
    },
    getLayer(id) {
      return Boolean(app.state.layers[id]);
    },
    focusCity(cityOrId, opts = {}) {
      const city = resolveCity(cityOrId);
      if (!city || !app.w) return;
      const wx = city.x ?? app.w.cx(city.cell);
      const wy = city.y ?? app.w.cy(city.cell);
      const lift = isElevation25D(app.state) && city.cell >= 0 && app.w.elev ? elevLiftKm(app.w.elev[city.cell]) : 0;
      const targetZoom = opts.zoom ?? Math.max(app.cam.zoom, 0.95);
      app.cam.animateTo(wx, wy - lift, targetZoom, opts);
    },
    focusState(idxOrKey, opts = {}) {
      const idx = resolveStateIdx(idxOrKey);
      if (idx == null || !app.w) return;
      const sb = app.w.stateBounds[idx];
      if (!sb) return;
      const anchorCell = app.state.states?.[idx]?.cell ?? sb.labelCell ?? -1;
      const lift = isElevation25D(app.state) && anchorCell >= 0 && app.w.elev ? elevLiftKm(app.w.elev[anchorCell]) : 0;
      app.cam.fitBounds(sb.x0, sb.y0 - lift, sb.x1, sb.y1 - lift * 0.25, { padding: 48, maxZoom: 1.4, ...opts });
    },
    computeChinaFitZoom,
    syncMinZoom,
    fitBounds(x0, y0, x1, y1, opts = {}) {
      app.cam.fitBounds(x0, y0, x1, y1, opts);
    },
    fitChina(opts = {}) {
      if (!app.w) return;
      syncMinZoom();
      const b = app.w.chinaBounds;
      app.cam.fitBounds(b.x0, b.y0, b.x1, b.y1, { padding: 28, ...opts });
      app.emit('cam:fitChina', opts);
    },
    selectCity(cityOrId, opts = {}) {
      const city = resolveCity(cityOrId);
      if (!city) return null;
      app.state.selectedCity = city;
      app.state.selectedState = city.province_idx ?? app.state.selectedState;
      if (opts.focus !== false) {
        actions.focusCity(city, opts);
      }
      if (!opts.silentPanel && app.panels?.city) {
        app.panels.city(city, opts);
      }
      renderer.requestDraw();
      app.emit('select:city', { city, opts });
      return city;
    },
    selectState(idxOrKey, opts = {}) {
      const idx = resolveStateIdx(idxOrKey);
      if (idx == null) return null;
      app.state.selectedState = idx;
      app.state.selectedCity = null;
      if (opts.focus !== false) {
        actions.focusState(idx, opts);
      }
      if (!opts.silentPanel && app.panels?.state) {
        app.panels.state(idx, opts);
      }
      renderer.requestDraw();
      app.emit('select:state', { idx, state: app.state.states[idx], opts });
      return idx;
    },
    clearSelection() {
      app.state.selectedCity = null;
      app.state.selectedState = null;
      app.panels?.close?.();
      renderer.requestDraw();
      app.emit('select:clear', {});
    },
  };

  return actions;
}
