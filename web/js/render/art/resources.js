// Strategic energy plants & mineral resources beveled vector medallion renderer + filter matching

export const RESOURCE_STYLES = {
  nuclear:        { label: '核电站',     color: '#6ce5ff', badge: '核', shape: 'atom' },
  hydro:          { label: '水电站',     color: '#4ea8f5', badge: '水', shape: 'drop' },
  coal_plant:     { label: '火电基地',   color: '#e08b4f', badge: '火', shape: 'bolt' },
  wind:           { label: '风电基地',   color: '#79d69c', badge: '风', shape: 'fan' },
  solar:          { label: '光伏基地',   color: '#f5d25b', badge: '光', shape: 'sun' },
  pumped_storage: { label: '抽水蓄能',   color: '#5ec9ba', badge: '蓄', shape: 'drop' },
  coal_mine:      { label: '煤矿',       color: '#9aa4b0', badge: '煤', shape: 'gem' },
  oil:            { label: '油田',       color: '#d4964e', badge: '油', shape: 'drop' },
  gas:            { label: '气田',       color: '#73b8f2', badge: '气', shape: 'gem' },
  rare_earths:    { label: '稀土矿',     color: '#f0b849', badge: '稀', shape: 'star' },
  iron:           { label: '铁矿',       color: '#d4745f', badge: '铁', shape: 'gem' },
  copper:         { label: '铜矿',       color: '#df8a5a', badge: '铜', shape: 'gem' },
  gold:           { label: '金矿',       color: '#ffe066', badge: '金', shape: 'star' },
  lithium:        { label: '锂矿',       color: '#9ee86f', badge: '锂', shape: 'gem' },
  tungsten:       { label: '钨锡矿',     color: '#b4a2e6', badge: '钨', shape: 'gem' },
  bauxite:        { label: '铝土矿',     color: '#d9a48f', badge: '铝', shape: 'gem' },
};

export function matchesResourceFilter(item, rf) {
  if (!rf) return true;
  if (typeof rf === 'function') return Boolean(rf(item));
  if (typeof rf === 'string') return item.type === rf;
  if (Array.isArray(rf)) return rf.length === 0 || rf.includes(item.type);
  if (rf instanceof Set) return rf.size === 0 || rf.has(item.type);
  if (typeof rf === 'object') {
    if (Array.isArray(rf.types) && rf.types.length && !rf.types.includes(item.type)) return false;
    if (rf.type && item.type !== rf.type) return false;
    if (rf.province_idx != null && item.province_idx !== rf.province_idx) return false;
    return true;
  }
  return true;
}

