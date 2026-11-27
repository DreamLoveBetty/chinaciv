// Explorer: Interactive 1,302-County / 34-Province / Major-City Explorer
// Linked Scatter Plot (Linear/Log, Pearson r/R^2, Drag-Brush Selection) + Virtualized/Paginated Table + CSV Export + Map Lens Sync.
import { esc, fin } from "../core/util.js";
import { fmtField, parseNum } from "../core/fmt.js";
import { GROUP_LABELS } from "../core/data.js";
import { createScatter } from "../core/scatter.js";
import { createTable } from "../core/table.js";
import { section, segmented, selectBox, sourcesHtml, frameBtn } from "../core/view.js";

const DEFAULT_COLS = {
  counties: ["province", "population", "density", "income", "home_price", "stem_pct"],
  provinces: ["population", "gdp", "gdp_per_capita", "disposable_income", "stem_share_pct"],
  cities: ["province", "population", "gdp", "gdp_per_capita", "disposable_income", "stem_share_pct"],
};

const DEFAULT_XY = {
  counties: { x: "income", y: "bachelors_pct", s: "population", c: "density", xLog: false, yLog: false },
  provinces: { x: "disposable_income", y: "gdp_per_capita", s: "population", c: "growth", xLog: false, yLog: false },
  cities: { x: "gdp_per_capita", y: "stem_share_pct", s: "population", c: "disposable_income", xLog: false, yLog: false },
};

const OPS = {
  num: [
    { value: ">", label: "大于 >" },
    { value: ">=", label: "≥" },
    { value: "<", label: "小于 <" },
    { value: "<=", label: "≤" },
  ],
  cat: [
    { value: "contains", label: "包含" },
    { value: "=", label: "等于 =" },
    { value: "!=", label: "不等于 ≠" },
  ],
};

const STORE_KEY = "chinaciv.advisors.explorer.v1";
const loadSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "null");
  } catch {
    return null;
  }
};
const saveState = (s) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

