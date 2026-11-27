// Color helpers, province heraldic palette, and multi-stop lens ramps

export function hexToRgb(hex) {
  const h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const to2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function lerpRgb(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
  ];
}

export function shadeRgb(rgb, factor, add = 0) {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * factor + add))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * factor + add))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * factor + add))),
  ];
}

export function sampleRamp(stops, t) {
  const u = Math.max(0, Math.min(1, t));
  if (!stops || !stops.length) return [120, 140, 160];
  if (stops.length === 1) return stops[0];
  const pos = u * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(pos));
  return lerpRgb(stops[idx], stops[idx + 1], pos - idx);
}

// Curated 34-province Civilization ribbon palette (distinct, rich yet balanced over dark ocean)
export const PROVINCE_PALETTE = [
  '#d85a4a', // 0 北京 (imperial vermilion)
  '#4ca3b8', // 1 天津 (coastal teal)
  '#d29b4a', // 2 河北 (amber ochre)
  '#9e7356', // 3 山西 (loess bronze)
  '#7ba85d', // 4 内蒙古 (steppe sage)
  '#5682b8', // 5 辽宁 (steel blue)
  '#6ea87e', // 6 吉林 (pine green)
  '#4d739e', // 7 黑龙江 (heilong indigo)
  '#c9a45c', // 8 上海 (financial gold)
  '#4aa39a', // 9 江苏 (jiangnan jade)
  '#5aa86e', // 10 浙江 (emerald)
  '#b8825a', // 11 安徽 (huizhou clay)
  '#4f96c4', // 12 福建 (min sea blue)
  '#639962', // 13 江西 (lush green)
  '#c98249', // 14 山东 (qilu copper)
  '#cc9f4b', // 15 河南 (zhongyuan gold)
  '#568ca8', // 16 湖北 (chu river blue)
  '#c76565', // 17 湖南 (xiang crimson)
  '#d47a42', // 18 广东 (lingnan tangerine)
  '#58a882', // 19 广西 (karst teal)
  '#45b5a8', // 20 海南 (tropical turquoise)
  '#b8637a', // 21 重庆 (bayu rose)
  '#8c6bb1', // 22 四川 (shu violet)
  '#6a9e6e', // 23 贵州 (qian moss)
  '#9c6ba8', // 24 云南 (dian plum)
  '#c7b57d', // 25 西藏 (plateau gold-sand)
  '#b56a52', // 26 陕西 (qin terracotta)
  '#b89566', // 27 甘肃 (silk road sand)
  '#5e8cb8', // 28 青海 (qinghai azure)
  '#9b8859', // 29 宁夏 (huanghe ochre)
  '#c28b5b', // 30 新疆 (tarim copper)
  '#4db3a0', // 31 台湾 (pacific jade)
  '#e0b457', // 32 香港 (harbor gold)
  '#79b89c', // 33 澳门 (lotus mint)
];

export function provinceColor(idx) {
  if (idx == null || idx < 0) return '#7c8a99';
  return PROVINCE_PALETTE[idx % PROVINCE_PALETTE.length];
}

// Predefined scientific sequential ramps (parsed once)
export const RAMPS = {
  viridis: ['#1d2847', '#2b557c', '#2b8a88', '#5eba6d', '#c3da4c', '#fae85c'].map(hexToRgb),
  amber: ['#241c1a', '#593420', '#965626', '#cb832f', '#e9b74c', '#fae08a'].map(hexToRgb),
  crimson: ['#23212c', '#542c3c', '#8c3743', '#bf4d43', '#df7d4e', '#f7be72'].map(hexToRgb),
  emerald: ['#18292b', '#1e4a44', '#2c735b', '#4ba06b', '#87c976', '#d6eb96'].map(hexToRgb),
  ice: ['#1b2333', '#2d4766', '#42739e', '#65a2c9', '#99cce3', '#ddf2fa'].map(hexToRgb),
  purple: ['#1e1e30', '#442b57', '#713c7d', '#a25799', '#cf84af', '#f3c3d5'].map(hexToRgb),
  diverging: ['#2f6b9e', '#5ca0c9', '#b8d7df', '#ebe1c2', '#e0a26b', '#c45443'].map(hexToRgb),
  precip: ['#9a5f2c', '#e4cf8b', '#78c9a8', '#379ec9', '#1f5ea6', '#332375'].map(hexToRgb),
  elevation: ['#1f6a49', '#65a254', '#cec45c', '#d48d42', '#a84f34', '#875866', '#eef4fa'].map(hexToRgb),
};

// Piecewise per-band [startRgb, endRgb] ramps for sharp meteorological & hypsometric breakpoints
export const BAND_RAMPS = {
  precip: [
    ['#9a5f2c', '#c48d47'], // <200 mm arid ochre
    ['#cb9c55', '#e4cf8b'], // 200-400 mm semi-arid warm sand
    ['#78c9a8', '#46b5a8'], // 400-800 mm semi-humid mint-teal
    ['#379ec9', '#2579b5'], // 800-1200 mm humid cerulean
    ['#1f5ea6', '#1a4291'], // 1200-1600 mm abundant cobalt
    ['#1d3280', '#332375'], // >1600 mm monsoon indigo
  ].map(([a, b]) => [hexToRgb(a), hexToRgb(b)]),
  elevation: [
    ['#1f6a49', '#348554'], // <100 m alluvial plain
    ['#469454', '#84b054'], // 100-500 m low hills
    ['#99b856', '#cec45c'], // 500-1000 m upland transition
    ['#d8b252', '#d48d42'], // 1000-2000 m Step 2 plateau
    ['#c8743a', '#a84f34'], // 2000-3500 m Step 2->1 escarpment
    ['#964a46', '#875866'], // 3500-4500 m Tibetan plateau
    ['#a998a4', '#eef4fa'], // >4500 m high peaks & snow
  ].map(([a, b]) => [hexToRgb(a), hexToRgb(b)]),
};
