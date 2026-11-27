// High-Speed Rail (八纵八横 golden/crimson dashed) & conventional railway layer

export function createRailLayer(app) {
  return {
    id: 'rail',
    order: 14,
    enabled: (state) => Boolean(state.layers.rail),
    draw(ctx, w, state, data, zoom) {
      const infra = data.infrastructure;
      if (!infra?.rail?.length) return;

      const hsr = [];
      const conv = [];
      for (const r of infra.rail) {
        const pts = r.pts || r.points;
        if (!Array.isArray(pts) || pts.length < 2) continue;
        if (r.tier === 'hsr' || r.cls === 'hsr') hsr.push(pts);
        else conv.push(pts);
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Conventional railways
      if (conv.length) {
        ctx.strokeStyle = 'rgba(182, 186, 194, 0.34)';
        ctx.lineWidth = Math.max(0.7, 1.15 / Math.max(0.25, zoom));
        ctx.beginPath();
        for (const pts of conv) {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();
      }

      // High-Speed Rail (crimson base + warm gold alternating dashes)
      if (hsr.length) {
        const lw = Math.max(1.2, 2.0 / Math.max(0.25, zoom));
        ctx.strokeStyle = 'rgba(188, 68, 56, 0.72)';
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (const pts of hsr) {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();

        ctx.strokeStyle = 'rgba(244, 206, 120, 0.85)';
        ctx.lineWidth = lw * 0.58;
        ctx.setLineDash([7 / Math.max(0.25, zoom), 6 / Math.max(0.25, zoom)]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    },
  };
}
