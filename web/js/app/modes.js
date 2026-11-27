// Exclusive UI mode registry (e.g. "map", "city", "advisor", "explorer")

export function createModeManager(app) {
  const registry = new Map();
  let current = 'map';

  const mgr = {
    get current() {
      return current;
    },
    is(name) {
      return current === name;
    },
    register(name, hooks = {}) {
      registry.set(name, hooks);
    },
    enter(name, opts = {}) {
      const prev = current;
      if (prev && prev !== name) {
        const prevHooks = registry.get(prev);
        if (prevHooks?.onExit) {
          try {
            prevHooks.onExit({ next: name });
          } catch (err) {
            console.error(`[modes.onExit:${prev}]`, err);
          }
        }
      }
      current = name;
      app.state.mode = name;
      const hooks = registry.get(name);
      if (hooks?.onEnter) {
        try {
          hooks.onEnter(opts);
        } catch (err) {
          console.error(`[modes.onEnter:${name}]`, err);
        }
      }
      app.emit('mode', { prev, current, opts });
      app.emit('mode:change', { prev, current, opts });
      return true;
    },
    leave(name = null) {
      if (name && current !== name) return false;
      if (current === 'map') return false;
      const prev = current;
      const hooks = registry.get(prev);
      if (hooks?.onExit) {
        try {
          hooks.onExit({ next: 'map' });
        } catch (err) {
          console.error(`[modes.onExit:${prev}]`, err);
        }
      }
      current = 'map';
      app.state.mode = 'map';
      app.ui.setDock(null, 0);
      app.emit('mode', { prev, current: 'map', opts: {} });
      app.emit('mode:change', { prev, current: 'map', opts: {} });
      return true;
    },
    handleEscape() {
      if (current === 'map') return false;
      const hooks = registry.get(current);
      if (hooks?.onEscape) {
        const handled = hooks.onEscape();
        if (handled === true) return true;
      }
      return mgr.leave(current);
    },
  };

  return mgr;
}
