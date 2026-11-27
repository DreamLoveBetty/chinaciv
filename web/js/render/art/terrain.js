// Procedural Civilization-style terrain glyphs rendered inside land hexes at zoom >= 0.28

function cellHash(i, k) {
  let x = (i * 374761393 + k * 668265263) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

export function drawTerrainArt(ctx, w, visibleCells, zoom, showDetail) {
  if (!showDetail || zoom < 0.28) return;
  const R = w.R;
  const alphaScale = Math.min(1, (zoom - 0.28) / 0.35);

  ctx.save();
  for (let k = 0; k < visibleCells.length; k++) {
    const i = visibleCells[k];
    if (w.owner[i] < 0) continue;

    const cx = w.cxArr[i];
    const cy = w.cyArr[i];
    const cover = w.cover[i];
    const relief = w.relief ? w.relief[i] : 0;
    const elev = w.elev ? w.elev[i] : 0;

    // 1. Mountains / high relief peaks
    if (cover === 1 || cover === 2 || relief >= 2 || elev >= 2600) {
      const nPeaks = relief >= 3 || elev > 4200 ? 3 : 2;
      ctx.globalAlpha = 0.72 * alphaScale;
      for (let p = 0; p < nPeaks; p++) {
        const ox = (p - (nPeaks - 1) * 0.5) * R * 0.42 + (cellHash(i, p) - 0.5) * 2.2;
        const oy = (p === 1 ? -0.14 : 0.14) * R;
        const h = R * (0.36 + 0.12 * cellHash(i, p + 5));
        const hw = h * 0.85;
        const px = cx + ox;
        const py = cy + oy;

        // Sunlit west slope
        ctx.fillStyle = cover === 1 || elev > 4500 ? '#dce6ef' : '#968b7a';
        ctx.beginPath();
        ctx.moveTo(px, py - h);
        ctx.lineTo(px - hw, py + h * 0.35);
        ctx.lineTo(px, py + h * 0.35);
        ctx.closePath();
        ctx.fill();

        // Shaded east slope
        ctx.fillStyle = cover === 1 || elev > 4500 ? '#9ab0c4' : '#5b5347';
        ctx.beginPath();
        ctx.moveTo(px, py - h);
        ctx.lineTo(px + hw, py + h * 0.35);
        ctx.lineTo(px, py + h * 0.35);
        ctx.closePath();
        ctx.fill();

        // Snow cap on very high peaks
        if (elev > 3800 || cover === 1) {
          ctx.fillStyle = '#f2f7fb';
          ctx.beginPath();
          ctx.moveTo(px, py - h);
          ctx.lineTo(px - hw * 0.35, py - h * 0.45);
          ctx.lineTo(px + hw * 0.28, py - h * 0.5);
          ctx.closePath();
          ctx.fill();
        }
      }
      continue;
    }

    // 2. Forests
    if (cover === 3) {
      const nTrees = zoom >= 0.55 ? 5 : 3;
      ctx.globalAlpha = 0.65 * alphaScale;
      for (let t = 0; t < nTrees; t++) {
        const ang = t * 2.1 + cellHash(i, t) * 1.4;
        const rad = R * (0.18 + 0.36 * cellHash(i, t + 10));
        const tx = cx + Math.cos(ang) * rad;
        const ty = cy + Math.sin(ang) * rad;
        const tr = R * (0.16 + 0.05 * cellHash(i, t + 20));

        ctx.fillStyle = '#1b3f24';
        ctx.beginPath();
        ctx.arc(tx + 0.7, ty + 0.8, tr, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = t % 2 === 0 ? '#3f7c4b' : '#31683d';
        ctx.beginPath();
        ctx.arc(tx, ty, tr, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }

    // 3. Cropland furrows
    if (cover === 7 && zoom >= 0.4) {
      ctx.globalAlpha = 0.34 * alphaScale;
      ctx.strokeStyle = '#cfe089';
      ctx.lineWidth = Math.max(0.7, 1.1 / Math.sqrt(zoom));
      ctx.beginPath();
      for (let f = -2; f <= 2; f++) {
        const yOff = f * R * 0.22;
        const half = R * (0.48 - Math.abs(f) * 0.08);
        ctx.moveTo(cx - half, cy + yOff);
        ctx.lineTo(cx + half, cy + yOff - R * 0.08);
      }
      ctx.stroke();
      continue;
    }

    // 4. Desert dunes
    if (cover === 4 && zoom >= 0.36) {
      ctx.globalAlpha = 0.38 * alphaScale;
      ctx.strokeStyle = '#ecd39c';
      ctx.lineWidth = Math.max(0.8, 1.2 / Math.sqrt(zoom));
      ctx.beginPath();
      for (let d = -1; d <= 1; d++) {
        const dy = cy + d * R * 0.28;
        ctx.moveTo(cx - R * 0.45, dy + R * 0.08);
        ctx.quadraticCurveTo(cx, dy - R * 0.14, cx + R * 0.45, dy + R * 0.06);
      }
      ctx.stroke();
      continue;
    }

    // 5. Built-up / Urban clusters
    if (cover === 9 && zoom >= 0.35) {
      ctx.globalAlpha = 0.72 * alphaScale;
      const blocks = 4;
      for (let b = 0; b < blocks; b++) {
        const bx = cx + (cellHash(i, b * 2) - 0.5) * R * 0.7;
        const by = cy + (cellHash(i, b * 2 + 1) - 0.5) * R * 0.65;
        const bw = R * 0.18;
        const bh = R * (0.14 + 0.1 * cellHash(i, b + 9));
        ctx.fillStyle = '#47362b';
        ctx.fillRect(bx - bw * 0.5 + 0.6, by - bh * 0.5 + 0.6, bw, bh);
        ctx.fillStyle = b % 2 === 0 ? '#dfb579' : '#c98856';
        ctx.fillRect(bx - bw * 0.5, by - bh * 0.5, bw, bh);
      }
      continue;
    }

    // 6. Wetland reeds
    if (cover === 8 && zoom >= 0.4) {
      ctx.globalAlpha = 0.45 * alphaScale;
      ctx.strokeStyle = '#8ad6c0';
      ctx.lineWidth = Math.max(0.7, 1 / Math.sqrt(zoom));
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.32, cy + R * 0.1);
      ctx.lineTo(cx + R * 0.22, cy + R * 0.1);
      ctx.moveTo(cx - R * 0.15, cy - R * 0.15);
      ctx.lineTo(cx + R * 0.35, cy - R * 0.15);
      ctx.stroke();
    }
  }
  ctx.restore();
}
