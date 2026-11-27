// Pointy-top regular hexagon grid math matching data-geo (scripts/geo_common.py)

export const SQRT3 = Math.sqrt(3);

// Odd-r offset neighbors (d = 0..5: E, SE, SW, W, NW, NE)
export const EVEN_ROW_DIRS = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
];

export const ODD_ROW_DIRS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/**
 * Compute pointy-top regular hexagon vertex offsets relative to hex center.
 * angle = pi/6 + k * pi/3 for k = 0..5.
 */
export function hexCornerOffsets(R) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    pts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return pts;
}

/**
 * Center coordinates for cell index i = r * cols + c.
 */
export function cellX(c, r, W) {
  return (c + (r & 1) * 0.5) * W;
}

export function cellY(r, H_step) {
  return r * H_step;
}

/**
 * O(1) pointy-top odd-r world coordinate -> cell index lookup via axial cube rounding.
 * Returns -1 when outside grid bounds [0..cols-1] x [0..rows-1].
 */
export function cellAt(wx, wy, cols, rows, R, W) {
  const rFrac = wy / (1.5 * R);
  const qFrac = wx / W - rFrac * 0.5;
  const x = qFrac;
  const z = rFrac;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  const r = rz;
  const c = rx + ((rz - (rz & 1)) >> 1);
  if (c < 0 || c >= cols || r < 0 || r >= rows) return -1;
  return r * cols + c;
}

/**
 * Return up to 6 neighbor indices (or -1 for out-of-grid edge).
 */
export function getNeighbors(i, cols, rows, out = null) {
  const r = (i / cols) | 0;
  const c = i - r * cols;
  const dirs = (r & 1) ? ODD_ROW_DIRS : EVEN_ROW_DIRS;
  const res = out || new Array(6);
  for (let d = 0; d < 6; d++) {
    const nc = c + dirs[d][0];
    const nr = r + dirs[d][1];
    res[d] = nc >= 0 && nc < cols && nr >= 0 && nr < rows ? nr * cols + nc : -1;
  }
  return res;
}

/**
 * Offset hex distance between cells i and j.
 */
export function hexDistance(i, j, cols) {
  const r1 = (i / cols) | 0;
  const c1 = i - r1 * cols;
  const q1 = c1 - ((r1 - (r1 & 1)) >> 1);

  const r2 = (j / cols) | 0;
  const c2 = j - r2 * cols;
  const q2 = c2 - ((r2 - (r2 & 1)) >> 1);

  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) >> 1;
}
