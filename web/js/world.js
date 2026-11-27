// World grid preparation, lookup indices, boundary edges, and spatial helpers

import { SQRT3, cellX, cellY, cellAt as hexCellAt, getNeighbors, hexCornerOffsets, hexDistance } from './hex.js';
import { provinceColor } from './color.js';

// Edge corner pairs [k1, k2] matching neighbor dirs d=0..5 (E, SE, SW, W, NW, NE)
export const EDGE_CORNERS = [
  [5, 0],
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
];

function toTypedInt16(arr, len, fill = -1) {
  const out = new Int16Array(len);
  if (arr && arr.length) {
    for (let i = 0; i < len; i++) out[i] = arr[i] ?? fill;
  } else {
    out.fill(fill);
  }
  return out;
}

function toTypedUint8(arr, len, fill = 0) {
  const out = new Uint8Array(len);
  if (arr && arr.length) {
    for (let i = 0; i < len; i++) out[i] = arr[i] ?? fill;
  } else {
    out.fill(fill);
  }
  return out;
}

function toTypedFloat32(arr, len, fill = 0) {
  const out = new Float32Array(len);
  if (arr && arr.length) {
    for (let i = 0; i < len; i++) out[i] = arr[i] ?? fill;
  } else {
    out.fill(fill);
  }
  return out;
}

