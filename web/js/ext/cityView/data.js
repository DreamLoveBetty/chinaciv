/**
 * City View data normalization, spatial footprint, district hex placement,
 * local resource/wonder discovery, and peer comparison helpers.
 */

export const REGION_ORDER = [
  "华北",
  "东北",
  "华东",
  "华中",
  "华南",
  "西南",
  "西北",
  "港澳台",
];

export const PROVINCE_REGIONS = {
  "110000": "华北", "120000": "华北", "130000": "华北", "140000": "华北", "150000": "华北",
  "210000": "东北", "220000": "东北", "230000": "东北",
  "310000": "华东", "320000": "华东", "330000": "华东", "340000": "华东", "350000": "华东", "360000": "华东", "370000": "华东",
  "410000": "华中", "420000": "华中", "430000": "华中",
  "440000": "华南", "450000": "华南", "460000": "华南",
  "500000": "西南", "510000": "西南", "520000": "西南", "530000": "西南", "540000": "西南",
  "610000": "西北", "620000": "西北", "630000": "西北", "640000": "西北", "650000": "西北",
  "710000": "港澳台", "810000": "港澳台", "820000": "港澳台",
};

export const PROVINCE_COLORS = [
  "#d85a4a", "#4ca3b8", "#d29b4a", "#9e7356", "#7ba85d",
  "#5682b8", "#6ea87e", "#4d739e", "#c9a45c", "#4aa39a",
  "#5aa86e", "#b8825a", "#4f96c4", "#639962", "#c98249",
  "#cc9f4b", "#568ca8", "#c76565", "#d47a42", "#58a882",
  "#45b5a8", "#b8637a", "#8c6bb1", "#6a9e6e", "#9c6ba8",
  "#c7b57d", "#b56a52", "#b89566", "#5e8cb8", "#9b8859",
  "#c28b5b", "#4db3a0", "#e0b457", "#79b89c",
];

export const DISTRICT_META = {
  campus:     { label: "学院区",     icon: "🎓", color: "#3b82f6", bg: "#14294a" },
  commercial: { label: "金融商业区", icon: "🏛️", color: "#f59e0b", bg: "#3b2809" },
  industrial: { label: "工业区",     icon: "⚙️", color: "#ea580c", bg: "#3a1b09" },
  harbor:     { label: "港口区",     icon: "⚓", color: "#06b6d4", bg: "#0a2e38" },
  encampment: { label: "军营防务",   icon: "🛡️", color: "#dc2626", bg: "#3b1114" },
  theater:    { label: "文旅剧院",   icon: "🎭", color: "#a855f7", bg: "#2e1646" },
  gov:        { label: "政务区",     icon: "🏯", color: "#eab308", bg: "#362a08" },
  holy:       { label: "人文圣地",   icon: "⛩️", color: "#e2d4ad", bg: "#2c281c" },
  spaceport:  { label: "航天科创港", icon: "🚀", color: "#6366f1", bg: "#1c1f4a" },
};

export const COVER_LABELS = [
  "水域/海洋",
  "冰川积雪",
  "高山苔原",
  "森林",
  "荒漠/灌丛",
  "草原",
  "稀疏草原",
  "农田耕地",
  "湿地",
  "城镇建成区",
];

export const RESOURCE_ICONS = {
  nuclear: "☢️",
  hydro: "💧",
  coal_plant: "🏭",
  wind: "🌬️",
  solar: "☀️",
  pumped_storage: "🔋",
  coal_mine: "⛏️",
  oil: "🛢️",
  gas: "🔥",
  rare_earths: "🧲",
  iron: "🪨",
  copper: "🔶",
  gold: "🪙",
  lithium: "⚡",
  tungsten: "🔩",
  bauxite: "🧱",
};

const EVEN_NEIGHBORS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
const ODD_NEIGHBORS  = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]];

export function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtPop(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(v >= 1e6 ? 0 : 1)}万`;
  return Math.round(v).toLocaleString("zh-CN");
}

export function fmtGdp(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  // Support both 亿元 (>100 and <1e7) or raw RMB (>1e8) gracefully
  const yi = v > 1e8 ? v / 1e8 : v;
  if (yi >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
  return `${Math.round(yi).toLocaleString("zh-CN")}亿`;
}

export function fmtMoney(n, suffix = "元") {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 10000) return `¥${(v / 10000).toFixed(2)}万${suffix === "元" ? "" : suffix}`;
  return `¥${Math.round(v).toLocaleString("zh-CN")}${suffix}`;
}

export function fmtPct(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const pct = Math.abs(v) <= 1 && v !== 0 ? v * 100 : v;
  return `${pct.toFixed(digits)}%`;
}

export function fmtPctVal(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n).toFixed(digits)}%`;
}

