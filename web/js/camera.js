// 2D World Camera with smooth animation, cursor-anchored zoom, interaction state & dock-aware framing

export class Camera {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.x = 2400;
    this.y = 1900;
    this.zoom = 0.25; // pixels per km
    this.minZoom = opts.minZoom ?? 0.12;
    this.maxZoom = opts.maxZoom ?? 4.8;

    this.width = 1280;
    this.height = 720;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.dockLeft = 0;
    this.dockRight = 0;
    this.isInteracting = false;

    this._anim = null;
    this._settleTimer = null;
    this._pendingZoomSettle = false;
    this._onFrame = opts.onFrame || (() => {});
    this._onSettle = opts.onSettle || (() => {});
  }

  resize(cssWidth, cssHeight) {
    this.width = Math.max(1, cssWidth);
    this.height = Math.max(1, cssHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  setDocks(leftPx, rightPx) {
    this.dockLeft = Math.max(0, leftPx || 0);
    this.dockRight = Math.max(0, rightPx || 0);
  }

  /**
   * Screen center of the unobscured canvas viewport (respecting open left/right docks on desktop).
   */
  viewportCenterScreen() {
    const isNarrow = this.width <= 860;
    if (isNarrow) {
      return { sx: this.width * 0.5, sy: this.height * 0.44 };
    }
    const left = Math.min(this.dockLeft, this.width * 0.55);
    const right = Math.min(this.dockRight, this.width * 0.55);
    const availW = Math.max(200, this.width - left - right);
    return {
      sx: left + availW * 0.5,
      sy: this.height * 0.5,
    };
  }

  availableSize() {
    const isNarrow = this.width <= 860;
    if (isNarrow) {
      return { w: this.width, h: this.height * 0.55 };
    }
    return {
      w: Math.max(220, this.width - this.dockLeft - this.dockRight),
      h: this.height,
    };
  }

  worldToScreen(wx, wy) {
    const { sx, sy } = this.viewportCenterScreen();
    return {
      x: sx + (wx - this.x) * this.zoom,
      y: sy + (wy - this.y) * this.zoom,
    };
  }

  screenToWorld(sx, sy) {
    const c = this.viewportCenterScreen();
    return {
      x: this.x + (sx - c.sx) / this.zoom,
      y: this.y + (sy - c.sy) / this.zoom,
    };
  }

  viewBoundsWorld() {
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(this.width, this.height);
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  }

  panByScreen(dx, dy) {
    this._anim = null;
    this.isInteracting = true;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this._onFrame();
    this._scheduleSettle(110, false);
  }

  zoomAtScreen(sx, sy, factor, instant = false) {
    this._anim = null;
    const before = this.screenToWorld(sx, sy);
    const nextZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    if (Math.abs(nextZoom - this.zoom) < 1e-6) return;
    this.isInteracting = !instant;
    this.zoom = nextZoom;
    const c = this.viewportCenterScreen();
    this.x = before.x - (sx - c.sx) / this.zoom;
    this.y = before.y - (sy - c.sy) / this.zoom;
    this._onFrame();
    this._scheduleSettle(instant ? 0 : 140, true);
  }

  animateTo(targetX, targetY, targetZoom, opts = {}) {
    const clampedZoom = Math.max(this.minZoom, Math.min(this.maxZoom, targetZoom));
    clearTimeout(this._settleTimer);
    this._pendingZoomSettle = false;

    if (opts.instant || opts.duration === 0) {
      this._anim = null;
      this.isInteracting = false;
      const zoomed = Math.abs(clampedZoom - this.zoom) > 1e-4;
      this.x = targetX;
      this.y = targetY;
      this.zoom = clampedZoom;
      this._onFrame();
      this._onSettle({ zoomed });
      return;
    }

    const duration = opts.duration ?? 420;
    const startX = this.x;
    const startY = this.y;
    const startZ = this.zoom;
    const zoomed = Math.abs(clampedZoom - startZ) > 1e-4;
    const t0 = performance.now();

    this.isInteracting = true;
    this._anim = {
      t0,
      duration,
      startX,
      startY,
      startZ,
      targetX,
      targetY,
      targetZ: clampedZoom,
    };

    const tick = (now) => {
      if (!this._anim) return;
      const u = Math.min(1, (now - this._anim.t0) / this._anim.duration);
      const ease = 1 - Math.pow(1 - u, 3);
      this.x = startX + (targetX - startX) * ease;
      this.y = startY + (targetY - startY) * ease;
      // Log interpolation of zoom feels natural
      this.zoom = startZ * Math.pow(clampedZoom / startZ, ease);
      this._onFrame();
      if (u < 1) {
        requestAnimationFrame(tick);
      } else {
        this._anim = null;
        this.isInteracting = false;
        this._onSettle({ zoomed });
      }
    };
    requestAnimationFrame(tick);
  }

  fitBounds(x0, y0, x1, y1, opts = {}) {
    const pad = opts.padding ?? 36;
    const avail = this.availableSize();
    const bw = Math.max(40, x1 - x0);
    const bh = Math.max(40, y1 - y0);
    const zx = Math.max(0.05, (avail.w - pad * 2) / bw);
    const zy = Math.max(0.05, (avail.h - pad * 2) / bh);
    let targetZoom = Math.min(zx, zy);
    if (opts.maxZoom) targetZoom = Math.min(targetZoom, opts.maxZoom);
    if (opts.minZoom) targetZoom = Math.max(targetZoom, opts.minZoom);
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    this.animateTo(cx, cy, targetZoom, opts);
  }

  _scheduleSettle(ms, zoomed = false) {
    clearTimeout(this._settleTimer);
    if (zoomed) this._pendingZoomSettle = true;
    if (ms <= 0) {
      this.isInteracting = false;
      const z = this._pendingZoomSettle;
      this._pendingZoomSettle = false;
      this._onSettle({ zoomed: z });
      return;
    }
    this._settleTimer = setTimeout(() => {
      this.isInteracting = false;
      const z = this._pendingZoomSettle;
      this._pendingZoomSettle = false;
      this._onSettle({ zoomed: z });
    }, ms);
  }
}
