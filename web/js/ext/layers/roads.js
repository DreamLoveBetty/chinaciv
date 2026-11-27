// National Highway & Expressway network static layer with double-cased cream-ivory highway styling

function ensureRoadsPath(infra) {
  if (infra._roadsPathBuilt) return;
  infra._roadsPathBuilt = true;
  const p = new Path2D();
  for (const rd of infra.roads) {
    const pts = rd.pts || rd.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      p.lineTo(pts[i][0], pts[i][1]);
    }
  }
  infra._roadsPath = p;
}

export function createRoadsLayer(app) {
  return {
    id: 'roads',
    order: 12,
    enabled: (state) => Boolean(state.layers.roads),
    draw(ctx, w, state, data, zoom) {
      const infra = data.infrastructure;
      if (!infra?.roads?.length) return;
      ensureRoadsPath(infra);

      const invZ = 1 / Math.max(0.24, zoom);
      const rw = Math.min(4.6 * invZ, 1.38 + 0.92 * invZ);

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Dark brown-olive outer road casing
      ctx.strokeStyle = 'rgba(54, 44, 30, 0.82)';
      ctx.lineWidth = rw * 1.65;
      ctx.stroke(infra._roadsPath);

      // Warm cream-ivory highway deck
      ctx.strokeStyle = '#f2e6c8';
      ctx.lineWidth = rw;
      ctx.stroke(infra._roadsPath);

      // Subtle dashed centerline on close-up zoom
      if (zoom >= 0.92) {
        ctx.strokeStyle = 'rgba(142, 118, 76, 0.65)';
        ctx.lineWidth = Math.max(0.26, rw * 0.20);
        const dash = Math.min(4.2 * invZ, 1.45 + 1.1 * invZ);
        ctx.setLineDash([dash, dash]);
        ctx.stroke(infra._roadsPath);
        ctx.setLineDash([]);
      }

      ctx.restore();
    },
  };
}
