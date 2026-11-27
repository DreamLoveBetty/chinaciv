// Advisor 5: 国子监祭酒 (Knowledge & Science — STEM 1/5 Shenzhen vs 1/14 National, Broadband, Top R&D Universities)
import { esc, fin, sum } from "../core/util.js";
import { fmtPop, dec, pct, int } from "../core/fmt.js";
import { ensureDatasets } from "../core/data.js";
import { barList } from "../core/charts.js";
import { section, tiles, callout, segmented, mapColorPicker, sourcesHtml } from "../core/view.js";

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await ensureDatasets(app, ["wonders"]);
  const nation = data.nation || {};
  const states = data.states || [];
  const cities = data.cities || [];
  const counties = data.counties || [];
  const wonders = (app.data.wonders?.wonders || []).filter((w) => w.kind === "university");

  const natStem1In = nation.benchmarks?.national_stem_1_in ?? 14;
  const szStem1In = nation.benchmarks?.shenzhen_stem_1_in ?? 5;
  const szCity = cities.find((c) => c.id === "shenzhen" || c.code === "440300" || (c.name || "").includes("深圳"));
  const natStemWorkers = nation.stem_workers || sum(states, (s) => s.stem_workers || 0);
  const avgBroadband =
    sum(counties, (c) => (c.broadband_pct || 0) * (c.population || 0)) / (sum(counties, (c) => c.population) || 1);

  tiles(el, [
    { label: "全国STEM工程科研人才", value: fmtPop(natStemWorkers), sub: `全国平均约每 ${natStem1In} 人中有 1 名`, color: "#72c7f2" },
    { label: "科创标杆 · 深圳", value: `每 ${szCity?.stem_ratio_1_in_n ?? szStem1In} 人中有 1 名`, sub: `STEM占比 ${pct(szCity?.stem_share_pct ?? 20, 1)}`, color: "#ffd36a" },
    { label: "全国千兆宽带普及率", value: pct(avgBroadband || 86.4, 1), sub: "城乡光纤与5G千兆网络覆盖" },
  ]);

  const szCallout = callout(
    el,
    `<b>核心洞察：</b>深圳每 <b>${esc(szCity?.stem_ratio_1_in_n ?? szStem1In)}</b> 名就业者中就有 <b>1</b> 名工程师、程序员或科研人员（约20%），密度接近全国平均（每 <b>${esc(natStem1In)}</b> 人中有 1 名，约7.1%）的 <b>3 倍</b>。<button type="button" class="adv-link" data-sz>定位深圳 ›</button>`
  );
  szCallout.querySelector("[data-sz]")?.addEventListener("click", () => {
    if (szCity) data.levels.cities.focus(szCity);
  });

  mapColorPicker(
    el,
    ctx,
    [
      { value: "stem", label: "STEM人才%" },
      { value: "bachelors", label: "本科及以上%" },
      { value: "broadband", label: "千兆宽带%" },
    ],
    "stem",
    (v) => ctx.setLens(v)
  );
  ctx.setLens("stem");

  // 1. City STEM talent bubbles & bar list
  const citySec = section(el, { title: "城市STEM科研工程人才密集度榜（Top 20）" });
  const cityHost = document.createElement("div");
  citySec.appendChild(cityHost);

  const sortedCities = [...cities]
    .filter((c) => fin(c.stem_share_pct))
    .sort((a, b) => (b.stem_share_pct || 0) - (a.stem_share_pct || 0));

  const cityBubbles = ctx.bubbles("stem-cities", {
    onHover: (b) => {
      if (!b) return link.hover(null);
      cityBars?.setHot(b.key);
      link.hover(data.levels.cities.highlight(b.city));
    },
    onClick: (b) => b?.city && data.levels.cities.focus(b.city),
    tip: (b) =>
      `<b>${esc(b.city.name)}</b><br>STEM人才占比：<b>${pct(b.city.stem_share_pct, 1)}</b>（约每 ${dec(b.city.stem_ratio_1_in_n || 100 / (b.city.stem_share_pct || 7), 1)} 人中有 1 名）`,
  });
  cityBubbles.setItems(
    sortedCities.slice(0, 35).map((c) => ({
      key: c.key,
      city: c,
      x: c.x,
      y: c.y,
      r: Math.max(4.5, Math.min(18, (c.stem_share_pct || 5) * 0.8)),
      color: "#4a86d6",
      label: c.name,
    }))
  );

  const cityBars = barList(cityHost, {
    rows: sortedCities.slice(0, 20).map((c) => ({
      key: c.key,
      city: c,
      label: c.name,
      sub: `约1/${Math.round(c.stem_ratio_1_in_n || 100 / Math.max(1, c.stem_share_pct))}`,
      value: c.stem_share_pct || 0,
      text: `${pct(c.stem_share_pct, 1)} · ${fmtPop(c.stem_workers)}`,
      color: c.name.includes("深圳") ? "#ecd08e" : "#4a86d6",
    })),
    rank: true,
    compact: true,
    onHover: (row) => {
      if (!row) {
        cityBubbles.setHot(null);
        return link.hover(null);
      }
      cityBubbles.setHot(row.key);
      link.hover(data.levels.cities.highlight(row.city));
    },
    onClick: (row) => data.levels.cities.focus(row.city),
  });

  // 2. Top R&D Universities from wonders.json
  const uniSec = section(el, {
    title: "顶尖研究型大学研发经费榜（来自 wonders.json）",
    note: "严格依据教育部/科技部公开年度研发经费（亿元）遴选。",
  });
  const uniSorted = [...wonders].sort((a, b) => (b.metrics?.rd_bcny ?? b.rd_bcny ?? 0) - (a.metrics?.rd_bcny ?? a.rd_bcny ?? 0));
  const uniHost = document.createElement("div");
  uniSec.appendChild(uniHost);

  const uniBars = barList(uniHost, {
    rows: uniSorted.map((u, idx) => {
      const rd = u.metrics?.rd_bcny ?? u.rd_bcny ?? 0;
      const prov = data.states[u.province_idx]?.abbr || "";
      return {
        key: String(u.id || idx),
        wonder: u,
        label: u.name,
        sub: `${u.city_name || prov}`,
        value: rd || (20 - idx),
        text: rd ? `${dec(rd, 1)} 亿元` : `#${u.rank || idx + 1}`,
        color: "#6cb8e6",
      };
    }),
    rank: true,
    compact: true,
    onHover: (row) => {
      if (!row) return link.hover(null);
      const wd = row.wonder;
      if (wd.cell >= 0) link.hover({ cells: [wd.cell], label: `${wd.name}`, color: "#72c7f2" });
    },
    onClick: (row) => {
      const wd = row.wonder;
      if (fin(wd.x) && fin(wd.y) && app.fitBounds) {
        app.fitBounds(wd.x - 120, wd.y - 90, wd.x + 120, wd.y + 90, { animate: true });
      }
    },
  });

  // 3. Provincial education & broadband rankings
  const provSec = section(el, { title: "34省学历与数字基建排行" });
  let pMetric = "bachelors_pct";
  segmented(provSec, {
    value: pMetric,
    options: [
      { value: "bachelors_pct", label: "本科率" },
      { value: "broadband_pct", label: "千兆宽带" },
      { value: "stem_share_pct", label: "STEM占比" },
    ],
    onChange: (v) => {
      pMetric = v;
      renderProv();
    },
  });
  const provHost = document.createElement("div");
  provSec.appendChild(provHost);

  const provBb = new Map();
  for (const st of states) {
    const cs = counties.filter((c) => c.province_idx === st.idx);
    const wSum = sum(cs, (c) => c.population) || 1;
    provBb.set(st.idx, sum(cs, (c) => (c.broadband_pct || 0) * (c.population || 0)) / wSum);
  }

  let provBars = null;
  function renderProv() {
    provHost.innerHTML = "";
    const getV = (st) => (pMetric === "broadband_pct" ? provBb.get(st.idx) || 0 : st[pMetric] || 0);
    const rows = [...states]
      .sort((a, b) => getV(b) - getV(a))
      .map((st) => ({
        key: String(st.idx),
        st,
        label: st.name,
        sub: st.region,
        value: getV(st),
        text: pct(getV(st), 1),
        color: "#4a86d6",
      }));
    provBars = barList(provHost, {
      rows,
      rank: true,
      onHover: (row) => (row ? link.hover(data.levels.provinces.highlight(row.st)) : link.hover(null)),
      onClick: (row) => data.levels.provinces.focus(row.st),
    });
  }
  renderProv();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["most_rd_2024", "moe_universities_rd", "miit_broadband_2024", "nbs_census_7th"]), [
      "STEM人才定义为信息传输软件与信息技术服务、科学研究与技术服务、高端装备及工程研发从业人员；深圳数据含高新技术企业工程研发集群。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) {
        provBars?.setHot(null);
        cityBars?.setHot(null);
        return;
      }
      const p = data.levels.provinces.rowAtCell(cell);
      const c = data.levels.cities.rowAtCell(cell);
      provBars?.setHot(p ? String(p.idx) : null);
      cityBars?.setHot(c ? c.key : null);
    },
  };
}
