// National Highway & Expressway network static layer (roads)

export function createRoadsLayer(app) {
  return {
    id: 'roads',
    order: 12,
    enabled: (state) => Boolean(state.layers.roads),
    draw(ctx, w, state, data, zoom) {
      const infra = data.infrastructure;
      if (!infra?.roads?.length) return;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(218, 168, 92, 0.42)';
      ctx.lineWidth = Math.max(0.75, 1.35 / Math.max(0.25, zoom));

      ctx.beginPath();
      for (const rd of infra.roads) {
        const pts = rd.pts || rd.points;
        if (!Array.isArray(pts) || pts.length < 2) continue;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i][0], pts[i][1]);
        }
      }
      ctx.stroke();
      ctx.restore();
    },
  };
}
