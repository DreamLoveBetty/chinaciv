// Advisor 2: 财政大臣 (Economy)
import { esc, fin, CAT_COLORS } from "../core/util.js";
import { fmtGdpYi, int, pct, signedPct, countCn } from "../core/fmt.js";
import { shareBar, barList } from "../core/charts.js";
import { section, tiles, segmented, mapColorPicker, sourcesHtml } from "../core/view.js";

const IND_LABELS = {
  "制造业": { label: "制造业", color: "#e09f4a" },
  "建筑与能源": { label: "建筑与能源", color: "#c97a4b" },
  "金融与商业服务": { label: "金融与商业服务", color: "#e6c95c" },
  "信息与科研技术": { label: "信息与科研技术", color: "#6ec4db" },
  "商贸与交运": { label: "商贸与交运", color: "#4aa3d8" },
  "文旅与公共服务": { label: "文旅与公共服务", color: "#9a7bc9" },
  "农林牧渔业": { label: "农林牧渔业", color: "#8fb84a" },
  manufacturing: { label: "工业与制造业", color: "#e09f4a" },
  industry: { label: "第二产业/制造", color: "#e09f4a" },
  services: { label: "现代服务业", color: "#4aa3d8" },
  finance: { label: "金融业", color: "#e6c95c" },
  tech: { label: "科研与信息技术", color: "#6ec4db" },
  retail: { label: "商贸批零", color: "#5fbf8e" },
  agriculture: { label: "农林牧渔", color: "#8fb84a" },
  construction: { label: "建筑业", color: "#b57a59" },
  transport: { label: "交通运输", color: "#9a7bc9" },
  other: { label: "其他行业", color: "#7d8b9e" },
};

