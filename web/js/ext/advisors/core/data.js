// Unified data adapter exposing 3 geographical levels (34 Provinces, ~90 Cities, 1,302 Counties)
// plus lazy loading for energy, infrastructure, military, wonders, trade, districts, and sources.
import { fin, sum } from "./util.js";
import { frameBox } from "./frame.js?v=20261127-5";

const PROVINCE_FIELDS = [
  { key: "population", label: "总人口", short: "人口", format: "pop", unit: "人", group: "people", lens: "density" },
  { key: "area_km2", label: "陆地面积", short: "面积", format: "km2", unit: "km²", group: "land" },
  { key: "density", label: "人口密度", short: "密度", format: "dec1", unit: "人/km²", group: "people", lens: "density" },
  { key: "gdp", label: "地区生产总值", short: "GDP", format: "gdp_yi", unit: "亿元", group: "prosperity" },
  { key: "gdp_per_capita", label: "人均GDP", short: "人均GDP", format: "money", unit: "元", group: "prosperity" },
  { key: "growth", label: "五年人口/经济增速", short: "增速", format: "signed_pct", unit: "%", group: "prosperity" },
  { key: "disposable_income", label: "人均可支配收入", short: "可支配收入", format: "money", unit: "元", group: "prosperity", lens: "income" },
  { key: "home_price", label: "住宅均价", short: "房价", format: "money", unit: "元/㎡", group: "prosperity", lens: "home" },
  { key: "price_to_income", label: "房价收入比(30㎡/人)", short: "房价收入比", format: "dec1", unit: "年", group: "prosperity", description: "按人均30㎡住房总价 ÷ 人均可支配年收入估算" },
  { key: "urbanization", label: "城镇化率", short: "城镇化", format: "pct", unit: "%", group: "people" },
  { key: "median_age", label: "中位年龄", short: "中位年龄", format: "dec1", unit: "岁", group: "people", lens: "age" },
  { key: "bachelors_pct", label: "本科及以上学历占比", short: "本科率", format: "pct", unit: "%", group: "knowledge", lens: "bachelors" },
  { key: "broadband_pct", label: "千兆宽带普及率", short: "宽带%", format: "pct", unit: "%", group: "knowledge", lens: "broadband" },
  { key: "stem_share_pct", label: "STEM科研工程人才占比", short: "STEM%", format: "pct", unit: "%", group: "knowledge", lens: "stem" },
  { key: "stem_workers", label: "STEM人才规模", short: "STEM人数", format: "pop", unit: "人", group: "knowledge", lens: "stem" },
  { key: "migrant_pct", label: "外来常住人口占比", short: "流入%", format: "pct", unit: "%", group: "people", lens: "migrant" },
  { key: "low_income", label: "低收入关注比例", short: "低收入%", format: "pct", unit: "%", group: "prosperity", lens: "poverty" },
  { key: "commute_min", label: "平均通勤时长", short: "通勤", format: "dec1", unit: "分钟", group: "life", lens: "commute" },
  { key: "homeownership_pct", label: "自有住房率", short: "自有房%", format: "pct", unit: "%", group: "life", lens: "homeownership" },
  { key: "healthcare_gap_pct", label: "医疗资源缺口指数", short: "医疗缺口%", format: "pct", unit: "%", group: "life", lens: "healthcare_gap" },
  { key: "wellbeing", label: "健康福祉指数", short: "健康指数", format: "dec1", unit: "分", group: "hazards", lens: "wellbeing" },
  { key: "disasters", label: "地震与灾害次数", short: "灾害次数", format: "int", unit: "次", group: "hazards", lens: "disasters" },
  { key: "forest_pct", label: "森林覆盖率", short: "森林%", format: "pct", unit: "%", group: "land", lens: "forest" },
  { key: "farmland_pct", label: "耕地占比", short: "耕地%", format: "pct", unit: "%", group: "land", lens: "farmland" },
  { key: "developed_pct", label: "建成区占比", short: "建成区%", format: "pct", unit: "%", group: "land", lens: "developed" },
  { key: "energy_mw", label: "发电装机容量", short: "装机", format: "mw", unit: "MW", group: "prosperity" },
  { key: "wonders_count", label: "奇观与名胜数", short: "奇观数", format: "int", unit: "处", group: "life" },
];

