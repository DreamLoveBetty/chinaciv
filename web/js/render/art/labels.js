// Provincial map labels rendered in serif typography with subtle halo & viewport culling

import { elevLiftKm } from './elevation25d.js?v=20261127-5';

const SHORT_PROV = {
  北京市: '北京', 天津市: '天津', 河北省: '河北', 山西省: '山西', 内蒙古自治区: '内蒙古',
  辽宁省: '辽宁', 吉林省: '吉林', 黑龙江省: '黑龙江', 上海市: '上海', 江苏省: '江苏',
  浙江省: '浙江', 安徽省: '安徽', 福建省: '福建', 江西省: '江西', 山东省: '山东',
  河南省: '河南', 湖北省: '湖北', 湖南省: '湖南', 广东省: '广东', 广西壮族自治区: '广西',
  海南省: '海南', 重庆市: '重庆', 四川省: '四川', 贵州省: '贵州', 云南省: '云南',
  西藏自治区: '西藏', 陕西省: '陕西', 甘肃省: '甘肃', 青海省: '青海', 宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆', 台湾省: '台湾', 香港特别行政区: '香港', 澳门特别行政区: '澳门',
};

export function drawProvinceLabels(ctx, w, state, zoom, bounds = null, dimExceptState = -1, yScale = 1, is25D = false) {
  const states = state.states && state.states.length ? state.states : w.states || [];
  if (!states.length) return;

  const pad = 160 / Math.max(0.2, zoom);
  const x0 = bounds ? bounds.x0 - pad : -Infinity;
  const y0 = bounds ? bounds.y0 - pad : -Infinity;
  const x1 = bounds ? bounds.x1 + pad : Infinity;
  const y1 = bounds ? bounds.y1 + 310 + pad : Infinity;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const basePx = Math.max(10, Math.min(18, 12.5 * Math.pow(zoom / 0.28, 0.25)));
  const worldSize = basePx / zoom;

  ctx.font = `700 ${worldSize.toFixed(1)}px "Noto Serif SC", "Songti SC", "STSong", Georgia, serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = worldSize * 0.26;

  const defaultFill = state.lens ? 'rgba(247, 238, 212, 0.88)' : 'rgba(239, 224, 182, 0.78)';
  const defaultStroke = 'rgba(10, 18, 28, 0.85)';

  for (let i = 0; i < states.length; i++) {
    const st = states[i];
    const sb = w.stateBounds[i];
    if (!sb || sb.count === 0) continue;

    const isSelected = dimExceptState >= 0 && i === dimExceptState;
    const name = st.name || '';
    const isTiny = sb.count <= 4;
    if (isTiny && zoom < 0.55 && !isSelected) continue;
    // Skip redundant municipal/SAR watermarks when zoomed into 3D skyline (banner already names them)
    if (!is25D && !state.lens && !isSelected && sb.count <= 30 && zoom >= 0.68) continue;

    const lx = sb.labelX;
    const lift = is25D && w.elev && sb.labelCell >= 0 ? elevLiftKm(w.elev[sb.labelCell]) : 0;
    const ly = sb.labelY - lift - ((zoom < 0.45 ? 18 / zoom : 26 / zoom) / Math.max(0.45, yScale));
    if (lx < x0 || lx > x1 || ly < y0 || ly > y1) continue;

    if (dimExceptState >= 0) {
      if (isSelected) {
        ctx.strokeStyle = 'rgba(8, 15, 24, 0.95)';
        ctx.fillStyle = '#fff3cc';
      } else {
        ctx.strokeStyle = 'rgba(10, 18, 28, 0.55)';
        ctx.fillStyle = 'rgba(218, 206, 178, 0.42)';
      }
    } else {
      ctx.strokeStyle = defaultStroke;
      ctx.fillStyle = defaultFill;
    }

    const txt = zoom >= 0.55 || isSelected ? (st.name || SHORT_PROV[name] || name) : (SHORT_PROV[name] || st.abbr || name);
    if (yScale !== 1) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.scale(1, 1 / yScale);
      ctx.strokeText(txt, 0, 0);
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    } else {
      ctx.strokeText(txt, lx, ly);
      ctx.fillText(txt, lx, ly);
    }
  }

  ctx.restore();
}
