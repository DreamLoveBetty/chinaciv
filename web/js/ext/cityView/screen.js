import { isElevation25D, elevLiftKm } from "../../render/art/elevation25d.js?v=20261127-5";
import {
  DISTRICT_META,
  REGION_ORDER,
  collectLocalAssets,
  computeFootprint,
  ensureCityViewData,
  escHtml,
  extractYieldNum,
  findPeers,
  fmtGdp,
  fmtMoney,
  fmtPct,
  fmtPctVal,
  fmtPop,
  fmtShare,
  fmtYieldVal,
  getNationalStemBenchmarks,
  getProvinceColor,
  getProvinceRegion,
  layoutDistrictPlaques,
  resolveTarget,
} from "./data.js";

const YIELD_DEFS = [
  { key: "food", label: "粮食", icon: "🌾", color: "#84cc16" },
  { key: "production", label: "生产力", icon: "⚙️", color: "#f97316" },
  { key: "gold", label: "金币(GDP)", icon: "💰", color: "#f59e0b" },
  { key: "science", label: "科技", icon: "🔬", color: "#38bdf8" },
  { key: "culture", label: "文化", icon: "🎭", color: "#c084fc" },
];

/**
 * Manages the City View Right Dock / Mobile Bottom Sheet and the 34-Province Selector Drawer.
 */
