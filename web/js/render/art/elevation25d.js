// 2.5D extruded hexagonal prism relief renderer, elevated border depth occlusion, and front-to-back picking

import { SQRT3, getNeighbors } from '../../hex.js';
import { EDGE_CORNERS } from '../../world.js?v=20261127-5';

export const TILT_25D = 0.74;
export const BASE_PLINTH_KM = 12;
export const MAX_ELEV_LIFT_KM = 275;

const INV_SQRT3 = 1 / SQRT3;
const CAP_SCALE = 1.018;

export function isElevation25D(state) {
  return state?.lens?.id === 'elevation' && state?.elevation25D !== false;
}

export function elevLiftKm(elev) {
  const clamped = Math.max(-150, Math.min(6500, elev || 0));
  return Math.max(4, BASE_PLINTH_KM + (clamped / 6000) * MAX_ELEV_LIFT_KM);
}

const wallColorCache = new Map();

function quantStep8(v) {
  const q = Math.max(0, Math.min(248, (Math.round(v) + 4) & ~7));
  return q.toString(16).padStart(2, '0');
}

function getWallColors(topHex) {
  let pair = wallColorCache.get(topHex);
  if (pair) return pair;
  const n = parseInt(topHex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;

  // Warm sunlit SW cliff face
  const sw = `#${quantStep8(r * 0.74 + 5)}${quantStep8(g * 0.72 + 2)}${quantStep8(b * 0.69 - 2)}`;
  // Cool slate shadowed SE cliff face
  const se = `#${quantStep8(r * 0.44 + 5)}${quantStep8(g * 0.45 + 9)}${quantStep8(b * 0.49 + 14)}`;

  pair = { sw, se };
  wallColorCache.set(topHex, pair);
  return pair;
}

function dimHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(252, (Math.round(((n >> 16) & 255) * 0.3 + 12) + 2) & ~3));
  const g = Math.max(0, Math.min(252, (Math.round(((n >> 8) & 255) * 0.3 + 16) + 2) & ~3));
  const b = Math.max(0, Math.min(252, (Math.round((n & 255) * 0.3 + 22) + 2) & ~3));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function ensure25DMeta(w) {
  if (w._elev25DMeta) return w._elev25DMeta;
  const { N, cols, rows, owner, elev } = w;

  const swNeighbor = new Int32Array(N).fill(-1);
  const seNeighbor = new Int32Array(N).fill(-1);
  const liftArr = new Float32Array(N);
  const provEdgeMask = new Uint8Array(N);
  const natEdgeMask = new Uint8Array(N);

  const nbrBuf = new Array(6);

  for (let i = 0; i < N; i++) {
    if (owner[i] < 0) continue;
    liftArr[i] = elevLiftKm(elev ? elev[i] : 0);
  }

  for (let i = 0; i < N; i++) {
    const ow = owner[i];
    if (ow < 0) continue;
    getNeighbors(i, cols, rows, nbrBuf);
    seNeighbor[i] = nbrBuf[1];
    swNeighbor[i] = nbrBuf[2];

    let pMask = 0;
    let nMask = 0;
    const hSelf = liftArr[i];
    for (let d = 0; d < 6; d++) {
      const nb = nbrBuf[d];
      const nbOw = nb >= 0 ? owner[nb] : -1;
      if (nbOw < 0) {
        nMask |= 1 << d;
      } else if (nbOw !== ow) {
        const hNb = liftArr[nb];
        // Draw shared boundary rim on the higher cell (or S-facing edge if equal) to prevent double-stroking cliffs
        if (hSelf > hNb || (hSelf === hNb && d <= 2)) {
          pMask |= 1 << d;
        }
      }
    }
    provEdgeMask[i] = pMask;
    natEdgeMask[i] = nMask;
  }

  const meta = { swNeighbor, seNeighbor, liftArr, provEdgeMask, natEdgeMask };
  w._elev25DMeta = meta;
  return meta;
}

function pushBucket(map, key, val) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(val);
}

/**
 * Render extruded 2.5D hex prisms row-by-row (North -> South) so front plateaus
 * and mountain ridges naturally occlude valleys and borders behind them.
 */