export function fmtShare(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(digits)}%`;
}

export function extractYieldNum(yVal) {
  if (typeof yVal === "number" && Number.isFinite(yVal)) return yVal;
  if (yVal && typeof yVal === "object") {
    const v = yVal.value ?? yVal.score ?? yVal.amount ?? yVal.val;
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  const n = Number(yVal);
  return Number.isFinite(n) ? n : 0;
}

export function fmtYieldVal(key, yVal) {
  if (yVal == null) return "—";
  if (typeof yVal === "object" && yVal.display) return String(yVal.display);
  const v = extractYieldNum(yVal);
  if (key === "gold") return fmtGdp(v);
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  if (v >= 100) return Math.round(v).toLocaleString("zh-CN");
  if (v >= 10) return v.toFixed(1);
  return v ? v.toFixed(2) : "0";
}

export function getGridMetrics(w) {
  const g = w?.grid || {};
  const R = Number(g.R || w?.R || 25 / Math.sqrt(3));
  const W = Number(g.W || w?.W || Math.sqrt(3) * R);
  const H_step = Number(g.H_step || w?.H_step || 1.5 * R);
  const cols = Number(g.cols || w?.cols || 0);
  const rows = Number(g.rows || w?.rows || 0);
  return { R, W, H_step, cols, rows };
}

export function cellXY(cell, grid) {
  const { W, H_step, cols } = grid;
  const r = Math.floor(cell / cols);
  const c = cell - r * cols;
  return {
    r,
    c,
    x: (c + (r & 1) * 0.5) * W,
    y: r * H_step,
  };
}

export function getNeighborCells(cell, grid) {
  const { cols, rows } = grid;
  const r = Math.floor(cell / cols);
  const c = cell - r * cols;
  const dirs = (r & 1) ? ODD_NEIGHBORS : EVEN_NEIGHBORS;
  const out = [];
  for (let d = 0; d < 6; d++) {
    const nc = c + dirs[d][0];
    const nr = r + dirs[d][1];
    if (nc >= 0 && nc < cols && nr >= 0 && nr < rows) {
      out.push(nr * cols + nc);
    } else {
      out.push(-1);
    }
  }
  return out;
}

export function hexCornerPoints(cx, cy, R) {
  const pts = [];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

export async function ensureCityViewData(app) {
  const names = ["districts", "nation", "resources", "wonders", "military", "infrastructure", "counties"];
  await Promise.all(
    names.map(async (name) => {
      if (app?.data?.[name]) return app.data[name];
      if (typeof app?.loadData === "function") {
        try {
          return await app.loadData(name);
        } catch {
          return null;
        }
      }
      return null;
    })
  );
  return app?.data || {};
}

export function getProvinceRegion(state) {
  if (!state) return "华东";
  if (state.region && REGION_ORDER.includes(state.region)) return state.region;
  const code = String(state.code || "");
  if (PROVINCE_REGIONS[code]) return PROVINCE_REGIONS[code];
  const r = String(state.region || "");
  for (const reg of REGION_ORDER) {
    if (r.includes(reg)) return reg;
  }
  return "华东";
}

export function getProvinceColor(provinceIdx, app = null) {
  const idx = Number(provinceIdx);
  if (!Number.isFinite(idx) || idx < 0) return "#c9a45c";
  if (typeof app?.w?.provinceColor === "function") {
    return app.w.provinceColor(idx);
  }
  return PROVINCE_COLORS[idx % PROVINCE_COLORS.length];
}

export function buildCityBadgeMap(app) {
  const map = {};
  const cities = app?.data?.cities || app?.state?.cities || [];
  const distCities = app?.data?.districts?.cities || {};
  for (const city of cities) {
    const d = distCities[city.id] || distCities[city.code] || distCities[city.name];
    const badge = d?.badge || city.badge;
    if (badge) {
      map[city.id] = badge;
      if (city.code) map[city.code] = badge;
      if (city.name) map[city.name] = badge;
    }
  }
  return map;
}

export function findStateIndex(idOrIdx, states) {
  if (!Array.isArray(states)) return -1;
  if (typeof idOrIdx === "number" && idOrIdx >= 0 && idOrIdx < states.length) {
    return idOrIdx;
  }
  const s = String(idOrIdx ?? "").trim();
  if (!s) return -1;
  if (/^\d+$/.test(s)) {
    const num = Number(s);
    if (num >= 0 && num < states.length) return num;
  }
  return states.findIndex(
    (st) =>
      String(st.code) === s ||
      st.name === s ||
      st.abbr === s ||
      st.name?.startsWith(s)
  );
}

export function findCity(cityOrId, cities) {
  if (!Array.isArray(cities)) return null;
  if (cityOrId && typeof cityOrId === "object") {
    return cities.find((c) => c.id === cityOrId.id || c.name === cityOrId.name) || cityOrId;
  }
  const s = String(cityOrId ?? "").trim();
  if (!s) return null;
  return (
    cities.find((c) => String(c.id) === s || String(c.code) === s || c.name === s || c.full === s) ||
    cities.find((c) => c.name?.includes(s)) ||
    null
  );
}

export function resolveCityDistrictRecord(city, districtsData) {
  if (!city || !districtsData) return null;
  const map = districtsData.cities || {};
  return (
    map[city.id] ||
    map[String(city.code || "")] ||
    map[city.name] ||
    map[city.full] ||
    null
  );
}

export function resolveProvinceDistrictRecord(state, provIdx, districtsData) {
  if (!state || !districtsData) return null;
  const map = districtsData.provinces || {};
  return (
    map[String(state.code || "")] ||
    map[String(provIdx)] ||
    map[state.name] ||
    map[state.abbr] ||
    null
  );
}

export function resolveTarget(kind, ref, app) {
  const states = app?.data?.states || app?.state?.states || [];
  const cities = app?.data?.cities || app?.state?.cities || [];
  const districtsData = app?.data?.districts || {};

  if (kind === "city") {
    const city = findCity(ref, cities);
    if (!city) return null;
    const provIdx = Number.isFinite(Number(city.province_idx))
      ? Number(city.province_idx)
      : findStateIndex(city.province_name || city.province_abbr, states);
    const state = states[provIdx] || null;
    const dist = resolveCityDistrictRecord(city, districtsData) ||
      (city.is_provincial_anchor ? resolveProvinceDistrictRecord(state, provIdx, districtsData) : null);
    const siblingCities = cities.filter((c) => Number(c.province_idx) === provIdx);
    return {
      kind: "city",
      id: String(city.id || city.code || city.name),
      key: `city:${city.id || city.name}`,
      name: city.full || city.name,
      shortName: city.name,
      abbr: state?.abbr || city.name?.slice(0, 1) || "城",
      provinceIdx: provIdx,
      state,
      city,
      siblingCities,
      badge: dist?.badge || city.badge || "",
      color: getProvinceColor(provIdx, app),
      metrics: city,
      districtData: dist,
    };
  }

  const provIdx = findStateIndex(ref, states);
  if (provIdx < 0) return null;
  const state = states[provIdx];
  const dist = resolveProvinceDistrictRecord(state, provIdx, districtsData);
  const siblingCities = cities.filter((c) => Number(c.province_idx) === provIdx);
  return {
    kind: "province",
    id: String(state.code ?? provIdx),
    key: `province:${state.code ?? provIdx}`,
    name: state.name,
    shortName: state.abbr || state.name,
    abbr: state.abbr || state.name?.slice(0, 1) || "省",
    provinceIdx: provIdx,
    state,
    city: siblingCities.find((c) => c.is_provincial_anchor) || siblingCities[0] || null,
    siblingCities,
    badge: dist?.badge || state.badge || "",
    color: getProvinceColor(provIdx, app),
    metrics: state,
    districtData: dist,
  };
}

export function computeFootprint(entity, app) {
  const w = app?.w || app?.data?.world;
  if (!w) return { cells: new Set(), cellList: [], centerCell: -1, cx: 0, cy: 0, bounds: { x0: 0, y0: 0, x1: 100, y1: 100 } };
  const grid = getGridMetrics(w);
  const owner = w.owner || [];
  const total = grid.cols * grid.rows;
  const cellSet = new Set();

  if (entity.kind === "city" && entity.city) {
    const c = entity.city;
    if (Array.isArray(c.footprint)) {
      for (const idx of c.footprint) {
        if (idx >= 0 && idx < total) cellSet.add(idx);
      }
    }
    if (Number.isFinite(Number(c.cell)) && Number(c.cell) >= 0) {
      cellSet.add(Number(c.cell));
    }
    if (Array.isArray(c.counties) && w.countyCells) {
      for (const ci of c.counties) {
        for (const idx of (w.countyCells[ci] || [])) {
          cellSet.add(idx);
        }
      }
    }
    // Ensure a cohesive multi-hex city footprint around the center if sparse
    if (cellSet.size < 5 && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y))) {
      const cx0 = Number(c.x);
      const cy0 = Number(c.y);
      const radiusSq = 48 * 48;
      const candidates = w.stateCells?.[entity.provinceIdx];
      if (Array.isArray(candidates) && candidates.length) {
        for (const i of candidates) {
          const p = cellXY(i, grid);
          const dx = p.x - cx0;
          const dy = p.y - cy0;
          if (dx * dx + dy * dy <= radiusSq) cellSet.add(i);
        }
      } else {
        for (let i = 0; i < total; i++) {
          if (owner[i] !== entity.provinceIdx) continue;
          const p = cellXY(i, grid);
          const dx = p.x - cx0;
          const dy = p.y - cy0;
          if (dx * dx + dy * dy <= radiusSq) cellSet.add(i);
        }
      }
    }
  } else {
    const provCells = w.stateCells?.[entity.provinceIdx];
    if (Array.isArray(provCells) && provCells.length) {
      for (const i of provCells) cellSet.add(i);
    } else {
      for (let i = 0; i < total; i++) {
        if (owner[i] === entity.provinceIdx) cellSet.add(i);
      }
    }
    if (cellSet.size === 0 && entity.state && Number.isFinite(Number(entity.state.cell))) {
      cellSet.add(Number(entity.state.cell));
    }
  }

  let centerCell = -1;
  if (entity.kind === "city" && entity.city && Number.isFinite(Number(entity.city.cell))) {
    centerCell = Number(entity.city.cell);
  } else if (entity.state && Number.isFinite(Number(entity.state.cell))) {
    centerCell = Number(entity.state.cell);
  } else if (entity.city && Number.isFinite(Number(entity.city.cell))) {
    centerCell = Number(entity.city.cell);
  }

  const cellList = Array.from(cellSet);
  if (centerCell < 0 && cellList.length > 0) {
    centerCell = cellList[Math.floor(cellList.length / 2)];
  }

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const idx of cellList) {
    const p = cellXY(idx, grid);
    if (p.x - grid.R < x0) x0 = p.x - grid.R;
    if (p.y - grid.R < y0) y0 = p.y - grid.R;
    if (p.x + grid.R > x1) x1 = p.x + grid.R;
    if (p.y + grid.R > y1) y1 = p.y + grid.R;
  }

  const centerPt = centerCell >= 0 ? cellXY(centerCell, grid) : {
    x: Number(entity.metrics?.x || (x0 + x1) / 2 || 0),
    y: Number(entity.metrics?.y || (y0 + y1) / 2 || 0),
  };

  if (!Number.isFinite(x0)) {
    x0 = centerPt.x - 60;
    x1 = centerPt.x + 60;
    y0 = centerPt.y - 60;
    y1 = centerPt.y + 60;
  }

  // Enforce generous minimum camera frame (~160km) so tiny SARs/cities have room for district plaques
  const minSpan = entity.kind === "city" ? 175 : 220;
  if (x1 - x0 < minSpan) {
    const midX = (x0 + x1) / 2;
    x0 = midX - minSpan / 2;
    x1 = midX + minSpan / 2;
  }
  if (y1 - y0 < minSpan) {
    const midY = (y0 + y1) / 2;
    y0 = midY - minSpan / 2;
    y1 = midY + minSpan / 2;
  }

  return {
    cells: cellSet,
    cellList,
    centerCell,
    cx: centerPt.x,
    cy: centerPt.y,
    bounds: { x0, y0, x1, y1 },
  };
}

export function layoutDistrictPlaques(entity, footprint, app) {
  const districts = entity?.districtData?.districts || [];
  if (!districts.length) return [];
  const w = app?.w || app?.data?.world;
  if (!w) return [];
  const grid = getGridMetrics(w);
  const owner = w.owner || [];
  const total = grid.cols * grid.rows;
  const centerCell = footprint.centerCell;
  if (centerCell < 0 || centerCell >= total) return [];

  // BFS outward up to ring 3 from centerCell to collect candidate hex slots
  const visited = new Set([centerCell]);
  const ringSlots = [];
  let frontier = [centerCell];

  for (let ring = 1; ring <= 4; ring++) {
    const next = [];
    for (const c of frontier) {
      const nbrs = getNeighborCells(c, grid);
      for (const nb of nbrs) {
        if (nb < 0 || visited.has(nb)) continue;
        visited.add(nb);
        next.push(nb);
        ringSlots.push({ cell: nb, ring });
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  // Prioritize: 1) inside footprint & land, 2) same province & land, 3) any China land, 4) any neighbor hex
  ringSlots.sort((a, b) => {
    const score = (slot) => {
      const inFoot = footprint.cells.has(slot.cell) ? 0 : 100;
      const inProv = owner[slot.cell] === entity.provinceIdx ? 0 : 50;
      const isLand = owner[slot.cell] >= 0 ? 0 : 25;
      const ringBias = slot.ring * 10;
      return inFoot + inProv + isLand + ringBias;
    };
    return score(a) - score(b);
  });

  // For provinces with large territory, spread plaques gracefully around ring 1..2 of capital
  // while keeping dual campus or flagship districts immediately visible near the core.
  const usedCells = new Set([centerCell]);
  const placements = [];

  for (let idx = 0; idx < districts.length; idx++) {
    const d = districts[idx];
    let chosen = null;
    for (const slot of ringSlots) {
      if (!usedCells.has(slot.cell)) {
        chosen = slot.cell;
        break;
      }
    }
    if (chosen == null) chosen = centerCell;
    usedCells.add(chosen);
    const pt = cellXY(chosen, grid);
    const meta = DISTRICT_META[d.type] || { label: "专业城区", icon: "🏛️", color: "#c9a45c", bg: "#1f2b3a" };
    placements.push({
      index: idx,
      district: d,
      meta,
      cell: chosen,
      x: pt.x,
      y: pt.y,
    });
  }

  return placements;
}

export function inspectHexCell(cellIdx, app) {
  const w = app?.w || app?.data?.world;
  if (!w || cellIdx == null || cellIdx < 0) return null;
  const ownerIdx = w.owner?.[cellIdx] ?? -1;
  const countyIdx = w.county?.[cellIdx] ?? -1;
  const cover = w.cover?.[cellIdx] ?? 0;
  const elev = w.elev?.[cellIdx] ?? 0;
  const state = ownerIdx >= 0 ? (app?.data?.states?.[ownerIdx] || w.states?.[ownerIdx]) : null;
  const countyRow = countyIdx >= 0 ? app?.data?.counties?.rows?.[countyIdx] : null;
  const countyMeta = countyIdx >= 0 ? w.counties?.[countyIdx] : null;

  let estPop = null;
  if (countyRow) {
    const cellCount = w.countyCells?.[countyIdx]?.length || 1;
    if (Number.isFinite(Number(countyRow.population)) && cellCount > 0) {
      estPop = Number(countyRow.population) / cellCount;
    } else if (Number.isFinite(Number(countyRow.density))) {
      estPop = Number(countyRow.density) * 541.27;
    }
  }

  const pct = w.pct || {};
  const pcts = {
    forest: pct.forest?.[cellIdx],
    crop: pct.crop?.[cellIdx],
    grass: pct.grass?.[cellIdx],
    shrub: pct.shrub?.[cellIdx],
    wetland: pct.wetland?.[cellIdx],
    developed: pct.developed?.[cellIdx],
    alpine: pct.alpine?.[cellIdx],
  };

  return {
    cell: cellIdx,
    ownerIdx,
    stateName: state?.name || (ownerIdx === -2 ? "境外陆地" : ownerIdx === -1 ? "海域" : `省级 #${ownerIdx}`),
    countyIdx,
    countyName: countyRow?.name || countyMeta?.name || "",
    cover,
    coverName: COVER_LABELS[cover] || "混合地貌",
    elev: Math.round(elev),
    estPop,
    pcts,
  };
}

