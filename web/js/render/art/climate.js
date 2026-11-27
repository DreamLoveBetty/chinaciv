// Precipitation 400mm continental isohyet line art & screen-space callout badges

function traceSmoothLine(path, pts) {
  if (!Array.isArray(pts) || pts.length < 2) return;
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) * 0.5;
    const my = (pts[i][1] + pts[i + 1][1]) * 0.5;
    path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  path.lineTo(last[0], last[1]);
}

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

function ensureIsohyetPath(w) {
  if (w._isohyet400Built) return w._isohyet400Path;
  w._isohyet400Built = true;
  const lines = w.isohyet_400?.lines;
  if (!Array.isArray(lines) || !lines.length) {
    w._isohyet400Path = null;
    return null;
  }
  const p = new Path2D();
  for (const pts of lines) {
    traceSmoothLine(p, pts);
  }
  w._isohyet400Path = p;
  return p;
}

/**
 * Draw the continental 400mm isohyet dividing line on static cache in world coordinates.
 */
export function drawIsohyet400(ctx, w, zoom) {
  const iso = w.isohyet_400;
  if (!iso) return;
  const path = ensureIsohyetPath(w);
  if (!path) return;

  const z = Math.max(0.22, zoom);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Deep outer halo for crisp figure-ground contrast across any terrain color
  ctx.strokeStyle = 'rgba(6, 13, 22, 0.90)';
  ctx.lineWidth = Math.max(7.2, 11.2 / z);
  ctx.stroke(path);

  // 2. Vivid vermilion-coral ribbon
  ctx.strokeStyle = '#ff4f38';
  ctx.lineWidth = Math.max(3.6, 5.6 / z);
  ctx.stroke(path);

  // 3. Luminous pale gold-white inner core
  ctx.strokeStyle = '#fff2bd';
  ctx.lineWidth = Math.max(1.3, 2.0 / z);
  ctx.stroke(path);

  // Subtle glowing diamond markers along classic geographic anchors
  const anchors = iso.anchors;
  if (Array.isArray(anchors) && anchors.length) {
    const r = Math.max(4.5, 6.8 / z);
    ctx.beginPath();
    for (const a of anchors) {
      if (a?.x == null || a?.y == null) continue;
      ctx.moveTo(a.x, a.y - r);
      ctx.lineTo(a.x + r, a.y);
      ctx.lineTo(a.x, a.y + r);
      ctx.lineTo(a.x - r, a.y);
      ctx.closePath();
    }
    ctx.fillStyle = '#fff2bd';
    ctx.strokeStyle = '#ff4f38';
    ctx.lineWidth = Math.max(1.2, 1.8 / z);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

function rectsOverlap(a, b, pad = 4) {
  return !(
    a.x + a.w + pad < b.x ||
    a.x > b.x + b.w + pad ||
    a.y + a.h + pad < b.y ||
    a.y > b.y + b.h + pad
  );
}

/**
 * Draw crisp screen-space callout badges for the 400mm isohyet line when Precipitation lens is active,
 * avoiding overlaps with city banners and each other.
 */
export function drawIsohyet400Labels(ctx, w, cam, state, hitBanners = []) {
  if (state.lens?.id !== 'precip' || !w.isohyet_400) {
    if (w) {
      w._lastIsohyetPrimaryPlaced = false;
      w._lastIsohyetLabelCount = 0;
    }
    return;
  }

  const iso = w.isohyet_400;
  const labels = Array.isArray(iso.labels) ? iso.labels : [];
  if (!labels.length) {
    w._lastIsohyetPrimaryPlaced = false;
    w._lastIsohyetLabelCount = 0;
    return;
  }

  ctx.save();
  ctx.textBaseline = 'middle';

  const placed = [];
  if (Array.isArray(hitBanners)) {
    for (const b of hitBanners) {
      if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h)) {
        placed.push({ x: b.x, y: b.y, w: b.w, h: b.h });
      }
    }
  }

  let primaryScreen = null;
  let drawnCount = 0;

  const PILL_OFFSETS = [
    [0, 0],
    [0, -26],
    [0, 26],
    [-52, -22],
    [52, -22],
    [-52, 22],
    [52, 22],
    [-86, 0],
    [86, 0],
    [0, -44],
    [0, 44],
    [-116, -34],
    [116, -34],
    [-116, 34],
    [116, 34],
    [0, -68],
    [0, 68],
  ];

  // Draw primary first, then secondary
  const ordered = [...labels].sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));

  for (const lbl of ordered) {
    if (lbl?.x == null || lbl?.y == null) continue;
    const pt = cam.worldToScreen(lbl.x, lbl.y);
    if (pt.x < -160 || pt.x > cam.width + 160 || pt.y < -60 || pt.y > cam.height + 60) continue;

    const isPrimary = Boolean(lbl.primary);
    const text = lbl.text || '400mm 线';
    ctx.font = isPrimary
      ? '700 12px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Serif SC", sans-serif'
      : '700 11px -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Serif SC", sans-serif';
    const tw = ctx.measureText(text).width;
    const pw = Math.ceil(tw + (isPrimary ? 28 : 22));
    const ph = isPrimary ? 24 : 20;

    let chosen = null;
    for (const [dx, dy] of PILL_OFFSETS) {
      const cx = pt.x + dx;
      const cy = pt.y + dy;
      const rect = { x: cx - pw * 0.5, y: cy - ph * 0.5, w: pw, h: ph };
      if (rect.x < 8 || rect.x + rect.w > cam.width - 8 || rect.y < 8 || rect.y + rect.h > cam.height - 8) {
        continue;
      }
      if (!placed.some((p) => rectsOverlap(p, rect, 6))) {
        chosen = { cx, cy, dx, dy, rect };
        break;
      }
    }
    if (!chosen) continue;
    placed.push(chosen.rect);
    drawnCount++;
    if (isPrimary) primaryScreen = { x: chosen.cx, y: chosen.cy };

    // Subtle leader tick back to anchor point when nudged away from a city banner
    const dist = Math.hypot(chosen.dx, chosen.dy);
    if (dist > 18) {
      const edgeX = Math.max(chosen.rect.x + 6, Math.min(chosen.rect.x + chosen.rect.w - 6, pt.x));
      const edgeY = Math.max(chosen.rect.y + 4, Math.min(chosen.rect.y + chosen.rect.h - 4, pt.y));
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(edgeX, edgeY);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(255, 87, 61, 0.85)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff2bd';
      ctx.fill();
    }

    const { x: rx, y: ry } = chosen.rect;
    roundRectPath(ctx, rx, ry, pw, ph, 999);
    ctx.fillStyle = 'rgba(10, 20, 32, 0.93)';
    ctx.fill();
    ctx.lineWidth = isPrimary ? 1.8 : 1.3;
    ctx.strokeStyle = '#ff573d';
    ctx.stroke();

    if (isPrimary) {
      roundRectPath(ctx, rx + 1.5, ry + 1.5, pw - 3, ph - 3, 999);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(255, 242, 189, 0.45)';
      ctx.stroke();
    }

    const dotX = rx + 10;
    const dotY = chosen.cy;
    ctx.beginPath();
    ctx.arc(dotX, dotY, isPrimary ? 3.8 : 3.0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff573d';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dotX, dotY, isPrimary ? 1.7 : 1.3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff2bd';
    ctx.fill();

    ctx.fillStyle = '#fff3cf';
    ctx.fillText(text, rx + (isPrimary ? 18 : 16), chosen.cy + 0.5);
  }

  // Overview dry/wet side cues flanking primary dividing badge
  if (cam.zoom <= 0.65 && primaryScreen) {
    const cues = [
      {
        offsets: [
          [-155, -38],
          [-145, -62],
          [-185, -16],
          [-130, -82],
          [-190, -48],
        ],
        text: '↖ 干旱 / 半干旱 <400mm',
        color: '#f2c57c',
        border: 'rgba(228, 207, 139, 0.48)',
      },
      {
        offsets: [
          [35, 105],
          [75, 125],
          [140, 120],
          [180, 90],
          [130, 68],
          [105, 96],
          [160, 44],
          [0, 92],
        ],
        text: '↘ 半湿润 / 湿润 >400mm',
        color: '#8de0cc',
        border: 'rgba(70, 181, 168, 0.52)',
      },
    ];
    ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    for (const cue of cues) {
      const tw = ctx.measureText(cue.text).width;
      const pw = Math.ceil(tw + 14);
      const ph = 19;
      let chosenRect = null;
      for (const [dx, dy] of cue.offsets) {
        const cx = primaryScreen.x + dx;
        const cy = primaryScreen.y + dy;
        const rect = { x: cx - pw * 0.5, y: cy - ph * 0.5, w: pw, h: ph };
        if (rect.x < 8 || rect.x + rect.w > cam.width - 8 || rect.y < 8 || rect.y + rect.h > cam.height - 8) {
          continue;
        }
        if (!placed.some((p) => rectsOverlap(p, rect, 6))) {
          chosenRect = { rect, cy };
          break;
        }
      }
      if (!chosenRect) continue;
      placed.push(chosenRect.rect);

      roundRectPath(ctx, chosenRect.rect.x, chosenRect.rect.y, chosenRect.rect.w, chosenRect.rect.h, 4);
      ctx.fillStyle = 'rgba(8, 17, 28, 0.88)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = cue.border;
      ctx.stroke();

      ctx.fillStyle = cue.color;
      ctx.fillText(cue.text, chosenRect.rect.x + 7, chosenRect.cy + 0.5);
    }
  }

  w._lastIsohyetPrimaryPlaced = Boolean(primaryScreen);
  w._lastIsohyetLabelCount = drawnCount;

  // Geographic landmark callouts when zoomed in slightly
  if (cam.zoom >= 0.42 && Array.isArray(iso.anchors)) {
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    for (const a of iso.anchors) {
      if (!a?.name || a.x == null || a.y == null) continue;
      const pt = cam.worldToScreen(a.x, a.y);
      if (pt.x < 10 || pt.x > cam.width - 60 || pt.y < 10 || pt.y > cam.height - 20) continue;
      const tw = ctx.measureText(a.name).width;
      const pw = Math.ceil(tw + 10);
      const ph = 17;
      let chosenRect = null;
      for (const [dx, dy] of [[8, -8.5], [-pw - 8, -8.5], [-pw * 0.5, -ph - 8], [-pw * 0.5, 8]]) {
        const rect = { x: pt.x + dx, y: pt.y + dy, w: pw, h: ph };
        if (rect.x < 8 || rect.x + rect.w > cam.width - 8 || rect.y < 8 || rect.y + rect.h > cam.height - 8) continue;
        if (!placed.some((p) => rectsOverlap(p, rect, 6))) {
          chosenRect = rect;
          break;
        }
      }
      if (!chosenRect) continue;
      placed.push(chosenRect);

      roundRectPath(ctx, chosenRect.x, chosenRect.y, chosenRect.w, chosenRect.h, 3);
      ctx.fillStyle = 'rgba(10, 20, 32, 0.86)';
      ctx.fill();
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = 'rgba(255, 242, 189, 0.48)';
      ctx.stroke();

      ctx.fillStyle = '#fff2bd';
      ctx.fillText(a.name, chosenRect.x + 5, chosenRect.y + ph * 0.5 + 0.5);
    }
  }

  ctx.restore();
}