export async function mount(ctx) {
  const { app, data, el, link, tip } = ctx;
  await data.extendWithInfraAndMilitary();

  const avail = ["counties", "provinces", "cities"].filter((k) => data.levels[k]?.rows?.length);
  const saved = loadSaved() || {};
  const initLevel = avail.includes(ctx.params?.level)
    ? ctx.params.level
    : avail.includes(saved.level)
      ? saved.level
      : "counties";

  const st = {
    level: initLevel,
    cols: { ...DEFAULT_COLS, ...(saved.cols || {}) },
    xy: { ...DEFAULT_XY, ...(saved.xy || {}) },
    search: "",
    provFilter: "",
    filters: [],
    onlyBrushed: false,
    brushedKeys: null, // Set<string> or null
    selectedKey: null,
  };

  const persist = () => saveState({ level: st.level, cols: st.cols, xy: st.xy });
  const L = () => data.levels[st.level];
  const numericFields = () => L().fields.filter((f) => f.type !== "categorical");

  // --- 1. Level Switcher & Lens Sync -----------------------------------------------------------------------------
  const topSec = section(el, {
    title: "多维数据切片与空间探索",
    note: "切换 1,302 县 / 34 省 / 城市粒度；支持任意 X/Y 散点框选、与六边形地图双向联动。",
  });

  const lvRow = document.createElement("div");
  lvRow.className = "adv-row";
  topSec.appendChild(lvRow);

  segmented(lvRow, {
    value: st.level,
    options: avail.map((k) => ({ value: k, label: data.levels[k].label })),
    onChange: (v) => {
      st.level = v;
      st.filters = [];
      st.brushedKeys = null;
      st.onlyBrushed = false;
      st.selectedKey = null;
      persist();
      rebuildAll();
    },
  });
  frameBtn(lvRow, "全览中国");

  // One-click "在地图视角中查看" lens bar
  const lensRow = document.createElement("div");
  lensRow.className = "adv-row";
  topSec.appendChild(lensRow);

  // --- 2. Scatter Plot Section -----------------------------------------------------------------------------------
  const scatSec = section(el, {
    title: "双变量交互散点图（拖拽框选同步地图）",
    note: "支持线性/对数坐标切换与 Pearson r / R² 实时统计；在图中拖拽矩形即可框选特定县域群体。",
  });
  const axisBar = document.createElement("div");
  axisBar.className = "adv-row";
  scatSec.appendChild(axisBar);

  const axisBar2 = document.createElement("div");
  axisBar2.className = "adv-row";
  scatSec.appendChild(axisBar2);

  const scatterHost = document.createElement("div");
  scatSec.appendChild(scatterHost);

  const brushInfo = document.createElement("div");
  brushInfo.className = "adv-brushinfo";
  scatSec.appendChild(brushInfo);

  const scatter = createScatter(scatterHost, {
    onHover: (row, cx, cy) => {
      if (!row) {
        tip.hide();
        table?.setHot(null);
        return link.hover(null);
      }
      table?.setHot(row.key, false);
      link.hover(L().highlight(row, { dimOthers: !!st.brushedKeys }));
      tip.show(cx, cy, scatter.getPointTip(row));
    },
    onHoverMove: (row, cx, cy) => {
      if (row) tip.show(cx, cy, scatter.getPointTip(row));
    },
    onClick: (row) => {
      st.selectedKey = row.key;
      scatter.setSelected(row.key);
      table?.setSelected(row.key);
      table?.setHot(row.key, true);
      L().focus(row);
    },
    onBrush: (keySet, live) => {
      st.brushedKeys = keySet && keySet.size ? keySet : null;
      syncBrushToMapAndTable(live);
    },
  });

  // --- 3. Interactive Table Section ------------------------------------------------------------------------------
  const tblSec = section(el, {
    title: "可筛选排序数据表",
    note: "支持全字段列定制、条件过滤、按列升降序、表格与地图联动及 CSV 导出。",
  });

  const tbar = document.createElement("div");
  tbar.className = "adv-tbar";
  tblSec.appendChild(tbar);

  const filterBar = document.createElement("div");
  filterBar.className = "adv-chips adv-filterbar";
  tblSec.appendChild(filterBar);

  const fBuilder = document.createElement("div");
  fBuilder.className = "adv-fbuild";
  tblSec.appendChild(fBuilder);

  const tableHost = document.createElement("div");
  tblSec.appendChild(tableHost);

  let table = null;
  let currentFiltered = [];

  function matchesFilters(row) {
    if (st.onlyBrushed && st.brushedKeys && !st.brushedKeys.has(row.key)) return false;
    if (st.provFilter && row.province !== st.provFilter && row.sub !== st.provFilter) return false;
    if (st.search) {
      const q = st.search.trim().toLowerCase();
      if (q) {
        const hay = `${row.name} ${row.province || ""} ${row.region || ""} ${row.key}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
    }
    for (const f of st.filters) {
      const val = row[f.key];
      if (f.isCat) {
        const sv = String(val ?? "").toLowerCase();
        const fv = String(f.val ?? "").toLowerCase();
        if (f.op === "contains" && !sv.includes(fv)) return false;
        if (f.op === "=" && sv !== fv) return false;
        if (f.op === "!=" && sv === fv) return false;
      } else {
        const nv = Number(val);
        const target = parseNum(f.val);
        if (!fin(nv) || target == null) return false;
        if (f.op === ">" && !(nv > target)) return false;
        if (f.op === ">=" && !(nv >= target)) return false;
        if (f.op === "<" && !(nv < target)) return false;
        if (f.op === "<=" && !(nv <= target)) return false;
      }
    }
    return true;
  }

  function applyFiltersAndSync(skipScatter = false) {
    const lv = L();
    currentFiltered = lv.rows.filter(matchesFilters);
    const cols = (st.cols[st.level] || []).filter((k) => lv.field(k));
    if (!table) {
      table = createTable(tableHost, {
        rows: currentFiltered,
        fields: lv.fields,
        cols,
        nameLabel: lv.singular,
        csvName: `chinaciv-${st.level}`,
        onHover: (row) => {
          if (!row) {
            scatter.setHot(null);
            return link.hover(null);
          }
          scatter.setHot(row.key);
          link.hover(lv.highlight(row, { dimOthers: !!st.brushedKeys }));
        },
        onClick: (row) => {
          st.selectedKey = row.key;
          scatter.setSelected(row.key);
          table.setSelected(row.key);
          lv.focus(row);
        },
      });
    } else {
      table.update({
        rows: currentFiltered,
        fields: lv.fields,
        cols,
      });
    }

    if (!skipScatter) {
      const xy = st.xy[st.level] || {};
      scatter.update({
        rows: st.onlyBrushed ? currentFiltered : lv.rows.filter((r) => {
          const prev = st.onlyBrushed;
          st.onlyBrushed = false;
          const ok = matchesFilters(r);
          st.onlyBrushed = prev;
          return ok;
        }),
        xField: lv.field(xy.x) || numericFields()[0],
        yField: lv.field(xy.y) || numericFields()[1] || numericFields()[0],
        sField: xy.s ? lv.field(xy.s) : null,
        cField: xy.c ? lv.field(xy.c) : null,
        xLog: !!xy.xLog,
        yLog: !!xy.yLog,
        brushed: st.brushedKeys,
      });
    }
    syncBaseHighlight();
  }

  function syncBaseHighlight() {
    const lv = L();
    if (st.brushedKeys && st.brushedKeys.size) {
      const subset = lv.rows.filter((r) => st.brushedKeys.has(r.key));
      link.base(lv.highlight(subset, { dimOthers: true, color: "#ecd08e" }));
    } else if (st.filters.length || st.provFilter || st.search) {
      if (currentFiltered.length > 0 && currentFiltered.length < lv.rows.length) {
        link.base(lv.highlight(currentFiltered, { dimOthers: true, color: "#9a7bc9" }));
      } else {
        link.base(null);
      }
    } else {
      link.base(null);
    }
  }

  function syncBrushToMapAndTable(live) {
    const cnt = st.brushedKeys?.size || 0;
    if (cnt > 0) {
      brushInfo.innerHTML = `已框选 <b>${cnt.toLocaleString("zh-CN")}</b> 个${esc(L().singular)}（已在地图同步高亮） <button type="button" class="adv-mini" data-clr-brush>清除框选</button>`;
      brushInfo.querySelector("[data-clr-brush]")?.addEventListener("click", () => {
        scatter.clearBrush();
        st.brushedKeys = null;
        st.onlyBrushed = false;
        const cb = tbar.querySelector("[data-only-brush]");
        if (cb) cb.checked = false;
        syncBrushToMapAndTable(false);
      });
    } else {
      brushInfo.innerHTML = "";
    }
    syncBaseHighlight();
    if (!live) {
      const onlyCb = tbar.querySelector("[data-only-brush]");
      if (onlyCb) onlyCb.disabled = cnt === 0;
      if (st.onlyBrushed || cnt === 0) applyFiltersAndSync(true);
    }
  }

  function renderLensBar() {
    lensRow.innerHTML = "";
    const xy = st.xy[st.level] || {};
    const candidates = [L().field(xy.c), L().field(xy.y), L().field(xy.x)].filter((f) => f?.lens);
    const picked = candidates[0] || L().fields.find((f) => f.lens);
    if (!picked) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adv-lensbtn";
    const curLens = () => (typeof app.state.lens === "string" ? app.state.lens : app.state.lens?.id);
    btn.setAttribute("aria-pressed", String(curLens() === picked.lens));
    btn.innerHTML = `🗺️ 在地图视角中查看「${esc(picked.short || picked.label)}」`;
    btn.addEventListener("click", () => {
      ctx.setLens(curLens() === picked.lens ? null : picked.lens);
      btn.setAttribute("aria-pressed", String(curLens() === picked.lens));
    });
    lensRow.appendChild(btn);

    const hint = document.createElement("span");
    hint.className = "adv-note";
    hint.style.margin = "0";
    hint.textContent = `当前数据集：${L().rows.length.toLocaleString("zh-CN")} 行 · ${L().fields.length} 个指标`;
    lensRow.appendChild(hint);
  }

  function buildAxisControls() {
    axisBar.innerHTML = "";
    axisBar2.innerHTML = "";
    const lv = L();
    const numF = numericFields();
    const xy = (st.xy[st.level] ||= { x: numF[0]?.key, y: numF[1]?.key || numF[0]?.key, s: "", c: "", xLog: false, yLog: false });
    if (!lv.field(xy.x)) xy.x = numF[0]?.key;
    if (!lv.field(xy.y)) xy.y = numF[1]?.key || numF[0]?.key;

    const numOpts = numF.map((f) => ({ value: f.key, label: f.label }));
    const allOpts = [{ value: "", label: "（无）" }, ...lv.fields.map((f) => ({ value: f.key, label: f.label }))];

    selectBox(axisBar, {
      label: "X 轴",
      value: xy.x,
      options: numOpts,
      onChange: (v) => {
        xy.x = v;
        persist();
        renderLensBar();
        applyFiltersAndSync();
      },
    });
    const xLogBtn = document.createElement("button");
    xLogBtn.type = "button";
    xLogBtn.className = "adv-mini";
    xLogBtn.textContent = xy.xLog ? "X:对数" : "X:线性";
    xLogBtn.setAttribute("aria-pressed", String(!!xy.xLog));
    xLogBtn.addEventListener("click", () => {
      xy.xLog = !xy.xLog;
      xLogBtn.textContent = xy.xLog ? "X:对数" : "X:线性";
      xLogBtn.setAttribute("aria-pressed", String(xy.xLog));
      persist();
      applyFiltersAndSync();
    });
    axisBar.appendChild(xLogBtn);

    selectBox(axisBar, {
      label: "Y 轴",
      value: xy.y,
      options: numOpts,
      onChange: (v) => {
        xy.y = v;
        persist();
        renderLensBar();
        applyFiltersAndSync();
      },
    });
    const yLogBtn = document.createElement("button");
    yLogBtn.type = "button";
    yLogBtn.className = "adv-mini";
    yLogBtn.textContent = xy.yLog ? "Y:对数" : "Y:线性";
    yLogBtn.setAttribute("aria-pressed", String(!!xy.yLog));
    yLogBtn.addEventListener("click", () => {
      xy.yLog = !xy.yLog;
      yLogBtn.textContent = xy.yLog ? "Y:对数" : "Y:线性";
      yLogBtn.setAttribute("aria-pressed", String(xy.yLog));
      persist();
      applyFiltersAndSync();
    });
    axisBar.appendChild(yLogBtn);

    selectBox(axisBar2, {
      label: "气泡大小",
      value: xy.s || "",
      options: [{ value: "", label: "统一大小" }, ...numOpts],
      onChange: (v) => {
        xy.s = v;
        persist();
        applyFiltersAndSync();
      },
    });
    selectBox(axisBar2, {
      label: "颜色映射",
      value: xy.c || "",
      options: allOpts,
      onChange: (v) => {
        xy.c = v;
        persist();
        renderLensBar();
        applyFiltersAndSync();
      },
    });
  }

  function buildTableControls() {
    tbar.innerHTML = "";
    const lv = L();

    // Search + Province filter
    const searchWrap = document.createElement("div");
    searchWrap.className = "adv-tsearch";
    const inp = document.createElement("input");
    inp.type = "search";
    inp.placeholder = `搜索${lv.singular}名称或省份…`;
    inp.value = st.search;
    inp.addEventListener("input", () => {
      st.search = inp.value;
      applyFiltersAndSync();
    });
    searchWrap.appendChild(inp);
    tbar.appendChild(searchWrap);

    if (st.level !== "provinces") {
      const provNames = [...new Set(lv.rows.map((r) => r.province || r.sub).filter(Boolean))];
      selectBox(tbar, {
        value: st.provFilter,
        options: [{ value: "", label: "全部省区" }, ...provNames.map((p) => ({ value: p, label: p }))],
        onChange: (v) => {
          st.provFilter = v;
          applyFiltersAndSync();
        },
      });
    }

    // Only brushed toggle
    const onlyLbl = document.createElement("label");
    onlyLbl.className = "adv-check";
    onlyLbl.innerHTML = `<input type="checkbox" data-only-brush ${st.onlyBrushed ? "checked" : ""} ${st.brushedKeys ? "" : "disabled"}> <span>仅显示框选结果</span>`;
    onlyLbl.querySelector("input").addEventListener("change", (e) => {
      st.onlyBrushed = e.target.checked;
      applyFiltersAndSync(true);
    });
    tbar.appendChild(onlyLbl);

    // Column Picker popover
    const colsBox = document.createElement("details");
    colsBox.className = "adv-cols";
    const chosen = new Set(st.cols[st.level] || []);
    const byGrp = new Map();
    for (const f of lv.fields) {
      const g = f.group || "people";
      if (!byGrp.has(g)) byGrp.set(g, []);
      byGrp.get(g).push(f);
    }
    colsBox.innerHTML = `<summary class="adv-mini">选择列 (${chosen.size}) ▾</summary>
      <div class="adv-cols-pop">
        ${[...byGrp.entries()]
          .map(
            ([g, fs]) => `<div class="adv-cols-grp"><h5>${esc(GROUP_LABELS[g] || g)}</h5>
              <div class="adv-cols-list">
                ${fs
                  .map(
                    (f) =>
                      `<label class="adv-check"><input type="checkbox" value="${esc(f.key)}" ${chosen.has(f.key) ? "checked" : ""}><span>${esc(f.short || f.label)}</span></label>`
                  )
                  .join("")}
              </div></div>`
          )
          .join("")}
      </div>`;
    colsBox.addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const next = [...colsBox.querySelectorAll('input[type="checkbox"]:checked')].map((x) => x.value);
      st.cols[st.level] = next.length ? next : [lv.fields[0].key];
      colsBox.querySelector("summary").textContent = `选择列 (${st.cols[st.level].length}) ▾`;
      persist();
      applyFiltersAndSync(true);
    });
    tbar.appendChild(colsBox);

    // Filter builder
    buildFilterBuilder();
  }

  function renderFilterChips() {
    filterBar.innerHTML = st.filters
      .map((f, i) => {
        const fld = L().field(f.key);
        return `<span class="adv-fchip"><span>${esc(fld?.short || f.key)} ${esc(f.op)} ${esc(f.val)}</span><button type="button" data-rm="${i}" title="移除筛选">✕</button></span>`;
      })
      .join("");
    filterBar.querySelectorAll("button[data-rm]").forEach((b) =>
      b.addEventListener("click", () => {
        st.filters.splice(Number(b.dataset.rm), 1);
        renderFilterChips();
        applyFiltersAndSync();
      })
    );
  }

  function buildFilterBuilder() {
    fBuilder.innerHTML = "";
    const lv = L();
    let fKey = lv.fields[0]?.key || "";
    const fldSel = selectBox(fBuilder, {
      label: "条件筛选",
      value: fKey,
      options: lv.fields.map((f) => ({ value: f.key, label: f.short || f.label })),
      onChange: (v) => {
        fKey = v;
        syncOps();
      },
    });
    const opSel = document.createElement("select");
    const valInp = document.createElement("input");
    valInp.type = "text";
    valInp.placeholder = "数值或关键字";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "adv-mini";
    addBtn.textContent = "+ 添加";

    function syncOps() {
      const f = lv.field(fKey);
      const isCat = f?.type === "categorical";
      const list = isCat ? OPS.cat : OPS.num;
      opSel.innerHTML = list.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    }
    syncOps();
    fBuilder.appendChild(opSel);
    fBuilder.appendChild(valInp);
    fBuilder.appendChild(addBtn);

    const add = () => {
      const raw = valInp.value.trim();
      if (!raw) return;
      const f = lv.field(fKey);
      const isCat = f?.type === "categorical";
      if (!isCat && parseNum(raw) == null) return;
      st.filters.push({ key: fKey, op: opSel.value, val: raw, isCat });
      valInp.value = "";
      renderFilterChips();
      applyFiltersAndSync();
    };
    addBtn.addEventListener("click", add);
    valInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") add();
    });
    renderFilterChips();
  }

  function rebuildAll() {
    buildAxisControls();
    buildTableControls();
    renderLensBar();
    brushInfo.innerHTML = "";
    applyFiltersAndSync();
  }

  rebuildAll();

  el.insertAdjacentHTML(
    "beforeend",
    sourcesHtml(data.sourcesById(["nbs_2024_communique", "nbs_census_7th", "most_rd_2024", "usgs_earthquake_catalog", "mnr_land_survey"]), [
      "县域数据覆盖全国1,302个实测县级行政区单元（部分超大城市核心区经合并对齐至25km六边形栅格）。",
    ])
  );

  return {
    onMapHover(cell) {
      if (cell < 0) {
        scatter.setHot(null);
        table?.setHot(null);
        return;
      }
      const row = L().rowAtCell(cell);
      scatter.setHot(row ? row.key : null);
      table?.setHot(row ? row.key : null, false);
    },
    onMapClick(ev) {
      const cell = ev?.cell ?? app.state.hoverCell;
      if (cell == null || cell < 0) return false;
      const row = L().rowAtCell(cell);
      if (!row) return false;
      st.selectedKey = row.key;
      scatter.setSelected(row.key);
      table?.setSelected(row.key);
      table?.setHot(row.key, true);
      return true;
    },
    onEscape() {
      if (st.brushedKeys) {
        scatter.clearBrush();
        st.brushedKeys = null;
        st.onlyBrushed = false;
        syncBrushToMapAndTable(false);
        return true;
      }
      return false;
    },
    destroy() {
      scatter.destroy();
    },
  };
}
