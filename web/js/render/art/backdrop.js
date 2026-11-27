// Renders extended Eurasia-Pacific 25km hexagonal backdrop (terrain, coastal shelves, rivers, lakes)

import { FOREIGN_SHADES } from '../../terrain.js?v=20261128-4';

function tracePolyline(path, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
    const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  path.lineTo(last[0], last[1]);
}

/**
 * Decode RLE backdrop grid, patch seam ocean cells on world.json perimeter, and cache Path2D water.
 */
export function prepareBackdrop(raw, w) {
  if (!raw || !w) return null;
  const cols = raw.cols | 0;
  const rows = raw.rows | 0;
  const c0 = raw.c0 | 0;
  const r0 = raw.r0 | 0;
  const total = cols * rows;
  const cells = new Uint8Array(total);

  const rle = raw.cell_rle;
  if (Array.isArray(rle)) {
    let off = 0;
    for (let i = 0; i < rle.length; i += 2) {
      const val = rle[i] & 255;
      const cnt = rle[i + 1] | 0;
      const end = Math.min(total, off + cnt);
      cells.fill(val, off, end);
      off = end;
    }
  }

  // Seamlessly light up coastal shelf on boundary ocean cells of world.json facing exterior land
  if (Array.isArray(raw.edge_coast_cells) && w.isCoast) {
    for (let k = 0; k < raw.edge_coast_cells.length; k++) {
      const ci = raw.edge_coast_cells[k];
      if (ci >= 0 && ci < w.N) w.isCoast[ci] = 1;
    }
    w._terrainColorHex = null;
  }

  let riversPath = null;
  if (Array.isArray(raw.rivers) && raw.rivers.length) {
    const rp = new Path2D();
    for (let i = 0; i < raw.rivers.length; i++) {
      tracePolyline(rp, raw.rivers[i]);
    }
    riversPath = rp;
  }

  let lakesPath = null;
  if (Array.isArray(raw.lakes) && raw.lakes.length) {
    const lp = new Path2D();
    for (let i = 0; i < raw.lakes.length; i++) {
      const ring = raw.lakes[i];
      if (!Array.isArray(ring) || ring.length < 3) continue;
      lp.moveTo(ring[0][0], ring[0][1]);
      for (let k = 1; k < ring.length; k++) {
        lp.lineTo(ring[k][0], ring[k][1]);
      }
      lp.closePath();
    }
    lakesPath = lp;
  }

  const bk = Array.isArray(raw.bounds_km) && raw.bounds_km.length === 4 ? raw.bounds_km : null;
  const padInset = 90;
  const worldBounds = bk
    ? { x0: bk[0] + padInset, y0: bk[1] + padInset, x1: bk[2] - padInset, y1: bk[3] - padInset }
    : {
        x0: c0 * w.W + padInset,
        y0: r0 * w.H_step + padInset,
        x1: (c0 + cols) * w.W - padInset,
        y1: (r0 + rows) * w.H_step - padInset,
      };

  return {
    c0,
    r0,
    cols,
    rows,
    cells,
    riversPath,
    lakesPath,
    worldBounds,
  };
}

/**
 * Draw seamless surrounding land + coastal shelf hexes via horizontal union span polygons.
 * Matches FOREIGN_SHADES & OCEAN_SHALLOW_HEX from terrain.js identically.
 */
