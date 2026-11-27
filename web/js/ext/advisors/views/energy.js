// Advisor 1: 能源与资源大臣 (Energy & Resources)
import { esc, fin, sum, CAT_COLORS } from "../core/util.js";
import { fmtPowerGw, fmtPowerMw, int, dec, pct } from "../core/fmt.js";
import { ensureDatasets } from "../core/data.js";
import { shareBar, barList } from "../core/charts.js";
import { section, tiles, callout, chips, segmented, sourcesHtml, frameBtn } from "../core/view.js";

const PLANT_META = [
  { key: "coal_plant", label: "火电基地", color: "#d97559" },
  { key: "hydro", label: "大型水电", color: "#4aa3d8" },
  { key: "wind", label: "风电基地", color: "#5fbf8e" },
  { key: "solar", label: "光伏基地", color: "#f2ca52" },
  { key: "nuclear", label: "核电站", color: "#a378d6" },
  { key: "pumped_storage", label: "抽水蓄能", color: "#38b4a0" },
];

const MINE_META = [
  { key: "coal_mine", label: "煤矿", color: "#8c8275" },
  { key: "oil", label: "油田", color: "#c9853e" },
  { key: "gas", label: "气田", color: "#68b5e8" },
  { key: "rare_earths", label: "稀土", color: "#d66fa0" },
  { key: "iron", label: "铁矿", color: "#b56952" },
  { key: "copper", label: "铜矿", color: "#d98f4a" },
  { key: "gold", label: "金矿", color: "#f6dc7a" },
  { key: "lithium", label: "锂矿", color: "#78d9c4" },
  { key: "tungsten", label: "钨锡矿", color: "#a2b0c2" },
  { key: "bauxite", label: "铝土矿", color: "#c99b7a" },
];

