// Global search across 34 provinces, ~90 cities, 1,302 counties, wonders, and resources

import { ICONS } from '../icons.js';
import { escHtml } from '../format.js';

export function initSearch(app) {
  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');
  const iconEl = document.querySelector('#search-box .search-icon');
  if (iconEl) iconEl.innerHTML = ICONS.search;

  let currentItems = [];
  let activeIdx = -1;

  function buildMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = [];

    // 1. Provinces (34)
    for (let i = 0; i < app.state.states.length; i++) {
      const st = app.state.states[i];
      const text = `${st.name || ''} ${st.abbr || ''} ${st.capital || ''} ${st.code || ''}`.toLowerCase();
      if (text.includes(q)) {
        hits.push({
          kind: '省份',
          score: st.name === query.trim() || st.abbr === query.trim() ? 100 : 80,
          title: st.name,
          sub: `省会/核心：${st.capital || '—'} · ${st.region || ''}`,
          action: () => app.selectState(i),
        });
      }
    }

    // 2. Cities (~90)
    for (const c of app.state.cities) {
      const text = `${c.name || ''} ${c.full || ''} ${c.id || ''} ${c.province_name || ''}`.toLowerCase();
      if (text.includes(q)) {
        hits.push({
          kind: '城市',
          score: c.name === query.trim() || String(c.id).toLowerCase() === q ? 98 : 76,
          title: c.full || c.name,
          sub: `${c.province_name || ''} · 城市中心`,
          action: () => app.selectCity(c),
        });
      }
    }

    // 3. Counties (1,302)
    const counties = app.data.counties?.rows || app.w?.counties || [];
    for (let i = 0; i < counties.length; i++) {
      const ct = counties[i];
      const text = `${ct.name || ''} ${ct.province || ''} ${ct.code || ''}`.toLowerCase();
      if (text.includes(q)) {
        hits.push({
          kind: '县域',
          score: ct.name === query.trim() ? 92 : 60,
          title: ct.name,
          sub: `${ct.province || ''} · 代码 ${ct.code || ''}`,
          action: () => {
            const cells = app.w?.countyCells?.[i] || [];
            if (cells.length) {
              app.setHighlight({ counties: [i], color: '#ecd08e', dimOthers: 0.45 });
              let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
              for (const ci of cells) {
                const x = app.w.cx(ci), y = app.w.cy(ci);
                if (x < x0) x0 = x;
                if (y < y0) y0 = y;
                if (x > x1) x1 = x;
                if (y > y1) y1 = y;
              }
              app.fitBounds(x0 - 40, y0 - 40, x1 + 40, y1 + 40, { maxZoom: 1.5 });
              app.ui.showToast(`已定位县域：${ct.name}`);
            }
          },
        });
      }
      if (hits.length >= 60) break;
    }

    // 4. Wonders
    const wonders = app.data.wonders?.wonders || [];
    for (const wn of wonders) {
      const text = `${wn.name || ''} ${wn.short || ''} ${wn.city_name || ''}`.toLowerCase();
      if (text.includes(q)) {
        hits.push({
          kind: '奇观',
          score: 70,
          title: wn.name,
          sub: `${wn.city_name || ''} · ${wn.kind || ''}`,
          action: () => {
            if (!app.getLayer('wonders')) app.setLayer('wonders', true);
            const wx = wn.x ?? app.w.cx(wn.cell);
            const wy = wn.y ?? app.w.cy(wn.cell);
            app.cam.animateTo(wx, wy, Math.max(app.cam.zoom, 0.9));
            app.setHighlight({ pulse: { x: wx, y: wy, color: '#f2cb72' } });
          },
        });
      }
    }

    // 5. Resources
    const resItems = app.data.resources?.items || [];
    for (const it of resItems) {
      const text = `${it.name || ''} ${it.type || ''}`.toLowerCase();
      if (text.includes(q)) {
        hits.push({
          kind: '资源',
          score: 52,
          title: it.name || it.type,
          sub: `${it.type || ''}`,
          action: () => {
            if (!app.state.showResources) app.setShowResources(true);
            const wx = it.x ?? app.w.cx(it.cell);
            const wy = it.y ?? app.w.cy(it.cell);
            app.cam.animateTo(wx, wy, Math.max(app.cam.zoom, 0.9));
            app.setHighlight({ pulse: { x: wx, y: wy, color: '#79d69c' } });
          },
        });
      }
      if (hits.length >= 90) break;
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, 18);
  }

  function renderResults() {
    if (!currentItems.length) {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      return;
    }
    resultsEl.innerHTML = currentItems
      .map(
        (it, idx) => `
      <div class="sr-item ${idx === activeIdx ? 'active' : ''}" data-idx="${idx}" role="option">
        <div class="sr-main">
          <span class="sr-title">${escHtml(it.title)}</span>
          <span class="sr-sub">${escHtml(it.sub)}</span>
        </div>
        <span class="sr-tag">${escHtml(it.kind)}</span>
      </div>`
      )
      .join('');
    resultsEl.classList.remove('hidden');

    resultsEl.querySelectorAll('.sr-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const i = Number(row.dataset.idx);
        selectResult(i);
      });
    });
  }

  function selectResult(idx) {
    const item = currentItems[idx];
    if (!item) return;
    resultsEl.classList.add('hidden');
    input.blur();
    item.action();
  }

  async function onQuery() {
    const val = input.value;
    if (!val.trim()) {
      currentItems = [];
      renderResults();
      return;
    }
    // Ensure counties/wonders/resources are loaded if user searches immediately
    await Promise.allSettled([
      app.loadData('counties'),
      app.loadData('wonders'),
      app.loadData('resources'),
    ]);
    currentItems = buildMatches(val);
    activeIdx = currentItems.length ? 0 : -1;
    renderResults();
  }

  input.addEventListener('input', onQuery);
  input.addEventListener('focus', () => {
    if (input.value.trim()) onQuery();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => resultsEl.classList.add('hidden'), 140);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length) {
        activeIdx = (activeIdx + 1) % currentItems.length;
        renderResults();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length) {
        activeIdx = (activeIdx - 1 + currentItems.length) % currentItems.length;
        renderResults();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0) selectResult(activeIdx);
    } else if (e.key === 'Escape') {
      resultsEl.classList.add('hidden');
      input.blur();
    }
  });

  return {
    focus() {
      input.focus();
      input.select();
    },
  };
}