export function drawElevation25D(ctx, w, colorizer, activeBand, dimExceptState, zoom, bounds) {
  const { cols, rows, R, W, H_step, corners, cxArr, cyArr, owner } = w;
  const { swNeighbor, seNeighbor, liftArr, provEdgeMask, natEdgeMask } = ensure25DMeta(w);
  const colorArr = colorizer?.colorHexArr;
  if (!colorArr) return;

  const r0 = Math.max(0, Math.floor((bounds.y0 - R * 2.2) / H_step));
  // Extend southward by max prism height so peaks just south of viewport bottom clip still render upward into view
  const r1 = Math.min(rows - 1, Math.ceil((bounds.y1 + 310) / H_step));
  const c0 = Math.max(0, Math.floor((bounds.x0 - W * 1.6) / W));
  const c1 = Math.min(cols - 1, Math.ceil((bounds.x1 + W * 1.6) / W));

  const c0x = corners[0][0] * CAP_SCALE;
  const c0y = corners[0][1] * CAP_SCALE;
  const c1x = corners[1][0] * CAP_SCALE;
  const c1y = corners[1][1] * CAP_SCALE;
  const c2x = corners[2][0] * CAP_SCALE;
  const c2y = corners[2][1] * CAP_SCALE;
  const c3x = corners[3][0] * CAP_SCALE;
  const c3y = corners[3][1] * CAP_SCALE;
  const c4x = corners[4][0] * CAP_SCALE;
  const c4y = corners[4][1] * CAP_SCALE;
  const c5x = corners[5][0] * CAP_SCALE;
  const c5y = corners[5][1] * CAP_SCALE;

  const drawBevels = zoom >= 0.28;
  const dimCache = new Map();

  for (let r = r0; r <= r1; r++) {
    const rowOff = r * cols;
    const swBuckets = new Map();
    const seBuckets = new Map();
    const capBuckets = new Map();
    const rowLand = [];
    const rowProvEdges = [];
    const rowNatEdges = [];
    const rowBandMatch = [];

    for (let c = c0; c <= c1; c++) {
      const i = rowOff + c;
      const ow = owner[i];
      if (ow < 0) continue;

      const baseHex = colorArr[i];
      if (!baseHex) continue;

      let fillHex = baseHex;
      let isDimmed = false;

      if (dimExceptState >= 0 && ow !== dimExceptState) {
        isDimmed = true;
      } else if (activeBand) {
        if (colorizer.matchesBand(i, activeBand)) {
          rowBandMatch.push(i);
        } else {
          isDimmed = true;
        }
      }

      if (isDimmed) {
        let dh = dimCache.get(baseHex);
        if (!dh) {
          dh = dimHex(baseHex);
          dimCache.set(baseHex, dh);
        }
        fillHex = dh;
      }

      const h = liftArr[i];
      const sw = swNeighbor[i];
      const se = seNeighbor[i];
      const hSW = sw >= 0 ? liftArr[sw] : 0;
      const hSE = se >= 0 ? liftArr[se] : 0;
      const walls = getWallColors(fillHex);

      if (h > hSW - 0.5) {
        pushBucket(swBuckets, walls.sw, [i, h, hSW]);
      }
      if (h > hSE - 0.5) {
        pushBucket(seBuckets, walls.se, [i, h, hSE]);
      }
      pushBucket(capBuckets, fillHex, i);
      rowLand.push(i);

      if (provEdgeMask[i]) rowProvEdges.push(i);
      if (natEdgeMask[i]) rowNatEdges.push(i);
    }

    if (!rowLand.length) continue;

    // 1. SW sunlit prism faces
    for (const [col, list] of swBuckets) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let k = 0; k < list.length; k++) {
        const [i, h, hSW] = list[k];
        const cx = cxArr[i];
        const cy = cyArr[i];
        const yTop = cy - h;
        const yBot = cy - Math.max(0, hSW - 2.5);
        ctx.moveTo(cx + c2x, yTop + c2y);
        ctx.lineTo(cx + c1x, yTop + c1y);
        ctx.lineTo(cx + c1x, yBot + c1y);
        ctx.lineTo(cx + c2x, yBot + c2y);
        ctx.closePath();
      }
      ctx.fill();
    }

    // 2. SE shadowed prism faces
    for (const [col, list] of seBuckets) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let k = 0; k < list.length; k++) {
        const [i, h, hSE] = list[k];
        const cx = cxArr[i];
        const cy = cyArr[i];
        const yTop = cy - h;
        const yBot = cy - Math.max(0, hSE - 2.5);
        ctx.moveTo(cx + c1x, yTop + c1y);
        ctx.lineTo(cx + c0x, yTop + c0y);
        ctx.lineTo(cx + c0x, yBot + c0y);
        ctx.lineTo(cx + c1x, yBot + c1y);
        ctx.closePath();
      }
      ctx.fill();
    }

    // 3. Elevated hex top caps
    for (const [col, list] of capBuckets) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const cx = cxArr[i];
        const topY = cyArr[i] - liftArr[i];
        ctx.moveTo(cx + c0x, topY + c0y);
        ctx.lineTo(cx + c1x, topY + c1y);
        ctx.lineTo(cx + c2x, topY + c2y);
        ctx.lineTo(cx + c3x, topY + c3y);
        ctx.lineTo(cx + c4x, topY + c4y);
        ctx.lineTo(cx + c5x, topY + c5y);
        ctx.closePath();
      }
      ctx.fill();
    }

    // 4. Crisp northern bevel catchlight on elevated caps
    if (drawBevels) {
      ctx.strokeStyle = 'rgba(255, 250, 232, 0.14)';
      ctx.lineWidth = Math.max(0.55, 0.9 / Math.max(0.25, zoom));
      ctx.beginPath();
      for (let k = 0; k < rowLand.length; k++) {
        const i = rowLand[k];
        const cx = cxArr[i];
        const topY = cyArr[i] - liftArr[i];
        ctx.moveTo(cx + c2x, topY + c2y);
        ctx.lineTo(cx + c3x, topY + c3y);
        ctx.lineTo(cx + c4x, topY + c4y);
        ctx.lineTo(cx + c5x, topY + c5y);
      }
      ctx.stroke();
    }

    // 5. Depth-occluded provincial border rims on top of prisms
    if (rowProvEdges.length) {
      ctx.strokeStyle = 'rgba(245, 234, 200, 0.36)';
      ctx.lineWidth = Math.max(0.85, 1.25 / Math.max(0.25, zoom));
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < rowProvEdges.length; k++) {
        const i = rowProvEdges[k];
        const mask = provEdgeMask[i];
        const cx = cxArr[i];
        const topY = cyArr[i] - liftArr[i];
        for (let d = 0; d < 6; d++) {
          if (!(mask & (1 << d))) continue;
          const [k1, k2] = EDGE_CORNERS[d];
          ctx.moveTo(cx + corners[k1][0], topY + corners[k1][1]);
          ctx.lineTo(cx + corners[k2][0], topY + corners[k2][1]);
        }
      }
      ctx.stroke();
    }

    // 6. Depth-occluded national land borders & coastal rim
    if (rowNatEdges.length) {
      ctx.strokeStyle = 'rgba(236, 204, 130, 0.85)';
      ctx.lineWidth = Math.max(1.3, 2.2 / Math.max(0.25, zoom));
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k < rowNatEdges.length; k++) {
        const i = rowNatEdges[k];
        const mask = natEdgeMask[i];
        const cx = cxArr[i];
        const topY = cyArr[i] - liftArr[i];
        for (let d = 0; d < 6; d++) {
          if (!(mask & (1 << d))) continue;
          const [k1, k2] = EDGE_CORNERS[d];
          ctx.moveTo(cx + corners[k1][0], topY + corners[k1][1]);
          ctx.lineTo(cx + corners[k2][0], topY + corners[k2][1]);
        }
      }
      ctx.stroke();
    }

    // 7. Highlighted elevation legend band outline
    if (rowBandMatch.length) {
      ctx.strokeStyle = 'rgba(255, 232, 166, 0.78)';
      ctx.lineWidth = Math.max(1.0, 1.8 / zoom);
      ctx.beginPath();
      for (let k = 0; k < rowBandMatch.length; k++) {
        const i = rowBandMatch[k];
        const cx = cxArr[i];
        const topY = cyArr[i] - liftArr[i];
        ctx.moveTo(cx + corners[0][0] * 0.96, topY + corners[0][1] * 0.96);
        for (let v = 1; v < 6; v++) {
          ctx.lineTo(cx + corners[v][0] * 0.96, topY + corners[v][1] * 0.96);
        }
        ctx.closePath();
      }
      ctx.stroke();
    }
  }
}

