// Data loading, caching, and defensive schema normalization

const DATA_FILES = {
  world: 'data/world.json?v=20261127-4',
  backdrop: 'data/world_backdrop.json?v=20261128-4',
  geo_lookup: 'data/geo_lookup.json',
  nation: 'data/nation.json',
  states: 'data/states.json',
  cities: 'data/cities.json',
  counties: 'data/counties.json?v=20261127-4',
  districts: 'data/districts.json',
  lenses: 'data/lenses.json?v=20261127-4',
  sources: 'data/sources.json?v=20261127-4',
  resources: 'data/resources.json',
  infrastructure: 'data/infrastructure.json',
  military: 'data/military.json',
  wonders: 'data/wonders.json',
  trade: 'data/trade.json',
};

export const LENS_GROUPS_DEFAULT = [
  { id: 'people', label: '人口与迁徙' },
  { id: 'prosperity', label: '经济民生' },
  { id: 'knowledge', label: '科教数字' },
  { id: 'life', label: '日常生活' },
  { id: 'faith', label: '信仰民俗' },
  { id: 'hazards', label: '灾害风险' },
  { id: 'land', label: '国土生态' },
];

function normalizeCounties(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const cols = Array.isArray(raw.columns) ? raw.columns : null;
  if (Array.isArray(raw.rows) && raw.rows.length > 0 && Array.isArray(raw.rows[0]) && cols) {
    raw.rows = raw.rows.map((arr, idx) => {
      const obj = { idx };
      for (let c = 0; c < cols.length; c++) {
        obj[cols[c]] = arr[c];
      }
      return obj;
    });
  } else if (Array.isArray(raw.rows)) {
    for (let i = 0; i < raw.rows.length; i++) {
      if (raw.rows[i] && raw.rows[i].idx == null) raw.rows[i].idx = i;
    }
  }
  return raw;
}

function normalizeLenses(raw) {
  if (Array.isArray(raw)) {
    return { groups: LENS_GROUPS_DEFAULT, lenses: raw };
  }
  if (raw && Array.isArray(raw.lenses)) {
    return {
      groups: Array.isArray(raw.groups) && raw.groups.length ? raw.groups : LENS_GROUPS_DEFAULT,
      lenses: raw.lenses,
    };
  }
  return { groups: LENS_GROUPS_DEFAULT, lenses: [] };
}

function normalizeCities(raw, w) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.cities) ? raw.cities : [];
  for (const city of list) {
    if (!city) continue;
    if ((city.cell == null || city.cell < 0) && w && city.x != null && city.y != null) {
      city.cell = w.cellAt(city.x, city.y);
    }
    if ((!Array.isArray(city.footprint) || !city.footprint.length) && w && city.cell >= 0) {
      const nbrs = w.neighbors(city.cell).filter((n) => n >= 0 && w.owner[n] >= 0);
      city.footprint = [city.cell, ...nbrs];
    }
  }
  return list;
}

function normalizeStates(raw, w) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.states) ? raw.states : [];
  for (let i = 0; i < list.length; i++) {
    const st = list[i];
    if (!st) continue;
    if (st.idx == null) st.idx = i;
    if (w) {
      st.cells = w.stateCells[i] || [];
      if (st.x == null && w.stateBounds[i]) {
        st.x = w.stateBounds[i].labelX;
        st.y = w.stateBounds[i].labelY;
      }
      if ((st.cell == null || st.cell < 0) && st.x != null && st.y != null) {
        st.cell = w.cellAt(st.x, st.y);
      }
    }
  }
  return list;
}

export function createDataLoader(app) {
  const inflight = new Map();

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading ${url}`);
    }
    return res.json();
  }

  async function loadData(name, opts = {}) {
    if (!opts.force && app.data[name] != null) {
      return app.data[name];
    }
    if (inflight.has(name)) {
      return inflight.get(name);
    }
    const url = DATA_FILES[name] || `data/${name}.json`;
    const p = fetchJson(url)
      .then((raw) => {
        let val = raw;
        if (name === 'counties') val = normalizeCounties(raw);
        else if (name === 'lenses') val = normalizeLenses(raw);
        else if (name === 'cities') {
          val = normalizeCities(raw, app.w);
          app.state.cities = val;
        } else if (name === 'states') {
          val = normalizeStates(raw, app.w);
          app.state.states = val;
        } else if (name === 'districts') {
          // Sync cityBadges automatically
          const badges = { ...app.state.cityBadges };
          if (val?.cities) {
            for (const [cid, info] of Object.entries(val.cities)) {
              if (info?.badge) badges[cid] = info.badge;
            }
          }
          app.state.cityBadges = badges;
        }
        app.data[name] = val;
        app.emit(`data:${name}`, val);
        return val;
      })
      .finally(() => {
        inflight.delete(name);
      });

    inflight.set(name, p);
    return p;
  }

  return { loadData };
}
