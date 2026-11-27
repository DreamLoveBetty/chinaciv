// Offscreen-cached 60fps Canvas 2D hex map renderer with zoom scale-blit & color-batched tile baking

import { rgbToHex, rgba, provinceColor } from '../color.js';
import { getTerrainColorHexArr, buildLensColorizer } from '../terrain.js?v=20261128-4';
import { drawBackdropHexes, drawBackdropWater } from './art/backdrop.js?v=20261128-4';
import { drawTerrainArt } from './art/terrain.js?v=20261128-2';
import { drawIsometricCities, buildCityCoreSet } from './art/cities.js?v=20261128-3';
import { drawWaterFeatures } from './art/water.js?v=20261127-5';
import { drawBorders } from './art/borders.js?v=20261128-2';
import { drawResources } from './art/resources.js?v=20261128-3';
import { drawIsohyet400 } from './art/climate.js?v=20261127-4';
import { isElevation25D, drawElevation25D } from './art/elevation25d.js?v=20261127-5';
import { drawProvinceLabels } from './art/labels.js?v=20261128-3';
import { drawOverlay } from './overlays.js?v=20261128-3';

export function createMapRenderer({ canvas, cam, app }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const cacheCanvas = document.createElement('canvas');
  const cacheCtx = cacheCanvas.getContext('2d', { alpha: false });

  const staticLayers = [];
  const overlays = [];

  let staticDirty = true;
  let drawQueued = false;
  let cacheMeta = null; // { x0, y0, x1, y1, zoom, dpr, cacheW, cacheH }
  let lastHitBanners = [];
  let cachedVignette = null; // { w, h, grad }

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

  function traceHexSubpath(c, cx, cy, corners, scale = 1.018) {
    c.moveTo(cx + corners[0][0] * scale, cy + corners[0][1] * scale);
    c.lineTo(cx + corners[1][0] * scale, cy + corners[1][1] * scale);
    c.lineTo(cx + corners[2][0] * scale, cy + corners[2][1] * scale);
    c.lineTo(cx + corners[3][0] * scale, cy + corners[3][1] * scale);
    c.lineTo(cx + corners[4][0] * scale, cy + corners[4][1] * scale);
    c.lineTo(cx + corners[5][0] * scale, cy + corners[5][1] * scale);
    c.closePath();
  }

  function dimHexColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * 0.3 + 12);
    const g = Math.round(((n >> 8) & 255) * 0.3 + 16);
    const b = Math.round((n & 255) * 0.3 + 22);
    return rgbToHex(r, g, b);
  }

  function bakeStaticCache() {
    const w = app.w;
    if (!w) return;

    const vb = cam.viewBoundsWorld();
    const zoom = cam.zoom;
    const yScale = cam.yScale || 1;
    const is25D = isElevation25D(app.state);
    const dpr = cam.dpr;

    // 240 CSS-px margin around viewport so normal drags stay 100% inside cache without mid-drag rebakes
    const padKm = Math.min(950, Math.max(40, 240 / Math.max(0.12, zoom)));
    const x0 = vb.x0 - padKm;
    const y0 = vb.y0 - padKm;
    const x1 = vb.x1 + padKm;
    const y1 = vb.y1 + padKm;

    const maxDim = 4096;
    const effDpr = zoom < 0.5 ? Math.min(dpr, 1.5) : dpr;
    let cacheW = Math.max(2, Math.round((x1 - x0) * zoom * effDpr));
    let cacheH = Math.max(2, Math.round((y1 - y0) * zoom * yScale * effDpr));
    if (cacheW > maxDim || cacheH > maxDim) {
      const s = Math.min(maxDim / cacheW, maxDim / cacheH);
      cacheW = Math.round(cacheW * s);
      cacheH = Math.round(cacheH * s);
    }

    if (cacheCanvas.width !== cacheW || cacheCanvas.height !== cacheH) {
      cacheCanvas.width = cacheW;
      cacheCanvas.height = cacheH;
    }

    const scaleX = cacheW / (x1 - x0);
    const scaleY = cacheH / (y1 - y0);

    // 1. Deep ocean background
    cacheCtx.setTransform(1, 0, 0, 1, 0, 0);
    cacheCtx.fillStyle = '#0b233c';
    cacheCtx.fillRect(0, 0, cacheW, cacheH);

    cacheCtx.save();
    cacheCtx.scale(scaleX, scaleY);
    cacheCtx.translate(-x0, -y0);

    // Determine visible cell bounding box [r0..r1] x [c0..c1]
    const { cols, rows, R, W, H_step, corners, cxArr, cyArr, owner } = w;
    const r0 = Math.max(0, Math.floor((y0 - R * 1.5) / H_step));
    const r1 = Math.min(rows - 1, Math.ceil((y1 + R * 1.5) / H_step));
    const c0 = Math.max(0, Math.floor((x0 - W * 1.5) / W));
    const c1 = Math.min(cols - 1, Math.ceil((x1 + W * 1.5) / W));

    const dimExceptState = currentDimExceptState();
    const activeLens = app.state.lens;
    const colorizer = activeLens ? buildLensColorizer(w, app.data, activeLens) : null;
    const colorArr = colorizer ? colorizer.colorHexArr : getTerrainColorHexArr(w);
    const activeBand = app.state.band;
    const bounds = { x0, y0, x1, y1 };
    const CHUNK = 250;

    if (is25D) {
      // Extended Eurasia-Pacific backdrop land + coastal shelf + muted lakes/rivers under 2.5D prisms
      drawBackdropHexes(cacheCtx, w, w.backdrop, bounds, zoom);

      // Flat base pass: coastal shelf & dark neighboring land
      const bgBuckets = new Map();
      for (let r = r0; r <= r1; r++) {
        const rowOff = r * cols;
        for (let c = c0; c <= c1; c++) {
          const i = rowOff + c;
          if (owner[i] >= 0) continue;
          const hex = colorArr[i];
          if (!hex) continue;
          let bucket = bgBuckets.get(hex);
          if (!bucket) {
            bucket = [];
            bgBuckets.set(hex, bucket);
          }
          bucket.push(i);
        }
      }
      for (const [fillHex, list] of bgBuckets) {
        cacheCtx.fillStyle = fillHex;
        for (let off = 0; off < list.length; off += CHUNK) {
          cacheCtx.beginPath();
          const end = Math.min(list.length, off + CHUNK);
          for (let k = off; k < end; k++) {
            const i = list[k];
            traceHexSubpath(cacheCtx, cxArr[i], cyArr[i], corners, 1.018);
          }
          cacheCtx.fill();
        }
      }

      drawBackdropWater(cacheCtx, w.backdrop, zoom);

      // South China Sea dashed line on sea plane
      drawWaterFeatures(cacheCtx, w, zoom, bounds, { scsOnly: true });

      // 2.5D extruded China hex prisms (North -> South painter's order + lifted depth-occluded borders)
      drawElevation25D(cacheCtx, w, colorizer, activeBand, dimExceptState, zoom, bounds);

      // Lifted province serif labels (aspect-compensated for yScale)
      drawProvinceLabels(cacheCtx, w, app.state, zoom, bounds, dimExceptState, yScale, true);

      cacheCtx.restore();
      cacheMeta = { x0, y0, x1, y1, zoom, yScale, is25D, dpr, cacheW, cacheH, dimState: dimExceptState };
      staticDirty = false;
      return;
    }

    const landCells = [];
    const unselectedLandCells = [];
    const bandMatchCells = [];
    const dimCache = new Map();

    // 1.9 Extended Eurasia-Pacific backdrop land & coastal shelf tiles
    drawBackdropHexes(cacheCtx, w, w.backdrop, bounds, zoom);

    // 2. Color-batched hex tiles pass, chunked to <=250 hexes per beginPath() so Skia tessellator stays <1ms
    const buckets = new Map();
    for (let r = r0; r <= r1; r++) {
      const rowOff = r * cols;
      for (let c = c0; c <= c1; c++) {
        const i = rowOff + c;
        const hex = colorArr[i];
        if (!hex) continue;
        const ow = owner[i];
        let fillHex = hex;
        if (ow >= 0) {
          landCells.push(i);
          if (dimExceptState >= 0 && ow !== dimExceptState) {
            unselectedLandCells.push(i);
          }
          if (colorizer && activeBand) {
            if (colorizer.matchesBand(i, activeBand)) {
              bandMatchCells.push(i);
            } else {
              let dh = dimCache.get(hex);
              if (!dh) {
                dh = dimHexColor(hex);
                dimCache.set(hex, dh);
              }
              fillHex = dh;
            }
          }
        }
        let bucket = buckets.get(fillHex);
        if (!bucket) {
          bucket = [];
          buckets.set(fillHex, bucket);
        }
        bucket.push(i);
      }
    }

    for (const [fillHex, list] of buckets) {
      cacheCtx.fillStyle = fillHex;
      for (let off = 0; off < list.length; off += CHUNK) {
        cacheCtx.beginPath();
        const end = Math.min(list.length, off + CHUNK);
        for (let k = off; k < end; k++) {
          const i = list[k];
          traceHexSubpath(cacheCtx, cxArr[i], cyArr[i], corners, 1.018);
        }
        cacheCtx.fill();
      }
    }

    // 3. Subtle hex grid lines (3 shared edges per hex, chunked <=350 to avoid Skia O(N log N) stroke slowdown)
    if (zoom >= 0.22 && landCells.length) {
      cacheCtx.strokeStyle = activeLens ? 'rgba(10, 18, 28, 0.22)' : 'rgba(28, 34, 24, 0.19)';
      cacheCtx.lineWidth = Math.max(0.55, 0.9 / Math.max(0.25, zoom));
      const c5x = corners[5][0], c5y = corners[5][1];
      const c0x = corners[0][0], c0y = corners[0][1];
      const c1x = corners[1][0], c1y = corners[1][1];
      const c2x = corners[2][0], c2y = corners[2][1];
      for (let off = 0; off < landCells.length; off += 350) {
        cacheCtx.beginPath();
        const end = Math.min(landCells.length, off + 350);
        for (let k = off; k < end; k++) {
          const i = landCells[k];
          const x = cxArr[i];
          const y = cyArr[i];
          cacheCtx.moveTo(x + c5x, y + c5y);
          cacheCtx.lineTo(x + c0x, y + c0y);
          cacheCtx.lineTo(x + c1x, y + c1y);
          cacheCtx.lineTo(x + c2x, y + c2y);
        }
        cacheCtx.stroke();
      }
    }

    // Highlight matching band cells in chunked strokes
    if (bandMatchCells.length) {
      cacheCtx.strokeStyle = 'rgba(255, 232, 166, 0.72)';
      cacheCtx.lineWidth = Math.max(1.0, 1.8 / zoom);
      for (let off = 0; off < bandMatchCells.length; off += 300) {
        cacheCtx.beginPath();
        const end = Math.min(bandMatchCells.length, off + 300);
        for (let k = off; k < end; k++) {
          const i = bandMatchCells[k];
          traceHexSubpath(cacheCtx, cxArr[i], cyArr[i], corners, 0.96);
        }
        cacheCtx.stroke();
      }
    }

    const cityCoreSet = buildCityCoreSet(app.state.cities);

    // 4. Procedural terrain glyphs (batched in terrain.js)
    if (!activeLens) {
      drawTerrainArt(cacheCtx, w, landCells, zoom, true, cityCoreSet);
    }

    // 5. Exterior & interior rivers, lakes & South China Sea dashed line (cached Path2D)
    drawBackdropWater(cacheCtx, w.backdrop, zoom);
    drawWaterFeatures(cacheCtx, w, zoom, bounds);

    // 6. Provincial border ribbons & national border (pre-indexed + viewport culled)
    drawBorders(cacheCtx, w, zoom, Boolean(activeLens), bounds);

    // 7. Static map art extension layers: ground networks first (order <= 14: roads, rail)
    const orderedStatic = [...staticLayers].sort((a, b) => (a.order || 0) - (b.order || 0));
    const utils = { provinceColor, rgba, drawHexPath, bounds };
    for (const layer of orderedStatic) {
      if ((layer.order || 0) > 14) continue;
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

    // 8. 3D Isometric City Skylines & urban blocks (layered cleanly above roads/rail entrance)
    drawIsometricCities(cacheCtx, w, app.state, zoom, bounds, Boolean(activeLens));

    // 9. Static map art extension layers: hubs, airlines, wonders, trade (order > 14)
    for (const layer of orderedStatic) {
      if ((layer.order || 0) <= 14) continue;
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
    drawResources(cacheCtx, w, app.data, app.state, zoom, bounds);

    // 9.2. 400mm Continental Isohyet Divider (when Precipitation layer is active)
    if (activeLens?.id === 'precip') {
      drawIsohyet400(cacheCtx, w, zoom);
    }

    // 9.5 Subtle dimming veil over unselected provinces when a province is selected in map mode
    if (dimExceptState >= 0 && unselectedLandCells.length) {
      cacheCtx.fillStyle = 'rgba(6, 13, 22, 0.44)';
      for (let off = 0; off < unselectedLandCells.length; off += 300) {
        cacheCtx.beginPath();
        const end = Math.min(unselectedLandCells.length, off + 300);
        for (let k = off; k < end; k++) {
          const i = unselectedLandCells[k];
          traceHexSubpath(cacheCtx, cxArr[i], cyArr[i], corners, 1.018);
        }
        cacheCtx.fill();
      }
    }

    // 10. Province labels
    drawProvinceLabels(cacheCtx, w, app.state, zoom, bounds, dimExceptState, yScale, false);

    cacheCtx.restore();

    cacheMeta = { x0, y0, x1, y1, zoom, yScale, is25D, dpr, cacheW, cacheH, dimState: dimExceptState };
    staticDirty = false;
  }

  function currentDimExceptState() {
    const hasExtDim = Boolean(app.state.highlight && (app.state.highlight.dim || app.state.highlight.dimOthers));
    return app.state.selectedState != null && app.state.mode === 'map' && !hasExtDim
      ? app.state.selectedState
      : -1;
  }

  function cacheCoversBounds(vb) {
    if (!cacheMeta) return false;
    return (
      vb.x0 >= cacheMeta.x0 &&
      vb.y0 >= cacheMeta.y0 &&
      vb.x1 <= cacheMeta.x1 &&
      vb.y1 <= cacheMeta.y1
    );
  }

  function canScaleBlitDuringInteraction(vb) {
    if (!cacheMeta || staticDirty || cacheMeta.dpr !== cam.dpr) return false;
    if (cacheMeta.dimState !== currentDimExceptState()) return false;
    if (cacheMeta.yScale !== (cam.yScale || 1) || cacheMeta.is25D !== isElevation25D(app.state)) return false;
    const zoomRatio = cacheMeta.zoom / cam.zoom;
    if (zoomRatio < 0.35 || zoomRatio > 2.8) return false;
    return cacheCoversBounds(vb);
  }

  function shouldBakeNow() {
    if (!cacheMeta || staticDirty || cacheMeta.dpr !== cam.dpr) return true;
    if (cacheMeta.dimState !== currentDimExceptState()) return true;
    if (cacheMeta.yScale !== (cam.yScale || 1) || cacheMeta.is25D !== isElevation25D(app.state)) return true;
    const vb = cam.viewBoundsWorld();
    if (cam.isInteracting) {
      return !canScaleBlitDuringInteraction(vb);
    }
    if (Math.abs(cacheMeta.zoom - cam.zoom) > 1e-4) return true;
    return !cacheCoversBounds(vb);
  }

  function renderNow() {
    drawQueued = false;
    const w = app.w;
    if (!w) return;

    if (shouldBakeNow()) {
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

    // Cached strategic vignette gradient
    if (!cachedVignette || cachedVignette.w !== canvas.width || cachedVignette.h !== canvas.height) {
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
      cachedVignette = { w: canvas.width, h: canvas.height, grad };
    }
    ctx.fillStyle = cachedVignette.grad;
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

  function onCameraSettle(zoomed = false) {
    if (
      !cacheMeta ||
      staticDirty ||
      cacheMeta.dpr !== cam.dpr ||
      cacheMeta.dimState !== currentDimExceptState() ||
      cacheMeta.yScale !== (cam.yScale || 1) ||
      cacheMeta.is25D !== isElevation25D(app.state)
    ) {
      staticDirty = true;
      requestDraw();
      return;
    }
    const vb = cam.viewBoundsWorld();
    const zoomChanged = zoomed && Math.abs(cacheMeta.zoom - cam.zoom) > 1e-4;
    if (zoomChanged || !cacheCoversBounds(vb)) {
      staticDirty = true;
      requestDraw();
    }
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
    onCameraSettle,
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
