// National & 34-Province Civilization Yield Report modal

import { escHtml, fmtCompact, fmtGdp, fmtPop, fmtRatio1InN, fmtYuan } from '../format.js';
import { ICONS } from '../icons.js';

const YIELD_TABS = [
  { id: 'food', label: '粮食 / 农业', icon: 'food', color: '#8fd47e' },
  { id: 'production', label: '生产力 / 工业', icon: 'production', color: '#e69d5c' },
  { id: 'gold', label: '金币 / GDP', icon: 'gold', color: '#f2d16b' },
  { id: 'science', label: '科技 / 科创', icon: 'science', color: '#72c7f2' },
  { id: 'culture', label: '文化 / 文旅', icon: 'culture', color: '#d59bf6' },
];

export function extractYieldNum(yVal) {
  if (typeof yVal === 'number') return yVal;
  if (yVal && typeof yVal === 'object') return yVal.value ?? yVal.score ?? yVal.amount ?? 0;
  return 0;
}

export function fmtYieldValue(yVal, key) {
  if (yVal && typeof yVal === 'object' && yVal.display) return yVal.display;
  const n = extractYieldNum(yVal);
  if (key === 'science') return fmtCompact(n);
  return fmtGdp(n, '亿元');
}

export function fmtYieldPill(yVal, key) {
  const n = extractYieldNum(yVal);
  if (key === 'science') return fmtCompact(n);
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}万亿`;
  return `${Math.round(n).toLocaleString('zh-CN')}亿`;
}

export function initYieldReport(app) {
  const modalRoot = document.getElementById('modal-root');

  function open(initialTab = 'gold') {
    let activeTab = YIELD_TABS.some((t) => t.id === initialTab) ? initialTab : 'gold';
    let sortKey = activeTab;
    let sortDesc = true;

    function render() {
      const nat = app.data.nation || {};
      const states = app.state.states || [];
      const tabMeta = YIELD_TABS.find((t) => t.id === activeTab) || YIELD_TABS[2];

      const rows = states
        .map((st, idx) => ({ st, idx }))
        .sort((a, b) => {
          let va, vb;
          if (sortKey === 'pop') {
            va = a.st.population || 0;
            vb = b.st.population || 0;
          } else if (sortKey === 'gdp_pc') {
            va = a.st.gdp_per_capita || 0;
            vb = b.st.gdp_per_capita || 0;
          } else {
            va = extractYieldNum(a.st.yields?.[sortKey]);
            vb = extractYieldNum(b.st.yields?.[sortKey]);
          }
          return sortDesc ? vb - va : va - vb;
        });

      const stem1in = nat.benchmarks?.national_stem_1_in || nat.stem_ratio_1_in_n || 14;
      const sz1in = nat.benchmarks?.shenzhen_stem_1_in || 5;

      modalRoot.innerHTML = `
        <div class="modal-card">
          <div class="modal-head">
            <h2 class="modal-title">中华文明产出总览 · 五大产出报告</h2>
            <button class="modal-close" type="button" aria-label="关闭">✕</button>
          </div>
          <div class="modal-tabs">
            ${YIELD_TABS.map(
              (t) => `
              <button class="modal-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">
                ${ICONS[t.id] || ''} ${escHtml(t.label)}
              </button>`
            ).join('')}
          </div>
          <div class="modal-body">
            <div class="qp-stats" style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-top: 0; margin-bottom: 12px;">
              <div class="qp-stat">
                <div class="qp-stat-lbl">全国总人口（含港澳台）</div>
                <div class="qp-stat-val">${escHtml(fmtPop(nat.population))}</div>
              </div>
              <div class="qp-stat">
                <div class="qp-stat-lbl">全国 GDP 总值</div>
                <div class="qp-stat-val" style="color:#f2d16b">${escHtml(fmtGdp(nat.gdp))}</div>
              </div>
              <div class="qp-stat">
                <div class="qp-stat-lbl">人均可支配收入</div>
                <div class="qp-stat-val">${escHtml(fmtYuan(nat.disposable_income))}</div>
              </div>
              <div class="qp-stat">
                <div class="qp-stat-lbl">STEM 工程师密度</div>
                <div class="qp-stat-val" style="color:#72c7f2">全国 ${escHtml(fmtRatio1InN(stem1in))} · 深圳每 ${sz1in} 人中 1 名</div>
              </div>
            </div>

            <div style="margin-bottom:8px;font-size:12px;color:var(--ink-dim);">
              当前聚焦：<strong style="color:${tabMeta.color}">${escHtml(tabMeta.label)}</strong>（点击列标题可排序，点击省份行直接定位该省）
            </div>

            <table class="civ-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>省级行政区</th>
                  <th class="sortable" data-sort="pop" style="cursor:pointer;">人口</th>
                  <th class="sortable" data-sort="food" style="cursor:pointer;">🌾 粮食</th>
                  <th class="sortable" data-sort="production" style="cursor:pointer;">⚙️ 生产力</th>
                  <th class="sortable" data-sort="gold" style="cursor:pointer;">💰 金币/GDP</th>
                  <th class="sortable" data-sort="science" style="cursor:pointer;">🔬 科技</th>
                  <th class="sortable" data-sort="culture" style="cursor:pointer;">🎭 文化</th>
                  <th class="sortable" data-sort="gdp_pc" style="cursor:pointer;">人均GDP</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    ({ st, idx }, rank) => `
                  <tr class="clickable" data-sidx="${idx}">
                    <td>${rank + 1}</td>
                    <td><strong>${escHtml(st.name)}</strong> <span style="color:var(--ink-dim);font-size:11px;">${escHtml(st.region || '')}</span></td>
                    <td>${escHtml(fmtPop(st.population))}</td>
                    <td style="color:#8fd47e">${escHtml(fmtYieldValue(st.yields?.food, 'food'))}</td>
                    <td style="color:#e69d5c">${escHtml(fmtYieldValue(st.yields?.production, 'production'))}</td>
                    <td style="color:#f2d16b">${escHtml(fmtGdp(st.gdp ?? extractYieldNum(st.yields?.gold)))}</td>
                    <td style="color:#72c7f2">${escHtml(fmtYieldValue(st.yields?.science, 'science'))}</td>
                    <td style="color:#d59bf6">${escHtml(fmtYieldValue(st.yields?.culture, 'culture'))}</td>
                    <td>${escHtml(fmtYuan(st.gdp_per_capita))}</td>
                  </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;

      modalRoot.classList.remove('hidden');

      modalRoot.querySelector('.modal-close')?.addEventListener('click', close);
      modalRoot.querySelectorAll('.modal-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.tab;
          sortKey = activeTab;
          sortDesc = true;
          render();
        });
      });
      modalRoot.querySelectorAll('th.sortable').forEach((th) => {
        th.addEventListener('click', () => {
          const k = th.dataset.sort;
          if (sortKey === k) sortDesc = !sortDesc;
          else {
            sortKey = k;
            sortDesc = true;
          }
          render();
        });
      });
      modalRoot.querySelectorAll('tr[data-sidx]').forEach((tr) => {
        tr.addEventListener('click', () => {
          const idx = Number(tr.dataset.sidx);
          close();
          app.selectState(idx);
        });
      });
    }

    render();
  }

  function close() {
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML = '';
  }

  modalRoot.addEventListener('click', (e) => {
    if (e.target === modalRoot) close();
  });

  app.openYieldReport = open;
  return { open, close };
}
