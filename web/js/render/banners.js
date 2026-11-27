// Screen-space Civilization-style City Banners with star emblem, population pill, yields, and badges

import { provinceColor, rgba } from '../color.js';
import { fmtPop } from '../format.js';

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function resolveBadge(city, state, data) {
  if (!city) return '';
  const id = String(city.id ?? '');
  const badges = state.cityBadges;
  if (badges instanceof Map && badges.has(id)) return badges.get(id);
  if (badges && typeof badges === 'object' && badges[id]) return badges[id];
  if (city.badge) return city.badge;
  const d = data.districts?.cities?.[id];
  return d?.badge || '';
}

function getTierPriority(city) {
  let score = (city.population || 0) / 1e6;
  if (city.is_provincial_anchor || city.capital) score += 80;
  if (['beijing', 'shanghai', 'shenzhen', 'guangzhou', 'chengdu', 'chongqing', 'hongkong', 'taipei', 'macau', 'wuhan', 'hangzhou', 'xian', 'harbin', 'urumqi', 'lhasa'].includes(String(city.id).toLowerCase())) {
    score += 40;
  }
  return score;
}

/**
 * Draw crisp screen-space Civ city banners and return clickable hitboxes.
 */
export function drawCityBanners(ctx, w, cam, state, data) {
  const cities = state.cities;
  if (!Array.isArray(cities) || !cities.length) return [];

  const hitBanners = [];
  const zoom = cam.zoom;
  const showAll = zoom >= 0.48;
  const showDetails = zoom >= 0.52;
  const showBadges = zoom >= 0.36;

  // Sort high-priority hubs first for clean de-overlapping at national zoom
  const sorted = cities
    .map((c) => ({ city: c, prio: getTierPriority(c) }))
    .sort((a, b) => b.prio - a.prio);

  const placedRects = [];
  const margin = 4;

  ctx.save();
  ctx.textBaseline = 'middle';

  for (let idx = 0; idx < sorted.length; idx++) {
    const { city } = sorted[idx];
    const wx = city.x ?? (city.cell >= 0 ? w.cx(city.cell) : null);
    const wy = city.y ?? (city.cell >= 0 ? w.cy(city.cell) : null);
    if (wx == null || wy == null) continue;

    const pt = cam.worldToScreen(wx, wy);
    if (pt.x < -140 || pt.x > cam.width + 140 || pt.y < -60 || pt.y > cam.height + 60) continue;

    const isSelected =
      state.selectedCity &&
      (state.selectedCity === city || String(state.selectedCity.id) === String(city.id));
    const isAnchor = Boolean(city.is_provincial_anchor || city.capital);

    // At low national zoom, render provincial anchors + top cities without heavy overlaps
    if (!showAll && !isAnchor && !isSelected && zoom < 0.34 && (city.population || 0) < 7_500_000) {
      continue;
    }

    const pColor = provinceColor(city.province_idx ?? 0);
    const name = city.name || '';
    const popTxt = fmtPop(city.population);
    const badge = showBadges ? resolveBadge(city, state, data) : '';

    ctx.font = '700 11.5px "Noto Serif SC", "Songti SC", Georgia, serif';
    const nameW = ctx.measureText(name).width;
    ctx.font = '700 10px "PingFang SC", sans-serif';
    const popW = ctx.measureText(popTxt).width + 10;
    const starW = isAnchor ? 13 : 4;
    const barW = Math.ceil(starW + nameW + popW + 18);
    const barH = 22;

    const bx = Math.round(pt.x - barW * 0.5);
    const by = Math.round(pt.y - barH - (zoom >= 0.45 ? 10 : 6));

    // De-overlap at low/medium zoom (always draw selected city!)
    if (!isSelected && zoom < 0.9) {
      let overlaps = false;
      for (let r = 0; r < placedRects.length; r++) {
        const pr = placedRects[r];
        if (
          bx < pr.x + pr.w + margin &&
          bx + barW + margin > pr.x &&
          by < pr.y + pr.h + margin &&
          by + barH + margin > pr.y
        ) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
    }

    const totalH = barH + (badge ? 14 : 0) + (showDetails ? 12 : 0);
    placedRects.push({ x: bx, y: by, w: barW, h: totalH });

    // Anchor dot on city hex center
    ctx.fillStyle = isSelected ? '#ecd08e' : pColor;
    ctx.strokeStyle = '#0c1622';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, isAnchor ? 4.2 : 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Banner shadow & navy-slate pill
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.fillStyle = isSelected ? 'rgba(34, 48, 66, 0.97)' : 'rgba(17, 28, 40, 0.92)';
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Left provincial color ribbon
    ctx.save();
    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.clip();
    ctx.fillStyle = pColor;
    ctx.fillRect(bx, by, 5, barH);
    ctx.restore();

    // Gold border
    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.strokeStyle = isSelected ? '#ffe59c' : 'rgba(201, 164, 92, 0.78)';
    ctx.lineWidth = isSelected ? 1.6 : 1;
    ctx.stroke();

    let curX = bx + 9;
    const midY = by + barH * 0.5 + 0.5;

    if (isAnchor) {
      ctx.fillStyle = '#ecd08e';
      ctx.font = '700 10.5px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('★', curX, midY);
      curX += 12;
    }

    // City name
    ctx.fillStyle = '#f5ebd1';
    ctx.font = '700 11.5px "Noto Serif SC", "Songti SC", Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, curX, midY);

    // Population pill on right
    const pillX = bx + barW - popW - 4;
    roundRectPath(ctx, pillX, by + 3.5, popW, barH - 7, 3.5);
    ctx.fillStyle = rgba(pColor, 0.28);
    ctx.fill();
    ctx.fillStyle = '#efe4c6';
    ctx.font = '700 9.5px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(popTxt, pillX + popW * 0.5, midY);

    // District/specialty badge strip below banner when zoomed or flagged
    if (badge) {
      ctx.font = '600 9.5px "PingFang SC", sans-serif';
      const bw = Math.max(barW * 0.72, ctx.measureText(badge).width + 12);
      const bpx = Math.round(pt.x - bw * 0.5);
      const bpy = by + barH + 1;
      roundRectPath(ctx, bpx, bpy, bw, 14, 3);
      ctx.fillStyle = 'rgba(20, 32, 46, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(201, 164, 92, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = '#ecd08e';
      ctx.textAlign = 'center';
      ctx.fillText(badge, pt.x, bpy + 7.5);
    }

    // Mini 5-yield dots bar when zoomed in
    if (showDetails && city.yields) {
      const yY = by + barH + (badge ? 17 : 3);
      const dots = [
        ['#8fd47e', city.yields.food],
        ['#e69d5c', city.yields.production],
        ['#f2d16b', city.yields.gold],
        ['#72c7f2', city.yields.science],
        ['#d59bf6', city.yields.culture],
      ];
      const dotSpan = 28;
      const dx0 = pt.x - dotSpan * 0.5;
      for (let d = 0; d < dots.length; d++) {
        ctx.fillStyle = dots[d][0];
        ctx.beginPath();
        ctx.arc(dx0 + d * 7, yY + 3, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    hitBanners.push({
      city,
      x: bx - 3,
      y: by - 3,
      w: barW + 6,
      h: barH + (badge ? 16 : 6),
    });
  }

  ctx.restore();
  return hitBanners;
}