export function prepareWorld(raw, geoLookup = null) {
  const grid = raw.grid || {};
  const cols = grid.cols || raw.cols;
  const rows = grid.rows || raw.rows;
  const R = grid.R || 25.0 / SQRT3;
  const W = grid.W || SQRT3 * R;
  const H_step = grid.H_step || 1.5 * R;
  const width_km = grid.width_km || (cols + 0.5) * W;
  const height_km = grid.height_km || rows * H_step + R;
  const N = cols * rows;

  const owner = toTypedInt16(raw.owner, N, -1);
  const county = toTypedInt16(raw.county, N, -1);
  const cover = toTypedUint8(raw.cover, N, 0);
  const relief = toTypedUint8(raw.relief, N, 0);
  const elev = toTypedFloat32(raw.elev, N, 0);
  const elev_max = toTypedFloat32(raw.elev_max, N, 0);
  const precip = toTypedFloat32(raw.precip, N, 0);

  // Determine pct scale (0..1 vs 0..100)
  let pctScale = 1;
  if (raw.pct) {
    let maxSeen = 0;
    const sampleArr = raw.pct.forest || raw.pct.crop || raw.pct.developed;
    if (sampleArr) {
      for (let i = 0; i < sampleArr.length && i < N; i += 7) {
        if (sampleArr[i] > maxSeen) maxSeen = sampleArr[i];
      }
      pctScale = maxSeen > 1.05 ? 0.01 : 1;
    }
  }

  // Precompute center coordinates
  const cxArr = new Float32Array(N);
  const cyArr = new Float32Array(N);
  for (let r = 0; r < rows; r++) {
    const y = cellY(r, H_step);
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      cxArr[rowOff + c] = cellX(c, r, W);
      cyArr[rowOff + c] = y;
    }
  }

  // Precompute hillshade NW/W neighbors, coastal ocean mask, stateCells, countyCells
  const nwNeighbor = new Int32Array(N).fill(-1);
  const wNeighbor = new Int32Array(N).fill(-1);
  const isCoast = new Uint8Array(N);

  const statesMeta = Array.isArray(raw.states) ? raw.states : [];
  const nStates = Math.max(34, statesMeta.length);
  const stateCells = Array.from({ length: nStates }, () => []);

  const countiesMeta = Array.isArray(raw.counties)
    ? raw.counties
    : Array.isArray(geoLookup?.counties)
      ? geoLookup.counties
      : [];
  const nCounties = Math.max(1302, countiesMeta.length);
  const countyCells = Array.from({ length: nCounties }, () => []);

  const stateBounds = Array.from({ length: nStates }, () => ({
    x0: Infinity,
    y0: Infinity,
    x1: -Infinity,
    y1: -Infinity,
    sumX: 0,
    sumY: 0,
    count: 0,
  }));

  let chinaX0 = Infinity;
  let chinaY0 = Infinity;
  let chinaX1 = -Infinity;
  let chinaY1 = -Infinity;

  const nbrBuf = new Array(6);
  const provBorderEdges = []; // [cellIdx, dir, provIdx]
  const natBorderEdges = [];  // [cellIdx, dir, isLandBorder]

  for (let i = 0; i < N; i++) {
    getNeighbors(i, cols, rows, nbrBuf);
    wNeighbor[i] = nbrBuf[3];
    nwNeighbor[i] = nbrBuf[4];

    const ow = owner[i];
    if (ow === -1) {
      // Check if adjacent to land for coastal shelf tinting
      for (let d = 0; d < 6; d++) {
        const nb = nbrBuf[d];
        if (nb >= 0 && owner[nb] !== -1) {
          isCoast[i] = 1;
          break;
        }
      }
      continue;
    }

    if (ow >= 0 && ow < nStates) {
      stateCells[ow].push(i);
      const x = cxArr[i];
      const y = cyArr[i];
      if (x < chinaX0) chinaX0 = x;
      if (y < chinaY0) chinaY0 = y;
      if (x > chinaX1) chinaX1 = x;
      if (y > chinaY1) chinaY1 = y;

      const sb = stateBounds[ow];
      if (x < sb.x0) sb.x0 = x;
      if (y < sb.y0) sb.y0 = y;
      if (x > sb.x1) sb.x1 = x;
      if (y > sb.y1) sb.y1 = y;
      sb.sumX += x;
      sb.sumY += y;
      sb.count++;

      const ct = county[i];
      if (ct >= 0 && ct < nCounties) {
        countyCells[ct].push(i);
      }

      // Collect boundary edges for fast static border & ribbon rendering
      for (let d = 0; d < 6; d++) {
        const nb = nbrBuf[d];
        const nbOwner = nb >= 0 ? owner[nb] : -1;
        if (nbOwner !== ow) {
          provBorderEdges.push(i, d, ow);
        }
        if (nbOwner < 0) {
          natBorderEdges.push(i, d, nbOwner === -2 ? 1 : 0);
        }
      }
    }
  }

  // Merge geo_lookup county->cells if any tiny county shared a hex with another
  if (Array.isArray(geoLookup?.counties)) {
    for (let k = 0; k < geoLookup.counties.length && k < nCounties; k++) {
      const entry = geoLookup.counties[k];
      if (countyCells[k].length === 0 && Array.isArray(entry?.cells) && entry.cells.length) {
        countyCells[k] = entry.cells.slice();
      }
    }
  }

  // Compute state label anchors (prefer interior cell closest to centroid, or provided x/y)
  for (let s = 0; s < nStates; s++) {
    const sb = stateBounds[s];
    if (sb.count > 0) {
      sb.cx = sb.sumX / sb.count;
      sb.cy = sb.sumY / sb.count;
      sb.x0 -= R;
      sb.y0 -= R;
      sb.x1 += R;
      sb.y1 += R;
      // Snap label point to nearest cell owned by this province so weirdly shaped provinces stay inside
      const cells = stateCells[s];
      let best = cells[0];
      let bestD2 = Infinity;
      for (let k = 0; k < cells.length; k++) {
        const ci = cells[k];
        const dx = cxArr[ci] - sb.cx;
        const dy = cyArr[ci] - sb.cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = ci;
        }
      }
      sb.labelX = cxArr[best];
      sb.labelY = cyArr[best];
      sb.labelCell = best;
    } else {
      sb.x0 = 0;
      sb.y0 = 0;
      sb.x1 = width_km;
      sb.y1 = height_km;
      sb.cx = width_km * 0.5;
      sb.cy = height_km * 0.5;
      sb.labelX = sb.cx;
      sb.labelY = sb.cy;
    }
  }

  if (!Number.isFinite(chinaX0)) {
    chinaX0 = 150;
    chinaY0 = 150;
    chinaX1 = width_km - 150;
    chinaY1 = height_km - 150;
  } else {
    chinaX0 -= R * 2;
    chinaY0 -= R * 2;
    chinaX1 += R * 2;
    chinaY1 += R * 2;
  }

  const corners = hexCornerOffsets(R);

  // Pre-split national/coast and per-province border edge arrays for zero-alloc rendering
  const byProvLists = Array.from({ length: nStates }, () => []);
  for (let k = 0; k < provBorderEdges.length; k += 3) {
    const p = provBorderEdges[k + 2];
    if (p >= 0 && p < nStates) byProvLists[p].push(provBorderEdges[k], provBorderEdges[k + 1]);
  }
  const provBorderByProv = byProvLists.map((arr) => new Int32Array(arr));

  const seaList = [];
  const landList = [];
  for (let k = 0; k < natBorderEdges.length; k += 3) {
    if (natBorderEdges[k + 2] === 0) seaList.push(natBorderEdges[k], natBorderEdges[k + 1]);
    else landList.push(natBorderEdges[k], natBorderEdges[k + 1]);
  }
  const seaCoastEdges = new Int32Array(seaList);
  const landBorderEdges = new Int32Array(landList);

  const w = {
    ...raw,
    grid: { ...grid, cols, rows, R, W, H_step, width_km, height_km },
    cols,
    rows,
    N,
    R,
    W,
    H_step,
    corners,
    owner,
    county,
    cover,
    relief,
    elev,
    elev_max,
    precip,
    isohyet_400: raw.isohyet_400 || null,
    pctScale,
    cxArr,
    cyArr,
    nwNeighbor,
    wNeighbor,
    isCoast,
    states: statesMeta,
    counties: countiesMeta,
    stateCells,
    countyCells,
    stateBounds,
    chinaBounds: { x0: chinaX0, y0: chinaY0, x1: chinaX1, y1: chinaY1 },
    provBorderEdges: new Int32Array(provBorderEdges),
    natBorderEdges: new Int32Array(natBorderEdges),
    provBorderByProv,
    seaCoastEdges,
    landBorderEdges,
    cx(i) {
      return i >= 0 && i < N ? cxArr[i] : 0;
    },
    cy(i) {
      return i >= 0 && i < N ? cyArr[i] : 0;
    },
    col(i) {
      return i % cols;
    },
    row(i) {
      return (i / cols) | 0;
    },
    cellAt(wx, wy) {
      return hexCellAt(wx, wy, cols, rows, R, W);
    },
    neighbors(i) {
      return getNeighbors(i, cols, rows);
    },
    hexDist(i, j) {
      return hexDistance(i, j, cols);
    },
    provinceColor(idx) {
      return provinceColor(idx);
    },
  };

  return w;
}
