// 文明百科 Almanac modal (Yields, Districts & Citizens, Wonder Rules, 19 Lenses, Sources)

import { escHtml } from '../format.js';

const PEDIA_TABS = [
  { id: 'yields', label: '五大产出体系' },
  { id: 'districts', label: '城区与市民规则' },
  { id: 'wonders', label: '奇观遴选标准' },
  { id: 'lenses', label: '19种地图视角' },
  { id: 'sources', label: '权威数据源' },
];

export function initPedia(app) {
  const modalRoot = document.getElementById('modal-root');

  async function open(initialTab = 'yields') {
    let activeTab = PEDIA_TABS.some((t) => t.id === initialTab) ? initialTab : 'yields';

    // Load sources/wonders/lenses if not yet loaded
    await Promise.allSettled([
      app.loadData('sources'),
      app.loadData('wonders'),
      app.loadData('lenses'),
    ]);

    function render() {
      let bodyHtml = '';
      if (activeTab === 'yields') {
        bodyHtml = `
          <div class="pedia-grid">
            <div class="pedia-card">
              <h4 style="color:#8fd47e;">🌾 粮食 / 农业产出</h4>
              <p>由各省与城市农林牧渔增加值、粮食产量与第一产业就业人口共同映射，体现胡焕庸线东南冲积平原与东北黑土带的供养能力。</p>
            </div>
            <div class="pedia-card">
              <h4 style="color:#e69d5c;">⚙️ 生产力 / 工业制造</h4>
              <p>基于第二产业（制造业、采矿业、电力热力燃气及建筑业）增加值与从业人员密度，反映长三角、珠三角、成渝及辽中南的实体制造根基。</p>
            </div>
            <div class="pedia-card">
              <h4 style="color:#f2d16b;">💰 金币 / 地区生产总值</h4>
              <p>对应地区生产总值（GDP）、金融与商业服务产出及居民人均可支配收入。全国口径已明确标注内地与港澳台合并统计。</p>
            </div>
            <div class="pedia-card">
              <h4 style="color:#72c7f2;">🔬 科技 / 科创与研发</h4>
              <p>统计信息传输、软件与信息技术服务、科学研究及技术服务业从业人员，并结合国家实验室、大科学装置与高校研发经费。</p>
            </div>
            <div class="pedia-card">
              <h4 style="color:#d59bf6;">🎭 文化 / 文旅与遗产</h4>
              <p>汇总文化体育娱乐业产出、世界遗产、国家级非遗与国家公园/重点景区年接待规模，映射中华多民族地域文化多样性。</p>
            </div>
          </div>`;
      } else if (activeTab === 'districts') {
        bodyHtml = `
          <div class="pedia-grid">
            <div class="pedia-card">
              <h4>🎓 北京双学院区（Dual Campus）</h4>
              <p>城市视图中北京独占两座学院区：<strong>海淀高教学院区</strong>（高校密集科研引擎）与<strong>中关村·怀柔科学城学院区</strong>（大科学装置与前沿科创集群），凸显高教与研发双重集聚优势。</p>
            </div>
            <div class="pedia-card">
              <h4>🏦 上海金融中心</h4>
              <p>上海拥有标志性商业金融区（<strong>金融中心</strong>）与超群区位熵（LQ），聚合陆家嘴银行、证券、保险、航运交易与跨境人民币清算职能。</p>
            </div>
            <div class="pedia-card">
              <h4>⚡ 深圳「每5人中1名STEM人才」</h4>
              <p>全国劳动人口中平均约 <strong>每 14 名劳动者中有 1 名</strong> 工程师、程序员或科研人员（约 7.1%）；深圳则达到惊人的 <strong>每 5 名劳动者中有 1 名</strong>（约 20%），成为名副其实的硅硬件与软件创新之都。</p>
            </div>
            <div class="pedia-card">
              <h4>🏛️ 区位熵（LQ）判定法则</h4>
              <p>专业城区（学院区、商业中心、工业区、港口区、防务区、剧院广场、航天科创港）依据当地该行业就业占比与全国均值的比值（LQ）严格授予，而非主观臆断。</p>
            </div>
          </div>`;
      } else if (activeTab === 'wonders') {
        const rules = app.data.wonders?.rules || [];
        const wonders = app.data.wonders?.wonders || [];
        bodyHtml = `
          <div style="margin-bottom:12px;">
            <div class="qp-sec-lbl" style="font-size:12px;color:var(--gold-bright);">四大公开遴选规则（Rules）</div>
            <div class="pedia-grid">
              ${
                rules.length
                  ? rules
                      .map(
                        (r) => `
                  <div class="pedia-card">
                    <h4>${escHtml(r.title || r.name || r.id)}</h4>
                    <p>${escHtml(r.description || r.rule || '')}</p>
                  </div>`
                      )
                      .join('')
                  : `
                  <div class="pedia-card"><h4>国家公园与自然遗产</h4><p>按国家公园首批名单及年接待游客量与生态保护面积遴选。</p></div>
                  <div class="pedia-card"><h4>顶尖研究型大学</h4><p>严格按教育部/科技部公开年度研发经费支出排名 Top 18 入选。</p></div>
                  <div class="pedia-card"><h4>世界文化遗产</h4><p>依据 UNESCO 世界文化遗产及国家级国宝集群分布遴选。</p></div>
                  <div class="pedia-card"><h4>超级工程奇观</h4><p>涵盖三峡、青藏铁路、港珠澳大桥、南水北调、中国天眼 FAST、白鹤滩等跨时代工程。</p></div>`
              }
            </div>
          </div>
          <div class="qp-sec-lbl" style="font-size:12px;color:var(--gold-bright);">已收录奇观（共 ${wonders.length} 项）</div>
          <table class="civ-table">
            <thead><tr><th>名称</th><th>类别</th><th>所在地区</th><th>入选指标 / 说明</th></tr></thead>
            <tbody>
              ${wonders
                .slice(0, 80)
                .map(
                  (wn) => `
                <tr class="clickable" data-wcell="${wn.cell ?? -1}" data-wx="${wn.x ?? ''}" data-wy="${wn.y ?? ''}">
                  <td><strong>${escHtml(wn.name)}</strong></td>
                  <td>${escHtml(wn.kind || '')}</td>
                  <td>${escHtml(wn.city_name || '')}</td>
                  <td style="color:var(--ink-dim);">${escHtml(wn.description || '')}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>`;
      } else if (activeTab === 'lenses') {
        const groups = app.data.lenses?.groups || [];
        const lenses = app.data.lenses?.lenses || [];
        bodyHtml = `
          <div class="pedia-grid">
            ${lenses
              .map((l) => {
                const grp = groups.find((g) => g.id === l.group)?.label || l.group || '';
                return `
                <div class="pedia-card">
                  <h4>${escHtml(l.label || l.name)} <span style="font-size:11px;color:var(--ink-dim);">(${escHtml(grp)})</span></h4>
                  <p>${escHtml(l.description || '覆盖全国 1,302 个县域单元的精细化专题视角。')}</p>
                  <div style="margin-top:8px;">
                    <button class="civ-btn subtle" data-lens-pick="${escHtml(l.id)}" style="padding:3px 9px;font-size:11px;">切换此视角</button>
                  </div>
                </div>`;
              })
              .join('')}
          </div>`;
      } else if (activeTab === 'sources') {
        const sources = Array.isArray(app.data.sources) ? app.data.sources : app.data.sources?.sources || [];
        bodyHtml = `
          <p style="margin-top:0;color:var(--ink-dim);">共收录 <strong>${sources.length}</strong> 项公开权威地理、统计与基础设施数据源（覆盖中国内地31省区市及港澳台地区）：</p>
          <table class="civ-table">
            <thead><tr><th>数据源名称</th><th>发布机构</th><th>年份</th><th>说明与链接</th></tr></thead>
            <tbody>
              ${sources
                .map(
                  (s) => `
                <tr>
                  <td><strong>${escHtml(s.name)}</strong></td>
                  <td>${escHtml(s.org || '')}</td>
                  <td>${escHtml(s.vintage || '')}</td>
                  <td style="color:var(--ink-dim);">
                    ${escHtml(s.description || '')}
                    ${s.url ? ` <a href="${escHtml(s.url)}" target="_blank" rel="noopener" style="color:var(--gold-bright);">[来源]</a>` : ''}
                  </td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>`;
      }

      modalRoot.innerHTML = `
        <div class="modal-card">
          <div class="modal-head">
            <h2 class="modal-title">中华文明百科 · Civilopedia &amp; 数据源</h2>
            <button class="modal-close" type="button" aria-label="关闭">✕</button>
          </div>
          <div class="modal-tabs">
            ${PEDIA_TABS.map(
              (t) => `<button class="modal-tab ${t.id === activeTab ? 'active' : ''}" data-tab="${t.id}">${escHtml(t.label)}</button>`
            ).join('')}
          </div>
          <div class="modal-body">${bodyHtml}</div>
        </div>
      `;

      modalRoot.classList.remove('hidden');
      modalRoot.querySelector('.modal-close')?.addEventListener('click', close);
      modalRoot.querySelectorAll('.modal-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeTab = btn.dataset.tab;
          render();
        });
      });
      modalRoot.querySelectorAll('[data-lens-pick]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const lid = btn.dataset.lensPick;
          close();
          app.setLens(lid);
        });
      });
      modalRoot.querySelectorAll('tr[data-wcell]').forEach((tr) => {
        tr.addEventListener('click', () => {
          const wx = Number(tr.dataset.wx);
          const wy = Number(tr.dataset.wy);
          const cell = Number(tr.dataset.wcell);
          close();
          if (!app.getLayer('wonders')) app.setLayer('wonders', true);
          const tx = Number.isFinite(wx) && tr.dataset.wx !== '' ? wx : app.w?.cx(cell);
          const ty = Number.isFinite(wy) && tr.dataset.wy !== '' ? wy : app.w?.cy(cell);
          if (tx != null && ty != null) {
            app.cam.animateTo(tx, ty, Math.max(app.cam.zoom, 0.9));
            app.setHighlight({ pulse: { x: tx, y: ty, color: '#f2cb72' } });
          }
        });
      });
    }

    render();
  }

  function close() {
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML = '';
  }

  app.openPedia = open;
  return { open, close };
}
