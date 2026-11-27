#!/usr/bin/env python3
"""Build real domestic + HK/MO/TW civil aviation routes from OpenFlights routes.dat joined with CAAC 120 airports."""

import csv
import io
import json
import math
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_PATH = ROOT / "raw_data" / "infra" / "openflights_routes.dat"
INFRA_PATH = ROOT / "web" / "data" / "infrastructure.json"
SOURCES_PATH = ROOT / "web" / "data" / "sources.json"
OPENFLIGHTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat"


def load_routes_dat() -> str:
    RAW_PATH.parent.mkdir(parents=True, exist_ok=True)
    if RAW_PATH.exists() and RAW_PATH.stat().st_size > 10000:
        print(f"[cached] {RAW_PATH.name} ({RAW_PATH.stat().st_size:,} bytes)")
        return RAW_PATH.read_text(encoding="utf-8", errors="replace")
    print(f"[downloading] {OPENFLIGHTS_URL}")
    r = requests.get(OPENFLIGHTS_URL, timeout=30)
    r.raise_for_status()
    RAW_PATH.write_text(r.text, encoding="utf-8")
    print(f"[done] {RAW_PATH.name} ({RAW_PATH.stat().st_size:,} bytes)")
    return r.text


def curved_flight_arc(x1: float, y1: float, x2: float, y2: float, n_pts: int = 14) -> list[list[float]]:
    dx = x2 - x1
    dy = y2 - y1
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return [[round(x1, 1), round(y1, 1)], [round(x2, 1), round(y2, 1)]]

    ux, uy = -dy / dist, dx / dist
    # Orient arcs gracefully northward (upward in screen space) or slightly west for nearly vertical meridians
    if abs(uy) >= 0.15:
        if uy > 0:
            ux, uy = -ux, -uy
    elif ux > 0:
        ux, uy = -ux, -uy

    bend = max(22.0, min(130.0, dist * 0.11))
    cx = (x1 + x2) * 0.5 + ux * bend
    cy = (y1 + y2) * 0.5 + uy * bend

    pts = []
    for i in range(n_pts + 1):
        t = i / n_pts
        mt = 1.0 - t
        px = mt * mt * x1 + 2.0 * mt * t * cx + t * t * x2
        py = mt * mt * y1 + 2.0 * mt * t * cy + t * t * y2
        pts.append([round(px, 1), round(py, 1)])
    return pts


