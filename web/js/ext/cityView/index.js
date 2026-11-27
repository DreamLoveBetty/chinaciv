import { buildCityBadgeMap, ensureCityViewData, escHtml } from "./data.js";
import { createCityViewMapLayer } from "./mapLayer.js";
import { createCityViewScreen } from "./screen.js";

/**
 * ChinaCiv City & Province View Extension
 * Entry point loaded by ext/index.js -> install(app)
 */
export async function install(app) {
  ensureStylesheet("css/cityview.css");

  let topBtn = null;
  const mapLayer = createCityViewMapLayer(app);
  const screen = createCityViewScreen(app, mapLayer, {
    onOpened() {
      topBtn?.setActive?.(true);
    },
    onClosed() {
      topBtn?.setActive?.(Boolean(app.modes?.is?.("city") || screen.isDrawerOpen()));
    },
    onDrawerChange(isOpen) {
      topBtn?.setActive?.(Boolean(isOpen || app.modes?.is?.("city")));
    },
  });

  app.registerOverlay?.(mapLayer.backdropOverlay);
  app.registerOverlay?.(mapLayer.plaquesOverlay);

  app.modes?.register?.("city", {
    onExit({ next } = {}) {
      screen.clearDock();
      if (!next || next === "map") {
        screen.restoreCamera();
        app.clearSelection?.();
      }
      app.hash?.del?.(["view", "city", "province"]);
      topBtn?.setActive?.(false);
      app.requestDraw?.();
    },
    onEscape() {
      if (screen.isDrawerOpen()) {
        screen.closeDrawer();
        return true;
      }
      return false;
    },
  });

  // Load districts + populate cityBadges for zoomed-in city banners
  await ensureCityViewData(app);
  if (app.state) {
    app.state.cityBadges = {
      ...(app.state.cityBadges || {}),
      ...buildCityBadgeMap(app),
    };
  }

  // Register Topbar "34省视图" button
  topBtn = app.ui?.addTopButton?.({
    id: "cityview",
    label: "34省视图",
    icon: "city",
    title: "打开34个省级行政区与核心城市文明视图",
    onClick() {
      screen.toggleDrawer();
    },
  });

  // Hook into quick City & State panels (and direct city banner clicks)
  hookPanelsAndEvents(app, screen, mapLayer);

  // Hover tooltip integration for hexes inside active City View footprint
  const onHover = (payload) => {
    if (!app.modes?.is?.("city")) return;
    const cell = typeof payload === "number" ? payload : payload?.cell ?? app.state?.hoverCell;
    const pos = typeof payload === "object"
      ? payload?.pos || payload?.screen || (payload?.clientX != null ? { x: payload.clientX, y: payload.clientY } : null)
      : null;
    mapLayer.handleHoverCell(cell, pos);
  };
  app.on?.("hover", onHover);

  // Check URL hash on startup & hashchange (#city=<id>&view=city / #province=<code>&view=city)
  const syncFromHash = (skipIfTargetedBoot = false) => {
    const h = readHashParams(app);
    if (h.view === "city") {
      if (h.city) {
        if (!skipIfTargetedBoot) screen.open("city", h.city, { skipHash: true });
      } else if (h.province) {
        if (!skipIfTargetedBoot) screen.open("province", h.province, { skipHash: true });
      } else {
        screen.openDrawer();
      }
    }
  };
  app.on?.("hashchange", () => syncFromHash(false));
  app.on?.("hash:change", () => syncFromHash(false));
  app.hash?.register?.("view", () => syncFromHash(false));
  // On initial boot, main.js triggers selectCity/selectState if city/province is present;
  // only open drawer here if #view=city is present alone without city/province.
  syncFromHash(true);

  return {
    openCity: (id, opts) => screen.open("city", id, opts),
    openProvince: (codeOrIdx, opts) => screen.open("province", codeOrIdx, opts),
    openDrawer: () => screen.openDrawer(),
    close: (opts) => screen.close(opts),
  };
}

function ensureStylesheet(href) {
  if (typeof document === "undefined") return;
  const exists = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .some((l) => (l.getAttribute("href") || "").includes("cityview.css"));
  if (!exists) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }
}

