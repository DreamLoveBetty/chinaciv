// Major seaports, river ports, and CAAC airports diorama static layer

function findNearbyCityCore(x, y, cities, R) {
  if (!Array.isArray(cities) || !cities.length) return false;
  const maxD2 = (R * 0.48) * (R * 0.48);
  for (let i = 0; i < cities.length; i++) {
    const c = cities[i];
    if (c.x == null || c.y == null) continue;
    const dx = x - c.x;
    const dy = y - c.y;
    if (dx * dx + dy * dy < maxD2) return true;
  }
  return false;
}

function drawJetliner(ctx, cx, cy, size, ang) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);

  // Tarmac shadow
  ctx.save();
  ctx.translate(size * 0.10, size * 0.14);
  ctx.fillStyle = 'rgba(12, 18, 26, 0.42)';
  tracePlaneShape(ctx, size);
  ctx.fill();
  ctx.restore();

  // Crisp white airliner silhouette
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1e2b38';
  ctx.lineWidth = size * 0.08;
  ctx.lineJoin = 'round';
  tracePlaneShape(ctx, size);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function tracePlaneShape(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(s * 0.56, 0);
  ctx.lineTo(s * 0.14, s * 0.09);
  ctx.lineTo(-s * 0.16, s * 0.52);
  ctx.lineTo(-s * 0.28, s * 0.52);
  ctx.lineTo(-s * 0.10, s * 0.08);
  ctx.lineTo(-s * 0.38, s * 0.06);
  ctx.lineTo(-s * 0.52, s * 0.24);
  ctx.lineTo(-s * 0.58, s * 0.24);
  ctx.lineTo(-s * 0.48, 0);
  ctx.lineTo(-s * 0.58, -s * 0.24);
  ctx.lineTo(-s * 0.52, -s * 0.24);
  ctx.lineTo(-s * 0.38, -s * 0.06);
  ctx.lineTo(-s * 0.10, -s * 0.08);
  ctx.lineTo(-s * 0.28, -s * 0.52);
  ctx.lineTo(-s * 0.16, -s * 0.52);
  ctx.lineTo(s * 0.14, -s * 0.09);
  ctx.closePath();
}

function drawAnchorGlyph(ctx, x, y, r) {
  ctx.strokeStyle = '#eaf6ff';
  ctx.lineWidth = Math.max(1.0, r * 0.26);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.arc(x, y - r * 0.52, r * 0.22, 0, Math.PI * 2);
  ctx.moveTo(x, y - r * 0.30);
  ctx.lineTo(x, y + r * 0.65);
  ctx.moveTo(x - r * 0.45, y - r * 0.12);
  ctx.lineTo(x + r * 0.45, y - r * 0.12);
  ctx.moveTo(x - r * 0.55, y + r * 0.28);
  ctx.quadraticCurveTo(x, y + r * 0.85, x + r * 0.55, y + r * 0.28);
  ctx.stroke();
}

