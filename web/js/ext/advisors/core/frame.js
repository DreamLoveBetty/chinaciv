// Viewport framing helpers so China and selected regions fit cleanly beside the left dock.

export function mapArea(app) {
  const cs = getComputedStyle(document.documentElement);
  const px = (name, fallback) => parseFloat(cs.getPropertyValue(name)) || fallback;
  const dockL = document.getElementById("dock-left")?.getBoundingClientRect().width || px("--dock-left", 0);
  const dockR = document.getElementById("dock-right")?.getBoundingClientRect().width || px("--dock-right", 0);
  const top = document.getElementById("topbar")?.getBoundingClientRect().height || px("--topbar-h", 48);
  const bot = document.getElementById("lens-dock")?.getBoundingClientRect().height || px("--lensdock-h", 54);
  const isMobile = window.innerWidth <= 700;
  return {
    x0: isMobile ? 12 : dockL + 16,
    y0: top + 12,
    x1: isMobile ? window.innerWidth - 12 : window.innerWidth - dockR - 16,
    y1: isMobile ? window.innerHeight - Math.min(window.innerHeight * 0.45, 320) : window.innerHeight - bot - 16,
  };
}

export function frameBox(app, x0, y0, x1, y1, opts = {}) {
  if (typeof app.fitBounds === "function") {
    app.fitBounds(x0, y0, x1, y1, { animate: true, padding: 36, ...opts });
    return;
  }
  const area = mapArea(app);
  const aw = Math.max(120, area.x1 - area.x0);
  const ah = Math.max(120, area.y1 - area.y0);
  const bw = Math.max(20, x1 - x0);
  const bh = Math.max(20, y1 - y0);
  const zoom = Math.min(aw / bw, ah / bh) * 0.9;
  const wx = (x0 + x1) / 2;
  const wy = (y0 + y1) / 2;
  if (app.cam?.animateTo) {
    app.cam.animateTo(wx, wy, zoom, { duration: opts.duration ?? 420 });
  } else if (app.cam) {
    app.cam.x = wx;
    app.cam.y = wy;
    app.cam.zoom = zoom;
  }
  app.requestDraw?.();
}

export function frameNation(app, opts = {}) {
  if (typeof app.fitChina === "function") {
    app.fitChina({ animate: true, ...opts });
    return;
  }
  const b = app.w?.chinaBounds;
  if (b) {
    frameBox(app, b.x0, b.y0, b.x1, b.y1, opts);
    return;
  }
  const g = app.w?.grid;
  if (!g) return;
  frameBox(app, 0, 0, g.cols * (g.W || 25), g.rows * (g.H_step || 21.65), opts);
}

export function worldToScreenPt(app, wx, wy) {
  const cam = app.cam;
  if (!cam) return { x: 0, y: 0 };
  if (typeof cam.worldToScreen === "function") {
    const p = cam.worldToScreen(wx, wy);
    return Array.isArray(p) ? { x: p[0], y: p[1] } : p;
  }
  if (typeof cam.toScreen === "function") {
    const p = cam.toScreen(wx, wy);
    return Array.isArray(p) ? { x: p[0], y: p[1] } : p;
  }
  return { x: wx, y: wy };
}

export function frameIfHidden(app, box) {
  if (!box) return;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const p = worldToScreenPt(app, cx, cy);
  const area = mapArea(app);
  if (p.x < area.x0 + 16 || p.x > area.x1 - 16 || p.y < area.y0 + 16 || p.y > area.y1 - 16) {
    frameBox(app, box.x0, box.y0, box.x1, box.y1, { maxZoom: app.cam?.zoom });
  }
}
