// Quick City Inspector Panel (#quick-panel)

import { escHtml, fmtGdp, fmtPop, fmtRatio1InN, fmtYuan } from '../format.js';
import { provinceColor } from '../color.js';
import { fmtYieldValue } from './yieldReport.js';

export function renderQuickCityPanel(app, el, city) {
  if (!city) {
    el.classList.add('hidden');
    return;
  }

  const pIdx = city.province_idx ?? 0;
  const pCol = provinceColor(pIdx);
  const badge = app.state.cityBadges?.[city.id] || city.badge || '';
  const stem1In = city.stem_ratio_1_in_n || (city.stem_share ? Math.round(1 / city.stem_share) : null);

  el.innerHTML = `
    <div class="qp-head" style="border-left: 4px solid ${pCol}; padding-left: 8px;">
      <div class="qp-title-wrap">
        <div class="qp-eyebrow">${escHtml(city.province_name || '')} · ${city.is_provincial_anchor ? '省级行政中心' : '重要节点城市'}</div>
        <h3 class="qp-title">${escHtml(city.full || city.name)}</h3>
      </div>
      <button class="qp-close" type="button" aria-label="关闭">✕</button>
    </div>

    <div class="qp-badges">
      ${badge ? `<span class="civ-badge">${escHtml(badge)}</span>` : ''}
      ${stem1In ? `<span class="civ-badge">🔬 STEM ${escHtml(fmtRatio1InN(stem1In))}</span>` : ''}
    </div>

    <div class="qp-stats">
      <div class="qp-stat">
        <div class="qp-stat-lbl">市域人口</div>
        <div class="qp-stat-val">${escHtml(fmtPop(city.population))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">城市 GDP</div>
        <div class="qp-stat-val" style="color:#f2d16b">${escHtml(fmtGdp(city.gdp))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">人均可支配收入</div>
        <div class="qp-stat-val">${escHtml(fmtYuan(city.disposable_income))}</div>
      </div>
      <div class="qp-stat">
        <div class="qp-stat-lbl">房价参考</div>
        <div class="qp-stat-val">${city.home_price ? `${Math.round(city.home_price).toLocaleString('zh-CN')} 元/㎡` : '—'}</div>
      </div>
    </div>

    ${
      city.yields
        ? `
      <div class="qp-yields">
        <div class="qp-ybox"><div class="lbl">🌾 粮</div><div class="val" style="color:#8fd47e">${escHtml(fmtYieldValue(city.yields.food, 'food'))}</div></div>
        <div class="qp-ybox"><div class="lbl">⚙️ 产</div><div class="val" style="color:#e69d5c">${escHtml(fmtYieldValue(city.yields.production, 'production'))}</div></div>
        <div class="qp-ybox"><div class="lbl">💰 金</div><div class="val" style="color:#f2d16b">${escHtml(fmtYieldValue(city.yields.gold, 'gold'))}</div></div>
        <div class="qp-ybox"><div class="lbl">🔬 科</div><div class="val" style="color:#72c7f2">${escHtml(fmtYieldValue(city.yields.science, 'science'))}</div></div>
        <div class="qp-ybox"><div class="lbl">🎭 文</div><div class="val" style="color:#d59bf6">${escHtml(fmtYieldValue(city.yields.culture, 'culture'))}</div></div>
      </div>`
        : ''
    }

    <div class="qp-actions">
      ${
        !document.querySelector('[data-ext-btn="cityview"]')
          ? `<button class="civ-btn primary" type="button" id="qp-enter-city">进入城市视图 ›</button>`
          : ''
      }
      <button class="civ-btn subtle" type="button" id="qp-parent-prov">所属省份</button>
    </div>
  `;

  el.classList.remove('hidden');

  el.querySelector('.qp-close')?.addEventListener('click', () => app.clearSelection());
  el.querySelector('#qp-parent-prov')?.addEventListener('click', () => app.selectState(pIdx));
  el.querySelector('#qp-enter-city')?.addEventListener('click', () => {
    app.panels.city(city, { direct: true });
    app.emit('cityview:open', { city });
  });
}
