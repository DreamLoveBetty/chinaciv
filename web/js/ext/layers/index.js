// Registers all 6 static map art layers and binds them to the Topbar "图层" menu

import { createRoadsLayer } from './roads.js';
import { createRailLayer } from './rail.js';
import { createHubsLayer } from './hubs.js';
import { createMilitaryLayer } from './military.js';
import { createWondersLayer } from './wonders.js';
import { createTradeLayer } from './trade.js';

export function install(app) {
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
      id: 'wonders',
      label: '奇观与遗产',
      icon: 'wonder',
      title: '国家公园、顶尖高校、文化遗产与超级工程',
      default: true,
      dataName: 'wonders',
      factory: createWondersLayer,
    },
    {
      id: 'military',
      label: '五大战区防务',
      icon: 'military',
      title: '五大战区基地、航天发射场与演训区',
      default: false,
      dataName: 'military',
      factory: createMilitaryLayer,
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
}
