// Chinese & international tabular formatting utilities

export function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isValidNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Format population given in raw persons OR 万人 (if small, infer unit carefully when explicit unit omitted).
 * By convention across ChinaCiv contracts:
 * - nation.population is ~1,440,000,000 (or 14.41亿 if already in 亿) -> handle gracefully!
 */
export function fmtPop(v, unitHint = '') {
  if (!isValidNum(v)) return '—';
  const u = String(unitHint || '');
  if (u === '亿人' || u === '亿') return `${v.toFixed(2)} 亿`;
  if (u === '万人' || u === '万') {
    return v >= 10000 ? `${(v / 10000).toFixed(2)} 亿` : `${v.toFixed(v >= 100 ? 0 : 1)} 万`;
  }
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)} 亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(abs >= 1e6 ? 0 : 1)} 万`;
  return `${Math.round(v).toLocaleString('zh-CN')}`;
}

/**
 * Format GDP value. Defaults to 亿元 (ChinaCiv standard across nation/states/cities/counties),
 * while also handling raw RMB yuan (>= 1e9) or explicit unit hints.
 */
export function fmtGdp(v, unitHint = '亿元') {
  if (!isValidNum(v)) return '—';
  const u = String(unitHint || '亿元');
  if (u.includes('万亿')) return `${v.toFixed(2)} 万亿元`;
  if (u === '元' || (Math.abs(v) >= 1e9 && !u.includes('亿'))) {
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2)} 万亿元`;
    if (abs >= 1e8) return `${(v / 1e8).toFixed(abs >= 1e11 ? 0 : 1)} 亿元`;
    if (abs >= 1e4) return `${(v / 1e4).toFixed(1)} 万元`;
    return `${Math.round(v).toLocaleString('zh-CN')} 元`;
  }
  // 亿元 unit
  return Math.abs(v) >= 10000
    ? `${(v / 10000).toFixed(2)} 万亿元`
    : `${v.toFixed(Math.abs(v) >= 100 ? 0 : 1)} 亿元`;
}

export function fmtYuan(v) {
  if (!isValidNum(v)) return '—';
  if (Math.abs(v) >= 10000) {
    return `${(v / 10000).toFixed(2)} 万元`;
  }
  return `${Math.round(v).toLocaleString('zh-CN')} 元`;
}

export function fmtPct(v, decimals = 1) {
  if (!isValidNum(v)) return '—';
  // If share is 0..1 when field expects pct, caller handles; fmtPct assumes percentage unless abs <= 1 & decimals < 0
  return `${v.toFixed(decimals)}%`;
}

export function fmtSharePct(v, decimals = 1) {
  if (!isValidNum(v)) return '—';
  const pct = Math.abs(v) <= 1.0001 ? v * 100 : v;
  return `${pct.toFixed(decimals)}%`;
}

export function fmtNum(v, decimals = 0) {
  if (!isValidNum(v)) return '—';
  return Number(v.toFixed(decimals)).toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtCompact(v) {
  if (!isValidNum(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(v / 1e4).toFixed(abs >= 1e6 ? 0 : 1)}万`;
  if (abs >= 100) return `${Math.round(v).toLocaleString('zh-CN')}`;
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export function fmtDensity(v) {
  if (!isValidNum(v)) return '—';
  return `${fmtCompact(v)} 人/km²`;
}

export function fmtRatio1InN(nOrShare) {
  if (!isValidNum(nOrShare) || nOrShare <= 0) return '—';
  const n = nOrShare < 1 ? Math.round(1 / nOrShare) : Math.round(nOrShare);
  return `每 ${n} 人中 1 名`;
}

/**
 * Format any value according to a counties.json / lenses.json field specification.
 */
export function fmtField(val, spec) {
  if (val == null || val === '') return '—';
  if (typeof val === 'string') return val;
  if (!isValidNum(val)) return String(val);

  const fmt = spec?.format || '';
  const unit = spec?.unit || '';

  if (fmt === 'pop' || fmt === 'population') return fmtPop(val, unit);
  if (fmt === 'gdp') return fmtGdp(val, unit);
  if (fmt === 'yuan' || fmt === 'currency') return fmtYuan(val);
  if (fmt === 'pct' || fmt === 'percent') {
    const p = unit === 'share' && Math.abs(val) <= 1 ? val * 100 : val;
    return `${p.toFixed(1)}%`;
  }
  if (fmt === 'share') return fmtSharePct(val, 1);
  if (fmt === 'int') return `${Math.round(val).toLocaleString('zh-CN')}${unit ? ' ' + unit : ''}`;
  if (fmt === 'density') return `${fmtNum(val, val >= 100 ? 0 : 1)} 人/km²`;
  if (fmt === 'years' || fmt === 'age') return `${val.toFixed(1)} 岁`;
  if (fmt === 'min' || fmt === 'minutes') return `${val.toFixed(1)} 分钟`;
  if (fmt === 'km2') return `${fmtNum(val, 0)} km²`;
  if (fmt === 'dec1' || fmt === 'score' || fmt === 'index') return `${val.toFixed(1)}${unit ? ' ' + unit : ''}`;

  const dec = Math.abs(val) >= 100 ? 0 : Math.abs(val) >= 10 ? 1 : 2;
  return `${fmtNum(val, dec)}${unit ? ' ' + unit : ''}`;
}
