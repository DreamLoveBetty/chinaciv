import {
  DISTRICT_META,
  cellXY,
  escHtml,
  fmtPop,
  getGridMetrics,
  getNeighborCells,
  hexCornerPoints,
  inspectHexCell,
} from "./data.js";
import { isElevation25D, elevLiftKm } from "../../render/art/elevation25d.js?v=20261127-5";

function getLiftKm(w, cellIdx, is25D) {
  if (!is25D || !w?.elev || cellIdx == null || cellIdx < 0 || cellIdx >= w.elev.length) return 0;
  return elevLiftKm(w.elev[cellIdx]);
}

function liftAtXY(w, x, y, cellHint, is25D) {
  if (!is25D || !w) return 0;
  const cell = cellHint != null && cellHint >= 0
    ? cellHint
    : typeof w.cellAt === "function"
      ? w.cellAt(x, y)
      : -1;
  return getLiftKm(w, cell, is25D);
}

/**
 * Map overlay for Civilization-style City & Province View:
 * - Precomputes boundary segments & hex metadata once in setTarget()
 * - Viewport-culls & batches internal hex borders and evenodd backdrop cutouts
 * - Replaces expensive shadowBlur passes with crisp multi-pass translucent strokes
 * - Guarded hover tooltip with zero-reflow moveTooltip on sub-hex motion
 */
