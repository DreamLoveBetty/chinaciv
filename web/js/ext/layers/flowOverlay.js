// Unified demand-driven animated flow overlay for Rail (HSR + Conv), Trade Corridors, and Civil Aviation Routes

import { isElevation25D } from '../../render/art/elevation25d.js?v=20261127-5';
import { ensureRailPaths } from './rail.js?v=20261127-7';
import { ensureAirlinePaths } from './airlines.js?v=20261127-7';

function buildPolylineMeta(pts) {
  const n = pts.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const cumLen = new Float32Array(n);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let total = 0;

  for (let i = 0; i < n; i++) {
    const x = pts[i][0];
    const y = pts[i][1];
    xs[i] = x;
    ys[i] = y;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    if (i > 0) {
      total += Math.hypot(x - xs[i - 1], y - ys[i - 1]);
    }
    cumLen[i] = total;
  }

  return { n, xs, ys, cumLen, totalLen: total, x0, y0, x1, y1 };
}

function buildTradeFallbackPts(r, w) {
  const fx = r.from_x ?? (w && r.from_cell >= 0 ? w.cx(r.from_cell) : null);
  const fy = r.from_y ?? (w && r.from_cell >= 0 ? w.cy(r.from_cell) : null);
  const tx = r.to_x ?? (w && r.to_cell >= 0 ? w.cx(r.to_cell) : null);
  const ty = r.to_y ?? (w && r.to_cell >= 0 ? w.cy(r.to_cell) : null);
  if (fx == null || fy == null || tx == null || ty == null) return null;
  const mx = (fx + tx) * 0.5 - (ty - fy) * 0.16;
  const my = (fy + ty) * 0.5 + (tx - fx) * 0.16;
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const mt = 1 - t;
    pts.push([
      mt * mt * fx + 2 * mt * t * mx + t * t * tx,
      mt * mt * fy + 2 * mt * t * my + t * t * ty,
    ]);
  }
  return pts;
}

function ensureRailFlowMeta(infra) {
  ensureRailPaths(infra);
  if (infra._hsrFlowItems) return infra._hsrFlowItems;
  const items = [];
  let idx = 0;
  for (const r of infra.rail || []) {
    if (r.tier !== 'hsr' && r.cls !== 'hsr') continue;
    const pts = r.pts || r.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const meta = buildPolylineMeta(pts);
    if (meta.totalLen < 20) continue;
    meta.phase = ((idx * 0.37) % 1);
    meta.pulses = Math.max(2, Math.min(5, Math.round(meta.totalLen / 420)));
    meta.speed = 215 + (idx % 3) * 18;
    items.push(meta);
    idx += 1;
  }
  infra._hsrFlowItems = items;
  return items;
}

function ensureTradeFlowMeta(trade, w) {
  if (trade._tradeFlowBuilt) return trade._tradeFlowMeta;
  trade._tradeFlowBuilt = true;
  const routes = trade.routes || [];
  let maxVal = 1;
  for (const r of routes) {
    const v = r.value_bcny || r.tonnage_mt || 1;
    if (v > maxVal) maxVal = v;
  }

  const highPath = new Path2D();
  const stdPath = new Path2D();
  let hasHigh = false;
  let hasStd = false;
  const items = [];

  for (let idx = 0; idx < routes.length; idx++) {
    const r = routes[idx];
    let pts = Array.isArray(r.pts) && r.pts.length >= 2 ? r.pts : buildTradeFallbackPts(r, w);
    if (pts && pts.length === 3) {
      const [p0, p1, p2] = pts;
      const sampled = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const mt = 1 - t;
        sampled.push([
          mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
          mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
        ]);
      }
      pts = sampled;
    }
    if (!pts || pts.length < 2) continue;

    const meta = buildPolylineMeta(pts);
    if (meta.totalLen < 20) continue;

    const weight = 0.35 + 0.65 * ((r.value_bcny || r.tonnage_mt || 1) / maxVal);
    const isHigh = idx < 15 || weight >= 0.72;
    meta.weight = weight;
    meta.isHigh = isHigh;
    meta.phase = ((idx * 0.29) % 1);
    meta.pulses = (r.rank && r.rank <= 12) || weight > 0.78 ? 3 : 2;
    meta.speed = 155 + weight * 95;
    items.push(meta);

    const target = isHigh ? highPath : stdPath;
    if (isHigh) hasHigh = true;
    else hasStd = true;
    target.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      target.lineTo(pts[i][0], pts[i][1]);
    }
  }

  trade._tradeFlowMeta = {
    items,
    highPath: hasHigh ? highPath : null,
    stdPath: hasStd ? stdPath : null,
  };
  return trade._tradeFlowMeta;
}

