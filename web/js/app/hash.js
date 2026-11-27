// URL hash parameter manager (#lens=density&city=beijing&view=city)

export function createHashManager(app) {
  const watchers = new Map();
  let internalUpdate = false;

  function parseHash() {
    const raw = window.location.hash.replace(/^#/, '');
    const out = {};
    if (!raw) return out;
    const params = new URLSearchParams(raw);
    for (const [k, v] of params.entries()) {
      out[k] = v;
    }
    return out;
  }

  function writeHash(obj) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
      if (v != null && v !== '') params.set(k, String(v));
    }
    const str = params.toString();
    const next = str ? `#${str}` : window.location.pathname + window.location.search;
    internalUpdate = true;
    try {
      window.history.replaceState(null, '', next);
    } catch {
      window.location.hash = str;
    }
    setTimeout(() => {
      internalUpdate = false;
    }, 0);
  }

  window.addEventListener('hashchange', () => {
    if (internalUpdate) return;
    const all = parseHash();
    for (const [k, fns] of watchers.entries()) {
      for (const fn of fns) {
        try {
          fn(all[k] ?? null, all);
        } catch (err) {
          console.error(`[hash.watcher:${k}]`, err);
        }
      }
    }
    app.emit('hashchange', { all, raw: window.location.hash });
    app.emit('hash:change', { all, raw: window.location.hash });
  });

  return {
    all: parseHash,
    read: parseHash,
    get(key) {
      return parseHash()[key] ?? null;
    },
    set(keyOrObj, val) {
      const cur = parseHash();
      if (typeof keyOrObj === 'object' && keyOrObj !== null) {
        for (const [k, v] of Object.entries(keyOrObj)) {
          if (v == null || v === '') delete cur[k];
          else cur[k] = String(v);
        }
      } else if (keyOrObj) {
        if (val == null || val === '') delete cur[keyOrObj];
        else cur[keyOrObj] = String(val);
      }
      writeHash(cur);
    },
    del(keyOrKeys) {
      const cur = parseHash();
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      for (const k of keys) delete cur[k];
      writeHash(cur);
    },
    register(key, handler) {
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key).add(handler);
      return () => watchers.get(key)?.delete(handler);
    },
  };
}
