// Quick Province Inspector Panel (#quick-panel)

import { escHtml, fmtGdp, fmtPct, fmtPop, fmtRatio1InN, fmtYuan } from '../format.js';
import { provinceColor } from '../color.js';
import { fmtYieldValue } from './yieldReport.js';

export function renderQuickStatePanel(app, el, idx) {
  const st = app.state.states[idx];
  if (!st) {
    el.classList.add('hidden');
    return;
  }

  const pCol = provinceColor(idx);
  const provCities = app.state.cities.filter((c) => c.province_idx === idx);
  const stem1In = st.stem_ratio_1_in_n || (st.stem_share ? Math.round(1 / st.stem_share) : null);

  el.innerHTML = `
    <div class="qp-head" style="border-left: 4px solid ${pCol}; padding-left: 8px;">
      <div class="qp-title-wrap">
        <div class="qp-eyebrow">${escHtml(st.region || '省级行政区')} · ${escHtml(st.code || '')}</div>
        <h3 class="qp-title">${escHtml(st.name)}</h3>
      </div>
      <button class="qp-close" type="button" aria-label="关闭">✕</button>
    </div>

    <div class="qp-badges">
      ${st.capital ? `<span class="civ-badge">★ 驻地：${escHtml(st.capital)}</span>` : ''}
      ${st.badge ? `<span class="civ-badge">${escHtml(st.badge)}</span>` : ''}
      ${stem1In ? `<span class="civ-badge">🔬 STEM ${escHtml(fmtRatio1InN(stem1In))}</span>` : ''}
    </div>

    <div class="qp-stats">
      <div class="qp-stat">
        <div class="qp-stat-lbl">常住人口</div>
        <div class="qp-stat-val">${escHtml(fmtPop(st.population))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">地区生产总值 GDP</div>
        <div class="qp-stat-val" style="color:#f2d16b">${escHtml(fmtGdp(st.gdp))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">人均 GDP</div>
        <div class="qp-stat-val">${escHtml(fmtYuan(st.gdp_per_capita))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">人均可支配收入</div>
        <div class="qp-stat-val">${escHtml(fmtYuan(st.disposable_income))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">城镇化率</div>
        <div class="qp-stat-val">${escHtml(fmtPct(st.urbanization ?? 0))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">近5年人口变化</div>
        <div class="qp-stat-val">${st.growth != null ? `${st.growth > 0 ? '+' : ''}${Number(st.growth).toFixed(1)}%` : '—'}</div>
      </div>
    </div>

    ${
      st.yields
        ? `
      <div class="qp-yields">
        <div class="qp-ybox"><div class="lbl">🌾 粮</div><div class="val" style="color:#8fd47e">${escHtml(fmtYieldValue(st.yields.food, 'food'))}</div></div>
        <div class="qp-ybox"><div class="lbl">⚙️ 产</div><div class="val" style="color:#e69d5c">${escHtml(fmtYieldValue(st.yields.production, 'production'))}</div></div>
        <div class="qp-ybox"><div class="lbl">💰 金</div><div class="val" style="color:#f2d16b">${escHtml(fmtYieldValue(st.yields.gold, 'gold'))}</div></div>
        <div class="qp-ybox"><div class="lbl">🔬 科</div><div class="val" style="color:#72c7f2">${escHtml(fmtYieldValue(st.yields.science, 'science'))}</div></div>
        <div class="qp-ybox"><div class="lbl">🎭 文</div><div class="val" style="color:#d59bf6">${escHtml(fmtYieldValue(st.yields.culture, 'culture'))}</div></div>
      </div>`
        : ''
    }

    ${
      provCities.length && !document.querySelector('[data-ext-btn="cityview"]')
        ? `
      <div class="qp-cities">
        <div class="qp-sec-lbl">省内核心城市（点击查看）</div>
        <div class="qp-chip-list">
          ${provCities
            .slice(0, 8)
            .map((c) => `<button class="qp-chip" type="button" data-city-id="${escHtml(c.id)}">${c.is_provincial_anchor ? '★ ' : ''}${escHtml(c.name)}</button>`)
            .join('')}
        </div>
      </div>`
        : ''
    }

    <div class="qp-actions">
      ${
        !document.querySelector('[data-ext-btn="cityview"]')
          ? `<button class="civ-btn primary" type="button" id="qp-enter-cityview">进入省级文明视图 ›</button>`
          : ''
      }
      <button class="civ-btn subtle" type="button" id="qp-zoom-state">缩放居中</button>
    </div>
  `;

  el.classList.remove('hidden');

  el.querySelector('.qp-close')?.addEventListener('click', () => app.clearSelection());
  el.querySelector('#qp-zoom-state')?.addEventListener('click', () => app.focusState(idx));
  el.querySelector('#qp-enter-cityview')?.addEventListener('click', () => {
    app.panels.state(idx, { direct: true });
    app.emit('cityview:open', { stateIdx: idx, state: st });
  });
  el.querySelectorAll('[data-city-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      app.selectCity(btn.dataset.cityId);
    });
  });
}