export function createCityViewScreen(app, mapLayer, callbacks) {
  let dockEl = null;
  let drawerEl = null;
  let currentEntity = null;
  let currentFootprint = null;
  let currentPlaques = [];
  let currentAssets = [];
  let activeAssetTab = "all";
  let selectedCitizenRole = null;
  let savedCamera = null;
  let drawerEscHandler = null;
  let openSeq = 0;

  function cloneCamera() {
    const cam = app.cam;
    if (!cam) return null;
    return {
      x: cam.x,
      y: cam.y,
      zoom: cam.zoom,
    };
  }

  function restoreCamera() {
    if (!savedCamera || !app.cam) return;
    if (typeof app.cam.animateTo === "function") {
      app.cam.animateTo(savedCamera.x, savedCamera.y, savedCamera.zoom, { duration: 360 });
    } else if (typeof app.cam.set === "function") {
      app.cam.set(savedCamera);
    } else {
      app.cam.x = savedCamera.x;
      app.cam.y = savedCamera.y;
      app.cam.zoom = savedCamera.zoom;
    }
    savedCamera = null;
    app.requestDraw?.();
  }

  function ensureDockContainer() {
    const width = window.innerWidth <= 860 ? window.innerWidth : 450;
    const ret = app.ui?.setDock?.("right", width);
    if (ret instanceof HTMLElement) {
      dockEl = ret;
    } else {
      dockEl = document.querySelector("#dock-right, .ext-dock-right, .dock-right") || dockEl;
    }
    if (!dockEl) {
      dockEl = document.createElement("aside");
      dockEl.id = "cv-fallback-dock";
      dockEl.style.cssText = "position:fixed;top:48px;right:0;bottom:0;width:450px;z-index:800;";
      document.body.appendChild(dockEl);
    }
    dockEl.classList.remove("hidden");
    dockEl.classList.add("cv-dock");
    return dockEl;
  }

  function clearDock() {
    mapLayer.clear();
    currentEntity = null;
    currentFootprint = null;
    currentPlaques = [];
    currentAssets = [];
    if (dockEl) {
      dockEl.innerHTML = "";
      dockEl.classList.remove("cv-dock");
      if (dockEl.id === "cv-fallback-dock") dockEl.remove();
      dockEl = null;
    }
    if (typeof app.ui?.closeDock === "function") {
      app.ui.closeDock("right");
    } else {
      app.ui?.setDock?.("right", 0);
    }
    callbacks?.onClosed?.();
  }

  function closeCityView(opts = {}) {
    const restore = opts.restoreCamera !== false;
    clearDock();
    if (restore) restoreCamera();
    app.hash?.del?.(["view", "city", "province"]);
    if (app.modes?.is?.("city")) {
      app.modes.leave("city");
    }
    callbacks?.onClosed?.();
  }

  function bindDrawerEsc() {
    if (drawerEscHandler) return;
    drawerEscHandler = (e) => {
      if (e.key === "Escape" && drawerEl && !drawerEl.hidden) {
        e.preventDefault();
        e.stopPropagation();
        closeDrawer();
      }
    };
    document.addEventListener("keydown", drawerEscHandler, true);
  }

  function unbindDrawerEsc() {
    if (drawerEscHandler) {
      document.removeEventListener("keydown", drawerEscHandler, true);
      drawerEscHandler = null;
    }
  }

  function getRankText(entity, key) {
    const ranks = entity.metrics?.ranks || {};
    const r = ranks[key] ?? ranks[`${key}_rank`];
    if (Number.isFinite(Number(r)) && Number(r) > 0) {
      return entity.kind === "province" ? `34省第${r}名` : `城市第${r}名`;
    }
    const pool = entity.kind === "province" ? (app.data?.states || []) : (app.data?.cities || []);
    const rawVal = entity.metrics?.yields?.[key];
    if (!pool.length || rawVal == null) return "—";
    const val = extractYieldNum(rawVal);
    let rank = 1;
    for (const item of pool) {
      if (extractYieldNum(item?.yields?.[key]) > val) rank++;
    }
    return entity.kind === "province" ? `34省第${rank}名` : `第${rank}名`;
  }

  function buildCitizenTokens(citizens) {
    const totalSlots = 20;
    const tokens = [];
    if (!Array.isArray(citizens) || !citizens.length) return tokens;
    const counts = citizens.map((c) => Math.max(1, Math.round(Number(c.share || 0) * totalSlots)));
    let sum = counts.reduce((a, b) => a + b, 0);
    while (sum > totalSlots) {
      const idx = counts.indexOf(Math.max(...counts));
      if (counts[idx] <= 1) break;
      counts[idx]--;
      sum--;
    }
    while (sum < totalSlots) {
      const idx = counts.indexOf(Math.max(...counts));
      counts[idx]++;
      sum++;
    }
    citizens.forEach((c, ci) => {
      for (let k = 0; k < counts[ci]; k++) {
        tokens.push({ ...c, tokenIdx: tokens.length });
      }
    });
    return tokens;
  }

  function renderDock() {
    if (!dockEl || !currentEntity) return;
    const e = currentEntity;
    const m = e.metrics || {};
    const states = app.data?.states || [];
    const benches = getNationalStemBenchmarks(app);

    const stemShare = Number(m.stem_share || 0);
    const stemRawOneIn = Number(m.stem_ratio_1_in_n || (stemShare > 0 ? 1 / stemShare : benches.natOneIn));
    const stemOneInDisplay = Math.abs(stemRawOneIn - Math.round(stemRawOneIn)) < 0.12
      ? String(Math.round(stemRawOneIn))
      : stemRawOneIn.toFixed(1);
    const stemMult = benches.natShare > 0 ? (stemShare / benches.natShare) : 1;
    const isStemElite = stemRawOneIn <= 9 || stemShare >= 0.11;

    const districts = e.districtData?.districts || [];
    const citizens = e.districtData?.citizens || [];
    const tokens = buildCitizenTokens(citizens);
    if (!selectedCitizenRole && citizens.length) {
      const stemC = citizens.find((c) => /stem|tech|engineer|scientist|研发|工程|科研|程序员/i.test(`${c.role} ${c.label}`));
      selectedCitizenRole = (stemC || citizens[0]).role;
    }

    // Top industries
    const gdpByInd = m.gdp_by_industry || m.jobs || {};
    const indEntries = Object.entries(gdpByInd)
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => Number.isFinite(v) && v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const indMax = indEntries[0]?.[1] || 1;
    const indSum = indEntries.reduce((s, [, v]) => s + v, 0) || 1;

    // Asset filtering
    const counts = {
      all: currentAssets.length,
      wonder: currentAssets.filter((a) => a.group === "wonder").length,
      resource: currentAssets.filter((a) => a.group === "resource").length,
      infra: currentAssets.filter((a) => a.group === "infra").length,
      military: currentAssets.filter((a) => a.group === "military").length,
    };
    const filteredAssets = activeAssetTab === "all"
      ? currentAssets
      : currentAssets.filter((a) => a.group === activeAssetTab);

    // Peers
    const peers = findPeers(e, app, 5);

    // Province selector options
    const provOptions = states
      .map((st, idx) => `<option value="${idx}" ${idx === e.provinceIdx ? "selected" : ""}>${escHtml(st.name)} (${escHtml(getProvinceRegion(st))})</option>`)
      .join("");

    // Province <-> City pill strip
    const hopPills = [];
    if (e.state) {
      hopPills.push(
        `<button class="cv-hop-pill is-prov ${e.kind === "province" ? "active" : ""}" data-hop-kind="province" data-hop-ref="${e.provinceIdx}">${escHtml(e.state.name)}全区</button>`
      );
    }
    for (const c of e.siblingCities) {
      const isAct = e.kind === "city" && (c.id === e.id || c.name === e.shortName);
      hopPills.push(
        `<button class="cv-hop-pill ${isAct ? "active" : ""}" data-hop-kind="city" data-hop-ref="${escHtml(c.id || c.name)}">${escHtml(c.name)}</button>`
      );
    }

    // Yields HTML
    const yieldsHtml = YIELD_DEFS.map((yd) => {
      const val = m.yields?.[yd.key];
      return `
        <div class="cv-yield-card" style="--yc:${yd.color}">
          <div class="cv-yield-icon">${yd.icon}</div>
          <div class="cv-yield-label">${yd.label}</div>
          <div class="cv-yield-val">${escHtml(fmtYieldVal(yd.key, val))}</div>
          <div class="cv-yield-rank">${escHtml(getRankText(e, yd.key))}</div>
        </div>
      `;
    }).join("");

    // Citizens HTML
    const activeCitizen = citizens.find((c) => c.role === selectedCitizenRole) || citizens[0] || null;
    const tokensHtml = tokens.map((t) => `
      <button type="button" class="cv-ctoken ${t.role === activeCitizen?.role ? "active" : ""}"
        style="--cc:${escHtml(t.color || "#60a5fa")}"
        data-citizen-role="${escHtml(t.role)}"
        title="${escHtml(t.label)}: ${fmtShare(t.share)}">${escHtml(t.icon || "👤")}</button>
    `).join("");

    const citizenRowsHtml = citizens.map((c) => {
      const pct = Math.min(100, Number(c.share || 0) * 100);
      const natPct = Math.min(100, Number(c.national_share || 0) * 100);
      return `
        <div class="cv-citizen-row ${c.role === activeCitizen?.role ? "active" : ""}"
          style="--cc:${escHtml(c.color || "#c9a45c")}"
          data-citizen-role="${escHtml(c.role)}">
          <div class="cv-c-dot">${escHtml(c.icon || "👤")}</div>
          <div class="cv-c-bar-wrap">
            <div class="cv-c-name-row">
              <span>${escHtml(c.label)}</span>
              <span style="color:#a79b7e">${c.national_share != null ? `全国 ${fmtShare(c.national_share)}` : ""}</span>
            </div>
            <div class="cv-c-bar-track">
              <div class="cv-c-bar-fill" style="width:${pct.toFixed(1)}%"></div>
              ${c.national_share != null ? `<div class="cv-c-nat-mark" style="left:${natPct.toFixed(1)}%" title="全国基准 ${fmtShare(c.national_share)}"></div>` : ""}
            </div>
          </div>
          <div class="cv-c-stat">
            <strong>${fmtShare(c.share)}</strong>
            <small>${fmtPop(c.workers)}</small>
          </div>
        </div>
      `;
    }).join("");

    // Districts HTML
    const districtsHtml = districts.length
      ? districts.map((d, idx) => {
        const meta = DISTRICT_META[d.type] || { label: "专业城区", icon: "🏛️", color: "#c9a45c" };
        const lqNum = Number(d.lq || 1);
        return `
          <div class="cv-district-card" style="--dc:${meta.color}" data-district-idx="${idx}">
            <div class="cv-d-top">
              <div class="cv-d-hex">${escHtml(d.icon || meta.icon)}</div>
              <div class="cv-d-title-wrap">
                <div class="cv-d-name">${escHtml(d.name)}</div>
                <div class="cv-d-sector">${escHtml(meta.label)} · ${escHtml(d.sector || "")}</div>
              </div>
              <div class="cv-d-lq">LQ ${lqNum.toFixed(2)}</div>
            </div>
            <div class="cv-d-metrics">
              <span>就业规模: <b>${escHtml(fmtPop(d.emp))}</b></span>
              ${d.avg_pay ? `<span>平均年薪: <b>${escHtml(fmtMoney(d.avg_pay, "元/年"))}</b></span>` : ""}
            </div>
            ${d.note ? `<div class="cv-d-note">${escHtml(d.note)}</div>` : ""}
          </div>
        `;
      }).join("")
      : `<div class="cv-empty">暂无专业城区明细数据</div>`;

    // Economy KPIs
    const growthArr = Array.isArray(m.growth_years) ? m.growth_years : null;
    const growthYearsText = growthArr && growthArr.length >= 2 ? `${growthArr[0]}–${growthArr[1]}年` : "5年";
    const avgPay = e.districtData?.avg_pay || m.avg_pay;
    const priceToIncome = m.home_price && m.disposable_income ? (Number(m.home_price) * 90 / (Number(m.disposable_income) * 2)).toFixed(1) : null;

    const popSeries = Array.isArray(m.pop_series) && m.pop_series.length >= 2 ? m.pop_series : null;
    const popSparkSvg = (() => {
      if (!popSeries) return "";
      const vals = popSeries.map((p) => Number(p.pop || 0));
      const maxP = Math.max(...vals, 1);
      const minP = Math.min(...vals, 0);
      const span = Math.max(1, maxP - minP);
      const wSvg = 260;
      const hSvg = 40;
      const pts = popSeries.map((p, i) => {
        const x = 4 + (i / (popSeries.length - 1)) * (wSvg - 8);
        const y = hSvg - 6 - ((Number(p.pop || 0) - minP) / span) * (hSvg - 12);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
      const first = popSeries[0];
      const last = popSeries[popSeries.length - 1];
      return `
        <div style="margin-bottom:9px;padding:7px 9px;background:rgba(13,21,31,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:7px;">
          <div style="display:flex;justify-content:space-between;font-size:10.5px;color:#a99c7d;margin-bottom:3px;">
            <span>人口变迁曲线 (${first.year}–${last.year})</span>
            <span class="tabular" style="color:#ecd08e">${escHtml(fmtPop(first.pop))} → ${escHtml(fmtPop(last.pop))}</span>
          </div>
          <svg viewBox="0 0 ${wSvg} ${hSvg}" style="width:100%;height:38px;display:block;">
            <polyline fill="none" stroke="#c9a45c" stroke-width="2" points="${pts}" />
          </svg>
        </div>
      `;
    })();

    dockEl.innerHTML = `
      <div class="cv-header">
        <div class="cv-header-top">
          <div class="cv-emblem" style="background:linear-gradient(135deg, ${e.color}, #152232)">
            ${escHtml(e.abbr)}
            <span class="cv-emblem-kind">${e.kind === "province" ? "省" : "城"}</span>
          </div>
          <div class="cv-title-wrap">
            <div class="cv-title-row">
              <h2 class="cv-title">${escHtml(e.name)}</h2>
              ${e.badge ? `<span class="cv-badge-pill">✦ ${escHtml(e.badge)}</span>` : ""}
            </div>
            <div class="cv-subtitle">
              <span>${escHtml(getProvinceRegion(e.state))} · ${e.kind === "province" ? "省级行政区" : `${escHtml(e.state?.name || "")}核心城市`}</span>
              <span>人口 ${escHtml(fmtPop(m.population))}</span>
              <span>${currentFootprint?.cellList?.length || 0} 六边形</span>
            </div>
          </div>
          <div class="cv-header-actions">
            <button type="button" class="cv-icon-btn primary" data-cv-action="drawer" title="浏览全部34个省级行政区与城市">34省</button>
            <button type="button" class="cv-icon-btn" data-cv-action="recenter" title="聚焦到地图边界">居中</button>
            <button type="button" class="cv-icon-btn" data-cv-action="close" title="关闭城市视图 (Esc)">✕</button>
          </div>
        </div>

        <div class="cv-switcher-row">
          <span style="font-size:11px;color:#a89b7e;white-space:nowrap">快速切换省份:</span>
          <select class="cv-select" data-cv-prov-select aria-label="切换省级行政区">
            ${provOptions}
          </select>
          <span style="font-size:11px;color:#8e8267;margin-left:auto">${e.siblingCities.length} 座核心城市</span>
        </div>

        ${hopPills.length ? `<div class="cv-city-strip">${hopPills.join("")}</div>` : ""}
      </div>

      <div class="cv-body">
        ${m.summary ? `<div class="cv-summary-blurb">${escHtml(m.summary)}</div>` : ""}

        <!-- 1. Yields -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">1. 产出与排名 (Yields)</h3>
            <span class="cv-sec-sub">${e.kind === "province" ? "34省横向排位" : "全国城市排位"}</span>
          </div>
          <div class="cv-yields-grid">${yieldsHtml}</div>
        </section>

        <!-- 2. Citizens -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">2. 市民构成 (Citizens)</h3>
            <span class="cv-sec-sub">在岗劳动者 ${escHtml(fmtPop(m.employed || e.districtData?.emp))}</span>
          </div>
          <div class="cv-stem-banner ${isStemElite ? "is-elite" : ""}">
            <div>
              <div class="cv-stem-main">🔬 每 ${escHtml(stemOneInDisplay)} 名劳动者中有 1 名工程师/程序员/科学家 (${fmtShare(stemShare)})</div>
              <div class="cv-stem-compare">对比基准：全国平均每 ${benches.natOneIn} 名劳动者中有 1 名 (${fmtShare(benches.natShare)})</div>
            </div>
            <div class="cv-stem-mult">
              <strong>${stemMult.toFixed(1)}×</strong>
              <span>全国平均</span>
            </div>
          </div>
          ${tokens.length ? `<div class="cv-citizen-tokens">${tokensHtml}</div>` : ""}
          <div class="cv-citizen-list">${citizenRowsHtml || `<div class="cv-empty">暂无市民行业构成数据</div>`}</div>
          ${activeCitizen?.note ? `<div class="cv-citizen-detail"><b>${escHtml(activeCitizen.icon || "👤")} ${escHtml(activeCitizen.label)}</b>：${escHtml(activeCitizen.note)}</div>` : ""}
        </section>

        <!-- 3. Districts -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">3. 专业城区 (Districts)</h3>
            <span class="cv-sec-sub">悬停或点击高亮地图城区</span>
          </div>
          <div class="cv-districts-list">${districtsHtml}</div>
        </section>

        <!-- 4. Economy -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">4. 经济与产业 (Economy)</h3>
            <span class="cv-sec-sub">${avgPay ? `平均年薪 ${fmtMoney(avgPay, "元")}` : "宏观经济核心指标"}</span>
          </div>
          <div class="cv-kpi-grid">
            <div class="cv-kpi-box">
              <div class="cv-kpi-label">地区生产总值 (GDP)</div>
              <div class="cv-kpi-val">${escHtml(fmtGdp(m.gdp))}</div>
              <div class="cv-kpi-sub">年增速 ${m.growth != null ? `${Number(m.growth).toFixed(1)}%` : "—"}${m.growth_5y_cum != null ? ` · ${escHtml(growthYearsText)} +${Number(m.growth_5y_cum).toFixed(1)}%` : ""}</div>
            </div>
            <div class="cv-kpi-box">
              <div class="cv-kpi-label">人均 GDP</div>
              <div class="cv-kpi-val">${escHtml(fmtMoney(m.gdp_per_capita))}</div>
              <div class="cv-kpi-sub">城镇化 ${m.urbanization != null ? fmtPctVal(m.urbanization) : "—"}</div>
            </div>
            <div class="cv-kpi-box">
              <div class="cv-kpi-label">人均可支配收入</div>
              <div class="cv-kpi-val">${escHtml(fmtMoney(m.disposable_income))}</div>
              <div class="cv-kpi-sub">均价 ${m.home_price ? `${Math.round(m.home_price).toLocaleString("zh-CN")}元/㎡` : "—"}${priceToIncome ? ` · 售租比${priceToIncome}年` : ""}</div>
            </div>
          </div>
          ${popSparkSvg}
          <div class="cv-ind-bars">
            ${indEntries.map(([name, val]) => `
              <div class="cv-ind-row">
                <span class="cv-ind-name" title="${escHtml(name)}">${escHtml(name)}</span>
                <div class="cv-ind-track"><div class="cv-ind-fill" style="width:${((val / indMax) * 100).toFixed(1)}%"></div></div>
                <span class="cv-ind-val">${((val / indSum) * 100).toFixed(1)}%</span>
              </div>
            `).join("")}
          </div>
        </section>

        <!-- 5. Resources, Infrastructure & Wonders -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">5. 资源、基建与奇观</h3>
            <span class="cv-sec-sub">悬停/点击在地图定位</span>
          </div>
          <div class="cv-asset-tabs">
            <button type="button" class="cv-asset-tab ${activeAssetTab === "all" ? "active" : ""}" data-asset-tab="all">全部 (${counts.all})</button>
            <button type="button" class="cv-asset-tab ${activeAssetTab === "wonder" ? "active" : ""}" data-asset-tab="wonder">奇观 (${counts.wonder})</button>
            <button type="button" class="cv-asset-tab ${activeAssetTab === "resource" ? "active" : ""}" data-asset-tab="resource">能源矿产 (${counts.resource})</button>
            <button type="button" class="cv-asset-tab ${activeAssetTab === "infra" ? "active" : ""}" data-asset-tab="infra">港航枢纽 (${counts.infra})</button>
            <button type="button" class="cv-asset-tab ${activeAssetTab === "military" ? "active" : ""}" data-asset-tab="military">防务 (${counts.military})</button>
          </div>
          <div class="cv-asset-list">
            ${filteredAssets.length ? filteredAssets.map((a) => `
              <div class="cv-asset-item" data-asset-uid="${escHtml(a.uid)}">
                <div class="cv-asset-left">
                  <span class="cv-asset-icon">${escHtml(a.icon)}</span>
                  <div style="min-width:0">
                    <div class="cv-asset-name">${escHtml(a.name)}</div>
                    <div class="cv-asset-sub">${escHtml(a.subtitle)}</div>
                  </div>
                </div>
                <span class="cv-asset-metric">${escHtml(a.metric)}</span>
              </div>
            `).join("") : `<div class="cv-empty">当前分类暂无本地记录</div>`}
          </div>
        </section>

        <!-- 6. Peers -->
        <section class="cv-section">
          <div class="cv-sec-head">
            <h3 class="cv-sec-title">6. 同梯队对比 (Peers)</h3>
            <span class="cv-sec-sub">点击直接跳转</span>
          </div>
          <div class="cv-peers-list">
            ${peers.map((p) => `
              <div class="cv-peer-card" data-peer-kind="${p.kind}" data-peer-ref="${escHtml(p.ref)}">
                <div>
                  <div class="cv-peer-name">${escHtml(p.name)}</div>
                  <div class="cv-peer-sub">${escHtml(p.sub)}${p.item.badge ? ` · ${escHtml(p.item.badge)}` : ""}</div>
                </div>
                <div class="cv-peer-col">
                  <strong>${escHtml(fmtGdp(p.item.gdp))}</strong>
                  <small>GDP</small>
                </div>
                <div class="cv-peer-col">
                  <strong>${escHtml(fmtMoney(p.item.gdp_per_capita))}</strong>
                  <small>人均</small>
                </div>
                <div class="cv-peer-col">
                  <strong>${p.item.stem_share ? fmtShare(p.item.stem_share) : "—"}</strong>
                  <small>STEM</small>
                </div>
              </div>
            `).join("")}
          </div>
        </section>
      </div>
    `;

    bindDockEvents();
  }

  function bindDockEvents() {
    if (!dockEl) return;

    dockEl.querySelector('[data-cv-action="close"]')?.addEventListener("click", () => {
      closeCityView({ restoreCamera: true });
    });

    dockEl.querySelector('[data-cv-action="drawer"]')?.addEventListener("click", () => {
      openDrawer();
    });

    dockEl.querySelector('[data-cv-action="recenter"]')?.addEventListener("click", () => {
      if (currentFootprint?.bounds) {
        const b = currentFootprint.bounds;
        let lift = 0;
        if (isElevation25D(app?.state) && app?.w?.elev) {
          const c = typeof app.w.cellAt === "function" ? app.w.cellAt(currentFootprint.cx, currentFootprint.cy) : -1;
          if (c >= 0) lift = elevLiftKm(app.w.elev[c]);
        }
        app.fitBounds?.(b.x0, b.y0 - lift, b.x1, b.y1 - lift, { padding: 48 });
      }
    });

    dockEl.querySelector("[data-cv-prov-select]")?.addEventListener("change", (ev) => {
      open("province", Number(ev.target.value), { preserveCamera: true });
    });

    dockEl.querySelectorAll("[data-hop-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        open(btn.dataset.hopKind, btn.dataset.hopRef, { preserveCamera: true });
      });
    });

    dockEl.querySelectorAll("[data-citizen-role]").forEach((el) => {
      el.addEventListener("click", () => {
        selectedCitizenRole = el.dataset.citizenRole;
        renderDock();
      });
    });

    dockEl.querySelectorAll("[data-district-idx]").forEach((card) => {
      const idx = Number(card.dataset.districtIdx);
      const plaque = currentPlaques.find((p) => p.index === idx);
      card.addEventListener("mouseenter", () => {
        mapLayer.setHoveredDistrict(idx);
        if (plaque) mapLayer.pingAt(plaque.x, plaque.y, plaque.meta.color, plaque.district.name);
      });
      card.addEventListener("mouseleave", () => {
        mapLayer.setHoveredDistrict(-1);
      });
      card.addEventListener("click", () => {
        if (plaque) {
          mapLayer.pingAt(plaque.x, plaque.y, plaque.meta.color, plaque.district.name);
          let lift = 0;
          if (isElevation25D(app?.state) && app?.w?.elev) {
            const c = plaque.cell >= 0 ? plaque.cell : (typeof app.w.cellAt === "function" ? app.w.cellAt(plaque.x, plaque.y) : -1);
            if (c >= 0) lift = elevLiftKm(app.w.elev[c]);
          }
          app.fitBounds?.(plaque.x - 55, plaque.y - lift - 55, plaque.x + 55, plaque.y - lift + 55, { padding: 44 });
        }
      });
    });

    dockEl.querySelectorAll("[data-asset-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeAssetTab = tab.dataset.assetTab;
        renderDock();
      });
    });

    dockEl.querySelectorAll("[data-asset-uid]").forEach((row) => {
      const a = currentAssets.find((item) => item.uid === row.dataset.assetUid);
      if (!a) return;
      row.addEventListener("mouseenter", () => {
        mapLayer.setHoveredAsset(a.uid);
        mapLayer.pingAt(a.x, a.y, "#ecd08e", a.name);
      });
      row.addEventListener("mouseleave", () => {
        mapLayer.setHoveredAsset(null);
      });
      row.addEventListener("click", () => {
        mapLayer.setHoveredAsset(a.uid);
        mapLayer.pingAt(a.x, a.y, "#ecd08e", a.name);
        if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
          let lift = 0;
          if (isElevation25D(app?.state) && app?.w?.elev) {
            const c = a.cell >= 0 ? a.cell : (typeof app.w.cellAt === "function" ? app.w.cellAt(a.x, a.y) : -1);
            if (c >= 0) lift = elevLiftKm(app.w.elev[c]);
          }
          app.fitBounds?.(a.x - 75, a.y - lift - 75, a.x + 75, a.y - lift + 75, { padding: 48 });
        }
      });
    });

    dockEl.querySelectorAll("[data-peer-kind]").forEach((card) => {
      card.addEventListener("click", () => {
        open(card.dataset.peerKind, card.dataset.peerRef, { preserveCamera: true });
      });
    });
  }

  async function open(kind, ref, opts = {}) {
    // Capture prior camera synchronously BEFORE any await / focusCity animation mutates cam
    if (!opts.preserveCamera && !app.modes?.is?.("city") && !savedCamera) {
      savedCamera = cloneCamera();
    }
    const seq = ++openSeq;
    await ensureCityViewData(app);
    if (seq !== openSeq) return null;

    const entity = resolveTarget(kind, ref, app);
    if (!entity) {
      app.ui?.showToast?.("未找到对应的省市视图数据");
      return null;
    }

    if (!app.modes?.is?.("city")) {
      app.modes?.enter?.("city", { kind: entity.kind, id: entity.id });
    }
    app.panels?.close?.();

    closeDrawer();
    ensureDockContainer();

    selectedCitizenRole = null;
    activeAssetTab = "all";
    currentEntity = entity;
    currentFootprint = computeFootprint(entity, app);
    currentPlaques = layoutDistrictPlaques(entity, currentFootprint, app);
    currentAssets = collectLocalAssets(entity, currentFootprint, app);

    mapLayer.setTarget(currentEntity, currentFootprint, currentPlaques, currentAssets);
    renderDock();
    callbacks?.onOpened?.(entity);

    // Update URL hash cleanly without clobbering
    if (!opts.skipHash) {
      if (entity.kind === "city") {
        app.hash?.del?.("province");
        app.hash?.set?.({ city: entity.id, view: "city" });
      } else {
        app.hash?.del?.("city");
        app.hash?.set?.({ province: entity.id, view: "city" });
      }
    }

    // Fit map bounds around footprint
    if (opts.fit !== false && currentFootprint?.bounds) {
      const b = currentFootprint.bounds;
      let lift = 0;
      if (isElevation25D(app?.state) && app?.w?.elev) {
        const c = typeof app.w.cellAt === "function" ? app.w.cellAt(currentFootprint.cx, currentFootprint.cy) : -1;
        if (c >= 0) lift = elevLiftKm(app.w.elev[c]);
      }
      app.fitBounds?.(b.x0, b.y0 - lift, b.x1, b.y1 - lift, { padding: entity.kind === "city" ? 60 : 44 });
    }
    app.requestDraw?.();
    return entity;
  }

  // ---- 34-Province Drawer / Selector ----
  function ensureDrawer() {
    if (drawerEl) return drawerEl;
    drawerEl = document.createElement("div");
    drawerEl.className = "cv-drawer-backdrop";
    drawerEl.hidden = true;
    drawerEl.innerHTML = `
      <div class="cv-drawer" role="dialog" aria-label="34省全览与核心城市视图选择器">
        <div class="cv-drawer-head">
          <div>
            <h2 class="cv-drawer-title">🏛️ 中华文明 · 34个省级行政区与核心城市全览</h2>
          </div>
          <div class="cv-drawer-controls">
            <input type="search" class="cv-drawer-search" placeholder="搜索省份、城市、徽章 (如 深圳/双学院/西藏)..." />
            <button type="button" class="cv-icon-btn" data-cv-drawer-close>✕ 关闭</button>
          </div>
        </div>
        <div class="cv-drawer-body"></div>
      </div>
    `;
    drawerEl.addEventListener("click", (e) => {
      if (e.target === drawerEl) closeDrawer();
    });
    drawerEl.querySelector("[data-cv-drawer-close]")?.addEventListener("click", closeDrawer);
    drawerEl.querySelector(".cv-drawer-search")?.addEventListener("input", (e) => {
      renderDrawerBody(e.target.value);
    });
    document.body.appendChild(drawerEl);
    return drawerEl;
  }

  function renderDrawerBody(query = "") {
    if (!drawerEl) return;
    const body = drawerEl.querySelector(".cv-drawer-body");
    if (!body) return;

    const states = app.data?.states || app.state?.states || [];
    const cities = app.data?.cities || app.state?.cities || [];
    const distProvs = app.data?.districts?.provinces || {};
    const distCities = app.data?.districts?.cities || {};
    const q = String(query || "").trim().toLowerCase();

    const grouped = new Map(REGION_ORDER.map((r) => [r, []]));
    states.forEach((st, idx) => {
      const reg = getProvinceRegion(st);
      if (!grouped.has(reg)) grouped.set(reg, []);
      const provCities = cities.filter((c) => Number(c.province_idx) === idx);
      const dist = distProvs[String(st.code)] || distProvs[String(idx)] || {};
      const badge = dist.badge || st.badge || "";

      if (q) {
        const provMatch = `${st.name} ${st.abbr} ${st.capital || ""} ${badge} ${reg}`.toLowerCase().includes(q);
        const matchingCities = provCities.filter((c) => {
          const cd = distCities[c.id] || {};
          return `${c.name} ${c.full || ""} ${cd.badge || c.badge || ""}`.toLowerCase().includes(q);
        });
        if (!provMatch && !matchingCities.length) return;
      }
      grouped.get(reg).push({ st, idx, provCities, badge });
    });

    const groupsHtml = [];
    for (const [region, list] of grouped.entries()) {
      if (!list.length) continue;
      groupsHtml.push(`
        <div class="cv-region-group">
          <div class="cv-region-title">
            <span>${escHtml(region)} (${list.length})</span>
            <span style="font-size:11px;color:#9e9479;font-family:system-ui,sans-serif">点击省份或城市进入文明视图</span>
          </div>
          <div class="cv-prov-grid">
            ${list.map(({ st, idx, provCities, badge }) => `
              <div class="cv-prov-card">
                <div class="cv-prov-card-top" data-drawer-prov="${idx}">
                  <div class="cv-prov-id">
                    <div class="cv-prov-abbr" style="background:${getProvinceColor(idx, app)}">${escHtml(st.abbr || st.name.slice(0, 1))}</div>
                    <div style="min-width:0">
                      <div class="cv-prov-name">${escHtml(st.name)}</div>
                      <div class="cv-prov-meta">${escHtml(fmtGdp(st.gdp))} · ${escHtml(fmtPop(st.population))}${badge ? ` · ${escHtml(badge)}` : ""}</div>
                    </div>
                  </div>
                  <span class="cv-prov-enter">进入 ›</span>
                </div>
                ${provCities.length ? `
                  <div class="cv-prov-cities">
                    ${provCities.map((c) => `<button type="button" class="cv-mini-city-btn" data-drawer-city="${escHtml(c.id || c.name)}">${escHtml(c.name)}</button>`).join("")}
                  </div>
                ` : ""}
              </div>
            `).join("")}
          </div>
        </div>
      `);
    }

    body.innerHTML = groupsHtml.length ? groupsHtml.join("") : `<div class="cv-empty">没有匹配 "${escHtml(query)}" 的省市</div>`;

    body.querySelectorAll("[data-drawer-prov]").forEach((el) => {
      el.addEventListener("click", () => {
        open("province", Number(el.dataset.drawerProv));
      });
    });
    body.querySelectorAll("[data-drawer-city]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        open("city", btn.dataset.drawerCity);
      });
    });
  }

  async function openDrawer() {
    await ensureCityViewData(app);
    const el = ensureDrawer();
    const input = el.querySelector(".cv-drawer-search");
    if (input) input.value = "";
    renderDrawerBody("");
    el.hidden = false;
    bindDrawerEsc();
    callbacks?.onDrawerChange?.(true);
    input?.focus();
  }

  function closeDrawer() {
    if (drawerEl) drawerEl.hidden = true;
    unbindDrawerEsc();
    callbacks?.onDrawerChange?.(false);
  }

  function focusDistrictCard(idx) {
    if (!dockEl) return;
    mapLayer.setHoveredDistrict(idx);
    const card = dockEl.querySelector(`[data-district-idx="${idx}"]`);
    if (card) {
      dockEl.querySelectorAll(".cv-district-card.active").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function focusAssetCard(uid) {
    if (!dockEl) return;
    mapLayer.setHoveredAsset(uid);
    const card = dockEl.querySelector(`[data-asset-uid="${CSS.escape(uid)}"]`);
    if (card) {
      dockEl.querySelectorAll(".cv-asset-item.active").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function toggleDrawer() {
    if (drawerEl && !drawerEl.hidden) {
      closeDrawer();
    } else {
      openDrawer();
    }
  }

  return {
    open,
    close: closeCityView,
    clearDock,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    focusDistrictCard,
    focusAssetCard,
    restoreCamera,
    isDrawerOpen: () => Boolean(drawerEl && !drawerEl.hidden),
    get current() {
      return currentEntity;
    },
  };
}
