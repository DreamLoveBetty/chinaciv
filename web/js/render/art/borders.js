// Provincial color border ribbons, national borders, and coastal glow using pre-indexed edges + viewport culling

import { EDGE_CORNERS } from '../../world.js';
import { provinceColor, rgba } from '../../color.js';

function traceEdgePairs(ctx, edges, cxArr, cyArr, corners, scale, x0, y0, x1, y1) {
  ctx.beginPath();
  for (let k = 0; k < edges.length; k += 2) {
    const ci = edges[k];
    const x = cxArr[ci];
    const y = cyArr[ci];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const d = edges[k + 1];
    const [k1, k2] = EDGE_CORNERS[d];
    ctx.moveTo(x + corners[k1][0] * scale, y + corners[k1][1] * scale);
    ctx.lineTo(x + corners[k2][0] * scale, y + corners[k2][1] * scale);
  }
}

/**
 * Draw crisp provincial color border ribbons and national/coastal borders using precomputed edge arrays.
 */
export function drawBorders(ctx, w, zoom, isLensMode, bounds = null) {
  const { cxArr, cyArr, corners, R, provBorderEdges, provBorderByProv, seaCoastEdges, landBorderEdges } = w;
  const pad = R * 2.2;
  const x0 = bounds ? bounds.x0 - pad : -Infinity;
  const y0 = bounds ? bounds.y0 - pad : -Infinity;
  const x1 = bounds ? bounds.x1 + pad : Infinity;
  const y1 = bounds ? bounds.y1 + pad : Infinity;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Coastal soft foam
  if (seaCoastEdges && seaCoastEdges.length) {
    ctx.strokeStyle = 'rgba(130, 198, 238, 0.25)';
    ctx.lineWidth = Math.max(3.5, 6.0 / Math.max(0.22, zoom));
    traceEdgePairs(ctx, seaCoastEdges, cxArr, cyArr, corners, 1.0, x0, y0, x1, y1);
    ctx.stroke();
  }

  // 2. Provincial color ribbons (pre-grouped by province, no per-bake array allocations)
  if (provBorderByProv) {
    ctx.lineWidth = Math.max(2.4, 4.4 / Math.max(0.25, zoom));
    const ribbonAlpha = isLensMode ? 0.34 : 0.46;
    for (let p = 0; p < provBorderByProv.length; p++) {
      const sb = w.stateBounds?.[p];
      if (sb && (sb.x1 < x0 || sb.x0 > x1 || sb.y1 < y0 || sb.y0 > y1)) continue;
      const list = provBorderByProv[p];
      if (!list || !list.length) continue;
      ctx.strokeStyle = rgba(provinceColor(p), ribbonAlpha);
      traceEdgePairs(ctx, list, cxArr, cyArr, corners, 0.91, x0, y0, x1, y1);
      ctx.stroke();
    }

    // Crisp inner hairline divider
    ctx.strokeStyle = isLensMode ? 'rgba(240, 226, 190, 0.38)' : 'rgba(236, 208, 142, 0.36)';
    ctx.lineWidth = Math.max(0.8, 1.15 / Math.max(0.25, zoom));
    ctx.beginPath();
    for (let k = 0; k < provBorderEdges.length; k += 3) {
      const ci = provBorderEdges[k];
      const x = cxArr[ci];
      const y = cyArr[ci];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const d = provBorderEdges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      ctx.moveTo(x + corners[k1][0], y + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y + corners[k2][1]);
    }
    ctx.stroke();
  }

  // 3. National border solid antique gold line + sea coast crisp rim
  if (landBorderEdges && landBorderEdges.length) {
    ctx.strokeStyle = 'rgba(229, 191, 114, 0.85)';
    ctx.lineWidth = Math.max(1.4, 2.5 / Math.max(0.25, zoom));
    traceEdgePairs(ctx, landBorderEdges, cxArr, cyArr, corners, 1.0, x0, y0, x1, y1);
    ctx.stroke();
  }

  if (seaCoastEdges && seaCoastEdges.length) {
    ctx.strokeStyle = 'rgba(130, 198, 232, 0.72)';
    ctx.lineWidth = Math.max(1.1, 1.8 / Math.max(0.25, zoom));
    traceEdgePairs(ctx, seaCoastEdges, cxArr, cyArr, corners, 1.0, x0, y0, x1, y1);
    ctx.stroke();
  }

  ctx.restore();
}
