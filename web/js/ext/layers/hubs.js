// Major seaports, river ports, and CAAC airports static layer

export function createHubsLayer(app) {
  return {
    id: 'hubs',
    order: 16,
    enabled: (state) => Boolean(state.layers.hubs),
    draw(ctx, w, state, data, zoom) {
      const infra = data.infrastructure;
      if (!infra) return;

      const ports = infra.ports || [];
      const airports = infra.airports || [];
      const rad = Math.max(3.6, Math.min(7.5, 4.2 / Math.pow(zoom, 0.55)));

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Ports (anchor blue diamond)
      for (let i = 0; i < ports.length; i++) {
        const p = ports[i];
        if (zoom < 0.34 && (p.rank || i + 1) > 18) continue;
        const x = p.x ?? (p.cell >= 0 ? w.cx(p.cell) : null);
        const y = p.y ?? (p.cell >= 0 ? w.cy(p.cell) : null);
        if (x == null || y == null) continue;

        ctx.fillStyle = '#3f96d6';
        ctx.strokeStyle = '#d4eefc';
        ctx.lineWidth = Math.max(0.8, 1.2 / zoom);
        ctx.beginPath();
        ctx.moveTo(x, y - rad);
        ctx.lineTo(x + rad, y);
        ctx.lineTo(x, y + rad);
        ctx.lineTo(x - rad, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Airports (sky-gold plane/circle marker)
      for (let i = 0; i < airports.length; i++) {
        const a = airports[i];
        if (zoom < 0.36 && (a.rank || i + 1) > 25) continue;
        const x = a.x ?? (a.cell >= 0 ? w.cx(a.cell) : null);
        const y = a.y ?? (a.cell >= 0 ? w.cy(a.cell) : null);
        if (x == null || y == null) continue;

        ctx.fillStyle = 'rgba(20, 32, 46, 0.9)';
        ctx.strokeStyle = '#7cd1f5';
        ctx.lineWidth = Math.max(0.8, 1.2 / zoom);
        ctx.beginPath();
        ctx.arc(x, y, rad * 0.85, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#b8ebff';
        ctx.beginPath();
        ctx.arc(x, y, rad * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    },
  };
}