function readHashParams(app) {
  if (typeof app?.hash?.all === "function") {
    const res = app.hash.all();
    if (res && typeof res === "object") return res;
  }
  const raw = (typeof location !== "undefined" ? location.hash : "").replace(/^#/, "");
  const params = new URLSearchParams(raw);
  return {
    view: params.get("view") || "",
    city: params.get("city") || "",
    province: params.get("province") || "",
  };
}

function injectQuickPanelCta(panelEl, kind, targetRef, app, screen) {
  if (!(panelEl instanceof HTMLElement)) return;
  // Remove previous CTA if re-rendering into same element
  panelEl.querySelectorAll(".cv-quick-cta-wrap").forEach((el) => el.remove());

  const wrap = document.createElement("div");
  wrap.className = "cv-quick-cta-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cv-quick-cta-btn";
  btn.textContent = kind === "city" ? "🏛️ 进入城市视图 ›" : "🏛️ 进入省级文明视图 ›";
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    screen.open(kind, targetRef);
  });
  wrap.appendChild(btn);

  if (kind === "province") {
    const cities = (app.data?.cities || app.state?.cities || [])
      .filter((c) => Number(c.province_idx) === Number(targetRef));
    if (cities.length) {
      const strip = document.createElement("div");
      strip.className = "cv-quick-city-pills";
      strip.innerHTML = cities.slice(0, 6).map((c) => (
        `<button type="button" class="cv-mini-city-btn" data-quick-city="${escHtml(c.id || c.name)}">${escHtml(c.name)} ›</button>`
      )).join("");
      strip.querySelectorAll("[data-quick-city]").forEach((cBtn) => {
        cBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          screen.open("city", cBtn.dataset.quickCity);
        });
      });
      wrap.appendChild(strip);
    }
  }

  panelEl.appendChild(wrap);
}

function hookPanelsAndEvents(app, screen, mapLayer) {
  const panels = app.panels;
  if (panels) {
    const origCity = typeof panels.city === "function" ? panels.city.bind(panels) : null;
    const origState = typeof panels.state === "function" ? panels.state.bind(panels) : null;

    panels.city = (city, ctx = {}) => {
      if (ctx?.openCityView || ctx?.direct || ctx?.source === "banner" || ctx?.fromBanner || app.modes?.is?.("city")) {
        return screen.open("city", city);
      }
      const res = origCity ? origCity(city, ctx) : undefined;
      queueMicrotask(() => {
        const el = panels.element || document.getElementById("quick-panel");
        if (el && !el.querySelector("#qp-enter-city")) {
          injectQuickPanelCta(el, "city", city, app, screen);
        }
      });
      return res;
    };

    panels.state = (idx, ctx = {}) => {
      if (ctx?.openCityView || ctx?.direct || app.modes?.is?.("city")) {
        return screen.open("province", idx);
      }
      const res = origState ? origState(idx, ctx) : undefined;
      queueMicrotask(() => {
        const el = panels.element || document.getElementById("quick-panel");
        if (el && !el.querySelector("#qp-enter-cityview")) {
          injectQuickPanelCta(el, "province", idx, app, screen);
        }
      });
      return res;
    };
  }

  // Listen to explicit quick-panel CTA events ("进入城市视图 ›" / "进入省级文明视图 ›")
  app.on?.("cityview:open", (payload) => {
    if (payload?.city) {
      screen.open("city", payload.city);
    } else if (payload?.stateIdx != null || payload?.state != null) {
      screen.open("province", payload.stateIdx ?? payload.state);
    }
  });

  // Listen to map clicks on District Hex Plaques or local Assets when City View is active
  app.on?.("mapclick", (payload) => {
    if (!app.modes?.is?.("city")) return;
    const hit = mapLayer.hitTestMapClick(payload?.wx, payload?.wy, payload?.cell);
    if (!hit) return;
    payload?.consume?.();
    if (hit.kind === "district") {
      screen.focusDistrictCard(hit.index);
    } else if (hit.kind === "asset") {
      screen.focusAssetCard(hit.uid);
    }
  });

  // Listen to selection events (only when panels didn't already open City View, e.g. silentPanel: true)
  const onSelectCity = (payload) => {
    const city = payload?.city || payload;
    const ctx = payload?.ctx || payload?.opts || {};
    if (ctx?.silentPanel && (ctx?.openCityView || ctx?.source === "banner" || ctx?.fromBanner || ctx?.direct)) {
      screen.open("city", city);
    }
  };
  const onSelectState = (payload) => {
    const idx = payload?.idx ?? payload?.province_idx ?? payload?.stateIdx ?? payload;
    const ctx = payload?.ctx || payload?.opts || {};
    if (ctx?.silentPanel && (ctx?.openCityView || ctx?.direct)) {
      screen.open("province", idx);
    }
  };
  app.on?.("select:city", onSelectCity);
  app.on?.("selectCity", onSelectCity);
  app.on?.("select:state", onSelectState);
  app.on?.("selectState", onSelectState);
}
