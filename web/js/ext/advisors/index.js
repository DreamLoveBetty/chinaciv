// Entry point for ChinaCiv 9 Civilization Advisors & 1,302-County Explorer.
// Exports install(app), registers Topbar buttons ("9位顾问", "探索者"), left dock (~460px),
// bidirectional map sync, and URL hash integration (#advisor=<id>).
import { buildData, ensureDatasets } from "./core/data.js?v=20261127-5";
import { createLinker, createBubbles, createMapTip } from "./core/link.js?v=20261127-5";
import { emblem } from "./core/emblems.js";
import { frameNation } from "./core/frame.js?v=20261127-5";
import { esc, el } from "./core/util.js";
import { iconHtml } from "../../icons.js";

export const ADVISORS = [
  { id: "energy", name: "能源与资源大臣", role: "司矿掌电", color: "#d98a2b", dark: "#3a1f08", blurb: "全国风光水火核抽蓄装机与战略矿产分布。", load: () => import("./views/energy.js?v=20261127-5") },
  { id: "economy", name: "财政大臣", role: "司农度支", color: "#c9a43a", dark: "#3a2c08", blurb: "34省与重点城市GDP、人均产出及产业结构。", load: () => import("./views/economy.js") },
  { id: "people", name: "户籍大司徒", role: "版籍核口", color: "#c46a4f", dark: "#3a140c", blurb: "胡焕庸线东西人口对比、密度、迁徙与年龄。", load: () => import("./views/people.js?v=20261127-5") },
  { id: "prosperity", name: "民生典客", role: "安居厚生", color: "#3f9c82", dark: "#082a22", blurb: "人均可支配收入、房价收入比、自有房与低收入关注。", load: () => import("./views/prosperity.js") },
  { id: "knowledge", name: "国子监祭酒", role: "格致兴学", color: "#4a86d6", dark: "#0a1c3a", blurb: "高校学历、宽带、STEM人才（深圳1/5 vs 全国1/14）及顶尖科研大学。", load: () => import("./views/knowledge.js?v=20261127-5") },
  { id: "land", name: "舆地测绘官", role: "山川土宜", color: "#6e9a3c", dark: "#18280a", blurb: "全国及34省森林、耕地、草原、荒漠、高寒、湿地与城镇占比。", load: () => import("./views/land.js") },
  { id: "military", name: "大将军", role: "五大战区", color: "#8796ab", dark: "#141b26", blurb: "五大解放军战区、海陆空天火箭军基地与靶场分布。", load: () => import("./views/military.js?v=20261127-5") },
  { id: "commerce", name: "市舶提举", role: "通商转运", color: "#2fa4b8", dark: "#062630", blurb: "40条省际货运干线、沿海内河大港与繁忙空港枢纽。", load: () => import("./views/commerce.js?v=20261127-5") },
  { id: "culture", name: "太常礼官", role: "礼乐灾异", color: "#c25b9a", dark: "#2e0c22", blurb: "公开规则奇观榜、文化传统、健康福祉与地震灾害记录。", load: () => import("./views/culture.js?v=20261127-5") },
  { id: "explorer", name: "探索者 · 1,302县", role: "舆图格物", color: "#9a7bc9", dark: "#1e1236", blurb: "自由切片34省/城市/1,302县全指标：散点相关性、框选地图联动与CSV导出。", load: () => import("./views/explorer.js?v=20261127-5") },
];

const byId = new Map(ADVISORS.map((a) => [a.id, a]));

const COUNCIL_GROUPS = [
  { label: "国计与财赋", ids: ["economy", "prosperity", "commerce", "energy"] },
  { label: "民生与疆域", ids: ["people", "knowledge", "culture", "land"] },
  { label: "国防与战备", ids: ["military"] },
  { label: "自主数据探索", ids: ["explorer"] },
];

const dockW = () =>
  window.innerWidth >= 1200 ? 460 : Math.round(Math.min(460, Math.max(340, window.innerWidth * 0.38)));

