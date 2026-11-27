// Safe extension loader for layers, cityView, and advisors

const EXTENSION_MODULES = [
  './layers/index.js?v=20261127-6',
  './cityView/index.js?v=20261127-5',
  './advisors/index.js?v=20261127-6',
];

export async function loadExtensions(app) {
  const results = [];
  for (const modPath of EXTENSION_MODULES) {
    try {
      const mod = await import(modPath);
      if (typeof mod?.install === 'function') {
        await mod.install(app);
        results.push({ path: modPath, ok: true });
      }
    } catch (err) {
      // Graceful fallback if an optional extension is absent or still under construction
      console.warn(`[ext] Skipped or failed ${modPath}:`, err?.message || err);
      results.push({ path: modPath, ok: false, error: err });
    }
  }
  app.emit('extensions:loaded', results);
  return results;
}
