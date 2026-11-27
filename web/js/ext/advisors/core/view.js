// Reusable UI section, KPI tile, control, lens button, and source attribution builders for Advisors.
import { esc, uid } from "./util.js";

export function section(parent, { title, kicker, note, open } = {}) {
  const sec = document.createElement("section");
  sec.className = "adv-sec";
  if (open !== undefined) {
    const det = document.createElement("details");
    det.open = !!open;
    det.innerHTML = `<summary>${kicker ? `<div class="adv-kicker">${esc(kicker)}</div>` : ""}${title ? `<h3>${esc(title)} ▾</h3>` : ""}</summary>${note ? `<p class="adv-note">${note}</p>` : ""}`;
    sec.appendChild(det);
    parent.appendChild(sec);
    return det;
  }
  sec.innerHTML = `${kicker ? `<div class="adv-kicker">${esc(kicker)}</div>` : ""}${title ? `<h3>${esc(title)}</h3>` : ""}${note ? `<p class="adv-note">${note}</p>` : ""}`;
  parent.appendChild(sec);
  return sec;
}

export function tiles(parent, items) {
  const grid = document.createElement("div");
  grid.className = "adv-tiles";
  grid.innerHTML = items
    .map((it) => {
      const long = String(it.value ?? "").length > 9 ? " long" : "";
      const style = it.color ? `style="--tc:${esc(it.color)}"` : "";
      return `<div class="adv-tile${long}" ${style} title="${esc([it.label, it.value, it.sub].filter(Boolean).join(" · "))}">
        <span class="k">${esc(it.label)}</span>
        <b>${esc(it.value ?? "—")}</b>
        ${it.sub ? `<span class="s">${esc(it.sub)}</span>` : ""}
      </div>`;
    })
    .join("");
  parent.appendChild(grid);
  return grid;
}

export function callout(parent, html, cls = "") {
  const div = document.createElement("div");
  div.className = `adv-callout${cls ? " " + cls : ""}`;
  div.innerHTML = html;
  parent.appendChild(div);
  return div;
}

export function segmented(parent, { label, value, options, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "adv-row";
  wrap.style.margin = "0";
  if (label) {
    const lb = document.createElement("span");
    lb.style.fontSize = "12px";
    lb.style.color = "var(--ink-dim)";
    lb.textContent = label;
    wrap.appendChild(lb);
  }
  const seg = document.createElement("div");
  seg.className = "adv-seg";
  let cur = value;
  const render = () => {
    seg.innerHTML = options
      .map(
        (o) =>
          `<button type="button" data-val="${esc(o.value)}" aria-pressed="${String(o.value === cur)}" title="${esc(o.title || o.label)}">${esc(o.label)}</button>`
      )
      .join("");
  };
  render();
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-val]");
    if (!btn) return;
    const next = btn.dataset.val;
    if (next === cur) return;
    cur = next;
    render();
    onChange?.(next);
  });
  wrap.appendChild(seg);
  parent.appendChild(wrap);
  return {
    el: wrap,
    setValue(v) {
      cur = v;
      render();
    },
  };
}

