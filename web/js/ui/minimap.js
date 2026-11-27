// Interactive China minimap with cached province silhouette and live camera viewport box

import { provinceColor } from '../color.js';

export function initMinimap(app) {
  const canvas = document.getElementById('minimap-canvas');
  const fitBtn = document.getElementById('minimap-fit');
  const coordsEl = document.getElementById('minimap-coords');
  if (!canvas) return null;

  const ctx = canvas.getContext('2d');
  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = canvas.width;
  bgCanvas.height = canvas.height;

  let mapBounds = { x0: 0, y0: 0, x1: 5000, y1: 4000, scale: 1, ox: 0, oy: 0 };

  function bakeBackground() {
    const w = app.w;
    if (!w) return;
    const b = w.chinaBounds;
    const pad = 120;
    const x0 = b.x0 - pad;
    const y0 = b.y0 - pad;
    const x1 = b.x1 + pad;
    const y1 = b.y1 + pad;

    const scale = Math.min(bgCanvas.width / (x1 - x0), bgCanvas.height / (y1 - y0));
    const ox = (bgCanvas.width - (x1 - x0) * scale) * 0.5;
    const oy = (bgCanvas.height - (y1 - y0) * scale) * 0.5;
    mapBounds = { x0, y0, x1, y1, scale, ox, oy };

    const bctx = bgCanvas.getContext('2d');
    bctx.fillStyle = '#091e34';
    bctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

    const step = 2; // sample every 2nd cell for crisp fast minimap
    const dotSize = Math.max(1.5, w.W * scale * 1.15);
    for (let r = 0; r < w.rows; r += step) {
      for (let c = 0; c < w.cols; c += step) {
        const i = r * w.cols + c;
        const ow = w.owner[i];
        if (ow === -1) continue;
        const sx = ox + (w.cxArr[i] - x0) * scale;
        const sy = oy + (w.cyArr[i] - y0) * scale;
        bctx.fillStyle = ow === -2 ? '#232c36' : provinceColor(ow);
        bctx.globalAlpha = ow === -2 ? 0.55 : 0.85;
        bctx.fillRect(sx, sy, dotSize, dotSize);
      }
    }
    bctx.globalAlpha = 1;
  }

  function draw() {
    ctx.drawImage(bgCanvas, 0, 0);
    if (!app.w) return;

    const vb = app.cam.viewBoundsWorld();
    const { x0, y0, scale, ox } = mapBounds;
    const rx = ox + (vb.x0 - x0) * scale;
    const ry = mapBounds.oy + (vb.y0 - y0) * scale;
    const rw = Math.max(6, (vb.x1 - vb.x0) * scale);
    const rh = Math.max(6, (vb.y1 - vb.y0) * scale);

    ctx.strokeStyle = '#ecd08e';
    ctx.lineWidth = 1.4;
    ctx.fillStyle = 'rgba(236, 208, 142, 0.14)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
  }

  function jumpToMinimapPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const wx = mapBounds.x0 + (mx - mapBounds.ox) / mapBounds.scale;
    const wy = mapBounds.y0 + (my - mapBounds.oy) / mapBounds.scale;
    app.cam.animateTo(wx, wy, app.cam.zoom, { duration: 180 });
  }

  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    jumpToMinimapPoint(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) jumpToMinimapPoint(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });

  fitBtn?.addEventListener('click', () => app.fitChina());

  app.on('hover', ({ cell }) => {
    if (!coordsEl) return;
    if (cell >= 0 && app.w && app.w.owner[cell] >= 0) {
      const st = app.state.states[app.w.owner[cell]];
      const elev = Math.round(app.w.elev?.[cell] || 0);
      coordsEl.textContent = `${st?.abbr || st?.name || ''} · ${elev}m`;
    } else {
      coordsEl.textContent = '25 km 六边形网格';
    }
  });

  return { bakeBackground, draw };
}
