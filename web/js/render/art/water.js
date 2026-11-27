// Rivers, lakes, and South China Sea 9/10-dash boundary line

function tracePolyline(ctx, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
    const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
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

export function drawWaterFeatures(ctx, w, zoom) {
  ctx.save();

  // 1. Lakes
  const lakes = w.lakes || [];
  if (lakes.length) {
    ctx.fillStyle = '#185482';
    ctx.strokeStyle = '#5da9d6';
    ctx.lineWidth = Math.max(0.8, 1.3 / zoom);
    ctx.beginPath();
    for (const lake of lakes) {
      const rings = Array.isArray(lake?.rings)
        ? lake.rings
        : Array.isArray(lake?.[0]?.[0])
          ? lake
          : [extractPoints(lake)].filter(Boolean);
      for (const ring of rings) {
        if (!ring || ring.length < 3) continue;
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let k = 1; k < ring.length; k++) {
          ctx.lineTo(ring[k][0], ring[k][1]);
        }
        ctx.closePath();
      }
    }
    ctx.fill();
    ctx.stroke();
  }

  // 2. Rivers
  const rivers = w.rivers || [];
  if (rivers.length) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Under-glow bank
    ctx.strokeStyle = 'rgba(13, 38, 63, 0.55)';
    ctx.lineWidth = Math.max(2.0, 4.0 / zoom);
    ctx.beginPath();
    for (const rv of rivers) {
      const pts = extractPoints(rv);
      if (pts) tracePolyline(ctx, pts);
    }
    ctx.stroke();

    // Main river body
    ctx.strokeStyle = '#3b8ec4';
    ctx.lineWidth = Math.max(1.2, 2.5 / zoom);
    ctx.beginPath();
    for (const rv of rivers) {
      const pts = extractPoints(rv);
      if (pts) tracePolyline(ctx, pts);
    }
    ctx.stroke();

    // Center water glint
    ctx.strokeStyle = 'rgba(138, 212, 248, 0.45)';
    ctx.lineWidth = Math.max(0.5, 0.9 / zoom);
    ctx.beginPath();
    for (const rv of rivers) {
      const pts = extractPoints(rv);
      if (pts) tracePolyline(ctx, pts);
    }
    ctx.stroke();
  }

  // 3. South China Sea dashed boundary line (world.scs_line)
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
      ctx.strokeStyle = 'rgba(236, 208, 142, 0.75)';
      ctx.lineWidth = Math.max(1.4, 2.2 / zoom);
      ctx.setLineDash([18 / Math.max(0.25, zoom), 11 / Math.max(0.25, zoom)]);
      ctx.beginPath();
      for (const pts of segments) {
        if (pts.length < 2) continue;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let k = 1; k < pts.length; k++) {
          ctx.lineTo(pts[k][0], pts[k][1]);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();
}
