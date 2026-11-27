// High-Speed Rail & conventional railway layer with crosstie sleeper tracks and cached Path2D

export function ensureRailPaths(infra) {
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

      const invZ = 1 / Math.max(0.24, zoom);
      const showTies = zoom >= 0.38;
      const showRailsSplit = zoom >= 0.72;
      const tieDash = Math.min(1.6 * invZ, 0.56 + 0.36 * invZ);
      const tieGap = Math.min(4.0 * invZ, 1.45 + 0.95 * invZ);

      ctx.save();
      ctx.lineJoin = 'round';

      // Conventional national rail: gravel ballast + perpendicular wooden crossties + steel track
      if (infra._convRailPath) {
        const bw = Math.min(3.8 * invZ, 1.25 + 1.1 * invZ);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(42, 35, 28, 0.54)';
        ctx.lineWidth = bw * 1.45;
        ctx.stroke(infra._convRailPath);

        if (showTies) {
          ctx.lineCap = 'butt';
          ctx.strokeStyle = 'rgba(54, 42, 30, 0.90)';
          ctx.lineWidth = Math.min(6.8 * invZ, 2.25 + 1.55 * invZ);
          ctx.setLineDash([tieDash, tieGap]);
          ctx.stroke(infra._convRailPath);
          ctx.setLineDash([]);
        }

        ctx.lineCap = 'round';
        ctx.strokeStyle = '#d4dae0';
        ctx.lineWidth = bw * 0.85;
        ctx.stroke(infra._convRailPath);

        if (showRailsSplit) {
          ctx.strokeStyle = 'rgba(46, 39, 31, 0.88)';
          ctx.lineWidth = bw * 0.32;
          ctx.stroke(infra._convRailPath);
        }
      }

      // High-Speed Rail (八纵八横): elevated bed + crossties + crimson-gold express ribbon
      if (infra._hsrRailPath) {
        const lw = Math.min(4.8 * invZ, 1.55 + 1.35 * invZ);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(72, 26, 22, 0.58)';
        ctx.lineWidth = lw * 1.18;
        ctx.stroke(infra._hsrRailPath);

        if (showTies) {
          ctx.lineCap = 'butt';
          ctx.strokeStyle = 'rgba(78, 42, 28, 0.85)';
          ctx.lineWidth = Math.min(7.6 * invZ, 2.55 + 1.75 * invZ);
          ctx.setLineDash([tieDash * 1.1, tieGap * 1.1]);
          ctx.stroke(infra._hsrRailPath);
          ctx.setLineDash([]);
        }

        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(196, 72, 58, 0.92)';
        ctx.lineWidth = lw * 0.72;
        ctx.stroke(infra._hsrRailPath);

        ctx.strokeStyle = 'rgba(246, 210, 122, 0.94)';
        ctx.lineWidth = lw * 0.36;
        ctx.stroke(infra._hsrRailPath);
      }

      ctx.restore();
    },
  };
}
