// Civilization-style circular brass-rimmed medallion SVGs for all 9 Advisors + Explorer.
import { esc } from "./util.js";

function wreath() {
  const leaves = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 6; k++) {
      const th = ((28 + k * 23) * Math.PI) / 180;
      const r = 16;
      const x = 32 + side * r * Math.sin(th);
      const y = 34 + r * Math.cos(th);
      const rot = (Math.atan2(-side * Math.cos(th), -Math.sin(th)) * 180) / Math.PI + side * 22;
      leaves.push(
        `<ellipse cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" rx="2.4" ry="5.2" transform="rotate(${rot.toFixed(1)} ${x.toFixed(2)} ${y.toFixed(2)})" fill="#fff4d2" stroke="#2a1d08" stroke-width="1"/>`
      );
    }
  }
  return `<path d="M27.5 49.4A16 16 0 0 1 18.6 24.5M36.5 49.4A16 16 0 0 0 45.4 24.5" fill="none" stroke="#2a1d08" stroke-width="1.4"/>
    ${leaves.join("")}
    <path d="M27 48.5c2 1.6 8 1.6 10 0" fill="none" stroke="#b4872f" stroke-width="2" stroke-linecap="round"/>
    <path d="M32 19c4.5 5 6.5 9 6.5 13a6.5 6.5 0 0 1-13 0c0-3 1.5-5 3-7 .5 2.5 1.5 3.5 2.5 3.5 0-3.5-.5-6 1-9.5z" fill="#ffe08a" stroke="#2a1d08" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M32 29c1.8 2 2.6 3.4 2.6 4.8a2.6 2.6 0 0 1-5.2 0c0-1.4.9-2.9 2.6-4.8z" fill="#e0763a"/>`;
}

const GLYPHS = {
  energy: `<path d="M35 12 20 35h10l-3 17 17-24H33z" fill="#ffe89c" stroke="#2a1d08" stroke-width="1.5" stroke-linejoin="round"/>`,
  economy: `<circle cx="32" cy="32" r="17" fill="#f7da84" stroke="#2a1d08" stroke-width="1.5"/>
    <circle cx="32" cy="32" r="13.5" fill="none" stroke="#8a5e18" stroke-width="1.2"/>
    <rect x="26.5" y="26.5" width="11" height="11" fill="#3a2c08" stroke="#8a5e18" stroke-width="1.2"/>`,
  people: `<circle cx="24" cy="24" r="5" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.3"/>
    <circle cx="40" cy="24" r="5" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.3"/>
    <circle cx="32" cy="21" r="5.5" fill="#ffe08a" stroke="#2a1d08" stroke-width="1.3"/>
    <path d="M16 44c0-6 3.5-10 8-10s8 4 8 10M32 44c0-6 3.5-10 8-10s8 4 8 10" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.3"/>
    <path d="M23 46c0-7 4-12 9-12s9 5 9 12z" fill="#ffe08a" stroke="#2a1d08" stroke-width="1.3"/>`,
  prosperity: `<path d="M15 31 32 17l17 14v18H15z" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M12 32 32 15l20 17" fill="none" stroke="#ffe08a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="28" y="36" width="8" height="13" fill="#b4872f" stroke="#2a1d08" stroke-width="1.2"/>`,
  knowledge: `<circle cx="32" cy="32" r="4.2" fill="#ffe08a" stroke="#2a1d08" stroke-width="1.2"/>
    <ellipse cx="32" cy="32" rx="18" ry="7" fill="none" stroke="#fff4d2" stroke-width="1.6"/>
    <ellipse cx="32" cy="32" rx="18" ry="7" transform="rotate(60 32 32)" fill="none" stroke="#fff4d2" stroke-width="1.6"/>
    <ellipse cx="32" cy="32" rx="18" ry="7" transform="rotate(120 32 32)" fill="none" stroke="#fff4d2" stroke-width="1.6"/>`,
  land: `<path d="M12 42 25 21l9 13 6-8 12 16z" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="m25 21-4.5 7 3-.8 2 2.2 2-2.8z" fill="#d9e7ef"/>
    <path d="M11 42h42c-2 6-8 10-21 10s-19-4-21-10z" fill="#b9c96a" stroke="#2a1d08" stroke-width="1.4"/>`,
  military: `<path d="M32 11 49 16.5V30c0 11-7.5 18.5-17 23-9.5-4.5-17-12-17-23V16.5z" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="m32 18.5 2.1 4.4 4.8.5-3.6 3.2 1 4.7-4.3-2.5-4.3 2.5 1-4.7-3.6-3.2 4.8-.5z" fill="#b4872f" stroke="#2a1d08" stroke-width=".9"/>
    <path d="m22.5 36 9.5 5.5 9.5-5.5M22.5 41.5 32 47l9.5-5.5" fill="none" stroke="#2a1d08" stroke-width="2.2" stroke-linecap="round"/>`,
  commerce: `<path d="M32 15v32" stroke="#fff4d2" stroke-width="2" stroke-linecap="round"/>
    <path d="M15 21h34" stroke="#fff4d2" stroke-width="2" stroke-linecap="round"/>
    <circle cx="32" cy="14" r="3" fill="#ffe08a" stroke="#2a1d08" stroke-width="1.2"/>
    <path d="m17 21-5 13h10zM47 21l-5 13h10z" fill="none" stroke="#2a1d08" stroke-width="1.1"/>
    <path d="M10.5 34h13c0 4-3 6-6.5 6s-6.5-2-6.5-6zM40.5 34h13c0 4-3 6-6.5 6s-6.5-2-6.5-6z" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.3"/>
    <path d="M24 51h16l-2.5-4h-11z" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.3"/>`,
  culture: wreath(),
  explorer: `<circle cx="32" cy="32" r="16" fill="none" stroke="#fff4d2" stroke-width="1.6" stroke-dasharray="2 3"/>
    <path d="M32 11 36 28 53 32 36 36 32 53 28 36 11 32 28 28z" fill="#fff4d2" stroke="#2a1d08" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M32 11 36 28 32 32zM53 32 36 36 32 32zM32 53 28 36 32 32zM11 32 28 28 32 32z" fill="#c9a45c"/>
    <circle cx="32" cy="32" r="2.6" fill="#2a1d08"/>`,
};

export function emblem(adv, size = 48, title = "") {
  const glyph = GLYPHS[adv.id] || GLYPHS.explorer;
  const gid = `advg-${adv.id}-${size}`;
  const a11y = title ? `role="img" aria-label="${esc(title)}"` : `aria-hidden="true" focusable="false"`;
  return `<svg class="adv-emblem" ${a11y} width="${size}" height="${size}" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="${gid}-d" cx="40%" cy="35%" r="70%">
        <stop offset="0" stop-color="${esc(adv.color)}" stop-opacity="1"/>
        <stop offset="1" stop-color="${esc(adv.dark || "#12202c")}"/>
      </radialGradient>
      <linearGradient id="${gid}-r" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f6dc8a"/>
        <stop offset=".5" stop-color="#b4872f"/>
        <stop offset="1" stop-color="#6e5020"/>
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="31" fill="#120d06"/>
    <circle cx="32" cy="32" r="29.5" fill="url(#${gid}-r)"/>
    <circle cx="32" cy="32" r="25.5" fill="url(#${gid}-d)" stroke="#2a1d08" stroke-width="1.2"/>
    <path d="M14 22a22 22 0 0 1 36 0" fill="none" stroke="rgba(255,240,200,.18)" stroke-width="3" stroke-linecap="round"/>
    ${glyph}
  </svg>`;
}
