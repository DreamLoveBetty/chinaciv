// Color-batched & primitive-chunked Civilization-style terrain glyphs rendered inside land hexes

function cellHash(i, k) {
  let x = (i * 374761393 + k * 668265263) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

export function drawTerrainArt(ctx, w, visibleCells, zoom, showDetail) {
  if (!showDetail || zoom < 0.34 || !visibleCells.length) return;
  const R = w.R;
  const alphaScale = Math.min(1, (zoom - 0.34) / 0.32);
  const { cxArr, cyArr, owner, cover: coverArr, relief: reliefArr, elev: elevArr } = w;

  const pSnowLeft = [];
  const pSnowRight = [];
  const pRockLeft = [];
  const pRockRight = [];
  const pSnowCaps = [];
  const pTreeShadow = [];
  const pTreeLight = [];
  const pTreeDark = [];
  const pCrop = [];
  const pDunes = [];
  const pUrbanShadow = [];
  const pUrbanA = [];
  const pUrbanB = [];
  const pWetland = [];

  const nTrees = zoom >= 0.7 ? 4 : 2;
  const doCrop = zoom >= 0.44;
  const doDunes = zoom >= 0.4;
  const doUrban = zoom >= 0.38;
  const doWet = zoom >= 0.44;

  for (let k = 0; k < visibleCells.length; k++) {
    const i = visibleCells[k];
    if (owner[i] < 0) continue;

    const cx = cxArr[i];
    const cy = cyArr[i];
    const cover = coverArr[i];
    const relief = reliefArr ? reliefArr[i] : 0;
    const elev = elevArr ? elevArr[i] : 0;

    if (cover === 1 || cover === 2 || relief >= 2 || elev >= 2600) {
      const nPeaks = relief >= 3 || elev > 4200 ? 3 : 2;
      const isSnowPeak = cover === 1 || elev > 4500;
      const leftBucket = isSnowPeak ? pSnowLeft : pRockLeft;
      const rightBucket = isSnowPeak ? pSnowRight : pRockRight;
      const hasCap = elev > 3800 || cover === 1;

      for (let p = 0; p < nPeaks; p++) {
        const ox = (p - (nPeaks - 1) * 0.5) * R * 0.42 + (cellHash(i, p) - 0.5) * 2.2;
        const oy = (p === 1 ? -0.14 : 0.14) * R;
        const h = R * (0.36 + 0.12 * cellHash(i, p + 5));
        const hw = h * 0.85;
        const px = cx + ox;
        const py = cy + oy;
        leftBucket.push(px, py - h, px - hw, py + h * 0.35, px, py + h * 0.35);
        rightBucket.push(px, py - h, px + hw, py + h * 0.35, px, py + h * 0.35);
        if (hasCap) {
          pSnowCaps.push(px, py - h, px - hw * 0.35, py - h * 0.45, px + hw * 0.28, py - h * 0.5);
        }
      }
      continue;
    }

    if (cover === 3) {
      for (let t = 0; t < nTrees; t++) {
        const ang = t * 2.1 + cellHash(i, t) * 1.4;
        const rad = R * (0.18 + 0.36 * cellHash(i, t + 10));
        const tx = cx + Math.cos(ang) * rad;
        const ty = cy + Math.sin(ang) * rad;
        const tr = R * (0.16 + 0.05 * cellHash(i, t + 20));
        pTreeShadow.push(tx + 0.7, ty + 0.8, tr);
        if (t % 2 === 0) pTreeLight.push(tx, ty, tr);
        else pTreeDark.push(tx, ty, tr);
      }
      continue;
    }

    if (cover === 7 && doCrop) {
      for (let f = -2; f <= 2; f++) {
        const yOff = f * R * 0.22;
        const half = R * (0.48 - Math.abs(f) * 0.08);
        pCrop.push(cx - half, cy + yOff, cx + half, cy + yOff - R * 0.08);
      }
      continue;
    }

    if (cover === 4 && doDunes) {
      for (let d = -1; d <= 1; d++) {
        const dy = cy + d * R * 0.28;
        pDunes.push(cx - R * 0.45, dy + R * 0.08, cx, dy - R * 0.14, cx + R * 0.45, dy + R * 0.06);
      }
      continue;
    }

    if (cover === 9 && doUrban) {
      for (let b = 0; b < 4; b++) {
        const bx = cx + (cellHash(i, b * 2) - 0.5) * R * 0.7;
        const by = cy + (cellHash(i, b * 2 + 1) - 0.5) * R * 0.65;
        const bw = R * 0.18;
        const bh = R * (0.14 + 0.1 * cellHash(i, b + 9));
        pUrbanShadow.push(bx - bw * 0.5 + 0.6, by - bh * 0.5 + 0.6, bw, bh);
        if (b % 2 === 0) pUrbanA.push(bx - bw * 0.5, by - bh * 0.5, bw, bh);
        else pUrbanB.push(bx - bw * 0.5, by - bh * 0.5, bw, bh);
      }
      continue;
    }

    if (cover === 8 && doWet) {
      pWetland.push(
        cx - R * 0.32, cy + R * 0.1, cx + R * 0.22, cy + R * 0.1,
        cx - R * 0.15, cy - R * 0.15, cx + R * 0.35, cy - R * 0.15
      );
    }
  }

  ctx.save();

  // Chunk every path to <=300 primitives so Skia never enters slow giant-path tessellation
  const fillTris = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 6 * 300;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 6) {
        ctx.moveTo(arr[i], arr[i + 1]);
        ctx.lineTo(arr[i + 2], arr[i + 3]);
        ctx.lineTo(arr[i + 4], arr[i + 5]);
        ctx.closePath();
      }
      ctx.fill();
    }
  };

  fillTris(pRockLeft, '#968b7a', 0.72 * alphaScale);
  fillTris(pRockRight, '#5b5347', 0.72 * alphaScale);
  fillTris(pSnowLeft, '#dce6ef', 0.72 * alphaScale);
  fillTris(pSnowRight, '#9ab0c4', 0.72 * alphaScale);
  fillTris(pSnowCaps, '#f2f7fb', 0.72 * alphaScale);

  const fillCircles = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 3 * 250;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 3) {
        const x = arr[i];
        const y = arr[i + 1];
        const r = arr[i + 2];
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  };

  fillCircles(pTreeShadow, '#1b3f24', 0.65 * alphaScale);
  fillCircles(pTreeLight, '#3f7c4b', 0.65 * alphaScale);
  fillCircles(pTreeDark, '#31683d', 0.65 * alphaScale);

  if (pCrop.length) {
    ctx.globalAlpha = 0.34 * alphaScale;
    ctx.strokeStyle = '#cfe089';
    ctx.lineWidth = Math.max(0.7, 1.1 / Math.sqrt(zoom));
    const step = 4 * 400;
    for (let off = 0; off < pCrop.length; off += step) {
      ctx.beginPath();
      const end = Math.min(pCrop.length, off + step);
      for (let i = off; i < end; i += 4) {
        ctx.moveTo(pCrop[i], pCrop[i + 1]);
        ctx.lineTo(pCrop[i + 2], pCrop[i + 3]);
      }
      ctx.stroke();
    }
  }

  if (pDunes.length) {
    ctx.globalAlpha = 0.38 * alphaScale;
    ctx.strokeStyle = '#ecd39c';
    ctx.lineWidth = Math.max(0.8, 1.2 / Math.sqrt(zoom));
    const step = 6 * 300;
    for (let off = 0; off < pDunes.length; off += step) {
      ctx.beginPath();
      const end = Math.min(pDunes.length, off + step);
      for (let i = off; i < end; i += 6) {
        ctx.moveTo(pDunes[i], pDunes[i + 1]);
        ctx.quadraticCurveTo(pDunes[i + 2], pDunes[i + 3], pDunes[i + 4], pDunes[i + 5]);
      }
      ctx.stroke();
    }
  }

  const fillRects = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 4 * 350;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 4) {
        ctx.rect(arr[i], arr[i + 1], arr[i + 2], arr[i + 3]);
      }
      ctx.fill();
    }
  };

  fillRects(pUrbanShadow, '#47362b', 0.72 * alphaScale);
  fillRects(pUrbanA, '#dfb579', 0.72 * alphaScale);
  fillRects(pUrbanB, '#c98856', 0.72 * alphaScale);

  if (pWetland.length) {
    ctx.globalAlpha = 0.45 * alphaScale;
    ctx.strokeStyle = '#8ad6c0';
    ctx.lineWidth = Math.max(0.7, 1 / Math.sqrt(zoom));
    const step = 4 * 350;
    for (let off = 0; off < pWetland.length; off += step) {
      ctx.beginPath();
      const end = Math.min(pWetland.length, off + step);
      for (let i = off; i < end; i += 4) {
        ctx.moveTo(pWetland[i], pWetland[i + 1]);
        ctx.lineTo(pWetland[i + 2], pWetland[i + 3]);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}