function ensureAirFlowMeta(infra) {
  ensureAirlinePaths(infra);
  if (infra._airFlowItems) return infra._airFlowItems;
  const routes = infra.air_routes || [];
  let maxAirlines = 1;
  for (const r of routes) {
    if ((r.airlines || 1) > maxAirlines) maxAirlines = r.airlines || 1;
  }

  const items = [];
  for (let idx = 0; idx < routes.length; idx++) {
    const r = routes[idx];
    const pts = r.pts;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const meta = buildPolylineMeta(pts);
    if (meta.totalLen < 20) continue;
    const isTrunk = r.tier === 'trunk';
    const wgt = Math.min(1, (r.airlines || 2) / Math.max(4, maxAirlines));
    meta.isTrunk = isTrunk;
    meta.weight = wgt;
    meta.idx = idx;
    meta.phase = ((idx * 0.43) % 1);
    meta.speed = isTrunk ? 290 + wgt * 60 : 250 + wgt * 45;
    items.push(meta);
  }
  infra._airFlowItems = items;
  return items;
}

// Reusable scratch objects to avoid per-frame allocations inside rAF
const S0 = { x: 0, y: 0, dx: 1, dy: 0 };
const S1 = { x: 0, y: 0, dx: 1, dy: 0 };
const S2 = { x: 0, y: 0, dx: 1, dy: 0 };
const S3 = { x: 0, y: 0, dx: 1, dy: 0 };

function samplePolyline(item, dist, out) {
  const { n, xs, ys, cumLen, totalLen } = item;
  let d = dist;
  if (d <= 0) {
    const vx = xs[1] - xs[0];
    const vy = ys[1] - ys[0];
    const len = Math.hypot(vx, vy) || 1;
    out.x = xs[0];
    out.y = ys[0];
    out.dx = vx / len;
    out.dy = vy / len;
    return out;
  }
  if (d >= totalLen) {
    const vx = xs[n - 1] - xs[n - 2];
    const vy = ys[n - 1] - ys[n - 2];
    const len = Math.hypot(vx, vy) || 1;
    out.x = xs[n - 1];
    out.y = ys[n - 1];
    out.dx = vx / len;
    out.dy = vy / len;
    return out;
  }

  let lo = 0;
  let hi = n - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cumLen[mid + 1] < d) lo = mid + 1;
    else if (cumLen[mid] > d) hi = mid - 1;
    else {
      lo = mid;
      break;
    }
  }
  const idx = Math.max(0, Math.min(n - 2, lo));
  const segStart = cumLen[idx];
  const segLen = cumLen[idx + 1] - segStart;
  const t = segLen > 1e-6 ? (d - segStart) / segLen : 0;
  const vx = xs[idx + 1] - xs[idx];
  const vy = ys[idx + 1] - ys[idx];
  const vLen = Math.hypot(vx, vy) || 1;
  out.x = xs[idx] + vx * t;
  out.y = ys[idx] + vy * t;
  out.dx = vx / vLen;
  out.dy = vy / vLen;
  return out;
}

