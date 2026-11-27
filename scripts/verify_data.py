#!/usr/bin/env python3
"""Independent Data Contract Audit for ChinaCiv (Phase A).

Verifies all 14 JSON files under web/data/ against frozen schema, GIS/hex-grid,
cross-file referential integrity, and China/Civ domain invariants.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "web" / "data"

DATA_FILES = [
    "world.json",
    "geo_lookup.json",
    "nation.json",
    "states.json",
    "cities.json",
    "counties.json",
    "districts.json",
    "lenses.json",
    "sources.json",
    "resources.json",
    "infrastructure.json",
    "military.json",
    "wonders.json",
    "trade.json",
]

PROVINCE_ORDER = [
    ("110000", "北京市"),
    ("120000", "天津市"),
    ("130000", "河北省"),
    ("140000", "山西省"),
    ("150000", "内蒙古自治区"),
    ("210000", "辽宁省"),
    ("220000", "吉林省"),
    ("230000", "黑龙江省"),
    ("310000", "上海市"),
    ("320000", "江苏省"),
    ("330000", "浙江省"),
    ("340000", "安徽省"),
    ("350000", "福建省"),
    ("360000", "江西省"),
    ("370000", "山东省"),
    ("410000", "河南省"),
    ("420000", "湖北省"),
    ("430000", "湖南省"),
    ("440000", "广东省"),
    ("450000", "广西壮族自治区"),
    ("460000", "海南省"),
    ("500000", "重庆市"),
    ("510000", "四川省"),
    ("520000", "贵州省"),
    ("530000", "云南省"),
    ("540000", "西藏自治区"),
    ("610000", "陕西省"),
    ("620000", "甘肃省"),
    ("630000", "青海省"),
    ("640000", "宁夏回族自治区"),
    ("650000", "新疆维吾尔自治区"),
    ("710000", "台湾省"),
    ("810000", "香港特别行政区"),
    ("820000", "澳门特别行政区"),
]

REQUIRED_COUNTY_FIELDS = [
    "code",
    "name",
    "province_idx",
    "province",
    "region",
    "population",
    "area_km2",
    "density",
    "gdp",
    "gdp_per_capita",
    "income",
    "home_price",
    "low_income",
    "median_age",
    "migrant_pct",
    "bachelors_pct",
    "broadband_pct",
    "commute_min",
    "homeownership_pct",
    "healthcare_gap_pct",
    "forest_pct",
    "farmland_pct",
    "developed_pct",
    "faith_per100",
    "faith_tradition",
    "wellbeing",
    "disasters",
    "stem_pct",
    "precip_mm",
    "elevation_m",
]

REQUIRED_LENS_IDS = [
    "density",
    "income",
    "home",
    "poverty",
    "age",
    "migrant",
    "bachelors",
    "broadband",
    "commute",
    "homeownership",
    "healthcare_gap",
    "forest",
    "farmland",
    "developed",
    "faith",
    "faith_tradition",
    "wellbeing",
    "disasters",
    "stem",
    "precip",
    "elevation",
]

REQUIRED_LENS_GROUPS = {
    "people",
    "prosperity",
    "knowledge",
    "life",
    "faith",
    "hazards",
    "land",
}


class AuditReport:
    def __init__(self) -> None:
        self.failures: list[tuple[str, str]] = []
        self.warnings: list[tuple[str, str]] = []
        self.passes: list[str] = []

    def ok(self, msg: str) -> None:
        self.passes.append(msg)

    def fail(self, owner: str, msg: str) -> None:
        self.failures.append((owner, msg))

    def warn(self, owner: str, msg: str) -> None:
        self.warnings.append((owner, msg))

    def check(self, cond: bool, owner: str, ok_msg: str, fail_msg: str) -> bool:
        if cond:
            self.ok(ok_msg)
            return True
        self.fail(owner, fail_msg)
        return False


def _reject_constant(val: str) -> Any:
    raise ValueError(f"Invalid JSON numeric constant: {val}")


def _scan_nonfinite(obj: Any, path: str = "$") -> str | None:
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return f"{path}={obj}"
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            bad = _scan_nonfinite(v, f"{path}.{k}")
            if bad:
                return bad
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            bad = _scan_nonfinite(v, f"{path}[{i}]")
            if bad:
                return bad
    return None


def file_owner(filename: str) -> str:
    if filename in ("world.json", "geo_lookup.json"):
        return "@data-geo"
    if filename in (
        "nation.json",
        "states.json",
        "cities.json",
        "counties.json",
        "districts.json",
        "lenses.json",
        "sources.json",
    ):
        return "@data-stats"
    return "@data-infra"


def load_all_json(rep: AuditReport) -> dict[str, Any]:
    loaded: dict[str, Any] = {}
    for fname in DATA_FILES:
        owner = file_owner(fname)
        fpath = DATA_DIR / fname
        if not fpath.exists():
            rep.fail(owner, f"Missing file: web/data/{fname}")
            continue
        try:
            raw = fpath.read_text(encoding="utf-8")
            obj = json.loads(raw, parse_constant=_reject_constant)
        except Exception as exc:
            rep.fail(owner, f"Failed to parse web/data/{fname}: {exc}")
            continue
        bad_float = _scan_nonfinite(obj)
        if bad_float:
            rep.fail(owner, f"Non-finite float in web/data/{fname}: {bad_float}")
            continue
        loaded[fname] = obj
        size_kb = fpath.stat().st_size / 1024.0
        rep.ok(f"Parsed {fname} cleanly ({size_kb:.1f} KB), zero NaN/Infinity")
    return loaded


def check_valid_cell(cell: Any, total_cells: int) -> bool:
    return isinstance(cell, int) and not isinstance(cell, bool) and 0 <= cell < total_cells


def audit_geo(rep: AuditReport, data: dict[str, Any]) -> tuple[int, dict[int, list[int]]]:
    world = data.get("world.json")
    geo = data.get("geo_lookup.json")
    if not isinstance(world, dict):
        return 0, {}

    grid = world.get("grid", {})
    cols = grid.get("cols", 0)
    rows = grid.get("rows", 0)
    total_cells = cols * rows if isinstance(cols, int) and isinstance(rows, int) else 0
    rep.check(
        grid.get("spacing_km") == 25 or grid.get("spacing_km") == 25.0,
        "@data-geo",
        f"world.grid.spacing_km == {grid.get('spacing_km')}",
        f"world.grid.spacing_km expected 25, got {grid.get('spacing_km')}",
    )
    rep.check(
        total_cells > 10000,
        "@data-geo",
        f"world.grid dimensions {cols}x{rows} = {total_cells} cells",
        f"Invalid world.grid dimensions cols={cols}, rows={rows}",
    )

    states = world.get("states", [])
    rep.check(
        isinstance(states, list) and len(states) == 34,
        "@data-geo",
        "world.states length == 34",
        f"world.states length expected 34, got {len(states) if isinstance(states, list) else type(states)}",
    )
    if isinstance(states, list) and len(states) == 34:
        for idx, (exp_code, exp_name) in enumerate(PROVINCE_ORDER):
            st = states[idx]
            code = str(st.get("code", "")) if isinstance(st, dict) else ""
            if code != exp_code:
                rep.fail("@data-geo", f"world.states[{idx}] code expected {exp_code} ({exp_name}), got {code}")
                break
        else:
            rep.ok("world.states matches canonical 34 GB/T 2260 PROVINCE_ORDER")

    owner = world.get("owner", [])
    county_arr = world.get("county", [])
    w_counties = world.get("counties", [])
    elev = world.get("elev", [])

    rep.check(
        isinstance(owner, list) and len(owner) == total_cells,
        "@data-geo",
        f"world.owner length matches cols*rows ({total_cells})",
        f"world.owner length {len(owner)} != cols*rows {total_cells}",
    )
    rep.check(
        isinstance(county_arr, list) and len(county_arr) == total_cells,
        "@data-geo",
        f"world.county length matches cols*rows ({total_cells})",
        f"world.county length {len(county_arr)} != cols*rows {total_cells}",
    )
    rep.check(
        isinstance(w_counties, list) and len(w_counties) == 1302,
        "@data-geo",
        "world.counties length == 1302",
        f"world.counties length expected 1302, got {len(w_counties) if isinstance(w_counties, list) else type(w_counties)}",
    )

    prov_counts = [0] * 34
    bad_owner_vals = 0
    bad_china_county = 0
    bad_nonchina_county = 0
    county_cells_from_world: dict[int, list[int]] = {i: [] for i in range(1302)}

    if len(owner) == total_cells and len(county_arr) == total_cells:
        for i in range(total_cells):
            ov = owner[i]
            cv = county_arr[i]
            if not isinstance(ov, int) or ov < -2 or ov >= 34:
                bad_owner_vals += 1
                continue
            if ov >= 0:
                prov_counts[ov] += 1
                if not isinstance(cv, int) or not (0 <= cv < 1302):
                    bad_china_county += 1
                else:
                    county_cells_from_world[cv].append(i)
            else:
                if cv != -1:
                    bad_nonchina_county += 1

    rep.check(
        bad_owner_vals == 0,
        "@data-geo",
        "All world.owner values in {-2,-1,0..33}",
        f"{bad_owner_vals} invalid owner values found",
    )
    rep.check(
        bad_china_county == 0,
        "@data-geo",
        "Every China cell (owner>=0) has valid county in 0..1301",
        f"{bad_china_county} cells with owner>=0 have county outside 0..1301",
    )
    rep.check(
        bad_nonchina_county == 0,
        "@data-geo",
        "Every non-China cell (owner<0) has county == -1",
        f"{bad_nonchina_county} cells with owner<0 have county != -1",
    )

    zero_provs = [f"{i}:{PROVINCE_ORDER[i][1]}" for i, c in enumerate(prov_counts) if c < 1]
    rep.check(
        len(zero_provs) == 0,
        "@data-geo",
        f"All 34 provinces own >=1 hex (BJ={prov_counts[0]}, TJ={prov_counts[1]}, SH={prov_counts[8]}, TW={prov_counts[31]}, HK={prov_counts[32]}, MO={prov_counts[33]})",
        f"Provinces with 0 hexes: {zero_provs}",
    )

    # Check geo_lookup county -> cells coverage
    lookup_county_cells: dict[int, list[int]] = {}
    if isinstance(geo, dict):
        g_counties = geo.get("counties", [])
        rep.check(
            isinstance(g_counties, list) and len(g_counties) == 1302,
            "@data-geo",
            "geo_lookup.counties length == 1302",
            f"geo_lookup.counties expected 1302, got {len(g_counties) if isinstance(g_counties, list) else type(g_counties)}",
        )
        if isinstance(g_counties, list):
            empty_lookup = []
            bad_cell_refs = 0
            for idx, item in enumerate(g_counties):
                if not isinstance(item, dict):
                    empty_lookup.append(idx)
                    continue
                c_idx = item.get("idx", idx)
                cells = item.get("cells", [])
                if not isinstance(cells, list) or len(cells) < 1:
                    empty_lookup.append(c_idx)
                else:
                    for c in cells:
                        if not check_valid_cell(c, total_cells):
                            bad_cell_refs += 1
                    lookup_county_cells[c_idx] = cells
            rep.check(
                len(empty_lookup) == 0 and len(lookup_county_cells) == 1302,
                "@data-geo",
                "Every county 0..1301 in geo_lookup.json maps to >=1 hex cell",
                f"{len(empty_lookup)} counties in geo_lookup.json lack >=1 hex cell (sample: {empty_lookup[:10]})",
            )
            rep.check(
                bad_cell_refs == 0,
                "@data-geo",
                "All geo_lookup county cell indices are valid",
                f"{bad_cell_refs} out-of-range cell indices in geo_lookup.counties",
            )

    # Also verify world.countyCells or county array coverage
    missing_world_county = [i for i in range(1302) if len(county_cells_from_world[i]) == 0]
    w_county_cells = world.get("countyCells")
    if isinstance(w_county_cells, list) and len(w_county_cells) == 1302:
        empty_wc = [i for i, arr in enumerate(w_county_cells) if not isinstance(arr, list) or len(arr) < 1]
        rep.check(
            len(empty_wc) == 0,
            "@data-geo",
            "world.countyCells maps all 1,302 counties to >=1 hex",
            f"{len(empty_wc)} entries in world.countyCells are empty (sample: {empty_wc[:10]})",
        )
    elif missing_world_county:
        # Check if lookup covers them cleanly (expected when tiny urban districts share a hex)
        uncovered = [i for i in missing_world_county if len(lookup_county_cells.get(i, [])) == 0]
        if uncovered:
            rep.fail("@data-geo", f"{len(uncovered)} counties have 0 cells in both world.county and geo_lookup.json")
        else:
            rep.ok(
                f"All 1,302 counties map to >=1 hex via geo_lookup.json ({len(missing_world_county)} tiny districts share a primary hex)"
            )
    else:
        rep.ok("Every county 0..1301 appears in world.county array")

    # Elevation sanity checks
    if isinstance(elev, list) and len(elev) == total_cells and len(owner) == total_cells:
        tibet_elevs = [elev[i] for i in range(total_cells) if owner[i] == 25]
        east_provs = {1, 8, 9}  # Tianjin, Shanghai, Jiangsu
        east_elevs = [elev[i] for i in range(total_cells) if owner[i] in east_provs]
        tibet_mean = sum(tibet_elevs) / len(tibet_elevs) if tibet_elevs else -9999
        east_mean = sum(east_elevs) / len(east_elevs) if east_elevs else 9999
        rep.check(
            tibet_mean > 3500,
            "@data-geo",
            f"Tibet mean elevation = {tibet_mean:.1f}m (>3500m)",
            f"Tibet mean elevation too low: {tibet_mean:.1f}m (expected >3500m)",
        )
        rep.check(
            east_mean < 200,
            "@data-geo",
            f"East China plains (TJ/SH/JS) mean elevation = {east_mean:.1f}m (<200m)",
            f"East China plains mean elevation too high: {east_mean:.1f}m (expected <200m)",
        )
    else:
        rep.fail("@data-geo", "world.elev missing or wrong length")

    # Rivers and SCS line
    rivers = world.get("rivers", [])
    scs_line = world.get("scs_line", [])
    rep.check(
        isinstance(rivers, list) and len(rivers) > 30,
        "@data-geo",
        f"world.rivers count = {len(rivers)} (>30)",
        f"world.rivers expected >30, got {len(rivers) if isinstance(rivers, list) else type(rivers)}",
    )
    rep.check(
        isinstance(scs_line, list) and len(scs_line) > 0,
        "@data-geo",
        f"world.scs_line non-empty ({len(scs_line)} segments/points)",
        "world.scs_line missing or empty",
    )

    # Land cover & pct
    cover = world.get("cover", [])
    bad_cover = sum(1 for c in cover if not isinstance(c, int) or not (0 <= c <= 9)) if isinstance(cover, list) else -1
    rep.check(
        isinstance(cover, list) and len(cover) == total_cells and bad_cover == 0,
        "@data-geo",
        "world.cover valid 0..9 across all cells",
        f"world.cover invalid: len={len(cover) if isinstance(cover, list) else None}, bad={bad_cover}",
    )

    pct = world.get("pct", {})
    pct_keys = ["forest", "crop", "grass", "shrub", "wetland", "developed", "alpine"]
    if isinstance(pct, dict) and all(k in pct for k in pct_keys):
        bad_pct = []
        for k in pct_keys:
            arr = pct[k]
            if not isinstance(arr, list) or len(arr) != total_cells:
                bad_pct.append(f"{k}:len")
            elif any(not isinstance(v, (int, float)) or v < 0 or v > 100 for v in arr):
                bad_pct.append(f"{k}:range")
        rep.check(
            len(bad_pct) == 0,
            "@data-geo",
            f"world.pct has all 7 cover channels aligned to {total_cells} cells",
            f"world.pct invalid channels: {bad_pct}",
        )
    else:
        rep.fail("@data-geo", f"world.pct missing required channels: {set(pct_keys) - set(pct.keys() if isinstance(pct, dict) else [])}")

    # Annual precipitation & 400mm isohyet checks
    precip = world.get("precip", [])
    if isinstance(precip, list) and len(precip) == total_cells and len(owner) == total_cells:
        bad_china_p = [i for i in range(total_cells) if owner[i] >= 0 and (not isinstance(precip[i], (int, float)) or precip[i] <= 0)]
        rep.check(
            len(bad_china_p) == 0,
            "@data-geo",
            "world.precip valid (>0 mm) across all China land hexes",
            f"{len(bad_china_p)} China hexes have invalid/zero precip",
        )
        se_vals = [precip[i] for i in range(total_cells) if owner[i] in (12, 18, 31)]  # Fujian, Guangdong, Taiwan
        xj_vals = [precip[i] for i in range(total_cells) if owner[i] == 30]  # Xinjiang
        se_mean = sum(se_vals) / len(se_vals) if se_vals else 0
        xj_mean = sum(xj_vals) / len(xj_vals) if xj_vals else 9999
        rep.check(
            se_mean > 1300,
            "@data-geo",
            f"SE coastal (FJ/GD/TW) mean precip = {se_mean:.1f} mm (>1300 mm)",
            f"SE coastal mean precip too low: {se_mean:.1f} mm",
        )
        rep.check(
            xj_mean < 260,
            "@data-geo",
            f"Xinjiang mean precip = {xj_mean:.1f} mm (<260 mm)",
            f"Xinjiang mean precip too high: {xj_mean:.1f} mm",
        )
    else:
        rep.fail("@data-geo", "world.precip missing or wrong length")

    iso = world.get("isohyet_400", {})
    iso_lines = iso.get("lines", []) if isinstance(iso, dict) else []
    iso_len = 0.0
    for pl in iso_lines:
        for a, b in zip(pl, pl[1:]):
            iso_len += math.hypot(b[0] - a[0], b[1] - a[1])
    rep.check(
        isinstance(iso_lines, list) and len(iso_lines) >= 1 and iso_len > 2000.0,
        "@data-geo",
        f"world.isohyet_400 has {len(iso_lines)} line(s), total length = {iso_len:.1f} km (>2000 km)",
        f"world.isohyet_400 missing or too short: lines={len(iso_lines)}, len={iso_len:.1f} km",
    )

    return total_cells, lookup_county_cells


def audit_stats(rep: AuditReport, data: dict[str, Any], total_cells: int) -> None:
    # 1. nation.json
    nation = data.get("nation.json")
    if isinstance(nation, dict):
        bench = nation.get("benchmarks", {})
        nat_stem_n = bench.get("national_stem_1_in")
        sz_stem_n = bench.get("shenzhen_stem_1_in")
        stem_share = nation.get("stem_share")
        rep.check(
            isinstance(stem_share, (int, float)) and 0.06 <= stem_share <= 0.085,
            "@data-stats",
            f"nation.stem_share = {stem_share:.4f} (~1/14 = 0.0714)",
            f"nation.stem_share expected ~0.0714, got {stem_share}",
        )
        rep.check(
            nat_stem_n is None or (12 <= nat_stem_n <= 16),
            "@data-stats",
            f"nation.benchmarks.national_stem_1_in = {nat_stem_n}",
            f"nation.benchmarks.national_stem_1_in expected ~14, got {nat_stem_n}",
        )
        rep.check(
            sz_stem_n is None or (4 <= sz_stem_n <= 6),
            "@data-stats",
            f"nation.benchmarks.shenzhen_stem_1_in = {sz_stem_n}",
            f"nation.benchmarks.shenzhen_stem_1_in expected ~5, got {sz_stem_n}",
        )
        yields = nation.get("yields", {})
        rep.check(
            isinstance(yields, dict) and all(k in yields for k in ("food", "production", "gold", "science", "culture")),
            "@data-stats",
            "nation.yields has all 5 Civ yields",
            f"nation.yields missing required keys: {list(yields.keys()) if isinstance(yields, dict) else yields}",
        )

    # 2. states.json
    states = data.get("states.json")
    rep.check(
        isinstance(states, list) and len(states) == 34,
        "@data-stats",
        "states.json exact length == 34",
        f"states.json length expected 34, got {len(states) if isinstance(states, list) else type(states)}",
    )
    if isinstance(states, list) and len(states) == 34:
        bad_cells = [s.get("name") for s in states if not check_valid_cell(s.get("cell"), total_cells)]
        rep.check(
            len(bad_cells) == 0,
            "@data-stats",
            "All 34 states have valid hex cell indices",
            f"States with invalid cell indices: {bad_cells}",
        )
        order_bad = [
            (i, states[i].get("code"), PROVINCE_ORDER[i][0])
            for i in range(34)
            if str(states[i].get("code")) != PROVINCE_ORDER[i][0]
        ]
        rep.check(
            len(order_bad) == 0,
            "@data-stats",
            "states.json matches canonical 34 PROVINCE_ORDER",
            f"states.json order/code mismatches: {order_bad[:5]}",
        )

    # 3. cities.json
    cities = data.get("cities.json")
    rep.check(
        isinstance(cities, list) and len(cities) >= 40,
        "@data-stats",
        f"cities.json count = {len(cities) if isinstance(cities, list) else 0}",
        f"cities.json missing or too small: {len(cities) if isinstance(cities, list) else type(cities)}",
    )
    if isinstance(cities, list):
        anchors = {c.get("province_idx") for c in cities if c.get("is_provincial_anchor")}
        missing_anchors = [i for i in range(34) if i not in anchors]
        rep.check(
            len(missing_anchors) == 0,
            "@data-stats",
            "All 34 provinces have an is_provincial_anchor city in cities.json",
            f"Missing provincial anchor cities for province_idx: {missing_anchors}",
        )
        sz_matches = [
            c
            for c in cities
            if str(c.get("id", "")).lower() in ("shenzhen", "440300")
            or "深圳" in str(c.get("name", ""))
        ]
        if sz_matches:
            sz = sz_matches[0]
            sz_ratio = sz.get("stem_ratio_1_in_n")
            sz_share = sz.get("stem_share")
            rep.check(
                isinstance(sz_ratio, (int, float)) and 4.3 <= sz_ratio <= 5.7,
                "@data-stats",
                f"Shenzhen stem_ratio_1_in_n = {sz_ratio} (~5)",
                f"Shenzhen stem_ratio_1_in_n expected ~5, got {sz_ratio}",
            )
            rep.check(
                isinstance(sz_share, (int, float)) and 0.17 <= sz_share <= 0.23,
                "@data-stats",
                f"Shenzhen stem_share = {sz_share:.3f} (~0.20)",
                f"Shenzhen stem_share expected ~0.20, got {sz_share}",
            )
        else:
            rep.fail("@data-stats", "Shenzhen not found in cities.json")

        bad_city_cells = [c.get("name") for c in cities if not check_valid_cell(c.get("cell"), total_cells)]
        rep.check(
            len(bad_city_cells) == 0,
            "@data-stats",
            "All cities have valid hex cell indices",
            f"Cities with invalid cell indices: {bad_city_cells[:10]}",
        )
        empty_footprints = [c.get("name") for c in cities if not isinstance(c.get("footprint"), list) or len(c.get("footprint", [])) < 1]
        rep.check(
            len(empty_footprints) == 0,
            "@data-stats",
            "All cities have non-empty hex footprints",
            f"Cities with empty footprints: {empty_footprints[:10]}",
        )

    # 4. districts.json
    districts = data.get("districts.json")
    if isinstance(districts, dict):
        d_cities = districts.get("cities", {})
        d_provs = districts.get("provinces", {})
        missing_d_provs = [code for code, _ in PROVINCE_ORDER if code not in d_provs]
        rep.check(
            len(missing_d_provs) == 0,
            "@data-stats",
            "districts.provinces covers all 34 province codes",
            f"districts.provinces missing codes: {missing_d_provs}",
        )
        if isinstance(cities, list):
            missing_d_cities = [c.get("id") for c in cities if c.get("id") not in d_cities]
            rep.check(
                len(missing_d_cities) == 0,
                "@data-stats",
                f"districts.cities covers all {len(cities)} cities in cities.json",
                f"districts.cities missing city IDs: {missing_d_cities[:10]}",
            )

        # Beijing: 2 campus districts
        bj_city = d_cities.get("beijing") or d_cities.get("110000")
        bj_prov = d_provs.get("110000")
        for label, entry in [("districts.cities.beijing", bj_city), ("districts.provinces.110000", bj_prov)]:
            if isinstance(entry, dict):
                campus_cnt = sum(1 for d in entry.get("districts", []) if d.get("type") == "campus")
                rep.check(
                    campus_cnt == 2,
                    "@data-stats",
                    f"{label} has 2 campus districts",
                    f"{label} expected 2 campus districts, got {campus_cnt}",
                )
            else:
                rep.fail("@data-stats", f"Missing {label} in districts.json")

        # Shanghai: 金融中心 badge & commercial district
        sh_city = d_cities.get("shanghai") or d_cities.get("310000")
        sh_prov = d_provs.get("310000")
        for label, entry in [("districts.cities.shanghai", sh_city), ("districts.provinces.310000", sh_prov)]:
            if isinstance(entry, dict):
                badge = str(entry.get("badge", ""))
                has_comm = any(d.get("type") == "commercial" for d in entry.get("districts", []))
                has_fin_name = any("金融" in str(d.get("name", "")) for d in entry.get("districts", []))
                rep.check(
                    "金融中心" in badge and has_comm and has_fin_name,
                    "@data-stats",
                    f"{label} has badge='金融中心' and commercial financial district",
                    f"{label} failed Shanghai check: badge={badge!r}, has_comm={has_comm}, has_fin_name={has_fin_name}",
                )
            else:
                rep.fail("@data-stats", f"Missing {label} in districts.json")

    # 5. counties.json
    counties = data.get("counties.json")
    if isinstance(counties, dict):
        fields = counties.get("fields", [])
        columns = counties.get("columns", [])
        rows = counties.get("rows", [])
        rep.check(
            isinstance(rows, list) and len(rows) == 1302,
            "@data-stats",
            "counties.rows exact length == 1302",
            f"counties.rows expected 1302, got {len(rows) if isinstance(rows, list) else type(rows)}",
        )
        field_keys = {f.get("key") for f in fields if isinstance(f, dict)}
        col_keys = set(columns) if isinstance(columns, list) else set()
        present_keys = field_keys | col_keys
        if not present_keys and isinstance(rows, list) and rows and isinstance(rows[0], dict):
            present_keys = set(rows[0].keys())

        missing_req = [k for k in REQUIRED_COUNTY_FIELDS if k not in present_keys]
        rep.check(
            len(missing_req) == 0,
            "@data-stats",
            f"counties.json exposes all {len(REQUIRED_COUNTY_FIELDS)} required columns",
            f"counties.json missing required columns: {missing_req}",
        )

        # Check non-null values on all required columns across all 1302 rows
        if isinstance(rows, list) and len(rows) == 1302:
            null_counts: dict[str, int] = {k: 0 for k in REQUIRED_COUNTY_FIELDS}
            for r in rows:
                if isinstance(r, dict):
                    for k in REQUIRED_COUNTY_FIELDS:
                        v = r.get(k)
                        if v is None or v == "":
                            null_counts[k] += 1
                elif isinstance(r, list) and isinstance(columns, list):
                    col_idx = {c: i for i, c in enumerate(columns)}
                    for k in REQUIRED_COUNTY_FIELDS:
                        idx = col_idx.get(k)
                        v = r[idx] if idx is not None and idx < len(r) else None
                        if v is None or v == "":
                            null_counts[k] += 1
                else:
                    rep.fail("@data-stats", f"Unexpected row type in counties.rows: {type(r)}")
                    break
            bad_cols = {k: v for k, v in null_counts.items() if v > 0}
            rep.check(
                len(bad_cols) == 0,
                "@data-stats",
                f"All 1,302 county rows have non-missing values across all {len(REQUIRED_COUNTY_FIELDS)} required columns",
                f"counties.rows has missing/empty values: {bad_cols}",
            )
            world_counties = data.get("world.json", {}).get("counties", [])
            if isinstance(world_counties, list) and len(world_counties) == 1302:
                code_mismatches = [
                    i
                    for i in range(1302)
                    if isinstance(rows[i], dict)
                    and str(rows[i].get("code")) != str(world_counties[i].get("code"))
                ]
                rep.check(
                    len(code_mismatches) == 0,
                    "@data-stats",
                    "counties.rows 0..1301 align 1-to-1 with world.counties codes",
                    f"counties.rows code mismatch vs world.counties at indices: {code_mismatches[:10]}",
                )

    # 6. lenses.json
    lenses = data.get("lenses.json")
    lens_list = lenses.get("lenses", []) if isinstance(lenses, dict) else lenses
    rep.check(
        isinstance(lens_list, list) and len(lens_list) >= 21,
        "@data-stats",
        f"lenses.json count == {len(lens_list) if isinstance(lens_list, list) else 0} (>=21)",
        f"lenses.json expected >=21 lenses, got {len(lens_list) if isinstance(lens_list, list) else type(lens_list)}",
    )
    if isinstance(lens_list, list):
        got_ids = [l.get("id") for l in lens_list if isinstance(l, dict)]
        missing_lenses = [lid for lid in REQUIRED_LENS_IDS if lid not in got_ids]
        rep.check(
            len(missing_lenses) == 0,
            "@data-stats",
            f"All {len(REQUIRED_LENS_IDS)} required lens IDs present",
            f"lenses.json missing lens IDs: {missing_lenses}",
        )
        got_groups = {l.get("group") for l in lens_list if isinstance(l, dict)}
        missing_groups = REQUIRED_LENS_GROUPS - got_groups
        if missing_groups:
            rep.warn("@data-stats", f"lenses.json groups missing: {missing_groups}")
        else:
            rep.ok("All 7 lens groups represented in lenses.json")

    # 7. sources.json
    sources = data.get("sources.json")
    src_list = sources.get("sources", []) if isinstance(sources, dict) else sources
    rep.check(
        isinstance(src_list, list) and len(src_list) >= 25,
        "@data-stats",
        f"sources.json count = {len(src_list) if isinstance(src_list, list) else 0} (>=25)",
        f"sources.json expected >=25 sources, got {len(src_list) if isinstance(src_list, list) else type(src_list)}",
    )


def audit_infra(rep: AuditReport, data: dict[str, Any], total_cells: int) -> None:
    # 1. resources.json
    res = data.get("resources.json")
    if isinstance(res, dict):
        items = res.get("items", [])
        plant_types = {"nuclear", "hydro", "coal_plant", "wind", "solar", "pumped_storage"}
        mine_types = {"coal_mine", "oil", "gas", "rare_earths", "iron", "copper", "gold", "lithium", "tungsten", "bauxite"}
        seen_types = {it.get("type") for it in items if isinstance(it, dict)}
        plants_cnt = sum(1 for it in items if isinstance(it, dict) and it.get("type") in plant_types)
        mines_cnt = sum(1 for it in items if isinstance(it, dict) and it.get("type") in mine_types)
        bad_res_cells = sum(1 for it in items if isinstance(it, dict) and not check_valid_cell(it.get("cell"), total_cells))
        rep.check(
            plants_cnt >= 100 and mines_cnt >= 20,
            "@data-infra",
            f"resources.json has {plants_cnt} power plants and {mines_cnt} mines/fields across {len(seen_types)} types",
            f"resources.json insufficient items: plants={plants_cnt}, mines={mines_cnt}",
        )
        rep.check(
            bad_res_cells == 0,
            "@data-infra",
            "All resource items have valid hex cell indices",
            f"{bad_res_cells} items in resources.json have invalid cell indices",
        )

    # 2. infrastructure.json
    infra = data.get("infrastructure.json")
    if isinstance(infra, dict):
        roads = infra.get("roads", [])
        rail = infra.get("rail", [])
        ports = infra.get("ports", [])
        airports = infra.get("airports", [])
        hsr_cnt = sum(1 for r in rail if isinstance(r, dict) and r.get("tier") == "hsr")
        rep.check(
            len(roads) > 0 and len(rail) > 0 and hsr_cnt > 0 and len(ports) >= 20 and len(airports) >= 50,
            "@data-infra",
            f"infrastructure.json: roads={len(roads)}, rail={len(rail)} (HSR={hsr_cnt}), ports={len(ports)}, airports={len(airports)}",
            f"infrastructure.json incomplete: roads={len(roads)}, rail={len(rail)}, hsr={hsr_cnt}, ports={len(ports)}, airports={len(airports)}",
        )

    # 3. military.json
    mil = data.get("military.json")
    if isinstance(mil, dict):
        theaters = mil.get("theaters", [])
        insts = mil.get("installations", [])
        ranges = mil.get("ranges", [])
        rep.check(
            isinstance(theaters, list) and len(theaters) == 5,
            "@data-infra",
            "military.json has 5 PLA Theater Commands",
            f"military.theaters expected 5, got {len(theaters) if isinstance(theaters, list) else type(theaters)}",
        )
        rep.check(
            isinstance(insts, list) and len(insts) >= 30 and isinstance(ranges, list) and len(ranges) >= 3,
            "@data-infra",
            f"military.json: {len(insts)} installations, {len(ranges)} training/test ranges",
            f"military.json insufficient installations ({len(insts)}) or ranges ({len(ranges)})",
        )
        m_provs = mil.get("provinces", {})
        rep.check(
            isinstance(m_provs, dict) and len(m_provs) == 34,
            "@data-infra",
            "military.provinces covers 34 provincial entries",
            f"military.provinces expected 34 entries, got {len(m_provs) if isinstance(m_provs, dict) else type(m_provs)}",
        )

    # 4. wonders.json
    wond = data.get("wonders.json")
    if isinstance(wond, dict):
        w_list = wond.get("wonders", [])
        rules = wond.get("rules", [])
        rep.check(
            isinstance(w_list, list) and len(w_list) >= 45,
            "@data-infra",
            f"wonders.json has {len(w_list)} wonders (>=45)",
            f"wonders.json expected >=45 wonders, got {len(w_list) if isinstance(w_list, list) else type(w_list)}",
        )
        rule_text = json.dumps(rules, ensure_ascii=False)
        has_rules = isinstance(rules, list) and len(rules) >= 4
        has_park_visits = any(w.get("kind") == "national_park" and ("visits" in json.dumps(w) or "visit" in json.dumps(w)) for w in w_list)
        has_uni_rd = any(w.get("kind") == "university" and ("rd" in json.dumps(w).lower()) for w in w_list)
        rep.check(
            has_rules and has_park_visits and has_uni_rd,
            "@data-infra",
            f"wonders.json has {len(rules)} explicit selection rules (parks by visits, universities by R&D)",
            f"wonders.json rules check failed: len(rules)={len(rules) if isinstance(rules, list) else None}, park_visits={has_park_visits}, uni_rd={has_uni_rd} ({rule_text[:120]})",
        )
        bad_w_cells = sum(1 for w in w_list if not check_valid_cell(w.get("cell"), total_cells))
        rep.check(
            bad_w_cells == 0,
            "@data-infra",
            "All wonders have valid hex cell indices",
            f"{bad_w_cells} wonders have invalid cell indices",
        )
        w_req = ("id", "name", "short", "kind", "rule", "rank", "province_idx", "city_name", "x", "y", "cell", "metrics", "description")
        bad_w_fields = [w.get("name") for w in w_list if not all(k in w for k in w_req)]
        rep.check(
            len(bad_w_fields) == 0,
            "@data-infra",
            "All wonders carry all required metadata fields",
            f"Wonders missing required fields: {bad_w_fields[:10]}",
        )

    # 5. trade.json
    trade = data.get("trade.json")
    if isinstance(trade, dict):
        routes = trade.get("routes", [])
        rep.check(
            isinstance(routes, list) and len(routes) == 40,
            "@data-infra",
            "trade.json exact route count == 40",
            f"trade.routes expected 40, got {len(routes) if isinstance(routes, list) else type(routes)}",
        )
        if isinstance(routes, list):
            bad_t_cells = sum(
                1
                for r in routes
                if not check_valid_cell(r.get("from_cell"), total_cells)
                or not check_valid_cell(r.get("to_cell"), total_cells)
            )
            rep.check(
                bad_t_cells == 0,
                "@data-infra",
                "All 40 trade routes have valid from_cell and to_cell indices",
                f"{bad_t_cells} trade routes have invalid from_cell/to_cell indices",
            )


def main() -> int:
    rep = AuditReport()
    data = load_all_json(rep)
    total_cells, _ = audit_geo(rep, data)
    if total_cells > 0:
        audit_stats(rep, data, total_cells)
        audit_infra(rep, data, total_cells)

    print(f"=== CHINACIV DATA AUDIT: {len(rep.passes)} PASSED, {len(rep.warnings)} WARNINGS, {len(rep.failures)} FAILED ===")
    for p in rep.passes:
        print(f"  [PASS] {p}")
    for owner, w in rep.warnings:
        print(f"  [WARN] {owner}: {w}")
    for owner, f in rep.failures:
        print(f"  [FAIL] {owner}: {f}")

    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.exit(main())