export function createCityViewMapLayer(app) {
  const state = {
    active: false,
    entity: null,
    footprint: null,
    boundarySegments: [],
    cellCoords: [], // [{ cell, x, y, shortCover, popTxt }]
    plaqueCells: new Map(),
    assetCells: new Map(),
    plaques: [],
    assets: [],
    hoveredDistrictIdx: -1,
    hoveredAssetUid: null,
    ping: null,
    lastTooltipCell: -1,
    rafId: 0,
  };

  function traceBoundarySegments(cellSet, grid) {
    const dirForCornerEdge = [1, 2, 3, 4, 5, 0];
    const segments = [];
    for (const cell of cellSet) {
      const p = cellXY(cell, grid);
      const corners = hexCornerPoints(p.x, p.y, grid.R);
      const nbrs = getNeighborCells(cell, grid);
      for (let k = 0; k < 6; k++) {
        const nb = nbrs[dirForCornerEdge[k]];
        if (nb < 0 || !cellSet.has(nb)) {
          const a = corners[k];
          const b = corners[(k + 1) % 6];
          segments.push(a[0], a[1], b[0], b[1], cell);
        }
      }
    }
    return new Float32Array(segments);
  }

  function setTarget(entity, footprint, plaques, assets) {
    state.active = Boolean(entity && footprint);
    state.entity = entity;
    state.footprint = footprint;
    state.plaques = plaques || [];
    state.assets = assets || [];
    state.hoveredDistrictIdx = -1;
    state.hoveredAssetUid = null;
    state.lastTooltipCell = -1;

    state.plaqueCells = new Map();
    for (const p of state.plaques) {
      if (p.cell >= 0 && !state.plaqueCells.has(p.cell)) state.plaqueCells.set(p.cell, p);
    }
    state.assetCells = new Map();
    for (const a of state.assets) {
      if (a.cell >= 0 && !state.assetCells.has(a.cell)) state.assetCells.set(a.cell, a);
    }

    const w = app?.w;
    if (state.active && footprint && w) {
      const grid = getGridMetrics(w);
      state.boundarySegments = traceBoundarySegments(footprint.cells, grid);
      state.cellCoords = footprint.cellList.map((cell) => {
        const pt = cellXY(cell, grid);
        const info = inspectHexCell(cell, app);
        return {
          cell,
          x: pt.x,
          y: pt.y,
          shortCover: info ? (info.coverName || "").split("/")[0].slice(0, 4) : "",
          popTxt: info && info.estPop != null ? fmtPop(info.estPop) : "",
        };
      });
    } else {
      state.boundarySegments = [];
      state.cellCoords = [];
    }

    app.requestDraw?.();
  }

  function clear() {
    state.active = false;
    state.entity = null;
    state.footprint = null;
    state.boundarySegments = [];
    state.cellCoords = [];
    state.plaqueCells = new Map();
    state.assetCells = new Map();
    state.plaques = [];
    state.assets = [];
    state.ping = null;
    state.hoveredDistrictIdx = -1;
    state.hoveredAssetUid = null;
    state.lastTooltipCell = -1;
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
    app.requestDraw?.();
  }

  function pingAt(x, y, color = "#ecd08e", label = "") {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    state.ping = { x, y, startMs: performance.now(), color, label };
    const tick = () => {
      if (!state.ping || !state.active) {
        state.rafId = 0;
        return;
      }
      const elapsed = performance.now() - state.ping.startMs;
      app.requestDraw?.();
      if (elapsed < 1800) {
        state.rafId = requestAnimationFrame(tick);
      } else {
        state.ping = null;
        state.rafId = 0;
        app.requestDraw?.();
      }
    };
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(tick);
  }

  function setHoveredDistrict(idx) {
    state.hoveredDistrictIdx = idx;
    app.requestDraw?.();
  }

  function setHoveredAsset(uid) {
    state.hoveredAssetUid = uid;
    app.requestDraw?.();
  }

  function getCameraScale(cam, canvasWidth, canvasHeight) {
    const k = Number(cam?.k ?? cam?.zoom ?? cam?.scale ?? 1);
    const cx = Number(cam?.x ?? cam?.cx ?? 0);
    const cy = Number(cam?.y ?? cam?.cy ?? 0);
    return { k, cx, cy, w: canvasWidth, h: canvasHeight };
  }

  function makeProjector(ctx, wArg, camArg) {
    const cam = camArg || app.cam || {};
    const canvas = ctx?.canvas;
    const dpr = Number(cam.dpr || (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1);
    const cssW = Number(cam.width || (canvas ? canvas.width / dpr : 1440));
    const cssH = Number(cam.height || (canvas ? canvas.height / dpr : 900));
    const is25D = isElevation25D(app?.state);
    const yScale = Number.isFinite(cam.yScale) ? cam.yScale : 1;

    if (typeof cam.worldToScreen === "function") {
      const c = typeof cam.viewportCenterScreen === "function"
        ? cam.viewportCenterScreen()
        : { sx: cssW * 0.5, sy: cssH * 0.5 };
      const k = Number(cam.zoom || 1);
      const cx = Number(cam.x || 0);
      const cy = Number(cam.y || 0);
      return {
        scale: k,
        yScale,
        is25D,
        cssW,
        cssH,
        toScreen: (wx, wy, liftKm = 0) => ({
          x: c.sx + (wx - cx) * k,
          y: c.sy + (wy - liftKm - cy) * k * yScale,
        }),
      };
    }

    const { k, cx, cy } = getCameraScale(cam, cssW, cssH);
    return {
      scale: k,
      yScale,
      is25D,
      cssW,
      cssH,
      toScreen: (wx, wy, liftKm = 0) => ({
        x: (wx - cx) * k + cssW / 2,
        y: (wy - liftKm - cy) * k * yScale + cssH / 2,
      }),
    };
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawBackdrop(ctx, wArg, camArg) {
    if (!state.active || !state.footprint || !(wArg || app?.w)) return;
    const w = wArg || app.w;
    const grid = getGridMetrics(w);
    const proj = makeProjector(ctx, w, camArg);
    const screenHexR = grid.R * proj.scale;
    const corners = w.corners || hexCornerPoints(0, 0, grid.R);
    const padPx = screenHexR * 1.5;

    ctx.save();

    // Collect viewport-visible footprint cells once for both backdrop cutout & internal hex grid
    const visible = [];
    for (let i = 0; i < state.cellCoords.length; i++) {
      const item = state.cellCoords[i];
      const sc = proj.toScreen(item.x, item.y, liftAtXY(w, item.x, item.y, item.cell, proj.is25D));
      if (sc.x < -padPx || sc.x > proj.cssW + padPx || sc.y < -padPx || sc.y > proj.cssH + padPx) {
        continue;
      }
      visible.push({ item, sx: sc.x, sy: sc.y });
    }

    // 1. Dim everything outside the active footprint using viewport-culled evenodd clipping
    ctx.save();
    ctx.beginPath();
    ctx.rect(-20, -20, proj.cssW + 40, proj.cssH + 40);
    for (let i = 0; i < visible.length; i++) {
      const { sx, sy } = visible[i];
      ctx.moveTo(sx + corners[0][0] * proj.scale, sy + corners[0][1] * proj.scale * proj.yScale);
      for (let k = 1; k < 6; k++) {
        ctx.lineTo(sx + corners[k][0] * proj.scale, sy + corners[k][1] * proj.scale * proj.yScale);
      }
      ctx.closePath();
    }
    ctx.clip("evenodd");
    ctx.fillStyle = "rgba(6, 13, 22, 0.56)";
    ctx.fillRect(0, 0, proj.cssW, proj.cssH);
    ctx.restore();

    // 2. Footprint internal subtle highlights (batched) + land use & population labels when zoomed in
    const showHexDetail = screenHexR >= 22;
    const showHexMicroText = screenHexR >= 30;
    if (showHexDetail && visible.length) {
      ctx.beginPath();
      for (let i = 0; i < visible.length; i++) {
        const { sx, sy } = visible[i];
        ctx.moveTo(sx + corners[0][0] * proj.scale, sy + corners[0][1] * proj.scale * proj.yScale);
        for (let k = 1; k < 6; k++) {
          ctx.lineTo(sx + corners[k][0] * proj.scale, sy + corners[k][1] * proj.scale * proj.yScale);
        }
        ctx.closePath();
      }
      ctx.strokeStyle = "rgba(236, 208, 142, 0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (showHexMicroText) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "500 9.5px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "rgba(239, 228, 198, 0.88)";
        for (let i = 0; i < visible.length; i++) {
          const { item, sx, sy } = visible[i];
          if (item.shortCover) ctx.fillText(item.shortCover, sx, sy - 6);
        }
        ctx.font = "600 9.5px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "#ecd08e";
        for (let i = 0; i < visible.length; i++) {
          const { item, sx, sy } = visible[i];
          if (item.popTxt) ctx.fillText(item.popTxt, sx, sy + 7);
        }
      }
    }

    // 3. Glowing provincial-color outer border (precomputed segments + fast multi-stroke aura instead of shadowBlur)
    const borderColor = state.entity?.color || "#ecd08e";
    const segs = state.boundarySegments;
    if (segs && segs.length) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (let k = 0; k < segs.length; k += 5) {
        const lift = getLiftKm(w, segs[k + 4], proj.is25D);
        const a = proj.toScreen(segs[k], segs[k + 1], lift);
        const b = proj.toScreen(segs[k + 2], segs[k + 3], lift);
        if (
          (a.x < -30 && b.x < -30) ||
          (a.x > proj.cssW + 30 && b.x > proj.cssW + 30) ||
          (a.y < -30 && b.y < -30) ||
          (a.y > proj.cssH + 30 && b.y > proj.cssH + 30)
        ) {
          continue;
        }
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      const coreW = Math.max(3.2, Math.min(5.5, screenHexR * 0.16));
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = coreW + 6;
      ctx.stroke();

      ctx.globalAlpha = 0.92;
      ctx.lineWidth = coreW;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff4d2";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function drawPlaquesAndAssets(ctx, wArg, camArg) {
    if (!state.active || !state.footprint || !(wArg || app?.w)) return;
    const w = wArg || app.w;
    const grid = getGridMetrics(w);
    const proj = makeProjector(ctx, w, camArg);
    const screenHexR = grid.R * proj.scale;
    const fp = state.footprint;

    ctx.save();

    // 4. Local wonders, power plants, mines, ports, airports & military bases
    const assetMarkers = [];
    for (const a of state.assets) {
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
      const sp = proj.toScreen(a.x, a.y, liftAtXY(app?.w, a.x, a.y, a.cell, proj.is25D));
      if (sp.x < -30 || sp.x > proj.cssW + 30 || sp.y < -30 || sp.y > proj.cssH + 30) continue;
      const isHovered = state.hoveredAssetUid === a.uid;
      assetMarkers.push({ a, sp, isHovered });
    }

    for (const { a, sp, isHovered } of assetMarkers) {
      const r = isHovered ? 12 : a.group === "wonder" ? 9.5 : 7.5;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fillStyle = a.group === "wonder"
        ? "rgba(88, 28, 135, 0.88)"
        : a.group === "military"
          ? "rgba(127, 29, 29, 0.88)"
          : a.group === "infra"
            ? "rgba(8, 76, 97, 0.88)"
            : "rgba(30, 41, 59, 0.88)";
      ctx.fill();
      ctx.lineWidth = isHovered ? 2.2 : 1.3;
      ctx.strokeStyle = isHovered ? "#fff8d6" : a.group === "wonder" ? "#f5d0fe" : "#ecd08e";
      ctx.stroke();

      ctx.font = `${isHovered ? 13 : 10.5}px system-ui, Apple Color Emoji, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(a.icon, sp.x, sp.y + 0.5);

      if (isHovered || (a.group === "wonder" && screenHexR >= 16)) {
        const text = a.name;
        ctx.font = "600 10.5px system-ui, -apple-system, sans-serif";
        const tw = ctx.measureText(text).width + 10;
        drawRoundedRect(ctx, sp.x - tw / 2, sp.y + r + 3, tw, 16, 4);
        ctx.fillStyle = "rgba(12, 20, 30, 0.9)";
        ctx.fill();
        ctx.strokeStyle = "rgba(236, 208, 142, 0.65)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#f9efd6";
        ctx.fillText(text, sp.x, sp.y + r + 11.5);
      }
      ctx.restore();
    }

    // 5. Civ District Hex Plaques around city center
    const centerSc = proj.toScreen(fp.cx, fp.cy, liftAtXY(app?.w, fp.cx, fp.cy, fp.centerCell, proj.is25D));
    const labelBoxes = [];

    for (const p of state.plaques) {
      const pLift = liftAtXY(app?.w, p.x, p.y, p.cell, proj.is25D);
      const sp = proj.toScreen(p.x, p.y, pLift);
      const isHovered = state.hoveredDistrictIdx === p.index;
      const dMeta = p.meta || DISTRICT_META.campus;
      const corners = hexCornerPoints(p.x, p.y, grid.R * 0.92);

      // Tether line
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([4, 3]);
      ctx.moveTo(centerSc.x, centerSc.y);
      ctx.lineTo(sp.x, sp.y);
      ctx.strokeStyle = isHovered ? "#fff3c4" : "rgba(236, 208, 142, 0.45)";
      ctx.lineWidth = isHovered ? 2 : 1.2;
      ctx.stroke();
      ctx.restore();

      // Highlight hex fill for district
      ctx.save();
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const cp = proj.toScreen(corners[k][0], corners[k][1], pLift);
        if (k === 0) ctx.moveTo(cp.x, cp.y);
        else ctx.lineTo(cp.x, cp.y);
      }
      ctx.closePath();
      ctx.fillStyle = isHovered ? `${dMeta.color}55` : `${dMeta.color}33`;
      ctx.fill();
      ctx.lineWidth = isHovered ? 2.5 : 1.5;
      ctx.strokeStyle = isHovered ? "#fff8dc" : dMeta.color;
      ctx.stroke();
      ctx.restore();

      // District Hex Emblem Crest (fast halo ring instead of shadowBlur)
      const badgeR = isHovered ? 16 : 13.5;
      ctx.save();
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const ang = Math.PI / 6 + (k * Math.PI) / 3;
        const bx = sp.x + badgeR * Math.cos(ang);
        const by = sp.y + badgeR * Math.sin(ang);
        if (k === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.closePath();
      ctx.fillStyle = dMeta.bg;
      ctx.fill();
      ctx.globalAlpha = isHovered ? 0.35 : 0.2;
      ctx.lineWidth = isHovered ? 6 : 4;
      ctx.strokeStyle = dMeta.color;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isHovered ? 2.4 : 1.8;
      ctx.strokeStyle = isHovered ? "#fff7d6" : dMeta.color;
      ctx.stroke();

      ctx.font = `${isHovered ? 15 : 13}px system-ui, Apple Color Emoji, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.district.icon || dMeta.icon, sp.x, sp.y + 0.5);

      // District Plaque Pill Label with collision offset
      const label = p.district.name || dMeta.label;
      ctx.font = "600 11px system-ui, -apple-system, sans-serif";
      const tw = ctx.measureText(label).width + 12;
      const th = 18;
      let lx = sp.x - tw / 2;
      let ly = sp.y + badgeR + 4;

      for (let attempt = 0; attempt < 6; attempt++) {
        const collides = labelBoxes.some(
          (b) => !(lx + tw + 4 < b.x || lx > b.x + b.w + 4 || ly + th + 3 < b.y || ly > b.y + b.h + 3)
        );
        if (!collides) break;
        ly += attempt % 2 === 0 ? 20 : -38;
      }
      labelBoxes.push({ x: lx, y: ly, w: tw, h: th });

      drawRoundedRect(ctx, lx, ly, tw, th, 5);
      ctx.fillStyle = "rgba(13, 21, 31, 0.94)";
      ctx.fill();
      ctx.lineWidth = isHovered ? 1.6 : 1.1;
      ctx.strokeStyle = isHovered ? "#fff6d6" : dMeta.color;
      ctx.stroke();

      ctx.fillStyle = "#f9f1da";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx + tw / 2, ly + th / 2 + 0.5);
      ctx.restore();
    }

    // 6. Animated Ping Ring
    if (state.ping) {
      const elapsed = performance.now() - state.ping.startMs;
      const t = (elapsed % 900) / 900;
      const sp = proj.toScreen(
        state.ping.x,
        state.ping.y,
        liftAtXY(app?.w, state.ping.x, state.ping.y, state.ping.cell, proj.is25D),
      );
      const radius = 10 + t * 34;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = state.ping.color || "#ecd08e";
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 7, 0, Math.PI * 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = state.ping.color || "#ecd08e";
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  function handleHoverCell(cellIdx, pointerPos) {
    if (!state.active || !state.footprint || cellIdx == null || cellIdx < 0) {
      if (state.lastTooltipCell !== -1) state.lastTooltipCell = -1;
      return;
    }

    if (cellIdx === state.lastTooltipCell) {
      if (pointerPos && typeof app.ui?.moveTooltip === "function") {
        app.ui.moveTooltip(pointerPos.x, pointerPos.y);
      }
      return;
    }
    state.lastTooltipCell = cellIdx;

    const inFootprint = state.footprint.cells.has(cellIdx);
    const plaque = state.plaqueCells.get(cellIdx);
    const asset = state.assetCells.get(cellIdx);
    if (!inFootprint && !plaque && !asset) return;

    const info = inspectHexCell(cellIdx, app);
    if (!info) return;

    const parts = [];
    parts.push(`<div style="font-weight:700;color:#ecd08e;margin-bottom:3px">${escHtml(info.countyName || info.stateName)} <span style="font-weight:400;color:#b9ab88;font-size:11px">(${escHtml(info.stateName)})</span></div>`);
    parts.push(`<div style="font-size:11.5px;color:#dfd4b9">地貌: <b>${escHtml(info.coverName)}</b> · 海拔 <b>${info.elev}m</b></div>`);
    if (info.estPop != null) {
      parts.push(`<div style="font-size:11.5px;color:#dfd4b9">格网估算人口: <b style="color:#f5dc99">${escHtml(fmtPop(info.estPop))}</b></div>`);
    }
    if (plaque) {
      parts.push(`<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(201,164,92,0.3);color:${escHtml(plaque.meta.color)};font-weight:700">${escHtml(plaque.meta.icon)} ${escHtml(plaque.district.name)} (LQ ${Number(plaque.district.lq || 1).toFixed(2)})</div>`);
    }
    if (asset) {
      parts.push(`<div style="margin-top:3px;color:#bae6fd">${escHtml(asset.icon)} ${escHtml(asset.name)} · ${escHtml(asset.metric)}</div>`);
    }

    if (pointerPos && typeof app.ui?.showHtmlTooltip === "function") {
      app.ui.showHtmlTooltip(pointerPos.x, pointerPos.y, parts.join(""));
    }
  }

  function hitTestMapClick(wx, wy, cellIdx) {
    if (!state.active) return null;
    const w = app?.w;
    const is25D = isElevation25D(app?.state);
    const plaque = state.plaqueCells.get(cellIdx) ||
      state.plaques.find((p) => Number.isFinite(wx) && Math.hypot(p.x - wx, p.y - liftAtXY(w, p.x, p.y, p.cell, is25D) - wy) < 15);
    if (plaque) {
      pingAt(plaque.x, plaque.y, plaque.meta?.color || "#ecd08e", plaque.district?.name);
      return { kind: "district", index: plaque.index, plaque };
    }
    const asset = state.assetCells.get(cellIdx) ||
      state.assets.find((a) => Number.isFinite(wx) && Number.isFinite(a.x) && Math.hypot(a.x - wx, a.y - liftAtXY(w, a.x, a.y, a.cell, is25D) - wy) < 12);
    if (asset) {
      pingAt(asset.x, asset.y, "#ecd08e", asset.name);
      return { kind: "asset", uid: asset.uid, asset };
    }
    return null;
  }

  return {
    id: "cityview-overlay",
    order: 60,
    backdropOverlay: { id: "cityview-backdrop", order: 25, draw: drawBackdrop },
    plaquesOverlay: { id: "cityview-plaques", order: 60, draw: drawPlaquesAndAssets },
    state,
    setTarget,
    clear,
    pingAt,
    setHoveredDistrict,
    setHoveredAsset,
    handleHoverCell,
    hitTestMapClick,
    draw: drawPlaquesAndAssets,
  };
}