function drawComet(ctx, item, headDist, tailLen, dir, zEff, outerCol, coreCol, headCol, widthMul, drawChevron) {
  const total = item.totalLen;
  const d0 = headDist;
  const d1 = Math.max(0, Math.min(total, headDist - dir * (tailLen * 0.35)));
  const d2 = Math.max(0, Math.min(total, headDist - dir * (tailLen * 0.72)));
  const d3 = Math.max(0, Math.min(total, headDist - dir * tailLen));

  samplePolyline(item, d0, S0);
  samplePolyline(item, d1, S1);
  samplePolyline(item, d2, S2);
  samplePolyline(item, d3, S3);

  const baseW = widthMul / zEff;

  // Outer tapered soft bloom
  ctx.strokeStyle = outerCol;
  ctx.lineWidth = baseW * 2.55;
  ctx.beginPath();
  ctx.moveTo(S3.x, S3.y);
  ctx.lineTo(S2.x, S2.y);
  ctx.lineTo(S1.x, S1.y);
  ctx.lineTo(S0.x, S0.y);
  ctx.stroke();

  // Bright hot inner streak
  ctx.strokeStyle = coreCol;
  ctx.lineWidth = baseW * 1.15;
  ctx.beginPath();
  ctx.moveTo(S2.x, S2.y);
  ctx.lineTo(S1.x, S1.y);
  ctx.lineTo(S0.x, S0.y);
  ctx.stroke();

  // Leading glowing head point
  ctx.fillStyle = headCol;
  ctx.beginPath();
  ctx.arc(S0.x, S0.y, baseW * 1.05, 0, Math.PI * 2);
  ctx.fill();

  if (drawChevron) {
    const fx = S0.dx * dir;
    const fy = S0.dy * dir;
    const rx = -fy;
    const ry = fx;
    const wing = baseW * 2.15;
    const back = baseW * 2.35;
    ctx.strokeStyle = headCol;
    ctx.lineWidth = Math.max(0.85, baseW * 0.75);
    ctx.beginPath();
    ctx.moveTo(S0.x - fx * back + rx * wing, S0.y - fy * back + ry * wing);
    ctx.lineTo(S0.x + fx * (baseW * 0.8), S0.y + fy * (baseW * 0.8));
    ctx.lineTo(S0.x - fx * back - rx * wing, S0.y - fy * back - ry * wing);
    ctx.stroke();
  }
}

function visibleInBox(item, vb, pad) {
  return !(
    item.x1 < vb.x0 - pad ||
    item.x0 > vb.x1 + pad ||
    item.y1 < vb.y0 - pad ||
    item.y0 > vb.y1 + pad
  );
}

