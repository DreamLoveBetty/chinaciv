// National Wonders, Heritage Sites, Top R&D Universities, National Parks & Megaprojects

const KIND_STYLE = {
  national_park: { color: '#78d48b', bg: '#183622', glyph: '林' },
  university:    { color: '#70c8f5', bg: '#162c42', glyph: '学' },
  cultural:      { color: '#f2cb72', bg: '#382418', glyph: '遗' },
  megaproject:   { color: '#ea9159', bg: '#362116', glyph: '工' },
};

// Perimeter slots around a city hex (lower SE, lower SW, east, west) so wonders never cover central skyscrapers
const CITY_RIM_OFFSETS = [
  [0.74, 0.44],
  [-0.74, 0.44],
  [0.86, -0.06],
  [-0.86, -0.06],
  [0.52, 0.72],
  [-0.52, 0.72],
];

export function createWondersLayer(app) {
  return {
    id: 'wonders',
    order: 20,
    enabled: (state) => Boolean(state.layers.wonders),
    draw(ctx, w, state, data, zoom, utils) {
      const wonders = data.wonders?.wonders;
      if (!Array.isArray(wonders) || !wonders.length) return;

      const R = w.R || 14.433757;
      const rad = Math.max(4.6, Math.min(9.6, 5.2 / Math.pow(zoom, 0.56)));
      const bounds = utils?.bounds;
      const pad = rad * 3 + R * 1.5;
      const x0 = bounds ? bounds.x0 - pad : -Infinity;
      const y0 = bounds ? bounds.y0 - pad : -Infinity;
      const x1 = bounds ? bounds.x1 + pad : Infinity;
      const y1 = bounds ? bounds.y1 + pad : Infinity;

      const minDistSq = zoom < 0.42 ? Math.pow(24 / zoom, 2) : Math.pow(13 / zoom, 2);
      const placed = [];
      const cities = state?.cities || [];
      const citySlotCount = new Map();
      const nearCityR2 = (R * 1.05) * (R * 1.05);

      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < wonders.length; i++) {
        const wn = wonders[i];
        if (zoom < 0.25 && (wn.rank || 99) > 12) continue;

        let x = wn.x ?? (wn.cell >= 0 ? w.cx(wn.cell) : null);
        let y = wn.y ?? (wn.cell >= 0 ? w.cy(wn.cell) : null);
        if (x == null || y == null || x < x0 || x > x1 || y < y0 || y > y1) continue;

        // Nudge urban wonders (universities/palaces) cleanly onto the outer rim of the city hex
        // so every city's 3D skyscrapers stay 100% unobstructed
        let hostCity = null;
        if (!state.lens && zoom >= 0.42 && cities.length) {
          for (let c = 0; c < cities.length; c++) {
            const ct = cities[c];
            if (ct.x == null || ct.y == null) continue;
            const dx = x - ct.x;
            const dy = y - ct.y;
            if (dx * dx + dy * dy < nearCityR2) {
              hostCity = ct;
              break;
            }
          }
          if (hostCity) {
            const slotIdx = citySlotCount.get(hostCity.id) || 0;
            if (zoom < 1.35 && slotIdx >= 2) continue;
            citySlotCount.set(hostCity.id, slotIdx + 1);
            const [ox, oy] = CITY_RIM_OFFSETS[slotIdx % CITY_RIM_OFFSETS.length];
            const rimR = R * (slotIdx >= 4 ? 1.15 : 0.96);
            x = hostCity.x + ox * rimR;
            y = hostCity.y + oy * rimR;
          }
        }

        if (zoom < 0.85) {
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

        const st = KIND_STYLE[wn.kind] || { color: '#ecd08e', bg: '#162436', glyph: '★' };
        const drawRad = hostCity ? rad * 0.82 : rad;

        // Protected park halo
        if (wn.kind === 'national_park') {
          ctx.fillStyle = 'rgba(104, 198, 124, 0.14)';
          ctx.strokeStyle = 'rgba(120, 212, 139, 0.45)';
          ctx.lineWidth = Math.max(0.8, 1.2 / zoom);
          ctx.beginPath();
          ctx.arc(x, y, drawRad * 1.85, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // Drop shadow
        ctx.fillStyle = 'rgba(8, 13, 20, 0.46)';
        ctx.beginPath();
        ctx.arc(x + drawRad * 0.14, y + drawRad * 0.18, drawRad * 1.05, 0, Math.PI * 2);
        ctx.fill();

        // Double-rimmed antique-gold medallion with category enamel core
        ctx.fillStyle = st.bg;
        ctx.strokeStyle = st.color;
        ctx.lineWidth = Math.max(0.95, drawRad * 0.22);
        ctx.beginPath();
        ctx.arc(x, y, drawRad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(248, 232, 184, 0.34)';
        ctx.lineWidth = Math.max(0.45, drawRad * 0.08);
        ctx.beginPath();
        ctx.arc(x, y, drawRad * 0.78, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = st.color;
        ctx.font = `700 ${(drawRad * 1.02).toFixed(1)}px "Noto Serif SC", "Songti SC", sans-serif`;
        ctx.fillText(st.glyph, x, y + drawRad * 0.04);

        // Name label when zoomed in (defer urban rim labels until close metro zoom)
        if (zoom >= (hostCity ? 1.55 : 0.62)) {
          const lbl = wn.short || wn.name || '';
          if (lbl) {
            const fs = Math.max(8.5, 9.6) / zoom;
            ctx.font = `600 ${fs.toFixed(1)}px "PingFang SC", sans-serif`;
            ctx.lineWidth = fs * 0.30;
            ctx.strokeStyle = 'rgba(9, 16, 25, 0.92)';
            ctx.strokeText(lbl, x, y + drawRad + fs * 0.88);
            ctx.fillStyle = st.color;
            ctx.fillText(lbl, x, y + drawRad + fs * 0.88);
          }
        }
      }

      ctx.restore();
    },
  };
}
