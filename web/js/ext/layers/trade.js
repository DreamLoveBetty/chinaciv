// Interprovincial freight trade corridors with curved arcs & directional flow arrowheads

export function createTradeLayer(app) {
  return {
    id: 'trade',
    order: 22,
    enabled: (state) => Boolean(state.layers.trade),
    draw(ctx, w, state, data, zoom) {
      const routes = data.trade?.routes;
      if (!Array.isArray(routes) || !routes.length) return;

      ctx.save();
      ctx.lineCap = 'round';

      let maxVal = 1;
      for (const r of routes) {
        const v = r.value_bcny || r.tonnage_mt || 1;
        if (v > maxVal) maxVal = v;
      }

      for (const r of routes) {
        let pts = r.pts;
        if (!Array.isArray(pts) || pts.length < 2) {
          const fx = r.from_cell >= 0 ? w.cx(r.from_cell) : null;
          const fy = r.from_cell >= 0 ? w.cy(r.from_cell) : null;
          const tx = r.to_cell >= 0 ? w.cx(r.to_cell) : null;
          const ty = r.to_cell >= 0 ? w.cy(r.to_cell) : null;
          if (fx == null || tx == null) continue;
          const mx = (fx + tx) * 0.5 - (ty - fy) * 0.16;
          const my = (fy + ty) * 0.5 + (tx - fx) * 0.16;
          pts = [[fx, fy], [mx, my], [tx, ty]];
        }

        const weight = 0.35 + 0.65 * ((r.value_bcny || r.tonnage_mt || 1) / maxVal);
        const lw = (1.3 + weight * 2.4) / Math.max(0.25, zoom);

        ctx.strokeStyle = 'rgba(240, 198, 96, 0.44)';
        ctx.lineWidth = lw;
        ctx.beginPath();
        if (pts.length === 3) {
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
        } else {
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.stroke();

        // Flow arrowhead near destination
        const end = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        const ang = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
        const head = lw * 2.6;
        ctx.fillStyle = '#ffe18a';
        ctx.beginPath();
        ctx.moveTo(end[0], end[1]);
        ctx.lineTo(end[0] - Math.cos(ang - 0.45) * head, end[1] - Math.sin(ang - 0.45) * head);
        ctx.lineTo(end[0] - Math.cos(ang + 0.45) * head, end[1] - Math.sin(ang + 0.45) * head);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    },
  };
}