/**
 * Exact front-to-back (South -> North) 2.5D hit-test against elevated caps and front cliff walls.
 */
export function pickCell25D(w, wx, wy) {
  if (!w) return -1;
  const { cols, rows, R, W, H_step, cxArr, cyArr, owner } = w;
  const { liftArr, swNeighbor, seNeighbor } = ensure25DMeta(w);

  const rEnd = Math.min(rows - 1, Math.ceil((wy + 310) / H_step));
  const rStart = Math.max(0, Math.floor((wy - R * 1.1) / H_step));
  const halfW = W * 0.505;
  const rLim = R * 1.005;

  for (let r = rEnd; r >= rStart; r--) {
    const rowOff = r * cols;
    const cApprox = Math.round(wx / W - (r & 1) * 0.5);
    const cLo = Math.max(0, cApprox - 1);
    const cHi = Math.min(cols - 1, cApprox + 1);

    for (let c = cLo; c <= cHi; c++) {
      const i = rowOff + c;
      if (owner[i] < 0) continue;

      const cx = cxArr[i];
      const adx = Math.abs(wx - cx);
      if (adx > halfW) continue;

      const cy = cyArr[i];
      const h = liftArr[i];
      const topCy = cy - h;

      // 1. Check top pointy-top hex cap at (cx, cy - h)
      const ady = Math.abs(wy - topCy);
      if (ady + adx * INV_SQRT3 <= rLim) {
        return i;
      }

      // 2. Check visible SW / SE front cliff face below cap
      const frontYEdge = topCy + R - adx * INV_SQRT3;
      if (wy >= frontYEdge) {
        const nb = wx < cx ? swNeighbor[i] : seNeighbor[i];
        const hNb = nb >= 0 ? liftArr[nb] : 0;
        const botYEdge = cy - hNb + R - adx * INV_SQRT3;
        if (wy <= botYEdge) {
          return i;
        }
      }
    }
  }

  return w.cellAt(wx, wy);
}
