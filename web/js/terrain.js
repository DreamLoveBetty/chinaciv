// Terrain cover definitions, elevation hillshade, and cached 19-lens choropleth coloring

import { hexToRgb, shadeRgb, sampleRamp, RAMPS, lerpRgb } from './color.js';

// Cover IDs 0..9 matching data-geo frozen contract
export const COVER_META = [
  { id: 0, key: 'water', name: '海洋/水域', color: '#133a5e' },
  { id: 1, key: 'snow', name: '冰雪/冰川', color: '#d8e4ec' },
  { id: 2, key: 'alpine', name: '高山荒漠/冻原', color: '#8d877a' },
  { id: 3, key: 'forest', name: '森林', color: '#2f613b' },
  { id: 4, key: 'desert', name: '荒漠/戈壁灌丛', color: '#b69764' },
  { id: 5, key: 'grass', name: '草原/高寒草甸', color: '#708d4b' },
  { id: 6, key: 'pasture', name: '稀树牧场', color: '#859b57' },
  { id: 7, key: 'crop', name: '农田耕地', color: '#84a14c' },
  { id: 8, key: 'wetland', name: '湿地沼泽', color: '#42766b' },
  { id: 9, key: 'urban', name: '城市建成区', color: '#b8764a' },
];

const COVER_RGB = COVER_META.map((c) => hexToRgb(c.color));
const FOREIGN_BASE_RGB = hexToRgb('#242b33');
const OCEAN_SHALLOW_RGB = hexToRgb('#17456e');
const OCEAN_DEEP_RGB = hexToRgb('#0b233c');

// Quantize RGB to step-4 buckets -> ~120 unique hex strings across 17,598 tiles for ultra-fast batch fill()
function rgbQuantHex(r, g, b) {
  const qr = Math.max(0, Math.min(252, (Math.round(r) + 2) & ~3));
  const qg = Math.max(0, Math.min(252, (Math.round(g) + 2) & ~3));
  const qb = Math.max(0, Math.min(252, (Math.round(b) + 2) & ~3));
  return `#${qr.toString(16).padStart(2, '0')}${qg.toString(16).padStart(2, '0')}${qb.toString(16).padStart(2, '0')}`;
}

const OCEAN_SHALLOW_HEX = '#17456e';
const FOREIGN_SHADES = [0.84, 0.92, 1.0, 1.08].map((f) => {
  const c = shadeRgb(FOREIGN_BASE_RGB, f);
  return rgbQuantHex(c[0], c[1], c[2]);
});

// Faith traditions categorical palette
export const FAITH_COLORS = {
  '汉传佛教/民间信仰': '#d8a648',
  '佛教': '#d8a648',
  '道教/民俗信仰': '#6cb89c',
  '藏传佛教': '#c85a47',
  '伊斯兰教': '#4b9e6b',
  '基督宗教': '#6b9ed4',
  '多元世俗/无宗教为主': '#78889a',
  '少数民族传统信仰': '#a878bd',
};

/**
 * Compute base terrain RGB with elevation tinting & subtle NW hillshade.
 */
export function terrainHexColor(w, i) {
  const owner = w.owner[i];
  if (owner === -1) {
    return w.isCoast && w.isCoast[i] ? OCEAN_SHALLOW_RGB : OCEAN_DEEP_RGB;
  }
  if (owner === -2) {
    const elev = w.elev ? w.elev[i] : 0;
    const f = 0.86 + Math.min(0.24, Math.max(-0.08, (elev - 300) / 8000));
    return shadeRgb(FOREIGN_BASE_RGB, f);
  }

  const cover = w.cover ? w.cover[i] : 5;
  let rgb = COVER_RGB[cover] || COVER_RGB[5];

  if (w.pct && cover !== 1 && cover !== 9) {
    const dev = w.pctScale ? (w.pct.developed?.[i] || 0) * w.pctScale : (w.pct.developed?.[i] || 0);
    if (dev > 0.25) {
      rgb = lerpRgb(rgb, COVER_RGB[9], Math.min(0.75, dev * 0.8));
    }
  }

  const elev = w.elev ? w.elev[i] : 0;
  let shade = 1.0;

  if (w.nwNeighbor) {
    const nw = w.nwNeighbor[i];
    const wN = w.wNeighbor[i];
    const nwElev = nw >= 0 ? w.elev[nw] : elev;
    const wElev = wN >= 0 ? w.elev[wN] : elev;
    const slope = (elev - 0.65 * nwElev - 0.35 * wElev) / 650;
    shade += Math.max(-0.22, Math.min(0.22, slope * 0.24));
  }

  if (elev > 3200 && cover !== 1) {
    const t = Math.min(0.35, (elev - 3200) / 5500);
    rgb = lerpRgb(rgb, [196, 190, 174], t);
  } else if (elev < 60 && cover === 7) {
    rgb = lerpRgb(rgb, [120, 160, 74], 0.22);
  }

  return shadeRgb(rgb, shade);
}

