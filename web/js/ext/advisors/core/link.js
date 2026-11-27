// Bidirectional synchronization between Advisors/Explorer and the 25km Hex Map:
// - createLinker(app): base filter highlight + transient hover highlight + pulsing gold map beacon
// - createBubbles(app, id, opts): proportional world-space bubbles rendered via app.registerOverlay with hit testing
// - createMapTip(): floating dark-gold tooltip over hovered map bubbles
import { fin, esc, withAlpha } from "./util.js";
import { mapArea, worldToScreenPt } from "./frame.js";

const HOVER_COLOR = "#fff3c4";
const GOLD = "#ffd36a";
const PULSE_MS = 1400;
const BEACON_STILL = 0.35;
const BEACON_MS = PULSE_MS * (2 + BEACON_STILL);
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function highlightBox(app, hl) {
  if (!hl) return null;
  const w = app.w;
  if (!w) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const addXY = (x, y) => {
    if (!fin(x) || !fin(y)) return;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  const addCell = (c) => {
    if (c >= 0 && c < w.N) addXY(w.cx(c), w.cy(c));
  };
  for (const c of hl.cells || []) addCell(c);
  for (const ci of hl.counties || []) {
    for (const c of w.countyCells?.[ci] || []) addCell(c);
  }
  for (const si of hl.states || []) {
    const sb = w.stateBounds?.[si];
    if (sb) {
      addXY(sb.x0, sb.y0);
      addXY(sb.x1, sb.y1);
    }
  }
  const cities = app.data?.cities || [];
  for (const cid of hl.cities || []) {
    const c =
      typeof cid === "object" && cid
        ? cid
        : cities.find((x) => x.id === cid || x.code === cid || x.name === cid);
    if (c) addXY(c.x, c.y);
  }
  const items = app.data?.resources?.items || [];
  for (const idx of hl.resources || []) {
    if (items[idx]) addXY(items[idx].x, items[idx].y);
  }
  if (!fin(x0)) return null;
  const r = w.R || 14.5;
  return { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

function normalizeScreenTransform(ctx, info, cam) {
  const m = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const dpr = Number(info?.dpr || cam?.dpr || Math.min(window.devicePixelRatio || 1, 2));
  if (m && Math.abs(m.a - dpr) > 0.05 && Math.abs(m.a - 1) > 0.05) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

export function createLinker(app) {
  let base = null;
  let hov = null;
  let last = null;
  let quiet = 0;
  let hovQuiet = false;
  let beacon = null;
  let pulse = BEACON_STILL;
  let pulseT0 = 0;
  let ticking = false;

  const apply = () => {
    let h = hov ? { ...hov, color: hov.color || HOVER_COLOR } : base;
    if (hov && (base?.dimOthers || base?.dim) && hov.dimOthers == null) {
      h = { ...h, dimOthers: true, dim: true };
    }
    last = h;
    app.setHighlight?.(h);
    syncBeacon();
  };

  function tick() {
    if (!beacon || !beacon.active) {
      ticking = false;
      return;
    }
    const elapsed = performance.now() - pulseT0;
    const done = elapsed >= BEACON_MS;
    pulse = done ? BEACON_STILL : (elapsed % PULSE_MS) / PULSE_MS;
    app.requestDraw?.();
    if (done) ticking = false;
    else requestAnimationFrame(tick);
  }

  function restartPulse() {
    pulseT0 = performance.now();
    pulse = 0;
    if (!reduceMotion() && !ticking) {
      ticking = true;
      requestAnimationFrame(tick);
    }
  }

  function syncBeacon() {
    const want = hov && !hov.noBeacon && !hovQuiet ? highlightBox(app, last) : null;
    if (!want) {
      if (beacon) {
        beacon.active = false;
        beacon.off?.();
        beacon = null;
        app.requestDraw?.();
      }
      return;
    }
    const target = { box: want, label: hov.label || "" };
    if (!beacon) {
      const ref = { active: true, target, off: null };
      const ov = {
        id: "adv-hover-beacon",
        order: 120,
        z: 120,
        space: "screen",
        draw: (ctx, info) => {
          if (!ref.active) return;
          drawBeacon(ctx, info, ref.target);
        },
      };
      const off = app.registerOverlay?.(ov);
      ref.off = typeof off === "function" ? off : () => app.unregisterOverlay?.("adv-hover-beacon");
      beacon = ref;
      restartPulse();
    } else {
      beacon.target = target;
      restartPulse();
    }
    app.requestDraw?.();
  }

  function drawBeacon(ctx, info, t) {
    if (!t) return;
    ctx.save();
    normalizeScreenTransform(ctx, info, app.cam);
    const p0 = worldToScreenPt(app, t.box.x0, t.box.y0);
    const p1 = worldToScreenPt(app, t.box.x1, t.box.y1);
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;
    const w = Math.abs(p1.x - p0.x);
    const h = Math.abs(p1.y - p0.y);
    const area = mapArea(app);
    const inside = cx >= area.x0 + 6 && cx <= area.x1 - 6 && cy >= area.y0 + 6 && cy <= area.y1 - 6;

    ctx.font = "600 12px -apple-system, 'PingFang SC', 'Segoe UI', sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    if (inside) {
      const r = Math.max(12, Math.min(44, Math.hypot(w, h) / 2 + 6));
      const p = reduceMotion() ? BEACON_STILL : pulse;
      const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 2.0);
      g.addColorStop(0, "rgba(255, 211, 106, 0.28)");
      g.addColorStop(1, "rgba(255, 211, 106, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, r + p * 18, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 224, 138, ${(1 - p) * 0.85})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      if (t.label) {
        const ty = cy - r - 12;
        ctx.strokeStyle = "rgba(8, 14, 22, 0.9)";
        ctx.lineWidth = 4;
        ctx.textAlign = "center";
        ctx.strokeText(t.label, cx, ty);
        ctx.fillStyle = "#fff4d2";
        ctx.fillText(t.label, cx, ty);
      }
    } else {
      const px = Math.max(area.x0 + 22, Math.min(area.x1 - 22, cx));
      const py = Math.max(area.y0 + 22, Math.min(area.y1 - 22, cy));
      const ang = Math.atan2(cy - py, cx - px);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = GOLD;
      ctx.strokeStyle = "#120d06";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(11, 0);
      ctx.lineTo(-7, -6);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (t.label) {
        ctx.textAlign = px > (area.x0 + area.x1) / 2 ? "right" : "left";
        const tx = px + (px > (area.x0 + area.x1) / 2 ? -14 : 14);
        ctx.strokeStyle = "rgba(8, 14, 22, 0.92)";
        ctx.lineWidth = 4;
        ctx.strokeText(t.label, tx, py);
        ctx.fillStyle = "#fff4d2";
        ctx.fillText(t.label, tx, py);
      }
    }
    ctx.restore();
  }

  return {
    base(h) {
      base = h ? { ...h } : null;
      apply();
    },
    hover(h) {
      hovQuiet = quiet > 0;
      hov = h ? { ...h } : null;
      apply();
    },
    clear() {
      base = null;
      hov = null;
      last = null;
      app.setHighlight?.(null);
      syncBeacon();
    },
    fromMap(fn) {
      quiet++;
      try {
        return fn();
      } finally {
        quiet--;
      }
    },
    frame() {
      const box = highlightBox(app, base);
      if (!box) return false;
      app.fitBounds?.(box.x0, box.y0, box.x1, box.y1, { animate: true, padding: 48 });
      return true;
    },
    get currentBase() {
      return base;
    },
  };
}

export function createBubbles(app, id, opts = {}) {
  let items = []; // { key, x, y, r, color, stroke, label, data }
  let hotKey = null;
  let visible = true;
  let active = true;

  const ov = {
    id,
    order: opts.order ?? 65,
    z: opts.z ?? 65,
    space: "screen",
    draw(ctx, info) {
      if (!active || !visible || !items.length) return;
      ctx.save();
      normalizeScreenTransform(ctx, info, app.cam);
      const scale = app.cam?.zoom || 0.25;
      for (const b of items) {
        if (!fin(b.x) || !fin(b.y)) continue;
        const p = worldToScreenPt(app, b.x, b.y);
        const rad = Math.max(b.minPx ?? 4, Math.min(b.maxPx ?? 28, (b.r || 12) * Math.sqrt(scale * 2.2)));
        const isHot = hotKey != null && String(b.key) === String(hotKey);
        ctx.fillStyle = isHot ? withAlpha(b.color || GOLD, 0.55) : withAlpha(b.color || GOLD, 0.32);
        ctx.strokeStyle = isHot ? "#fff4d2" : b.stroke || b.color || GOLD;
        ctx.lineWidth = isHot ? 2.5 : 1.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (isHot && b.label) {
          ctx.font = "600 11.5px -apple-system, 'PingFang SC', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.strokeStyle = "rgba(8,14,22,.92)";
          ctx.lineWidth = 3.5;
          ctx.strokeText(b.label, p.x, p.y - rad - 4);
          ctx.fillStyle = "#fff4d2";
          ctx.fillText(b.label, p.x, p.y - rad - 4);
        }
      }
      ctx.restore();
    },
  };

  const off = app.registerOverlay?.(ov);

  return {
    handlers: opts,
    setItems(next) {
      items = next || [];
      app.requestDraw?.();
    },
    setHot(key) {
      if (hotKey === key) return;
      hotKey = key;
      app.requestDraw?.();
    },
    setVisible(v) {
      visible = !!v;
      app.requestDraw?.();
    },
    hit(clientX, clientY) {
      if (!visible || !items.length) return null;
      const canvas = document.getElementById("map-canvas");
      const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const scale = app.cam?.zoom || 0.25;
      let best = null;
      let bestD2 = Infinity;
      for (const b of items) {
        if (!fin(b.x) || !fin(b.y)) continue;
        const p = worldToScreenPt(app, b.x, b.y);
        const rad = Math.max(b.minPx ?? 4, Math.min(b.maxPx ?? 28, (b.r || 12) * Math.sqrt(scale * 2.2)));
        const d2 = (p.x - sx) ** 2 + (p.y - sy) ** 2;
        if (d2 <= (rad + 5) ** 2 && d2 < bestD2) {
          bestD2 = d2;
          best = b;
        }
      }
      return best;
    },
    destroy() {
      active = false;
      items = [];
      if (typeof off === "function") off();
      else app.unregisterOverlay?.(id);
      app.requestDraw?.();
    },
  };
}

export function createMapTip() {
  const div = document.createElement("div");
  div.className = "adv-maptip";
  div.style.display = "none";
  document.body.appendChild(div);

  return {
    show(x, y, html) {
      if (!html) return this.hide();
      div.innerHTML = html;
      div.style.display = "block";
      const r = div.getBoundingClientRect();
      const left = Math.min(window.innerWidth - r.width - 12, x + 14);
      const top = Math.max(12, Math.min(window.innerHeight - r.height - 12, y - 10));
      div.style.left = `${left}px`;
      div.style.top = `${top}px`;
      document.body.classList.add("adv-tip-on");
    },
    hide() {
      div.style.display = "none";
      document.body.classList.remove("adv-tip-on");
    },
    destroy() {
      this.hide();
      div.remove();
    },
  };
}
