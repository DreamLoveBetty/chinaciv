// Dynamic 60fps overlay renderer: highlight/brush dimming, selections, hover hex, external overlays, city banners

import { EDGE_CORNERS } from '../world.js';
import { provinceColor, rgba } from '../color.js';
import { drawCityBanners } from './banners.js';

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

function collectHighlightedCells(w, hl, state, data) {
  if (!hl) return null;
  const set = new Set();
  if (hl.cells) {
    for (const c of hl.cells) if (c >= 0 && c < w.N) set.add(c);
  }
  if (hl.counties && w.countyCells) {
    for (const ct of hl.counties) {
      const list = w.countyCells[ct];
      if (list) for (const c of list) set.add(c);
    }
  }
  if (hl.states && w.stateCells) {
    for (const st of hl.states) {
      const list = w.stateCells[st];
      if (list) for (const c of list) set.add(c);
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
  return set;
}

export function drawOverlay(ctx, w, cam, state, data, externalOverlays) {
  const { width, height, dpr, zoom } = cam;
  const { cxArr, cyArr, corners } = w;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Transform into world km coordinates
  const cScreen = cam.viewportCenterScreen();
  ctx.save();
  ctx.translate(cScreen.sx, cScreen.sy);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);

  // 1. Highlight / Brush overlay (Explorer & Advisors)
  const hl = state.highlight;
  if (hl) {
    const hlCells = collectHighlightedCells(w, hl, state, data);
    const shouldDim = hl.dim || hl.dimOthers;
    if (shouldDim) {
      const dimAlpha = typeof shouldDim === 'number' ? shouldDim : 0.56;
      const vb = cam.viewBoundsWorld();
      ctx.fillStyle = `rgba(6, 13, 22, ${dimAlpha})`;
      ctx.fillRect(vb.x0 - 50, vb.y0 - 50, vb.x1 - vb.x0 + 100, vb.y1 - vb.y0 + 100);
    }

    if (hlCells && hlCells.size > 0) {
      const hlColor = hl.color || '#ecd08e';
      ctx.fillStyle = rgba(hlColor, hl.fillAlpha ?? 0.34);
      ctx.strokeStyle = hl.border || hlColor;
      ctx.lineWidth = Math.max(1.0, 2.0 / zoom);
      for (const ci of hlCells) {
        strokeHex(ctx, cxArr[ci], cyArr[ci], corners, 0.98);
        ctx.fill();
        ctx.stroke();
      }
    }

    // Proportional bubbles (Advisors)
    if (Array.isArray(hl.bubbles) && hl.bubbles.length) {
      for (const b of hl.bubbles) {
        const bx = b.x ?? (b.cell >= 0 ? cxArr[b.cell] : null);
        const by = b.y ?? (b.cell >= 0 ? cyArr[b.cell] : null);
        if (bx == null || by == null) continue;
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
      const py = hl.pulse.y ?? (hl.pulse.cell >= 0 ? cyArr[hl.pulse.cell] : null);
      if (px != null && py != null) {
        ctx.beginPath();
        ctx.arc(px, py, 24 / Math.max(0.2, zoom), 0, Math.PI * 2);
        ctx.strokeStyle = hl.pulse.color || '#ffe59c';
        ctx.lineWidth = 2.5 / zoom;
        ctx.stroke();
      }
    }
  }

  // 2. Selected Province outline
  if (state.selectedState != null && w.stateCells[state.selectedState]) {
    const sIdx = state.selectedState;
    const col = provinceColor(sIdx);
    const { provBorderEdges } = w;
    ctx.strokeStyle = '#ffe6a3';
    ctx.lineWidth = Math.max(2.2, 3.6 / zoom);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < provBorderEdges.length; k += 3) {
      if (provBorderEdges[k + 2] !== sIdx) continue;
      const ci = provBorderEdges[k];
      const d = provBorderEdges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      const x = cxArr[ci];
      const y = cyArr[ci];
      ctx.moveTo(x + corners[k1][0], y + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y + corners[k2][1]);
    }
    ctx.stroke();

    // Subtle colored aura
    ctx.strokeStyle = rgba(col, 0.55);
    ctx.lineWidth = Math.max(4.5, 7 / zoom);
    ctx.stroke();
  }

  // 3. Selected City footprint
  if (state.selectedCity) {
    const city = state.selectedCity;
    const fp = Array.isArray(city.footprint) && city.footprint.length ? city.footprint : city.cell >= 0 ? [city.cell] : [];
    if (fp.length) {
      ctx.fillStyle = 'rgba(236, 208, 142, 0.18)';
      ctx.strokeStyle = '#ffe59c';
      ctx.lineWidth = Math.max(1.5, 2.5 / zoom);
      for (const ci of fp) {
        if (ci < 0 || ci >= w.N) continue;
        strokeHex(ctx, cxArr[ci], cyArr[ci], corners, 0.96);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // 4. Hover cell outline
  const hc = state.hoverCell;
  if (hc >= 0 && hc < w.N && w.owner[hc] >= -1) {
    strokeHex(ctx, cxArr[hc], cyArr[hc], corners, 0.98);
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