export function collectLocalAssets(entity, footprint, app) {
  const data = app?.data || {};
  const w = app?.w || data.world;
  const provIdx = entity.provinceIdx;
  const cx = footprint.cx;
  const cy = footprint.cy;
  const maxRadiusKm = entity.kind === "city" ? 72 : 99999;

  const stripCitySuffix = (s) => String(s || "").trim().replace(/[市州盟]$/, "");
  const targetShortClean = stripCitySuffix(entity.shortName);

  const isLocal = (item) => {
    if (!item) return false;
    const itemCell = Number(item.cell);
    const hasCoords = Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y));
    const dist = hasCoords ? Math.hypot(Number(item.x) - cx, Number(item.y) - cy) : Infinity;

    if (entity.kind === "province") {
      if (Number.isFinite(Number(item.province_idx)) && Number(item.province_idx) === provIdx) return true;
      if (Number.isFinite(itemCell) && w?.owner?.[itemCell] === provIdx) return true;
      if (entity.state?.name && item.province === entity.state.name) return true;
      return false;
    }

    // City matching: footprint cell OR city name match OR radial proximity inside same province
    if (Number.isFinite(itemCell) && footprint.cells.has(itemCell)) return true;
    const itemCity = stripCitySuffix(item.city_name || item.city);
    if (targetShortClean && (itemCity === targetShortClean || String(item.name || "").includes(targetShortClean))) {
      if (!Number.isFinite(Number(item.province_idx)) || Number(item.province_idx) === provIdx) return true;
    }
    if (dist <= maxRadiusKm) {
      if (!Number.isFinite(Number(item.province_idx)) || Number(item.province_idx) === provIdx) return true;
      if (dist <= 35) return true;
    }
    return false;
  };

  const assets = [];
  const seen = new Set();
  const pushAsset = (a) => {
    const key = `${a.group}:${a.name}:${Math.round(a.x || 0)}:${Math.round(a.y || 0)}`;
    if (seen.has(key)) return;
    seen.add(key);
    assets.push(a);
  };

  // Wonders
  for (const wonder of (data.wonders?.wonders || [])) {
    if (!isLocal(wonder)) continue;
    const kindIcon = wonder.kind === "university" ? "🎓" : wonder.kind === "national_park" ? "🏞️" : wonder.kind === "megaproject" ? "🌉" : "🏯";
    const metric = wonder.metrics?.rd_bcny
      ? `研发 ${wonder.metrics.rd_bcny}亿`
      : wonder.metrics?.visits_m
        ? `${wonder.metrics.visits_m}百万人次`
        : wonder.rule || wonder.kind || "奇观";
    pushAsset({
      uid: `wonder-${wonder.id || wonder.name}`,
      group: "wonder",
      kind: wonder.kind || "wonder",
      icon: kindIcon,
      name: wonder.short || wonder.name,
      subtitle: wonder.description ? wonder.description.slice(0, 36) : (wonder.city_name || entity.shortName),
      metric,
      x: Number(wonder.x),
      y: Number(wonder.y),
      cell: Number(wonder.cell),
      raw: wonder,
    });
  }

  // Resources (power plants + mines)
  for (const res of (data.resources?.items || [])) {
    if (!isLocal(res)) continue;
    const t = res.type || res.kind || "";
    const icon = RESOURCE_ICONS[t] || "⚡";
    const metric = res.capacity_mw
      ? `${Math.round(res.capacity_mw).toLocaleString("zh-CN")} MW`
      : res.value != null && res.unit
        ? `${res.value} ${res.unit}`
        : res.output || res.reserves || res.scale || res.type_label || t;
    pushAsset({
      uid: `res-${res.name}-${res.cell}`,
      group: "resource",
      kind: t,
      icon,
      name: res.name,
      subtitle: res.type_label || res.fuel || res.commodity || t,
      metric: String(metric || ""),
      x: Number(res.x),
      y: Number(res.y),
      cell: Number(res.cell),
      raw: res,
    });
  }

  // Ports & Airports
  for (const port of (data.infrastructure?.ports || [])) {
    if (!isLocal(port)) continue;
    pushAsset({
      uid: `port-${port.name}`,
      group: "infra",
      kind: "port",
      icon: "⚓",
      name: port.name,
      subtitle: port.kind === "river" ? "内河大港" : "沿海深水港",
      metric: port.teu_m ? `${port.teu_m}M TEU` : port.cargo_mt ? `${port.cargo_mt}百万吨` : `Top ${port.rank || ""}`,
      x: Number(port.x),
      y: Number(port.y),
      cell: Number(port.cell),
      raw: port,
    });
  }

  for (const ap of (data.infrastructure?.airports || [])) {
    if (!isLocal(ap)) continue;
    pushAsset({
      uid: `ap-${ap.iata || ap.name}`,
      group: "infra",
      kind: "airport",
      icon: "✈️",
      name: ap.iata ? `${ap.name} (${ap.iata})` : ap.name,
      subtitle: "航空枢纽",
      metric: ap.pax_m ? `${ap.pax_m}M 人次` : ap.cargo_kt ? `${ap.cargo_kt}千吨` : "",
      x: Number(ap.x),
      y: Number(ap.y),
      cell: Number(ap.cell),
      raw: ap,
    });
  }

  // Military bases & ranges
  for (const base of (data.military?.installations || [])) {
    if (!isLocal(base)) continue;
    pushAsset({
      uid: `mil-${base.name}`,
      group: "military",
      kind: "base",
      icon: "🛡️",
      name: base.name,
      subtitle: [base.theater_name || base.theater, base.branch_name || base.branch].filter(Boolean).join(" · ") || "国防重地",
      metric: base.kind || base.role || base.branch_name || "基地",
      x: Number(base.x),
      y: Number(base.y),
      cell: Number(base.cell),
      raw: base,
    });
  }

  for (const rng of (data.military?.ranges || [])) {
    if (!isLocal(rng)) continue;
    pushAsset({
      uid: `rng-${rng.name}`,
      group: "military",
      kind: "range",
      icon: "🎯",
      name: rng.name,
      subtitle: rng.theater_name || rng.theater || "演训/试验靶场",
      metric: rng.radius_km ? `半径 ${rng.radius_km}km` : "训练区",
      x: Number(rng.x),
      y: Number(rng.y),
      cell: Number(rng.cell),
      raw: rng,
    });
  }

  // Prioritize wonders & major hubs first, cap giant provinces cleanly at 60 items while keeping all wonders
  const orderWeight = { wonder: 0, infra: 1, military: 2, resource: 3 };
  assets.sort((a, b) => (orderWeight[a.group] ?? 9) - (orderWeight[b.group] ?? 9));
  return assets.slice(0, 72);
}

