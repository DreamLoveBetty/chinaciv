// Color-batched & primitive-chunked Civilization-style terrain glyphs rendered inside land hexes

function cellHash(i, k) {
  let x = (i * 374761393 + k * 668265263) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function pushTri(arr, x0, y0, x1, y1, x2, y2) {
  arr.push(x0, y0, x1, y1, x2, y2);
}

function pushQuad(arr, x0, y0, x1, y1, x2, y2, x3, y3) {
  arr.push(x0, y0, x1, y1, x2, y2, x3, y3);
}

function pushLine(arr, x0, y0, x1, y1) {
  arr.push(x0, y0, x1, y1);
}

/**
 * Draw batched diorama terrain artwork: snow peaks, rocky/forested peaks,
 * smooth organic rolling hills, 2-tier conifer pines, broadleaf canopies, patchwork farms,
 * desert dunes & scrub tufts, and marsh wetlands.
 */
export function drawTerrainArt(ctx, w, visibleCells, zoom, showDetail, cityCoreSet = null) {
  if (!showDetail || zoom < 0.26 || !visibleCells.length) return;
  const R = w.R;
  const alphaScale = Math.min(1, (zoom - 0.26) / 0.28);
  const { cxArr, cyArr, owner, cover: coverArr, relief: reliefArr, elev: elevArr } = w;

  // Mountain layers: back peaks (tier 0) drawn before front peaks (tier 1)
  const mShadow = [[], []];
  const mSnowLeft = [[], []];
  const mSnowRight = [[], []];
  const mAridLeft = [[], []];
  const mAridRight = [[], []];
  const mGreenLeft = [[], []];
  const mGreenRight = [[], []];
  const mCapLit = [[], []];
  const mCapShade = [[], []];
  const mOutlines = [[], []];

  // Smooth rounded quadratic hills (center x, base y, half-width rx, height ry)
  const hShadow = [[], []];
  const hGreenDomes = [[], []];
  const hDesertDomes = [[], []];
  const hForestDomes = [[], []];

  // Trees (isometric 2-tier pines & broadleaf clusters)
  const treeShadow = [];
  const treeTrunks = [];
  const pineLowerL = [];
  const pineLowerR = [];
  const pineUpperL = [];
  const pineUpperR = [];
  const broadShade = [];
  const broadMid = [];
  const broadCrown = [];

  // Biome floor textures
  const cropPlotGold = [];
  const cropPlotGreen = [];
  const cropPlotEarth = [];
  const cropFurrows = [];
  const duneCrests = [];
  const duneTroughs = [];
  const scrubShadow = [];
  const scrubBody = [];
  const scrubLit = [];
  const grassTufts = [];
  const wetPools = [];
  const wetGlint = [];
  const wetReeds = [];

  const doOutlines = zoom >= 0.90;
  const doTrunks = zoom >= 0.45;
  const doHills = zoom >= 0.34;
  const doCrop = zoom >= 0.40;
  const doCropFurrows = zoom >= 0.90;
  const doDunes = zoom >= 0.36;
  const doWet = zoom >= 0.38;
  const doGrass = zoom >= 0.56;
  const treeBaseCount = zoom >= 0.85 ? 8 : zoom >= 0.50 ? 5 : 3;

  const pushConifer = (tx, ty, s) => {
    treeShadow.push(tx + 0.065 * R * s, ty + 0.015 * R * s, 0.135 * R * s, 0.062 * R * s);
    if (doTrunks) {
      treeTrunks.push(tx - 0.024 * R * s, ty - 0.05 * R * s, 0.048 * R * s, 0.09 * R * s);
    }
    const lowW = 0.155 * R * s;
    const midY = ty - 0.035 * R * s;
    const lowTop = ty - 0.28 * R * s;
    pushTri(pineLowerL, tx, lowTop, tx - lowW, midY, tx + 0.012 * R * s, midY);
    pushTri(pineLowerR, tx, lowTop, tx + lowW, midY, tx + 0.012 * R * s, midY);

    const upW = 0.112 * R * s;
    const upY = ty - 0.17 * R * s;
    const apexY = ty - 0.41 * R * s;
    pushTri(pineUpperL, tx, apexY, tx - upW, upY, tx + 0.01 * R * s, upY);
    pushTri(pineUpperR, tx, apexY, tx + upW, upY, tx + 0.01 * R * s, upY);
  };

  const pushBroadleaf = (tx, ty, s) => {
    treeShadow.push(tx + 0.065 * R * s, ty + 0.018 * R * s, 0.14 * R * s, 0.065 * R * s);
    if (doTrunks) {
      treeTrunks.push(tx - 0.025 * R * s, ty - 0.052 * R * s, 0.05 * R * s, 0.088 * R * s);
    }
    const cyB = ty - 0.165 * R * s;
    const r0 = 0.135 * R * s;
    broadShade.push(tx + 0.024 * R * s, cyB + 0.016 * R * s, r0);
    broadMid.push(tx - 0.015 * R * s, cyB - 0.016 * R * s, r0 * 0.96);
    broadCrown.push(tx - 0.042 * R * s, cyB - 0.056 * R * s, r0 * 0.64);
  };

  for (let k = 0; k < visibleCells.length; k++) {
    const i = visibleCells[k];
    if (owner[i] < 0) continue;
    const cover = coverArr[i];
    if (cover === 9 || (cityCoreSet && cityCoreSet.has(i))) continue;

    const cx = cxArr[i];
    const cy = cyArr[i];
    const relief = reliefArr ? reliefArr[i] : 0;
    const elev = elevArr ? elevArr[i] : 0;

    // 1. Mountains (snowy peaks vs alpine/rock/forested peaks)
    if (cover === 1 || cover === 2 || relief >= 2 || elev >= 2650) {
      const isSnowPeak = cover === 1 || elev >= 3750 || (relief >= 3 && elev >= 2800);
      const isHigh = relief >= 3 || elev >= 4250;
      const isArid = cover === 2 || cover === 4;

      const leftB = isSnowPeak ? mSnowLeft : isArid ? mAridLeft : mGreenLeft;
      const rightB = isSnowPeak ? mSnowRight : isArid ? mAridRight : mGreenRight;

      const jitX = (cellHash(i, 7) - 0.5) * 0.24 * R;
      const jitY = (cellHash(i, 13) - 0.5) * 0.14 * R;
      const pattern = cellHash(i, 99);
      const peakSpecs = isHigh
        ? pattern < 0.35
          ? [
              { layer: 0, ox: -0.32 * R + jitX * 0.4, oy: -0.10 * R + jitY, scale: 0.78 },
              { layer: 1, ox: 0.14 * R + jitX * 0.4, oy: 0.20 * R + jitY * 0.5, scale: 1.15 },
            ]
          : [
              { layer: 0, ox: -0.34 * R + jitX * 0.5, oy: -0.04 * R + jitY, scale: 0.84 },
              { layer: 0, ox: 0.34 * R + jitX * 0.5, oy: -0.02 * R + jitY, scale: 0.82 },
              { layer: 1, ox: (cellHash(i, 3) - 0.5) * 0.24 * R, oy: 0.25 * R + jitY * 0.6, scale: 1.08 },
            ]
        : pattern < 0.3
          ? [{ layer: 1, ox: jitX * 0.6, oy: 0.14 * R + jitY * 0.6, scale: 1.16 }]
          : [
              { layer: 0, ox: (cellHash(i, 1) > 0.5 ? -0.30 : 0.30) * R + jitX * 0.6, oy: -0.06 * R + jitY, scale: 0.84 },
              { layer: 1, ox: (cellHash(i, 2) > 0.5 ? 0.14 : -0.14) * R + jitX * 0.5, oy: 0.22 * R + jitY * 0.6, scale: 1.02 },
            ];

      for (let p = 0; p < peakSpecs.length; p++) {
        const sp = peakSpecs[p];
        const lyr = sp.layer;
        const h = R * (0.50 + 0.22 * cellHash(i, p + 5)) * sp.scale;
        const hw = h * (isSnowPeak ? 0.86 : 0.96);
        const ridgeOff = (cellHash(i, p + 17) - 0.44) * hw * 0.26;
        const px = cx + sp.ox + (cellHash(i, p + 29) - 0.5) * R * 0.12;
        const py = cy + sp.oy + (cellHash(i, p + 37) - 0.5) * R * 0.08;

        const topY = py - h;
        const baseY = py + h * 0.36;

        pushTri(
          mShadow[lyr],
          px + ridgeOff, topY + h * 0.28,
          px + hw * 1.24, baseY + h * 0.12,
          px + ridgeOff * 0.4, baseY + h * 0.08
        );

        pushTri(leftB[lyr], px, topY, px - hw, baseY, px + ridgeOff, baseY);
        pushTri(rightB[lyr], px, topY, px + hw, baseY, px + ridgeOff, baseY);

        if (isSnowPeak) {
          const s = 0.44 + 0.07 * cellHash(i, p + 51);
          const sL_x = px - hw * s;
          const sL_y = topY + (baseY - topY) * s;
          const sR_x = px + hw * s;
          const sR_y = topY + (baseY - topY) * s;
          const midS = s + 0.09;
          const sC_x = px + ridgeOff * midS;
          const sC_y = topY + (baseY - topY) * midS;

          const tL_x = (sL_x + sC_x) * 0.5 - hw * 0.04;
          const tL_y = topY + (baseY - topY) * (s * 0.72);
          const tR_x = (sR_x + sC_x) * 0.5 + hw * 0.04;
          const tR_y = topY + (baseY - topY) * (s * 0.74);

          pushQuad(mCapLit[lyr], px, topY, sL_x, sL_y, tL_x, tL_y, sC_x, sC_y);
          pushQuad(mCapShade[lyr], px, topY, sC_x, sC_y, tR_x, tR_y, sR_x, sR_y);
        }

        if (doOutlines) {
          pushLine(mOutlines[lyr], px - hw, baseY, px, topY);
          pushLine(mOutlines[lyr], px, topY, px + hw, baseY);
        }
      }

      // Foothill conifers around forested or sub-4500m mountains
      if (zoom >= 0.48 && (cover === 3 || (isSnowPeak && elev < 4500 && cellHash(i, 73) > 0.35))) {
        const tc = cover === 3 ? 3 : 2;
        for (let t = 0; t < tc; t++) {
          const tx = cx + (t - (tc - 1) * 0.5) * R * 0.48 + (cellHash(i, t + 81) - 0.5) * R * 0.16;
          const ty = cy + R * (0.35 + 0.14 * cellHash(i, t + 91));
          pushConifer(tx, ty, 0.84);
        }
      }
      continue;
    }

    // 2. Smooth Organic Rolling Hills (relief === 1 on non-mountain hexes)
    const isHill = relief === 1;
    if (isHill && doHills) {
      const hBucket = cover === 4 ? hDesertDomes : cover === 3 ? hForestDomes : hGreenDomes;
      const roll = cellHash(i, 11);
      // Vary 1 to 3 hills organically so arid expanses don't look stamped uniformly
      const nH = cover === 4 && roll < 0.28 ? 1 : roll > 0.46 ? 3 : 2;
      const presets = nH === 1
        ? [{ lyr: 1, ox: (cellHash(i, 5) - 0.5) * 0.30 * R, oy: (cellHash(i, 6) - 0.5) * 0.22 * R, rx: 0.46 * R, ry: 0.26 * R }]
        : nH === 2
          ? [
              { lyr: 0, ox: (cellHash(i, 5) - 0.5) * 0.45 * R - 0.14 * R, oy: -0.06 * R, rx: 0.36 * R, ry: 0.21 * R },
              { lyr: 1, ox: (cellHash(i, 6) - 0.5) * 0.40 * R + 0.16 * R, oy: 0.16 * R, rx: 0.38 * R, ry: 0.22 * R },
            ]
          : [
              { lyr: 0, ox: -0.26 * R, oy: -0.08 * R, rx: 0.34 * R, ry: 0.19 * R },
              { lyr: 0, ox: 0.28 * R, oy: -0.02 * R, rx: 0.32 * R, ry: 0.18 * R },
              { lyr: 1, ox: (cellHash(i, 9) - 0.5) * 0.24 * R, oy: 0.24 * R, rx: 0.39 * R, ry: 0.22 * R },
            ];

      for (let m = 0; m < presets.length; m++) {
        const md = presets[m];
        const sc = 0.85 + 0.32 * cellHash(i, m + 53);
        const mx = cx + md.ox + (cellHash(i, m + 31) - 0.5) * R * 0.14;
        const my = cy + md.oy + (cellHash(i, m + 43) - 0.5) * R * 0.10;
        const rx = md.rx * sc;
        const ry = md.ry * sc;

        hShadow[md.lyr].push(mx + rx * 0.22, my + ry * 0.08, rx * 0.94, ry * 0.36);
        hBucket[md.lyr].push(mx, my, rx, ry);
      }
    }

    // 3. Forests (2-tier spruce conifers & subtropical broadleaf canopies)
    if (cover === 3) {
      const nTrees = isHill ? Math.max(3, Math.floor(treeBaseCount * 0.65)) : treeBaseCount;
      const isNorthOrHighland = cy < 2580 || elev >= 1350;
      const pts = [];
      for (let t = 0; t < nTrees; t++) {
        const ang = t * 2.39996 + cellHash(i, t + 5) * 1.1;
        const rad = R * (0.14 + 0.52 * Math.sqrt((t + 0.45) / nTrees) * (0.82 + 0.32 * cellHash(i, t + 19)));
        pts.push({
          tx: cx + Math.cos(ang) * rad,
          ty: cy + Math.sin(ang) * rad * 0.88 + R * 0.12,
          s: 0.88 + 0.42 * cellHash(i, t + 33),
          mix: cellHash(i, t + 61),
        });
      }
      pts.sort((a, b) => a.ty - b.ty);
      for (let t = 0; t < pts.length; t++) {
        const pt = pts[t];
        if (isNorthOrHighland) {
          if (elev < 800 && cy > 2050 && pt.mix > 0.72) pushBroadleaf(pt.tx, pt.ty, pt.s);
          else pushConifer(pt.tx, pt.ty, pt.s);
        } else {
          if (pt.mix > 0.70) pushConifer(pt.tx, pt.ty, pt.s * 0.96);
          else pushBroadleaf(pt.tx, pt.ty, pt.s);
        }
      }
      continue;
    }

    // Sparse decorative trees on pasture cover === 6
    if (cover === 6 && zoom >= 0.45) {
      const n = zoom >= 0.85 ? 2 : 1;
      for (let t = 0; t < n; t++) {
        const tx = cx + (t === 0 ? -0.32 : 0.30) * R + (cellHash(i, t + 7) - 0.5) * 0.14 * R;
        const ty = cy + (cellHash(i, t + 13) - 0.5) * 0.34 * R;
        pushBroadleaf(tx, ty, 0.82);
      }
    }

    // 4. Patchwork Farmland (cover === 7)
    if (cover === 7 && doCrop && !isHill) {
      const plots = [
        { ox: -0.26 * R, oy: -0.14 * R, pw: 0.36 * R, ph: 0.24 * R, skew: 0.08 * R, pal: 0 },
        { ox: 0.18 * R, oy: -0.06 * R, pw: 0.32 * R, ph: 0.25 * R, skew: -0.06 * R, pal: 1 },
        { ox: -0.06 * R, oy: 0.20 * R, pw: 0.40 * R, ph: 0.22 * R, skew: 0.06 * R, pal: 2 },
      ];
      for (let p = 0; p < plots.length; p++) {
        const pl = plots[p];
        const px = cx + pl.ox + (cellHash(i, p + 3) - 0.5) * R * 0.08;
        const py = cy + pl.oy + (cellHash(i, p + 9) - 0.5) * R * 0.08;
        const hw = pl.pw * 0.5;
        const hh = pl.ph * 0.5;
        const bucketIdx = (Math.floor(cellHash(i, p + 21) * 3) + pl.pal) % 3;
        const bucket = bucketIdx === 0 ? cropPlotGold : bucketIdx === 1 ? cropPlotGreen : cropPlotEarth;
        pushQuad(
          bucket,
          px - hw, py - hh,
          px + hw, py - hh + pl.skew,
          px + hw - pl.skew * 0.5, py + hh + pl.skew,
          px - hw - pl.skew * 0.5, py + hh
        );
        if (doCropFurrows) {
          for (let f = -1; f <= 1; f++) {
            const fy = py + f * hh * 0.48;
            pushLine(cropFurrows, px - hw * 0.78, fy, px + hw * 0.78, fy + pl.skew * 0.78);
          }
        }
      }
      continue;
    }

    // 5. Desert Dunes & Olive Scrub Tufts (cover === 4)
    if (cover === 4 && doDunes) {
      if (!isHill) {
        const dShift = (cellHash(i, 8) - 0.5) * 0.18 * R;
        for (let d = -1; d <= 1; d += 2) {
          const dy = cy + d * R * 0.20 + dShift * d;
          const dw = R * (0.34 + 0.12 * cellHash(i, d + 20));
          duneCrests.push(cx - dw + dShift, dy + R * 0.06, cx + dShift, dy - R * 0.12, cx + dw + dShift, dy + R * 0.05);
          duneTroughs.push(cx - dw * 0.85 + dShift, dy + R * 0.12, cx + dShift + R * 0.04, dy - R * 0.04, cx + dw * 0.92 + dShift, dy + R * 0.11);
        }
      }
      const nScrub = zoom >= 0.75 ? 4 : 2;
      for (let s = 0; s < nScrub; s++) {
        const ang = s * 2.1 + cellHash(i, s + 14) * 1.6;
        const rad = R * (0.16 + 0.38 * cellHash(i, s + 27));
        const sx = cx + Math.cos(ang) * rad;
        const sy = cy + Math.sin(ang) * rad * 0.80 + R * 0.06;
        const sr = R * (0.042 + 0.026 * cellHash(i, s + 41));
        scrubShadow.push(sx + sr * 0.55, sy + sr * 0.45, sr * 1.05);
        scrubBody.push(sx, sy, sr);
        scrubLit.push(sx - sr * 0.25, sy - sr * 0.25, sr * 0.62);
      }
      continue;
    }

    // 6. Wetland Marsh Pools & Reeds (cover === 8)
    if (cover === 8 && doWet) {
      wetPools.push(cx - R * 0.10, cy + R * 0.04, R * 0.36, R * 0.15);
      wetPools.push(cx + R * 0.18, cy - R * 0.18, R * 0.22, R * 0.10);
      pushLine(wetGlint, cx - R * 0.24, cy + R * 0.03, cx + R * 0.04, cy + R * 0.03);
      pushLine(wetGlint, cx + R * 0.10, cy - R * 0.18, cx + R * 0.26, cy - R * 0.18);
      if (zoom >= 0.65) {
        const rx = cx - R * 0.28;
        const ry = cy + R * 0.04;
        pushLine(wetReeds, rx, ry, rx - R * 0.04, ry - R * 0.18);
        pushLine(wetReeds, rx + R * 0.05, ry, rx + R * 0.07, ry - R * 0.20);
        pushLine(wetReeds, cx + R * 0.24, cy + R * 0.12, cx + R * 0.28, cy - R * 0.08);
      }
      continue;
    }

    // 7. Meadow Grass Tufts (cover === 5)
    if (cover === 5 && doGrass && !isHill) {
      for (let g = 0; g < 3; g++) {
        const gx = cx + (cellHash(i, g * 2 + 1) - 0.5) * R * 0.72;
        const gy = cy + (cellHash(i, g * 2 + 2) - 0.5) * R * 0.62;
        const bh = R * 0.11;
        pushLine(grassTufts, gx, gy, gx - bh * 0.5, gy - bh * 0.9);
        pushLine(grassTufts, gx, gy, gx + bh * 0.45, gy - bh);
      }
    }
  }

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const fillTris = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 6 * 280;
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

  const fillQuads = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 8 * 250;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 8) {
        ctx.moveTo(arr[i], arr[i + 1]);
        ctx.lineTo(arr[i + 2], arr[i + 3]);
        ctx.lineTo(arr[i + 4], arr[i + 5]);
        ctx.lineTo(arr[i + 6], arr[i + 7]);
        ctx.closePath();
      }
      ctx.fill();
    }
  };

  const fillDomes = (arr, litColor, darkColor, outlineColor, alpha, lw) => {
    if (!arr.length) return;
    const step = 4 * 240;
    for (let off = 0; off < arr.length; off += step) {
      const end = Math.min(arr.length, off + step);
      // 1. Whole smooth hill dome in lit tone (bell height h = ry)
      ctx.globalAlpha = alpha;
      ctx.fillStyle = litColor;
      ctx.beginPath();
      for (let i = off; i < end; i += 4) {
        const mx = arr[i], my = arr[i + 1], rx = arr[i + 2], h = arr[i + 3];
        ctx.moveTo(mx - rx, my);
        ctx.quadraticCurveTo(mx, my - h * 2.0, mx + rx, my);
        ctx.quadraticCurveTo(mx, my + h * 0.18, mx - rx, my);
        ctx.closePath();
      }
      ctx.fill();

      // 2. Seamless De Casteljau SE shaded half-slope (exact sub-curve from apex to right toe)
      ctx.fillStyle = darkColor;
      ctx.beginPath();
      for (let i = off; i < end; i += 4) {
        const mx = arr[i], my = arr[i + 1], rx = arr[i + 2], h = arr[i + 3];
        ctx.moveTo(mx, my - h);
        ctx.quadraticCurveTo(mx + rx * 0.5, my - h, mx + rx, my);
        ctx.quadraticCurveTo(mx + rx * 0.45, my + h * 0.12, mx - rx * 0.05, my + h * 0.09);
        ctx.quadraticCurveTo(mx + rx * 0.14, my - h * 0.42, mx, my - h);
        ctx.closePath();
      }
      ctx.fill();

      // 3. Soft crest outline matching the exact quadratic arch
      if (doOutlines) {
        ctx.globalAlpha = 0.24 * alphaScale;
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = lw;
        ctx.beginPath();
        for (let i = off; i < end; i += 4) {
          const mx = arr[i], my = arr[i + 1], rx = arr[i + 2], h = arr[i + 3];
          ctx.moveTo(mx - rx, my);
          ctx.quadraticCurveTo(mx, my - h * 2.0, mx + rx, my);
        }
        ctx.stroke();
      }
    }
  };

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

  const fillEllipses = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 4 * 240;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 4) {
        const x = arr[i];
        const y = arr[i + 1];
        const rx = arr[i + 2];
        const ry = arr[i + 3];
        ctx.moveTo(x + rx, y);
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  };

  const fillRects = (arr, color, alpha) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    const step = 4 * 300;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 4) {
        ctx.rect(arr[i], arr[i + 1], arr[i + 2], arr[i + 3]);
      }
      ctx.fill();
    }
  };

  const strokeLines = (arr, color, alpha, lw) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    const step = 4 * 320;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 4) {
        ctx.moveTo(arr[i], arr[i + 1]);
        ctx.lineTo(arr[i + 2], arr[i + 3]);
      }
      ctx.stroke();
    }
  };

  const strokeQuads = (arr, color, alpha, lw) => {
    if (!arr.length) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    const step = 6 * 280;
    for (let off = 0; off < arr.length; off += step) {
      ctx.beginPath();
      const end = Math.min(arr.length, off + step);
      for (let i = off; i < end; i += 6) {
        ctx.moveTo(arr[i], arr[i + 1]);
        ctx.quadraticCurveTo(arr[i + 2], arr[i + 3], arr[i + 4], arr[i + 5]);
      }
      ctx.stroke();
    }
  };

  // Floor ground details first
  fillQuads(cropPlotGold, '#c9be64', 0.58 * alphaScale);
  fillQuads(cropPlotGreen, '#7aa44a', 0.58 * alphaScale);
  fillQuads(cropPlotEarth, '#b39d66', 0.56 * alphaScale);
  strokeLines(cropFurrows, '#e9e0a6', 0.42 * alphaScale, Math.max(0.45, 0.8 / zoom));

  strokeQuads(duneTroughs, '#947c4e', 0.42 * alphaScale, Math.max(0.8, 1.35 / Math.sqrt(zoom)));
  strokeQuads(duneCrests, '#efe0b4', 0.48 * alphaScale, Math.max(0.7, 1.15 / Math.sqrt(zoom)));
  fillCircles(scrubShadow, '#5a4e32', 0.34 * alphaScale);
  fillCircles(scrubBody, '#5f733f', 0.86 * alphaScale);
  fillCircles(scrubLit, '#7b9254', 0.86 * alphaScale);

  fillEllipses(wetPools, '#2a6f82', 0.68 * alphaScale);
  strokeLines(wetGlint, '#8cdceb', 0.55 * alphaScale, Math.max(0.55, 0.9 / Math.sqrt(zoom)));
  strokeLines(wetReeds, '#356847', 0.72 * alphaScale, Math.max(0.5, 0.85 / zoom));
  strokeLines(grassTufts, '#b2c87e', 0.62 * alphaScale, Math.max(0.6, 1.0 / zoom));

  // Smooth Rolling Hills (Layer 0 back -> Layer 1 front)
  const hillLineW = Math.max(0.45, 0.8 / Math.sqrt(zoom));
  for (let lyr = 0; lyr <= 1; lyr++) {
    fillEllipses(hShadow[lyr], '#1c2416', 0.16 * alphaScale);
    fillDomes(hDesertDomes[lyr], '#cebc8c', '#a39164', '#4d4128', 0.90 * alphaScale, hillLineW);
    fillDomes(hGreenDomes[lyr], '#95b068', '#6e884b', '#2f3c1e', 0.90 * alphaScale, hillLineW);
    fillDomes(hForestDomes[lyr], '#588859', '#3b633f', '#1e301e', 0.90 * alphaScale, hillLineW);
  }

  // Mountains (Layer 0 back foothills -> Layer 1 foreground main peaks)
  const peakLineW = Math.max(0.55, 0.95 / Math.sqrt(zoom));
  for (let lyr = 0; lyr <= 1; lyr++) {
    fillTris(mShadow[lyr], '#0e161e', 0.28 * alphaScale);
    fillTris(mAridLeft[lyr], '#b6a688', 0.95 * alphaScale);
    fillTris(mAridRight[lyr], '#615645', 0.95 * alphaScale);
    fillTris(mGreenLeft[lyr], '#899982', 0.95 * alphaScale);
    fillTris(mGreenRight[lyr], '#485746', 0.95 * alphaScale);
    fillTris(mSnowLeft[lyr], '#8698a5', 0.96 * alphaScale);
    fillTris(mSnowRight[lyr], '#42505d', 0.96 * alphaScale);
    fillQuads(mCapLit[lyr], '#f7fbff', 0.98 * alphaScale);
    fillQuads(mCapShade[lyr], '#c4d8e8', 0.98 * alphaScale);
    strokeLines(mOutlines[lyr], '#1b242c', 0.40 * alphaScale, peakLineW);
  }

  // Forests (sorted top-to-bottom per hex)
  fillEllipses(treeShadow, '#0f2213', 0.36 * alphaScale);
  fillRects(treeTrunks, '#5c3f26', 0.92 * alphaScale);
  fillTris(pineLowerL, '#387646', 0.96 * alphaScale);
  fillTris(pineLowerR, '#1a442a', 0.96 * alphaScale);
  fillTris(pineUpperL, '#4c9056', 0.96 * alphaScale);
  fillTris(pineUpperR, '#215231', 0.96 * alphaScale);
  fillCircles(broadShade, '#235230', 0.94 * alphaScale);
  fillCircles(broadMid, '#3b7948', 0.94 * alphaScale);
  fillCircles(broadCrown, '#5b9d5e', 0.94 * alphaScale);

  ctx.restore();
}