function drawAirportDiorama(ctx, ax, ay, s, isMajor, iata, zoom) {
  const rwAng = -0.45; // ~-26 deg angled SW -> NE runway
  const rwLen = s * 1.38;
  const rwW = s * 0.27;

  ctx.save();

  // Soft tarmac/clearing apron shadow
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(rwAng);
  ctx.fillStyle = 'rgba(28, 36, 40, 0.24)';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.04, rwLen * 0.62, rwW * 1.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Secondary parallel runway + taxiway for major hub airports
  if (isMajor) {
    const rw2W = rwW * 0.78;
    const rw2Len = rwLen * 0.82;
    const y2 = rwW * 1.15;
    ctx.strokeStyle = '#9aa0a4';
    ctx.lineWidth = rw2W * 0.45;
    ctx.beginPath();
    ctx.moveTo(-rwLen * 0.24, 0);
    ctx.lineTo(-rwLen * 0.18, y2);
    ctx.moveTo(rwLen * 0.18, 0);
    ctx.lineTo(rwLen * 0.22, y2);
    ctx.stroke();

    ctx.fillStyle = '#8b9296';
    ctx.fillRect(-rw2Len * 0.5 - s * 0.03, y2 - rw2W * 0.5 - s * 0.03, rw2Len + s * 0.06, rw2W + s * 0.06);
    ctx.fillStyle = '#323a44';
    ctx.fillRect(-rw2Len * 0.5, y2 - rw2W * 0.5, rw2Len, rw2W);

    ctx.strokeStyle = 'rgba(242, 245, 248, 0.75)';
    ctx.lineWidth = s * 0.03;
    ctx.setLineDash([s * 0.12, s * 0.09]);
    ctx.beginPath();
    ctx.moveTo(-rw2Len * 0.36, y2);
    ctx.lineTo(rw2Len * 0.36, y2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Primary runway outer shoulder + charcoal asphalt deck
  ctx.fillStyle = '#949aa0';
  ctx.fillRect(-rwLen * 0.5 - s * 0.035, -rwW * 0.5 - s * 0.035, rwLen + s * 0.07, rwW + s * 0.07);
  ctx.fillStyle = '#2d3540';
  ctx.fillRect(-rwLen * 0.5, -rwW * 0.5, rwLen, rwW);

  // Crisp white threshold piano-keys + dashed centerline
  ctx.fillStyle = '#f2f6f9';
  const thX = rwLen * 0.44;
  for (const dir of [-1, 1]) {
    ctx.fillRect(dir * thX - (dir > 0 ? s * 0.05 : 0), -rwW * 0.34, s * 0.06, rwW * 0.22);
    ctx.fillRect(dir * thX - (dir > 0 ? s * 0.05 : 0), rwW * 0.12, s * 0.06, rwW * 0.22);
  }
  ctx.strokeStyle = 'rgba(244, 248, 252, 0.88)';
  ctx.lineWidth = s * 0.036;
  ctx.setLineDash([s * 0.13, s * 0.09]);
  ctx.beginPath();
  ctx.moveTo(-rwLen * 0.34, 0);
  ctx.lineTo(rwLen * 0.34, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Isometric Terminal Concourse (blue roof + pale curtain wall + SE shadow) NW of runway
  const tx = ax - s * 0.22;
  const ty = ay - s * 0.36;
  const tw = s * 0.46;
  const th = s * 0.14;

  ctx.fillStyle = 'rgba(14, 20, 28, 0.32)';
  ctx.fillRect(tx - tw * 0.45 + s * 0.07, ty + s * 0.04, tw, th + s * 0.06);

  // Terminal front/side masonry
  ctx.fillStyle = '#c8d0d8';
  ctx.fillRect(tx - tw * 0.5, ty - th * 0.2, tw, th);
  ctx.strokeStyle = '#263240';
  ctx.lineWidth = Math.max(0.25, s * 0.025);
  ctx.strokeRect(tx - tw * 0.5, ty - th * 0.2, tw, th);

  // Sky-blue terminal roof
  ctx.fillStyle = '#5ba8e6';
  ctx.fillRect(tx - tw * 0.54, ty - th * 0.85, tw * 1.08, th * 0.85);
  ctx.strokeRect(tx - tw * 0.54, ty - th * 0.85, tw * 1.08, th * 0.85);

  // Control tower beside terminal
  const cxT = tx + tw * 0.62;
  const cyT = ty + th * 0.55;
  ctx.fillStyle = 'rgba(14, 20, 28, 0.30)';
  ctx.beginPath();
  ctx.ellipse(cxT + s * 0.06, cyT + s * 0.02, s * 0.08, s * 0.04, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#dde3e8';
  ctx.fillRect(cxT - s * 0.032, cyT - s * 0.36, s * 0.064, s * 0.36);
  ctx.fillStyle = '#24384c';
  ctx.fillRect(cxT - s * 0.068, cyT - s * 0.44, s * 0.136, s * 0.09);
  ctx.fillStyle = '#f2f6fa';
  ctx.fillRect(cxT - s * 0.078, cyT - s * 0.47, s * 0.156, s * 0.038);

  // Taking-off commercial white jetliner angled above runway
  const planeX = ax + Math.cos(rwAng) * s * 0.22;
  const planeY = ay + Math.sin(rwAng) * s * 0.22 - s * 0.06;
  drawJetliner(ctx, planeX, planeY, s * 0.42, rwAng - 0.05);

  // Crisp IATA code pill when zoomed in cleanly
  if (iata && zoom >= 1.05) {
    const fs = Math.max(7.5, Math.min(9.5, 8.8)) / zoom;
    ctx.font = `700 ${fs.toFixed(2)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const lx = ax;
    const ly = ay + s * 0.36;
    ctx.lineWidth = fs * 0.28;
    ctx.strokeStyle = 'rgba(12, 18, 26, 0.88)';
    ctx.strokeText(iata, lx, ly);
    ctx.fillStyle = '#cdeeff';
    ctx.fillText(iata, lx, ly);
  }

  ctx.restore();
}

function drawPortDiorama(ctx, px, py, s) {
  ctx.save();
  ctx.translate(px, py);

  // Water ripple under hull
  ctx.strokeStyle = 'rgba(168, 224, 250, 0.55)';
  ctx.lineWidth = Math.max(0.3, s * 0.035);
  ctx.beginPath();
  ctx.ellipse(s * 0.08, s * 0.20, s * 0.58, s * 0.22, 0.1, 0, Math.PI * 2);
  ctx.stroke();

  // Isometric concrete harbor quay pier
  ctx.fillStyle = '#7e8688';
  ctx.beginPath();
  ctx.moveTo(-s * 0.52, -s * 0.02);
  ctx.lineTo(s * 0.18, s * 0.16);
  ctx.lineTo(s * 0.45, 0);
  ctx.lineTo(s * 0.45, s * 0.11);
  ctx.lineTo(s * 0.18, s * 0.28);
  ctx.lineTo(-s * 0.52, s * 0.09);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#c8ccc8';
  ctx.beginPath();
  ctx.moveTo(-s * 0.52, -s * 0.02);
  ctx.lineTo(-s * 0.22, -s * 0.22);
  ctx.lineTo(s * 0.45, -s * 0.03);
  ctx.lineTo(s * 0.18, s * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#28343e';
  ctx.lineWidth = Math.max(0.22, s * 0.025);
  ctx.stroke();

  // Colorful shipping containers
  const boxes = [
    [-s * 0.28, -s * 0.12, '#c84b40'],
    [-s * 0.08, -s * 0.07, '#3a84c6'],
    [-s * 0.20, -s * 0.21, '#e4ae44'],
  ];
  for (const [bx, by, col] of boxes) {
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, s * 0.16, s * 0.09);
    ctx.strokeStyle = 'rgba(20, 26, 32, 0.55)';
    ctx.strokeRect(bx, by, s * 0.16, s * 0.09);
  }

  // Container gantry crane
  ctx.strokeStyle = '#e8953e';
  ctx.lineWidth = Math.max(0.45, s * 0.055);
  ctx.beginPath();
  ctx.moveTo(s * 0.12, s * 0.02);
  ctx.lineTo(s * 0.12, -s * 0.34);
  ctx.lineTo(s * 0.44, -s * 0.22);
  ctx.moveTo(s * 0.24, -s * 0.04);
  ctx.lineTo(s * 0.20, -s * 0.31);
  ctx.stroke();

  // Miniature freighter ship moored next to quay
  ctx.fillStyle = '#2d455e';
  ctx.beginPath();
  ctx.moveTo(-s * 0.24, s * 0.20);
  ctx.lineTo(s * 0.38, s * 0.34);
  ctx.lineTo(s * 0.56, s * 0.22);
  ctx.lineTo(-s * 0.06, s * 0.09);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#182430';
  ctx.stroke();

  ctx.fillStyle = '#eef4f8';
  ctx.fillRect(-s * 0.10, s * 0.09, s * 0.11, s * 0.09);

  ctx.restore();
}

export function createHubsLayer(app) {
  return {
    id: 'hubs',
    order: 16,
    enabled: (state) => Boolean(state.layers.hubs),
    draw(ctx, w, state, data, zoom, utils) {
      const infra = data.infrastructure;
      if (!infra) return;

      const R = w.R || 14.433757;
      const bounds = utils?.bounds;
      const pad = R * 2.8;
      const x0 = bounds ? bounds.x0 - pad : -Infinity;
      const y0 = bounds ? bounds.y0 - pad : -Infinity;
      const x1 = bounds ? bounds.x1 + pad : Infinity;
      const y1 = bounds ? bounds.y1 + pad : Infinity;

      const ports = infra.ports || [];
      const airports = infra.airports || [];
      const cities = state?.cities || [];
      const badgeRad = Math.max(4.4, Math.min(8.2, 4.9 / Math.pow(zoom, 0.54)));

      ctx.save();

      // 1. Coastal & River Ports
      for (let i = 0; i < ports.length; i++) {
        const p = ports[i];
        if (zoom < 0.34 && (p.rank || i + 1) > 20) continue;
        let x = p.x ?? (p.cell >= 0 ? w.cx(p.cell) : null);
        let y = p.y ?? (p.cell >= 0 ? w.cy(p.cell) : null);
        if (x == null || y == null || x < x0 || x > x1 || y < y0 || y > y1) continue;

        if (findNearbyCityCore(x, y, cities, R)) {
          x += R * 0.44;
          y += R * 0.36;
        }

        if (zoom < 0.44) {
          ctx.fillStyle = 'rgba(18, 42, 68, 0.94)';
          ctx.strokeStyle = '#6ec2f5';
          ctx.lineWidth = Math.max(0.9, 1.35 / zoom);
          ctx.beginPath();
          ctx.arc(x, y, badgeRad * 0.92, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          drawAnchorGlyph(ctx, x, y, badgeRad * 0.52);
        } else {
          const s = zoom >= 0.72 ? R * 0.92 : Math.min(R * 1.02, 10.5 / zoom);
          drawPortDiorama(ctx, x, y, s);
        }
      }

      // 2. Civil Aviation Airports (120 real CAAC hubs)
      for (let i = 0; i < airports.length; i++) {
        const a = airports[i];
        if (zoom < 0.36 && (a.rank || i + 1) > 28) continue;
        if (zoom >= 0.42 && zoom < 0.65 && a.hub !== 'L' && (a.rank || i + 1) > 48) continue;

        let x = a.x ?? (a.cell >= 0 ? w.cx(a.cell) : null);
        let y = a.y ?? (a.cell >= 0 ? w.cy(a.cell) : null);
        if (x == null || y == null || x < x0 || x > x1 || y < y0 || y > y1) continue;

        if (findNearbyCityCore(x, y, cities, R)) {
          x += R * 0.56;
          y += R * 0.24;
        }

        if (zoom < 0.42) {
          ctx.fillStyle = 'rgba(16, 28, 42, 0.94)';
          ctx.strokeStyle = '#7ad4fa';
          ctx.lineWidth = Math.max(0.9, 1.35 / zoom);
          ctx.beginPath();
          ctx.arc(x, y, badgeRad * 0.95, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          drawJetliner(ctx, x, y, badgeRad * 1.15, -0.45);
        } else {
          const isMajor = a.hub === 'L' || (a.pax_m || 0) >= 22;
          const s = zoom >= 0.72 ? R * 0.96 : Math.min(R * 1.12, 11.2 / zoom);
          const showIata = zoom >= 1.15 && (isMajor || (a.rank || 999) <= 60);
          drawAirportDiorama(ctx, x, y, s, isMajor, showIata ? (a.iata || '') : '', zoom);
        }
      }

      ctx.restore();
    },
  };
}
