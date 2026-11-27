// PLA Theater bases, launch centers, and training/testing range rings

export function createMilitaryLayer(app) {
  return {
    id: 'military',
    order: 18,
    enabled: (state) => Boolean(state.layers.military),
    draw(ctx, w, state, data, zoom) {
      const mil = data.military;
      if (!mil) return;

      ctx.save();

      // Restricted training / testing range rings
      const ranges = mil.ranges || [];
      for (const rg of ranges) {
        const x = rg.x ?? (rg.cell >= 0 ? w.cx(rg.cell) : null);
        const y = rg.y ?? (rg.cell >= 0 ? w.cy(rg.cell) : null);
        const rKm = rg.radius_km || 55;
        if (x == null || y == null) continue;

        ctx.fillStyle = 'rgba(217, 107, 90, 0.10)';
        ctx.strokeStyle = 'rgba(217, 107, 90, 0.65)';
        ctx.lineWidth = Math.max(1.0, 1.5 / zoom);
        ctx.setLineDash([8 / Math.max(0.25, zoom), 5 / Math.max(0.25, zoom)]);
        ctx.beginPath();
        ctx.arc(x, y, rKm, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Installations / Forts / Satellite Launch Centers
      const bases = mil.installations || [];
      const sz = Math.max(4.5, Math.min(9.5, 5.4 / Math.pow(zoom, 0.55)));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${(sz * 1.1).toFixed(1)}px "PingFang SC", sans-serif`;

      for (const inst of bases) {
        const x = inst.x ?? (inst.cell >= 0 ? w.cx(inst.cell) : null);
        const y = inst.y ?? (inst.cell >= 0 ? w.cy(inst.cell) : null);
        if (x == null || y == null) continue;

        // Shield emblem
        ctx.fillStyle = '#331d1d';
        ctx.strokeStyle = '#e87a68';
        ctx.lineWidth = Math.max(0.9, 1.5 / zoom);
        ctx.beginPath();
        ctx.moveTo(x - sz, y - sz * 0.85);
        ctx.lineTo(x + sz, y - sz * 0.85);
        ctx.lineTo(x + sz, y + sz * 0.1);
        ctx.lineTo(x, y + sz);
        ctx.lineTo(x - sz, y + sz * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f7b2a6';
        ctx.fillText('防', x, y - sz * 0.08);
      }

      ctx.restore();
    },
  };
}