const CITY_FIELDS = [
  { key: "province", label: "所属省区", short: "省份", type: "categorical", group: "people" },
  { key: "population", label: "常住人口", short: "人口", format: "pop", unit: "人", group: "people", lens: "density" },
  { key: "gdp", label: "地区生产总值", short: "GDP", format: "gdp_yi", unit: "亿元", group: "prosperity" },
  { key: "gdp_per_capita", label: "人均GDP", short: "人均GDP", format: "money", unit: "元", group: "prosperity" },
  { key: "growth", label: "近5年人口增速", short: "增速", format: "signed_pct", unit: "%", group: "people" },
  { key: "disposable_income", label: "人均可支配收入", short: "可支配收入", format: "money", unit: "元", group: "prosperity", lens: "income" },
  { key: "home_price", label: "住宅均价", short: "房价", format: "money", unit: "元/㎡", group: "prosperity", lens: "home" },
  { key: "price_to_income", label: "房价收入比(30㎡/人)", short: "房价收入比", format: "dec1", unit: "年", group: "prosperity", description: "按人均30㎡住房总价 ÷ 人均可支配年收入估算" },
  { key: "unemployment", label: "城镇调查失业率", short: "失业率", format: "pct", unit: "%", group: "prosperity" },
  { key: "stem_share_pct", label: "STEM人才占比", short: "STEM%", format: "pct", unit: "%", group: "knowledge", lens: "stem" },
  { key: "stem_workers", label: "STEM人才数", short: "STEM人数", format: "pop", unit: "人", group: "knowledge", lens: "stem" },
  { key: "energy_mw", label: "周边发电装机", short: "装机", format: "mw", unit: "MW", group: "prosperity" },
  { key: "wonders_count", label: "奇观与高校数", short: "奇观数", format: "int", unit: "处", group: "life" },
];

