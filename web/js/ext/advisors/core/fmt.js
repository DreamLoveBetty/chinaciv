// Number and unit formatting tailored for Simplified Chinese macroeconomic, demographic, and Civ data.
import { fin } from "./util.js";

export const int = (v) => (fin(v) ? Math.round(v).toLocaleString("zh-CN") : "—");
export const dec = (v, d = 1) => (fin(v) ? Number(v).toFixed(d) : "—");
export const pct = (v, d = 1) => (fin(v) ? `${Number(v).toFixed(d)}%` : "—");
export const signedPct = (v, d = 1) => (fin(v) ? `${v >= 0 ? "+" : ""}${Number(v).toFixed(d)}%` : "—");

export function countCn(v, unit = "") {
  if (!fin(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}亿${unit}`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)}万${unit}`;
  return `${Math.round(v).toLocaleString("zh-CN")}${unit}`;
}

export function fmtPop(v) {
  if (!fin(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(2)}亿人`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)}万人`;
  return `${Math.round(v).toLocaleString("zh-CN")}人`;
}

// GDP may arrive in 亿元 (e.g. 1,349,084) or in raw 元; detect cleanly or honor unit metadata.
export function fmtGdpYi(yi) {
  if (!fin(yi)) return "—";
  const a = Math.abs(yi);
  if (a >= 1e4) return `¥${(yi / 1e4).toFixed(2)}万亿`;
  if (a >= 1) return `¥${yi.toFixed(yi >= 100 ? 0 : 1)}亿`;
  return `¥${(yi * 1e4).toFixed(0)}万`;
}

export function fmtMoneyYuan(v) {
  if (!fin(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `¥${(v / 1e12).toFixed(2)}万亿`;
  if (a >= 1e8) return `¥${(v / 1e8).toFixed(1)}亿`;
  if (a >= 1e4) return `¥${(v / 1e4).toFixed(1)}万`;
  return `¥${Math.round(v).toLocaleString("zh-CN")}`;
}

export function fmtShort(v) {
  if (!fin(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
  if (a >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  if (a >= 1000) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return Math.round(v).toString();
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return "0";
  return v.toPrecision(2);
}

export function fmtPowerMw(mw) {
  if (!fin(mw)) return "—";
  if (Math.abs(mw) >= 1000) return `${(mw / 1000).toFixed(1)} GW`;
  return `${Math.round(mw).toLocaleString("zh-CN")} MW`;
}

export function fmtPowerGw(gw) {
  if (!fin(gw)) return "—";
  return `${gw >= 100 ? gw.toFixed(0) : gw.toFixed(1)} GW`;
}

/** Format a value using a field descriptor { format, unit, key }. */
export function fmtField(field, v) {
  if (v == null || v === "") return "—";
  if (typeof v === "string" && !fin(Number(v))) return v;
  const n = typeof v === "number" ? v : Number(v);
  if (!fin(n)) return String(v);
  const f = field?.format || "";
  const u = field?.unit || "";
  if (f === "pop" || field?.key === "population") return fmtPop(n);
  if (f === "gdp" || f === "gdp_yi" || (field?.key === "gdp" && u.includes("亿"))) return fmtGdpYi(n);
  if (f === "yuan" || f === "money" || f === "currency" || u === "元" || u === "元/㎡") return `${int(n)}${u ? " " + u : ""}`;
  if (f === "density") return `${n >= 100 ? int(n) : n.toFixed(1)} 人/km²`;
  if (f === "pct" || u === "%") return `${n.toFixed(1)}%`;
  if (f === "signed_pct") return signedPct(n, 1);
  if (f === "ratio") return `${n.toFixed(1)}${u ? " " + u : ""}`;
  if (f === "mw") return fmtPowerMw(n);
  if (f === "gw") return fmtPowerGw(n);
  if (f === "km2" || u === "km²") return `${int(n)} km²`;
  if (f === "int") return `${int(n)}${u ? " " + u : ""}`;
  if (f === "dec1") return `${n.toFixed(1)}${u ? " " + u : ""}`;
  if (f === "dec2") return `${n.toFixed(2)}${u ? " " + u : ""}`;
  if (u === "人/km²") return `${n >= 100 ? int(n) : n.toFixed(1)} 人/km²`;
  if (u === "分钟") return `${n.toFixed(1)} 分钟`;
  if (u === "亿元") return fmtGdpYi(n);
  if (u === "万元") return `${n.toFixed(1)} 万元`;
  return `${n >= 1000 ? countCn(n) : Number.isInteger(n) ? n : n.toFixed(1)}${u ? " " + u : ""}`;
}

export function fmtCell(field, v) {
  if (v == null || v === "") return "—";
  if (typeof v === "string") {
    const num = Number(v);
    if (!fin(num) || v.trim() === "") return v;
  }
  const n = Number(v);
  if (!fin(n)) return String(v);
  const f = field?.format || "";
  const u = field?.unit || "";
  if (f === "pop" || field?.key === "population") return countCn(n);
  if (f === "gdp" || f === "gdp_yi" || (field?.key === "gdp" && u.includes("亿"))) return fmtGdpYi(n);
  if (f === "density") return n >= 100 ? int(n) : n.toFixed(1);
  if (f === "pct" || u === "%") return `${n.toFixed(1)}%`;
  if (f === "signed_pct") return signedPct(n, 1);
  if (f === "mw") return fmtPowerMw(n);
  if (f === "gw") return `${n.toFixed(1)}GW`;
  if (u === "元" || u === "元/㎡") return n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : int(n);
  if (Math.abs(n) >= 1e4) return countCn(n);
  if (Number.isInteger(n)) return n.toLocaleString("zh-CN");
  return n.toFixed(Math.abs(n) >= 100 ? 0 : 1);
}

export function parseNum(v) {
  if (typeof v === "number") return fin(v) ? v : null;
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[,，%￥¥\s]/g, ""));
  return fin(n) ? n : null;
}