export function installFlowOverlay(app) {
  const stats = {
    active: false,
    frames: 0,
    lastDrawMs: 0,
  };
  if (typeof window !== 'undefined') {
    window.__flowOverlayStats = stats;
  }

  const reduceMotionQuery =
    typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;

  function shouldAnimate() {
    if (reduceMotionQuery?.matches) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    const st = app.state;
    if (!st || isElevation25D(st)) return false;
    const infra = app.data?.infrastructure;
    const trade = app.data?.trade;
    const railOn = Boolean(st.layers.rail && infra?.rail?.length);
    const tradeOn = Boolean(st.layers.trade && trade?.routes?.length);
    const airOn = Boolean(st.layers.airlines && infra?.air_routes?.length);
    return railOn || tradeOn || airOn;
  }

  let rafId = 0;
  function tick() {
    rafId = 0;
    if (!shouldAnimate()) {
      stats.active = false;
      return;
    }
    stats.active = true;
    app.requestDraw?.();
    rafId = requestAnimationFrame(tick);
  }

  function syncTicker() {
    const active = shouldAnimate();
    stats.active = active;
    if (active && !rafId) {
      rafId = requestAnimationFrame(tick);
    } else if (!active && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      app.requestDraw?.();
    }
  }

  app.registerOverlay({
    id: 'transport-flow',
    order: 28,
    draw(ctx, w, cam, state) {
      if (!w || !state || isElevation25D(state)) return;

      const data = app.data;
      const infra = data?.infrastructure;
      const trade = data?.trade;
      const railOn = Boolean(state.layers.rail && infra?.rail?.length);
      const tradeOn = Boolean(state.layers.trade && trade?.routes?.length);
      const airOn = Boolean(state.layers.airlines && infra?.air_routes?.length);
      if (!railOn && !tradeOn && !airOn) return;

      const t0 = performance.now();
      const nowSec = t0 * 0.001;
      const { dpr, zoom } = cam;
      const yScale = cam.yScale || 1;
      const zEff = Math.max(0.25, zoom);
      const vb = cam.viewBoundsWorld();
      const pad = 120 / zEff;
      const cScreen = cam.viewportCenterScreen();

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(cScreen.sx, cScreen.sy);
      ctx.scale(zoom, zoom * yScale);
      ctx.translate(-cam.x, -cam.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'lighter';

      // 1. High-Speed Rail & Railway glowing flow
      if (railOn) {
        const hsrItems = ensureRailFlowMeta(infra);
        if (infra._convRailPath && zoom >= 0.32) {
          ctx.strokeStyle = 'rgba(195, 218, 248, 0.24)';
          ctx.lineWidth = Math.max(0.75, 1.1 / zEff);
          ctx.setLineDash([12 / zEff, 52 / zEff]);
          ctx.lineDashOffset = -(nowSec * 36) / zEff;
          ctx.stroke(infra._convRailPath);
        }

        if (infra._hsrRailPath) {
          const dashOff = -(nowSec * 64) / zEff;
          const baseLw = Math.max(1.2, 2.0 / zEff);
          ctx.setLineDash([22 / zEff, 38 / zEff]);
          ctx.lineDashOffset = dashOff;
          ctx.strokeStyle = 'rgba(255, 178, 72, 0.34)';
          ctx.lineWidth = baseLw * 1.9;
          ctx.stroke(infra._hsrRailPath);

          ctx.setLineDash([16 / zEff, 44 / zEff]);
          ctx.lineDashOffset = dashOff;
          ctx.strokeStyle = 'rgba(255, 240, 176, 0.72)';
          ctx.lineWidth = baseLw * 0.78;
          ctx.stroke(infra._hsrRailPath);
          ctx.setLineDash([]);
        }

        const tailLen = Math.min(185 / zEff, 420);
        for (let i = 0; i < hsrItems.length; i++) {
          const item = hsrItems[i];
          if (!visibleInBox(item, vb, pad)) continue;
          const period = item.totalLen + tailLen * 1.25;
          for (let p = 0; p < item.pulses; p++) {
            const fracFwd = (nowSec * (item.speed / period) + item.phase + p / item.pulses) % 1;
            const dFwd = fracFwd * period - tailLen * 0.2;
            drawComet(
              ctx,
              item,
              dFwd,
              Math.min(tailLen, item.totalLen * 0.24),
              1,
              zEff,
              'rgba(255, 165, 62, 0.36)',
              'rgba(255, 232, 148, 0.86)',
              '#fffdf0',
              1.65,
              false
            );

            // Reverse direction train on alternate staggered phase
            const fracRev = (nowSec * (item.speed / period) + item.phase + (p + 0.52) / item.pulses) % 1;
            const dRev = item.totalLen - (fracRev * period - tailLen * 0.2);
            drawComet(
              ctx,
              item,
              dRev,
              Math.min(tailLen, item.totalLen * 0.24),
              -1,
              zEff,
              'rgba(255, 132, 82, 0.30)',
              'rgba(255, 224, 142, 0.78)',
              '#fff9e2',
              1.45,
              false
            );
          }
        }
      }

      // 2. Interprovincial Trade Corridors directional golden flow
      if (tradeOn) {
        const meta = ensureTradeFlowMeta(trade, w);
        const dashOff = -(nowSec * 52) / zEff;
        if (meta.stdPath) {
          ctx.strokeStyle = 'rgba(246, 188, 72, 0.26)';
          ctx.lineWidth = 1.6 / zEff;
          ctx.setLineDash([16 / zEff, 34 / zEff]);
          ctx.lineDashOffset = dashOff;
          ctx.stroke(meta.stdPath);
        }
        if (meta.highPath) {
          ctx.strokeStyle = 'rgba(255, 212, 98, 0.42)';
          ctx.lineWidth = 2.4 / zEff;
          ctx.setLineDash([22 / zEff, 30 / zEff]);
          ctx.lineDashOffset = dashOff;
          ctx.stroke(meta.highPath);
        }
        ctx.setLineDash([]);

        const baseTail = Math.min(195 / zEff, 440);
        for (let i = 0; i < meta.items.length; i++) {
          const item = meta.items[i];
          if (!visibleInBox(item, vb, pad)) continue;
          const tail = Math.min(baseTail, item.totalLen * 0.26);
          const period = item.totalLen + tail * 1.15;
          const wMul = 1.25 + item.weight * 0.85;
          for (let p = 0; p < item.pulses; p++) {
            const frac = (nowSec * (item.speed / period) + item.phase + p / item.pulses) % 1;
            const headDist = frac * period - tail * 0.15;
            drawComet(
              ctx,
              item,
              headDist,
              tail,
              1,
              zEff,
              'rgba(255, 174, 52, 0.42)',
              'rgba(255, 236, 152, 0.90)',
              '#fff8dc',
              wMul,
              false
            );
          }
        }
      }

      // 3. Civil Aviation Routes sky-cyan jet flow
      if (airOn) {
        const airItems = ensureAirFlowMeta(infra);
        if (infra._airTrunkPath) {
          ctx.strokeStyle = 'rgba(110, 225, 255, 0.36)';
          ctx.lineWidth = Math.max(1.0, 1.5 / zEff);
          ctx.setLineDash([18 / zEff, 42 / zEff]);
          ctx.lineDashOffset = -(nowSec * 72) / zEff;
          ctx.stroke(infra._airTrunkPath);
          ctx.setLineDash([]);
        }

        const baseTail = Math.min(200 / zEff, 460);
        const showAllRegional = zoom >= 0.28;
        const showChevron = zoom >= 0.34;
        for (let i = 0; i < airItems.length; i++) {
          const item = airItems[i];
          if (!item.isTrunk && !showAllRegional && (item.idx & 1) === 1) continue;
          if (!visibleInBox(item, vb, pad)) continue;

          const tail = Math.min(baseTail * (item.isTrunk ? 1 : 0.78), item.totalLen * 0.24);
          const period = item.totalLen + tail * 1.25;
          const fracFwd = (nowSec * (item.speed / period) + item.phase) % 1;
          const dFwd = fracFwd * period - tail * 0.15;
          drawComet(
            ctx,
            item,
            dFwd,
            tail,
            1,
            zEff,
            item.isTrunk ? 'rgba(72, 208, 255, 0.42)' : 'rgba(72, 194, 248, 0.28)',
            item.isTrunk ? 'rgba(186, 244, 255, 0.92)' : 'rgba(166, 234, 255, 0.74)',
            '#ffffff',
            item.isTrunk ? 1.55 : 1.15,
            item.isTrunk && showChevron
          );

          if (item.isTrunk) {
            const fracRev = (nowSec * (item.speed / period) + item.phase + 0.5) % 1;
            const dRev = item.totalLen - (fracRev * period - tail * 0.15);
            drawComet(
              ctx,
              item,
              dRev,
              tail,
              -1,
              zEff,
              'rgba(56, 186, 255, 0.34)',
              'rgba(170, 238, 255, 0.84)',
              '#eefbff',
              1.38,
              showChevron
            );
          }
        }
      }

      ctx.restore();
      stats.frames += 1;
      stats.lastDrawMs = Number((performance.now() - t0).toFixed(2));
    },
  });

  app.on('layer:change', syncTicker);
  app.on('lens', syncTicker);
  app.on('elevation25d', syncTicker);
  app.on('data:infrastructure', syncTicker);
  app.on('data:trade', syncTicker);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', syncTicker);
  }
  reduceMotionQuery?.addEventListener?.('change', syncTicker);
  syncTicker();
}
