// Lightweight SVG & DOM chart components for the 9 Advisors.
import { esc, fin, clamp, ratio, rampColor, RAMPS } from "./util.js";
import { fmtShort, pct } from "./fmt.js";

function wire(root, find, { onHover, onClick }) {
  let cur = null;
  const set = (item) => {
    if (item === cur) return;
    cur = item;
    onHover?.(item);
  };
  root.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-key]");
    set(t && root.contains(t) ? find(t) : null);
  });
  root.addEventListener("pointerleave", () => set(null));
  root.addEventListener("focusin", (e) => {
    const t = e.target.closest("[data-key]");
    if (t && root.contains(t)) set(find(t));
  });
  root.addEventListener("focusout", (e) => {
    if (!root.contains(e.relatedTarget)) set(null);
  });
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-key]");
    if (t && root.contains(t)) onClick?.(find(t), e);
  });
}

function markHot(root, key, cls = "hot") {
  root.querySelectorAll(`.${cls}`).forEach((n) => n.classList.remove(cls));
  if (key == null) return null;
  const n = root.querySelector(`[data-key="${CSS.escape(String(key))}"]`);
  n?.classList.add(cls);
  return n;
}

export function barList(host, opts) {
  const rows = opts.rows || [];
  const max = opts.max ?? Math.max(1e-12, ...rows.map((r) => Math.abs(r.value) || 0));
  const root = document.createElement("div");
  root.className = `adv-bars${opts.diverging ? " div" : ""}${opts.compact ? " compact" : ""}`;
  root.setAttribute("role", "list");
  if (opts.ariaLabel) root.setAttribute("aria-label", opts.ariaLabel);
  root.innerHTML = rows.length
    ? rows
        .map((r, i) => {
          const wv = fin(r.value) ? clamp(Math.abs(r.value) / max, 0, 1) * (opts.diverging ? 50 : 100) : 0;
          const neg = fin(r.value) && r.value < 0;
          const style = opts.diverging
            ? `${neg ? "right:50%" : "left:50%"};width:${wv.toFixed(2)}%`
            : `width:${wv.toFixed(2)}%`;
          const color = r.color ? `background:${esc(r.color)}` : "";
          const tip = [r.full || r.label, r.sub, r.text].filter(Boolean).join(" · ");
          return `<button type="button" role="listitem" class="adv-bar${r.key === opts.selected ? " sel" : ""}" data-key="${esc(r.key)}" title="${esc(tip)}">
            ${opts.rank ? `<span class="rk">${i + 1}</span>` : ""}${r.icon ? `<span class="ic" aria-hidden="true">${r.icon}</span>` : ""}
            <span class="lb">${esc(r.label)}${r.sub ? ` <span class="sub">${esc(r.sub)}</span>` : ""}</span>
            <span class="vl${r.tone ? " " + r.tone : ""}">${esc(r.text ?? "")}</span>
            <span class="tr"><i class="${neg ? "neg" : ""}${r.tone ? " " + r.tone : ""}" style="${style};${color}"></i></span>
          </button>`;
        })
        .join("")
    : `<p class="adv-empty">暂无数据。</p>`;
  host.appendChild(root);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  wire(root, (t) => byKey.get(t.dataset.key) || null, opts);
  return {
    el: root,
    setHot: (key) => markHot(root, key),
    setSelected: (key) => markHot(root, key, "sel"),
  };
}

