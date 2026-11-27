// Multi-LOD 3D Isometric City Skylines & Street-Grid Districts Renderer (107 cities + metro sprawl)

function cellHash(i, k) {
  let x = (i * 374761393 + k * 668265263) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

const MEGA_HUB_IDS = new Set([
  'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'chengdu', 'chongqing',
  'hongkong', 'taipei', 'wuhan', 'hangzhou', 'nanjing', 'tianjin', 'xian',
  'suzhou', 'zhengzhou', 'changsha', 'qingdao', 'dongguan', 'ningbo',
]);

// High-contrast Civilization isometric architectural palettes:
// [left NW-lit, right SE-shaded, roof bright, parapet highlight, kind]
const SKY_PALETTES = [
  ['#78b2df', '#346089', '#cde8fc', '#f2f9ff', 'glass'],   // sleek cyan-steel skyscraper
  ['#d87e58', '#894328', '#f0a682', '#ffd2ba', 'brick'],   // warm terracotta-copper tower
  ['#b7cade', '#566f87', '#e8f1f8', '#ffffff', 'glass'],   // silver curtain-wall tower
  ['#ebe3d4', '#948b7a', '#fcf8f0', '#ffffff', 'stone'],   // ivory limestone high-rise
  ['#e4be78', '#8e6830', '#f8e3ae', '#fff5d4', 'gold'],    // champagne-gold landmark tower
  ['#6ea7b8', '#336272', '#b9e2ee', '#e4f6fc', 'glass'],   // teal-aqua glass tower
];

const BLOCK_PALETTES = [
  ['#efece4', '#a4a097', '#faf8f3', '#ffffff', 'white'],   // bright crisp pearl-white perimeter block
  ['#e5d9c6', '#91836f', '#c96b48', '#e8906c', 'brick'],   // terracotta-roof urban block
  ['#dbe2e8', '#7d8894', '#f2f5f8', '#ffffff', 'white'],   // pale concrete block
  ['#d0e2ee', '#66849c', '#5ba0b4', '#8cc8da', 'teal'],    // teal commercial hall
  ['#ead9b9', '#9a8662', '#dcaf66', '#f2d294', 'ochre'],   // warm sandstone block
  ['#f0ede6', '#9b9890', '#e3e0d8', '#ffffff', 'white'],   // clean residential house cluster
];

let cachedCoreSrc = null;
let cachedCoreLen = -1;
let cachedCoreSet = new Set();

/**
 * Return cached Set of primary city core hex indices.
 */
export function buildCityCoreSet(cities) {
  if (!Array.isArray(cities) || !cities.length) return new Set();
  if (cities === cachedCoreSrc && cities.length === cachedCoreLen) {
    return cachedCoreSet;
  }
  cachedCoreSrc = cities;
  cachedCoreLen = cities.length;
  const set = new Set();
  for (let i = 0; i < cities.length; i++) {
    const ci = cities[i]?.cell;
    if (ci != null && ci >= 0) set.add(ci);
  }
  cachedCoreSet = set;
  return set;
}

const layoutCache = new WeakMap();

function getCityLayout(w, cities) {
  const len = Array.isArray(cities) ? cities.length : 0;
  let cached = layoutCache.get(w);
  if (cached && cached.citiesSrc === cities && cached.citiesLen === len) {
    return cached;
  }

  const coreSet = buildCityCoreSet(cities);
  const clusters = [];
  const usedCells = new Set();

  if (Array.isArray(cities)) {
    for (let i = 0; i < cities.length; i++) {
      const city = cities[i];
      const ci = city.cell;
      if (ci == null || ci < 0 || ci >= w.N || usedCells.has(ci)) continue;
      usedCells.add(ci);

      const pop = city.population || 0;
      const id = String(city.id || '').toLowerCase();
      const tier =
        pop >= 10_000_000 || MEGA_HUB_IDS.has(id)
          ? 1
          : pop >= 3_000_000 || city.is_provincial_anchor || city.capital
            ? 2
            : 3;

      clusters.push({ cell: ci, tier, pop, isCore: true });

      // Multi-hex metropolitan spillover (like Phoenix's 2-hex urban cluster)
      if (tier <= 2 && typeof w.neighbors === 'function') {
        const nbs = w.neighbors(ci)
          .filter((nb) => nb >= 0 && nb < w.N && w.owner[nb] >= 0 && w.cover[nb] !== 0 && !coreSet.has(nb) && !usedCells.has(nb))
          .map((nb) => {
            const dev = w.pct?.developed?.[nb] || 0;
            const elevDiff = w.elev ? Math.abs((w.elev[nb] || 0) - (w.elev[ci] || 0)) : 0;
            return { nb, dev, cover: w.cover[nb], score: dev * 100 + (w.cover[nb] === 9 ? 55 : 0) - elevDiff * 0.08 };
          })
          .sort((a, b) => b.score - a.score);

        const maxSpill = tier === 1 ? (pop >= 14_000_000 ? 2 : 1) : 1;
        for (let s = 0; s < Math.min(maxSpill, nbs.length); s++) {
          const item = nbs[s];
          if (tier === 2 && item.cover !== 9 && item.dev < 0.08) continue;
          usedCells.add(item.nb);
          clusters.push({ cell: item.nb, tier: tier === 1 ? 2 : 3, pop: pop * 0.38, isCore: false });
        }
      }
    }
  }

  // Additional satellite-detected urban WorldCover === 9 hexes
  if (w.cover) {
    for (let i = 0; i < w.N; i++) {
      if (w.owner[i] < 0 || w.cover[i] !== 9 || usedCells.has(i)) continue;
      usedCells.add(i);
      clusters.push({ cell: i, tier: 4, pop: 600_000, isCore: false });
    }
  }

  cached = { citiesSrc: cities, citiesLen: len, clusters };
  layoutCache.set(w, cached);
  return cached;
}

const bldgGeoCache = new WeakMap();

/**
 * Generate deterministic isometric city blocks for a cell at a given LOD level:
 * lod = 1 (mid regional zoom: bold chunky 3x3/4x4 blocks so every tower reads crisp at 15-30px hexes)
 * lod = 2 (close-up zoom: full dense 6x6 Phoenix/Tucson street-grid metropolis with setbacks & parks)
 */
function getCellBuildings(w, cellIdx, tier, lod) {
  let map = bldgGeoCache.get(w);
  if (!map) {
    map = new Map();
    bldgGeoCache.set(w, map);
  }
  const key = (cellIdx << 5) | (tier << 2) | lod;
  const hit = map.get(key);
  if (hit) return hit;

  const R = w.R;
  const slots = [];
  const isMidLod = lod === 1;
  const stepX = isMidLod ? 0.255 * R : tier <= 2 ? 0.168 * R : 0.188 * R;
  const stepY = stepX * 0.54;
  const range = isMidLod ? 2 : tier <= 2 ? 3 : 2;

  for (let u = -range; u <= range; u++) {
    for (let v = -range; v <= range; v++) {
      const gx = (u - v) * stepX;
      const gy = (u + v) * stepY;
      const hexDist = Math.abs(gx) * 1.155 + Math.abs(gy) * 0.56;
      if (Math.abs(gx) > R * 0.74 || Math.abs(gy) > R * 0.64 || hexDist > R * 0.90) continue;
      const centerDist = Math.hypot(gx, gy * 1.55) / R;
      slots.push({ u, v, gx, gy, centerDist });
    }
  }

  const bldgs = [];
  for (let k = 0; k < slots.length; k++) {
    const sl = slots[k];
    const hVal = cellHash(cellIdx, (sl.u + 5) * 31 + (sl.v + 5) * 17);
    const hVal2 = cellHash(cellIdx, k * 13 + 7);
    const hVal3 = cellHash(cellIdx, k * 23 + 41);

    // Pocket park lot in outer suburbs (close-up LOD)
    if (!isMidLod && sl.centerDist > 0.40 && hVal < 0.12) {
      bldgs.push({
        isPark: true,
        ox: sl.gx + (hVal2 - 0.5) * stepX * 0.22,
        oy: sl.gy + (hVal3 - 0.5) * stepY * 0.22 + 0.05 * R,
        bw: R * 0.10,
        bh: R * 0.14,
      });
      continue;
    }
    if (tier === 4 && sl.centerDist > 0.48 && hVal < 0.28) continue;

    const isCbdCore = sl.centerDist < (tier === 1 ? 0.40 : tier === 2 ? 0.30 : 0.22);
    const isMidRing = sl.centerDist < 0.58;

    let bh;
    if (tier === 1) {
      bh = isCbdCore
        ? R * (0.76 + 0.72 * hVal2)
        : isMidRing
          ? R * (0.34 + 0.42 * hVal2)
          : R * (0.14 + 0.20 * hVal2);
    } else if (tier === 2) {
      bh = isCbdCore
        ? R * (0.56 + 0.54 * hVal2)
        : isMidRing
          ? R * (0.24 + 0.30 * hVal2)
          : R * (0.13 + 0.17 * hVal2);
    } else if (tier === 3) {
      bh = isCbdCore ? R * (0.38 + 0.34 * hVal2) : R * (0.12 + 0.18 * hVal2);
    } else {
      bh = isCbdCore ? R * (0.24 + 0.22 * hVal2) : R * (0.11 + 0.14 * hVal2);
    }

    const bwBase = isMidLod
      ? isCbdCore ? 0.155 + 0.045 * hVal3 : 0.135 + 0.042 * hVal3
      : isCbdCore ? 0.112 + 0.036 * hVal3 : 0.098 + 0.034 * hVal3;
    const bw = R * bwBase;
    const bd = bw * 0.56;
    const ox = sl.gx + (hVal - 0.5) * stepX * 0.22;
    const oy = sl.gy + (hVal2 - 0.5) * stepY * 0.20 + 0.06 * R;

    const useSky = isCbdCore || (tier <= 2 && bh > R * 0.44);
    const palArr = useSky ? SKY_PALETTES : BLOCK_PALETTES;
    const palIdx =
      !useSky && sl.centerDist > 0.54 && hVal > 0.45
        ? (hVal > 0.72 ? 0 : 2)
        : Math.floor(cellHash(cellIdx, k * 19 + 97) * palArr.length) % palArr.length;

    const hasSetback = isCbdCore && bh > R * 0.80 && hVal > 0.36;
    const hasSpire = tier === 1 && isCbdCore && bh > R * 1.14 && hVal3 > 0.42;
    const hasRoofHvac = !isMidLod && !hasSetback && bw > R * 0.105 && hVal2 > 0.45;

    bldgs.push({
      isPark: false,
      ox,
      oy,
      bw,
      bd,
      bh,
      pal: palArr[palIdx],
      hasSetback,
      hasSpire,
      hasRoofHvac,
    });
  }

  bldgs.sort((a, b) => a.oy - b.oy);
  map.set(key, bldgs);
  return bldgs;
}

function traceHexPad(ctx, cx, cy, corners, scale) {
  ctx.beginPath();
  ctx.moveTo(cx + corners[0][0] * scale, cy + corners[0][1] * scale);
  ctx.lineTo(cx + corners[1][0] * scale, cy + corners[1][1] * scale);
  ctx.lineTo(cx + corners[2][0] * scale, cy + corners[2][1] * scale);
  ctx.lineTo(cx + corners[3][0] * scale, cy + corners[3][1] * scale);
  ctx.lineTo(cx + corners[4][0] * scale, cy + corners[4][1] * scale);
  ctx.lineTo(cx + corners[5][0] * scale, cy + corners[5][1] * scale);
  ctx.closePath();
}

function drawIsoPrism(ctx, x, y, bw, bd, bh, pal, edgeLw, showWindows, zoom) {
  const [leftCol, rightCol, roofCol, trimCol, kind] = pal;

  // Soft SE ground cast shadow
  const sxOff = bh * 0.30;
  const syOff = bh * 0.17;
  ctx.fillStyle = 'rgba(14, 20, 26, 0.30)';
  ctx.beginPath();
  ctx.moveTo(x, y + bd);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw + sxOff, y + syOff);
  ctx.lineTo(x + sxOff, y + bd + syOff);
  ctx.closePath();
  ctx.fill();

  // Left (NW sunlit) wall
  ctx.fillStyle = leftCol;
  ctx.beginPath();
  ctx.moveTo(x - bw, y);
  ctx.lineTo(x, y + bd);
  ctx.lineTo(x, y + bd - bh);
  ctx.lineTo(x - bw, y - bh);
  ctx.closePath();
  ctx.fill();

  // Right (SE shaded) wall
  ctx.fillStyle = rightCol;
  ctx.beginPath();
  ctx.moveTo(x, y + bd);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw, y - bh);
  ctx.lineTo(x, y + bd - bh);
  ctx.closePath();
  ctx.fill();

  // Sunlit roof diamond
  ctx.fillStyle = roofCol;
  ctx.beginPath();
  ctx.moveTo(x, y - bd - bh);
  ctx.lineTo(x + bw, y - bh);
  ctx.lineTo(x, y + bd - bh);
  ctx.lineTo(x - bw, y - bh);
  ctx.closePath();
  ctx.fill();

  // Window floor striations & vertical shimmer at close-up
  if (showWindows && bh > bw * 1.10) {
    const floors = Math.min(7, Math.max(2, Math.floor(bh / (bw * 0.68))));
    ctx.strokeStyle = kind === 'glass' ? 'rgba(235, 248, 255, 0.58)' : 'rgba(54, 62, 72, 0.30)';
    ctx.lineWidth = Math.max(0.18, 0.38 / zoom);
    ctx.beginPath();
    for (let f = 1; f < floors; f++) {
      const fy = (bh * f) / floors;
      ctx.moveTo(x - bw * 0.88, y - fy);
      ctx.lineTo(x - bw * 0.08, y + bd * 0.90 - fy);
    }
    ctx.stroke();

    ctx.strokeStyle = kind === 'glass' ? 'rgba(255, 224, 148, 0.34)' : 'rgba(24, 32, 42, 0.34)';
    ctx.beginPath();
    for (let f = 1; f < floors; f++) {
      const fy = (bh * f) / floors;
      ctx.moveTo(x + bw * 0.08, y + bd * 0.90 - fy);
      ctx.lineTo(x + bw * 0.88, y - fy);
    }
    ctx.stroke();
  }

  // Crisp architectural dark outline & vertical front corner seam
  ctx.strokeStyle = 'rgba(20, 26, 34, 0.62)';
  ctx.lineWidth = edgeLw;
  ctx.beginPath();
  ctx.moveTo(x - bw, y);
  ctx.lineTo(x, y + bd);
  ctx.lineTo(x + bw, y);
  ctx.lineTo(x + bw, y - bh);
  ctx.lineTo(x, y - bd - bh);
  ctx.lineTo(x - bw, y - bh);
  ctx.closePath();
  ctx.moveTo(x, y + bd);
  ctx.lineTo(x, y + bd - bh);
  ctx.stroke();

  // Crisp light parapet lip on front roof edge (close-up LOD)
  if (showWindows) {
    ctx.strokeStyle = trimCol;
    ctx.lineWidth = Math.max(0.16, edgeLw * 0.7);
    ctx.beginPath();
    ctx.moveTo(x - bw, y - bh);
    ctx.lineTo(x, y + bd - bh);
    ctx.lineTo(x + bw, y - bh);
    ctx.stroke();
  }
}

