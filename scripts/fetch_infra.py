#!/usr/bin/env python3
"""Download real open infrastructure, energy, airport, port, and transport datasets into raw_data/infra/."""

import csv
import json
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw_data" / "infra"
RAW_DIR.mkdir(parents=True, exist_ok=True)

CHINA_BBOX = (70.0, 14.0, 138.0, 56.0)  # min_lon, min_lat, max_lon, max_lat

SOURCES = {
    "global_power_plant_database.csv": "https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv",
    "airports.csv": "https://davidmegginson.github.io/ourairports-data/airports.csv",
    "ne_10m_roads.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_roads.geojson",
    "ne_10m_railroads.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_railroads.geojson",
    "ne_10m_ports.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_ports.geojson",
}


def download_file(url: str, dest: Path, force: bool = False) -> Path:
    if dest.exists() and dest.stat().st_size > 1000 and not force:
        print(f"[cached] {dest.name} ({dest.stat().st_size:,} bytes)")
        return dest
    print(f"[downloading] {url} -> {dest}")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 128):
                if chunk:
                    f.write(chunk)
        tmp.replace(dest)
    print(f"[done] {dest.name} ({dest.stat().st_size:,} bytes)")
    return dest


def filter_power_plants(src: Path, dest: Path) -> None:
    kept = []
    fieldnames = None
    with open(src, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row.get("country") in ("CHN", "TWN"):
                kept.append(row)
    with open(dest, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)
    print(f"[filtered] {dest.name}: {len(kept)} plants in CHN/TWN")


def filter_airports(src: Path, dest: Path) -> None:
    kept = []
    fieldnames = None
    with open(src, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            if row.get("iso_country") in ("CN", "HK", "MO", "TW"):
                kept.append(row)
    with open(dest, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)
    print(f"[filtered] {dest.name}: {len(kept)} airports in CN/HK/MO/TW")


def _coords_intersect_bbox(geom: dict, bbox: tuple[float, float, float, float]) -> bool:
    minx, miny, maxx, maxy = bbox
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Point":
        x, y = coords[:2]
        return minx <= x <= maxx and miny <= y <= maxy
    elif gtype == "LineString":
        return any(minx <= pt[0] <= maxx and miny <= pt[1] <= maxy for pt in coords)
    elif gtype == "MultiLineString":
        return any(
            minx <= pt[0] <= maxx and miny <= pt[1] <= maxy
            for line in coords
            for pt in line
        )
    return False


def filter_geojson(src: Path, dest: Path, bbox: tuple[float, float, float, float]) -> None:
    with open(src, "r", encoding="utf-8") as f:
        gj = json.load(f)
    features = gj.get("features", [])
    kept = [feat for feat in features if feat.get("geometry") and _coords_intersect_bbox(feat["geometry"], bbox)]
    out = {"type": "FeatureCollection", "features": kept}
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"[filtered] {dest.name}: {len(kept)} / {len(features)} features inside China bbox")


def main() -> None:
    for fname, url in SOURCES.items():
        try:
            download_file(url, RAW_DIR / fname)
        except Exception as e:
            print(f"[warn] failed to download {fname}: {e}")

    pp_src = RAW_DIR / "global_power_plant_database.csv"
    if pp_src.exists():
        filter_power_plants(pp_src, RAW_DIR / "wri_power_plants_chn_twn.csv")

    ap_src = RAW_DIR / "airports.csv"
    if ap_src.exists():
        filter_airports(ap_src, RAW_DIR / "ourairports_cn_hk_mo_tw.csv")

    roads_src = RAW_DIR / "ne_10m_roads.geojson"
    if roads_src.exists():
        filter_geojson(roads_src, RAW_DIR / "ne_10m_roads_china.geojson", CHINA_BBOX)

    rail_src = RAW_DIR / "ne_10m_railroads.geojson"
    if rail_src.exists():
        filter_geojson(rail_src, RAW_DIR / "ne_10m_railroads_china.geojson", CHINA_BBOX)

    ports_src = RAW_DIR / "ne_10m_ports.geojson"
    if ports_src.exists():
        filter_geojson(ports_src, RAW_DIR / "ne_10m_ports_china.geojson", CHINA_BBOX)


if __name__ == "__main__":
    main()