/**
 * Precompute quantized hex color strings for all N cells once per world.
 */
export function getTerrainColorHexArr(w) {
  if (w._terrainColorHex) return w._terrainColorHex;
  const N = w.N;
  const arr = new Array(N);
  const owner = w.owner;
  const isCoast = w.isCoast;
  const elev = w.elev;
  for (let i = 0; i < N; i++) {
    const ow = owner[i];
    if (ow === -1) {
      arr[i] = isCoast && isCoast[i] ? OCEAN_SHALLOW_HEX : null;
      continue;
    }
    if (ow === -2) {
      const e = elev ? elev[i] : 0;
      const bucket = e < 300 ? 0 : e < 1200 ? 1 : e < 2600 ? 2 : 3;
      arr[i] = FOREIGN_SHADES[bucket];
      continue;
    }
    const rgb = terrainHexColor(w, i);
    arr[i] = rgbQuantHex(rgb[0], rgb[1], rgb[2]);
  }
  w._terrainColorHex = arr;
  return arr;
}

const ALIASES = {
  home: 'home_price',
  poverty: 'low_income',
  age: 'median_age',
  migrant: 'migrant_pct',
  bachelors: 'bachelors_pct',
  broadband: 'broadband_pct',
  commute: 'commute_min',
  homeownership: 'homeownership_pct',
  healthcare_gap: 'healthcare_gap_pct',
  forest: 'forest_pct',
  farmland: 'farmland_pct',
  developed: 'developed_pct',
  faith: 'faith_per100',
  stem: 'stem_pct',
  income: 'income',
  density: 'density',
  faith_tradition: 'faith_tradition',
  wellbeing: 'wellbeing',
  disasters: 'disasters',
};

/**
 * Extract the raw numeric or categorical value of cell i for the active lens.
 */
export function getLensCellValue(w, data, lens, i) {
  if (!lens || w.owner[i] < 0) return null;

  const countyIdx = w.county ? w.county[i] : -1;
  const countyRow = countyIdx >= 0 && data.counties?.rows ? data.counties.rows[countyIdx] : null;
  const fieldKey = lens.countyField || lens.field || lens.id;

  if (w.pct && (lens.id === 'forest' || lens.id === 'farmland' || lens.id === 'developed')) {
    const scale = w.pctScale === 1 ? 100 : 1;
    if (lens.id === 'forest' && w.pct.forest && (!countyRow || countyRow[fieldKey] == null)) {
      return w.pct.forest[i] * scale;
    }
    if (lens.id === 'farmland' && w.pct.crop && (!countyRow || countyRow[fieldKey] == null)) {
      return w.pct.crop[i] * scale;
    }
    if (lens.id === 'developed' && w.pct.developed && (!countyRow || countyRow[fieldKey] == null)) {
      return w.pct.developed[i] * scale;
    }
  }

  if (countyRow && countyRow[fieldKey] != null) {
    return countyRow[fieldKey];
  }

  if (countyRow) {
    const ak = ALIASES[lens.id];
    if (ak && countyRow[ak] != null) return countyRow[ak];
  }

  const st = data.states?.[w.owner[i]];
  if (st && st[fieldKey] != null) return st[fieldKey];
  return null;
}

function resolveRamp(lens) {
  if (Array.isArray(lens.colors) && lens.colors.length >= 2) {
    return lens.colors.map(hexToRgb);
  }
  const key = lens.ramp || lens.palette;
  if (key && RAMPS[key]) return RAMPS[key];
  switch (lens.group) {
    case 'people': return RAMPS.amber;
    case 'prosperity': return RAMPS.viridis;
    case 'knowledge': return RAMPS.ice;
    case 'life': return RAMPS.purple;
    case 'faith': return RAMPS.amber;
    case 'hazards': return RAMPS.crimson;
    case 'land': return RAMPS.emerald;
    default: return RAMPS.viridis;
  }
}

const lensColorizerCache = new WeakMap();

/**
 * Compute & cache legend bands, colorizer function, and precomputed colorHexArr for an active lens.
 */