function drawScenicProp(ctx, type, x, y, R) {
  ctx.save();
  if (type === 'wind') {
    // Twin miniature white wind turbines behind medallion
    for (const [ox, oy, sc] of [[-0.36 * R, -0.18 * R, 0.9], [0.34 * R, -0.26 * R, 0.8]]) {
      const tx = x + ox;
      const ty = y + oy;
      ctx.strokeStyle = 'rgba(20, 28, 34, 0.35)';
      ctx.lineWidth = R * 0.04;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + R * 0.14 * sc, ty + R * 0.08 * sc);
      ctx.stroke();

      ctx.strokeStyle = '#f2f6fa';
      ctx.lineWidth = R * 0.036;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx, ty - R * 0.28 * sc);
      ctx.stroke();

      const hx = tx;
      const hy = ty - R * 0.28 * sc;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = R * 0.028;
      ctx.beginPath();
      for (let b = 0; b < 3; b++) {
        const a = -Math.PI * 0.5 + b * ((Math.PI * 2) / 3);
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx + Math.cos(a) * R * 0.14 * sc, hy + Math.sin(a) * R * 0.14 * sc);
      }
      ctx.stroke();
    }
  } else if (type === 'solar') {
    // Angled blue solar panel array
    for (const [ox, oy] of [[-0.34 * R, -0.22 * R], [0.28 * R, -0.20 * R]]) {
      const sx = x + ox;
      const sy = y + oy;
      ctx.fillStyle = '#24588a';
      ctx.strokeStyle = '#c8dff4';
      ctx.lineWidth = R * 0.022;
      ctx.beginPath();
      ctx.moveTo(sx - R * 0.16, sy);
      ctx.lineTo(sx + R * 0.10, sy - R * 0.10);
      ctx.lineTo(sx + R * 0.18, sy + R * 0.04);
      ctx.lineTo(sx - R * 0.08, sy + R * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (type === 'nuclear') {
    // Twin miniature cooling towers
    for (const ox of [-0.28 * R, 0.26 * R]) {
      const nx = x + ox;
      const ny = y - 0.10 * R;
      ctx.fillStyle = '#d4d8dc';
      ctx.strokeStyle = '#323c46';
      ctx.lineWidth = R * 0.025;
      ctx.beginPath();
      ctx.moveTo(nx - R * 0.11, ny + R * 0.08);
      ctx.quadraticCurveTo(nx - R * 0.06, ny - R * 0.08, nx - R * 0.09, ny - R * 0.20);
      ctx.lineTo(nx + R * 0.09, ny - R * 0.20);
      ctx.quadraticCurveTo(nx + R * 0.06, ny - R * 0.08, nx + R * 0.11, ny + R * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawVectorIcon(ctx, shape, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(0.85, r * 0.22);

  if (shape === 'fan') {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.72);
    ctx.lineTo(0, -r * 0.06);
    ctx.stroke();
    for (let b = 0; b < 3; b++) {
      const a = -Math.PI * 0.5 + b * ((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.08);
      ctx.lineTo(Math.cos(a) * r * 0.72, -r * 0.08 + Math.sin(a) * r * 0.72);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -r * 0.08, r * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'sun') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.36, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.50, Math.sin(a) * r * 0.50);
      ctx.lineTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
      ctx.stroke();
    }
  } else if (shape === 'atom') {
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.72, r * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'drop') {
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.72);
    ctx.quadraticCurveTo(r * 0.62, r * 0.05, r * 0.44, r * 0.45);
    ctx.arc(0, r * 0.24, r * 0.48, 0.42, Math.PI - 0.42, false);
    ctx.quadraticCurveTo(-r * 0.62, r * 0.05, 0, -r * 0.72);
    ctx.fill();
  } else if (shape === 'bolt') {
    ctx.beginPath();
    ctx.moveTo(r * 0.14, -r * 0.76);
    ctx.lineTo(-r * 0.44, r * 0.05);
    ctx.lineTo(0, r * 0.05);
    ctx.lineTo(-r * 0.14, r * 0.76);
    ctx.lineTo(r * 0.46, -r * 0.05);
    ctx.lineTo(0.04 * r, -r * 0.05);
    ctx.closePath();
    ctx.fill();
  } else if (shape === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r * 0.78 : r * 0.30;
      const a = (i * Math.PI) / 4 - Math.PI * 0.5;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  } else {
    // Faceted crystal/mineral gem
    ctx.beginPath();
    ctx.moveTo(-r * 0.36, -r * 0.56);
    ctx.lineTo(r * 0.36, -r * 0.56);
    ctx.lineTo(r * 0.70, -r * 0.10);
    ctx.lineTo(0, r * 0.72);
    ctx.lineTo(-r * 0.70, -r * 0.10);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

export function drawResources(ctx, w, data, state, zoom, bounds = null) {
  if (!state.showResources) return;
  const items = data.resources?.items;
  if (!Array.isArray(items) || !items.length) return;

  const rf = state.resourceFilter;
  const rad = Math.max(4.8, Math.min(9.6, 5.6 / Math.pow(zoom, 0.58)));
  const pad = rad * 2.5 + w.R;
  const x0 = bounds ? bounds.x0 - pad : -Infinity;
  const y0 = bounds ? bounds.y0 - pad : -Infinity;
  const x1 = bounds ? bounds.x1 + pad : Infinity;
  const y1 = bounds ? bounds.y1 + pad : Infinity;

  const minDistSq = zoom < 0.35 ? Math.pow(22 / zoom, 2) : Math.pow(13 / zoom, 2);
  const placed = [];
  const cities = state?.cities || [];
  const nearCityR2 = (w.R * 0.72) * (w.R * 0.72);

  ctx.save();

  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (!matchesResourceFilter(it, rf)) continue;

    let x = it.x ?? (it.cell >= 0 ? w.cx(it.cell) : null);
    let y = it.y ?? (it.cell >= 0 ? w.cy(it.cell) : null);
    if (x == null || y == null || x < x0 || x > x1 || y < y0 || y > y1) continue;

    // Keep resource badges off central skyscrapers when inside a city core hex
    if (!state.lens && zoom >= 0.45 && cities.length) {
      for (let c = 0; c < cities.length; c++) {
        const ct = cities[c];
        if (ct.x == null || ct.y == null) continue;
        const dx = x - ct.x;
        const dy = y - ct.y;
        if (dx * dx + dy * dy < nearCityR2) {
          x = ct.x - w.R * 0.72;
          y = ct.y + w.R * 0.56;
          break;
        }
      }
    }

    if (!rf && zoom < 0.78) {
      let crowded = false;
      for (let p = placed.length - 1; p >= 0 && p >= placed.length - 40; p--) {
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

    const st = RESOURCE_STYLES[it.type] || { color: '#d8c28a', badge: '资', shape: 'gem' };

    if (zoom >= 1.2) {
      drawScenicProp(ctx, it.type, x, y, w.R);
    }

    // Soft SE shadow
    ctx.beginPath();
    ctx.arc(x + rad * 0.14, y + rad * 0.18, rad * 1.04, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8, 14, 22, 0.48)';
    ctx.fill();

    // Beveled antique-gold outer rim + deep enamel core
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(18, 28, 40, 0.94)';
    ctx.fill();
    ctx.strokeStyle = st.color;
    ctx.lineWidth = Math.max(0.9, rad * 0.19);
    ctx.stroke();

    // Subtle inner antique bevel ring
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.80, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(244, 228, 184, 0.28)';
    ctx.lineWidth = Math.max(0.45, rad * 0.08);
    ctx.stroke();

    if (zoom >= 0.23 || rf) {
      drawVectorIcon(ctx, st.shape || 'gem', x, y, rad * 0.56, st.color);
    } else {
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
