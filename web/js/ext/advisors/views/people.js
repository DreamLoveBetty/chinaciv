// Advisor 3: 户籍大司徒 (People — Hu Huanyong Line East vs West, Density, Migration, Age)
import { esc, fin, sum } from "../core/util.js";
import { fmtPop, dec, pct, signedPct, int } from "../core/fmt.js";
import { ensureDatasets } from "../core/data.js?v=20261127-5";
import { shareBar, barList, histogram } from "../core/charts.js";
import { section, tiles, callout, segmented, mapColorPicker, sourcesHtml } from "../core/view.js";

// Exact Heihe (4441.5, 493.7) <-> Tengchong (2170.0, 3483.1) straight line in China Albers km space (Y increases downward)
const HEIHE_XY = [4441.5, 493.7];
const TENGCHONG_XY = [2170.0, 3483.1];
const WEST_PROVINCE_INDICES = new Set([4, 25, 27, 28, 29, 30]); // fallback if x/y absent

function isEastOfHuLine(county, geoMeta) {
  const x = county.x ?? geoMeta?.x;
  const y = county.y ?? geoMeta?.y;
  if (fin(x) && fin(y)) {
    const xLine =
      TENGCHONG_XY[0] +
      ((y - TENGCHONG_XY[1]) * (HEIHE_XY[0] - TENGCHONG_XY[0])) / (HEIHE_XY[1] - TENGCHONG_XY[1]);
    return x >= xLine;
  }
  return !WEST_PROVINCE_INDICES.has(county.province_idx);
}

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await ensureDatasets(app, ["geo_lookup"]);
  const geoCounties = app.data.geo_lookup?.counties || [];
  const nation = data.nation || {};
  const states = data.states || [];
  const counties = data.counties || [];

  const totalPop = fin(nation.population) ? nation.population : sum(states, (s) => s.population);

  // Split 1,302 counties across Hu Huanyong Line
  const eastCounties = [];
  const westCounties = [];
  for (let i = 0; i < counties.length; i++) {
    const c = counties[i];
    const gm = geoCounties[c.idx ?? i];
    if (isEastOfHuLine(c, gm)) eastCounties.push(c);
    else westCounties.push(c);
  }
  const eastPop = sum(eastCounties, (c) => c.population);
  const westPop = sum(westCounties, (c) => c.population);
  const huTotalPop = eastPop + westPop || 1;
  const eastArea = sum(eastCounties, (c) => c.area_km2);
  const westArea = sum(westCounties, (c) => c.area_km2);
  const huTotalArea = eastArea + westArea || 1;

  const avgAge =
    sum(states, (s) => (s.median_age || 38.8) * (s.population || 0)) / (sum(states, (s) => s.population) || 1);

  tiles(el, [
    { label: "全国常住人口", value: fmtPop(totalPop), sub: `城镇化率 ${pct(nation.urbanization ?? 67, 1)}` },
    { label: "胡焕庸线东南侧人口", value: pct((eastPop / huTotalPop) * 100, 1), sub: `占地面积 ${pct((eastArea / huTotalArea) * 100, 1)}`, color: "#e89f6b" },
    { label: "全国人口中位年龄", value: `${dec(avgAge, 1)} 岁`, sub: "七普与年度人口抽样校正" },
  ]);

  let activeLens = "density";
  mapColorPicker(
    el,
    ctx,
    [
      { value: "density", label: "人口密度" },
      { value: "migrant", label: "人口流入%" },
      { value: "age", label: "中位年龄" },
    ],
    activeLens,
    (v) => {
      activeLens = v;
      ctx.setLens(v);
    }
  );
  ctx.setLens("density");

  // 1. Hu Huanyong Line East vs West interactive bar
  const huSec = section(el, {
    title: "胡焕庸线（黑河—腾冲线）东西对比",
    note: `跨 1,302 个县实时汇总：线东南侧 ${eastCounties.length} 个县汇聚了 ${fmtPop(eastPop)}，西北侧 ${westCounties.length} 个县占地 ${pct((westArea / huTotalArea) * 100, 1)} 却仅占 ${pct((westPop / huTotalPop) * 100, 1)} 人口。`,
  });
  shareBar(huSec, {
    parts: [
      { key: "east", label: `胡线东南 (${eastCounties.length}县)`, color: "#e07a52", value: eastPop },
      { key: "west", label: `胡线西北 (${westCounties.length}县)`, color: "#4e7fa8", value: westPop },
    ],
    fmt: (p, tot) => `${fmtPop(p.value)} (${((p.value / (tot || 1)) * 100).toFixed(1)}%)`,
    onHover: (part) => {
      if (!part) return link.hover(null);
      const subset = part.key === "east" ? eastCounties : westCounties;
      link.hover(data.levels.counties.highlight(subset, { color: part.color, dimOthers: true, noBeacon: true }));
    },
    onClick: (part) => {
      const subset = part.key === "east" ? eastCounties : westCounties;
      link.base(data.levels.counties.highlight(subset, { color: part.color, dimOthers: true }));
    },
  });

  // 2. Provincial rankings (density / migrant / age / growth)
  const provSec = section(el, { title: "34省人口密度、迁移与年龄结构" });
  let metric = "density";
  segmented(provSec, {
    value: metric,
    options: [
      { value: "density", label: "密度" },
      { value: "population", label: "总人口" },
      { value: "migrant_pct", label: "外来流入%" },
      { value: "median_age", label: "中位年龄" },
    ],
    onChange: (v) => {
      metric = v;
      const lensMap = { density: "density", population: "density", migrant_pct: "migrant", median_age: "age" };
      ctx.setLens(lensMap[v]);
      renderProvBars();
    },
  });
  const provHost = document.createElement("div");
  provSec.appendChild(provHost);

  // Precompute province migrant_pct from county population-weighted average if missing on states
  const provMigrant = new Map();
  for (const st of states) {
    if (fin(st.migrant_pct)) {
      provMigrant.set(st.idx, st.migrant_pct);
    } else {
      const cs = counties.filter((c) => c.province_idx === st.idx);
      const popSum = sum(cs, (c) => c.population);
      const avgMig = popSum > 0 ? sum(cs, (c) => (c.migrant_pct || 0) * (c.population || 0)) / popSum : 0;
      provMigrant.set(st.idx, avgMig);
    }
  }

  let provBars = null;
  function renderProvBars() {
    provHost.innerHTML = "";
    const valOf = (st) => (metric === "migrant_pct" ? provMigrant.get(st.idx) || 0 : st[metric] || 0);
    const rows = [...states]
      .sort((a, b) => valOf(b) - valOf(a))
      .map((st) => ({
        key: String(st.idx),
        st,
        label: st.name,
        sub: st.region,
        value: valOf(st),
        text:
          metric === "density"
            ? `${int(valOf(st))} 人/km²`
            : metric === "population"
              ? fmtPop(valOf(st))
              : metric === "migrant_pct"
                ? pct(valOf(st), 1)
                : `${dec(valOf(st), 1)} 岁`,
        color: metric === "migrant_pct" ? "#5fbf8e" : metric === "median_age" ? "#c9a45c" : "#c46a4f",
      }));

    provBars = barList(provHost, {
      rows,
      rank: true,
      onHover: (row) => {
        if (!row) return link.hover(null);
        link.hover(data.levels.provinces.highlight(row.st));
      },
      onClick: (row) => data.levels.provinces.focus(row.st),
    });
  }

  // 3. County distribution histogram (1,302 counties)
  const histSec = section(el, {
    title: "1,302 个县人口密度分布（对数分箱）",
    note: "悬停直方图柱体，即时在地图上高亮该密度区间的全部县级行政区。",
  });
  histogram(histSec, {
    items: counties,
    value: (c) => c.density,
    log: true,
    bins: 18,
    color: "#c46a4f",
    fmt: (v) => `${v >= 100 ? int(v) : dec(v, 1)}`,
    onHover: (bin) => {
      if (!bin || !bin.items.length) return link.hover(null);
      link.hover(
        data.levels.counties.highlight(bin.items, {
          dimOthers: true,
          noBeacon: true,
          label: `${bin.items.length} 个县`,
        })
      );
    },
    onClick: (bin) => {
      if (!bin?.items?.length) return;
      link.base(data.levels.counties.highlight(bin.items, { dimOthers: true }));
    },
  });

  renderProvBars();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["nbs_census_7th", "nbs_2024_communique", "datav_geoatlas"]), [
      "胡焕庸线按中国阿尔伯斯等面积圆锥投影坐标下的黑河（4441.5, 493.7 km）至腾冲（2170.0, 3483.1 km）直线对1,302个县级单元实测划分。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) {
        provBars?.setHot(null);
        return;
      }
      const p = data.levels.provinces.rowAtCell(cell);
      provBars?.setHot(p ? String(p.idx) : null);
    },
  };
}
