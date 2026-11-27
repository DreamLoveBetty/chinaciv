// Rivers, lakes, and South China Sea 9/10-dash boundary line with cached Path2D geometry

function tracePolyline(path, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
    const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  path.lineTo(last[0], last[1]);
}

function extractPoints(item) {
  if (!item) return null;
  if (Array.isArray(item)) {
    if (item.length && Array.isArray(item[0]) && typeof item[0][0] === 'number') return item;
    return null;
  }
  if (Array.isArray(item.pts)) return item.pts;
  if (Array.isArray(item.points)) return item.points;
  if (Array.isArray(item.coords)) return item.coords;
  return null;
}

function ensureWaterPaths(w) {
  if (w._waterPathsBuilt) return;
  w._waterPathsBuilt = true;

  const lakes = w.lakes || [];
  if (lakes.length) {
    const lp = new Path2D();
    for (const lake of lakes) {
      const rings = Array.isArray(lake?.rings)
        ? lake.rings
        : Array.isArray(lake?.[0]?.[0])
          ? lake
          : [extractPoints(lake)].filter(Boolean);
      for (const ring of rings) {
        if (!ring || ring.length < 3) continue;
        lp.moveTo(ring[0][0], ring[0][1]);
        for (let k = 1; k < ring.length; k++) {
          lp.lineTo(ring[k][0], ring[k][1]);
        }
        lp.closePath();
      }
    }
    w._lakesPath = lp;
  }

  const rivers = w.rivers || [];
  if (rivers.length) {
    const rp = new Path2D();
    for (const rv of rivers) {
      const pts = extractPoints(rv);
      if (pts) tracePolyline(rp, pts);
    }
    w._riversPath = rp;
  }

  const scs = w.scs_line;
  if (scs && scs.length) {
    const segments = [];
    if (Array.isArray(scs[0]) && typeof scs[0][0] === 'number') {
      segments.push(scs);
    } else {
      for (const item of scs) {
        const pts = extractPoints(item);
        if (pts) segments.push(pts);
      }
    }
    if (segments.length) {
      const sp = new Path2D();
      for (const pts of segments) {
        if (pts.length < 2) continue;
        sp.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          sp.lineTo(pts[k][0], pts[k][1]);
        }
      }
      w._scsPath = sp;
    }
  }
}

export function drawWaterFeatures(ctx, w, zoom, bounds = null, opts = {}) {
  const { scsOnly = false } = opts;
  ensureWaterPaths(w);
  ctx.save();

  // 1. Lakes
  if (!scsOnly && w._lakesPath) {
    ctx.fillStyle = '#185482';
    ctx.strokeStyle = '#5da9d6';
    ctx.lineWidth = Math.max(0.8, 1.3 / zoom);
    ctx.fill(w._lakesPath);
    ctx.stroke(w._lakesPath);
  }

  // 2. Rivers (3 passes reusing cached Path2D)
  if (!scsOnly && w._riversPath) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = 'rgba(13, 38, 63, 0.55)';
    ctx.lineWidth = Math.max(2.0, 4.0 / zoom);
    ctx.stroke(w._riversPath);

    ctx.strokeStyle = '#3b8ec4';
    ctx.lineWidth = Math.max(1.2, 2.5 / zoom);
    ctx.stroke(w._riversPath);

    ctx.strokeStyle = 'rgba(138, 212, 248, 0.45)';
    ctx.lineWidth = Math.max(0.5, 0.9 / zoom);
    ctx.stroke(w._riversPath);
  }

  // 3. South China Sea dashed boundary line (world.scs_line)
  if (w._scsPath) {
    ctx.strokeStyle = 'rgba(236, 208, 142, 0.75)';
    ctx.lineWidth = Math.max(1.4, 2.2 / zoom);
    ctx.setLineDash([18 / Math.max(0.25, zoom), 11 / Math.max(0.25, zoom)]);
    ctx.stroke(w._scsPath);
    ctx.setLineDash([]);
  }

  ctx.restore();
}
