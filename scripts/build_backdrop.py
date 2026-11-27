"""Build Eurasia-Pacific 25km hexagonal backdrop (web/data/world_backdrop.json) seamlessly extending world.json."""

from __future__ import annotations

import json
import math
from pathlib import Path
import time
from typing import Any

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely import points as sh_points
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Polygon, box, shape
from shapely.ops import transform as sh_transform
from shapely.strtree import STRtree

from geo_common import (
    EVEN_NEIGHBORS,
    ODD_NEIGHBORS,
    RAW_GEO_DIR,
    WORLD_JSON_PATH,
)

BACKDROP_JSON_PATH = WORLD_JSON_PATH.parent / "world_backdrop.json"

# Extended hex window centered generously around China (211x275 -> 576x446)
# Covers super-ultrawide aspect ratios + generous pan bounds in both 2D and 2.5D modes
C0 = -180
R0 = -80
B_COLS = 576  # c in [-180 .. 395]
B_ROWS = 446  # r in [-80  .. 365]


def run_length_encode(arr: np.ndarray) -> list[int]:
    """Run-length encode a 1D uint8 array into [val, count, ...]."""
    flat = np.asarray(arr, dtype=np.uint8).ravel()
    if len(flat) == 0:
        return []
    changes = np.nonzero(flat[1:] != flat[:-1])[0] + 1
    starts = np.concatenate(([0], changes))
    ends = np.concatenate((changes, [len(flat)]))
    counts = ends - starts
    vals = flat[starts]
    out: list[int] = []
    for v, cnt in zip(vals.tolist(), counts.tolist()):
        out.append(v)
        out.append(cnt)
    return out


def compute_exterior_rivers_and_lakes(
    g: dict[str, Any],
    ext_clip_km: tuple[float, float, float, float],
) -> tuple[list[list[list[float]]], list[list[list[float]]]]:
    """Extract Natural Earth 10m rivers & lakes outside world.json interior bounds (with thin 15km seam overlap)."""
    tf_fwd = Transformer.from_crs("EPSG:4326", g["proj"], always_xy=True)
    x_left = g["x_left"]
    y_top = g["y_top"]
    w_km = g["width_km"]
    h_km = g["height_km"]

    ext_box = box(*ext_clip_km)
    # Subtract core world.json interior except tiny 15km border collar for seamless river join
    inner_box = box(15.0, 15.0, w_km - 15.0, h_km - 15.0)
    mask_poly = ext_box.difference(inner_box)

    def proj_coords_safe(coords: list[tuple[float, float]]) -> list[list[tuple[float, float]]]:
        """Project lon/lat sequence to flipped grid km, splitting across antimeridian or cone-edge jumps."""
        if not coords:
            return []
        xs_raw = [c[0] for c in coords]
        ys_raw = [c[1] for c in coords]
        xa, ya = tf_fwd.transform(xs_raw, ys_raw)
        chunks: list[list[tuple[float, float]]] = []
        cur: list[tuple[float, float]] = []
        prev: tuple[float, float] | None = None
        for lon, lat, x_a, y_a in zip(xs_raw, ys_raw, xa, ya):
            if not (math.isfinite(x_a) and math.isfinite(y_a)) or abs(lat) > 85.0:
                if len(cur) >= 2:
                    chunks.append(cur)
                cur = []
                prev = None
                continue
            gx = x_a - x_left
            gy = y_top - y_a
            pt = (gx, gy)
            if prev is not None and math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 500.0:
                if len(cur) >= 2:
                    chunks.append(cur)
                cur = [pt]
            else:
                cur.append(pt)
            prev = pt
        if len(cur) >= 2:
            chunks.append(cur)
        return chunks

    def round_pts(coords_seq: Any) -> list[list[float]]:
        return [[round(float(x), 1), round(float(y), 1)] for x, y in coords_seq]

    rivers_out: list[list[list[float]]] = []
    rivers_raw = json.loads((RAW_GEO_DIR / "ne_10m_rivers_lake_centerlines.geojson").read_text("utf-8"))
    for feat in rivers_raw.get("features", []):
        props = feat.get("properties") or {}
        sr = props.get("scalerank")
        if isinstance(sr, (int, float)) and sr > 8:
            continue
        geom_json = feat.get("geometry")
        if not geom_json:
            continue
        gtype = geom_json.get("type")
        lines = []
        if gtype == "LineString":
            lines = [geom_json.get("coordinates", [])]
        elif gtype == "MultiLineString":
            lines = geom_json.get("coordinates", [])
        for seq in lines:
            for chunk in proj_coords_safe(seq):
                clipped = LineString(chunk).intersection(mask_poly)
                if clipped.is_empty:
                    continue
                parts = clipped.geoms if hasattr(clipped, "geoms") else [clipped]
                for part in parts:
                    if part.geom_type != "LineString" or part.length < 28.0:
                        continue
                    simp = part.simplify(7.5, preserve_topology=False)
                    pts = round_pts(simp.coords)
                    if len(pts) >= 2:
                        rivers_out.append(pts)

    lakes_out: list[list[list[float]]] = []
    lakes_raw = json.loads((RAW_GEO_DIR / "ne_10m_lakes.geojson").read_text("utf-8"))
    for feat in lakes_raw.get("features", []):
        props = feat.get("properties") or {}
        sr = props.get("scalerank")
        if isinstance(sr, (int, float)) and sr > 7:
            continue
        geom_json = feat.get("geometry")
        if not geom_json:
            continue
        gtype = geom_json.get("type")
        polys_coords = []
        if gtype == "Polygon":
            polys_coords = [geom_json.get("coordinates", [])]
        elif gtype == "MultiPolygon":
            polys_coords = geom_json.get("coordinates", [])
        for rings in polys_coords:
            if not rings:
                continue
            outer = rings[0]
            if len(outer) < 4:
                continue
            lons = [p[0] for p in outer]
            lats = [p[1] for p in outer]
            if max(lons) - min(lons) > 120.0 or max(abs(l) for l in lats) > 84.0:
                continue
            xa, ya = tf_fwd.transform(lons, lats)
            pts_xy = [(x_a - x_left, y_top - y_a) for x_a, y_a in zip(xa, ya) if math.isfinite(x_a) and math.isfinite(y_a)]
            if len(pts_xy) < 4:
                continue
            poly = Polygon(pts_xy)
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty:
                continue
            clipped = poly.intersection(mask_poly)
            if clipped.is_empty:
                continue
            parts = clipped.geoms if hasattr(clipped, "geoms") else [clipped]
            for part in parts:
                if part.geom_type != "Polygon" or part.area < 180.0:
                    continue
                simp = part.simplify(6.0, preserve_topology=True)
                ext = round_pts(simp.exterior.coords)
                if len(ext) >= 4:
                    lakes_out.append(ext)

    return rivers_out, lakes_out