/**
 * Draw multi-LOD 3D isometric city skylines and urban districts baked into static cache.
 */
export function drawIsometricCities(ctx, w, state, zoom, bounds, isLensMode) {
  const cities = state?.cities;
  const { cxArr, cyArr, corners, R } = w;
  const { clusters } = getCityLayout(w, cities);
  if (!clusters.length) return;

  const pad = R * 2.8;
  const x0 = bounds ? bounds.x0 - pad : -Infinity;
  const y0 = bounds ? bounds.y0 - pad : -Infinity;
  const x1 = bounds ? bounds.x1 + pad : Infinity;
  const y1 = bounds ? bounds.y1 + pad : Infinity;

  ctx.save();

  if (isLensMode) {
    const s = Math.min(R * 0.42, Math.max(3.4, 5.0 / Math.pow(zoom, 0.55)));
    ctx.fillStyle = 'rgba(22, 32, 46, 0.72)';
    ctx.strokeStyle = 'rgba(236, 208, 142, 0.78)';
    ctx.lineWidth = Math.max(0.7, 1.1 / zoom);
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      if (!cl.isCore) continue;
      const cx = cxArr[cl.cell];
      const cy = cyArr[cl.cell];
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  // LOD 0 (National & far regional zoom < 0.45): bold high-contrast miniature 3D city clusters on ALL major cities
  if (zoom < 0.45) {
    const s = Math.min(R * 1.48, Math.max(R * 1.02, 7.6 / Math.max(0.18, zoom)));
    const ew = Math.max(0.45, 0.72 / zoom);
    ctx.lineJoin = 'round';
    const visible = [];
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      if (!cl.isCore) continue;
      if (cl.tier >= 3 && zoom < 0.24) continue;
      const cx = cxArr[cl.cell];
      const cy = cyArr[cl.cell];
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      visible.push({ cl, cx, cy });
    }
    visible.sort((a, b) => a.cy - b.cy);

    for (let v = 0; v < visible.length; v++) {
      const { cl, cx, cy } = visible[v];
      const padScale = Math.min(1.18, s / R);
      traceHexPad(ctx, cx, cy, corners, 0.94 * padScale);
      ctx.fillStyle = 'rgba(110, 168, 82, 0.80)';
      ctx.fill();

      traceHexPad(ctx, cx, cy, corners, 0.78 * padScale);
      ctx.fillStyle = '#758086';
      ctx.fill();

      const specs = cl.tier === 1
        ? [
            [-0.26, -0.14, 0.16, 0.62, SKY_PALETTES[1]],
            [0.26, -0.12, 0.16, 0.56, SKY_PALETTES[2]],
            [-0.36, 0.08, 0.15, 0.34, BLOCK_PALETTES[0]],
            [0.36, 0.08, 0.15, 0.32, BLOCK_PALETTES[0]],
            [-0.02, 0.06, 0.20, 1.05, SKY_PALETTES[0]],
            [0.14, 0.18, 0.15, 0.48, SKY_PALETTES[3]],
          ]
        : cl.tier === 2
          ? [
              [-0.22, -0.08, 0.16, 0.52, SKY_PALETTES[1]],
              [0.22, -0.06, 0.16, 0.48, SKY_PALETTES[2]],
              [0.0, 0.08, 0.19, 0.80, SKY_PALETTES[0]],
              [-0.26, 0.16, 0.14, 0.28, BLOCK_PALETTES[0]],
            ]
          : [
              [-0.18, -0.04, 0.16, 0.38, BLOCK_PALETTES[1]],
              [0.16, 0.02, 0.16, 0.50, SKY_PALETTES[0]],
              [-0.06, 0.16, 0.15, 0.26, BLOCK_PALETTES[0]],
            ];

      for (const [ox, oy, bwf, bhf, pal] of specs) {
        drawIsoPrism(
          ctx,
          cx + ox * s,
          cy + oy * s + 0.14 * s,
          bwf * s,
          bwf * s * 0.56,
          bhf * s,
          pal,
          ew,
          false,
          zoom
        );
      }
    }
    ctx.restore();
    return;
  }

  // LOD 1 (0.45..1.15 regional zoom) vs LOD 2 (>= 1.15 full metro street-grid close-up)
  const lod = zoom < 1.15 ? 1 : 2;
  const edgeLw = Math.max(0.24, Math.min(0.85, 0.55 / zoom));
  const showWindows = zoom >= 1.15;
  const showStreets = zoom >= 0.85;

  const visible = [];
  for (let i = 0; i < clusters.length; i++) {
    const cl = clusters[i];
    if (zoom < 0.78 && cl.tier === 4) continue;
    const cx = cxArr[cl.cell];
    const cy = cyArr[cl.cell];
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
    visible.push({ cl, cx, cy });
  }
  visible.sort((a, b) => a.cy - b.cy);

  for (let v = 0; v < visible.length; v++) {
    const { cl, cx, cy } = visible[v];

    // 1. Vibrant green suburban parklawn hex base + cool slate asphalt street grid
    traceHexPad(ctx, cx, cy, corners, 0.98);
    ctx.fillStyle = cl.tier <= 2 ? 'rgba(110, 168, 82, 0.84)' : 'rgba(116, 168, 88, 0.72)';
    ctx.fill();

    traceHexPad(ctx, cx, cy, corners, 0.87);
    ctx.fillStyle = cl.tier <= 2 ? '#6e797e' : '#7e8886';
    ctx.fill();

    if (showStreets) {
      ctx.strokeStyle = 'rgba(228, 232, 222, 0.50)';
      ctx.lineWidth = Math.max(0.35, 0.85 / zoom);
      ctx.beginPath();
      for (const sOff of [-0.28 * R, 0, 0.28 * R]) {
        ctx.moveTo(cx - R * 0.68, cy + sOff * 0.6 - R * 0.36);
        ctx.lineTo(cx + R * 0.68, cy + sOff * 0.6 + R * 0.36);
        ctx.moveTo(cx - R * 0.68, cy + sOff * 0.6 + R * 0.36);
        ctx.lineTo(cx + R * 0.68, cy + sOff * 0.6 - R * 0.36);
      }
      ctx.stroke();
    }

    // 2. Painter-ordered isometric street-grid blocks & stepped skyscrapers
    const bldgs = getCellBuildings(w, cl.cell, cl.tier, lod);
    ctx.lineJoin = 'round';

    for (let k = 0; k < bldgs.length; k++) {
      const b = bldgs[k];
      const x = cx + b.ox;
      const y = cy + b.oy;

      if (b.isPark) {
        ctx.fillStyle = '#5ca04d';
        ctx.beginPath();
        ctx.ellipse(x, y, b.bw * 1.15, b.bw * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#25562c';
        ctx.beginPath();
        ctx.arc(x - b.bw * 0.32, y - b.bh * 0.45, b.bw * 0.48, 0, Math.PI * 2);
        ctx.arc(x + b.bw * 0.36, y - b.bh * 0.35, b.bw * 0.42, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      drawIsoPrism(ctx, x, y, b.bw, b.bd, b.bh, b.pal, edgeLw, showWindows, zoom);

      if (b.hasSetback) {
        drawIsoPrism(
          ctx,
          x,
          y - b.bh,
          b.bw * 0.66,
          b.bd * 0.66,
          R * 0.26,
          b.pal,
          edgeLw * 0.9,
          false,
          zoom
        );
        if (b.hasSpire && zoom >= 0.72) {
          ctx.strokeStyle = '#f2f7fc';
          ctx.lineWidth = Math.max(0.32, 0.80 / zoom);
          ctx.beginPath();
          ctx.moveTo(x, y - b.bh - R * 0.26);
          ctx.lineTo(x, y - b.bh - R * 0.50);
          ctx.stroke();
        }
      } else if (b.hasRoofHvac && zoom >= 1.15) {
        ctx.fillStyle = 'rgba(66, 74, 84, 0.68)';
        const mw = b.bw * 0.34;
        const md = b.bd * 0.34;
        const ry = y - b.bh;
        ctx.beginPath();
        ctx.moveTo(x, ry - md);
        ctx.lineTo(x + mw, ry);
        ctx.lineTo(x, ry + md);
        ctx.lineTo(x - mw, ry);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  ctx.restore();
}
