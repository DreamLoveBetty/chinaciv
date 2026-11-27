"""Download real GIS datasets for ChinaCiv into raw_data/geo/."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import io
import json
import math
from pathlib import Path
import time
from typing import Any
import zipfile

from PIL import Image
import requests

from geo_common import RAW_GEO_DIR

STATIC_SOURCES = {
    "datav_100000_full.json": "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json",
    "gadm41_CHN_3.json.zip": "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_3.json.zip",
    "gadm41_CHN_2.json.zip": "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_CHN_2.json.zip",
    "gadm41_TWN_1.json.zip": "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_TWN_1.json.zip",
    "gadm41_TWN_2.json.zip": "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_TWN_2.json.zip",
    "ne_50m_admin_0_countries.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
    "ne_10m_rivers_lake_centerlines.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson",
    "ne_10m_lakes.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson",
    "ne_10m_urban_areas.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_urban_areas.geojson",
    "ne_10m_glaciated_areas.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_glaciated_areas.geojson",
    "ne_10m_geography_regions_polys.geojson": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson",
}

DATAV_URL_TMPL = "https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json"
DATAV_SINGLE_TMPL = "https://geo.datav.aliyun.com/areas_v3/bound/{adcode}.json"
TERRARIUM_URL_TMPL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/{tx}/{ty}.png"


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "ChinaCiv-GeoFetcher/1.0"})
    return s


def download_file(url: str, dest: Path, force: bool = False, retries: int = 3) -> bool:
    if dest.exists() and dest.stat().st_size > 0 and not force:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=60, headers={"User-Agent": "ChinaCiv-GeoFetcher/1.0"})
            r.raise_for_status()
            dest.write_bytes(r.content)
            return True
        except Exception as exc:
            last_err = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"Failed downloading {url}: {last_err}")


def fetch_datav_json(adcode: str, cache_dir: Path, force: bool = False) -> dict[str, Any] | None:
    cache_path = cache_dir / f"{adcode}_full.json"
    if cache_path.exists() and cache_path.stat().st_size > 0 and not force:
        return json.loads(cache_path.read_text(encoding="utf-8"))

    for tmpl in (DATAV_URL_TMPL, DATAV_SINGLE_TMPL):
        url = tmpl.format(adcode=adcode)
        for attempt in range(3):
            try:
                r = requests.get(url, timeout=25, headers={"User-Agent": "ChinaCiv-GeoFetcher/1.0"})
                if r.status_code == 404:
                    break
                r.raise_for_status()
                data = r.json()
                cache_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                return data
            except Exception:
                time.sleep(0.5 * (attempt + 1))
    return None


def latlon_to_tile(lon: float, lat: float, z: int = 5) -> tuple[int, int]:
    lat_rad = math.radians(max(-85.0, min(85.0, lat)))
    n = 1 << z
    tx = int((lon + 180.0) / 360.0 * n)
    ty = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, tx)), max(0, min(n - 1, ty))


def fetch_terrarium_tiles(dem_dir: Path, force: bool = False) -> int:
    dem_dir.mkdir(parents=True, exist_ok=True)
    tx0, ty0 = latlon_to_tile(68.0, 56.5, 5)
    tx1, ty1 = latlon_to_tile(140.0, 1.5, 5)
    tasks = [(tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1)]
    downloaded = 0

    def _grab(tx_ty: tuple[int, int]) -> bool:
        tx, ty = tx_ty
        out = dem_dir / f"5_{tx}_{ty}.png"
        if out.exists() and out.stat().st_size > 0 and not force:
            return False
        url = TERRARIUM_URL_TMPL.format(tx=tx, ty=ty)
        for attempt in range(3):
            try:
                r = requests.get(url, timeout=30)
                r.raise_for_status()
                # Validate PNG
                img = Image.open(io.BytesIO(r.content))
                img.verify()
                out.write_bytes(r.content)
                return True
            except Exception:
                time.sleep(0.6 * (attempt + 1))
        raise RuntimeError(f"Failed DEM tile {url}")

    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = [pool.submit(_grab, t) for t in tasks]
        for fut in as_completed(futs):
            if fut.result():
                downloaded += 1
    return len(tasks)


def fetch_all_datav_subdivisions(raw_dir: Path, force: bool = False) -> dict[str, int]:
    cache_dir = raw_dir / "datav_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    nat_path = raw_dir / "datav_100000_full.json"
    nat = json.loads(nat_path.read_text(encoding="utf-8"))
    prov_adcodes = [
        str(f["properties"]["adcode"])
        for f in nat["features"]
        if str(f["properties"].get("adcode", "")).isdigit()
    ]

    prov_data: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futs = {pool.submit(fetch_datav_json, ad, cache_dir, force): ad for ad in prov_adcodes}
        for fut in as_completed(futs):
            ad = futs[fut]
            res = fut.result()
            if res:
                prov_data[ad] = res

    # Collect level-2 city/prefecture adcodes that have children
    pref_tasks: list[tuple[str, str]] = []
    for prov_ad, pjson in prov_data.items():
        for feat in pjson.get("features", []):
            props = feat["properties"]
            child_ad = str(props.get("adcode", ""))
            cnum = props.get("childrenNum", 0) or 0
            level = props.get("level", "")
            if child_ad and child_ad.isdigit() and cnum > 0 and level == "city":
                pref_tasks.append((prov_ad, child_ad))

    pref_data: dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=16) as pool:
        futs = {pool.submit(fetch_datav_json, ad, cache_dir, force): (p_ad, ad) for p_ad, ad in pref_tasks}
        for fut in as_completed(futs):
            p_ad, ad = futs[fut]
            res = fut.result()
            if res:
                pref_data[ad] = res

    # Build consolidated province -> raw county/district GeoJSON index
    consolidated: list[dict[str, Any]] = []
    for prov_ad in prov_adcodes:
        if prov_ad == "710000":
            continue  # Taiwan comes from GADM TWN_2
        pjson = prov_data.get(prov_ad)
        if not pjson:
            continue
        for feat in pjson.get("features", []):
            props = feat["properties"]
            c_ad = str(props.get("adcode", ""))
            cnum = props.get("childrenNum", 0) or 0
            level = props.get("level", "")
            if level == "city" and cnum > 0 and c_ad in pref_data:
                for sub in pref_data[c_ad].get("features", []):
                    sp = dict(sub["properties"])
                    sp["_prov_adcode"] = prov_ad
                    sp["_parent_adcode"] = c_ad
                    sp["_parent_name"] = props.get("name", "")
                    consolidated.append({"type": "Feature", "properties": sp, "geometry": sub["geometry"]})
            else:
                # Direct municipality district, provincial-administered county (Hainan/Xinjiang/Hubei/Henan), or HK/Macau
                sp = dict(props)
                sp["_prov_adcode"] = prov_ad
                sp["_parent_adcode"] = prov_ad
                sp["_parent_name"] = ""
                consolidated.append({"type": "Feature", "properties": sp, "geometry": feat["geometry"]})

    out_path = raw_dir / "datav_counties_raw.json"
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": consolidated}, ensure_ascii=False),
        encoding="utf-8",
    )
    return {
        "provinces": len(prov_data),
        "prefectures_fetched": len(pref_data),
        "county_features": len(consolidated),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch real GIS & DEM data for ChinaCiv.")
    parser.add_argument("--force", action="store_true", help="Re-download existing files.")
    args = parser.parse_args()

    RAW_GEO_DIR.mkdir(parents=True, exist_ok=True)
    print("Downloading static GIS files...")
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = {
            pool.submit(download_file, url, RAW_GEO_DIR / fname, args.force): fname
            for fname, url in STATIC_SOURCES.items()
        }
        for fut in as_completed(futs):
            fname = futs[fut]
            changed = fut.result()
            print(f"  {'Downloaded' if changed else 'Cached'}: {fname}")

    print("Downloading AWS Terrarium zoom-5 DEM tiles...")
    n_tiles = fetch_terrarium_tiles(RAW_GEO_DIR / "terrarium_z5", force=args.force)
    print(f"  Terrarium z5 tiles ready: {n_tiles}")

    print("Fetching DataV GeoAtlas county/district subdivisions...")
    stats = fetch_all_datav_subdivisions(RAW_GEO_DIR, force=args.force)
    print(f"  DataV subdivisions ready: {stats}")


if __name__ == "__main__":
    main()