const DEFAULT_COUNTY_FIELDS = [
  { key: "province", label: "所属省区", short: "省份", type: "categorical", group: "people" },
  { key: "region", label: "所属大区", short: "大区", type: "categorical", group: "people" },
  { key: "population", label: "常住人口", short: "人口", format: "pop", unit: "人", group: "people", lens: "density" },
  { key: "area_km2", label: "面积", short: "面积", format: "km2", unit: "km²", group: "land" },
  { key: "density", label: "人口密度", short: "密度", format: "dec1", unit: "人/km²", group: "people", lens: "density" },
  { key: "gdp", label: "县域GDP", short: "GDP", format: "gdp_yi", unit: "亿元", group: "prosperity" },
  { key: "gdp_per_capita", label: "人均GDP", short: "人均GDP", format: "money", unit: "元", group: "prosperity" },
  { key: "income", label: "人均可支配收入", short: "可支配收入", format: "money", unit: "元", group: "prosperity", lens: "income" },
  { key: "home_price", label: "住宅均价", short: "房价", format: "money", unit: "元/㎡", group: "prosperity", lens: "home" },
  { key: "price_to_income", label: "房价收入比(30㎡/人)", short: "房价收入比", format: "dec1", unit: "年", group: "prosperity" },
  { key: "low_income", label: "低收入关注比例", short: "低收入%", format: "pct", unit: "%", group: "prosperity", lens: "poverty" },
  { key: "median_age", label: "中位年龄", short: "年龄", format: "dec1", unit: "岁", group: "people", lens: "age" },
  { key: "migrant_pct", label: "外来常住人口占比", short: "流入%", format: "pct", unit: "%", group: "people", lens: "migrant" },
  { key: "bachelors_pct", label: "本科以上学历占比", short: "本科%", format: "pct", unit: "%", group: "knowledge", lens: "bachelors" },
  { key: "broadband_pct", label: "千兆宽带普及率", short: "宽带%", format: "pct", unit: "%", group: "knowledge", lens: "broadband" },
  { key: "stem_pct", label: "STEM科研技术人才占比", short: "STEM%", format: "pct", unit: "%", group: "knowledge", lens: "stem" },
  { key: "commute_min", label: "平均通勤时长", short: "通勤", format: "dec1", unit: "分钟", group: "life", lens: "commute" },
  { key: "homeownership_pct", label: "自有住房率", short: "自有房%", format: "pct", unit: "%", group: "life", lens: "homeownership" },
  { key: "healthcare_gap_pct", label: "医疗资源缺口指数", short: "医疗缺口%", format: "pct", unit: "%", group: "life", lens: "healthcare_gap" },
  { key: "forest_pct", label: "森林覆盖率", short: "森林%", format: "pct", unit: "%", group: "land", lens: "forest" },
  { key: "farmland_pct", label: "耕地占比", short: "耕地%", format: "pct", unit: "%", group: "land", lens: "farmland" },
  { key: "developed_pct", label: "建成区占比", short: "建成区%", format: "pct", unit: "%", group: "land", lens: "developed" },
  { key: "faith_per100", label: "传统信仰场所密度", short: "民俗/百人", format: "dec2", unit: "‰", group: "faith", lens: "faith" },
  { key: "faith_tradition", label: "主导文化民俗传统", short: "民俗传统", type: "categorical", group: "faith", lens: "faith_tradition" },
  { key: "wellbeing", label: "健康福祉指数", short: "健康指数", format: "dec1", unit: "分", group: "hazards", lens: "wellbeing" },
  { key: "disasters", label: "历史强震与灾害次数", short: "灾害次数", format: "int", unit: "次", group: "hazards", lens: "disasters" },
];

export const GROUP_LABELS = {
  people: "人口与迁徙",
  prosperity: "经济民生",
  knowledge: "科教数字",
  life: "日常生活",
  land: "国土生态",
  faith: "信仰民俗",
  hazards: "灾害风险",
  military: "国防驻军",
};