def main() -> None:
    t0 = time.time()
    world = json.loads(WORLD_JSON_PATH.read_text("utf-8"))
    g = world["grid"]
    w_cols = int(g["cols"])
    w_rows = int(g["rows"])
    w_km = float(g["W"])
    h_step = float(g["H_step"])
    x_left = float(g["x_left"])
    y_top = float(g["y_top"])
    proj = g["proj"]

    w_owner = np.asarray(world["owner"], dtype=np.int16).reshape((w_rows, w_cols))
    w_land = w_owner != -1

    print(f"1/5 Building {B_COLS}x{B_ROWS} = {B_COLS * B_ROWS:,} extended backdrop hexes...")
    r_vals = np.arange(R0, R0 + B_ROWS, dtype=np.int32)
    c_vals = np.arange(C0, C0 + B_COLS, dtype=np.int32)
    rr, cc = np.meshgrid(r_vals, c_vals, indexing="ij")

    cx = (cc + (rr & 1) * 0.5) * w_km
    cy = rr * h_step

    inside_world = (cc >= 0) & (cc < w_cols) & (rr >= 0) & (rr < w_rows)

    tf_inv = Transformer.from_crs(proj, "EPSG:4326", always_xy=True)
    tf_fwd = Transformer.from_crs("EPSG:4326", proj, always_xy=True)

    xa = cx.ravel() + x_left
    ya = y_top - cy.ravel()
    lons, lats = tf_inv.transform(xa, ya)

    # Check exact projection round-trip to exclude conic foldback past Antarctica/poles
    xa_rt, ya_rt = tf_fwd.transform(lons, lats)
    rt_err = np.hypot(xa_rt - xa, ya_rt - ya)
    valid = (
        np.isfinite(lons)
        & np.isfinite(lats)
        & (lats >= -82.0)
        & (lats <= 85.0)
        & (lons >= -180.0)
        & (lons <= 180.0)
        & (rt_err < 1.5)
    ).reshape((B_ROWS, B_COLS))

    print("2/5 Rasterizing global Natural Earth 50m land polygons (antimeridian-safe)...")
    countries_raw = json.loads((RAW_GEO_DIR / "ne_50m_admin_0_countries.geojson").read_text("utf-8"))
    land_geoms = []
    for feat in countries_raw.get("features", []):
        geom_json = feat.get("geometry")
        if geom_json:
            geom = shape(geom_json)
            if not geom.is_valid:
                geom = geom.buffer(0)
            if not geom.is_empty:
                land_geoms.append(geom)
    land_tree = STRtree(land_geoms)

    ext_mask = (~inside_world) & valid
    ext_idx = np.nonzero(ext_mask.ravel())[0]
    ext_pts = sh_points(lons[ext_idx], lats[ext_idx])
    hit_pairs = land_tree.query(ext_pts, predicate="intersects")
    land_flat = np.zeros(B_ROWS * B_COLS, dtype=bool)
    land_flat[ext_idx[np.unique(hit_pairs[0])]] = True
    land_mask = land_flat.reshape((B_ROWS, B_COLS))

    # Sync interior region strictly from frozen world.json so borders match seamlessly
    ir0 = 0 - R0
    ic0 = 0 - C0
    land_mask[ir0 : ir0 + w_rows, ic0 : ic0 + w_cols] = w_land

    print("3/5 Sampling Terrarium DEM elevation shades & 6-neighbor coastal shelves...")
    dem_dir = RAW_GEO_DIR / "terrarium_z5"
    tiles: dict[tuple[int, int], np.ndarray] = {}
    for p in dem_dir.glob("5_*.png"):
        _, tx_s, ty_s = p.stem.split("_")
        arr = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
        elev = (arr[:, :, 0] * 256.0 + arr[:, :, 1] + arr[:, :, 2] / 256.0) - 32768.0
        tiles[(int(tx_s), int(ty_s))] = elev

    elev_bucket = np.zeros((B_ROWS, B_COLS), dtype=np.uint8)
    ext_land_mask = (~inside_world) & land_mask
    el_rows, el_cols = np.nonzero(ext_land_mask)
    if len(el_rows) > 0:
        el_flat = el_rows * B_COLS + el_cols
        el_lons = np.clip(lons[el_flat], -179.99, 179.99)
        el_lats = np.clip(lats[el_flat], -85.0, 85.0)
        n = 32.0
        xt = (el_lons + 180.0) / 360.0 * n
        yt = (1.0 - np.arcsinh(np.tan(np.radians(el_lats))) / math.pi) / 2.0 * n
        txs = np.clip(xt.astype(np.int32), 0, 31)
        tys = np.clip(yt.astype(np.int32), 0, 31)
        pxs = np.clip(((xt - txs) * 256.0).astype(np.int32), 0, 255)
        pys = np.clip(((yt - tys) * 256.0).astype(np.int32), 0, 255)

        tx_set = {tx for tx, _ in tiles.keys()}
        ty_set = {ty for _, ty in tiles.keys()}
        tx_min, tx_max = min(tx_set), max(tx_set)
        ty_min, ty_max = min(ty_set), max(ty_set)

        buckets = np.zeros(len(el_rows), dtype=np.uint8)
        for idx, (r_val, c_val, xt_f, yt_f, tx, ty, px, py) in enumerate(
            zip(el_rows.tolist(), el_cols.tolist(), xt.tolist(), yt.tolist(), txs.tolist(), tys.tolist(), pxs.tolist(), pys.tolist())
        ):
            tile = tiles.get((tx, ty))
            if tile is not None:
                e = float(tile[py, px])
                # Softly taper DEM elevation near outer Terrarium tile-pack boundary so Deccan/Siberia never shows straight tile seams
                edge_dist = min(xt_f - tx_min, (tx_max + 1.0) - xt_f, yt_f - ty_min, (ty_max + 1.0) - yt_f)
                taper = max(0.0, min(1.0, edge_dist / 1.6))
                # Deterministic micro-dither breaks iso-elevation bands organically
                h = (((r_val * 73856093) ^ (c_val * 19349663)) & 255) / 255.0 - 0.5
                e = e * taper + h * 140.0
                buckets[idx] = 0 if e < 300 else (1 if e < 1200 else (2 if e < 2600 else 3))
            else:
                buckets[idx] = 0
        elev_bucket[el_rows, el_cols] = buckets

    # Compute 6-neighbor coastal shelf mask across unified 576x446 grid
    coast_mask = np.zeros((B_ROWS, B_COLS), dtype=bool)
    ocean = ~land_mask
    even_rows = (r_vals & 1) == 0
    odd_rows = ~even_rows

    for dr_idx, parity_mask, nbrs in (
        (0, even_rows, EVEN_NEIGHBORS),
        (1, odd_rows, ODD_NEIGHBORS),
    ):
        row_ids = np.nonzero(parity_mask)[0]
        for dc, dr in nbrs:
            sr = row_ids + dr
            ok_r = (sr >= 0) & (sr < B_ROWS)
            dst_r = row_ids[ok_r]
            src_r = sr[ok_r]
            c0_src = max(0, -dc)
            c1_src = min(B_COLS, B_COLS - dc)
            c0_dst = c0_src + dc
            c1_dst = c1_src + dc
            sub_land = land_mask[src_r, c0_src:c1_src]
            coast_mask[dst_r[:, None], np.arange(c0_dst, c1_dst)[None, :]] |= sub_land

    coast_mask &= ocean

    # Identify seam cells inside world.json perimeter (c=0, c=cols-1, r=0, r=rows-1) that touch exterior land
    w_interior_coast = np.zeros((w_rows, w_cols), dtype=bool)
    w_even = (np.arange(w_rows) & 1) == 0
    w_odd = ~w_even
    for parity_mask, nbrs in ((w_even, EVEN_NEIGHBORS), (w_odd, ODD_NEIGHBORS)):
        row_ids = np.nonzero(parity_mask)[0]
        for dc, dr in nbrs:
            sr = row_ids + dr
            ok_r = (sr >= 0) & (sr < w_rows)
            dst_r = row_ids[ok_r]
            src_r = sr[ok_r]
            c0_src = max(0, -dc)
            c1_src = min(w_cols, w_cols - dc)
            c0_dst = c0_src + dc
            c1_dst = c1_src + dc
            w_interior_coast[dst_r[:, None], np.arange(c0_dst, c1_dst)[None, :]] |= w_land[src_r, c0_src:c1_src]
    w_interior_coast &= ~w_land

    w_unified_coast = coast_mask[ir0 : ir0 + w_rows, ic0 : ic0 + w_cols]
    seam_new_coast = w_unified_coast & (~w_interior_coast)
    edge_coast_cells = [int(r * w_cols + c) for r, c in zip(*np.nonzero(seam_new_coast))]

    # Assemble cell value grid for backdrop (inside world.json slots stored as 0; exterior: 0=deep, 1=coast, 2..5=land)
    cells = np.zeros((B_ROWS, B_COLS), dtype=np.uint8)
    ext_coast = (~inside_world) & coast_mask & valid
    cells[ext_coast] = 1
    cells[ext_land_mask] = 2 + elev_bucket[ext_land_mask]

    cell_rle = run_length_encode(cells)

    print("4/5 Extracting Natural Earth 10m exterior rivers & lakes...")
    x_min_km = float(np.min(cx))
    y_min_km = float(np.min(cy))
    x_max_km = float(np.max(cx))
    y_max_km = float(np.max(cy))
    rivers, lakes = compute_exterior_rivers_and_lakes(g, (x_min_km, y_min_km, x_max_km, y_max_km))

    payload = {
        "version": 1,
        "c0": C0,
        "r0": R0,
        "cols": B_COLS,
        "rows": B_ROWS,
        "bounds_km": [
            round(x_min_km + g["R"], 1),
            round(y_min_km + g["R"], 1),
            round(x_max_km - g["R"], 1),
            round(y_max_km - g["R"], 1),
        ],
        "edge_coast_cells": edge_coast_cells,
        "cell_rle": cell_rle,
        "rivers": rivers,
        "lakes": lakes,
    }

    BACKDROP_JSON_PATH.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    size_kb = BACKDROP_JSON_PATH.stat().st_size / 1024.0
    print(
        f"5/5 Wrote {BACKDROP_JSON_PATH} ({size_kb:.1f} KB): "
        f"{len(cell_rle)//2:,} RLE runs, {int(np.sum(ext_land_mask)):,} ext land hexes, "
        f"{int(np.sum(ext_coast)):,} ext coast hexes, {len(edge_coast_cells)} seam coast patches, "
        f"{len(rivers)} rivers, {len(lakes)} lakes in {time.time() - t0:.2f}s"
    )


if __name__ == "__main__":
    main()
