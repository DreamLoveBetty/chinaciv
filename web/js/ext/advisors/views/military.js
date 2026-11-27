// Advisor 7: 大将军 (Military & Defense — 5 PLA Theater Commands, Bases, Ranges & Branch Breakdown)
import { esc, fin, CAT_COLORS } from "../core/util.js";
import { int } from "../core/fmt.js";
import { ensureDatasets } from "../core/data.js";
import { shareBar, barList } from "../core/charts.js";
import { section, tiles, chips, sourcesHtml, frameBtn } from "../core/view.js";

const THEATER_COLORS = {
  eastern: "#4aa3d8",
  southern: "#3fb592",
  western: "#d9924a",
  northern: "#7b8eb8",
  central: "#c9a45c",
  "东部战区": "#4aa3d8",
  "南部战区": "#3fb592",
  "西部战区": "#d9924a",
  "北部战区": "#7b8eb8",
  "中部战区": "#c9a45c",
};

const BRANCH_COLORS = {
  joint: "#c9a45c",
  army: "#6e9a3c",
  navy: "#3a84c7",
  air: "#6bbbe8",
  rocket: "#d9674e",
  space: "#a378d6",
  support: "#8796ab",
  "陆军": "#6e9a3c",
  "海军": "#3a84c7",
  "空军": "#6bbbe8",
  "火箭军": "#d9674e",
};