export function buildLensColorizer(w, data, lens) {
  if (!lens) return null;

  const countyCount = data.counties?.rows?.length || 0;
  const cacheKey = `${lens.id}:${countyCount}`;
  let wCache = lensColorizerCache.get(w);
  if (!wCache) {
    wCache = new Map();
    lensColorizerCache.set(w, wCache);
  }
  if (wCache.has(cacheKey)) {
    return wCache.get(cacheKey);
  }

  const terrainHex = getTerrainColorHexArr(w);
  const isCat = lens.scale === 'categorical' || lens.type === 'categorical' || lens.id === 'faith_tradition';
  const ramp = resolveRamp(lens);
  const N = w.N;

  let result;

  if (isCat) {
    const counts = new Map();
    for (let i = 0; i < N; i++) {
      if (w.owner[i] < 0) continue;
      const v = getLensCellValue(w, data, lens, i);
      if (v != null && v !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
    const catPalette = ['#d8a648', '#529dc4', '#5fad72', '#c85a47', '#9f78c4', '#4db8ab', '#8592a1'];
    const catMap = new Map();
    const bands = sorted.map(([name], idx) => {
      const hex = lens.categoryColors?.[name] || FAITH_COLORS[name] || catPalette[idx % catPalette.length];
      const rgb = hexToRgb(hex);
      const qHex = rgbQuantHex(rgb[0], rgb[1], rgb[2]);
      catMap.set(name, { rgb, hex: qHex, index: idx });
      return { index: idx, value: name, label: name.slice(0, 6), fullLabel: name, color: hex };
    });

    const colorHexArr = new Array(N);
    const catIndexArr = new Int8Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (w.owner[i] < 0) {
        colorHexArr[i] = terrainHex[i];
        continue;
      }
      const v = getLensCellValue(w, data, lens, i);
      const entry = v != null ? catMap.get(String(v)) : null;
      colorHexArr[i] = entry ? entry.hex : '#343e4a';
      if (entry) catIndexArr[i] = entry.index;
    }

    result = {
      isCategorical: true,
      bands,
      colorHexArr,
      colorFor(i) {
        if (w.owner[i] < 0) return terrainHexColor(w, i);
        const idx = catIndexArr[i];
        return idx >= 0 ? hexToRgb(bands[idx].color) : [52, 62, 74];
      },
      matchesBand(i, band) {
        if (!band) return true;
        return catIndexArr[i] === band.index;
      },
    };
  } else {
    let breaks = Array.isArray(lens.breaks) && lens.breaks.length >= 2 ? lens.breaks.slice() : null;
    if (!breaks) {
      const vals = [];
      for (let i = 0; i < N; i++) {
        if (w.owner[i] < 0) continue;
        const v = getLensCellValue(w, data, lens, i);
        if (typeof v === 'number' && Number.isFinite(v)) vals.push(v);
      }
      vals.sort((a, b) => a - b);
      if (vals.length) {
        const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))];
        breaks = [q(0.02), q(0.2), q(0.4), q(0.6), q(0.8), q(0.95), q(0.995)];
      } else {
        breaks = [0, 20, 40, 60, 80, 100];
      }
    }

    const nBands = Math.max(4, Math.min(7, breaks.length - 1));
    const bands = [];
    for (let b = 0; b < nBands; b++) {
      const t = nBands === 1 ? 0.5 : b / (nBands - 1);
      const rgb = sampleRamp(ramp, t);
      const lo = breaks[b];
      const hi = breaks[b + 1] ?? breaks[breaks.length - 1];
      bands.push({
        index: b,
        min: lo,
        max: hi,
        isLast: b === nBands - 1,
        rgb,
        color: `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`,
      });
    }

    const useLog = lens.scale === 'log';
    const minV = breaks[0];
    const maxV = breaks[breaks.length - 1];
    const l0 = useLog ? Math.log1p(Math.max(0, minV)) : 0;
    const l1 = useLog ? Math.log1p(Math.max(0, maxV)) : 0;

    const valArr = new Float32Array(N).fill(NaN);
    const colorHexArr = new Array(N);
    for (let i = 0; i < N; i++) {
      if (w.owner[i] < 0) {
        colorHexArr[i] = terrainHex[i];
        continue;
      }
      const v = getLensCellValue(w, data, lens, i);
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        colorHexArr[i] = '#303a46';
        continue;
      }
      valArr[i] = v;
      let t;
      if (useLog) {
        const lv = Math.log1p(Math.max(0, v));
        t = l1 > l0 ? (lv - l0) / (l1 - l0) : 0.5;
      } else {
        t = maxV > minV ? (v - minV) / (maxV - minV) : 0.5;
      }
      let rgb = sampleRamp(ramp, Math.max(0, Math.min(1, t)));
      if (w.nwNeighbor) {
        const nw = w.nwNeighbor[i];
        const elev = w.elev ? w.elev[i] : 0;
        const nwElev = nw >= 0 ? w.elev[nw] : elev;
        const s = 1 + Math.max(-0.1, Math.min(0.1, ((elev - nwElev) / 800) * 0.1));
        rgb = shadeRgb(rgb, s);
      }
      colorHexArr[i] = rgbQuantHex(rgb[0], rgb[1], rgb[2]);
    }

    result = {
      isCategorical: false,
      bands,
      colorHexArr,
      colorFor(i) {
        if (w.owner[i] < 0) return terrainHexColor(w, i);
        const hex = colorHexArr[i];
        return hex ? hexToRgb(hex) : [48, 58, 70];
      },
      matchesBand(i, band) {
        if (!band) return true;
        const v = valArr[i];
        if (!Number.isFinite(v)) return false;
        if (band.index === 0 && v <= band.max) return true;
        if (band.isLast && v >= band.min) return true;
        return v >= band.min && v <= band.max;
      },
    };
  }

  wCache.set(cacheKey, result);
  return result;
}
