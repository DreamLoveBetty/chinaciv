// Offscreen-cached 60fps Canvas 2D hex map renderer

import { rgbToHex, rgba, provinceColor } from '../color.js';
import { terrainHexColor, buildLensColorizer } from '../terrain.js';
import { drawTerrainArt } from './art/terrain.js';
import { drawWaterFeatures } from './art/water.js';
import { drawBorders } from './art/borders.js';
import { drawResources } from './art/resources.js';
import { drawProvinceLabels } from './art/labels.js';
import { drawOverlay } from './overlays.js';

export function createMapRenderer({ canvas, cam, app }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const cacheCanvas = document.createElement('canvas');
  const cacheCtx = cacheCanvas.getContext('2d', { alpha: false });

  const staticLayers = [];
  const overlays = [];

  let staticDirty = true;
  let drawQueued = false;
  let cacheMeta = null; // { x0, y0, x1, y1, zoom, dpr, wPx, hPx }
  let lastHitBanners = [];

  function drawHexPath(c, cx, cy, corners, scale = 1.015) {
    c.beginPath();
    for (let k = 0; k < 6; k++) {
      const px = cx + corners[k][0] * scale;
      const py = cy + corners[k][1] * scale;
      if (k === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  }

  function bakeStaticCache() {
    const w = app.w;
    if (!w) return;

    const vb = cam.viewBoundsWorld();
    const viewWKm = Math.max(200, vb.x1 - vb.x0);
    const viewHKm = Math.max(200, vb.y1 - vb.y0);

    // Extra margin around viewport so panning is pure blit
    const marginRatio = 0.42;
    const x0 = vb.x0 - viewWKm * marginRatio;
    const y0 = vb.y0 - viewHKm * marginRatio;
    const x1 = vb.x1 + viewWKm * marginRatio;
    const y1 = vb.y1 + viewHKm * marginRatio;

    const dpr = cam.dpr;
    const zoom = cam.zoom;
    const maxDim = 4096;
    let cacheW = Math.max(2, Math.round((x1 - x0) * zoom * dpr));
    let cacheH = Math.max(2, Math.round((y1 - y0) * zoom * dpr));
    if (cacheW > maxDim || cacheH > maxDim) {
      const s = Math.min(maxDim / cacheW, maxDim / cacheH);
      cacheW = Math.round(cacheW * s);
      cacheH = Math.round(cacheH * s);
    }

    cacheCanvas.width = cacheW;
    cacheCanvas.height = cacheH;

    const effectiveScale = cacheW / ((x1 - x0) * zoom);
    const scaleTotal = zoom * effectiveScale;

    // 1. Deep ocean background
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.fillStyle = '#0b233c';
    cacheCtx.fillRect(0, 0, cacheW, cacheH);

    cacheCtx.save();
    cacheCtx.scale(scaleTotal, scaleTotal);
    cacheCtx.translate(-x0, -y0);

    // Determine visible cell bounding box [r0..r1] x [c0..c1]
    const { cols, rows, R, W, H_step, corners, cxArr, cyArr, owner } = w;
    const r0 = Math.max(0, Math.floor((y0 - R * 1.5) / H_step));
    const r1 = Math.min(rows - 1, Math.ceil((y1 + R * 1.5) / H_step));
    const c0 = Math.max(0, Math.floor((x0 - W * 1.5) / W));
    const c1 = Math.min(cols - 1, Math.ceil((x1 + W * 1.5) / W));

    const visibleCells = [];
    const landCells = [];
    const activeLens = app.state.lens;
    const colorizer = activeLens ? buildLensColorizer(w, app.data, activeLens) : null;
    const activeBand = app.state.band;

    // 2. Hex tiles pass (foreign land, coastal ocean, China land / lens choropleth)
    for (let r = r0; r <= r1; r++) {
      const rowOff = r * cols;
      for (let c = c0; c <= c1; c++) {
        const i = rowOff + c;
        visibleCells.push(i);
        const ow = owner[i];
        if (ow === -1 && !(w.isCoast && w.isCoast[i])) continue;

        let rgb = colorizer ? colorizer.colorFor(i) : terrainHexColor(w, i);
        if (ow >= 0) landCells.push(i);

        // If a legend band is selected, dim non-matching China cells cleanly
        if (ow >= 0 && colorizer && activeBand && !colorizer.matchesBand(i, activeBand)) {
          rgb = [
            Math.round(rgb[0] * 0.3 + 12),
            Math.round(rgb[1] * 0.3 + 16),
            Math.round(rgb[2] * 0.3 + 22),
          ];
        }

        cacheCtx.fillStyle = rgbToHex(rgb[0], rgb[1], rgb[2]);
        drawHexPath(cacheCtx, cxArr[i], cyArr[i], corners, 1.018);
        cacheCtx.fill();
      }
    }

    // 3. Subtle hex grid lines
    if (zoom >= 0.2) {
      cacheCtx.strokeStyle = activeLens ? 'rgba(10, 18, 28, 0.22)' : 'rgba(13, 25, 38, 0.20)';
      cacheCtx.lineWidth = Math.max(0.55, 0.9 / Math.max(0.25, zoom));
      cacheCtx.beginPath();
      for (let k = 0; k < landCells.length; k++) {
        const i = landCells[k];
        const x = cxArr[i];
        const y = cyArr[i];
        cacheCtx.moveTo(x + corners[0][0], y + corners[0][1]);
        for (let m = 1; m < 6; m++) {
          cacheCtx.lineTo(x + corners[m][0], y + corners[m][1]);
        }
        cacheCtx.closePath();
      }
      cacheCtx.stroke();
    }

    // Highlight matching band cells subtly with bright rim
    if (colorizer && activeBand) {
      cacheCtx.strokeStyle = 'rgba(255, 232, 166, 0.72)';
      cacheCtx.lineWidth = Math.max(1.0, 1.8 / zoom);
      for (let k = 0; k < landCells.length; k++) {
        const i = landCells[k];
        if (!colorizer.matchesBand(i, activeBand)) continue;
        drawHexPath(cacheCtx, cxArr[i], cyArr[i], corners, 0.96);
        cacheCtx.stroke();
      }
    }

    // 4. Procedural terrain glyphs (subtle under lens, rich in terrain mode)
    if (!activeLens) {
      drawTerrainArt(cacheCtx, w, landCells, zoom, true);
    }

    // 5. Rivers, lakes & South China Sea dashed line
    drawWaterFeatures(cacheCtx, w, zoom);

    // 6. Provincial border ribbons & national border
    drawBorders(cacheCtx, w, zoom, Boolean(activeLens));

    // 7. City footprint hex accents
    if (Array.isArray(app.state.cities)) {
      for (const city of app.state.cities) {
        if (city.cell == null || city.cell < 0 || city.cell >= w.N) continue;
        const pCol = provinceColor(city.province_idx ?? 0);
        cacheCtx.fillStyle = rgba(pCol, 0.24);
        drawHexPath(cacheCtx, cxArr[city.cell], cyArr[city.cell], corners, 0.95);
        cacheCtx.fill();
      }
    }

    // 8. Static map art extension layers (roads, rail, hubs, military, wonders, trade)
    const orderedStatic = [...staticLayers].sort((a, b) => (a.order || 0) - (b.order || 0));
    const utils = { provinceColor, rgba, drawHexPath };
    for (const layer of orderedStatic) {
      const enabled =
        typeof layer.enabled === 'function'
          ? layer.enabled(app.state)
          : app.state.layers[layer.id] !== false;
      if (!enabled || typeof layer.draw !== 'function') continue;
      try {
        cacheCtx.save();
        layer.draw(cacheCtx, w, app.state, app.data, zoom, utils);
        cacheCtx.restore();
      } catch (err) {
        console.error(`[staticLayer:${layer.id}]`, err);
      }
    }

    // 9. Strategic resources
    drawResources(cacheCtx, w, app.data, app.state, zoom);

    // 10. Province labels
    drawProvinceLabels(cacheCtx, w, app.state, zoom);

    cacheCtx.restore();

    cacheMeta = { x0, y0, x1, y1, zoom, dpr, cacheW, cacheH };
    staticDirty = false;
  }

  function cacheCoversView() {
    if (!cacheMeta || staticDirty) return false;
    if (Math.abs(cacheMeta.zoom - cam.zoom) > 1e-4 || cacheMeta.dpr !== cam.dpr) return false;
    const vb = cam.viewBoundsWorld();
    return (
      vb.x0 >= cacheMeta.x0 &&
      vb.y0 >= cacheMeta.y0 &&
      vb.x1 <= cacheMeta.x1 &&
      vb.y1 <= cacheMeta.y1
    );
  }

  function renderNow() {
    drawQueued = false;
    const w = app.w;
    if (!w) return;

    if (!cacheCoversView()) {
      bakeStaticCache();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b233c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (cacheMeta) {
      const vb = cam.viewBoundsWorld();
      const srcScaleX = cacheMeta.cacheW / (cacheMeta.x1 - cacheMeta.x0);
      const srcScaleY = cacheMeta.cacheH / (cacheMeta.y1 - cacheMeta.y0);
      const sx = (vb.x0 - cacheMeta.x0) * srcScaleX;
      const sy = (vb.y0 - cacheMeta.y0) * srcScaleY;
      const sw = (vb.x1 - vb.x0) * srcScaleX;
      const sh = (vb.y1 - vb.y0) * srcScaleY;

      ctx.drawImage(cacheCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    }

    // Soft strategic vignette
    const grad = ctx.createRadialGradient(
      canvas.width * 0.5,
      canvas.height * 0.5,
      Math.min(canvas.width, canvas.height) * 0.35,
      canvas.width * 0.5,
      canvas.height * 0.5,
      Math.max(canvas.width, canvas.height) * 0.72
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(4, 11, 20, 0.34)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    lastHitBanners = drawOverlay(ctx, w, cam, app.state, app.data, overlays);
  }

  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(renderNow);
  }

  function invalidateStatic() {
    staticDirty = true;
  }

  function hitBannerAt(sx, sy) {
    for (let i = lastHitBanners.length - 1; i >= 0; i--) {
      const b = lastHitBanners[i];
      if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) {
        return b.city;
      }
    }
    return null;
  }

  return {
    requestDraw,
    invalidateStatic,
    renderNow,
    hitBannerAt,
    registerStaticLayer(layer) {
      if (!layer || !layer.id) return;
      const idx = staticLayers.findIndex((l) => l.id === layer.id);
      if (idx >= 0) staticLayers[idx] = layer;
      else staticLayers.push(layer);
      staticDirty = true;
      requestDraw();
    },
    registerOverlay(overlay) {
      if (!overlay || !overlay.id) return () => {};
      const idx = overlays.findIndex((o) => o.id === overlay.id);
      if (idx >= 0) overlays[idx] = overlay;
      else overlays.push(overlay);
      requestDraw();
      return () => {
        const i = overlays.findIndex((o) => o.id === overlay.id);
        if (i >= 0) {
          overlays.splice(i, 1);
          requestDraw();
        }
      };
    },
    unregisterOverlay(id) {
      const idx = overlays.findIndex((o) => o.id === id);
      if (idx >= 0) {
        overlays.splice(idx, 1);
        requestDraw();
      }
    },
  };
}