export function findPeers(entity, app, limit = 5) {
  const pool = entity.kind === "city"
    ? (app?.data?.cities || app?.state?.cities || [])
    : (app?.data?.states || app?.state?.states || []);
  const m = entity.metrics;
  if (!m || !pool.length) return [];

  const lg = (v) => Math.log10(Math.max(1, Number(v || 1)));
  const selfGdp = lg(m.gdp);
  const selfPc = lg(m.gdp_per_capita);
  const selfPop = lg(m.population);
  const selfStem = Number(m.stem_share || 0.07);

  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    if (entity.kind === "city") {
      if (item.id === entity.id || item.name === entity.shortName) continue;
    } else {
      if (i === entity.provinceIdx || String(item.code) === String(entity.id)) continue;
    }
    const d =
      Math.pow(lg(item.gdp) - selfGdp, 2) * 1.4 +
      Math.pow(lg(item.gdp_per_capita) - selfPc, 2) * 1.8 +
      Math.pow(lg(item.population) - selfPop, 2) * 0.8 +
      Math.pow((Number(item.stem_share || 0.07) - selfStem) * 10, 2) * 0.7;

    scored.push({
      kind: entity.kind,
      ref: entity.kind === "city" ? (item.id || item.name) : i,
      name: item.name,
      sub: entity.kind === "city" ? (item.province_abbr || item.province_name || "") : (item.region || ""),
      item,
      score: d,
    });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit);
}

export function getNationalStemBenchmarks(app) {
  const nation = app?.data?.nation || {};
  const b = nation.benchmarks || {};
  const natOneIn = Number(b.national_stem_1_in || (nation.stem_share ? Math.round(1 / nation.stem_share) : 14));
  const natShare = Number(nation.stem_share || (1 / natOneIn));
  return {
    natOneIn,
    natShare,
    szOneIn: Number(b.shenzhen_stem_1_in || 5),
  };
}
