// High-performance 60fps Canvas + SVG Scatter Plot with Linear/Log axes, Pearson r / R^2, and zero-reflow drag-brush selection.
import { esc, fin, clamp, scale, ticks, logTicks, pad, extent, robustDomain, pearson, colorScale, RAMPS, CAT_COLORS } from "./util.js";
import { fmtShort, fmtField } from "./fmt.js";

const PAD = { l: 46, r: 14, t: 12, b: 30 };

export function createScatter(host, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "adv-scatter-box";
  wrap.innerHTML = `
    <div class="adv-scatter-stats">
      <span class="st-corr">Pearson r: <b>—</b> · R²: <b>—</b></span>
      <span class="st-n"></span>
    </div>
    <div class="adv-scatter-wrap">
      <canvas></canvas>
      <svg class="adv-scatter-svg"></svg>
    </div>`;
  host.appendChild(wrap);

  const stage = wrap.querySelector(".adv-scatter-wrap");
  const canvas = stage.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const svg = stage.querySelector("svg");
  const corrEl = wrap.querySelector(".st-corr");
  const nEl = wrap.querySelector(".st-n");

  let state = {
    rows: [],
    xField: null,
    yField: null,
    sField: null,
    cField: null,
    xLog: false,
    yLog: false,
    brushed: null,
    hotKey: null,
    selKey: null,
  };

  let pts = [];
  let sx = null;
  let sy = null;
  let width = 410;
  let height = 280;
  let brushRect = null;
  let brushRectEl = null;
  let stageRect = null;
  let dragging = null;
  let brushRaf = 0;

  function computeLayout() {
    stageRect = stage.getBoundingClientRect();
    width = Math.max(280, Math.round(stageRect.width || 410));
    height = 280;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;

    const { rows, xField, yField, sField, cField, xLog, yLog } = state;
    if (!xField || !yField) {
      pts = [];
      return;
    }

    const valid = [];
    const xs = [];
    const ys = [];
    const ss = [];
    const cs = [];
    const isCatColor = cField && cField.type === "categorical";

    for (const row of rows) {
      const vx = Number(row[xField.key]);
      const vy = Number(row[yField.key]);
      if (!fin(vx) || !fin(vy)) continue;
      if (xLog && vx <= 0) continue;
      if (yLog && vy <= 0) continue;
      valid.push({ row, vx, vy });
      xs.push(xLog ? Math.log10(vx) : vx);
      ys.push(yLog ? Math.log10(vy) : vy);
      if (sField) {
        const vs = Number(row[sField.key]);
        if (fin(vs) && vs > 0) ss.push(vs);
      }
      if (cField && !isCatColor) {
        const vc = Number(row[cField.key]);
        if (fin(vc)) cs.push(vc);
      }
    }

    const dxRaw = extent(valid.map((d) => d.vx), xLog);
    const dyRaw = extent(valid.map((d) => d.vy), yLog);
    if (!dxRaw || !dyRaw) {
      pts = [];
      corrEl.innerHTML = `Pearson r: <b>—</b> · R²: <b>—</b>`;
      nEl.textContent = "有效点: 0";
      svg.innerHTML = "";
      brushRectEl = null;
      drawCanvas();
      return;
    }

    const dx = pad(dxRaw, 0.05, xLog);
    const dy = pad(dyRaw, 0.06, yLog);
    sx = scale(dx, [PAD.l, width - PAD.r], { log: xLog });
    sy = scale(dy, [height - PAD.b, PAD.t], { log: yLog });

    let sizeScale = null;
    if (sField && ss.length) {
      const ds = robustDomain(ss, 0.02, true) || extent(ss, true);
      if (ds) sizeScale = scale(ds, [2.8, 12], { log: true, clampOut: true });
    }

    let colFn = () => "#e0b54c";
    if (cField) {
      if (isCatColor) {
        const cats = [...new Set(valid.map((d) => String(d.row[cField.key] ?? "其他")))];
        const map = new Map(cats.map((c, i) => [c, CAT_COLORS[i % CAT_COLORS.length]]));
        colFn = (r) => map.get(String(r[cField.key] ?? "其他")) || "#7d7466";
      } else if (cs.length) {
        const dc = robustDomain(cs, 0.03, false) || extent(cs, false);
        if (dc) {
          const ramp = dc[0] < 0 && dc[1] > 0 ? RAMPS.div : RAMPS.seq;
          const csFn = colorScale(dc, ramp);
          colFn = (r) => csFn(Number(r[cField.key]));
        }
      }
    }

    pts = valid.map(({ row, vx, vy }) => {
      const px = sx(vx);
      const py = sy(vy);
      const vs = sField ? Number(row[sField.key]) : null;
      const r = sizeScale && fin(vs) && vs > 0 ? sizeScale(vs) : rows.length > 300 ? 3.0 : 5.2;
      return {
        row,
        key: String(row.key),
        px,
        py,
        r,
        color: colFn(row),
        vx,
        vy,
      };
    });

    const stats = pearson(xs, ys);
    corrEl.innerHTML =
      stats.r != null
        ? `Pearson r${xLog || yLog ? "(对数)" : ""}: <b>${stats.r.toFixed(3)}</b> · R²: <b>${stats.r2.toFixed(3)}</b>`
        : `Pearson r: <b>—</b> · R²: <b>—</b>`;
    nEl.textContent = `N = ${stats.n.toLocaleString("zh-CN")}`;

    renderSvgAxes(dx, dy);
    drawCanvas();
  }

  function renderSvgAxes(dx, dy) {
    const xt = state.xLog ? logTicks(dx[0], dx[1]) : ticks(dx[0], dx[1], 5);
    const yt = state.yLog ? logTicks(dy[0], dy[1]) : ticks(dy[0], dy[1], 5);
    const x0 = PAD.l;
    const x1 = width - PAD.r;
    const y0 = PAD.t;
    const y1 = height - PAD.b;

    const gridX = xt
      .map((v) => {
        const x = sx(v);
        if (!fin(x) || x < x0 - 1 || x > x1 + 1) return "";
        return `<line x1="${x.toFixed(1)}" y1="${y0}" x2="${x.toFixed(1)}" y2="${y1}" stroke="rgba(201,164,92,.12)"/>
                <text x="${x.toFixed(1)}" y="${y1 + 13}" text-anchor="middle" fill="#b9ab88" font-size="10">${esc(fmtShort(v))}</text>`;
      })
      .join("");

    const gridY = yt
      .map((v) => {
        const y = sy(v);
        if (!fin(y) || y < y0 - 1 || y > y1 + 1) return "";
        return `<line x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}" stroke="rgba(201,164,92,.12)"/>
                <text x="${x0 - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#b9ab88" font-size="10">${esc(fmtShort(v))}</text>`;
      })
      .join("");

    const xLabel = state.xField?.short || state.xField?.label || "";
    const yLabel = state.yField?.short || state.yField?.label || "";

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${gridX}${gridY}
      <line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" stroke="rgba(201,164,92,.4)"/>
      <line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y1}" stroke="rgba(201,164,92,.4)"/>
      <text x="${(x0 + x1) / 2}" y="${height - 4}" text-anchor="middle" fill="#ecd08e" font-size="10.5">${esc(xLabel)}</text>
      <text x="${x0 + 6}" y="${y0 + 10}" fill="#ecd08e" font-size="10.5">${esc(yLabel)}</text>
      <rect class="adv-brush-rect" visibility="hidden" x="0" y="0" width="0" height="0"/>`;
    brushRectEl = svg.querySelector(".adv-brush-rect");
    updateBrushRectSvg();
  }

  function updateBrushRectSvg() {
    if (!brushRectEl) return;
    if (!brushRect) {
      brushRectEl.setAttribute("visibility", "hidden");
      return;
    }
    const bx = Math.min(brushRect.x0, brushRect.x1);
    const by = Math.min(brushRect.y0, brushRect.y1);
    const bw = Math.abs(brushRect.x1 - brushRect.x0);
    const bh = Math.abs(brushRect.y1 - brushRect.y0);
    brushRectEl.setAttribute("x", bx.toFixed(1));
    brushRectEl.setAttribute("y", by.toFixed(1));
    brushRectEl.setAttribute("width", bw.toFixed(1));
    brushRectEl.setAttribute("height", bh.toFixed(1));
    brushRectEl.setAttribute("visibility", "visible");
  }

  function drawCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const hasBrush = state.brushed && state.brushed.size > 0;
    const hotKey = state.hotKey;
    const selKey = state.selKey;
    let hotPt = null;
    let selPt = null;
    const strokePts = pts.length <= 150;
    const activeAlpha = pts.length > 300 ? 0.78 : 0.9;

    // Group fills by color+alpha when many dots exist -> reduces 1,302 path fills
    if (!strokePts) {
      const dimBuckets = new Map();
      const litBuckets = new Map();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.key === hotKey) hotPt = p;
        if (p.key === selKey) selPt = p;
        const inBrush = !hasBrush || state.brushed.has(p.key);
        const map = inBrush ? litBuckets : dimBuckets;
        let arr = map.get(p.color);
        if (!arr) {
          arr = [];
          map.set(p.color, arr);
        }
        arr.push(p);
      }

      if (dimBuckets.size) {
        ctx.globalAlpha = 0.14;
        for (const [color, arr] of dimBuckets) {
          ctx.fillStyle = color;
          ctx.beginPath();
          for (let i = 0; i < arr.length; i++) {
            const p = arr[i];
            ctx.moveTo(p.px + p.r, p.py);
            ctx.arc(p.px, p.py, p.r, 0, Math.PI * 2);
          }
          ctx.fill();
        }
      }

      ctx.globalAlpha = activeAlpha;
      for (const [color, arr] of litBuckets) {
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          ctx.moveTo(p.px + p.r, p.py);
          ctx.arc(p.px, p.py, p.r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    } else {
      for (const p of pts) {
        if (p.key === hotKey) hotPt = p;
        if (p.key === selKey) selPt = p;
        const inBrush = !hasBrush || state.brushed.has(p.key);
        ctx.globalAlpha = inBrush ? activeAlpha : 0.14;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.px, p.py, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (inBrush) {
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
      }
    }

    const ring = (p, color, extra = 3) => {
      if (!p) return;
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.px, p.py, p.r + 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(p.px, p.py, p.r + extra, 0, Math.PI * 2);
      ctx.stroke();
    };
    ring(selPt, "#c9a45c", 3);
    ring(hotPt, "#fff4d2", 3.5);
    ctx.globalAlpha = 1;
  }

  function findNearest(x, y) {
    let best = null;
    let bestD2 = 144;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const dx = p.px - x;
      const dy = p.py - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= (p.r + 6) ** 2 && d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  const localXY = (e) => {
    const r = stageRect || (stageRect = stage.getBoundingClientRect());
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function flushLiveBrush() {
    brushRaf = 0;
    if (!brushRect) return;
    const bx0 = Math.min(brushRect.x0, brushRect.x1);
    const bx1 = Math.max(brushRect.x0, brushRect.x1);
    const by0 = Math.min(brushRect.y0, brushRect.y1);
    const by1 = Math.max(brushRect.y0, brushRect.y1);
    const set = new Set();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.px >= bx0 && p.px <= bx1 && p.py >= by0 && p.py <= by1) set.add(p.key);
    }
    state.brushed = set;
    updateBrushRectSvg();
    drawCanvas();
    opts.onBrush?.(set, true);
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    stageRect = stage.getBoundingClientRect();
    const [x, y] = localXY(e);
    stage.setPointerCapture(e.pointerId);
    dragging = { x0: clamp(x, PAD.l, width - PAD.r), y0: clamp(y, PAD.t, height - PAD.b), moved: false };
    brushRect = null;
    updateBrushRectSvg();
  });

  stage.addEventListener("pointermove", (e) => {
    const [x, y] = localXY(e);
    if (dragging) {
      const cx = clamp(x, PAD.l, width - PAD.r);
      const cy = clamp(y, PAD.t, height - PAD.b);
      if (Math.hypot(cx - dragging.x0, cy - dragging.y0) > 5) dragging.moved = true;
      if (dragging.moved) {
        brushRect = { x0: dragging.x0, y0: dragging.y0, x1: cx, y1: cy };
        if (!brushRaf) brushRaf = requestAnimationFrame(flushLiveBrush);
      }
      return;
    }
    const hit = findNearest(x, y);
    const nextKey = hit ? hit.key : null;
    if (nextKey !== state.hotKey) {
      state.hotKey = nextKey;
      drawCanvas();
      opts.onHover?.(hit ? hit.row : null, e.clientX, e.clientY);
    } else if (hit) {
      opts.onHoverMove?.(hit.row, e.clientX, e.clientY);
    }
  });

  stage.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    const wasMoved = dragging.moved;
    dragging = null;
    if (brushRaf) {
      cancelAnimationFrame(brushRaf);
      brushRaf = 0;
    }
    if (wasMoved) {
      if (brushRect) flushLiveBrush();
      const set = state.brushed && state.brushed.size ? state.brushed : null;
      if (!set) brushRect = null;
      updateBrushRectSvg();
      drawCanvas();
      opts.onBrush?.(set, false);
      return;
    }
    const [x, y] = localXY(e);
    const hit = findNearest(x, y);
    if (hit) {
      opts.onClick?.(hit.row);
    } else if (state.brushed) {
      clearBrush();
      opts.onBrush?.(null, false);
    }
  });

  stage.addEventListener("pointerleave", () => {
    if (dragging) return;
    if (state.hotKey != null) {
      state.hotKey = null;
      drawCanvas();
      opts.onHover?.(null);
    }
  });

  function clearBrush() {
    brushRect = null;
    state.brushed = null;
    updateBrushRectSvg();
    drawCanvas();
  }

  const ro = new ResizeObserver(() => computeLayout());
  ro.observe(stage);

  return {
    el: wrap,
    update(next) {
      Object.assign(state, next);
      computeLayout();
    },
    clearBrush,
    setHot(key) {
      const k = key == null ? null : String(key);
      if (k === state.hotKey) return;
      state.hotKey = k;
      drawCanvas();
    },
    setSelected(key) {
      state.selKey = key == null ? null : String(key);
      drawCanvas();
    },
    getPointTip(row) {
      if (!row || !state.xField || !state.yField) return "";
      const xStr = fmtField(state.xField, row[state.xField.key]);
      const yStr = fmtField(state.yField, row[state.yField.key]);
      return `<b>${esc(row.full || row.name)}</b>${row.sub ? ` <span class="sub">(${esc(row.sub)})</span>` : ""}<br>${esc(state.xField.label)}：<b>${esc(xStr)}</b><br>${esc(state.yField.label)}：<b>${esc(yStr)}</b>`;
    },
    destroy() {
      if (brushRaf) cancelAnimationFrame(brushRaf);
      ro.disconnect();
    },
  };
}