function injectCss() {
  if (document.getElementById("advisors-css")) return;
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  if (links.some((l) => (l.getAttribute("href") || "").includes("advisors.css"))) return;
  const l = document.createElement("link");
  l.id = "advisors-css";
  l.rel = "stylesheet";
  l.href = "css/advisors.css";
  document.head.appendChild(l);
}

export function install(app) {
  injectCss();
  let data = null;
  let dataP = null;
  let dock = null;
  let active = null; // { adv, api, cleanup, bubbles, token, savedLens, savedRf, savedShowRes, savedTrade }
  let current = null; // "council" or advisor id
  let lastAdvisorId = null;
  let framedFor = null;
  let prevCam = null;
  let token = 0;

  const link = createLinker(app);
  const tip = createMapTip();

  const ensureData = () =>
    (dataP ??= ensureDatasets(app, ["counties", "sources", "states", "cities", "nation", "lenses"]).then(() => {
      data = buildData(app);
      return data;
    }));

  // --- Two required Topbar buttons ------------------------------------------------------------------------------
  const btnAdvisors = app.ui.addTopButton({
    id: "advisors",
    label: "9位顾问",
    icon: "council",
    title: "打开9位治国顾问面板 (#advisor=council)",
    onClick: () => {
      if (app.modes.is("advisor") && current !== "explorer") {
        app.modes.leave("advisor");
      } else {
        app.modes.enter("advisor", { id: lastAdvisorId });
      }
    },
  });

  const btnExplorer = app.ui.addTopButton({
    id: "explorer",
    label: "探索者",
    icon: "explorer",
    title: "打开1,302县多维散点与数据表探索器 (#advisor=explorer)",
    onClick: () => {
      if (app.modes.is("advisor") && current === "explorer") {
        app.modes.leave("advisor");
      } else {
        app.modes.enter("advisor", { id: "explorer", level: "counties" });
      }
    },
  });

  function syncTopButtons() {
    const inMode = app.modes.is("advisor");
    const onAdv = inMode && current !== "explorer";
    const onExp = inMode && current === "explorer";
    btnAdvisors?.setAttribute("aria-pressed", String(onAdv));
    btnAdvisors?.setActive?.(onAdv);
    btnExplorer?.setAttribute("aria-pressed", String(onExp));
    btnExplorer?.setActive?.(onExp);
  }
  app.on("mode", syncTopButtons);

  // --- Left Dock Shell (~460px desktop) -------------------------------------------------------------------------
  function ensureShell() {
    dock = app.ui.setDock("left", dockW());
    if (!dock) return null;
    const existing = dock.querySelector(".adv-root");
    if (existing) return existing;
    dock.innerHTML = "";
    dock.classList.add("adv-dock");
    const root = el("div", "adv-root");
    root.innerHTML = `
      <div class="adv-grip" aria-hidden="true"></div>
      <header class="adv-head">
        <button type="button" class="adv-council-btn" data-adv="council" title="返回9位顾问总览">
          ${iconHtml("council", "🏛️")}<span>内阁总览</span>
        </button>
        <nav class="adv-tabs" role="tablist" aria-label="治国顾问">
          ${ADVISORS.map(
            (a) =>
              `<button type="button" role="tab" data-adv="${esc(a.id)}" aria-selected="false" title="${esc(`${a.name} · ${a.role}`)}" style="--adv:${esc(a.color)}">${emblem(a, 28)}<span class="sr-only">${esc(a.name)}</span></button>`
          ).join("")}
        </nav>
        <button type="button" class="adv-close" aria-label="关闭顾问面板 (Esc)" title="关闭 (Esc)">✕</button>
      </header>
      <div class="adv-main" tabindex="-1"></div>`;
    dock.appendChild(root);

    root.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.classList.contains("adv-close")) {
        app.modes.leave("advisor");
        return;
      }
      if (btn.dataset.adv) {
        switchTo(btn.dataset.adv === "council" ? null : btn.dataset.adv);
        return;
      }
      if (btn.hasAttribute("data-frame")) {
        if (!link.frame()) frameNation(app);
      }
    });

    root.querySelector(".adv-tabs").addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const tabs = [...root.querySelectorAll(".adv-tabs [role=tab]")];
      let i = tabs.indexOf(document.activeElement);
      i =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? tabs.length - 1
            : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault();
      tabs[i].focus();
      switchTo(tabs[i].dataset.adv);
    });

    return root;
  }

  function teardownView() {
    if (!active) return;
    const a = active;
    active = null;
    try {
      a.api?.destroy?.();
    } catch (err) {
      console.error("[advisors.destroy]", err);
    }
    for (const fn of a.cleanup.splice(0).reverse()) {
      try {
        fn();
      } catch (err) {
        console.error("[advisors.cleanup]", err);
      }
    }
    for (const b of a.bubbles.splice(0)) {
      try {
        b.destroy();
      } catch (err) {
        console.error("[advisors.bubbles]", err);
      }
    }
    link.clear();
    tip.hide();
  }

  function titleHtml(adv) {
    return `<div class="adv-title">
      ${emblem(adv, 54, adv.name)}
      <div class="adv-titles">
        <div class="adv-kind">${esc(adv.role)}</div>
        <h2>${esc(adv.name)}</h2>
        <p>${esc(adv.blurb)}</p>
      </div>
    </div>`;
  }

  function councilHtml() {
    return `
      <div class="adv-title council">
        <div class="adv-titles">
          <div class="adv-kind">中华文明 · 治国议政厅</div>
          <h2>9位内阁顾问与探索者</h2>
          <p>每位顾问掌管国家运行的一个核心维度。悬停任意条目可即时高亮对应省、市、县或设施，点击即可下钻定位；在地图上悬停或点击也会反向联动定位列表。</p>
        </div>
      </div>
      ${COUNCIL_GROUPS.map(
        (g) => `<h4 class="adv-council-h">${esc(g.label)}</h4>
        <div class="adv-council">
          ${g.ids
            .map((id) => byId.get(id))
            .filter(Boolean)
            .map(
              (a) => `<button type="button" class="adv-card" data-adv="${esc(a.id)}" style="--adv:${esc(a.color)}">
                ${emblem(a, 46)}
                <span class="t">
                  <span class="r">${esc(a.role)}</span>
                  <b>${esc(a.name)}</b>
                  <span class="d">${esc(a.blurb)}</span>
                </span>
              </button>`
            )
            .join("")}
        </div>`
      ).join("")}
      <p class="adv-note pad">全部指标均来自公开权威统计与地理信息数据集（国家统计局、第七次全国人口普查、自然资源部、WRI/能源局、生态环境部、USGS/地震台网、卫健委及交通/民航部等），各面板底部均附完整出处与口径说明。</p>`;
  }

  async function show(id, params = {}) {
    const my = ++token;
    const root = ensureShell();
    if (!root) return;
    const adv = id && byId.has(id) ? byId.get(id) : null;
    current = adv ? adv.id : "council";
    if (adv && adv.id !== "explorer") lastAdvisorId = adv.id;

    app.hash?.set?.("advisor", current);
    syncTopButtons();

    root.style.setProperty("--adv", adv?.color || "#c9a45c");
    root.querySelectorAll(".adv-tabs [role=tab]").forEach((b) => {
      const on = b.dataset.adv === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on || (!adv && b === root.querySelector(".adv-tabs [role=tab]")) ? 0 : -1;
    });
    root.querySelector(".adv-council-btn")?.setAttribute("aria-pressed", String(!adv));

    teardownView();

    if (current !== framedFor) {
      framedFor = current;
      requestAnimationFrame(() => {
        if (my === token && app.modes.is("advisor")) frameNation(app);
      });
    }

    const main = root.querySelector(".adv-main");
    main.scrollTop = 0;
    if (dock) dock.scrollTop = 0;

    if (!adv) {
      main.innerHTML = councilHtml();
      main.querySelectorAll(".adv-card").forEach((card) =>
        card.addEventListener("click", () => switchTo(card.dataset.adv))
      );
      return;
    }

    main.innerHTML = `${titleHtml(adv)}<div class="adv-body"><div class="adv-loading">正在调取${esc(adv.name)}数据档案…</div></div>`;
    let mod;
    try {
      [mod] = await Promise.all([adv.load(), ensureData()]);
    } catch (err) {
      console.error(`[advisors.load:${adv.id}]`, err);
      if (my === token) {
        main.querySelector(".adv-body").innerHTML = `<p class="adv-empty pad">面板加载失败：${esc(err?.message || err)}</p>`;
      }
      return;
    }
    if (my !== token || !app.modes.is("advisor")) return;

    const body = main.querySelector(".adv-body");
    const loading = body.querySelector(".adv-loading");

    const a = { adv, api: null, cleanup: [], bubbles: [], token: my };
    active = a;

    const ctx = {
      app,
      data,
      el: body,
      link,
      tip,
      params: params || {},
      advisor: adv,
      on(ev, fn) {
        const off = app.on(ev, fn);
        a.cleanup.push(off);
        return off;
      },
      bubbles(bid, opts = {}) {
        const b = createBubbles(app, `adv-${adv.id}-${bid}`, opts);
        a.bubbles.push(b);
        return b;
      },
      setResourceFilter(rf) {
        if (!a.savedRf) {
          a.savedRf = { v: app.state.resourceFilter };
          a.cleanup.push(() => app.setResourceFilter?.(a.savedRf.v));
        }
        app.setResourceFilter?.(rf);
      },
      setShowResources(on) {
        if (!a.savedShowRes) {
          a.savedShowRes = { v: app.state.showResources };
          a.cleanup.push(() => app.setShowResources?.(a.savedShowRes.v));
        }
        app.setShowResources?.(on);
      },
      setLayer(layerId, on) {
        if (!a.savedLayers) a.savedLayers = new Map();
        if (!a.savedLayers.has(layerId)) {
          const prev = app.getLayer?.(layerId) ?? app.state.layers?.[layerId] ?? false;
          a.savedLayers.set(layerId, prev);
          a.cleanup.push(() => app.setLayer?.(layerId, prev));
        }
        app.setLayer?.(layerId, on);
      },
      setLens(ref) {
        if (!a.savedLens) {
          a.savedLens = { lens: app.state.lens, ours: new Set() };
          a.cleanup.push(() => {
            const cur = app.state.lens;
            if (cur === a.savedLens.lens || (cur && !a.savedLens.ours.has(cur))) return;
            app.setLens?.(a.savedLens.lens || null);
          });
        }
        app.setLens?.(ref);
        if (app.state.lens) a.savedLens.ours.add(app.state.lens);
      },
      switchTo,
      cleanup: (fn) => a.cleanup.push(fn),
    };

    try {
      a.api = (await mod.mount(ctx)) || {};
    } catch (err) {
      console.error(`[advisors.mount:${adv.id}]`, err);
      body.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">渲染此顾问视图时出错：${esc(err?.message || err)}</p>`);
      a.api = {};
    }
    loading?.remove();
    if (my !== token || !app.modes.is("advisor")) return;

    // If user hovered map before mount finished, let view sync once
    if (app.state.hoverCell >= 0) {
      link.fromMap(() => a.api?.onMapHover?.(app.state.hoverCell));
    }
  }

  function switchTo(id, params = {}) {
    const nextId = id && byId.has(id) ? id : null;
    if (app.modes.is("advisor") && (nextId || "council") === current && !Object.keys(params).length) {
      return;
    }
    if (app.modes.is("advisor")) {
      show(nextId, params);
    } else {
      app.modes.enter("advisor", { ...params, id: nextId });
    }
  }

  // --- Map -> Dashboard Bidirectional Hover & Click -------------------------------------------------------------
  const canvas = document.getElementById("map-canvas");
  let lastBubble = null;

  canvas?.addEventListener("pointermove", (e) => {
    if (!app.modes.is("advisor") || !active || e.pointerType !== "mouse" || e.buttons) return;
    let hit = null;
    let owner = null;
    for (const b of active.bubbles) {
      hit = b.hit(e.clientX, e.clientY);
      if (hit) {
        owner = b;
        break;
      }
    }
    if (hit !== lastBubble) {
      for (const b of active.bubbles) b.setHot(b === owner ? hit.key : null);
      lastBubble = hit;
      link.fromMap(() => {
        owner?.handlers.onHover?.(hit);
        if (!hit) for (const b of active.bubbles) b.handlers.onHover?.(null);
      });
    }
    if (hit && owner?.handlers.tip) tip.show(e.clientX, e.clientY, owner.handlers.tip(hit));
    else tip.hide();
  });

  canvas?.addEventListener("pointerleave", () => {
    if (!active) return;
    if (lastBubble) {
      link.fromMap(() => {
        for (const b of active.bubbles) {
          b.setHot(null);
          b.handlers.onHover?.(null);
        }
      });
      lastBubble = null;
      tip.hide();
    }
    link.fromMap(() => active.api?.onMapHover?.(-1));
  });

  app.on("hover", (payload) => {
    if (!app.modes.is("advisor") || !active || lastBubble) return;
    const cell = typeof payload === "number" ? payload : payload?.cell ?? app.state.hoverCell;
    link.fromMap(() => active.api?.onMapHover?.(cell));
  });

  app.on("mapclick", (ev) => {
    if (!app.modes.is("advisor") || !active) return false;
    const cx = ev?.originalEvent?.clientX ?? ev?.clientX ?? ev?.x;
    const cy = ev?.originalEvent?.clientY ?? ev?.clientY ?? ev?.y;
    if (cx != null && cy != null) {
      for (const b of active.bubbles) {
        const hit = b.hit(cx, cy);
        if (hit && b.handlers.onClick) {
          b.handlers.onClick(hit);
          ev?.consume?.();
          return true;
        }
      }
    }
    const handled = active.api?.onMapClick?.(ev) === true;
    if (handled) ev?.consume?.();
    return handled;
  });

  // --- Mode Registration ----------------------------------------------------------------------------------------
  app.modes.register("advisor", {
    onEnter(params = {}) {
      if (!current && app.cam) {
        prevCam = { x: app.cam.x, y: app.cam.y, zoom: app.cam.zoom };
      }
      const id = params?.id && byId.has(params.id) ? params.id : null;
      show(id, params);
    },
    onExit({ next } = {}) {
      token++;
      teardownView();
      current = null;
      framedFor = null;
      app.hash?.del?.("advisor");
      const d = dock;
      dock = null;
      if (d) {
        d.querySelector(".adv-root")?.remove();
        d.classList.remove("adv-dock");
      }
      app.ui.setDock("left", 0);
      if (next === "map") {
        const p = prevCam;
        if (p && app.cam?.animateTo) {
          app.cam.animateTo(p.x, p.y, p.zoom, { duration: 480 });
        }
      }
      prevCam = null;
      syncTopButtons();
    },
    onEscape() {
      if (active?.api?.onEscape?.() === true) return true;
      return false;
    },
  });

  // --- URL Hash Sync (#advisor=<id>) ----------------------------------------------------------------------------
  const applyHash = (val) => {
    if (val) {
      const id = byId.has(val) ? val : null;
      if (!app.modes.is("advisor")) {
        app.modes.enter("advisor", { id, level: id === "explorer" ? "counties" : undefined });
      } else if ((id || "council") !== current) {
        show(id, id === "explorer" ? { level: "counties" } : {});
      }
    } else if (app.modes.is("advisor")) {
      app.modes.leave("advisor");
    }
  };
  app.hash?.register?.("advisor", applyHash);
  const initial = app.hash?.get?.("advisor");
  if (initial) applyHash(initial);

  // Resize dock smoothly on window resize if open
  window.addEventListener("resize", () => {
    if (app.modes.is("advisor") && dock) {
      app.ui.setDock("left", dockW());
    }
  });

  app.advisors = {
    list: ADVISORS,
    open: (id, params) => switchTo(id, params),
    get current() {
      return current;
    },
    data: () => data,
    ensureData,
  };
}
