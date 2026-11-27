// Real OpenFlights × CAAC 120-airport civil aviation network static arc layer (cached Path2D)

export function ensureAirlinePaths(infra) {
  if (infra._airPathsBuilt) return;
  infra._airPathsBuilt = true;

  const trunk = new Path2D();
  const regional = new Path2D();
  const hubs = new Map();
  let hasTrunk = false;
  let hasRegional = false;

  for (const r of infra.air_routes || []) {
    const pts = r.pts;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const isTrunk = r.tier === 'trunk';
    const target = isTrunk ? trunk : regional;
    if (isTrunk) hasTrunk = true;
    else hasRegional = true;

    target.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      target.lineTo(pts[i][0], pts[i][1]);
    }

    const endpoints = [
      [r.from_iata || `${pts[0][0]},${pts[0][1]}`, pts[0][0], pts[0][1]],
      [r.to_iata || `${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`, pts[pts.length - 1][0], pts[pts.length - 1][1]],
    ];
    for (const [key, x, y] of endpoints) {
      let hub = hubs.get(key);
      if (!hub) {
        hub = { x, y, trunkCount: 0, totalCount: 0 };
        hubs.set(key, hub);
      }
      hub.totalCount += 1;
      if (isTrunk) hub.trunkCount += 1;
    }
  }

  infra._airTrunkPath = hasTrunk ? trunk : null;
  infra._airRegionalPath = hasRegional ? regional : null;
  infra._airHubCoords = Array.from(hubs.values());
}

export function createAirlinesLayer() {
  return {
    id: 'airlines',
    order: 24,
    enabled: (state) => Boolean(state.layers.airlines),
    draw(ctx, w, state, data, zoom) {
      const infra = data.infrastructure;
      if (!infra?.air_routes?.length) return;
      ensureAirlinePaths(infra);

      const zEff = Math.max(0.25, zoom);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (infra._airRegionalPath) {
        ctx.strokeStyle = 'rgba(72, 184, 240, 0.22)';
        ctx.lineWidth = Math.max(0.65, 1.0 / zEff);
        ctx.stroke(infra._airRegionalPath);
      }

      if (infra._airTrunkPath) {
        const lw = Math.max(1.0, 1.7 / zEff);
        ctx.strokeStyle = 'rgba(64, 198, 255, 0.22)';
        ctx.lineWidth = lw * 2.1;
        ctx.stroke(infra._airTrunkPath);

        ctx.strokeStyle = 'rgba(116, 224, 255, 0.48)';
        ctx.lineWidth = lw;
        ctx.stroke(infra._airTrunkPath);
      }

      if (infra._airHubCoords?.length) {
        const trunkRad = Math.max(2.2, 3.6 / zEff);
        const regRad = Math.max(1.5, 2.3 / zEff);
        ctx.strokeStyle = 'rgba(128, 221, 255, 0.72)';
        ctx.fillStyle = 'rgba(14, 34, 52, 0.85)';
        ctx.lineWidth = Math.max(0.7, 1.05 / zEff);
        for (const h of infra._airHubCoords) {
          const r = h.trunkCount > 0 ? trunkRad : regRad;
          ctx.beginPath();
          ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      ctx.restore();
    },
  };
}