export function drawBackdropHexes(ctx, w, backdrop, bounds, zoom) {
  if (!backdrop || !bounds) return;
  const { c0, r0, cols, rows, cells } = backdrop;
  const { W, H_step, R, cols: wCols, rows: wRows } = w;

  const gr0 = Math.max(0, Math.floor((bounds.y0 - R * 1.5) / H_step) - r0);
  const gr1 = Math.min(rows - 1, Math.ceil((bounds.y1 + R * 1.5) / H_step) - r0);
  const gc0 = Math.max(0, Math.floor((bounds.x0 - W * 1.5) / W) - c0);
  const gc1 = Math.min(cols - 1, Math.ceil((bounds.x1 + W * 1.5) / W) - c0);
  if (gr0 > gr1 || gc0 > gc1) return;

  // Palette values: 1 -> shallow coast '#17456e', 2..5 -> FOREIGN_SHADES[0..3]
  const palette = [null, '#17456e', FOREIGN_SHADES[0], FOREIGN_SHADES[1], FOREIGN_SHADES[2], FOREIGN_SHADES[3]];
  const runsByVal = [[], [], [], [], [], []];

  const iwStart = 0 - c0;
  const iwEnd = wCols - c0; // exclusive inside [0..wCols)
  const irStart = 0 - r0;
  const irEnd = wRows - r0;

  for (let rr = gr0; rr <= gr1; rr++) {
    const rowOff = rr * cols;
    const isWorldRow = rr >= irStart && rr < irEnd;
    let c = gc0;
    while (c <= gc1) {
      if (isWorldRow && c >= iwStart && c < iwEnd) {
        c = iwEnd;
        continue;
      }
      const val = cells[rowOff + c];
      if (val === 0) {
        c++;
        continue;
      }
      const startC = c;
      c++;
      while (c <= gc1 && !(isWorldRow && c >= iwStart && c < iwEnd) && cells[rowOff + c] === val) {
        c++;
      }
      runsByVal[val].push(rr, startC, c - startC);
    }
  }

  const hw = W * 0.509;
  const yHalf = R * 0.509;
  const yTip = R * 1.018;

  ctx.save();
  for (let val = 1; val <= 5; val++) {
    const list = runsByVal[val];
    if (!list.length) continue;
    ctx.fillStyle = palette[val];

    let vertCount = 0;
    ctx.beginPath();
    for (let k = 0; k < list.length; k += 3) {
      const rr = list[k];
      const sc = list[k + 1];
      const len = list[k + 2];
      const absR = rr + r0;
      const absC = sc + c0;
      const cy = absR * H_step;
      const xStart = (absC + (absR & 1) * 0.5) * W;

      const yTopMid = cy - yHalf;
      const yTopTip = cy - yTip;
      const yBotMid = cy + yHalf;
      const yBotTip = cy + yTip;

      ctx.moveTo(xStart - hw, yTopMid);
      for (let m = 0; m < len; m++) {
        const xm = xStart + m * W;
        ctx.lineTo(xm, yTopTip);
        ctx.lineTo(xm + hw, yTopMid);
      }
      ctx.lineTo(xStart + (len - 1) * W + hw, yBotMid);
      for (let m = len - 1; m >= 0; m--) {
        const xm = xStart + m * W;
        ctx.lineTo(xm, yBotTip);
        ctx.lineTo(xm - hw, yBotMid);
      }
      ctx.closePath();

      vertCount += 2 + len * 4;
      if (vertCount >= 2200) {
        ctx.fill();
        ctx.beginPath();
        vertCount = 0;
      }
    }
    if (vertCount > 0) ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw muted Natural Earth 10m lakes and rivers across surrounding Eurasia-Pacific land.
 */
export function drawBackdropWater(ctx, backdrop, zoom) {
  if (!backdrop) return;
  ctx.save();

  if (backdrop.lakesPath) {
    ctx.fillStyle = '#15476e';
    ctx.strokeStyle = 'rgba(84, 152, 198, 0.72)';
    ctx.lineWidth = Math.max(0.7, 1.1 / zoom);
    ctx.fill(backdrop.lakesPath);
    ctx.stroke(backdrop.lakesPath);
  }

  if (backdrop.riversPath) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = 'rgba(11, 34, 56, 0.50)';
    ctx.lineWidth = Math.max(1.7, 3.4 / zoom);
    ctx.stroke(backdrop.riversPath);

    ctx.strokeStyle = 'rgba(54, 130, 182, 0.78)';
    ctx.lineWidth = Math.max(1.0, 2.0 / zoom);
    ctx.stroke(backdrop.riversPath);
  }

  ctx.restore();
}
