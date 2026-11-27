// Screen-space Civilization-style City Banners with top specialty ribbon, pop capsule, growth %, civic seal & 5-yield telemetry bar

import { provinceColor } from '../color.js';
import { fmtCompact, fmtPop } from '../format.js';
import { isElevation25D, elevLiftKm } from './art/elevation25d.js?v=20261127-5';

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

function extractVal(yVal) {
  if (typeof yVal === 'number') return yVal;
  if (yVal && typeof yVal === 'object') return yVal.value ?? yVal.score ?? yVal.amount ?? 0;
  return 0;
}

function fmtCompactYield(val, key) {
  const n = extractVal(val);
  if (key === 'science') return fmtCompact(n);
  if (key === 'gold') {
    if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万亿`;
    if (Math.abs(n) >= 100) return `${Math.round(n)}亿`;
    return `${n.toFixed(1)}亿`;
  }
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (Math.abs(n) >= 100) return `${Math.round(n)}`;
  return n.toFixed(1);
}

function drawYieldMiniIcon(ctx, key, cx, cy, col) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (key === 'food') {
    // Wheat/leaf sprig
    ctx.beginPath();
    ctx.moveTo(cx, cy + 3.2);
    ctx.lineTo(cx, cy - 3.2);
    ctx.moveTo(cx, cy - 1.2);
    ctx.lineTo(cx - 2.3, cy - 2.6);
    ctx.moveTo(cx, cy - 1.2);
    ctx.lineTo(cx + 2.3, cy - 2.6);
    ctx.moveTo(cx, cy + 1.0);
    ctx.lineTo(cx - 2.3, cy - 0.5);
    ctx.moveTo(cx, cy + 1.0);
    ctx.lineTo(cx + 2.3, cy - 0.5);
    ctx.stroke();
  } else if (key === 'production') {
    // Cogwheel gear
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 2.2, cy + Math.sin(a) * 2.2);
      ctx.lineTo(cx + Math.cos(a) * 3.4, cy + Math.sin(a) * 3.4);
      ctx.stroke();
    }
  } else if (key === 'gold') {
    // Gold coin
    ctx.beginPath();
    ctx.arc(cx, cy, 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#36260a';
    ctx.fillRect(cx - 0.8, cy - 1.2, 1.6, 2.4);
  } else if (key === 'science') {
    // Erlenmeyer flask
    ctx.beginPath();
    ctx.moveTo(cx - 1.1, cy - 3.1);
    ctx.lineTo(cx + 1.1, cy - 3.1);
    ctx.lineTo(cx + 0.9, cy - 1.0);
    ctx.lineTo(cx + 3.0, cy + 2.6);
    ctx.lineTo(cx - 3.0, cy + 2.6);
    ctx.lineTo(cx - 0.9, cy - 1.0);
    ctx.closePath();
    ctx.fill();
  } else {
    // Culture lyre / monument arch
    ctx.beginPath();
    ctx.moveTo(cx - 2.8, cy + 2.8);
    ctx.lineTo(cx + 2.8, cy + 2.8);
    ctx.moveTo(cx - 2.0, cy + 2.8);
    ctx.lineTo(cx - 2.0, cy - 1.8);
    ctx.lineTo(cx, cy - 3.2);
    ctx.lineTo(cx + 2.0, cy - 1.8);
    ctx.lineTo(cx + 2.0, cy + 2.8);
    ctx.stroke();
  }
  ctx.restore();
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
const growthWCache = new Map();
const yieldWCache = new Map();

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

const YIELD_SPECS = [
  { key: 'food', color: '#8fd47e' },
  { key: 'production', color: '#e69d5c' },
  { key: 'gold', color: '#f2d16b' },
  { key: 'science', color: '#72c7f2' },
  { key: 'culture', color: '#d59bf6' },
];

/**
 * Draw crisp screen-space Civ city banners and return clickable hitboxes.
 */
export function drawCityBanners(ctx, w, cam, state, data) {
  const cities = state.cities;
  if (!Array.isArray(cities) || !cities.length) return [];

  const hitBanners = [];
  const zoom = cam.zoom;
  const showAll = zoom >= 0.48;
  const showYieldDots = zoom >= 0.50;
  const showBadges = zoom >= 0.42;
  const showGrowth = zoom >= 0.56;

  const sorted = getSortedCities(cities);
  const placedRects = [];
  const margin = 4;
  const hasExtDim = Boolean(state.highlight && (state.highlight.dim || state.highlight.dimOthers));
  const dimOthers = state.selectedState != null && state.mode === 'map' && !hasExtDim;
  const is25D = isElevation25D(state);
  const isLens = Boolean(state.lens);

  ctx.save();
  ctx.textBaseline = 'middle';

  for (let idx = 0; idx < sorted.length; idx++) {
    const city = sorted[idx];
    const wx = city.x ?? (city.cell >= 0 ? w.cx(city.cell) : null);
    const wy = city.y ?? (city.cell >= 0 ? w.cy(city.cell) : null);
    if (wx == null || wy == null) continue;

    const lift = is25D && city.cell >= 0 && w.elev ? elevLiftKm(w.elev[city.cell]) : 0;
    const pt = cam.worldToScreen(wx, wy - lift);
    if (pt.x < -180 || pt.x > cam.width + 180 || pt.y < -80 || pt.y > cam.height + 80) continue;

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
    const badge = showBadges || isSelected ? resolveBadge(city, state, data) : '';
    const hasGrowth = (showGrowth || isSelected) && typeof city.growth === 'number' && Number.isFinite(city.growth);
    const growthTxt = hasGrowth ? `${city.growth >= 0 ? '+' : ''}${city.growth.toFixed(1)}%` : '';

    let nameW = nameWCache.get(name);
    if (nameW == null) {
      ctx.font = '700 11.5px "Noto Serif SC", "Songti SC", Georgia, serif';
      nameW = ctx.measureText(name).width;
      nameWCache.set(name, nameW);
    }
    let popW = popWCache.get(popTxt);
    if (popW == null) {
      ctx.font = '700 9.5px "PingFang SC", sans-serif';
      popW = Math.ceil(ctx.measureText(popTxt).width + 11);
      popWCache.set(popTxt, popW);
    }
    let growthW = 0;
    if (hasGrowth) {
      growthW = growthWCache.get(growthTxt);
      if (growthW == null) {
        ctx.font = '700 9.5px "PingFang SC", sans-serif';
        growthW = Math.ceil(ctx.measureText(growthTxt).width + 6);
        growthWCache.set(growthTxt, growthW);
      }
    }

    const starW = isAnchor ? 12 : 0;
    const sealW = 16;
    const barW = Math.ceil(popW + starW + nameW + growthW + sealW + 18);
    const barH = 23;

    const skyClearPx = !is25D && !isLens && zoom >= 0.42
      ? Math.max(13, Math.min(62, w.R * zoom * 1.32))
      : zoom >= 0.45 ? 10 : 6;
    const bx = Math.round(pt.x - barW * 0.5);

    // Yield bar pre-measure at close-up zoom
    const showYieldBar = Boolean(city.yields && (zoom >= 0.74 || (isSelected && zoom >= 0.48)));
    let yieldItems = null;
    let yieldStripW = 0;
    if (showYieldBar) {
      yieldItems = [];
      ctx.font = '700 9px "PingFang SC", sans-serif';
      let sumW = 10;
      for (let yk = 0; yk < YIELD_SPECS.length; yk++) {
        const sp = YIELD_SPECS[yk];
        const vStr = fmtCompactYield(city.yields[sp.key], sp.key);
        let vw = yieldWCache.get(vStr);
        if (vw == null) {
          vw = Math.ceil(ctx.measureText(vStr).width);
          yieldWCache.set(vStr, vw);
        }
        const cellW = 11 + vw + (yk < 4 ? 7 : 0);
        yieldItems.push({ key: sp.key, color: sp.color, val: vStr, w: cellW });
        sumW += cellW;
      }
      yieldStripW = Math.max(barW, Math.ceil(sumW));
    }

    const topBadgeOff = badge ? 13 : 0;
    const bottomExtra = showYieldBar ? 18 : showYieldDots && city.yields ? 10 : 0;
    let by = Math.round(pt.y - skyClearPx - barH - bottomExtra);
    const boundW = Math.max(barW, yieldStripW);
    const boundX = Math.round(pt.x - boundW * 0.5);
    const boundH = topBadgeOff + barH + bottomExtra;

    const hitsPlaced = (testX, testTopY) => {
      for (let r = 0; r < placedRects.length; r++) {
        const pr = placedRects[r];
        if (
          testX < pr.x + pr.w + margin &&
          testX + boundW + margin > pr.x &&
          testTopY < pr.y + pr.h + margin &&
          testTopY + boundH + margin > pr.y
        ) {
          return true;
        }
      }
      return false;
    };

    let topY = by - topBadgeOff;
    if (!isSelected && hitsPlaced(boundX, topY)) {
      // On dense metro zooms, test alternate slots clearing the city hex before skipping
      let placedAlt = false;
      if (zoom >= 0.85) {
        const candidates = [
          Math.round(pt.y + w.R * zoom * 0.92 + topBadgeOff),
          Math.round(by - boundH - 4),
        ];
        for (let c = 0; c < candidates.length; c++) {
          const altBy = candidates[c];
          const altTopY = altBy - topBadgeOff;
          if (!hitsPlaced(boundX, altTopY)) {
            by = altBy;
            topY = altTopY;
            placedAlt = true;
            break;
          }
        }
      }
      if (!placedAlt) continue;
    }

    placedRects.push({ x: boundX, y: topY, w: boundW, h: boundH });
    ctx.globalAlpha = dimOthers && city.province_idx !== state.selectedState ? 0.62 : 1;

    // Show hex center dot only at lower zoom or lens/2.5D mode (at close-up, 3D skyscrapers fill the hex center)
    if (is25D || isLens || zoom < 0.48) {
      ctx.fillStyle = isSelected ? '#ecd08e' : pColor;
      ctx.strokeStyle = '#0c1622';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isAnchor ? 4.0 : 3.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 1. Top Brass Specialty Ribbon (matching FINANCE CITY / MILITARY TOWN)
    if (badge) {
      let badgeTxtW = badgeWCache.get(badge);
      if (badgeTxtW == null) {
        ctx.font = '700 8.8px "PingFang SC", sans-serif';
        badgeTxtW = Math.ceil(ctx.measureText(badge).width + 14);
        badgeWCache.set(badge, badgeTxtW);
      }
      const bw = Math.max(Math.min(barW * 0.72, 118), badgeTxtW);
      const bpx = Math.round(pt.x - bw * 0.5);
      const bpy = by - 13;

      roundRectPath(ctx, bpx + 0.5, bpy + 1.5, bw, 14, 3);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fill();

      roundRectPath(ctx, bpx, bpy, bw, 14, 3);
      ctx.fillStyle = '#d4af64';
      ctx.fill();
      ctx.strokeStyle = '#5e4419';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.fillStyle = '#1b1307';
      ctx.font = '700 8.8px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badge, pt.x, bpy + 7.4);
    }

    // 2. Main Banner Bar Shadow & Dark Slate Pill
    roundRectPath(ctx, bx + 1, by + 2.5, barW, barH, 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    ctx.fill();

    roundRectPath(ctx, bx, by, barW, barH, 5);
    ctx.fillStyle = isSelected ? 'rgba(32, 46, 64, 0.98)' : 'rgba(18, 28, 40, 0.94)';
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffe59c' : 'rgba(205, 170, 98, 0.85)';
    ctx.lineWidth = isSelected ? 1.6 : 1.05;
    ctx.stroke();

    // Left Terracotta-Orange Population Capsule (bold high-contrast white numerals)
    const pillX = bx + 3;
    const pillY = by + 3;
    const pillH = barH - 6;
    roundRectPath(ctx, pillX, pillY, popW, pillH, 3.5);
    ctx.fillStyle = '#ce733c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 224, 180, 0.38)';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    const midY = by + barH * 0.5 + 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 9.5px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(popTxt, pillX + popW * 0.5, midY);

    // City Name (+ gold star if provincial capital / direct-controlled anchor)
    let curX = pillX + popW + 7;
    if (isAnchor) {
      ctx.fillStyle = '#f2cf78';
      ctx.font = '700 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('★', curX, midY);
      curX += 12;
    }

    ctx.fillStyle = '#f8efd8';
    ctx.font = '700 11.5px "Noto Serif SC", "Songti SC", Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(name, curX, midY);
    curX += nameW + 5;

    // Crisp Green Growth Rate (+5.8%)
    if (hasGrowth) {
      ctx.fillStyle = city.growth >= 0 ? '#6ee39c' : '#f08272';
      ctx.font = '700 9.5px "PingFang SC", sans-serif';
      ctx.fillText(growthTxt, curX, midY);
    }

    // Right Civic Seal Medallion (province colored)
    const sealX = bx + barW - 11;
    ctx.fillStyle = pColor;
    ctx.strokeStyle = '#d4af64';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(sealX, by + barH * 0.5, 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3d2';
    ctx.fillRect(sealX - 2.2, by + barH * 0.5 - 2.2, 4.4, 4.4);

    // 3. Bottom Telemetry Yield Sub-Bar (full 5-yield bar zoomed in; compact pips at regional zoom)
    if (showYieldBar && yieldItems) {
      const yx = Math.round(pt.x - yieldStripW * 0.5);
      const yy = by + barH + 1;
      const yh = 16;

      roundRectPath(ctx, yx + 0.5, yy + 1.5, yieldStripW, yh, 3.5);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.40)';
      ctx.fill();

      roundRectPath(ctx, yx, yy, yieldStripW, yh, 3.5);
      ctx.fillStyle = 'rgba(11, 18, 28, 0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(196, 160, 88, 0.58)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      let tx = yx + 8;
      const yMid = yy + yh * 0.5 + 0.3;
      ctx.font = '700 9px "PingFang SC", sans-serif';
      ctx.textAlign = 'left';
      for (let yk = 0; yk < yieldItems.length; yk++) {
        const it = yieldItems[yk];
        drawYieldMiniIcon(ctx, it.key, tx + 2, yMid - 0.5, it.color);
        ctx.fillStyle = '#efe6cf';
        ctx.fillText(it.val, tx + 9, yMid);
        tx += it.w;
      }
    } else if (showYieldDots && city.yields) {
      const yY = by + barH + 4;
      const dx0 = pt.x - 14;
      for (let d = 0; d < 5; d++) {
        ctx.fillStyle = YIELD_SPECS[d].color;
        ctx.beginPath();
        ctx.arc(dx0 + d * 7, yY + 2.5, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    hitBanners.push({
      city,
      x: boundX - 3,
      y: topY - 2,
      w: boundW + 6,
      h: boundH + 4,
    });
  }

  ctx.restore();
  return hitBanners;
}
