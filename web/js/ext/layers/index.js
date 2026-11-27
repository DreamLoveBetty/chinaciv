// Registers all 6 static map art layers + animated transport flow overlay, bound to the Topbar "图层" menu

import { createRoadsLayer } from './roads.js';
import { createRailLayer } from './rail.js?v=20261127-7';
import { createHubsLayer } from './hubs.js';
import { createAirlinesLayer } from './airlines.js?v=20261127-7';
import { createWondersLayer } from './wonders.js';
import { createTradeLayer } from './trade.js?v=20261127-7';
import { installFlowOverlay } from './flowOverlay.js?v=20261127-7';

export function install(app) {
  app.ui.addMapToggle({
    id: 'precip',
    group: 'thematic',
    label: '年降水量（含400mm线）',
    icon: 'precip',
    title: '基于 WorldClim v2.1 实测年均降水量分布，醒目显示400毫米等降水量线',
    default: false,
    get: () => app.state.lens?.id === 'precip',
    set: (on) => app.setLens(on ? 'precip' : null),
  });

  app.ui.addMapToggle({
    id: 'elevation',
    group: 'thematic',
    label: '海拔高度（三级阶梯）',
    icon: 'elevation',
    title: '基于 AWS Terrarium DEM 实测平均海拔，分层设色呈现中国地势三大阶梯',
    default: false,
    get: () => app.state.lens?.id === 'elevation',
    set: (on) => app.setLens(on ? 'elevation' : null),
  });

  const specs = [
    {
      id: 'rail',
      label: '高铁与铁路',
      icon: 'rail',
      title: '八纵八横高铁与国家铁路主干网',
      default: true,
      dataName: 'infrastructure',
      factory: createRailLayer,
    },
    {
      id: 'roads',
      label: '国家公路网',
      icon: 'road',
      title: '国道与高速公路主干网',
      default: false,
      dataName: 'infrastructure',
      factory: createRoadsLayer,
    },
    {
      id: 'hubs',
      label: '港口与机场',
      icon: 'hub',
      title: '主要沿海/内河港口与民航枢纽',
      default: true,
      dataName: 'infrastructure',
      factory: createHubsLayer,
    },
    {
      id: 'airlines',
      label: '民航航空线路',
      icon: 'flight',
      title: '基于 OpenFlights 真实航线与全国120座机场构建的主干及区域航网（含流光动效）',
      default: false,
      dataName: 'infrastructure',
      factory: createAirlinesLayer,
    },
    {
      id: 'wonders',
      label: '奇观与遗产',
      icon: 'wonder',
      title: '国家公园、顶尖高校、文化遗产与超级工程',
      default: true,
      dataName: 'wonders',
      factory: createWondersLayer,
    },
    {
      id: 'trade',
      label: '省际贸易走廊',
      icon: 'trade',
      title: '40条主要省际大宗货运与经济走廊',
      default: false,
      dataName: 'trade',
      factory: createTradeLayer,
    },
  ];

  for (const sp of specs) {
    app.state.layers[sp.id] = sp.default;
    const layer = sp.factory(app);
    app.registerStaticLayer(layer);

    app.ui.addMapToggle({
      id: sp.id,
      label: sp.label,
      icon: sp.icon,
      title: sp.title,
      default: sp.default,
      get: () => app.getLayer(sp.id),
      set: (on) => {
        app.setLayer(sp.id, on);
        if (on && sp.dataName && !app.data[sp.dataName]) {
          app.loadData(sp.dataName).then(() => app.requestStatic()).catch(() => {});
        }
      },
    });
  }

  installFlowOverlay(app);
}
