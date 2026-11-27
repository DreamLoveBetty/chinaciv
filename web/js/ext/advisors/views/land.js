// Advisor 6: 舆地测绘官 (Land & Ecology — 7 Land Cover Types across China, Regions & All 34 Provinces)
import { esc, fin, sum } from "../core/util.js";
import { dec, pct, int } from "../core/fmt.js";
import { shareBar, stackedBars, smallMultiples } from "../core/charts.js";
import { section, tiles, segmented, mapColorPicker, sourcesHtml } from "../core/view.js";

const LAND_KEYS = [
  { key: "forest", label: "森林", color: "#3d8c4b" },
  { key: "crop", label: "耕地", color: "#d6b84b" },
  { key: "grass", label: "草原草甸", color: "#89b854" },
  { key: "shrub", label: "荒漠灌丛", color: "#c99a5b" },
  { key: "alpine", label: "高寒冰雪岩漠", color: "#8ca8be" },
  { key: "wetland", label: "湿地水域", color: "#3b92b8" },
  { key: "developed", label: "城乡建设用地", color: "#d9674e" },
];

function computeProvLand(app, data) {
  const w = app.w;
  const pctObj = w?.pct;
  const scale = w?.pctScale ?? 1;
  const coverMap = {
    1: "alpine",
    2: "alpine",
    3: "forest",
    4: "shrub",
    5: "grass",
    6: "grass",
    7: "crop",
    8: "wetland",
    9: "developed",
  };

  const out = data.states.map((st) => {
    const cells = st.cells || w?.stateCells?.[st.idx] || [];
    const parts = { forest: 0, crop: 0, grass: 0, shrub: 0, alpine: 0, wetland: 0, developed: 0 };
    if (pctObj && cells.length) {
      for (const c of cells) {
        for (const k of LAND_KEYS) {
          const arr = pctObj[k.key] || (k.key === "crop" ? pctObj.cropland : null) || (k.key === "developed" ? pctObj.built : null);
          if (arr && fin(arr[c])) parts[k.key] += arr[c] * scale;
        }
      }
      const tot = Object.values(parts).reduce((a, b) => a + b, 0);
      if (tot > 0) {
        for (const k of Object.keys(parts)) parts[k] = (parts[k] / tot) * 100;
        return { st, parts, totalArea: st.area_km2 || cells.length * 541 };
      }
    }
    if (st.land && typeof st.land === "object") {
      const l = st.land;
      parts.forest = Number(l.forest_pct ?? l.forest ?? st.forest_pct ?? 0);
      parts.crop = Number(l.farmland_pct ?? l.cropland ?? l.crop ?? st.farmland_pct ?? 0);
      parts.grass = Number(l.grass_pct ?? l.grassland ?? l.grass ?? 0);
      parts.shrub = Number(l.shrub_pct ?? l.desert ?? l.shrub ?? 0);
      parts.alpine = Number(l.alpine_pct ?? l.alpine ?? 0);
      parts.wetland = Number(l.wetland_pct ?? l.wetland ?? 0);
      parts.developed = Number(l.developed_pct ?? l.developed ?? l.built ?? st.developed_pct ?? 0);
      const s = Object.values(parts).reduce((a, b) => a + b, 0);
      if (s > 0 && s <= 1.05) for (const k of Object.keys(parts)) parts[k] *= 100;
      return { st, parts, totalArea: st.area_km2 || cells.length * 541 };
    }
    // Fallback to cell cover classes
    if (w?.cover && cells.length) {
      let valid = 0;
      for (const c of cells) {
        const k = coverMap[w.cover[c]];
        if (k) {
          parts[k]++;
          valid++;
        }
      }
      if (valid > 0) for (const k of Object.keys(parts)) parts[k] = (parts[k] / valid) * 100;
    }
    return { st, parts, totalArea: st.area_km2 || cells.length * 541 };
  });

  // Area-weighted national percentages
  const natParts = { forest: 0, crop: 0, grass: 0, shrub: 0, alpine: 0, wetland: 0, developed: 0 };
  const natArea = sum(out, (x) => x.totalArea) || 1;
  for (const x of out) {
    for (const k of LAND_KEYS) {
      natParts[k.key] += (x.parts[k.key] || 0) * (x.totalArea / natArea);
    }
  }
  return { provLand: out, natParts, natArea };
}

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const { provLand, natParts, natArea } = computeProvLand(app, data);

  tiles(el, [
    { label: "全国陆地覆盖面积", value: `${(natArea / 1e4).toFixed(0)} 万km²`, sub: "25km六边形全境实测汇总" },
    { label: "森林 + 草原合计", value: pct(natParts.forest + natParts.grass, 1), sub: `森林 ${pct(natParts.forest, 1)} · 草原 ${pct(natParts.grass, 1)}`, color: "#7dd39d" },
    { label: "耕地 / 城乡建设用地", value: `${pct(natParts.crop, 1)} / ${pct(natParts.developed, 1)}`, sub: "主粮产区与城市群空间" },
  ]);

  mapColorPicker(
    el,
    ctx,
    [
      { value: "terrain", label: "自然地貌" },
      { value: "forest", label: "森林%" },
      { value: "farmland", label: "耕地%" },
      { value: "developed", label: "建成区%" },
    ],
    "forest",
    (v) => ctx.setLens(v === "terrain" ? null : v)
  );
  ctx.setLens("forest");

  // 1. National Land Mix
  const mixSec = section(el, {
    title: "全国国土覆被七大类型结构",
    note: "悬停类型色块可高亮该地貌分布最密集的省区。",
  });
  shareBar(mixSec, {
    parts: LAND_KEYS.map((k) => ({ key: k.key, label: k.label, color: k.color, value: natParts[k.key] })),
    fmt: (p) => pct(p.value, 1),
    onHover: (part) => {
      if (!part) return link.hover(null);
      const top = [...provLand].sort((a, b) => b.parts[part.key] - a.parts[part.key]).slice(0, 6);
      link.hover(data.levels.provinces.highlight(top.map((x) => x.st), { color: part.color, dimOthers: true, noBeacon: true }));
    },
  });

  // 2. Regional Small Multiples
  const regMap = new Map();
  for (const x of provLand) {
    const reg = x.st.region || "其他";
    if (!regMap.has(reg)) regMap.set(reg, []);
    regMap.get(reg).push(x);
  }
  const regRows = [...regMap.entries()].map(([reg, list]) => {
    const rArea = sum(list, (x) => x.totalArea) || 1;
    const parts = LAND_KEYS.map((k) => ({
      key: k.key,
      label: k.label,
      color: k.color,
      value: sum(list, (x) => x.parts[k.key] * x.totalArea) / rArea,
    }));
    const dom = [...parts].sort((a, b) => b.value - a.value)[0];
    return {
      key: reg,
      list,
      label: reg,
      sub: `主导:${dom?.label || ""}`,
      centerBig: `${Math.round(dom?.value || 0)}%`,
      parts,
    };
  });
  const regSec = section(el, { title: "各大区生态景观构成（微缩环形图）" });
  smallMultiples(regSec, {
    rows: regRows,
    onHover: (r) => {
      if (!r) return link.hover(null);
      link.hover(data.levels.provinces.highlight(r.list.map((x) => x.st), { dimOthers: true, noBeacon: true }));
    },
    onClick: (r) => {
      if (r?.list?.length) link.base(data.levels.provinces.highlight(r.list.map((x) => x.st), { dimOthers: true }));
    },
  });

  // 3. All 34 Provinces Stacked Bars
  const provSec = section(el, {
    title: "34 省级行政区用地覆被堆叠对比",
    note: "支持按任一用地类型排序；悬停单省或色段即可定位该省。",
  });
  let sortKey = "forest";
  segmented(provSec, {
    value: sortKey,
    options: [
      { value: "forest", label: "按森林" },
      { value: "crop", label: "按耕地" },
      { value: "grass", label: "按草原" },
      { value: "shrub", label: "按荒漠" },
      { value: "developed", label: "按城镇" },
    ],
    onChange: (v) => {
      sortKey = v;
      renderStacks();
    },
  });
  const stackHost = document.createElement("div");
  provSec.appendChild(stackHost);

  let stackChart = null;
  function renderStacks() {
    stackHost.innerHTML = "";
    const sorted = [...provLand].sort((a, b) => (b.parts[sortKey] || 0) - (a.parts[sortKey] || 0));
    stackChart = stackedBars(stackHost, {
      rows: sorted.map((x) => ({
        key: String(x.st.idx),
        st: x.st,
        label: x.st.name,
        full: x.st.full,
        parts: x.parts,
        total: 100,
        text: pct(x.parts[sortKey], 1),
      })),
      keys: LAND_KEYS,
      normalize: true,
      fmtPart: (v) => pct(v, 1),
      onHover: (hit) => {
        if (!hit?.row) return link.hover(null);
        link.hover(data.levels.provinces.highlight(hit.row.st));
      },
      onClick: (hit) => {
        if (hit?.row) data.levels.provinces.focus(hit.row.st);
      },
    });
  }
  renderStacks();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["mnr_land_survey", "nfga_forest_2024", "mee_ecology_2024"]), [
      "土地覆被比例由全国25km六边形栅格内的多源遥感覆被分类（森林、耕地、草地、灌丛荒漠、高寒冰雪、湿地水域、建设用地）归一化统计。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) return stackChart?.setHot(null);
      const p = data.levels.provinces.rowAtCell(cell);
      stackChart?.setHot(p ? String(p.idx) : null);
    },
  };
}
