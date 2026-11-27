// Advisor 8: 市舶提举 (Commerce & Trade — 40 Freight Corridors + Toggle Trade Map Layer + Ports & Airports)
import { esc, fin, sum } from "../core/util.js";
import { fmtGdpYi, dec, int } from "../core/fmt.js";
import { ensureDatasets } from "../core/data.js?v=20261127-5";
import { barList } from "../core/charts.js";
import { section, tiles, segmented, sourcesHtml, frameBtn } from "../core/view.js";

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await ensureDatasets(app, ["trade", "infrastructure"]);
  const trade = app.data.trade || {};
  const infra = app.data.infrastructure || {};
  const routes = trade.routes || [];
  const ports = infra.ports || [];
  const airports = infra.airports || [];

  let tradeLayerOn = true;
  ctx.setLayer("trade", true);
  ctx.setLayer("hubs", true);

  const totalValue = sum(routes, (r) => r.value_bcny || 0);
  const topPort = [...ports].sort((a, b) => (b.cargo_mt || 0) - (a.cargo_mt || 0))[0];
  const topAir = [...airports].sort((a, b) => (b.pax_m || 0) - (a.pax_m || 0))[0];

  tiles(el, [
    { label: "省际核心货运干线", value: `${routes.length} 条`, sub: `年货值汇总 ${fmtGdpYi(totalValue)}` },
    { label: "吞吐第一大港", value: topPort?.name || "宁波舟山港", sub: topPort ? `年吞吐 ${dec(topPort.cargo_mt, 0)} 百万吨` : "沿海与长江枢纽" },
    { label: "最繁忙空港枢纽", value: topAir?.name || "上海浦东/首都", sub: topAir ? `年旅客 ${dec(topAir.pax_m, 1)} 百万人次` : "国际航空门户" },
  ]);

  // Trade layer toggle bar
  const ctrlSec = section(el, { kicker: "地图航路联动" });
  ctrlSec.classList.add("adv-mapsec");
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "adv-row";
  ctrlRow.style.margin = "0";
  ctrlRow.innerHTML = `<button type="button" class="adv-lensbtn" aria-pressed="true" data-trade-toggle>🚢 地图显示 40 条省际货运航线</button>`;
  frameBtn(ctrlRow, "全览中国");
  ctrlSec.appendChild(ctrlRow);
  const toggleBtn = ctrlRow.querySelector("[data-trade-toggle]");
  toggleBtn.addEventListener("click", () => {
    tradeLayerOn = !tradeLayerOn;
    ctx.setLayer("trade", tradeLayerOn);
    toggleBtn.setAttribute("aria-pressed", String(tradeLayerOn));
  });

  // Tabbed list: 40 Freight Corridors | Top Ports | Top Airports
  const mainSec = section(el, {
    title: "商贸走廊与海空枢纽排行",
    note: "悬停航线或枢纽在地图上即时标注坐标；点击可拉近视角。",
  });
  let tab = "routes";
  segmented(mainSec, {
    value: tab,
    options: [
      { value: "routes", label: `货运通道 (${routes.length})` },
      { value: "ports", label: `港口吞吐 (${ports.length})` },
      { value: "airports", label: `空港客货 (${airports.length})` },
    ],
    onChange: (v) => {
      tab = v;
      renderTab();
    },
  });
  const host = document.createElement("div");
  mainSec.appendChild(host);

  const bubbles = ctx.bubbles("commerce-hubs", {
    onHover: (b) => {
      if (!b) return link.hover(null);
      activeBars?.setHot(b.key);
      if (b.cell >= 0) link.hover({ cells: [b.cell], label: b.label, color: b.color });
    },
    onClick: (b) => {
      if (fin(b.x) && fin(b.y) && app.fitBounds) {
        app.fitBounds(b.x - 160, b.y - 120, b.x + 160, b.y + 120, { animate: true });
      }
    },
    tip: (b) => b.tipHtml,
  });

  let activeBars = null;
  function renderTab() {
    host.innerHTML = "";
    if (tab === "routes") {
      const sorted = [...routes].sort((a, b) => (b.value_bcny || 0) - (a.value_bcny || 0));
      const rows = sorted.map((r, idx) => ({
        key: `rt-${idx}`,
        route: r,
        label: `${r.from_name} ⇄ ${r.to_name}`,
        sub: `${r.commodity_name || r.commodity || "综合工业品"} · ${r.mode_name || r.mode || "公铁水联运"}`,
        value: r.value_bcny || r.tonnage_mt || 1,
        text: r.value_bcny ? `${int(r.value_bcny)}亿元` : `${dec(r.tonnage_mt, 1)}Mt`,
        color: "#2fa4b8",
      }));
      bubbles.setItems([]);
      activeBars = barList(host, {
        rows,
        rank: true,
        compact: true,
        onHover: (row) => {
          if (!row) return link.hover(null);
          const r = row.route;
          const cells = [r.from_cell, r.to_cell].filter((c) => c >= 0);
          link.hover({ cells, label: `${r.from_name} → ${r.to_name}`, color: "#3dd2eb" });
        },
        onClick: (row) => {
          const r = row.route;
          const w = app.w;
          if (w && r.from_cell >= 0 && r.to_cell >= 0 && app.fitBounds) {
            const x0 = Math.min(w.cx(r.from_cell), w.cx(r.to_cell));
            const x1 = Math.max(w.cx(r.from_cell), w.cx(r.to_cell));
            const y0 = Math.min(w.cy(r.from_cell), w.cy(r.to_cell));
            const y1 = Math.max(w.cy(r.from_cell), w.cy(r.to_cell));
            app.fitBounds(x0 - 150, y0 - 120, x1 + 150, y1 + 120, { animate: true });
          }
        },
      });
    } else if (tab === "ports") {
      const sorted = [...ports].sort((a, b) => (b.cargo_mt || 0) - (a.cargo_mt || 0));
      const rows = sorted.slice(0, 35).map((p, idx) => ({
        key: `pt-${idx}`,
        port: p,
        label: p.name,
        sub: p.kind === "river" ? "内河港" : "沿海大港",
        value: p.cargo_mt || p.teu_m || 1,
        text: `${dec(p.cargo_mt, 0)} Mt${p.teu_m ? ` · ${dec(p.teu_m, 1)}M TEU` : ""}`,
        color: "#3aa0d8",
      }));
      bubbles.setItems(
        sorted.map((p, idx) => ({
          key: `pt-${idx}`,
          cell: p.cell,
          x: p.x,
          y: p.y,
          r: Math.max(5, Math.min(20, Math.sqrt((p.cargo_mt || 50) * 0.45))),
          color: "#3aa0d8",
          label: p.name,
          tipHtml: `<b>${esc(p.name)}</b><br>货物吞吐：<b>${dec(p.cargo_mt, 1)} 百万吨</b>${p.teu_m ? `<br>集装箱：<b>${dec(p.teu_m, 2)} 百万标箱</b>` : ""}`,
        }))
      );
      activeBars = barList(host, {
        rows,
        rank: true,
        compact: true,
        onHover: (row) => {
          if (!row) {
            bubbles.setHot(null);
            return link.hover(null);
          }
          bubbles.setHot(row.key);
          if (row.port.cell >= 0) link.hover({ cells: [row.port.cell], label: row.label, color: "#3aa0d8" });
        },
        onClick: (row) => {
          const p = row.port;
          if (fin(p.x) && fin(p.y) && app.fitBounds) app.fitBounds(p.x - 140, p.y - 100, p.x + 140, p.y + 100, { animate: true });
        },
      });
    } else {
      const sorted = [...airports].sort((a, b) => (b.pax_m || 0) - (a.pax_m || 0));
      const rows = sorted.slice(0, 35).map((a, idx) => ({
        key: `ap-${idx}`,
        airport: a,
        label: a.name,
        sub: a.iata || "",
        value: a.pax_m || 1,
        text: `${dec(a.pax_m, 1)}M人${a.cargo_kt ? ` · ${int(a.cargo_kt)}kt货` : ""}`,
        color: "#72c7f2",
      }));
      bubbles.setItems(
        sorted.slice(0, 55).map((a, idx) => ({
          key: `ap-${idx}`,
          cell: a.cell,
          x: a.x,
          y: a.y,
          r: Math.max(4, Math.min(18, Math.sqrt((a.pax_m || 2) * 4.5))),
          color: "#72c7f2",
          label: `${a.name} (${a.iata || ""})`,
          tipHtml: `<b>${esc(a.name)}</b> <span class="sub">${esc(a.iata || "")}</span><br>年旅客吞吐：<b>${dec(a.pax_m, 1)} 百万人次</b>${a.cargo_kt ? `<br>货邮吞吐：<b>${int(a.cargo_kt)} 千吨</b>` : ""}`,
        }))
      );
      activeBars = barList(host, {
        rows,
        rank: true,
        compact: true,
        onHover: (row) => {
          if (!row) {
            bubbles.setHot(null);
            return link.hover(null);
          }
          bubbles.setHot(row.key);
          if (row.airport.cell >= 0) link.hover({ cells: [row.airport.cell], label: row.label, color: "#72c7f2" });
        },
        onClick: (row) => {
          const a = row.airport;
          if (fin(a.x) && fin(a.y) && app.fitBounds) app.fitBounds(a.x - 140, a.y - 100, a.x + 140, a.y + 100, { animate: true });
        },
      });
    }
  }

  renderTab();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["mot_ports_2024", "caac_airports_2024", "nbs_2024_communique"]), [
      "港口与机场统计口径来自交通运输部年度港口公报及民航局全国民用运输机场生产统计公报。",
    ])
  );

  return {};
}
