// Strategic energy plants & mineral resources renderer + filter matching + viewport culling

export const RESOURCE_STYLES = {
  nuclear:        { label: '核电站',     color: '#6ce5ff', badge: '核', shape: 'atom' },
  hydro:          { label: '水电站',     color: '#4ea8f5', badge: '水', shape: 'drop' },
  coal_plant:     { label: '火电基地',   color: '#e08b4f', badge: '火', shape: 'bolt' },
  wind:           { label: '风电基地',   color: '#79d69c', badge: '风', shape: 'fan' },
  solar:          { label: '光伏基地',   color: '#f5d25b', badge: '光', shape: 'sun' },
  pumped_storage: { label: '抽水蓄能',   color: '#5ec9ba', badge: '蓄', shape: 'drop' },
  coal_mine:      { label: '煤矿',       color: '#8f98a3', badge: '煤', shape: 'gem' },
  oil:            { label: '油田',       color: '#c98e46', badge: '油', shape: 'drop' },
  gas:            { label: '气田',       color: '#73b8f2', badge: '气', shape: 'gem' },
  rare_earths:    { label: '稀土矿',     color: '#f0b849', badge: '稀', shape: 'star' },
  iron:           { label: '铁矿',       color: '#c76e5a', badge: '铁', shape: 'gem' },
  copper:         { label: '铜矿',       color: '#d98457', badge: '铜', shape: 'gem' },
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

export function drawResources(ctx, w, data, state, zoom, bounds = null) {
  if (!state.showResources) return;
  const items = data.resources?.items;
  if (!Array.isArray(items) || !items.length) return;

  const rf = state.resourceFilter;
  const rad = Math.max(4.5, Math.min(9.5, 5.4 / Math.pow(zoom, 0.58)));
  const pad = rad * 2;
  const x0 = bounds ? bounds.x0 - pad : -Infinity;
  const y0 = bounds ? bounds.y0 - pad : -Infinity;
  const x1 = bounds ? bounds.x1 + pad : Infinity;
  const y1 = bounds ? bounds.y1 + pad : Infinity;

  const minDistSq = zoom < 0.35 ? Math.pow(22 / zoom, 2) : Math.pow(12 / zoom, 2);
  const placed = [];

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${(rad * 1.15).toFixed(1)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.lineWidth = Math.max(0.8, 1.4 / zoom);

  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    if (!matchesResourceFilter(it, rf)) continue;

    const x = it.x ?? (it.cell >= 0 ? w.cx(it.cell) : null);
    const y = it.y ?? (it.cell >= 0 ? w.cy(it.cell) : null);
    if (x == null || y == null || x < x0 || x > x1 || y < y0 || y > y1) continue;

    if (!rf && zoom < 0.75) {
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

    const st = RESOURCE_STYLES[it.type] || { color: '#d8c28a', badge: '资' };

    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(13, 22, 33, 0.88)';
    ctx.fill();
    ctx.strokeStyle = st.color;
    ctx.stroke();

    if (zoom >= 0.24 || rf) {
      ctx.fillStyle = st.color;
      ctx.fillText(st.badge, x, y + rad * 0.04);
    } else {
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(x, y, rad * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
