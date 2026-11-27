import {
  COVER_LABELS,
  DISTRICT_META,
  cellXY,
  escHtml,
  fmtPop,
  getGridMetrics,
  getNeighborCells,
  hexCornerPoints,
  inspectHexCell,
} from "./data.js";

/**
 * Map overlay for Civilization-style City & Province View:
 * - Dims everything outside the active footprint
 * - Draws a glowing provincial-color border around footprint edges
 * - Shows land use + estimated population inside hexes when zoomed in
 * - Renders Civ District Hex Plaques around the city center (including dual Campuses for Beijing)
 * - Highlights local wonders, power plants, mines, ports, airports & military bases + ping ripples
 * - Provides rich hex & plaque hover tooltips
 */
export function createCityViewMapLayer(app) {
  const state = {
    active: false,
    entity: null,
    footprint: null,
    plaques: [],
    assets: [],
    hoveredDistrictIdx: -1,
    hoveredAssetUid: null,
    ping: null, // { x, y, startMs, color, label }
    lastTooltipCell: -1,
    rafId: 0,
  };

  function setTarget(entity, footprint, plaques, assets) {
    state.active = Boolean(entity && footprint);
    state.entity = entity;
    state.footprint = footprint;
    state.plaques = plaques || [];
    state.assets = assets || [];
    state.hoveredDistrictIdx = -1;
    state.hoveredAssetUid = null;
    app.requestDraw?.();
  }

  function clear() {
    state.active = false;
    state.entity = null;
    state.footprint = null;
    state.plaques = [];
    state.assets = [];
    state.ping = null;
    state.hoveredDistrictIdx = -1;
    state.hoveredAssetUid = null;
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

  // Resolve world<->screen conversion compatibly with fe-engine's camera & overlay conventions
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

    if (typeof cam.worldToScreen === "function") {
      return {
        scale: Number(cam.zoom || 1),
        cssW,
        cssH,
        toScreen: (wx, wy) => cam.worldToScreen(wx, wy),
      };
    }

    const { k, cx, cy } = getCameraScale(cam, cssW, cssH);
    return {
      scale: k,
      cssW,
      cssH,
      toScreen: (wx, wy) => ({
        x: (wx - cx) * k + cssW / 2,
        y: (wy - cy) * k + cssH / 2,
      }),
    };
  }

  function traceBoundarySegments(cellSet, grid) {
    // Edge k connects corner k and corner (k+1)%6.
    // Match pointy-top neighbor directions (E, SE, SW, W, NW, NE) to corners:
    // corners k=0..5 have angles 30, 90, 150, 210, 270, 330 deg
    // Edge 0 (30->90): SE (dir 1)
    // Edge 1 (90->150): SW (dir 2)
    // Edge 2 (150->210): W (dir 3)
    // Edge 3 (210->270): NW (dir 4)
    // Edge 4 (270->330): NE (dir 5)
    // Edge 5 (330->30): E (dir 0)
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
          segments.push([a[0], a[1], b[0], b[1]]);
        }
      }
    }
    return segments;
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
    const fp = state.footprint;

    ctx.save();

    // 1. Dim everything outside the active footprint using evenodd clipping
    ctx.save();
    ctx.beginPath();
    ctx.rect(-20, -20, proj.cssW + 40, proj.cssH + 40);
    for (const cell of fp.cellList) {
      const pt = cellXY(cell, grid);
      const corners = hexCornerPoints(pt.x, pt.y, grid.R);
      for (let k = 0; k < 6; k++) {
        const sp = proj.toScreen(corners[k][0], corners[k][1]);
        if (k === 0) ctx.moveTo(sp.x, sp.y);
        else ctx.lineTo(sp.x, sp.y);
      }
      ctx.closePath();
    }
    ctx.clip("evenodd");
    ctx.fillStyle = "rgba(6, 13, 22, 0.56)";
    ctx.fillRect(0, 0, proj.cssW, proj.cssH);
    ctx.restore();

    // 2. Footprint internal subtle highlights + land use & population labels when zoomed in
    const showHexDetail = screenHexR >= 22;
    const showHexMicroText = screenHexR >= 30;
    for (const cell of fp.cellList) {
      const pt = cellXY(cell, grid);
      const sc = proj.toScreen(pt.x, pt.y);
      if (sc.x < -60 || sc.x > proj.cssW + 60 || sc.y < -60 || sc.y > proj.cssH + 60) continue;

      if (showHexDetail) {
        const corners = hexCornerPoints(pt.x, pt.y, grid.R);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const sp = proj.toScreen(corners[k][0], corners[k][1]);
          if (k === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        }
        ctx.closePath();
        ctx.strokeStyle = "rgba(236, 208, 142, 0.2)";
        ctx.lineWidth = 1;
        ctx.stroke();

        if (showHexMicroText) {
          const info = inspectHexCell(cell, app);
          if (info) {
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.font = "500 9.5px system-ui, -apple-system, sans-serif";
            ctx.fillStyle = "rgba(239, 228, 198, 0.88)";
            const shortCover = (info.coverName || "").split("/")[0].slice(0, 4);
            ctx.fillText(shortCover, sc.x, sc.y - 6);
            if (info.estPop != null) {
              ctx.font = "600 9.5px system-ui, -apple-system, sans-serif";
              ctx.fillStyle = "#ecd08e";
              ctx.fillText(fmtPop(info.estPop), sc.x, sc.y + 7);
            }
          }
        }
      }
    }

    // 3. Glowing provincial-color outer border
    const borderColor = state.entity?.color || "#ecd08e";
    const segments = traceBoundarySegments(fp.cells, grid);
    if (segments.length) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of segments) {
        const a = proj.toScreen(x1, y1);
        const b = proj.toScreen(x2, y2);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.shadowColor = borderColor;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = Math.max(3.5, Math.min(6, screenHexR * 0.16));
      ctx.stroke();

      ctx.shadowBlur = 0;
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
      const sp = proj.toScreen(a.x, a.y);
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
    const centerSc = proj.toScreen(fp.cx, fp.cy);
    const labelBoxes = [];

    for (const p of state.plaques) {
      const sp = proj.toScreen(p.x, p.y);
      const isHovered = state.hoveredDistrictIdx === p.index;
      const dMeta = p.meta || DISTRICT_META.campus;
      const corners = hexCornerPoints(p.x, p.y, grid.R * 0.92);

      // Tether line from city center to district plaque
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
        const cp = proj.toScreen(corners[k][0], corners[k][1]);
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

      // District Hex Emblem Crest
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
      ctx.lineWidth = isHovered ? 2.4 : 1.8;
      ctx.strokeStyle = isHovered ? "#fff7d6" : dMeta.color;
      ctx.shadowColor = dMeta.color;
      ctx.shadowBlur = isHovered ? 14 : 7;
      ctx.stroke();
      ctx.shadowBlur = 0;

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

    // 6. Animated Ping Ring when user hovers/clicks a Resource, Wonder, or District
    if (state.ping) {
      const elapsed = performance.now() - state.ping.startMs;
      const t = (elapsed % 900) / 900;
      const sp = proj.toScreen(state.ping.x, state.ping.y);
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
      if (state.lastTooltipCell !== -1) {
        state.lastTooltipCell = -1;
      }
      return;
    }

    const inFootprint = state.footprint.cells.has(cellIdx);
    const plaque = state.plaques.find((p) => p.cell === cellIdx);
    const asset = state.assets.find((a) => a.cell === cellIdx);
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
    const plaque = state.plaques.find((p) => p.cell === cellIdx) ||
      state.plaques.find((p) => Number.isFinite(wx) && Math.hypot(p.x - wx, p.y - wy) < 15);
    if (plaque) {
      pingAt(plaque.x, plaque.y, plaque.meta?.color || "#ecd08e", plaque.district?.name);
      return { kind: "district", index: plaque.index, plaque };
    }
    const asset = state.assets.find((a) => a.cell === cellIdx) ||
      state.assets.find((a) => Number.isFinite(wx) && Number.isFinite(a.x) && Math.hypot(a.x - wx, a.y - wy) < 12);
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
