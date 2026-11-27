// Advisor 9: 太常礼官 (Culture, Wonders & Hazards — Wonders by Public Rules, Traditions, Wellbeing & Disasters)
import { esc, fin, sum, CAT_COLORS } from "../core/util.js";
import { dec, int, pct } from "../core/fmt.js";
import { ensureDatasets } from "../core/data.js?v=20261127-5";
import { shareBar, barList } from "../core/charts.js";
import { section, tiles, segmented, mapColorPicker, sourcesHtml } from "../core/view.js";

const KIND_META = {
  national_park: { label: "国家公园与自然遗产", color: "#5fbf8e", desc: "按国家公园体制与年游客访问量遴选" },
  university: { label: "顶尖研究型大学", color: "#4a86d6", desc: "按年度研发经费(R&D)公开排名遴选" },
  cultural: { label: "世界文化遗产与国宝", color: "#e0b54c", desc: "UNESCO世界遗产与中华文明地标" },
  megaproject: { label: "超级工程奇观", color: "#d98a2b", desc: "国家级重大交通、水利与科学工程" },
};

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await ensureDatasets(app, ["wonders"]);
  const wondObj = app.data.wonders || {};
  const wonders = wondObj.wonders || [];
  const rules = wondObj.rules || [];
  const counties = data.counties || [];
  const states = data.states || [];

  const totalDisasters = sum(counties, (c) => c.disasters || 0);
  const avgWellbeing =
    sum(counties, (c) => (c.wellbeing || 0) * (c.population || 0)) / (sum(counties, (c) => c.population) || 1);

  tiles(el, [
    { label: "收录中华文明奇观", value: `${wonders.length} 处`, sub: "严格依四大公开客观规则遴选" },
    { label: "健康福祉指数均值", value: `${dec(avgWellbeing, 1)} 分`, sub: "卫健委/CDC健康水平综合评估", color: "#c25b9a" },
    { label: "2000年以来地震与灾害记录", value: `${int(totalDisasters)} 次`, sub: "USGS M≥4.5地震+地质气象灾害" },
  ]);

  mapColorPicker(
    el,
    ctx,
    [
      { value: "faith_tradition", label: "民俗传统" },
      { value: "faith", label: "信仰密度" },
      { value: "wellbeing", label: "健康福祉" },
      { value: "disasters", label: "地震灾害" },
    ],
    "faith_tradition",
    (v) => ctx.setLens(v)
  );
  ctx.setLens("faith_tradition");

  // 1. Wonders grouped by explicit public rules
  const wSec = section(el, {
    title: "四大公开规则遴选奇观榜",
    note: "每一类奇观均遵循可核验的公开准入标准，杜绝主观臆断。",
  });
  if (rules.length) {
    const ul = document.createElement("ol");
    ul.className = "adv-olist adv-rule";
    ul.innerHTML = rules
      .map((r) => `<li><b>${esc(r.label || r.title || r.kind || "")}：</b>${esc(r.text || r.rule || r.description || String(r))}</li>`)
      .join("");
    wSec.appendChild(ul);
  }

  let wKind = "national_park";
  const kinds = Object.keys(KIND_META).filter((k) => wonders.some((w) => w.kind === k));
  if (!kinds.includes(wKind) && kinds.length) wKind = kinds[0];

  segmented(wSec, {
    value: wKind,
    options: kinds.map((k) => ({ value: k, label: KIND_META[k].label.replace(/与.*/, "") })),
    onChange: (v) => {
      wKind = v;
      renderWonders();
    },
  });
  const wHost = document.createElement("div");
  wSec.appendChild(wHost);

  const wBubbles = ctx.bubbles("wonders-loc", {
    onHover: (b) => {
      if (!b) return link.hover(null);
      wBars?.setHot(b.key);
      if (b.cell >= 0) link.hover({ cells: [b.cell], label: b.label, color: b.color });
    },
    onClick: (b) => {
      if (fin(b.x) && fin(b.y) && app.fitBounds) app.fitBounds(b.x - 140, b.y - 100, b.x + 140, b.y + 100, { animate: true });
    },
    tip: (b) =>
      `<b>${esc(b.wonder.name)}</b> <span class="sub">(${esc(b.wonder.city_name || "")})</span><br>${esc(b.wonder.description || "")}`,
  });

  let wBars = null;
  function renderWonders() {
    wHost.innerHTML = "";
    const list = wonders.filter((w) => w.kind === wKind);
    const col = KIND_META[wKind]?.color || "#c25b9a";
    const valOf = (w, i) =>
      w.metrics?.visits_m ?? w.metrics?.rd_bcny ?? w.visits_m ?? w.rd_bcny ?? Math.max(1, list.length - i);
    const txtOf = (w) => {
      if (w.metrics?.visits_m ?? w.visits_m) return `${dec(w.metrics?.visits_m ?? w.visits_m, 1)}M 游客/年`;
      if (w.metrics?.rd_bcny ?? w.rd_bcny) return `¥${dec(w.metrics?.rd_bcny ?? w.rd_bcny, 1)}亿 R&D`;
      return w.metrics?.highlight || `#${w.rank || ""}`;
    };

    wBubbles.setItems(
      list.map((w, idx) => ({
        key: String(w.id || idx),
        wonder: w,
        cell: w.cell,
        x: w.x,
        y: w.y,
        r: 9,
        color: col,
        label: w.short || w.name,
      }))
    );

    wBars = barList(wHost, {
      rows: list.map((w, idx) => ({
        key: String(w.id || idx),
        wonder: w,
        label: w.name,
        sub: w.city_name || states[w.province_idx]?.abbr || "",
        value: valOf(w, idx),
        text: txtOf(w),
        color: col,
      })),
      rank: true,
      compact: true,
      onHover: (row) => {
        if (!row) {
          wBubbles.setHot(null);
          return link.hover(null);
        }
        wBubbles.setHot(row.key);
        if (row.wonder.cell >= 0) link.hover({ cells: [row.wonder.cell], label: row.label, color: col });
      },
      onClick: (row) => {
        const w = row.wonder;
        if (fin(w.x) && fin(w.y) && app.fitBounds) app.fitBounds(w.x - 130, w.y - 95, w.x + 130, w.y + 95, { animate: true });
      },
    });
  }
  renderWonders();

  // 2. Faith & Cultural Tradition breakdown across 1,302 counties
  const tradSec = section(el, {
    title: "传统民俗与信仰文化圈构成（按县域人口）",
    note: "悬停文化圈可高亮对应传统覆盖的全部县级行政区。",
  });
  const tradPop = new Map();
  const tradCounties = new Map();
  for (const c of counties) {
    const tr = c.faith_tradition || "儒道民俗";
    tradPop.set(tr, (tradPop.get(tr) || 0) + (c.population || 0));
    if (!tradCounties.has(tr)) tradCounties.set(tr, []);
    tradCounties.get(tr).push(c);
  }
  const tradParts = [...tradPop.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({
      key: k,
      label: k,
      color: CAT_COLORS[i % CAT_COLORS.length],
      value: v,
    }));

  shareBar(tradSec, {
    parts: tradParts,
    fmt: (p, tot) => `${tot > 0 ? ((p.value / tot) * 100).toFixed(1) : 0}%`,
    onHover: (part) => {
      if (!part) return link.hover(null);
      const subset = tradCounties.get(part.key) || [];
      link.hover(data.levels.counties.highlight(subset, { color: part.color, dimOthers: true, noBeacon: true }));
    },
  });

  // 3. Provincial Wellbeing & Disasters
  const hazSec = section(el, { title: "各省健康福祉指数与地震灾害对比" });
  let hMetric = "disasters";
  segmented(hazSec, {
    value: hMetric,
    options: [
      { value: "disasters", label: "灾害与地震次数" },
      { value: "wellbeing", label: "健康福祉指数" },
    ],
    onChange: (v) => {
      hMetric = v;
      ctx.setLens(v);
      renderHaz();
    },
  });
  const hazHost = document.createElement("div");
  hazSec.appendChild(hazHost);

  const provHaz = states.map((st) => {
    const cs = counties.filter((c) => c.province_idx === st.idx);
    const popSum = sum(cs, (c) => c.population) || 1;
    return {
      st,
      disasters: sum(cs, (c) => c.disasters || 0),
      wellbeing: sum(cs, (c) => (c.wellbeing || 0) * (c.population || 0)) / popSum,
    };
  });

  let hazBars = null;
  function renderHaz() {
    hazHost.innerHTML = "";
    const rows = [...provHaz]
      .sort((a, b) => b[hMetric] - a[hMetric])
      .map((x) => ({
        key: String(x.st.idx),
        st: x.st,
        label: x.st.name,
        sub: x.st.region,
        value: x[hMetric],
        text: hMetric === "disasters" ? `${int(x.disasters)} 次` : `${dec(x.wellbeing, 1)} 分`,
        color: hMetric === "disasters" ? "#d96b5a" : "#c25b9a",
      }));
    hazBars = barList(hazHost, {
      rows,
      rank: true,
      compact: true,
      onHover: (row) => (row ? link.hover(data.levels.provinces.highlight(row.st)) : link.hover(null)),
      onClick: (row) => data.levels.provinces.focus(row.st),
    });
  }
  renderHaz();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["mct_cultural_heritage", "nhc_cdc_health", "cfps_cgss_wellbeing", "sara_religion_survey", "usgs_earthquake_catalog", "mem_disasters_2024"]), [
      "地震频次基于USGS自2000年以来中国境内外M≥4.5实测地震目录空间落点统计，叠加地质与气象灾害指标。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) return hazBars?.setHot(null);
      const p = data.levels.provinces.rowAtCell(cell);
      hazBars?.setHot(p ? String(p.idx) : null);
    },
  };
}
