// High-Speed Rail (八纵八横 golden/crimson dashed) & conventional railway layer with cached Path2D

function ensureRailPaths(infra) {
  if (infra._railPathsBuilt) return;
  infra._railPathsBuilt = true;
  const conv = new Path2D();
  const hsr = new Path2D();
  let hasConv = false;
  let hasHsr = false;

  for (const r of infra.rail) {
    const pts = r.pts || r.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const isHsr = r.tier === 'hsr' || r.cls === 'hsr';
    const target = isHsr ? hsr : conv;
    if (isHsr) hasHsr = true;
    else hasConv = true;
    target.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      target.lineTo(pts[i][0], pts[i][1]);
    }
  }
  infra._convRailPath = hasConv ? conv : null;
  infra._hsrRailPath = hasHsr ? hsr : null;
}

export function createRailLayer(app) {
  return {
    id: 'rail',
    order: 14,
    enabled: (state) => Boolean(state.layers.rail),
    draw(ctx, w, state, data, zoom) {
      const infra = data.infrastructure;
      if (!infra?.rail?.length) return;
      ensureRailPaths(infra);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (infra._convRailPath) {
        ctx.strokeStyle = 'rgba(182, 186, 194, 0.34)';
        ctx.lineWidth = Math.max(0.7, 1.15 / Math.max(0.25, zoom));
        ctx.stroke(infra._convRailPath);
      }

      if (infra._hsrRailPath) {
        const lw = Math.max(1.2, 2.0 / Math.max(0.25, zoom));
        ctx.strokeStyle = 'rgba(188, 68, 56, 0.72)';
        ctx.lineWidth = lw;
        ctx.stroke(infra._hsrRailPath);

        ctx.strokeStyle = 'rgba(244, 206, 120, 0.85)';
        ctx.lineWidth = lw * 0.58;
        ctx.setLineDash([7 / Math.max(0.25, zoom), 6 / Math.max(0.25, zoom)]);
        ctx.stroke(infra._hsrRailPath);
        ctx.setLineDash([]);
      }

      ctx.restore();
    },
  };
}
