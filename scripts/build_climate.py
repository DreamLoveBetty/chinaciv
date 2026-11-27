#!/usr/bin/env python3
"""Download WorldClim v2.1 5m precipitation raster, extract 25km per-hex annual
precipitation & China's continental 400mm isohyet line, and update world.json,
counties.json (with precip_mm and elevation_m), lenses.json, and sources.json.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
import time
from typing import Any
import zipfile

import numpy as np
from PIL import Image
import requests
from shapely import points as sh_points
from shapely import transform as sh_transform
from shapely.geometry import GeometryCollection, LineString, MultiLineString, shape
from shapely.ops import unary_union

from geo_common import (
    GEO_LOOKUP_PATH,
    PROJ_STRING,
    R_KM,
    RAW_GEO_DIR,
    ROOT_DIR,
    WORLD_JSON_PATH,
    _FWD_TRANSFORMER,
    _INV_TRANSFORMER,
    aea_to_xy,
    cell_center,
    hex_corners,
    load_grid,
    lonlat_to_xy,
)

WORLDCLIM_URL = "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_5m_prec.zip"
WORLDCLIM_ZIP = RAW_GEO_DIR / "wc2.1_5m_prec.zip"

DATA_DIR = ROOT_DIR / "web" / "data"
COUNTIES_PATH = DATA_DIR / "counties.json"
LENSES_PATH = DATA_DIR / "lenses.json"
SOURCES_PATH = DATA_DIR / "sources.json"
CITIES_PATH = DATA_DIR / "cities.json"

LON_MIN, LON_MAX = 70.0, 138.0
LAT_MIN, LAT_MAX = 3.0, 56.0


def download_worldclim(dest: Path, retries: int = 3) -> None:
    if dest.exists() and dest.stat().st_size > 1_000_000:
        try:
            with zipfile.ZipFile(dest, "r") as zf:
                names = set(zf.namelist())
                if all(f"wc2.1_5m_prec_{m:02d}.tif" in names for m in range(1, 13)):
                    print(f"[cache] Using valid {dest}")
                    return
        except zipfile.BadZipFile:
            pass

    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            print(f"[download] Fetching {WORLDCLIM_URL} (attempt {attempt + 1}/{retries})...")
            tmp = dest.with_suffix(".zip.part")
            with requests.get(WORLDCLIM_URL, stream=True, timeout=180) as r:
                r.raise_for_status()
                with tmp.open("wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        if chunk:
                            f.write(chunk)
            with zipfile.ZipFile(tmp, "r") as zf:
                names = set(zf.namelist())
                if not all(f"wc2.1_5m_prec_{m:02d}.tif" in names for m in range(1, 13)):
                    raise RuntimeError("Downloaded zip missing monthly prec TIFFs")
            tmp.replace(dest)
            print(f"[download] Saved {dest} ({dest.stat().st_size / (1024 * 1024):.1f} MB)")
            return
        except Exception as exc:
            last_err = exc
            time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"Failed downloading {WORLDCLIM_URL}: {last_err}")


def load_annual_precip_crop(zip_path: Path) -> tuple[np.ndarray, float, float, float, float]:
    """Read 12 monthly WorldClim 5m GeoTIFFs and sum them over China bbox."""
    with zipfile.ZipFile(zip_path, "r") as zf:
        with zf.open("wc2.1_5m_prec_01.tif") as f0:
            im0 = Image.open(f0)
            w_full, h_full = im0.size
            tags = getattr(im0, "tag_v2", {})
            px_scale = tags.get(33550)
            tiepoint = tags.get(33922)
            nodata_tag = tags.get(42113)
            arr0_probe = np.array(im0)
            print(
                f"[raster] size={w_full}x{h_full}, mode={im0.mode}, dtype={arr0_probe.dtype}, "
                f"scale={px_scale}, tie={tiepoint}, nodata_tag={nodata_tag}"
            )

        if px_scale and tiepoint and len(px_scale) >= 2 and len(tiepoint) >= 6:
            dlon = float(px_scale[0])
            dlat = float(px_scale[1])
            origin_lon = float(tiepoint[3])
            origin_lat = float(tiepoint[4])
        else:
            dlon = 360.0 / w_full
            dlat = 180.0 / h_full
            origin_lon = -180.0
            origin_lat = 90.0

        c0 = max(0, int(math.floor((LON_MIN - origin_lon) / dlon)))
        c1 = min(w_full, int(math.ceil((LON_MAX - origin_lon) / dlon)))
        r0 = max(0, int(math.floor((origin_lat - LAT_MAX) / dlat)))
        r1 = min(h_full, int(math.ceil((origin_lat - LAT_MIN) / dlat)))

        crop_h = r1 - r0
        crop_w = c1 - c0
        annual = np.zeros((crop_h, crop_w), dtype=np.float64)
        valid_mask = np.ones((crop_h, crop_w), dtype=bool)

        for m in range(1, 13):
            fname = f"wc2.1_5m_prec_{m:02d}.tif"
            with zf.open(fname) as f:
                im = Image.open(f)
                # PIL crop box uses (left, upper, right, lower)
                crop = im.crop((c0, r0, c1, r1))
                arr = np.array(crop, dtype=np.float64)
                m_valid = np.isfinite(arr) & (arr >= 0.0) & (arr <= 5000.0)
                if nodata_tag is not None:
                    try:
                        m_valid &= arr != float(nodata_tag)
                    except ValueError:
                        pass
                valid_mask &= m_valid
                annual += np.where(m_valid, arr, 0.0)

        annual = np.where(valid_mask, annual, np.nan).astype(np.float32)

        crop_origin_lon = origin_lon + c0 * dlon
        crop_origin_lat = origin_lat - r0 * dlat
        print(
            f"[raster] crop cols=[{c0},{c1}) rows=[{r0},{r1}) -> shape={annual.shape}, "
            f"lon=[{crop_origin_lon:.2f},{crop_origin_lon + crop_w * dlon:.2f}], "
            f"lat=[{crop_origin_lat - crop_h * dlat:.2f},{crop_origin_lat:.2f}], "
            f"valid={int(valid_mask.sum())}/{valid_mask.size}"
        )
        return annual, crop_origin_lon, crop_origin_lat, dlon, dlat


def bilinear_sample(
    grid: np.ndarray,
    lons: np.ndarray,
    lats: np.ndarray,
    lon0: float,
    lat0: float,
    dlon: float,
    dlat: float,
    max_search: int = 8,
) -> np.ndarray:
    """Bilinearly sample grid (NaN = invalid) with valid-neighbor fallback for coasts/islands."""
    h, w = grid.shape
    fc = (lons - lon0) / dlon - 0.5
    fr = (lat0 - lats) / dlat - 0.5

    c0 = np.floor(fc).astype(np.int32)
    r0 = np.floor(fr).astype(np.int32)
    wx = np.clip(fc - c0, 0.0, 1.0)
    wy = np.clip(fr - r0, 0.0, 1.0)

    out = np.full(len(lons), np.nan, dtype=np.float64)

    in_bounds = (r0 >= 0) & (r0 + 1 < h) & (c0 >= 0) & (c0 + 1 < w)
    idx_b = np.nonzero(in_bounds)[0]
    if idx_b.size > 0:
        rb = r0[idx_b]
        cb = c0[idx_b]
        wxb = wx[idx_b]
        wyb = wy[idx_b]

        v00 = grid[rb, cb]
        v10 = grid[rb, cb + 1]
        v01 = grid[rb + 1, cb]
        v11 = grid[rb + 1, cb + 1]

        w00 = np.where(np.isfinite(v00), (1.0 - wxb) * (1.0 - wyb), 0.0)
        w10 = np.where(np.isfinite(v10), wxb * (1.0 - wyb), 0.0)
        w01 = np.where(np.isfinite(v01), (1.0 - wxb) * wyb, 0.0)
        w11 = np.where(np.isfinite(v11), wxb * wyb, 0.0)

        wsum = w00 + w10 + w01 + w11
        val = (
            w00 * np.where(np.isfinite(v00), v00, 0.0)
            + w10 * np.where(np.isfinite(v10), v10, 0.0)
            + w01 * np.where(np.isfinite(v01), v01, 0.0)
            + w11 * np.where(np.isfinite(v11), v11, 0.0)
        )
        ok = wsum > 1e-6
        out[idx_b[ok]] = val[ok] / wsum[ok]

    # Nearest valid neighbor fallback for coastal / offshore island points
    missing = np.nonzero(~np.isfinite(out))[0]
    for k in missing:
        rc = int(round(fr[k]))
        cc = int(round(fc[k]))
        best_val = np.nan
        best_d2 = 1e18
        r_lo = max(0, rc - max_search)
        r_hi = min(h - 1, rc + max_search)
        c_lo = max(0, cc - max_search)
        c_hi = min(w - 1, cc + max_search)
        sub = grid[r_lo : r_hi + 1, c_lo : c_hi + 1]
        vr, vc = np.nonzero(np.isfinite(sub))
        if vr.size > 0:
            dr = (r_lo + vr) - fr[k]
            dc = (c_lo + vc) - fc[k]
            d2 = dr * dr + dc * dc
            bi = int(np.argmin(d2))
            best_d2 = float(d2[bi])
            best_val = float(sub[vr[bi], vc[bi]])
        if np.isfinite(best_val) and best_d2 <= (max_search + 2) ** 2:
            out[k] = best_val

    return out


def spot_check_raster(annual: np.ndarray, lon0: float, lat0: float, dlon: float, dlat: float) -> None:
    cities = [
        ("Beijing", 116.40, 39.90, (420, 750)),
        ("Guangzhou", 113.26, 23.13, (1450, 2200)),
        ("Shanghai", 121.47, 31.23, (950, 1400)),
        ("Lanzhou", 103.83, 36.06, (220, 460)),
        ("Lhasa", 91.11, 29.65, (300, 620)),
        ("Turpan", 89.19, 42.95, (0, 120)),
        ("Kashgar", 75.99, 39.47, (0, 140)),
    ]
    lons = np.array([c[1] for c in cities], dtype=np.float64)
    lats = np.array([c[2] for c in cities], dtype=np.float64)
    vals = bilinear_sample(annual, lons, lats, lon0, lat0, dlon, dlat)
    print("[spot-check] Annual precip (mm/yr):")
    for (name, _, _, (lo, hi)), val in zip(cities, vals):
        status = "OK" if (np.isfinite(val) and lo <= val <= hi) else "WARN"
        print(f"  {name:10s}: {val:7.1f} mm  (expected {lo}..{hi}) [{status}]")


def normalized_gaussian_smooth(grid: np.ndarray, sigma: float = 2.6) -> np.ndarray:
    """Separable 2D normalized Gaussian smoothing over finite land pixels only."""
    radius = int(math.ceil(3.0 * sigma))
    x = np.arange(-radius, radius + 1, dtype=np.float64)
    k = np.exp(-0.5 * (x / sigma) ** 2)
    k /= k.sum()

    mask = np.isfinite(grid).astype(np.float64)
    vals = np.where(mask > 0.5, grid.astype(np.float64), 0.0)

    def _conv_sep(arr: np.ndarray) -> np.ndarray:
        tmp = np.zeros_like(arr)
        for idx, w in enumerate(k):
            shift = idx - radius
            if shift == 0:
                tmp += w * arr
            elif shift > 0:
                tmp[:, :-shift] += w * arr[:, shift:]
            else:
                tmp[:, -shift:] += w * arr[:, :shift]
        out = np.zeros_like(tmp)
        for idx, w in enumerate(k):
            shift = idx - radius
            if shift == 0:
                out += w * tmp
            elif shift > 0:
                out[:-shift, :] += w * tmp[shift:, :]
            else:
                out[-shift:, :] += w * tmp[:shift, :]
        return out

    s_val = _conv_sep(vals)
    s_msk = _conv_sep(mask)
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where((mask > 0.5) & (s_msk > 0.05), s_val / s_msk, np.nan)
    return out


# Marching Squares lookup table for edge indices (0:top, 1:right, 2:bottom, 3:left)
_MS_TABLE: dict[int, list[tuple[int, int]]] = {
    0: [],
    15: [],
    1: [(3, 2)],
    14: [(3, 2)],
    2: [(2, 1)],
    13: [(2, 1)],
    3: [(3, 1)],
    12: [(3, 1)],
    4: [(0, 1)],
    11: [(0, 1)],
    6: [(0, 2)],
    9: [(0, 2)],
    7: [(0, 3)],
    8: [(0, 3)],
}


def extract_marching_squares_isohyet(grid: np.ndarray, level: float = 400.0) -> list[list[tuple[float, float]]]:
    """Extract topologically stitched contour polylines at `level` in (row, col) pixel coords."""
    z = grid.astype(np.float64).copy()
    z = np.where(z == level, level + 1e-4, z)
    h, w = z.shape

    segments: list[tuple[tuple[str, int, int], tuple[str, int, int]]] = []
    node_pos: dict[tuple[str, int, int], tuple[float, float]] = {}

    def _edge_pt(r: int, c: int, e: int, v00: float, v10: float, v11: float, v01: float) -> tuple[tuple[str, int, int], tuple[float, float]]:
        if e == 0:
            key = ("h", r, c)
            if key not in node_pos:
                t = (level - v00) / (v10 - v00)
                node_pos[key] = (r + 0.0, c + max(0.0, min(1.0, t)))
            return key, node_pos[key]
        if e == 1:
            key = ("v", r, c + 1)
            if key not in node_pos:
                t = (level - v10) / (v11 - v10)
                node_pos[key] = (r + max(0.0, min(1.0, t)), c + 1.0)
            return key, node_pos[key]
        if e == 2:
            key = ("h", r + 1, c)
            if key not in node_pos:
                t = (level - v01) / (v11 - v01)
                node_pos[key] = (r + 1.0, c + max(0.0, min(1.0, t)))
            return key, node_pos[key]
        key = ("v", r, c)
        if key not in node_pos:
            t = (level - v00) / (v01 - v00)
            node_pos[key] = (r + max(0.0, min(1.0, t)), c + 0.0)
        return key, node_pos[key]

    for r in range(h - 1):
        for c in range(w - 1):
            v00 = z[r, c]
            v10 = z[r, c + 1]
            v11 = z[r + 1, c + 1]
            v01 = z[r + 1, c]
            if not (math.isfinite(v00) and math.isfinite(v10) and math.isfinite(v11) and math.isfinite(v01)):
                continue
            case = (8 if v00 > level else 0) | (4 if v10 > level else 0) | (2 if v11 > level else 0) | (1 if v01 > level else 0)
            if case == 0 or case == 15:
                continue
            if case == 5:
                vc = 0.25 * (v00 + v10 + v11 + v01)
                pairs = [(0, 3), (1, 2)] if vc > level else [(0, 1), (3, 2)]
            elif case == 10:
                vc = 0.25 * (v00 + v10 + v11 + v01)
                pairs = [(0, 1), (3, 2)] if vc > level else [(0, 3), (1, 2)]
            else:
                pairs = _MS_TABLE[case]
            for ea, eb in pairs:
                ka, _ = _edge_pt(r, c, ea, v00, v10, v11, v01)
                kb, _ = _edge_pt(r, c, eb, v00, v10, v11, v01)
                if ka != kb:
                    segments.append((ka, kb))

    adj: dict[tuple[str, int, int], list[int]] = {}
    for sidx, (ka, kb) in enumerate(segments):
        adj.setdefault(ka, []).append(sidx)
        adj.setdefault(kb, []).append(sidx)

    used = [False] * len(segments)
    polylines: list[list[tuple[float, float]]] = []

    def _walk(start_node: tuple[str, int, int], first_seg: int) -> list[tuple[str, int, int]]:
        chain = [start_node]
        cur_seg = first_seg
        cur_node = start_node
        while True:
            used[cur_seg] = True
            ka, kb = segments[cur_seg]
            nxt = kb if ka == cur_node else ka
            chain.append(nxt)
            cur_node = nxt
            cands = [si for si in adj.get(cur_node, ()) if not used[si]]
            if not cands:
                break
            cur_seg = cands[0]
        return chain

    # Walk open chains from degree-1 / odd-degree nodes first, then closed loops
    for node, sids in adj.items():
        if len(sids) != 2:
            for si in sids:
                if not used[si]:
                    chain = _walk(node, si)
                    polylines.append([node_pos[k] for k in chain])

    for si in range(len(segments)):
        if not used[si]:
            ka, _ = segments[si]
            chain = _walk(ka, si)
            polylines.append([node_pos[k] for k in chain])

    return polylines


def chaikin_smooth(pts: list[tuple[float, float]], passes: int = 1) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    cur = list(pts)
    for _ in range(passes):
        nxt = [cur[0]]
        for i in range(len(cur) - 1):
            x0, y0 = cur[i]
            x1, y1 = cur[i + 1]
            nxt.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            nxt.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        nxt.append(cur[-1])
        cur = nxt
    return cur


def _flatten_lines(geom: Any) -> list[LineString]:
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, LineString):
        return [geom] if len(geom.coords) >= 2 else []
    if isinstance(geom, (MultiLineString, GeometryCollection)):
        out: list[LineString] = []
        for g in geom.geoms:
            out.extend(_flatten_lines(g))
        return out
    return []


def build_china_clip_polygon(grid: dict[str, Any]):
    path = RAW_GEO_DIR / "datav_100000_full.json"
    gj = json.loads(path.read_text(encoding="utf-8"))
    polys = []
    for feat in gj.get("features", []):
        g = shape(feat["geometry"])
        g_aea = sh_transform(
            g,
            lambda coords: np.column_stack(
                aea_to_xy(
                    *_FWD_TRANSFORMER.transform(coords[:, 0], coords[:, 1]),
                    grid,
                )
            ),
        )
        if not g_aea.is_valid:
            g_aea = g_aea.buffer(0)
        polys.append(g_aea)
    merged = unary_union(polys).buffer(12.0)
    return merged


def _arc_point(pts: list[tuple[float, float]], frac: float) -> tuple[float, float]:
    segs = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1)]
    tot = sum(segs)
    if tot <= 0:
        return pts[0]
    target = tot * max(0.0, min(1.0, frac))
    acc = 0.0
    for i, sl in enumerate(segs):
        if acc + sl >= target and sl > 0:
            t = (target - acc) / sl
            return (
                pts[i][0] + t * (pts[i + 1][0] - pts[i][0]),
                pts[i][1] + t * (pts[i + 1][1] - pts[i][1]),
            )
        acc += sl
    return pts[-1]


def build_isohyet_400(
    annual: np.ndarray,
    lon0: float,
    lat0: float,
    dlon: float,
    dlat: float,
    grid: dict[str, Any],
    cities: list[dict[str, Any]],
) -> dict[str, Any]:
    smoothed = normalized_gaussian_smooth(annual, sigma=2.6)
    raw_lines = extract_marching_squares_isohyet(smoothed, level=400.0)
    print(f"[isohyet] Raw Marching Squares polylines: {len(raw_lines)}")

    china_poly = build_china_clip_polygon(grid)

    clipped: list[dict[str, Any]] = []
    for pl in raw_lines:
        if len(pl) < 3:
            continue
        rc = np.array(pl, dtype=np.float64)
        lons = lon0 + (rc[:, 1] + 0.5) * dlon
        lats = lat0 - (rc[:, 0] + 0.5) * dlat
        xs, ys = lonlat_to_xy(lons, lats, grid)
        ls = LineString(np.column_stack([xs, ys]))
        inter = ls.intersection(china_poly)
        for seg in _flatten_lines(inter):
            if seg.length < 100.0:
                continue
            coords = list(seg.coords)
            slons, slats = zip(*[_INV_TRANSFORMER.transform(x + grid["x_left"], grid["y_top"] - y) for x, y in coords])
            cx, cy = seg.centroid.x, seg.centroid.y
            clon, clat = _INV_TRANSFORMER.transform(cx + grid["x_left"], grid["y_top"] - cy)
            is_closed = math.hypot(coords[0][0] - coords[-1][0], coords[0][1] - coords[-1][1]) < 40.0
            clipped.append(
                {
                    "seg": seg,
                    "length": seg.length,
                    "min_lon": min(slons),
                    "max_lon": max(slons),
                    "min_lat": min(slats),
                    "max_lat": max(slats),
                    "centroid_lon": clon,
                    "centroid_lat": clat,
                    "closed": is_closed,
                }
            )

    clipped.sort(key=lambda d: -d["length"])
    print(f"[isohyet] Clipped inside China >= 100km ({len(clipped)} segments):")
    for idx, c in enumerate(clipped):
        print(
            f"  #{idx}: len={c['length']:.1f}km, lon=[{c['min_lon']:.1f},{c['max_lon']:.1f}], "
            f"lat=[{c['min_lat']:.1f},{c['max_lat']:.1f}], cent=({c['centroid_lon']:.1f},{c['centroid_lat']:.1f}), closed={c['closed']}"
        )

    # Select continental NE-SW monsoon divide segments (length >= 250 km, excluding Xinjiang-only western loops west of 85E)
    selected = [c for c in clipped if c["length"] >= 250.0 and c["max_lon"] >= 86.0 and not (c["closed"] and c["max_lon"] < 92.0)]
    if not selected:
        selected = clipped[:3]

    final_lines: list[list[list[float]]] = []
    line_records: list[tuple[float, list[tuple[float, float]]]] = []
    for c in selected:
        simp = c["seg"].simplify(3.5, preserve_topology=True)
        smooth_pts = chaikin_smooth(list(simp.coords), passes=1)
        rounded = [[round(x, 1), round(y, 1)] for x, y in smooth_pts]
        final_lines.append(rounded)
        line_records.append((c["length"], smooth_pts))

    # Build 3 well-spaced labels along the main line (or across top lines if split)
    city_xy = [(float(ct["x"]), float(ct["y"])) for ct in cities if ct.get("x") is not None and ct.get("y") is not None]

    def _nudge_from_cities(px: float, py: float) -> tuple[float, float]:
        best_x, best_y = px, py
        best_d2 = 0.0
        for dx, dy in [(0, 0), (-36, -24), (36, -24), (-36, 24), (36, 24), (0, -38), (0, 38)]:
            tx, ty = px + dx, py + dy
            min_c_d2 = min(((tx - cx) ** 2 + (ty - cy) ** 2 for cx, cy in city_xy), default=1e9)
            if min_c_d2 > 65.0 ** 2:
                return tx, ty
            if min_c_d2 > best_d2:
                best_d2 = min_c_d2
                best_x, best_y = tx, ty
        return best_x, best_y

    main_len, main_pts = max(line_records, key=lambda t: t[0])
    # Orient NE->SW or N->S consistently for predictable label ordering
    if main_pts[0][1] > main_pts[-1][1]:
        main_pts = list(reversed(main_pts))

    labels_out: list[dict[str, Any]] = []
    if main_len >= 1800.0 or len(line_records) == 1:
        specs = [
            (0.03, "400mm 线", False),
            (0.55, "400mm 等降水量线", True),
            (0.82, "400mm 线", False),
        ]
        for frac, txt, primary in specs:
            px, py = _arc_point(main_pts, frac)
            nx, ny = _nudge_from_cities(px, py)
            labels_out.append({"x": round(nx, 1), "y": round(ny, 1), "text": txt, "primary": primary})
    else:
        sorted_recs = sorted(line_records, key=lambda t: sum(p[1] for p in t[1]) / len(t[1]))
        for idx, (ln, pts) in enumerate(sorted_recs[:3]):
            px, py = _arc_point(pts, 0.5)
            nx, ny = _nudge_from_cities(px, py)
            is_primary = ln == main_len
            labels_out.append(
                {
                    "x": round(nx, 1),
                    "y": round(ny, 1),
                    "text": "400mm 等降水量线" if is_primary else "400mm 线",
                    "primary": is_primary,
                }
            )

    anchors_meta = [
        ("大兴安岭", 121.6, 49.0),
        ("张家口", 114.88, 40.82),
        ("兰州", 103.83, 36.06),
        ("拉萨", 91.11, 29.65),
    ]
    anchors_out = []
    for name, lon, lat in anchors_meta:
        ax, ay = lonlat_to_xy(lon, lat, grid)
        anchors_out.append({"name": name, "x": round(float(ax), 1), "y": round(float(ay), 1)})

    return {
        "level_mm": 400,
        "source": "WorldClim v2.1 (1970–2000)",
        "total_length_km": round(sum(ln for ln, _ in line_records), 1),
        "lines": final_lines,
        "labels": labels_out,
        "anchors": anchors_out,
    }


def upsert_field(fields: list[dict[str, Any]], spec: dict[str, Any]) -> None:
    for i, f in enumerate(fields):
        if isinstance(f, dict) and f.get("key") == spec["key"]:
            fields[i] = spec
            return
    fields.append(spec)


def main() -> None:
    download_worldclim(WORLDCLIM_ZIP)
    annual, lon0, lat0, dlon, dlat = load_annual_precip_crop(WORLDCLIM_ZIP)
    spot_check_raster(annual, lon0, lat0, dlon, dlat)

    print("[world] Loading world.json & geo_lookup.json...")
    world = json.loads(WORLD_JSON_PATH.read_text(encoding="utf-8"))
    geo_lookup = json.loads(GEO_LOOKUP_PATH.read_text(encoding="utf-8"))
    cities = json.loads(CITIES_PATH.read_text(encoding="utf-8"))

    grid = world["grid"]
    cols, rows = grid["cols"], grid["rows"]
    total = cols * rows
    owner = world["owner"]
    elev = world["elev"]
    r_km = grid.get("R", R_KM)
    corners = hex_corners(0.0, 0.0, r_km)

    china_indices = [i for i in range(total) if owner[i] >= 0]
    print(f"[sample] Sampling 7 points for {len(china_indices)} China land hexes...")

    pts_x = np.empty((len(china_indices), 7), dtype=np.float64)
    pts_y = np.empty((len(china_indices), 7), dtype=np.float64)
    for k, ci in enumerate(china_indices):
        cx, cy = cell_center(ci, grid)
        pts_x[k, 0] = cx
        pts_y[k, 0] = cy
        for m, (vx, vy) in enumerate(corners):
            pts_x[k, m + 1] = cx + 0.55 * vx
            pts_y[k, m + 1] = cy + 0.55 * vy

    flat_x_aea = pts_x.ravel() + grid["x_left"]
    flat_y_aea = grid["y_top"] - pts_y.ravel()
    flat_lons, flat_lats = _INV_TRANSFORMER.transform(flat_x_aea, flat_y_aea)
    flat_vals = bilinear_sample(annual, flat_lons, flat_lats, lon0, lat0, dlon, dlat, max_search=80)
    vals_2d = flat_vals.reshape(len(china_indices), 7)

    precip_arr = [0] * total
    missing_hexes = 0
    for k, ci in enumerate(china_indices):
        row_v = vals_2d[k]
        fin_v = row_v[np.isfinite(row_v)]
        if fin_v.size == 0:
            missing_hexes += 1
            precip_arr[ci] = 100
        else:
            precip_arr[ci] = max(1, int(round(float(fin_v.mean()))))

    assert missing_hexes == 0, f"{missing_hexes} China hexes had missing precipitation!"
    china_p = [precip_arr[i] for i in china_indices]
    print(
        f"[sample] China hex precipitation stats: min={min(china_p)}mm, "
        f"median={float(np.median(china_p)):.1f}mm, mean={float(np.mean(china_p)):.1f}mm, max={max(china_p)}mm"
    )

    isohyet_400 = build_isohyet_400(annual, lon0, lat0, dlon, dlat, grid, cities)
    world["precip"] = precip_arr
    world["isohyet_400"] = isohyet_400
    WORLD_JSON_PATH.write_text(json.dumps(world, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[write] Updated {WORLD_JSON_PATH} ({WORLD_JSON_PATH.stat().st_size / (1024 * 1024):.2f} MB)")

    # Update counties.json with precip_mm and elevation_m
    counties_obj = json.loads(COUNTIES_PATH.read_text(encoding="utf-8"))
    g_counties = geo_lookup.get("counties", [])
    cols_list = counties_obj.get("columns", [])
    for col in ("precip_mm", "elevation_m"):
        if col not in cols_list:
            cols_list.append(col)
    counties_obj["columns"] = cols_list

    fields_list = counties_obj.get("fields", [])
    upsert_field(
        fields_list,
        {
            "key": "precip_mm",
            "label": "年均降水量",
            "short": "年降水量",
            "format": "int",
            "unit": "mm",
            "type": "number",
            "higher_is": "neutral",
            "source": "WorldClim v2.1 5m (1970–2000)",
            "description": "各县域25km网格平均年降水量(mm/年)，反映400mm半湿润/半干旱分界及800mm秦岭—淮河线南北水热差异",
            "lens": "precip",
            "group": "land",
        },
    )
    upsert_field(
        fields_list,
        {
            "key": "elevation_m",
            "label": "平均海拔高度",
            "short": "海拔高度",
            "format": "int",
            "unit": "m",
            "type": "number",
            "higher_is": "neutral",
            "source": "AWS Terrarium DEM (SRTM / ASTER)",
            "description": "各县域25km六边形网格实测平均海拔高度(米)，勾勒中国地势三大阶梯格局",
            "lens": "elevation",
            "group": "land",
        },
    )
    counties_obj["fields"] = fields_list

    county_cells_map: dict[int, list[int]] = {i: [] for i in range(len(counties_obj["rows"]))}
    w_county = world["county"]
    for i in china_indices:
        ct = w_county[i]
        if 0 <= ct < len(counties_obj["rows"]):
            county_cells_map[ct].append(i)
    for k, gc in enumerate(g_counties):
        if k < len(counties_obj["rows"]) and not county_cells_map[k]:
            county_cells_map[k] = [c for c in gc.get("cells", []) if 0 <= c < total and owner[c] >= 0]

    for idx, row in enumerate(counties_obj["rows"]):
        cells = county_cells_map.get(idx, [])
        if not cells and isinstance(row.get("cell"), int) and 0 <= row["cell"] < total:
            cells = [row["cell"]]
        if cells:
            p_mean = sum(precip_arr[c] for c in cells) / len(cells)
            e_mean = sum(elev[c] for c in cells) / len(cells)
            row["precip_mm"] = int(round(p_mean))
            row["elevation_m"] = int(round(e_mean))
        else:
            row["precip_mm"] = 0
            row["elevation_m"] = 0

    COUNTIES_PATH.write_text(json.dumps(counties_obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[write] Updated {COUNTIES_PATH} (1,302 counties + precip_mm/elevation_m)")

    # Update lenses.json
    lenses_obj = json.loads(LENSES_PATH.read_text(encoding="utf-8"))
    new_lenses = {
        "precip": {
            "id": "precip",
            "group": "land",
            "label": "年降水量（含400mm线）",
            "short": "降水量",
            "cellField": "precip",
            "countyField": "precip_mm",
            "unit": "mm/年",
            "scale": "breaks",
            "ramp": "precip",
            "description": "基于 WorldClim v2.1 实测气候网格映射至25km六边形的年均降水量，醒目标注贯穿大兴安岭—张家口—兰州—拉萨的400毫米等降水量线（半湿润与半干旱农牧分界线）。",
            "source": "WorldClim v2.1 5角分全球降水网格 (1970–2000)",
            "breaks": [0, 200, 400, 800, 1200, 1600, 2200],
            "bandLabels": ["<200", "200–400", "400–800", "800–1200", "1200–1600", ">1600"],
        },
        "elevation": {
            "id": "elevation",
            "group": "land",
            "label": "海拔高度（三级阶梯）",
            "short": "海拔高度",
            "cellField": "elev",
            "countyField": "elevation_m",
            "unit": "m",
            "scale": "breaks",
            "ramp": "elevation",
            "description": "基于 AWS Terrarium DEM 提取的25km网格实测平均海拔，采用经典地势分层设色呈现青藏高原（第一级阶梯 >4000m）、三大盆地高原（第二级阶梯 1000–2000m）与东部平原丘陵（第三级阶梯 <500m）。",
            "source": "AWS Terrarium DEM (SRTM / ASTER)",
            "breaks": [0, 100, 500, 1000, 2000, 3500, 4500, 6000],
            "bandLabels": ["<100m", "100–500", "500–1千", "1–2千", "2–3.5千", "3.5–4.5千", ">4500m"],
        },
    }
    lenses_list = lenses_obj.get("lenses", [])
    existing_map = {l["id"]: i for i, l in enumerate(lenses_list) if isinstance(l, dict) and "id" in l}
    for lid, ldef in new_lenses.items():
        if lid in existing_map:
            lenses_list[existing_map[lid]] = ldef
        else:
            lenses_list.append(ldef)
    lenses_obj["lenses"] = lenses_list
    LENSES_PATH.write_text(json.dumps(lenses_obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[write] Updated {LENSES_PATH} (total {len(lenses_list)} lenses)")

    # Update sources.json idempotently
    sources_obj = json.loads(SOURCES_PATH.read_text(encoding="utf-8"))
    src_list = sources_obj.get("sources", [])
    wc_src = {
        "id": "worldclim_v21",
        "name": "WorldClim v2.1 全球高分辨率气候数据 (5角分年均降水量)",
        "org": "UC Davis / Fick & Hijmans",
        "vintage": "1970–2000",
        "url": "https://www.worldclim.org/data/worldclim21.html",
        "category": "气候气象",
        "description": "约9km分辨率12个月多年平均降水栅格，汇总映射至25km六边形并提取中国400mm等降水量线与农牧分界带。",
    }
    src_idx = next((i for i, s in enumerate(src_list) if isinstance(s, dict) and s.get("id") == "worldclim_v21"), -1)
    if src_idx >= 0:
        src_list[src_idx] = wc_src
    else:
        src_list.append(wc_src)
    sources_obj["sources"] = src_list
    SOURCES_PATH.write_text(json.dumps(sources_obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"[write] Updated {SOURCES_PATH} (total {len(src_list)} sources)")


if __name__ == "__main__":
    main()