export function selectBox(parent, { label, value, options, groups, onChange }) {
  const lbl = document.createElement("label");
  lbl.className = "adv-select";
  const id = uid("sel");
  lbl.setAttribute("for", id);
  if (label) {
    const sp = document.createElement("span");
    sp.textContent = label;
    lbl.appendChild(sp);
  }
  const sel = document.createElement("select");
  sel.id = id;
  if (groups?.length) {
    for (const g of groups) {
      const og = document.createElement("optgroup");
      og.label = g.label;
      for (const o of g.options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        if (String(o.value) === String(value)) opt.selected = true;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  } else {
    for (const o of options || []) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      if (String(o.value) === String(value)) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  sel.addEventListener("change", () => onChange?.(sel.value));
  lbl.appendChild(sel);
  parent.appendChild(lbl);
  return {
    el: lbl,
    select: sel,
    setValue(v) {
      sel.value = String(v);
    },
  };
}

export function chips(parent, { items, selected, multi = true, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "adv-chips";
  let set = new Set(selected || items.map((x) => x.key));
  const render = () => {
    wrap.innerHTML = items
      .map((it) => {
        const on = set.has(it.key);
        const st = it.color ? `style="--cc:${esc(it.color)}"` : "";
        return `<button type="button" class="adv-chip" data-key="${esc(it.key)}" aria-checked="${String(on)}" ${st} title="${esc(it.title || it.label)}">
          <i></i>${it.icon ? `<span class="ic">${it.icon}</span>` : ""}<span>${esc(it.label)}</span>${it.count != null ? `<span class="n">${esc(it.count)}</span>` : ""}
        </button>`;
      })
      .join("");
  };
  render();
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-key]");
    if (!btn) return;
    const k = btn.dataset.key;
    if (multi) {
      if (set.has(k)) set.delete(k);
      else set.add(k);
    } else {
      set = new Set([k]);
    }
    render();
    onChange?.([...set], k);
  });
  parent.appendChild(wrap);
  return {
    el: wrap,
    getSelected: () => [...set],
    setSelected(arr) {
      set = new Set(arr);
      render();
    },
  };
}

export function slider(parent, { label, min, max, step = 1, value, fmt, onChange }) {
  const wrap = document.createElement("div");
  wrap.className = "adv-slider";
  const id = uid("rng");
  wrap.innerHTML = `<label for="${id}"><span>${esc(label)}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><b>${esc(fmt ? fmt(value) : value)}</b></label>`;
  const inp = wrap.querySelector("input");
  const out = wrap.querySelector("b");
  inp.addEventListener("input", () => {
    const v = Number(inp.value);
    out.textContent = fmt ? fmt(v) : String(v);
    onChange?.(v);
  });
  parent.appendChild(wrap);
  return {
    el: wrap,
    setValue(v) {
      inp.value = String(v);
      out.textContent = fmt ? fmt(v) : String(v);
    },
  };
}

export function lensButton(parent, ctx, lensId, label = "在地图视角中查看") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "adv-lensbtn";
  const updateState = () => {
    const cur = ctx.app.state?.lens;
    const curId = typeof cur === "string" ? cur : cur?.id;
    btn.setAttribute("aria-pressed", String(curId === lensId));
  };
  btn.innerHTML = `<span>🗺️</span><span>${esc(label)}</span>`;
  btn.addEventListener("click", () => {
    const cur = ctx.app.state?.lens;
    const curId = typeof cur === "string" ? cur : cur?.id;
    ctx.setLens(curId === lensId ? null : lensId);
    updateState();
  });
  ctx.on("lens", updateState);
  updateState();
  parent.appendChild(btn);
  return btn;
}

export function frameBtn(parent, label = "全览中国") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "adv-mini adv-framebtn";
  btn.setAttribute("data-frame", "1");
  btn.innerHTML = `<span>⌖</span><span>${esc(label)}</span>`;
  parent.appendChild(btn);
  return btn;
}

export function mapColorPicker(parent, ctx, options, initial, onPick) {
  const sec = section(parent, { kicker: "地图联动着色" });
  sec.classList.add("adv-mapsec");
  const row = document.createElement("div");
  row.className = "adv-mappick";
  row.innerHTML = `<span class="k">地图视角：</span>`;
  let cur = initial;
  const seg = segmented(row, {
    value: cur,
    options,
    onChange: (v) => {
      cur = v;
      onPick?.(v);
    },
  });
  frameBtn(row, "全览中国");
  sec.appendChild(row);
  return {
    el: sec,
    setValue(v) {
      cur = v;
      seg.setValue(v);
    },
  };
}

export function sourcesHtml(items = [], caveats = []) {
  const list = (items || [])
    .map((s) => {
      if (typeof s === "string") return `<li>${esc(s)}</li>`;
      const name = esc(s.name || s.id || "");
      const org = s.org ? `（${esc(s.org)}${s.vintage ? `，${esc(s.vintage)}` : ""}）` : "";
      const desc = s.description ? ` — ${esc(s.description)}` : "";
      return `<li><b>${name}</b>${org}${desc}</li>`;
    })
    .join("");
  const cav = caveats.length
    ? `<div class="adv-callout adv-caveat"><b>口径说明：</b>${caveats.map(esc).join("；")}</div>`
    : "";
  return `<section class="adv-sec">${cav}<details class="adv-sources"><summary>数据来源与口径说明（点击展开）</summary><ul>${list}</ul></details></section>`;
}