const META_MAP = new Map([...PLANT_META, ...MINE_META].map((m) => [m.key, m]));
const PLANT_KEYS = new Set(PLANT_META.map((m) => m.key));

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await ensureDatasets(app, ["resources"]);
  const res = app.data.resources || {};
  const items = res.items || [];
  const summary = res.summary || {};

  // Compute full national capacity by fuel (across all 4,303 WRI plants + verified additions)
  const natAllMw = summary.national?.all_plants_mw || {};
  const byFuel = new Map();
  for (const m of PLANT_META) {
    const sumMw = natAllMw[m.key] ?? summary.by_type?.[m.key]?.capacity_mw;
    const itemsMw = sum(items.filter((x) => x.type === m.key), (x) => x.capacity_mw || 0);
    byFuel.set(m.key, fin(sumMw) && sumMw > 0 ? sumMw : itemsMw);
  }
  const totalMw =
    fin(natAllMw.total) && natAllMw.total > 0
      ? natAllMw.total
      : fin(summary.total_capacity_mw) && summary.total_capacity_mw > 0
        ? summary.total_capacity_mw
        : [...byFuel.values()].reduce((a, b) => a + b, 0);
  const cleanMw = ["hydro", "wind", "solar", "nuclear", "pumped_storage"].reduce((a, k) => a + (byFuel.get(k) || 0), 0);
  const cleanShare = totalMw > 0 ? (cleanMw / totalMw) * 100 : 0;

  const plants = items.filter((x) => PLANT_KEYS.has(x.type));
  const mines = items.filter((x) => !PLANT_KEYS.has(x.type));
  const allPlantCount = summary.national?.all_plants_count || plants.length;
  const neaTotalGw = summary.national?.nea_2024_gw?.total_gw;

  ctx.setShowResources(true);

  tiles(el, [
    { label: "WRI收录电站总装机", value: fmtPowerGw(totalMw / 1000), sub: `汇总 ${int(allPlantCount)} 座电站${neaTotalGw ? `（NEA 2024全口径 ${dec(neaTotalGw, 0)}GW）` : ""}` },
    { label: "清洁能源装机占比", value: pct(cleanShare, 1), sub: `水风光核抽蓄 ${fmtPowerGw(cleanMw / 1000)}`, color: "#7dd39d" },
    { label: "代表性电站与矿区点位", value: `${items.length} 处`, sub: `${plants.length} 座主力电站 · ${mines.length} 处矿产油气` },
  ]);

  // 1. Fuel mix share bar
  const mixSec = section(el, {
    title: "电源装机结构（按发电类型）",
    note: "悬停或点击发电类型，筛选地图上的电站图标与气泡。",
  });
  let selectedType = null;

  const mixParts = PLANT_META.map((m) => ({
    key: m.key,
    label: m.label,
    color: m.color,
    value: byFuel.get(m.key) || 0,
  }));

  const mixChart = shareBar(mixSec, {
    parts: mixParts,
    fmt: (p, tot) => `${fmtPowerGw(p.value / 1000)} (${tot > 0 ? ((p.value / tot) * 100).toFixed(1) : 0}%)`,
    onHover: (part) => {
      if (!part) return link.hover(null);
      const matchedIdx = [];
      const matchedCells = [];
      items.forEach((it, idx) => {
        if (it.type === part.key) {
          matchedIdx.push(idx);
          if (it.cell >= 0) matchedCells.push(it.cell);
        }
      });
      link.hover({ resources: matchedIdx, cells: matchedCells, label: `${part.label} (${matchedIdx.length}处)`, color: part.color, noBeacon: true });
    },
    onClick: (part) => {
      selectedType = selectedType === part.key ? null : part.key;
      applyFilter();
    },
  });

  // 2. Resource filter chips linked to app.setResourceFilter
  const filterSec = section(el, {
    title: "地图资源点与气泡筛选",
    note: "点击标签切换地图资源显示；支持电站与战略矿产联动过滤。",
  });
  const countByType = new Map();
  for (const it of items) countByType.set(it.type, (countByType.get(it.type) || 0) + 1);

  const allChips = [...PLANT_META, ...MINE_META].filter((m) => (countByType.get(m.key) || 0) > 0);
  let activeSet = new Set(allChips.map((m) => m.key));

  const chipBar = chips(filterSec, {
    items: allChips.map((m) => ({
      key: m.key,
      label: m.label,
      color: m.color,
      count: countByType.get(m.key) || 0,
    })),
    selected: [...activeSet],
    multi: true,
    onChange: (arr) => {
      selectedType = null;
      activeSet = new Set(arr);
      applyFilter();
    },
  });

  const btnRow = document.createElement("div");
  btnRow.className = "adv-row";
  btnRow.innerHTML = `
    <button type="button" class="adv-mini" data-preset="all">全部显示</button>
    <button type="button" class="adv-mini" data-preset="clean">仅清洁能源</button>
    <button type="button" class="adv-mini" data-preset="mines">仅战略矿产</button>`;
  frameBtn(btnRow, "全览中国");
  filterSec.appendChild(btnRow);

  btnRow.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-preset]");
    if (!b) return;
    selectedType = null;
    const p = b.dataset.preset;
    if (p === "all") activeSet = new Set(allChips.map((m) => m.key));
    else if (p === "clean") activeSet = new Set(["hydro", "wind", "solar", "nuclear", "pumped_storage"]);
    else if (p === "mines") activeSet = new Set(MINE_META.map((m) => m.key));
    chipBar.setSelected([...activeSet]);
    applyFilter();
  });

  // Map proportional bubbles
  const bubbles = ctx.bubbles("plants", {
    onHover: (b) => {
      if (!b) return link.hover(null);
      const cells = b.item.cell >= 0 ? [b.item.cell] : [];
      link.hover({ resources: [b.idx], cells, label: b.label, color: b.color });
    },
    onClick: (b) => {
      if (!b) return;
      const st = data.states[b.item.province_idx];
      if (st) data.levels.provinces.focus(st);
    },
    tip: (b) => {
      const m = META_MAP.get(b.item.type);
      const cap = b.item.capacity_mw ? `<br>装机容量：<b>${esc(fmtPowerMw(b.item.capacity_mw))}</b>` : "";
      const out = b.item.output || b.item.reserve || b.item.note;
      const prov = data.states[b.item.province_idx]?.abbr || "";
      return `<b>${esc(b.item.name)}</b>${prov ? ` <span class="sub">(${esc(prov)})</span>` : ""}<br>类型：${esc(m?.label || b.item.type)}${cap}${out ? `<br><span class="sub">${esc(out)}</span>` : ""}`;
    },
  });

  // 3. Provincial power rankings
  const rankSec = section(el, { title: "各省级行政区发电装机与能源基地排行" });
  let rankMode = "total";
  segmented(rankSec, {
    value: rankMode,
    options: [
      { value: "total", label: "总装机 GW" },
      { value: "clean", label: "清洁能源 GW" },
      { value: "mines", label: "矿产资源点" },
    ],
    onChange: (v) => {
      rankMode = v;
      renderProvBars();
    },
  });
  const rankHost = document.createElement("div");
  rankSec.appendChild(rankHost);

  const provSummary = summary.provinces || {};
  const provStats = data.states.map((st) => {
    const ps = provSummary[String(st.code)] || {};
    const amw = ps.all_plants_mw || {};
    const totalMw = fin(ps.total_mw) ? ps.total_mw : 0;
    const cleanMw = ["hydro", "wind", "solar", "nuclear", "pumped_storage"].reduce((a, k) => a + (amw[k] || 0), 0);
    return {
      prov: st,
      key: String(st.idx),
      totalMw,
      cleanMw,
      mines: 0,
      plants: ps.all_plants_count || 0,
      hasSummary: fin(ps.total_mw),
    };
  });
  for (const it of items) {
    const p = provStats[it.province_idx];
    if (!p) continue;
    if (PLANT_KEYS.has(it.type)) {
      if (!p.hasSummary) {
        p.plants++;
        const mw = it.capacity_mw || 0;
        p.totalMw += mw;
        if (it.type !== "coal_plant") p.cleanMw += mw;
      }
    } else {
      p.mines++;
    }
  }

  let provBars = null;
  function renderProvBars() {
    rankHost.innerHTML = "";
    const rows = [...provStats]
      .sort((a, b) =>
        rankMode === "total" ? b.totalMw - a.totalMw : rankMode === "clean" ? b.cleanMw - a.cleanMw : b.mines - a.mines
      )
      .filter((r) => (rankMode === "mines" ? r.mines > 0 : r.totalMw > 0))
      .map((r) => ({
        key: r.key,
        prov: r.prov,
        label: r.prov.name,
        sub: rankMode === "mines" ? `${r.mines}处` : `${r.plants}座电站`,
        value: rankMode === "total" ? r.totalMw / 1000 : rankMode === "clean" ? r.cleanMw / 1000 : r.mines,
        text: rankMode === "mines" ? `${r.mines} 处` : fmtPowerGw((rankMode === "total" ? r.totalMw : r.cleanMw) / 1000),
        color: rankMode === "clean" ? "#5fbf8e" : rankMode === "mines" ? "#c9a45c" : "#d98a2b",
      }));

    provBars = barList(rankHost, {
      rows,
      rank: true,
      onHover: (row) => {
        if (!row) return link.hover(null);
        link.hover(data.levels.provinces.highlight(row.prov));
      },
      onClick: (row) => data.levels.provinces.focus(row.prov),
    });
  }

  // 4. Top major installations / mines list
  const topSec = section(el, { title: "重点电站与矿产名录（Top 20）" });
  const topHost = document.createElement("div");
  topSec.appendChild(topHost);
  let topBars = null;

  function renderTopItems(filtered) {
    topHost.innerHTML = "";
    const sorted = [...filtered]
      .sort((a, b) => (b.item.capacity_mw || 0) - (a.item.capacity_mw || 0))
      .slice(0, 20);
    const rows = sorted.map((entry) => {
      const it = entry.item;
      const m = META_MAP.get(it.type);
      const prov = data.states[it.province_idx]?.abbr || "";
      return {
        key: String(entry.idx),
        idx: entry.idx,
        item: it,
        label: it.name,
        sub: `${m?.label || it.type}${prov ? " · " + prov : ""}`,
        value: it.capacity_mw || 100,
        text: it.capacity_mw ? fmtPowerMw(it.capacity_mw) : it.output || "战略矿区",
        color: m?.color || "#d98a2b",
      };
    });
    topBars = barList(topHost, {
      rows,
      rank: true,
      compact: true,
      onHover: (row) => {
        if (!row) return link.hover(null);
        bubbles.setHot(row.key);
        const cells = row.item.cell >= 0 ? [row.item.cell] : [];
        link.hover({ resources: [row.idx], cells, label: row.label, color: row.color });
      },
      onClick: (row) => {
        const it = row.item;
        if (fin(it.x) && fin(it.y) && app.fitBounds) {
          app.fitBounds(it.x - 160, it.y - 120, it.x + 160, it.y + 120, { animate: true });
        }
      },
    });
  }

  function applyFilter() {
    const activeTypes = selectedType ? new Set([selectedType]) : activeSet;
    const allSelected = activeTypes.size === allChips.length;
    ctx.setResourceFilter(allSelected ? null : [...activeTypes]);

    const filtered = [];
    items.forEach((it, idx) => {
      if (activeTypes.has(it.type)) filtered.push({ item: it, idx });
    });

    const bItems = filtered.map(({ item, idx }) => {
      const m = META_MAP.get(item.type);
      const mw = item.capacity_mw || 600;
      const r = Math.max(4.5, Math.min(22, Math.sqrt(mw / 140)));
      return {
        key: String(idx),
        idx,
        item,
        x: item.x,
        y: item.y,
        r,
        color: m?.color || "#d98a2b",
        label: item.name,
      };
    });
    bubbles.setItems(bItems);
    renderTopItems(filtered);
  }

  renderProvBars();
  applyFilter();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["wri_gppd", "nea_power_2024", "cgs_usgs_minerals"]), [
      "WRI 全球电厂库与公开装机档案统计主要大中型电厂站点，未涵括全部分布式小水电与户用光伏。",
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
