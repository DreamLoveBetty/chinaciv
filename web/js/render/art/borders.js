// Provincial color border ribbons, dashed frontier seams, national borders, and coastal glow

import { EDGE_CORNERS } from '../../world.js?v=20261127-5';
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

function traceProvEdges(ctx, provBorderEdges, cxArr, cyArr, corners, x0, y0, x1, y1) {
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
  const invZ = 1 / Math.max(0.24, zoom);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Coastal soft foam
  if (seaCoastEdges && seaCoastEdges.length) {
    ctx.strokeStyle = 'rgba(130, 198, 238, 0.28)';
    ctx.lineWidth = Math.max(3.5, 6.2 * invZ);
    traceEdgePairs(ctx, seaCoastEdges, cxArr, cyArr, corners, 1.0, x0, y0, x1, y1);
    ctx.stroke();
  }

  // 2. Provincial color bevel ribbons + dashed territory seam
  if (provBorderByProv) {
    ctx.lineWidth = Math.max(2.6, 5.0 * invZ);
    const ribbonAlpha = isLensMode ? 0.36 : 0.54;
    for (let p = 0; p < provBorderByProv.length; p++) {
      const sb = w.stateBounds?.[p];
      if (sb && (sb.x1 < x0 || sb.x0 > x1 || sb.y1 < y0 || sb.y0 > y1)) continue;
      const list = provBorderByProv[p];
      if (!list || !list.length) continue;
      ctx.strokeStyle = rgba(provinceColor(p), ribbonAlpha);
      traceEdgePairs(ctx, list, cxArr, cyArr, corners, 0.90, x0, y0, x1, y1);
      ctx.stroke();
    }

    traceProvEdges(ctx, provBorderEdges, cxArr, cyArr, corners, x0, y0, x1, y1);

    // Dark outer seam backing
    ctx.strokeStyle = 'rgba(16, 22, 30, 0.54)';
    ctx.lineWidth = Math.max(1.1, 1.85 * invZ);
    ctx.stroke();

    // Antique ivory-gold frontier stitch
    ctx.strokeStyle = isLensMode ? 'rgba(244, 230, 196, 0.45)' : 'rgba(246, 224, 174, 0.78)';
    ctx.lineWidth = Math.max(0.65, 1.05 * invZ);
    if (zoom >= 0.45) {
      ctx.setLineDash([Math.max(1.8, 4.2 * invZ), Math.max(1.5, 3.2 * invZ)]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.stroke();
    }
  }

  // 3. National border solid antique gold line + sea coast crisp rim
  if (landBorderEdges && landBorderEdges.length) {
    traceEdgePairs(ctx, landBorderEdges, cxArr, cyArr, corners, 1.0, x0, y0, x1, y1);
    ctx.strokeStyle = 'rgba(16, 22, 30, 0.58)';
    ctx.lineWidth = Math.max(2.1, 3.4 * invZ);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(235, 196, 116, 0.92)';
    ctx.lineWidth = Math.max(1.3, 2.2 * invZ);
    ctx.stroke();
  }

  if (seaCoastEdges && seaCoastEdges.length) {
    ctx.strokeStyle = 'rgba(138, 206, 240, 0.78)';
    ctx.lineWidth = Math.max(1.1, 1.8 * invZ);
    traceEdgePairs(ctx, seaCoastEdges, cxArr, cyArr, corners, 1.0, x0, y0, x1, y1);
    ctx.stroke();
  }

  ctx.restore();
}
