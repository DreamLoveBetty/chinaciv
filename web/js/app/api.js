// Assembles the frozen window.__app / extension API object

import { createEventBus, createInitialState } from './state.js';
import { createDataLoader } from './data.js?v=20261127-4';
import { createModeManager } from './modes.js';
import { createHashManager } from './hash.js';
import { createActions } from './actions.js';

export function createApp({ cam, renderer }) {
  const bus = createEventBus();
  const state = createInitialState();

  const app = {
    w: null,
    data: {
      world: null,
      geo_lookup: null,
      cities: null,
      states: null,
      nation: null,
      lenses: null,
      sources: null,
      resources: null,
      counties: null,
      districts: null,
      infrastructure: null,
      military: null,
      wonders: null,
      trade: null,
    },
    state,
    cam,
    on: bus.on,
    off: bus.off,
    emit: bus.emit,
    panels: {
      element: null,
      city() {},
      state() {},
      close() {},
    },
    ui: {
      addTopButton() { return null; },
      addMapToggle() {},
      setDock() { return null; },
      getDock() { return null; },
      closeDock() {},
      showToast() {},
      showHtmlTooltip() {},
      moveTooltip() {},
      hideTooltip() {},
    },
    layers: {
      toggle(id) {
        return app.setLayer(id, !app.getLayer(id));
      },
      isEnabled(id) {
        return app.getLayer(id);
      },
      setEnabled(id, b) {
        return app.setLayer(id, b);
      },
    },
    registerStaticLayer(layer) {
      return renderer.registerStaticLayer(layer);
    },
    registerOverlay(overlay) {
      return renderer.registerOverlay(overlay);
    },
    unregisterOverlay(id) {
      return renderer.unregisterOverlay?.(id);
    },
    openPedia() {},
    openYieldReport() {},
    openHelp() {},
  };

  const { loadData } = createDataLoader(app);
  app.loadData = loadData;
  app.hash = createHashManager(app);
  app.modes = createModeManager(app);

  const actions = createActions(app, renderer);
  Object.assign(app, actions);

  window.__app = app;
  return app;
}