const branchKeyOf = (x) => x.branch || "joint";
const branchLabelOf = (x) => x.branch_name || x.branch || "战区/联勤";
const theaterMatch = (item, selectedKey, selectedName) => {
  if (!selectedKey) return true;
  return item.theater === selectedKey || item.theater_name === selectedName || (item.theater_name || "").includes(selectedName);
};

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  await ensureDatasets(app, ["military"]);
  const mil = app.data.military || {};
  const theaters = mil.theaters || [];
  const insts = mil.installations || [];
  const ranges = mil.ranges || [];

  ctx.setLayer("military", true);

  tiles(el, [
    { label: "解放军战区格局", value: `${theaters.length || 5} 大战区`, sub: "联合作战指挥体制" },
    { label: "公开记录基地/港口/发射场", value: `${insts.length} 处`, sub: "军港、空军基地、航天中心等" },
    { label: "大型训练与测试靶场", value: `${ranges.length} 处`, sub: "朱日和、鼎新、酒泉等训练场" },
  ]);

  // 1. Theater Commands
  const thSec = section(el, {
    title: "中国人民解放军五大战区",
    note: "悬停战区高亮其辖区省份与驻地设施；点击锁定战区范围。",
  });
  let selectedTheater = null;
  const thHost = document.createElement("div");
  thSec.appendChild(thHost);

  const theaterName = (t) => t.name || t.id || "";
  const theaterProvs = (t) => {
    const arr = t.provinces || t.province_indices || [];
    if (arr.length && typeof arr[0] === "number") {
      return arr.map((i) => data.states[i]).filter(Boolean);
    }
    const names = new Set(arr);
    return data.states.filter((s) => names.has(s.name) || names.has(s.abbr) || names.has(s.code));
  };

  const thRows = theaters.map((t, idx) => {
    const tid = t.id || theaterName(t);
    const nm = theaterName(t);
    const cnt = insts.filter((x) => theaterMatch(x, tid, nm)).length;
    return {
      key: tid,
      name: nm,
      theater: t,
      provs: theaterProvs(t),
      label: nm,
      sub: t.hq_city ? `驻:${t.hq_city}` : t.hq ? `驻:${t.hq}` : "",
      value: cnt || 1,
      text: `${cnt} 处设施`,
      color: THEATER_COLORS[tid] || THEATER_COLORS[nm] || CAT_COLORS[idx % CAT_COLORS.length],
    };
  });

  const thBars = barList(thHost, {
    rows: thRows,
    onHover: (row) => {
      if (!row) return link.hover(null);
      link.hover(data.levels.provinces.highlight(row.provs, { color: row.color, dimOthers: true }));
    },
    onClick: (row) => {
      selectedTheater = selectedTheater === row.key ? null : row.key;
      thBars.setSelected(selectedTheater);
      if (selectedTheater) {
        link.base(data.levels.provinces.highlight(row.provs, { color: row.color, dimOthers: true }));
      } else {
        link.base(null);
      }
      syncBubbles();
    },
  });

  // 2. Branch breakdown & interactive filters
  const branchCounts = new Map();
  const branchNames = new Map();
  for (const x of insts) {
    const bk = branchKeyOf(x);
    branchCounts.set(bk, (branchCounts.get(bk) || 0) + 1);
    if (!branchNames.has(bk)) branchNames.set(bk, branchLabelOf(x));
  }
  const branches = [...branchCounts.entries()].map(([k, n], i) => ({
    key: k,
    label: branchNames.get(k) || k,
    count: n,
    color: BRANCH_COLORS[k] || CAT_COLORS[i % CAT_COLORS.length],
  }));

  const brSec = section(el, {
    title: "军兵种与重要设施筛选",
    note: "筛选特定军种基地与靶场，并在地图上显示对应圆形覆盖标记。",
  });
  shareBar(brSec, {
    parts: branches.map((b) => ({ key: b.key, label: b.label, color: b.color, value: b.count })),
    fmt: (p) => `${p.value} 处`,
  });

  let activeBranches = new Set(branches.map((b) => b.key));
  let showRanges = true;

  chips(brSec, {
    items: branches,
    selected: [...activeBranches],
    multi: true,
    onChange: (arr) => {
      activeBranches = new Set(arr);
      syncBubbles();
    },
  });

  const ctrlRow = document.createElement("div");
  ctrlRow.className = "adv-row";
  ctrlRow.innerHTML = `<label class="adv-check"><input type="checkbox" checked data-rng> 显示大型演训与试验靶场（${ranges.length}处）</label>`;
  frameBtn(ctrlRow, "全览中国");
  brSec.appendChild(ctrlRow);
  ctrlRow.querySelector("[data-rng]")?.addEventListener("change", (e) => {
    showRanges = e.target.checked;
    syncBubbles();
  });

  const bubbles = ctx.bubbles("military-sites", {
    onHover: (b) => {
      if (!b) return link.hover(null);
      if (b.item.cell >= 0) link.hover({ cells: [b.item.cell], label: b.label, color: b.color });
    },
    onClick: (b) => {
      if (!b) return;
      if (fin(b.x) && fin(b.y) && app.fitBounds) {
        app.fitBounds(b.x - 160, b.y - 120, b.x + 160, b.y + 120, { animate: true });
      }
    },
    tip: (b) => {
      const it = b.item;
      return `<b>${esc(it.name)}</b><br>${it.isRange ? "演训/试验靶场" : `军兵种：${esc(branchLabelOf(it))}`}${it.theater_name || it.theater ? `<br>隶属：${esc(it.theater_name || it.theater)}` : ""}${it.radius_km ? `<br>范围半径：约 ${int(it.radius_km)} km` : ""}`;
    },
  });

  // 3. Installations & Ranges Directory
  const listSec = section(el, { title: "重点国防基地、军港与发射场名录" });
  const listHost = document.createElement("div");
  listSec.appendChild(listHost);
  let listBars = null;

  function syncBubbles() {
    const selName = thRows.find((r) => r.key === selectedTheater)?.name || selectedTheater || "";
    const filteredInst = insts.filter((it) => {
      const bOk = activeBranches.has(branchKeyOf(it));
      const tOk = theaterMatch(it, selectedTheater, selName);
      return bOk && tOk;
    });
    const filteredRanges = showRanges
      ? ranges.filter((r) => theaterMatch(r, selectedTheater, selName))
      : [];

    const bItems = [
      ...filteredInst.map((it, idx) => ({
        key: `inst-${idx}`,
        item: it,
        x: it.x,
        y: it.y,
        r: 7,
        color: BRANCH_COLORS[branchKeyOf(it)] || "#8796ab",
        label: it.name,
      })),
      ...filteredRanges.map((r, idx) => ({
        key: `rng-${idx}`,
        item: { ...r, isRange: true },
        x: r.x,
        y: r.y,
        r: Math.max(10, Math.min(24, (r.radius_km || 50) * 0.25)),
        color: "#e69d5c",
        label: r.name,
      })),
    ];
    bubbles.setItems(bItems);

    listHost.innerHTML = "";
    const rows = [
      ...filteredRanges.map((r, i) => ({
        key: `rng-${i}`,
        item: r,
        label: r.name,
        sub: `靶场 · ${r.theater_name || r.theater || "全军"}`,
        value: r.radius_km || 60,
        text: r.radius_km ? `半径${int(r.radius_km)}km` : "训练基地",
        color: "#e69d5c",
      })),
      ...filteredInst.slice(0, 35).map((it, i) => ({
        key: `inst-${i}`,
        item: it,
        label: it.name,
        sub: `${branchLabelOf(it)} · ${it.theater_name || it.theater || ""}`,
        value: 40,
        text: it.theater_name || branchLabelOf(it),
        color: BRANCH_COLORS[branchKeyOf(it)] || "#8796ab",
      })),
    ];

    listBars = barList(listHost, {
      rows,
      compact: true,
      onHover: (row) => {
        if (!row) return link.hover(null);
        bubbles.setHot(row.key);
        if (row.item.cell >= 0) link.hover({ cells: [row.item.cell], label: row.label, color: row.color });
      },
      onClick: (row) => {
        if (fin(row.item.x) && fin(row.item.y) && app.fitBounds) {
          app.fitBounds(row.item.x - 150, row.item.y - 110, row.item.x + 150, row.item.y + 110, { animate: true });
        }
      },
    });
  }

  syncBubbles();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["mod_defense", "cnsa_space", "public_osint"]), [
      mil.caveats || "仅收录官方公报、航天发射场、国防科工与公开地理数据库已标注之大型基地、军港及演训靶场，不含涉密细节。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) return thBars?.setHot(null);
      const p = data.levels.provinces.rowAtCell(cell);
      if (!p) return thBars?.setHot(null);
      const match = thRows.find((r) => r.provs.some((pr) => pr.idx === p.idx));
      thBars?.setHot(match ? match.key : null);
    },
  };
}
