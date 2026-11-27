// Terrain cover definitions, elevation hillshade, and 19-lens choropleth coloring

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
    // Ocean with coastal shelf hint if adjacent to land
    return w.isCoast && w.isCoast[i] ? OCEAN_SHALLOW_RGB : OCEAN_DEEP_RGB;
  }
  if (owner === -2) {
    // Neighboring foreign land: muted slate with subtle relief
    const elev = w.elev ? w.elev[i] : 0;
    const f = 0.86 + Math.min(0.24, Math.max(-0.08, (elev - 300) / 8000));
    return shadeRgb(FOREIGN_BASE_RGB, f);
  }

  const cover = w.cover ? w.cover[i] : 5;
  let rgb = COVER_RGB[cover] || COVER_RGB[5];

  // Blend subtle green/warm crop/forest gradients from pct if present
  if (w.pct && cover !== 1 && cover !== 9) {
    const dev = w.pctScale ? (w.pct.developed?.[i] || 0) * w.pctScale : (w.pct.developed?.[i] || 0);
    if (dev > 0.25) {
      rgb = lerpRgb(rgb, COVER_RGB[9], Math.min(0.75, dev * 0.8));
    }
  }

  // Elevation tinting + NW directional hillshade
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

  // High plateau brightening
  if (elev > 3200 && cover !== 1) {
    const t = Math.min(0.35, (elev - 3200) / 5500);
    rgb = lerpRgb(rgb, [196, 190, 174], t);
  } else if (elev < 60 && cover === 7) {
    rgb = lerpRgb(rgb, [120, 160, 74], 0.22);
  }

  return shadeRgb(rgb, shade);
}

/**
 * Extract the raw numeric or categorical value of cell i for the active lens.
 */
export function getLensCellValue(w, data, lens, i) {
  if (!lens || w.owner[i] < 0) return null;

  const countyIdx = w.county ? w.county[i] : -1;
  const countyRow = countyIdx >= 0 && data.counties?.rows ? data.counties.rows[countyIdx] : null;
  const fieldKey = lens.countyField || lens.field || lens.id;

  // Cell-level override for physical cover percentages when available
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

  // Fallback mapping from common lens IDs -> county columns
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

  if (countyRow) {
    const ak = ALIASES[lens.id];
    if (ak && countyRow[ak] != null) return countyRow[ak];
  }

  // Final fallback: province-level value
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

/**
 * Compute legend bands & colorizer function for an active lens across all China cells.
 */
export function buildLensColorizer(w, data, lens) {
  if (!lens) return null;

  const isCat = lens.scale === 'categorical' || lens.type === 'categorical' || lens.id === 'faith_tradition';
  const ramp = resolveRamp(lens);

  if (isCat) {
    const counts = new Map();
    for (let i = 0; i < w.N; i++) {
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
      catMap.set(name, { rgb, index: idx });
      return { index: idx, value: name, label: name.slice(0, 6), fullLabel: name, color: hex };
    });

    return {
      isCategorical: true,
      bands,
      colorFor(i) {
        if (w.owner[i] < 0) return terrainHexColor(w, i);
        const v = getLensCellValue(w, data, lens, i);
        const entry = v != null ? catMap.get(String(v)) : null;
        return entry ? entry.rgb : [52, 62, 74];
      },
      matchesBand(i, band) {
        if (!band) return true;
        const v = getLensCellValue(w, data, lens, i);
        return v != null && String(v) === String(band.value);
      },
    };
  }

  // Numeric lens
  let breaks = Array.isArray(lens.breaks) && lens.breaks.length >= 2 ? lens.breaks.slice() : null;
  const vals = [];
  if (!breaks) {
    for (let i = 0; i < w.N; i++) {
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

  return {
    isCategorical: false,
    bands,
    colorFor(i) {
      if (w.owner[i] < 0) return terrainHexColor(w, i);
      const v = getLensCellValue(w, data, lens, i);
      if (typeof v !== 'number' || !Number.isFinite(v)) return [48, 58, 70];
      let t;
      if (useLog) {
        const l0 = Math.log1p(Math.max(0, minV));
        const l1 = Math.log1p(Math.max(0, maxV));
        const lv = Math.log1p(Math.max(0, v));
        t = l1 > l0 ? (lv - l0) / (l1 - l0) : 0.5;
      } else {
        t = maxV > minV ? (v - minV) / (maxV - minV) : 0.5;
      }
      const base = sampleRamp(ramp, Math.max(0, Math.min(1, t)));
      // Subtle relief shadow modulation so topography shines beneath choropleth!
      if (w.nwNeighbor) {
        const nw = w.nwNeighbor[i];
        const elev = w.elev ? w.elev[i] : 0;
        const nwElev = nw >= 0 ? w.elev[nw] : elev;
        const s = 1 + Math.max(-0.1, Math.min(0.1, ((elev - nwElev) / 800) * 0.1));
        return shadeRgb(base, s);
      }
      return base;
    },
    matchesBand(i, band) {
      if (!band) return true;
      const v = getLensCellValue(w, data, lens, i);
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
      if (band.index === 0 && v <= band.max) return true;
      if (band.isLast && v >= band.min) return true;
      return v >= band.min && v <= band.max;
    },
  };
}
