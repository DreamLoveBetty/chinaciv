// Shared numerical, color ramp, scale, Pearson correlation, and DOM helpers for Advisors & Explorer.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

export function el(tag, cls = "", html = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html) node.innerHTML = html;
  return node;
}

export const fin = Number.isFinite;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ratio = (a, b) => (fin(a) && fin(b) && b !== 0 ? a / b : null);
export const sum = (list, f = (x) => x) =>
  list.reduce((acc, item) => {
    const v = f(item);
    return fin(v) ? acc + v : acc;
  }, 0);

let _uid = 0;
export const uid = (prefix = "adv") => `${prefix}-${++_uid}`;

export function quantile(sortedVals, q) {
  if (!sortedVals.length) return null;
  const k = (sortedVals.length - 1) * q;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (k - lo);
}

export function extent(vals, positive = false) {
  let a = Infinity;
  let b = -Infinity;
  for (const v of vals) {
    if (!fin(v) || (positive && v <= 0)) continue;
    if (v < a) a = v;
    if (v > b) b = v;
  }
  return a <= b ? [a, b] : null;
}

export function robustDomain(vals, q = 0.02, positive = false) {
  const s = vals.filter((v) => fin(v) && (!positive || v > 0)).sort((a, b) => a - b);
  if (!s.length) return null;
  let lo = quantile(s, q);
  let hi = quantile(s, 1 - q);
  if (!(hi > lo)) {
    lo = s[0];
    hi = s[s.length - 1];
  }
  if (!(hi > lo)) hi = lo + (Math.abs(lo) * 0.1 || 1);
  return [lo, hi];
}

export function scale(domain, range, { log = false, clampOut = false } = {}) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const t = log ? (v) => (v > 0 ? Math.log10(v) : null) : (v) => v;
  const a = t(d0);
  const b = t(d1);
  const f = (v) => {
    if (!fin(v)) return null;
    const tv = t(v);
    if (tv == null || a == null || b == null) return null;
    let k = b === a ? 0.5 : (tv - a) / (b - a);
    if (clampOut) k = clamp(k, 0, 1);
    return r0 + k * (r1 - r0);
  };
  f.invert = (p) => {
    const k = (p - r0) / (r1 - r0 || 1);
    const tv = a + k * (b - a);
    return log ? 10 ** tv : tv;
  };
  f.domain = domain;
  f.range = range;
  f.log = log;
  return f;
}

export function ticks(d0, d1, n = 5) {
  if (!(d1 > d0)) return [d0];
  const step0 = (d1 - d0) / Math.max(1, n);
  const mag = 10 ** Math.floor(Math.log10(step0));
  const err = step0 / mag;
  const step = mag * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
  const out = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + step * 1e-9; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
  }
  return out;
}

export function logTicks(d0, d1) {
  if (!(d0 > 0) || !(d1 > d0)) return [d0];
  const e0 = Math.floor(Math.log10(d0));
  const e1 = Math.ceil(Math.log10(d1));
  const mult = e1 - e0 <= 2 ? [1, 2, 5] : e1 - e0 <= 4 ? [1, 3] : [1];
  const out = [];
  for (let e = e0; e <= e1; e++) {
    for (const m of mult) {
      const v = m * 10 ** e;
      if (v >= d0 * 0.999 && v <= d1 * 1.001) out.push(v);
    }
  }
  return out.length >= 2 ? out : [d0, d1];
}

export function pad(domain, k = 0.04, log = false) {
  const [a, b] = domain;
  if (log) {
    const f = (b / a) ** k;
    return [a / f, b * f];
  }
  const p = (b - a) * k || Math.abs(a) * 0.1 || 1;
  return [a - p, b + p];
}

export function pearson(xs, ys) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!fin(x) || !fin(y)) continue;
    n++;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  if (n < 3) return { r: null, r2: null, n };
  const dx = n * sxx - sx * sx;
  const dy = n * syy - sy * sy;
  if (dx <= 0 || dy <= 0) return { r: null, r2: null, n };
  const r = clamp((n * sxy - sx * sy) / Math.sqrt(dx * dy), -1, 1);
  return { r, r2: r * r, n };
}

export const RAMPS = {
  seq: ["#2c3e78", "#3d6aa0", "#3e98a8", "#5fbf8e", "#b5d65c", "#f6e05a"],
  gold: ["#4a3416", "#7a5a22", "#b4872f", "#e0b54c", "#f6dc8a", "#fff6d6"],
  div: ["#c2463d", "#e08a6a", "#cfc4ae", "#7dc2b0", "#2e9c8a"],
  heat: ["#3b1f4a", "#7a2c62", "#bb3f5a", "#e8774a", "#f6b94a", "#fbe8a6"],
};

export const CAT_COLORS = [
  "#e0b54c", "#4aa3d8", "#5fbf8e", "#d97559", "#a378d6",
  "#38b4a0", "#e38b3c", "#d65d86", "#8fb84a", "#7d96b8",
];

const hex2rgb = (h) => {
  const clean = h.replace("#", "").replace(/^(.)(.)(.)$/, "$1$1$2$2$3$3");
  const n = parseInt(clean, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

export function rampColor(ramp, t) {
  if (!fin(t)) return "#7d7466";
  const u = clamp(t, 0, 1) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(u));
  const f = u - i;
  const a = hex2rgb(ramp[i]);
  const b = hex2rgb(ramp[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

export function colorScale(domain, ramp = RAMPS.seq, { log = false } = {}) {
  const s = scale(domain, [0, 1], { log, clampOut: true });
  const fn = (v) => {
    const t = s(v);
    return t == null ? "#7d7466" : rampColor(ramp, t);
  };
  fn.domain = domain;
  fn.ramp = ramp;
  fn.log = log;
  return fn;
}

export function withAlpha(hex, alpha = 0.25) {
  if (!hex || !hex.startsWith("#")) return hex || `rgba(201,164,92,${alpha})`;
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
