// Interactive paginated/windowed Data Table for 1,302 Counties / 34 Provinces / ~90 Cities.
import { esc, fin, csvCell } from "./util.js";
import { fmtCell, parseNum } from "./fmt.js";

const PAGE_SIZE = 120;

export function createTable(host, opts) {
  let rows = opts.rows || [];
  let fields = opts.fields || [];
  let cols = opts.cols || [];
  let sortKey = opts.sortKey || cols[0] || "population";
  let sortDir = opts.sortDir ?? -1; // -1 desc, 1 asc
  let page = 0;
  let hotKey = null;
  let selKey = null;
  let sortedRows = [];

  const fieldMap = () => new Map(fields.map((f) => [f.key, f]));

  const root = document.createElement("div");
  root.className = "adv-table-wrap";
  root.innerHTML = `
    <div class="adv-tscroll">
      <table class="adv-table">
        <thead></thead>
        <tbody></tbody>
      </table>
    </div>
    <div class="adv-tpager">
      <span class="adv-tcount"></span>
      <div class="adv-row" style="margin:0">
        <button type="button" class="adv-mini" data-pg="prev">上一页</button>
        <span class="adv-tpage"></span>
        <button type="button" class="adv-mini" data-pg="next">下一页</button>
        <button type="button" class="adv-mini" data-csv>导出 CSV</button>
      </div>
    </div>`;
  host.appendChild(root);

  const thead = root.querySelector("thead");
  const tbody = root.querySelector("tbody");
  const countEl = root.querySelector(".adv-tcount");
  const pageEl = root.querySelector(".adv-tpage");
  const scrollEl = root.querySelector(".adv-tscroll");

  function sortData() {
    const fMap = fieldMap();
    const f = fMap.get(sortKey);
    const isNum = !f || f.type !== "categorical";
    sortedRows = [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (isNum && typeof va === "number" && typeof vb === "number") {
        return (va - vb) * sortDir;
      }
      const na = isNum ? parseNum(va) : null;
      const nb = isNum ? parseNum(vb) : null;
      if (na != null && nb != null) return (na - nb) * sortDir;
      return String(va).localeCompare(String(vb), "zh-CN") * sortDir;
    });
  }

  function renderHead() {
    const fMap = fieldMap();
    const arrow = (k) => (sortKey === k ? `<span class="arr">${sortDir > 0 ? "▲" : "▼"}</span>` : "");
    thead.innerHTML = `<tr>
      <th data-sort="_name">${esc(opts.nameLabel || "名称")}${arrow("_name")}</th>
      ${cols
        .map((k) => {
          const f = fMap.get(k);
          const label = opts.shortName?.(f) || f?.short || f?.label || k;
          return `<th data-sort="${esc(k)}" title="${esc(f?.description || f?.label || k)}">${esc(label)}${arrow(k)}</th>`;
        })
        .join("")}
    </tr>`;
  }

  function renderBody() {
    const fMap = fieldMap();
    const total = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const start = page * PAGE_SIZE;
    const slice = sortedRows.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = slice.length
      ? slice
          .map((r) => {
            const k = String(r.key);
            const cls = `${k === hotKey ? "hot" : ""} ${k === selKey ? "sel" : ""}`.trim();
            const sub = r.sub ? `<span class="sub">${esc(r.sub)}</span>` : "";
            return `<tr data-key="${esc(k)}" class="${cls}">
              <td title="${esc(r.full || r.name)}"><b>${esc(r.name)}</b>${sub}</td>
              ${cols
                .map((c) => {
                  const f = fMap.get(c);
                  return `<td>${esc(fmtCell(f, r[c]))}</td>`;
                })
                .join("")}
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:var(--ink-dim);padding:16px">没有匹配的记录。</td></tr>`;

    countEl.textContent = `共 ${total.toLocaleString("zh-CN")} 条${total > PAGE_SIZE ? `（显示 ${start + 1}–${Math.min(total, start + PAGE_SIZE)}）` : ""}`;
    pageEl.textContent = `${page + 1} / ${totalPages}`;
    root.querySelector('[data-pg="prev"]').disabled = page <= 0;
    root.querySelector('[data-pg="next"]').disabled = page >= totalPages - 1;
  }

  function render() {
    sortData();
    renderHead();
    renderBody();
  }

  thead.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const k = th.dataset.sort;
    if (sortKey === k) sortDir *= -1;
    else {
      sortKey = k;
      sortDir = k === "_name" ? 1 : -1;
    }
    page = 0;
    render();
    opts.onSort?.(sortKey, sortDir);
  });

  let curHover = null;
  const byKey = () => new Map(rows.map((r) => [String(r.key), r]));

  tbody.addEventListener("pointerover", (e) => {
    const tr = e.target.closest("tr[data-key]");
    const item = tr ? byKey().get(tr.dataset.key) || null : null;
    if (item === curHover) return;
    curHover = item;
    opts.onHover?.(item);
  });
  tbody.addEventListener("pointerleave", () => {
    if (!curHover) return;
    curHover = null;
    opts.onHover?.(null);
  });
  tbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-key]");
    if (!tr) return;
    const item = byKey().get(tr.dataset.key);
    if (item) opts.onClick?.(item);
  });

  root.querySelector('[data-pg="prev"]').addEventListener("click", () => {
    if (page > 0) {
      page--;
      renderBody();
      scrollEl.scrollTop = 0;
    }
  });
  root.querySelector('[data-pg="next"]').addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
    if (page < totalPages - 1) {
      page++;
      renderBody();
      scrollEl.scrollTop = 0;
    }
  });

  root.querySelector("[data-csv]").addEventListener("click", () => {
    const fMap = fieldMap();
    const exportCols = ["name", "sub", ...cols];
    const header = [opts.nameLabel || "名称", "所属", ...cols.map((k) => fMap.get(k)?.label || k)];
    const lines = [header.map(csvCell).join(",")];
    for (const r of sortedRows) {
      lines.push(exportCols.map((k) => csvCell(r[k])).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = opts.csvName ? `${opts.csvName}.csv` : "chinaciv-explorer.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  render();

  return {
    el: root,
    update(next = {}) {
      if (next.rows !== undefined) rows = next.rows;
      if (next.fields !== undefined) fields = next.fields;
      if (next.cols !== undefined) cols = next.cols;
      if (next.sortKey !== undefined) sortKey = next.sortKey;
      if (next.sortDir !== undefined) sortDir = next.sortDir;
      page = 0;
      render();
    },
    setHot(key, scrollIntoView = false) {
      hotKey = key == null ? null : String(key);
      if (scrollIntoView && hotKey != null) {
        const idx = sortedRows.findIndex((r) => String(r.key) === hotKey);
        if (idx >= 0) {
          const targetPage = Math.floor(idx / PAGE_SIZE);
          if (targetPage !== page) {
            page = targetPage;
            renderBody();
          }
        }
      }
      tbody.querySelectorAll("tr.hot").forEach((n) => n.classList.remove("hot"));
      if (hotKey == null) return;
      const tr = tbody.querySelector(`tr[data-key="${CSS.escape(hotKey)}"]`);
      if (tr) {
        tr.classList.add("hot");
        if (scrollIntoView) tr.scrollIntoView({ block: "nearest" });
      }
    },
    setSelected(key) {
      selKey = key == null ? null : String(key);
      tbody.querySelectorAll("tr.sel").forEach((n) => n.classList.remove("sel"));
      if (selKey == null) return;
      const tr = tbody.querySelector(`tr[data-key="${CSS.escape(selKey)}"]`);
      tr?.classList.add("sel");
    },
    getSortedRows: () => sortedRows,
  };
}