function bboxFromCells(w, cells) {
  if (!w || !cells?.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    if (c < 0 || c >= w.N) continue;
    const x = w.cx(c);
    const y = w.cy(c);
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (!fin(x0)) return null;
  const pad = (w.R || 14.5) * 1.8;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export async function ensureDatasets(app, names = []) {
  const results = await Promise.all(
    names.map((n) => (app.data[n] ? Promise.resolve(app.data[n]) : app.loadData(n).catch(() => null)))
  );
  return results;
}

export function buildData(app) {
  const w = app.w;
  const rawStates = app.data.states || [];
  const rawCities = app.data.cities || [];
  const rawCounties = app.data.counties || {};
  const nation = app.data.nation || {};
  const lensList = app.data.lenses?.lenses || [];
  const lensMap = new Map(lensList.map((l) => [l.id, l]));

  // Normalize county rows
  const countyMeta = w?.counties || [];
  const countyRows = (rawCounties.rows || []).map((r, i) => {
    const idx = r.idx ?? i;
    const meta = countyMeta[idx] || {};
    const provIdx = r.province_idx ?? meta.province_idx ?? 0;
    const prov = rawStates[provIdx];
    const cells = w?.countyCells?.[idx] || meta.cells || [];
    const area_km2 = fin(r.area_km2) && r.area_km2 > 0 ? r.area_km2 : fin(meta.area_km2) ? meta.area_km2 : Math.max(1, cells.length * 541);
    const pop = fin(r.population) ? r.population : 0;
    const density = fin(r.density) ? r.density : area_km2 > 0 ? pop / area_km2 : 0;
    const pti =
      fin(r.price_to_income)
        ? r.price_to_income
        : fin(r.home_price) && fin(r.income) && r.income > 0
          ? (r.home_price * 30) / r.income
          : null;
    return {
      ...r,
      idx,
      key: String(r.code ?? meta.code ?? idx),
      name: r.name || meta.name || `县#${idx}`,
      province_idx: provIdx,
      province: r.province || prov?.abbr || prov?.name || "",
      region: r.region || prov?.region || "",
      sub: r.province || prov?.abbr || "",
      full: `${r.name || meta.name}（${r.province || prov?.name || ""}）`,
      area_km2,
      density,
      price_to_income: pti,
      cells,
    };
  });

  // Aggregate county area & cover onto states if missing
  const provArea = new Float64Array(34);
  const provCountyCount = new Int32Array(34);
  for (const cr of countyRows) {
    if (cr.province_idx >= 0 && cr.province_idx < 34) {
      provArea[cr.province_idx] += cr.area_km2 || 0;
      provCountyCount[cr.province_idx]++;
    }
  }

  const provRows = rawStates.map((st, idx) => {
    const cells = w?.stateCells?.[idx] || st.cells || [];
    const area_km2 = fin(st.area_km2) && st.area_km2 > 0 ? st.area_km2 : provArea[idx] > 0 ? provArea[idx] : Math.max(1, cells.length * 541);
    const stemShare = fin(st.stem_share) ? (st.stem_share <= 1 ? st.stem_share * 100 : st.stem_share) : null;
    const pti =
      fin(st.price_to_income)
        ? st.price_to_income
        : fin(st.home_price) && fin(st.disposable_income) && st.disposable_income > 0
          ? (st.home_price * 30) / st.disposable_income
          : null;
    const land = st.land || {};
    return {
      ...st,
      idx,
      key: String(st.code || idx),
      name: st.abbr || st.name || `省#${idx}`,
      full: st.name || st.abbr,
      sub: st.region || "",
      cells,
      area_km2,
      density: fin(st.density) ? st.density : area_km2 > 0 && fin(st.population) ? st.population / area_km2 : 0,
      stem_share_pct: stemShare,
      price_to_income: pti,
      forest_pct: fin(st.forest_pct) ? st.forest_pct : fin(land.forest) ? (land.forest <= 1 ? land.forest * 100 : land.forest) : null,
      farmland_pct: fin(st.farmland_pct) ? st.farmland_pct : fin(land.cropland) ? (land.cropland <= 1 ? land.cropland * 100 : land.cropland) : fin(land.crop) ? (land.crop <= 1 ? land.crop * 100 : land.crop) : null,
      developed_pct: fin(st.developed_pct) ? st.developed_pct : fin(land.developed) ? (land.developed <= 1 ? land.developed * 100 : land.developed) : fin(land.built) ? (land.built <= 1 ? land.built * 100 : land.built) : null,
      county_count: provCountyCount[idx],
      energy_mw: st.energy_mw ?? 0,
      wonders_count: st.wonders_count ?? 0,
    };
  });

  const cityRows = rawCities.map((c, idx) => {
    const prov = provRows[c.province_idx];
    const cells = Array.isArray(c.footprint) && c.footprint.length
      ? c.footprint
      : Array.isArray(c.counties) && c.counties.length && w?.countyCells
        ? c.counties.flatMap((ci) => w.countyCells[ci] || [])
        : c.cell >= 0
          ? [c.cell]
          : [];
    const stemShare = fin(c.stem_share) ? (c.stem_share <= 1 ? c.stem_share * 100 : c.stem_share) : null;
    const pti =
      fin(c.price_to_income)
        ? c.price_to_income
        : fin(c.home_price) && fin(c.disposable_income) && c.disposable_income > 0
          ? (c.home_price * 30) / c.disposable_income
          : null;
    return {
      ...c,
      idx,
      key: String(c.id || c.code || c.name || idx),
      name: c.name || c.full || `城市#${idx}`,
      full: c.full || c.name,
      sub: c.province_abbr || prov?.abbr || c.province_name || "",
      province: c.province_name || prov?.name || "",
      cells,
      stem_share_pct: stemShare,
      price_to_income: pti,
      energy_mw: c.energy_mw ?? 0,
      wonders_count: c.wonders_count ?? 0,
    };
  });

  // Merge fields from counties.json metadata if supplied
  const rawFields = Array.isArray(rawCounties.fields) && rawCounties.fields.length ? rawCounties.fields : null;
  const countyFields = (() => {
    const map = new Map(DEFAULT_COUNTY_FIELDS.map((f) => [f.key, { ...f }]));
    if (rawFields) {
      for (const rf of rawFields) {
        if (!rf?.key) continue;
        const prev = map.get(rf.key) || {};
        map.set(rf.key, {
          ...prev,
          ...rf,
          short: rf.short || prev.short || rf.label || rf.key,
          group: rf.group || prev.group || "people",
          lens: rf.lens || prev.lens || (lensMap.has(rf.key) ? rf.key : null),
          type: rf.type || (rf.key === "province" || rf.key === "region" || rf.key === "faith_tradition" ? "categorical" : prev.type || "numeric"),
        });
      }
    }
    return [...map.values()].filter((f) => f.key !== "code" && f.key !== "name" && f.key !== "province_idx");
  })();

  const makeLevel = (id, label, singular, rows, fields, extra = {}) => {
    const fMap = new Map(fields.map((f) => [f.key, f]));
    const byKey = new Map(rows.map((r) => [String(r.key), r]));
    return {
      id,
      label,
      singular,
      rows,
      fields,
      field: (k) => fMap.get(k) || null,
      byKey: (k) => byKey.get(String(k)) || null,
      ...extra,
    };
  };

  const cityByCell = new Map();
  for (const c of cityRows) {
    for (const cell of c.cells) {
      if (!cityByCell.has(cell)) cityByCell.set(cell, c);
    }
  }

  const levels = {
    provinces: makeLevel("provinces", "34 省级行政区", "省区", provRows, PROVINCE_FIELDS, {
      highlight(rows, opts = {}) {
        const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
        if (!list.length) return null;
        return {
          states: list.map((r) => r.idx),
          cells: list.flatMap((r) => r.cells || []),
          label: list.length === 1 ? list[0].full || list[0].name : `${list.length} 个省级行政区`,
          ...opts,
        };
      },
      rowAtCell(cell) {
        if (!w || cell == null || cell < 0) return null;
        const ow = w.owner[cell];
        return ow >= 0 ? provRows[ow] || null : null;
      },
      focus(row) {
        if (!row) return;
        if (typeof app.focusState === "function") app.focusState(row.idx);
        else {
          const sb = w?.stateBounds?.[row.idx];
          if (sb) frameBox(app, sb.x0, sb.y0, sb.x1, sb.y1);
        }
      },
    }),

    cities: makeLevel("cities", `主要城市 (${cityRows.length})`, "城市", cityRows, CITY_FIELDS, {
      highlight(rows, opts = {}) {
        const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
        if (!list.length) return null;
        const cellSet = new Set();
        for (const r of list) for (const c of r.cells || []) cellSet.add(c);
        return {
          cities: list,
          cells: [...cellSet],
          label: list.length === 1 ? list[0].name : `${list.length} 座城市`,
          ...opts,
        };
      },
      rowAtCell(cell) {
        if (!w || cell == null || cell < 0) return null;
        const direct = cityByCell.get(cell);
        if (direct) return direct;
        const wx = w.cx(cell);
        const wy = w.cy(cell);
        let best = null;
        let bestD2 = 75 * 75;
        for (const c of cityRows) {
          if (!fin(c.x) || !fin(c.y)) continue;
          const d2 = (c.x - wx) ** 2 + (c.y - wy) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = c;
          }
        }
        return best;
      },
      focus(row) {
        if (!row) return;
        if (typeof app.focusCity === "function") app.focusCity(row);
        else {
          const box = bboxFromCells(w, row.cells);
          if (box) frameBox(app, box.x0, box.y0, box.x1, box.y1);
        }
      },
    }),

    counties: makeLevel("counties", `1,302 个县`, "县域", countyRows, countyFields, {
      highlight(rows, opts = {}) {
        const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
        if (!list.length) return null;
        const cellSet = new Set();
        const cIdxs = [];
        for (const r of list) {
          cIdxs.push(r.idx);
          for (const c of r.cells || []) cellSet.add(c);
        }
        return {
          counties: cIdxs,
          cells: [...cellSet],
          label: list.length === 1 ? list[0].full || list[0].name : `${list.length} 个县级单元`,
          ...opts,
        };
      },
      rowAtCell(cell) {
        if (!w || cell == null || cell < 0) return null;
        const ci = w.county[cell];
        if (ci >= 0 && countyRows[ci]) return countyRows[ci];
        return null;
      },
      focus(row) {
        if (!row) return;
        const box = bboxFromCells(w, row.cells);
        if (box) frameBox(app, box.x0, box.y0, box.x1, box.y1);
      },
    }),
  };

  // Enrich provinces/cities once extra datasets arrive
  let extended = false;
  async function extendWithInfraAndMilitary() {
    if (extended) return;
    await ensureDatasets(app, ["resources", "military", "wonders", "infrastructure", "trade"]);
    const resItems = app.data.resources?.items || [];
    const wonders = app.data.wonders?.wonders || [];
    const mil = app.data.military || {};
    const provMw = new Float64Array(34);
    const provWonders = new Int32Array(34);

    for (const it of resItems) {
      if (it.capacity_mw && it.province_idx >= 0 && it.province_idx < 34) {
        provMw[it.province_idx] += it.capacity_mw;
      }
    }
    for (const wd of wonders) {
      if (wd.province_idx >= 0 && wd.province_idx < 34) {
        provWonders[wd.province_idx]++;
      }
    }
    for (const pr of provRows) {
      if (!pr.energy_mw && provMw[pr.idx]) pr.energy_mw = Math.round(provMw[pr.idx]);
      if (!pr.wonders_count && provWonders[pr.idx]) pr.wonders_count = provWonders[pr.idx];
      const mp = mil.provinces?.[pr.code] || mil.provinces?.[String(pr.idx)];
      if (mp) {
        pr.defense_bases = mp.installations ?? mp.bases ?? 0;
      }
    }
    // City-level proximity count within 60 km for power plants and wonders
    for (const cr of cityRows) {
      if (!fin(cr.x) || !fin(cr.y)) continue;
      let mw = 0;
      let wc = 0;
      for (const it of resItems) {
        if (it.capacity_mw && fin(it.x) && fin(it.y) && Math.hypot(it.x - cr.x, it.y - cr.y) <= 85) {
          mw += it.capacity_mw;
        }
      }
      for (const wd of wonders) {
        if (wd.city_name === cr.name || (fin(wd.x) && fin(wd.y) && Math.hypot(wd.x - cr.x, wd.y - cr.y) <= 75)) {
          wc++;
        }
      }
      if (!cr.energy_mw) cr.energy_mw = Math.round(mw);
      if (!cr.wonders_count) cr.wonders_count = wc;
    }
    extended = true;
  }

  return {
    app,
    w,
    nation,
    states: provRows,
    cities: cityRows,
    counties: countyRows,
    levels,
    provinceByCode: new Map(provRows.map((s) => [String(s.code), s])),
    provinceByIdx: provRows,
    extendWithInfraAndMilitary,
    sourcesById(ids = []) {
      const all = Array.isArray(app.data.sources) ? app.data.sources : app.data.sources?.sources || [];
      if (!ids.length) return all;
      const set = new Set(ids);
      const matched = all.filter((s) => set.has(s.id));
      return matched.length ? matched : all.slice(0, 6);
    },
  };
}
