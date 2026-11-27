// National Wonders, Heritage Sites, Top R&D Universities, National Parks & Megaprojects

const KIND_STYLE = {
  national_park: { color: '#78d48b', glyph: '林' },
  university:    { color: '#70c8f5', glyph: '学' },
  cultural:      { color: '#f2cb72', glyph: '遗' },
  megaproject:   { color: '#ea9159', glyph: '工' },
};

export function createWondersLayer(app) {
  return {
    id: 'wonders',
    order: 20,
    enabled: (state) => Boolean(state.layers.wonders),
    draw(ctx, w, state, data, zoom) {
      const wonders = data.wonders?.wonders;
      if (!Array.isArray(wonders) || !wonders.length) return;

      const rad = Math.max(4.8, Math.min(10.5, 5.6 / Math.pow(zoom, 0.56)));
      const minDistSq = zoom < 0.42 ? Math.pow(24 / zoom, 2) : Math.pow(10 / zoom, 2);
      const placed = [];

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < wonders.length; i++) {
        const wn = wonders[i];
        if (zoom < 0.25 && (wn.rank || 99) > 12) continue;

        const x = wn.x ?? (wn.cell >= 0 ? w.cx(wn.cell) : null);
        const y = wn.y ?? (wn.cell >= 0 ? w.cy(wn.cell) : null);
        if (x == null || y == null) continue;

        if (zoom < 0.72) {
          let crowded = false;
          for (let p = placed.length - 1; p >= 0 && p >= placed.length - 30; p--) {
            const dx = x - placed[p][0];
            const dy = y - placed[p][1];
            if (dx * dx + dy * dy < minDistSq) {
              crowded = true;
              break;
            }
          }
          if (crowded) continue;
        }
        placed.push([x, y]);

        const st = KIND_STYLE[wn.kind] || { color: '#ecd08e', glyph: '★' };

        // Protected park / wonder halo
        if (wn.kind === 'national_park') {
          ctx.fillStyle = 'rgba(104, 198, 124, 0.14)';
          ctx.strokeStyle = 'rgba(120, 212, 139, 0.45)';
          ctx.lineWidth = Math.max(0.8, 1.2 / zoom);
          ctx.beginPath();
          ctx.arc(x, y, rad * 1.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Gold-rimmed star/circle medallion
        ctx.fillStyle = 'rgba(18, 28, 40, 0.94)';
        ctx.strokeStyle = st.color;
        ctx.lineWidth = Math.max(1.0, 1.6 / zoom);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = st.color;
        ctx.font = `700 ${(rad * 1.05).toFixed(1)}px "Noto Serif SC", "Songti SC", sans-serif`;
        ctx.fillText(st.glyph, x, y + rad * 0.04);

        // Name label when zoomed in
        if (zoom >= 0.55) {
          const lbl = wn.short || wn.name || '';
          if (lbl) {
            const fs = Math.max(9.5, 10.5) / zoom;
            ctx.font = `600 ${fs.toFixed(1)}px "PingFang SC", sans-serif`;
            ctx.lineWidth = fs * 0.28;
            ctx.strokeStyle = 'rgba(9, 16, 25, 0.9)';
            ctx.strokeText(lbl, x, y + rad + fs * 0.9);
            ctx.fillStyle = st.color;
            ctx.fillText(lbl, x, y + rad + fs * 0.9);
          }
        }
      }

      ctx.restore();
    },
  };
}
