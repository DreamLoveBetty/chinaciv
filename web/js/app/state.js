// Central reactive application state and lightweight event bus

export function createEventBus() {
  const listeners = new Map();
  return {
    on(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
      return () => listeners.get(ev)?.delete(fn);
    },
    off(ev, fn) {
      listeners.get(ev)?.delete(fn);
    },
    emit(ev, payload) {
      const set = listeners.get(ev);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[app.emit:${ev}]`, err);
        }
      }
    },
  };
}

export function createInitialState() {
  return {
    cities: [],
    states: [],
    lens: null,          // null = 地形地貌 (Civ terrain), or lens object from lenses.json
    band: null,          // active legend band filter
    hoverCell: -1,
    selectedCity: null,
    selectedState: null, // 0..33 province index or null
    showResources: true,
    highlight: null,     // { cells, counties, states, cities, resources, bubbles, pulse, dimOthers, dim, color, border }
    resourceFilter: null,
    cityBadges: {},      // { [cityId]: "金融中心", ... }
    mode: 'map',
    layers: {
      rail: true,
      roads: false,
      hubs: true,
      military: false,
      wonders: true,
      trade: false,
    },
  };
}