export function stackedBars(host, opts) {
  const rows = opts.rows || [];
  const keys = opts.keys || [];
  const totalOf = (r) => r.total ?? keys.reduce((a, k) => a + (fin(r.parts?.[k.key]) ? r.parts[k.key] : 0), 0);
  const max = opts.max ?? Math.max(1e-12, ...rows.map(totalOf));
  const root = document.createElement("div");
  root.className = "adv-stack";
  root.setAttribute("role", "list");
  if (opts.ariaLabel) root.setAttribute("aria-label", opts.ariaLabel);
  root.innerHTML = rows.length
    ? rows
        .map((r) => {
          const tot = totalOf(r);
          const denom = opts.normalize ? tot || 1 : max;
          const segs = keys
            .map((k) => {
              const v = r.parts?.[k.key];
              if (!fin(v) || v <= 0) return "";
              const w = clamp((v / denom) * 100, 0, 100);
              const t = `${r.label} · ${k.label}: ${opts.fmtPart ? opts.fmtPart(v, tot, k) : pct((v / (tot || 1)) * 100)}`;
              return `<i data-part="${esc(k.key)}" style="width:${w.toFixed(2)}%;background:${esc(k.color)}" title="${esc(t)}"></i>`;
            })
            .join("");
          return `<button type="button" role="listitem" class="adv-srow${r.key === opts.selected ? " sel" : ""}" data-key="${esc(r.key)}" title="${esc(r.full || r.label)}">
            <span class="lb">${esc(r.label)}</span>
            <span class="st">${segs}</span>
            <span class="vl">${esc(r.text ?? fmtShort(tot))}</span>
          </button>`;
        })
        .join("")
    : `<p class="adv-empty">暂无数据。</p>`;
  host.appendChild(root);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  let cur = null;
  root.addEventListener("pointerover", (e) => {
    const rowEl = e.target.closest("[data-key]");
    const partEl = e.target.closest("[data-part]");
    const next = rowEl && root.contains(rowEl) ? { row: byKey.get(rowEl.dataset.key), part: partEl?.dataset.part || null } : null;
    if (next?.row === cur?.row && next?.part === cur?.part) return;
    cur = next;
    opts.onHover?.(next);
  });
  root.addEventListener("pointerleave", () => {
    if (!cur) return;
    cur = null;
    opts.onHover?.(null);
  });
  root.addEventListener("click", (e) => {
    const rowEl = e.target.closest("[data-key]");
    if (!rowEl || !root.contains(rowEl)) return;
    const partEl = e.target.closest("[data-part]");
    opts.onClick?.({ row: byKey.get(rowEl.dataset.key), part: partEl?.dataset.part || null }, e);
  });
  return {
    el: root,
    setHot: (key) => markHot(root, key),
    setSelected: (key) => markHot(root, key, "sel"),
  };
}

export function shareBar(host, opts) {
  const parts = (opts.parts || []).filter((p) => fin(p.value) && p.value > 0);
  const tot = opts.total ?? parts.reduce((a, p) => a + p.value, 0);
  const wrap = document.createElement("div");
  wrap.className = "adv-share";
  wrap.innerHTML = `
    <div class="adv-share-bar">${parts
      .map((p) => {
        const w = tot > 0 ? (p.value / tot) * 100 : 0;
        const txt = opts.fmt ? opts.fmt(p, tot) : `${w.toFixed(1)}%`;
        return `<span data-key="${esc(p.key)}" style="width:${w.toFixed(2)}%;background:${esc(p.color)}" title="${esc(`${p.label}: ${txt}`)}"></span>`;
      })
      .join("")}</div>
    <div class="adv-swatches">${parts
      .map((p) => {
        const w = tot > 0 ? (p.value / tot) * 100 : 0;
        const txt = opts.fmt ? opts.fmt(p, tot) : `${w.toFixed(1)}%`;
        return `<button type="button" class="adv-sw" data-key="${esc(p.key)}" title="${esc(`${p.label}: ${txt}`)}">
          <i style="background:${esc(p.color)}"></i>
          <span class="lb">${esc(p.label)}</span>
          <span class="vl">${esc(txt)}</span>
        </button>`;
      })
      .join("")}</div>`;
  host.appendChild(wrap);
  const byKey = new Map(parts.map((p) => [String(p.key), p]));
  wire(wrap, (t) => byKey.get(t.dataset.key) || null, opts);
  return {
    el: wrap,
    setHot: (key) => {
      wrap.querySelectorAll(".hot").forEach((n) => n.classList.remove("hot"));
      if (key == null) return;
      wrap.querySelectorAll(`[data-key="${CSS.escape(String(key))}"]`).forEach((n) => n.classList.add("hot"));
    },
  };
}

