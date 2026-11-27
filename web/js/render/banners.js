// Screen-space Civilization-style City Banners with cached sorting, text width cache & zero shadowBlur

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

const TOP_HUB_IDS = new Set([
  'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'chengdu', 'chongqing',
  'hongkong', 'taipei', 'macau', 'wuhan', 'hangzhou', 'xian', 'harbin', 'urumqi', 'lhasa',
]);

function getTierPriority(city) {
  let score = (city.population || 0) / 1e6;
  if (city.is_provincial_anchor || city.capital) score += 80;
  if (TOP_HUB_IDS.has(String(city.id).toLowerCase())) score += 40;
  return score;
}

let cachedCitiesSrc = null;
let cachedCitiesLen = -1;
let cachedSortedCities = [];
const nameWCache = new Map();
const popWCache = new Map();
const badgeWCache = new Map();

function getSortedCities(cities) {
  if (cities === cachedCitiesSrc && cities.length === cachedCitiesLen) {
    return cachedSortedCities;
  }
  cachedCitiesSrc = cities;
  cachedCitiesLen = cities.length;
  cachedSortedCities = cities
    .map((c) => ({ city: c, prio: getTierPriority(c) }))
    .sort((a, b) => b.prio - a.prio)
    .map((x) => x.city);
  return cachedSortedCities;
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

  const sorted = getSortedCities(cities);
  const placedRects = [];
  const margin = 4;
  const hasExtDim = Boolean(state.highlight && (state.highlight.dim || state.highlight.dimOthers));
  const dimOthers = state.selectedState != null && state.mode === 'map' && !hasExtDim;

  ctx.save();
  ctx.textBaseline = 'middle';

  for (let idx = 0; idx < sorted.length; idx++) {
    const city = sorted[idx];
    const wx = city.x ?? (city.cell >= 0 ? w.cx(city.cell) : null);
    const wy = city.y ?? (city.cell >= 0 ? w.cy(city.cell) : null);
    if (wx == null || wy == null) continue;

    const pt = cam.worldToScreen(wx, wy);
    if (pt.x < -140 || pt.x > cam.width + 140 || pt.y < -60 || pt.y > cam.height + 60) continue;

    const isSelected =
      state.selectedCity &&
      (state.selectedCity === city || String(state.selectedCity.id) === String(city.id));
    const isAnchor = Boolean(city.is_provincial_anchor || city.capital);

    if (!showAll && !isAnchor && !isSelected && zoom < 0.34 && (city.population || 0) < 7_500_000) {
      continue;
    }

    const pColor = provinceColor(city.province_idx ?? 0);
    const name = city.name || '';
    const popTxt = fmtPop(city.population);
    const badge = showBadges ? resolveBadge(city, state, data) : '';

    let nameW = nameWCache.get(name);
    if (nameW == null) {
      ctx.font = '700 11.5px "Noto Serif SC", "Songti SC", Georgia, serif';
      nameW = ctx.measureText(name).width;
      nameWCache.set(name, nameW);
    }
    let popW = popWCache.get(popTxt);
    if (popW == null) {
      ctx.font = '700 10px "PingFang SC", sans-serif';
      popW = ctx.measureText(popTxt).width + 10;
      popWCache.set(popTxt, popW);
    }

    const starW = isAnchor ? 13 : 4;
    const barW = Math.ceil(starW + nameW + popW + 18);
    const barH = 22;

    const bx = Math.round(pt.x - barW * 0.5);
    const by = Math.round(pt.y - barH - (zoom >= 0.45 ? 10 : 6));

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

    ctx.globalAlpha = dimOthers && city.province_idx !== state.selectedState ? 0.62 : 1;

    // Anchor dot on city hex center
    ctx.fillStyle = isSelected ? '#ecd08e' : pColor;
    ctx.strokeStyle = '#0c1622';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, isAnchor ? 4.2 : 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Fast drop-shadow (no expensive shadowBlur per banner)
    roundRectPath(ctx, bx + 1, by + 2.5, barW, barH, 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fill();

    // Banner navy-slate pill
    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.fillStyle = isSelected ? 'rgba(34, 48, 66, 0.97)' : 'rgba(17, 28, 40, 0.92)';
    ctx.fill();

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

    ctx.fillStyle = '#f5ebd1';
    ctx.font = '700 11.5px "Noto Serif SC", "Songti SC", Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, curX, midY);

    const pillX = bx + barW - popW - 4;
    roundRectPath(ctx, pillX, by + 3.5, popW, barH - 7, 3.5);
    ctx.fillStyle = rgba(pColor, 0.28);
    ctx.fill();
    ctx.fillStyle = '#efe4c6';
    ctx.font = '700 9.5px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(popTxt, pillX + popW * 0.5, midY);

    if (badge) {
      let badgeTxtW = badgeWCache.get(badge);
      if (badgeTxtW == null) {
        ctx.font = '600 9.5px "PingFang SC", sans-serif';
        badgeTxtW = ctx.measureText(badge).width + 12;
        badgeWCache.set(badge, badgeTxtW);
      }
      const bw = Math.max(barW * 0.72, badgeTxtW);
      const bpx = Math.round(pt.x - bw * 0.5);
      const bpy = by + barH + 1;
      roundRectPath(ctx, bpx, bpy, bw, 14, 3);
      ctx.fillStyle = 'rgba(20, 32, 46, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(201, 164, 92, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.fillStyle = '#ecd08e';
      ctx.font = '600 9.5px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badge, pt.x, bpy + 7.5);
    }

    if (showDetails && city.yields) {
      const yY = by + barH + (badge ? 17 : 3);
      const colors = ['#8fd47e', '#e69d5c', '#f2d16b', '#72c7f2', '#d59bf6'];
      const dx0 = pt.x - 14;
      for (let d = 0; d < 5; d++) {
        ctx.fillStyle = colors[d];
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