function industryParts(obj) {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .map(([k, v], i) => {
      const meta = IND_LABELS[k] || { label: k, color: CAT_COLORS[i % CAT_COLORS.length] };
      return { key: k, label: meta.label, color: meta.color, value: Number(v) || 0 };
    })
    .filter((p) => p.value > 0)
    .sort((a, b) => b.value - a.value);
}

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const nation = data.nation || {};
  const states = data.states || [];
  const cities = data.cities || [];

  const totalGdp = fin(nation.gdp) ? nation.gdp : states.reduce((a, s) => a + (s.gdp || 0), 0);
  const totalPop = fin(nation.population) ? nation.population : states.reduce((a, s) => a + (s.population || 0), 0);
  const gdpPc = fin(nation.gdp_per_capita) ? nation.gdp_per_capita : totalPop > 0 ? (totalGdp * 1e8) / totalPop : 0;

  tiles(el, [
    { label: "全国GDP总量", value: fmtGdpYi(totalGdp), sub: "含港澳台全域汇总口径" },
    { label: "人均GDP", value: `¥${int(gdpPc)}`, sub: "按常住人口折算" },
    { label: "近5年增速", value: signedPct(nation.growth ?? 4.9, 1), sub: "实际经济与城镇规模动能", color: "#8fd18a" },
  ]);

  let mapMode = "income";
  mapColorPicker(
    el,
    ctx,
    [
      { value: "income", label: "收入视角" },
      { value: "home", label: "房价视角" },
      { value: "terrain", label: "地形底图" },
    ],
    mapMode,
    (v) => {
      mapMode = v;
      ctx.setLens(v === "terrain" ? null : v);
    }
  );
  ctx.setLens("income");

  // 1. National industry mix
  const natMix = industryParts(nation.gdp_by_industry || nation.jobs);
  if (natMix.length) {
    const mixSec = section(el, {
      title: "国民经济产业结构",
      note: "制造业、服务业、金融与信息技术等核心部门比重。",
    });
    shareBar(mixSec, {
      parts: natMix,
      fmt: (p, tot) => `${tot > 0 ? ((p.value / tot) * 100).toFixed(1) : 0}%`,
    });
  }

  // 2. Provincial rankings
  const provSec = section(el, {
    title: "34 省级行政区经济实力榜",
    note: "悬停省份在地图上高亮边界，点击聚焦并查看该省产业结构。",
  });
  let provMetric = "gdp";
  segmented(provSec, {
    value: provMetric,
    options: [
      { value: "gdp", label: "GDP总量" },
      { value: "gdp_per_capita", label: "人均GDP" },
      { value: "growth", label: "增速" },
    ],
    onChange: (v) => {
      provMetric = v;
      renderProvBars();
    },
  });
  const provHost = document.createElement("div");
  provSec.appendChild(provHost);
  const provDetail = document.createElement("div");
  provDetail.className = "adv-detail";
  provSec.appendChild(provDetail);

  let provBars = null;
  let selectedProv = null;

  function showProvDetail(st) {
    if (!st) {
      provDetail.innerHTML = "";
      return;
    }
    const parts = industryParts(st.gdp_by_industry || st.jobs);
    provDetail.innerHTML = `<div class="adv-card-detail">
      <h4 class="adv-h4">${esc(st.full || st.name)} · 产业与产出快照</h4>
      <div class="adv-tiles" style="padding:4px 0 6px">
        <div class="adv-tile"><span class="k">GDP</span><b>${esc(fmtGdpYi(st.gdp))}</b></div>
        <div class="adv-tile"><span class="k">人均GDP</span><b>¥${esc(int(st.gdp_per_capita))}</b></div>
        <div class="adv-tile"><span class="k">可支配收入</span><b>¥${esc(int(st.disposable_income))}</b></div>
      </div>
      <div class="adv-detail-mix"></div>
    </div>`;
    if (parts.length) {
      shareBar(provDetail.querySelector(".adv-detail-mix"), {
        parts,
        fmt: (p, tot) => `${tot > 0 ? ((p.value / tot) * 100).toFixed(1) : 0}%`,
      });
    }
  }

  function renderProvBars() {
    provHost.innerHTML = "";
    const rows = [...states]
      .sort((a, b) => (b[provMetric] || 0) - (a[provMetric] || 0))
      .map((st) => ({
        key: String(st.idx),
        st,
        label: st.name,
        sub: st.region,
        value: st[provMetric] || 0,
        text:
          provMetric === "gdp"
            ? fmtGdpYi(st.gdp)
            : provMetric === "gdp_per_capita"
              ? `¥${int(st.gdp_per_capita)}`
              : signedPct(st.growth, 1),
        tone: provMetric === "growth" ? ((st.growth || 0) >= 0 ? "good" : "bad") : "",
      }));

    provBars = barList(provHost, {
      rows,
      rank: true,
      diverging: provMetric === "growth",
      selected: selectedProv ? String(selectedProv.idx) : null,
      onHover: (row) => {
        if (!row) return link.hover(null);
        link.hover(data.levels.provinces.highlight(row.st));
      },
      onClick: (row) => {
        selectedProv = row.st;
        provBars.setSelected(row.key);
        showProvDetail(row.st);
        data.levels.provinces.focus(row.st);
      },
    });
  }

  // 3. Major Cities GDP & Bubbles
  const citySec = section(el, {
    title: "重点城市经济引擎（Top 25）",
    note: "包含四大直辖市、计划单列市、省会及制造业名城。",
  });
  let cityMetric = "gdp";
  segmented(citySec, {
    value: cityMetric,
    options: [
      { value: "gdp", label: "城市GDP" },
      { value: "gdp_per_capita", label: "人均GDP" },
      { value: "disposable_income", label: "居民收入" },
    ],
    onChange: (v) => {
      cityMetric = v;
      renderCityBars();
    },
  });
  const cityHost = document.createElement("div");
  citySec.appendChild(cityHost);

  const bubbles = ctx.bubbles("economy-cities", {
    onHover: (b) => {
      if (!b) return link.hover(null);
      cityBars?.setHot(b.key);
      link.hover(data.levels.cities.highlight(b.city));
    },
    onClick: (b) => {
      if (b?.city) data.levels.cities.focus(b.city);
    },
    tip: (b) =>
      `<b>${esc(b.city.name)}</b> <span class="sub">(${esc(b.city.sub)})</span><br>GDP：<b>${esc(fmtGdpYi(b.city.gdp))}</b><br>人均GDP：<b>¥${esc(int(b.city.gdp_per_capita))}</b>`,
  });

  let cityBars = null;
  function renderCityBars() {
    cityHost.innerHTML = "";
    const sorted = [...cities].sort((a, b) => (b[cityMetric] || 0) - (a[cityMetric] || 0));
    const rows = sorted.slice(0, 25).map((c) => ({
      key: c.key,
      city: c,
      label: c.name,
      sub: c.sub,
      value: c[cityMetric] || 0,
      text: cityMetric === "gdp" ? fmtGdpYi(c.gdp) : `¥${int(c[cityMetric])}`,
      color: "#c9a43a",
    }));

    cityBars = barList(cityHost, {
      rows,
      rank: true,
      compact: true,
      onHover: (row) => {
        if (!row) {
          bubbles.setHot(null);
          return link.hover(null);
        }
        bubbles.setHot(row.key);
        link.hover(data.levels.cities.highlight(row.city));
      },
      onClick: (row) => data.levels.cities.focus(row.city),
    });

    bubbles.setItems(
      sorted.slice(0, 45).map((c) => ({
        key: c.key,
        city: c,
        x: c.x,
        y: c.y,
        r: Math.max(4, Math.min(20, Math.sqrt((c.gdp || 500) / 140))),
        color: "#e0b54c",
        label: c.name,
      }))
    );
  }

  renderProvBars();
  renderCityBars();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["nbs_2024_communique", "nbs_5th_econ_census", "hk_censtatd", "mo_dsec", "tw_dgbas"]), [
      "省市GDP采用国家统计局及各地统计公报最新年度数据；港澳台按对应统计署公开GDP换算人民币汇率口径。",
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
