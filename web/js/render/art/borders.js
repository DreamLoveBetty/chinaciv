// Provincial color border ribbons, national borders, and coastal glow

import { EDGE_CORNERS } from '../../world.js';
import { provinceColor, rgba } from '../../color.js';

/**
 * Draw crisp provincial color border ribbons and national/coastal borders using precomputed edge arrays.
 */
export function drawBorders(ctx, w, zoom, isLensMode) {
  const { cxArr, cyArr, corners, provBorderEdges, natBorderEdges } = w;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Coastal & National land border glow
  if (natBorderEdges && natBorderEdges.length) {
    // Sea coast soft foam
    ctx.strokeStyle = 'rgba(130, 198, 238, 0.25)';
    ctx.lineWidth = Math.max(3.5, 6.0 / Math.max(0.22, zoom));
    ctx.beginPath();
    for (let k = 0; k < natBorderEdges.length; k += 3) {
      if (natBorderEdges[k + 2] !== 0) continue; // sea only
      const ci = natBorderEdges[k];
      const d = natBorderEdges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      const x = cxArr[ci];
      const y = cyArr[ci];
      ctx.moveTo(x + corners[k1][0], y + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y + corners[k2][1]);
    }
    ctx.stroke();
  }

  // 2. Provincial color ribbons (grouped by province to batch stroke calls)
  if (provBorderEdges && provBorderEdges.length) {
    const byProv = Array.from({ length: 34 }, () => []);
    for (let k = 0; k < provBorderEdges.length; k += 3) {
      const p = provBorderEdges[k + 2];
      if (p >= 0 && p < 34) {
        byProv[p].push(provBorderEdges[k], provBorderEdges[k + 1]);
      }
    }

    // Soft colored interior border ribbon
    ctx.lineWidth = Math.max(2.4, 4.4 / Math.max(0.25, zoom));
    for (let p = 0; p < 34; p++) {
      const list = byProv[p];
      if (!list.length) continue;
      ctx.strokeStyle = rgba(provinceColor(p), isLensMode ? 0.34 : 0.46);
      ctx.beginPath();
      for (let j = 0; j < list.length; j += 2) {
        const ci = list[j];
        const d = list[j + 1];
        const [k1, k2] = EDGE_CORNERS[d];
        const x = cxArr[ci];
        const y = cyArr[ci];
        // Pull vertices 8% toward center so ribbon stays slightly inside province side
        ctx.moveTo(x + corners[k1][0] * 0.91, y + corners[k1][1] * 0.91);
        ctx.lineTo(x + corners[k2][0] * 0.91, y + corners[k2][1] * 0.91);
      }
      ctx.stroke();
    }

    // Crisp inner hairline divider
    ctx.strokeStyle = isLensMode ? 'rgba(240, 226, 190, 0.38)' : 'rgba(236, 208, 142, 0.36)';
    ctx.lineWidth = Math.max(0.8, 1.15 / Math.max(0.25, zoom));
    ctx.beginPath();
    for (let k = 0; k < provBorderEdges.length; k += 3) {
      const ci = provBorderEdges[k];
      const d = provBorderEdges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      const x = cxArr[ci];
      const y = cyArr[ci];
      ctx.moveTo(x + corners[k1][0], y + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y + corners[k2][1]);
    }
    ctx.stroke();
  }

  // 3. National border solid antique gold line
  if (natBorderEdges && natBorderEdges.length) {
    // Land border
    ctx.strokeStyle = 'rgba(229, 191, 114, 0.85)';
    ctx.lineWidth = Math.max(1.4, 2.5 / Math.max(0.25, zoom));
    ctx.beginPath();
    for (let k = 0; k < natBorderEdges.length; k += 3) {
      if (natBorderEdges[k + 2] !== 1) continue;
      const ci = natBorderEdges[k];
      const d = natBorderEdges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      const x = cxArr[ci];
      const y = cyArr[ci];
      ctx.moveTo(x + corners[k1][0], y + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y + corners[k2][1]);
    }
    ctx.stroke();

    // Sea coast crisp rim
    ctx.strokeStyle = 'rgba(130, 198, 232, 0.72)';
    ctx.lineWidth = Math.max(1.1, 1.8 / Math.max(0.25, zoom));
    ctx.beginPath();
    for (let k = 0; k < natBorderEdges.length; k += 3) {
      if (natBorderEdges[k + 2] !== 0) continue;
      const ci = natBorderEdges[k];
      const d = natBorderEdges[k + 1];
      const [k1, k2] = EDGE_CORNERS[d];
      const x = cxArr[ci];
      const y = cyArr[ci];
      ctx.moveTo(x + corners[k1][0], y + corners[k1][1]);
      ctx.lineTo(x + corners[k2][0], y + corners[k2][1]);
    }
    ctx.stroke();
  }

  ctx.restore();
}