export function donut(host, opts) {
  const parts = (opts.parts || []).filter((p) => fin(p.value) && p.value > 0);
  const tot = opts.total ?? parts.reduce((a, p) => a + p.value, 0);
  const size = opts.size || 132;
  const rOut = size * 0.45;
  const rIn = size * (opts.innerRatio ?? 0.27);
  const cx = size / 2;
  const cy = size / 2;
  let ang = -Math.PI / 2;

  const paths = parts
    .map((p) => {
      const frac = tot > 0 ? p.value / tot : 0;
      const sweep = Math.min(Math.PI * 1.9999, frac * Math.PI * 2);
      const a0 = ang;
      const a1 = ang + sweep;
      ang = a1;
      const large = sweep > Math.PI ? 1 : 0;
      const x0 = cx + rOut * Math.cos(a0);
      const y0 = cy + rOut * Math.sin(a0);
      const x1 = cx + rOut * Math.cos(a1);
      const y1 = cy + rOut * Math.sin(a1);
      const x2 = cx + rIn * Math.cos(a1);
      const y2 = cy + rIn * Math.sin(a1);
      const x3 = cx + rIn * Math.cos(a0);
      const y3 = cy + rIn * Math.sin(a0);
      const d = `M${x0.toFixed(2)},${y0.toFixed(2)} A${rOut},${rOut} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${rIn},${rIn} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z`;
      const txt = opts.fmt ? opts.fmt(p, tot) : `${(frac * 100).toFixed(1)}%`;
      return `<path data-key="${esc(p.key)}" d="${d}" fill="${esc(p.color)}"><title>${esc(`${p.label}: ${txt}`)}</title></path>`;
    })
    .join("");

  const box = document.createElement("div");
  box.className = `adv-donut${opts.passive ? " passive" : ""}`;
  box.style.width = `${size}px`;
  box.style.height = `${size}px`;
  box.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}</svg>
    <div class="ctr">${opts.centerBig ? `<span class="big">${esc(opts.centerBig)}</span>` : ""}${opts.centerSmall ? `<span class="sm">${esc(opts.centerSmall)}</span>` : ""}</div>`;

  if (opts.legend) {
    const wrap = document.createElement("div");
    wrap.className = "adv-donut-wrap";
    wrap.appendChild(box);
    const leg = document.createElement("div");
    leg.className = "adv-donut-leg";
    leg.innerHTML = parts
      .map((p) => {
        const frac = tot > 0 ? (p.value / tot) * 100 : 0;
        const txt = opts.fmt ? opts.fmt(p, tot) : `${frac.toFixed(1)}%`;
        return `<button type="button" class="adv-sw" data-key="${esc(p.key)}">
          <i style="background:${esc(p.color)}"></i>
          <span class="lb">${esc(p.label)}</span>
          <span class="vl">${esc(txt)}</span>
        </button>`;
      })
      .join("");
    wrap.appendChild(leg);
    host.appendChild(wrap);
    const byKey = new Map(parts.map((p) => [String(p.key), p]));
    if (!opts.passive) wire(wrap, (t) => byKey.get(t.dataset.key) || null, opts);
    return {
      el: wrap,
      setHot: (key) => {
        wrap.querySelectorAll(".hot").forEach((n) => n.classList.remove("hot"));
        if (key != null) wrap.querySelectorAll(`[data-key="${CSS.escape(String(key))}"]`).forEach((n) => n.classList.add("hot"));
      },
    };
  }

  host.appendChild(box);
  const byKey = new Map(parts.map((p) => [String(p.key), p]));
  if (!opts.passive) wire(box, (t) => byKey.get(t.dataset.key) || null, opts);
  return { el: box, setHot: (key) => markHot(box, key) };
}

export function histogram(host, opts) {
  const items = opts.items || [];
  const getVal = opts.value || ((x) => x);
  const vals = items.map(getVal).filter((v) => fin(v) && (!opts.log || v > 0));
  if (!vals.length) {
    const p = document.createElement("p");
    p.className = "adv-empty";
    p.textContent = "暂无分布数据。";
    host.appendChild(p);
    return { el: p, setHot: () => {} };
  }
  const nBins = opts.bins || 18;
  const t = opts.log ? Math.log10 : (x) => x;
  const inv = opts.log ? (x) => 10 ** x : (x) => x;
  const tVals = vals.map(t);
  let lo = Math.min(...tVals);
  let hi = Math.max(...tVals);
  if (hi <= lo) hi = lo + 1;
  const step = (hi - lo) / nBins;
  const bins = Array.from({ length: nBins }, (_, i) => ({
    key: String(i),
    idx: i,
    x0: inv(lo + i * step),
    x1: inv(lo + (i + 1) * step),
    items: [],
  }));
  for (const item of items) {
    const v = getVal(item);
    if (!fin(v) || (opts.log && v <= 0)) continue;
    const bi = clamp(Math.floor((t(v) - lo) / step), 0, nBins - 1);
    bins[bi].items.push(item);
  }
  const maxC = Math.max(1, ...bins.map((b) => b.items.length));
  const w = 410;
  const h = opts.height || 92;
  const padB = 18;
  const padT = 6;
  const plotH = h - padB - padT;
  const bw = w / nBins;
  const rects = bins
    .map((b, i) => {
      const bh = (b.items.length / maxC) * plotH;
      const rx = (i * bw + 1).toFixed(2);
      const ry = (padT + plotH - bh).toFixed(2);
      const col = opts.color || "#c9a45c";
      const lbl = `${opts.fmt ? opts.fmt(b.x0) : fmtShort(b.x0)} – ${opts.fmt ? opts.fmt(b.x1) : fmtShort(b.x1)}: ${b.items.length}`;
      return `<rect data-key="${i}" x="${rx}" y="${ry}" width="${Math.max(2, bw - 2).toFixed(2)}" height="${Math.max(1, bh).toFixed(2)}" rx="1.5" fill="${esc(col)}" opacity="${b.items.length ? 0.85 : 0.16}"><title>${esc(lbl)}</title></rect>`;
    })
    .join("");
  const tickPos = [0, 0.25, 0.5, 0.75, 1];
  const labels = tickPos
    .map((f) => {
      const x = f * w;
      const v = inv(lo + f * (hi - lo));
      const anchor = f === 0 ? "start" : f === 1 ? "end" : "middle";
      return `<text class="ax" x="${x.toFixed(1)}" y="${h - 3}" text-anchor="${anchor}">${esc(opts.fmt ? opts.fmt(v) : fmtShort(v))}</text>`;
    })
    .join("");

  const box = document.createElement("div");
  box.className = "adv-hist";
  box.innerHTML = `<svg viewBox="0 0 ${w} ${h}">
    <line class="ax-line" x1="0" y1="${padT + plotH}" x2="${w}" y2="${padT + plotH}"/>
    ${rects}${labels}
  </svg>`;
  host.appendChild(box);
  const byKey = new Map(bins.map((b) => [b.key, b]));
  wire(box, (target) => byKey.get(target.dataset.key) || null, {
    onHover: (b) => opts.onHover?.(b),
    onClick: (b) => opts.onClick?.(b),
  });
  return { el: box, bins, setHot: (k) => markHot(box, k) };
}

export function smallMultiples(host, opts) {
  const rows = opts.rows || [];
  const grid = document.createElement("div");
  grid.className = "adv-mult-grid";
  rows.forEach((r) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "adv-mult";
    btn.dataset.key = String(r.key);
    btn.title = r.full || r.label;
    donut(btn, {
      parts: r.parts,
      size: opts.size || 74,
      innerRatio: 0.28,
      centerBig: r.centerBig || "",
      passive: true,
    });
    const lb = document.createElement("span");
    lb.className = "lb";
    lb.textContent = r.label;
    btn.appendChild(lb);
    if (r.sub) {
      const sub = document.createElement("span");
      sub.className = "sub";
      sub.textContent = r.sub;
      btn.appendChild(sub);
    }
    grid.appendChild(btn);
  });
  host.appendChild(grid);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  wire(grid, (t) => byKey.get(t.dataset.key) || null, opts);
  return { el: grid, setHot: (k) => markHot(grid, k) };
}

export function rampLegend(ramp = RAMPS.seq, loLabel = "", hiLabel = "") {
  const grad = `linear-gradient(90deg, ${ramp.join(", ")})`;
  return `<div class="adv-ramp"><span>${esc(loLabel)}</span><span class="bar" style="background:${grad}"></span><span>${esc(hiLabel)}</span></div>`;
}

export function swatchLegend(items) {
  return `<div class="adv-swleg">${items
    .map((it) => `<span><i style="background:${esc(it.color)}"></i>${esc(it.label)}</span>`)
    .join("")}</div>`;
}