def main() -> None:
    with open(INFRA_PATH, "r", encoding="utf-8") as f:
        infra = json.load(f)

    airports = infra.get("airports", [])
    ap_by_iata = {a["iata"]: a for a in airports if a.get("iata")}
    provs = sorted(set(a["province"] for a in airports if a.get("province")))

    raw_text = load_routes_dat()
    city_pairs: dict[tuple[str, str], dict] = {}

    for row in csv.reader(io.StringIO(raw_text)):
        if len(row) < 6:
            continue
        al, src, dst = row[0].strip(), row[2].strip(), row[4].strip()
        if src not in ap_by_iata or dst not in ap_by_iata or src == dst:
            continue
        ap_a, ap_b = ap_by_iata[src], ap_by_iata[dst]
        city_a, city_b = ap_a["city"], ap_b["city"]
        if not city_a or not city_b or city_a == city_b:
            continue
        ckey = tuple(sorted((city_a, city_b)))
        rec = city_pairs.setdefault(ckey, {"airlines": set(), "pair_counts": {}})
        if al:
            rec["airlines"].add(al)
        ap_key = tuple(sorted((src, dst)))
        rec["pair_counts"][ap_key] = rec["pair_counts"].get(ap_key, 0) + 1

    candidates = []
    for ckey, rec in city_pairs.items():
        best_pair = max(
            rec["pair_counts"].items(),
            key=lambda kv: (
                kv[1],
                (ap_by_iata[kv[0][0]].get("pax_m") or 0.0)
                + (ap_by_iata[kv[0][1]].get("pax_m") or 0.0),
            ),
        )[0]
        a, b = best_pair
        ap_a, ap_b = ap_by_iata[a], ap_by_iata[b]
        if (ap_b.get("pax_m") or 0.0) > (ap_a.get("pax_m") or 0.0):
            a, b = b, a
            ap_a, ap_b = ap_b, ap_a

        dist = math.hypot(ap_b["x"] - ap_a["x"], ap_b["y"] - ap_a["y"])
        if dist < 240.0:
            continue

        n_al = max(1, len(rec["airlines"]))
        pax_a = max(1.0, float(ap_a.get("pax_m") or 1.0))
        pax_b = max(1.0, float(ap_b.get("pax_m") or 1.0))
        score = n_al * math.sqrt(pax_a * pax_b)
        candidates.append(
            {
                "from_ap": ap_a,
                "to_ap": ap_b,
                "airlines": n_al,
                "dist_km": round(dist, 1),
                "score": score,
            }
        )

    candidates.sort(
        key=lambda c: (-c["score"], -c["airlines"], c["from_ap"]["iata"], c["to_ap"]["iata"])
    )

    selected = []
    seen = set()

    # 1. Top 50 national trunk corridors
    for c in candidates:
        if len(selected) >= 50:
            break
        k = tuple(sorted((c["from_ap"]["city"], c["to_ap"]["city"])))
        if k in seen:
            continue
        seen.add(k)
        c["tier"] = "trunk"
        selected.append(c)

    # 2. Ensure every province has >= 2 real air routes
    prov_deg: dict[str, int] = {}
    for c in selected:
        p1, p2 = c["from_ap"]["province"], c["to_ap"]["province"]
        prov_deg[p1] = prov_deg.get(p1, 0) + 1
        prov_deg[p2] = prov_deg.get(p2, 0) + 1

    for pname in provs:
        need = 2 - prov_deg.get(pname, 0)
        if need <= 0:
            continue
        for c in candidates:
            if need <= 0:
                break
            k = tuple(sorted((c["from_ap"]["city"], c["to_ap"]["city"])))
            if k in seen:
                continue
            p1, p2 = c["from_ap"]["province"], c["to_ap"]["province"]
            if p1 == pname or p2 == pname:
                seen.add(k)
                c["tier"] = "regional"
                selected.append(c)
                prov_deg[p1] = prov_deg.get(p1, 0) + 1
                prov_deg[p2] = prov_deg.get(p2, 0) + 1
                need -= 1

    # 3. Fill remaining slots up to 120 routes with highest-scoring regional corridors
    for c in candidates:
        if len(selected) >= 120:
            break
        k = tuple(sorted((c["from_ap"]["city"], c["to_ap"]["city"])))
        if k in seen:
            continue
        seen.add(k)
        c["tier"] = "regional"
        selected.append(c)

    selected.sort(key=lambda c: (0 if c["tier"] == "trunk" else 1, -c["score"]))

    out_routes = []
    covered_provs = set()
    for idx, c in enumerate(selected, 1):
        ap_a = c["from_ap"]
        ap_b = c["to_ap"]
        covered_provs.add(ap_a["province"])
        covered_provs.add(ap_b["province"])
        out_routes.append(
            {
                "rank": idx,
                "tier": c["tier"],
                "from_iata": ap_a["iata"],
                "to_iata": ap_b["iata"],
                "from_city": ap_a["city"],
                "to_city": ap_b["city"],
                "from_name": ap_a["name"],
                "to_name": ap_b["name"],
                "from_province_idx": ap_a["province_idx"],
                "to_province_idx": ap_b["province_idx"],
                "from_cell": ap_a["cell"],
                "to_cell": ap_b["cell"],
                "airlines": c["airlines"],
                "dist_km": c["dist_km"],
                "pts": curved_flight_arc(ap_a["x"], ap_a["y"], ap_b["x"], ap_b["y"]),
            }
        )

    infra["air_routes"] = out_routes
    infra.setdefault("vintage", {})["air_routes"] = (
        "OpenFlights routes.dat × 中国民航局 CAAC 120核心机场 (2024)"
    )
    infra.setdefault("rules", {})["air_routes"] = (
        "基于 OpenFlights 真实航司执飞航线关联中国大陆及港澳台 120 座核心机场，按同城去重、执飞航司数与枢纽客流量综合加权遴选前 50 条全国主干航线及覆盖全 34 省的 70 条区域航线（共 120 条）。"
    )
    infra_sources = infra.setdefault("sources", [])
    if "openflights_routes" not in infra_sources:
        infra_sources.append("openflights_routes")

    with open(INFRA_PATH, "w", encoding="utf-8") as f:
        json.dump(infra, f, ensure_ascii=False, separators=(",", ":"))

    with open(SOURCES_PATH, "r", encoding="utf-8") as f:
        sources_doc = json.load(f)
    src_list = sources_doc.get("sources", [])
    of_entry = {
        "id": "openflights_routes",
        "name": "OpenFlights 全球民航航线数据库 (routes.dat)",
        "org": "OpenFlights Open Data / CAAC 机场匹配",
        "vintage": "OpenFlights × CAAC 2024",
        "url": "https://openflights.org/data.html",
        "category": "交通物流",
        "description": "匹配中国大陆及港澳台120座核心运输机场之间的真实航司直飞航线与多航司执飞强度，构建120条主干与区域民航航路网络。",
    }
    replaced = False
    for i, item in enumerate(src_list):
        if item.get("id") == "openflights_routes":
            src_list[i] = of_entry
            replaced = True
            break
    if not replaced:
        src_list.append(of_entry)
    sources_doc["sources"] = src_list
    with open(SOURCES_PATH, "w", encoding="utf-8") as f:
        json.dump(sources_doc, f, ensure_ascii=False, separators=(",", ":"))

    trunk_n = sum(1 for r in out_routes if r["tier"] == "trunk")
    reg_n = len(out_routes) - trunk_n
    print(
        f"[air_routes] Wrote {len(out_routes)} routes (trunk={trunk_n}, regional={reg_n}), provinces={len(covered_provs)}/34 -> {INFRA_PATH}"
    )


if __name__ == "__main__":
    main()
