// Dynamic 60fps overlay renderer: memoized highlight cells, batched draw calls, fast selection & banners

import { EDGE_CORNERS } from '../world.js?v=20261127-5';
import { provinceColor, rgba } from '../color.js';
import { drawCityBanners } from './banners.js?v=20261127-5';
import { drawIsohyet400Labels } from './art/climate.js?v=20261127-4';
import { isElevation25D, elevLiftKm } from './art/elevation25d.js?v=20261127-5';

function strokeHex(ctx, cx, cy, corners, scale = 1) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const px = cx + corners[k][0] * scale;
    const py = cy + corners[k][1] * scale;
    if (k === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceHexSubpath(ctx, cx, cy, corners, scale = 0.98) {
  ctx.moveTo(cx + corners[0][0] * scale, cy + corners[0][1] * scale);
  ctx.lineTo(cx + corners[1][0] * scale, cy + corners[1][1] * scale);
  ctx.lineTo(cx + corners[2][0] * scale, cy + corners[2][1] * scale);
  ctx.lineTo(cx + corners[3][0] * scale, cy + corners[3][1] * scale);
  ctx.lineTo(cx + corners[4][0] * scale, cy + corners[4][1] * scale);
  ctx.lineTo(cx + corners[5][0] * scale, cy + corners[5][1] * scale);
  ctx.closePath();
}

const hlCellCache = new WeakMap();

function getHighlightedCells(w, hl, state, data) {
  if (!hl) return null;
  const cached = hlCellCache.get(hl);
  if (cached && cached.nCities === (state?.cities?.length || 0)) {
    return cached.list;
  }

  const set = new Set();
  if (hl.cells) {
    for (const c of hl.cells) if (c >= 0 && c < w.N) set.add(c);
  }
  if (hl.counties && w.countyCells) {
    for (const ct of hl.counties) {
      const list = w.countyCells[ct];
      if (list) for (let k = 0; k < list.length; k++) set.add(list[k]);
    }
  }
  if (hl.states && w.stateCells) {
    for (const st of hl.states) {
      const list = w.stateCells[st];
      if (list) for (let k = 0; k < list.length; k++) set.add(list[k]);
    }
  }
  if (hl.cities) {
    const allCities = state?.cities || data?.cities || [];
    for (const item of hl.cities) {
      const cObj =
        typeof item === 'object' && item
          ? item
          : allCities.find((x) => String(x.id) === String(item) || String(x.code) === String(item) || x.name === item);
      if (cObj) {
        if (Array.isArray(cObj.footprint) && cObj.footprint.length) {
          for (const c of cObj.footprint) set.add(c);
        } else if (cObj.cell >= 0) {
          set.add(cObj.cell);
        }
      }
    }
  }
  if (hl.resources && data?.resources?.items) {
    const items = data.resources.items;
    for (const rIdx of hl.resources) {
      const it = typeof rIdx === 'object' ? rIdx : items[rIdx];
      if (it && it.cell >= 0 && it.cell < w.N) set.add(it.cell);
    }
  }
  const list = Array.from(set);
  hlCellCache.set(hl, { nCities: state?.cities?.length || 0, list });
  return list;
}

export function drawOverlay(ctx, w, cam, state, data, externalOverlays) {
  const { dpr, zoom } = cam;
  const yScale = cam.yScale || 1;
  const is25D = isElevation25D(state);
  const { cxArr, cyArr, corners, R } = w;
  const vb = cam.viewBoundsWorld();
  const cullPad = R * 1.6;
  const vx0 = vb.x0 - cullPad;
  const vy0 = vb.y0 - cullPad;
  const vx1 = vb.x1 + cullPad;
  const vy1 = vb.y1 + cullPad + (is25D ? 310 : 0);

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Transform into world km coordinates
  const cScreen = cam.viewportCenterScreen();
  ctx.save();
  ctx.translate(cScreen.sx, cScreen.sy);
  ctx.scale(zoom, zoom * yScale);
  ctx.translate(-cam.x, -cam.y);

  // 1. Highlight / Brush overlay (Explorer & Advisors)
  const hl = state.highlight;
  if (hl) {
    const hlCells = getHighlightedCells(w, hl, state, data);
    const shouldDim = hl.dim || hl.dimOthers;
    if (shouldDim) {
      const dimAlpha = typeof shouldDim === 'number' ? shouldDim : 0.56;
      ctx.fillStyle = `rgba(6, 13, 22, ${dimAlpha})`;
      ctx.fillRect(vb.x0 - 50, vb.y0 - 50, vb.x1 - vb.x0 + 100, vb.y1 - vb.y0 + 360);
    }

    if (hlCells && hlCells.length > 0) {
      const hlColor = hl.color || '#ecd08e';
      ctx.fillStyle = rgba(hlColor, hl.fillAlpha ?? 0.34);
      ctx.strokeStyle = hl.border || hlColor;
      ctx.lineWidth = Math.max(1.0, 2.0 / zoom);
      ctx.beginPath();
      for (let k = 0; k < hlCells.length; k++) {
        const ci = hlCells[k];
        const x = cxArr[ci];
        const y = cyArr[ci];
        if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
        const lift = is25D && w.elev ? elevLiftKm(w.elev[ci]) : 0;
        traceHexSubpath(ctx, x, y - lift, corners, 0.98);
      }
      ctx.fill();
      ctx.stroke();
    }

    // Proportional bubbles (Advisors)
    if (Array.isArray(hl.bubbles) && hl.bubbles.length) {
      for (const b of hl.bubbles) {
        const bx = b.x ?? (b.cell >= 0 ? cxArr[b.cell] : null);
        let by = b.y ?? (b.cell >= 0 ? cyArr[b.cell] : null);
        if (bx == null || by == null || bx < vx0 - 40 || bx > vx1 + 40 || by < vy0 - 40 || by > vy1 + 40) continue;
        if (is25D && b.cell >= 0 && w.elev) by -= elevLiftKm(w.elev[b.cell]);
        const rad = Math.max(6 / zoom, (b.r || 12) / Math.pow(zoom, 0.55));
        ctx.beginPath();
        ctx.arc(bx, by, rad, 0, Math.PI * 2);
        ctx.fillStyle = rgba(b.color || '#ecd08e', 0.42);
        ctx.fill();
        ctx.strokeStyle = b.stroke || b.color || '#ecd08e';
        ctx.lineWidth = Math.max(1.2, 2 / zoom);
        ctx.stroke();
      }
    }

    // Pulse marker
    if (hl.pulse) {
      const px = hl.pulse.x ?? (hl.pulse.cell >= 0 ? cxArr[hl.pulse.cell] : null);
      let py = hl.pulse.y ?? (hl.pulse.cell >= 0 ? cyArr[hl.pulse.cell] : null);
      if (px != null && py != null) {
        if (is25D && hl.pulse.cell >= 0 && w.elev) py -= elevLiftKm(w.elev[hl.pulse.cell]);
        ctx.beginPath();
        ctx.arc(px, py, 24 / Math.max(0.2, zoom), 0, Math.PI * 2);
        ctx.strokeStyle = hl.pulse.color || '#ffe59c';
        ctx.lineWidth = 2.5 / zoom;
        ctx.stroke();
      }
    }
  }

  // 2. Selected Province outline (3-layer glowing highlight using pre-split provBorderByProv)
  if (state.selectedState != null && state.mode !== 'city' && w.provBorderByProv?.[state.selectedState]) {
    const sIdx = state.selectedState;
    const col = provinceColor(sIdx);
    const edges = w.provBorderByProv[sIdx];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let k = 0; k < edges.length; k += 2) {
      const ci = edges[k];
      const x = cxArr[ci];
      const y = cyArr[ci];
      if (x < vx0 || x > vx1 || y < vy0 || y > vy1) continue;
      const lift = is25D && w.elev ? elevLiftKm(w.elev[ci]) : 0;
      const d = edges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      ctx.moveTo(x + corners[k1][0], y - lift + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y - lift + corners[k2][1]);
    }

    ctx.strokeStyle = rgba(col, 0.34);
    ctx.lineWidth = Math.max(8.5, 13.0 / zoom);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 214, 112, 0.80)';
    ctx.lineWidth = Math.max(4.2, 6.4 / zoom);
    ctx.stroke();

    ctx.strokeStyle = '#fff6d8';
    ctx.lineWidth = Math.max(2.0, 3.0 / zoom);
    ctx.stroke();
  }

  // 3. Selected City footprint (batched)
  if (state.selectedCity) {
    const city = state.selectedCity;
    const fp = Array.isArray(city.footprint) && city.footprint.length ? city.footprint : city.cell >= 0 ? [city.cell] : [];
    if (fp.length) {
      ctx.fillStyle = 'rgba(236, 208, 142, 0.18)';
      ctx.strokeStyle = '#ffe59c';
      ctx.lineWidth = Math.max(1.5, 2.5 / zoom);
      ctx.beginPath();
      for (const ci of fp) {
        if (ci < 0 || ci >= w.N) continue;
        const lift = is25D && w.elev ? elevLiftKm(w.elev[ci]) : 0;
        traceHexSubpath(ctx, cxArr[ci], cyArr[ci] - lift, corners, 0.96);
      }
      ctx.fill();
      ctx.stroke();
    }
  }

  // 4. Hover cell outline
  const hc = state.hoverCell;
  if (hc >= 0 && hc < w.N && w.owner[hc] >= -1) {
    const hLift = is25D && w.owner[hc] >= 0 && w.elev ? elevLiftKm(w.elev[hc]) : 0;
    strokeHex(ctx, cxArr[hc], cyArr[hc] - hLift, corners, 0.98);
    ctx.fillStyle = 'rgba(255, 244, 210, 0.12)';
    ctx.fill();
    ctx.strokeStyle = w.owner[hc] >= 0 ? 'rgba(255, 232, 166, 0.9)' : 'rgba(130, 195, 235, 0.45)';
    ctx.lineWidth = Math.max(1.2, 2.0 / zoom);
    ctx.stroke();
  }

  ctx.restore(); // back to screen CSS pixels

  // 5. External overlays (order <= 40 before banners, order > 40 after banners)
  const ordered = [...externalOverlays].sort((a, b) => (a.order || 0) - (b.order || 0));
  const utils = { provinceColor, rgba, strokeHex };

  for (const ov of ordered) {
    if ((ov.order || 0) <= 40 && typeof ov.draw === 'function') {
      try {
        ctx.save();
        ov.draw(ctx, w, cam, state, utils);
        ctx.restore();
      } catch (err) {
        console.error(`[overlay:${ov.id}]`, err);
      }
    }
  }

  // 6. Crisp Screen-Space City Banners
  const hitBanners = drawCityBanners(ctx, w, cam, state, data);

  // 6.5 400mm Isohyet callout pills (placed after banners with collision avoidance)
  drawIsohyet400Labels(ctx, w, cam, state, hitBanners);

  for (const ov of ordered) {
    if ((ov.order || 0) > 40 && typeof ov.draw === 'function') {
      try {
        ctx.save();
        ov.draw(ctx, w, cam, state, utils);
        ctx.restore();
      } catch (err) {
        console.error(`[overlay:${ov.id}]`, err);
      }
    }
  }

  ctx.restore();
  return hitBanners;
}
