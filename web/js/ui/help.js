// Keyboard shortcuts & interactive help guide modal (?)

export function initHelp(app) {
  const modalRoot = document.getElementById('modal-root');

  function open() {
    modalRoot.innerHTML = `
      <div class="modal-card" style="width:min(620px, 94vw);">
        <div class="modal-head">
          <h2 class="modal-title">中华文明 · 操作指南与快捷键</h2>
          <button class="modal-close" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="modal-body">
          <div class="pedia-grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
            <div class="pedia-card">
              <h4>地图导航</h4>
              <p><strong>左键拖拽</strong>：平移中国地图（60fps 离屏缓存）。<br>
                 <strong>滚轮 / 双指捏合</strong>：以光标为中心无极缩放。<br>
                 <strong>单击省域 / 城市名牌</strong>：选中省域或进入城市视图。<br>
                 <strong>点击底部图例区间</strong>：高亮并筛查符合数值区间的县域。</p>
            </div>
            <div class="pedia-card">
              <h4>常用快捷键</h4>
              <p><kbd>/</kbd> 或 <kbd>Ctrl/Cmd+K</kbd>：全局搜索省/市/1,302县/奇观/电站<br>
                 <kbd>R</kbd>：开关战略资源与能源图标<br>
                 <kbd>H</kbd> / <kbd>Home</kbd>：回到全中国标准视野<br>
                 <kbd>+</kbd> / <kbd>-</kbd>：放大 / 缩小地图<br>
                 <kbd>?</kbd>：打开本帮助面板<br>
                 <kbd>Esc</kbd>：关闭当前面板、视图或取消选中</p>
            </div>
          </div>
        </div>
      </div>
    `;
    modalRoot.classList.remove('hidden');
    modalRoot.querySelector('.modal-close')?.addEventListener('click', () => {
      modalRoot.classList.add('hidden');
      modalRoot.innerHTML = '';
    });
  }

  app.openHelp = open;
  return { open };
}
