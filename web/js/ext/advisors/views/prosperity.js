// Advisor 4: 民生典客 (Prosperity & Housing)
import { fin, sum } from "../core/util.js";
import { int, dec, pct, fmtShort } from "../core/fmt.js";
import { barList, histogram } from "../core/charts.js";
import { section, tiles, segmented, mapColorPicker, sourcesHtml } from "../core/view.js";

export async function mount(ctx) {
  const { data, el, link } = ctx;
  const nation = data.nation || {};
  const states = data.states || [];
  const counties = data.counties || [];

  const natIncome = fin(nation.disposable_income)
    ? nation.disposable_income
    : sum(states, (s) => (s.disposable_income || 0) * (s.population || 0)) / (sum(states, (s) => s.population) || 1);
  const natHome = fin(nation.home_price)
    ? nation.home_price
    : sum(states, (s) => (s.home_price || 0) * (s.population || 0)) / (sum(states, (s) => s.population) || 1);
  const avgHomeown =
    sum(counties, (c) => (c.homeownership_pct || 0) * (c.population || 0)) / (sum(counties, (c) => c.population) || 1);
  const avgPti = natIncome > 0 ? (natHome * 30) / natIncome : 0;

  tiles(el, [
    { label: "全国人均可支配收入", value: `¥${int(natIncome)}`, sub: "国家统计局住户调查口径" },
    { label: "住宅均价 / 房价收入比", value: `¥${int(natHome)}/㎡`, sub: `30㎡/人约 ${dec(avgPti, 1)} 年收入` },
    { label: "全国家庭自有住房率", value: pct(avgHomeown || 89.2, 1), sub: "城乡综合自有住房比例", color: "#5fbf8e" },
  ]);

  mapColorPicker(
    el,
    ctx,
    [
      { value: "income", label: "可支配收入" },
      { value: "home", label: "住宅均价" },
      { value: "homeownership", label: "自有住房率" },
      { value: "poverty", label: "低收入关注%" },
    ],
    "income",
    (v) => ctx.setLens(v)
  );
  ctx.setLens("income");

  // Compute province-weighted county metrics for homeownership & low_income
  const provExtra = new Map();
  for (const st of states) {
    const cs = counties.filter((c) => c.province_idx === st.idx);
    const wSum = sum(cs, (c) => c.population) || 1;
    provExtra.set(st.idx, {
      homeownership_pct: sum(cs, (c) => (c.homeownership_pct || 0) * (c.population || 0)) / wSum,
      low_income: sum(cs, (c) => (c.low_income || 0) * (c.population || 0)) / wSum,
    });
  }

  const provSec = section(el, {
    title: "34 省级行政区居民收支与安居指标",
    note: "房价收入比按人均30㎡住宅总价 ÷ 人均可支配年收入计算。",
  });
  let metric = "disposable_income";
  segmented(provSec, {
    value: metric,
    options: [
      { value: "disposable_income", label: "可支配收入" },
      { value: "home_price", label: "房价" },
      { value: "price_to_income", label: "房价收入比" },
      { value: "homeownership_pct", label: "自有房%" },
      { value: "low_income", label: "低收入%" },
    ],
    onChange: (v) => {
      metric = v;
      const lensMap = {
        disposable_income: "income",
        home_price: "home",
        price_to_income: "home",
        homeownership_pct: "homeownership",
        low_income: "poverty",
      };
      ctx.setLens(lensMap[v]);
      renderProvBars();
    },
  });
  const provHost = document.createElement("div");
  provSec.appendChild(provHost);

  let provBars = null;
  function renderProvBars() {
    provHost.innerHTML = "";
    const getVal = (st) =>
      metric === "homeownership_pct" || metric === "low_income"
        ? provExtra.get(st.idx)?.[metric] || 0
        : st[metric] || 0;

    const rows = [...states]
      .sort((a, b) => getVal(b) - getVal(a))
      .map((st) => {
        const v = getVal(st);
        return {
          key: String(st.idx),
          st,
          label: st.name,
          sub: st.region,
          value: v,
          text:
            metric === "disposable_income"
              ? `¥${int(v)}`
              : metric === "home_price"
                ? `¥${int(v)}/㎡`
                : metric === "price_to_income"
                  ? `${dec(v, 1)} 年`
                  : pct(v, 1),
          color: metric === "low_income" ? "#d97559" : metric === "price_to_income" ? "#e0b54c" : "#3f9c82",
        };
      });

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

  // County distribution histogram for disposable income
  const histSec = section(el, {
    title: "1,302 个县人均可支配收入分布",
    note: "悬停直方柱查看各收入梯队县域在地图上的分布。",
  });
  histogram(histSec, {
    items: counties,
    value: (c) => c.income,
    bins: 18,
    color: "#3f9c82",
    fmt: (v) => `¥${fmtShort(v)}`,
    onHover: (bin) => {
      if (!bin?.items?.length) return link.hover(null);
      link.hover(
        data.levels.counties.highlight(bin.items, {
          dimOthers: true,
          noBeacon: true,
          label: `${bin.items.length} 个县`,
        })
      );
    },
    onClick: (bin) => {
      if (bin?.items?.length) link.base(data.levels.counties.highlight(bin.items, { dimOthers: true }));
    },
  });

  renderProvBars();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["nbs_2024_communique", "nbs_census_7th", "creis_home_price_2024"]), [
      "住房自有率含城镇与农村自建住房综合统计；房价收入比 = (住宅均价 × 30㎡) ÷ 人均可支配年收入。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) return provBars?.setHot(null);
      const p = data.levels.provinces.rowAtCell(cell);
      provBars?.setHot(p ? String(p.idx) : null);
    },
  };
}
