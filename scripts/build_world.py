"""Build ChinaCiv 25km hex world.json and geo_lookup.json from real GIS & DEM data."""

from __future__ import annotations

from collections import Counter, defaultdict
import heapq
import json
import math
from pathlib import Path
import time
from typing import Any
import zipfile

import numpy as np
from PIL import Image
from pyproj import Transformer
from shapely import points as sh_points
from shapely import transform as sh_transform
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

from geo_common import (
    EVEN_NEIGHBORS,
    GEO_LOOKUP_PATH,
    H_STEP_KM,
    HEX_AREA_KM2,
    MARGIN_KM,
    ODD_NEIGHBORS,
    PROJ_STRING,
    PROVINCE_BY_CODE,
    PROVINCE_ORDER,
    R_KM,
    RAW_GEO_DIR,
    SPACING_KM,
    WORLD_JSON_PATH,
)

TARGET_COUNTY_COUNT = 1302

COVER_LABELS = [
    {"id": 0, "key": "water", "name": "海洋/水域", "en": "Ocean & Water"},
    {"id": 1, "key": "snow", "name": "冰川/永久积雪", "en": "Glacier & Snow"},
    {"id": 2, "key": "alpine", "name": "高寒荒漠/苔原", "en": "Alpine Tundra & Rock"},
    {"id": 3, "key": "forest", "name": "森林", "en": "Forest"},
    {"id": 4, "key": "shrub", "name": "荒漠/灌丛", "en": "Desert & Shrub"},
    {"id": 5, "key": "grass", "name": "草原/草甸", "en": "Grassland & Steppe"},
    {"id": 6, "key": "pasture", "name": "疏林草地/牧场", "en": "Pasture & Savanna"},
    {"id": 7, "key": "crop", "name": "耕地/农田", "en": "Cropland"},
    {"id": 8, "key": "wetland", "name": "湿地/沼泽", "en": "Wetland"},
    {"id": 9, "key": "developed", "name": "城镇建设用地", "en": "Built-up & Urban"},
]

TWN_COUNTY_MAP: dict[str, tuple[str, str]] = {
    "Taipei": ("710100", "台北市"),
    "NewTaipei": ("710200", "新北市"),
    "Taoyuan": ("710300", "桃园市"),
    "Taichung": ("710400", "台中市"),
    "Tainan": ("710500", "台南市"),
    "Kaohsiung": ("710600", "高雄市"),
    "Keelung": ("710700", "基隆市"),
    "HsinchuCity": ("710800", "新竹市"),
    "ChiayiCity": ("710900", "嘉义市"),
    "HsinchuCounty": ("711000", "新竹县"),
    "Miaoli": ("711100", "苗栗县"),
    "Changhua": ("711200", "彰化县"),
    "Nantou": ("711300", "南投县"),
    "Yulin": ("711400", "云林县"),
    "ChiayiCounty": ("711500", "嘉义县"),
    "Pingtung": ("711600", "屏东县"),
    "Yilan": ("711700", "宜兰县"),
    "Hualien": ("711800", "花莲县"),
    "Taitung": ("711900", "台东县"),
    "Penghu": ("712000", "澎湖县"),
}

RIVER_ZH_MAP: dict[str, str] = {
    "Yangtze": "长江",
    "Huang He": "黄河",
    "Yellow": "黄河",
    "Xi": "西江（珠江）",
    "Zhujiang": "珠江",
    "Amur": "黑龙江",
    "Heilongjiang": "黑龙江",
    "Songhua": "松花江",
    "Nen": "嫩江",
    "Ussuri": "乌苏里江",
    "Liao": "辽河",
    "Hai": "海河",
    "Huai": "淮河",
    "Han": "汉江",
    "Xiang": "湘江",
    "Gan": "赣江",
    "Min": "闽江",
    "Yalong": "雅砻江",
    "Dadu": "大渡河",
    "Jialing": "嘉陵江",
    "Wu": "乌江",
    "Yuan": "沅江",
    "Yarlung Zangbo": "雅鲁藏布江",
    "Brahmaputra": "雅鲁藏布江",
    "Salween": "怒江",
    "Nu": "怒江",
    "Mekong": "澜沧江",
    "Lancang": "澜沧江",
    "Tarim": "塔里木河",
    "Yarkant": "叶尔羌河",
    "Hotan": "和田河",
    "Ili": "伊犁河",
    "Irtysh": "额尔齐斯河",
    "Wei": "渭河",
    "Fen": "汾河",
    "Luan": "滦河",
    "Qiantang": "钱塘江",
    "Ou": "瓯江",
    "Dong": "东江",
    "Bei": "北江",
    "Red": "元江（红河）",
    "Jinsha": "金沙江",
    "Tongtian": "通天河",
    "Keriya": "克里雅河",
    "Hei": "黑河",
    "Shule": "疏勒河",
    "Argun": "额尔古纳河",
    "Tumen": "图们江",
    "Yalu": "鸭绿江",
    "Syr Darya": "锡尔河",
    "Indus": "狮泉河（印度河）",
    "Sutlej": "象泉河",
    "Zhung": "珠江",
    "Xun": "浔江",
    "Liu": "柳江",
    "Yu": "郁江",
    "Zi": "资水",
    "Li": "澧水",
    "Qing": "清江",
    "Tuo": "沱江",
    "Fu": "涪江",
    "Qu": "渠江",
    "Baishui": "白龙江",
    "Tao": "洮河",
    "Huangshui": "湟水",
    "Wuding": "无定河",
    "Luo": "洛河",
    "Ying": "颍河",
    "Guo": "涡河",
    "Yi": "沂河",
    "Sanggan": "桑干河",
    "Hutuo": "滹沱河",
    "Zhang": "漳河",
    "Xiliao": "西辽河",
    "Dongliao": "东辽河",
    "Mudan": "牡丹江",
    "Second Songhua": "第二松花江",
    "Huma": "呼玛河",
    "Kaidu": "开都河",
    "Aksu": "阿克苏河",
    "Kashgar": "喀什噶尔河",
    "Muzart": "木扎尔特河",
    "Ulug": "乌伦古河",
    "Manas": "玛纳斯河",
}

LAKE_ZH_MAP: dict[str, str] = {
    "Qinghai": "青海湖",
    "Poyang": "鄱阳湖",
    "Dongting": "洞庭湖",
    "Tai": "太湖",
    "Taihu": "太湖",
    "Hongze": "洪泽湖",
    "Chao": "巢湖",
    "Hulun": "呼伦湖",
    "Buir": "贝尔湖",
    "Khanka": "兴凯湖",
    "Nam": "纳木错",
    "Nam Co": "纳木错",
    "Seling": "色林错",
    "Serling": "色林错",
    "Yamdrok": "羊卓雍错",
    "Bosten": "博斯腾湖",
    "Ebinur": "艾比湖",
    "Ulungur": "乌伦古湖",
    "Dianchi": "滇池",
    "Erhai": "洱海",
    "Gaoyou": "高邮湖",
    "Weishan": "微山湖",
    "Nansi": "南四湖",
    "Jingpo": "镜泊湖",
    "Zhari Namco": "扎日南木错",
    "Tangra Yumco": "当惹雍错",
    "Pangong": "班公错",
    "Ngoring": "鄂陵湖",
    "Gyaring": "扎陵湖",
    "Ayakkum": "阿雅克库木湖",
    "Lop Nur": "罗布泊",
    "Sayram": "赛里木湖",
    "Manas": "玛纳斯湖",
    "Wuliangsu": "乌梁素海",
    "Chagan": "查干湖",
    "Songhua": "松花湖",
    "Fuxian": "抚仙湖",
    "Lugu": "泸沽湖",
    "Tianchi": "长白山天池",
    "Sun Moon": "日月潭",
}

# Preserve prominent provincial capitals / SAR / Taiwan / special hubs in consolidation
PROTECTED_COUNTY_KEYWORDS = (
    "中心城区",
    "香港",
    "澳门",
    "台北市",
    "新北市",
    "桃园市",
    "台中市",
    "台南市",
    "高雄市",
    "拉萨",
    "乌鲁木齐",
    "呼和浩特",
    "银川",
    "西宁",
    "海口",
    "三亚",
    "三沙",
    "深圳",
    "珠海",
    "广州",
    "上海",
    "北京",
    "天津",
    "重庆",
    "浦东新区",
    "滨海新区",
)

# Major economic/metro centers to calibrate urban built-up footprint alongside NE urban polygons
MAJOR_METRO_CORES = [
    (116.40, 39.90, 42.0, 0.72),  # Beijing
    (121.47, 31.23, 44.0, 0.78),  # Shanghai
    (113.26, 23.13, 36.0, 0.72),  # Guangzhou
    (114.06, 22.54, 32.0, 0.76),  # Shenzhen
    (114.17, 22.32, 20.0, 0.74),  # Hong Kong
    (113.55, 22.16, 15.0, 0.75),  # Macau
    (113.12, 23.02, 24.0, 0.58),  # Foshan
    (113.75, 23.02, 24.0, 0.62),  # Dongguan
    (117.20, 39.13, 30.0, 0.65),  # Tianjin
    (120.59, 31.30, 26.0, 0.60),  # Suzhou
    (120.15, 30.28, 28.0, 0.62),  # Hangzhou
    (118.80, 32.06, 26.0, 0.58),  # Nanjing
    (120.31, 31.49, 20.0, 0.55),  # Wuxi
    (121.55, 29.87, 22.0, 0.54),  # Ningbo
    (114.30, 30.60, 30.0, 0.62),  # Wuhan
    (104.06, 30.67, 32.0, 0.64),  # Chengdu
    (106.55, 29.56, 28.0, 0.58),  # Chongqing
    (108.94, 34.34, 26.0, 0.58),  # Xi'an
    (113.62, 34.75, 26.0, 0.58),  # Zhengzhou
    (112.94, 28.23, 24.0, 0.55),  # Changsha
    (117.28, 31.86, 22.0, 0.52),  # Hefei
    (117.00, 36.67, 22.0, 0.52),  # Jinan
    (120.38, 36.07, 22.0, 0.54),  # Qingdao
    (123.43, 41.80, 26.0, 0.58),  # Shenyang
    (121.62, 38.91, 20.0, 0.52),  # Dalian
    (125.32, 43.82, 22.0, 0.50),  # Changchun
    (126.64, 45.76, 24.0, 0.52),  # Harbin
    (119.30, 26.08, 20.0, 0.52),  # Fuzhou
    (118.09, 24.48, 18.0, 0.58),  # Xiamen
    (115.86, 28.68, 20.0, 0.50),  # Nanchang
    (114.51, 38.04, 22.0, 0.52),  # Shijiazhuang
    (112.55, 37.87, 20.0, 0.50),  # Taiyuan
    (102.83, 24.88, 22.0, 0.50),  # Kunming
    (106.63, 26.65, 18.0, 0.48),  # Guiyang
    (108.37, 22.82, 20.0, 0.48),  # Nanning
    (103.83, 36.06, 18.0, 0.46),  # Lanzhou
    (111.75, 40.84, 18.0, 0.45),  # Hohhot
    (87.62, 43.82, 22.0, 0.48),   # Urumqi
    (121.56, 25.03, 24.0, 0.68),  # Taipei
    (120.68, 24.15, 20.0, 0.58),  # Taichung
    (120.30, 22.63, 20.0, 0.58),  # Kaohsiung
]


def _translate_river_name(name: str) -> str:
    if not name:
        return "河流"
    for k, v in RIVER_ZH_MAP.items():
        if name.lower() == k.lower():
            return v
    for k, v in RIVER_ZH_MAP.items():
        if k.lower() in name.lower():
            return v
    return name


def _translate_lake_name(props: dict[str, Any]) -> str:
    zh = props.get("name_zh")
    if zh and zh not in ("None", "null"):
        return str(zh)
    name = str(props.get("name") or "")
    for k, v in LAKE_ZH_MAP.items():
        if k.lower() in name.lower():
            return v
    return name or "湖泊"


def _largest_poly(geom: Any) -> Any:
    if geom.geom_type == "Polygon":
        return geom
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        polys = [g for g in geom.geoms if g.geom_type == "Polygon"]
        if polys:
            return max(polys, key=lambda g: g.area)
    return geom


def _to_xy_geom(geom: Any, tf: Transformer, x_left: float, y_top: float) -> Any:
    def _fn(coords: np.ndarray) -> np.ndarray:
        xs, ys = tf.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([xs - x_left, y_top - ys])

    g2 = sh_transform(geom, _fn)
    return g2 if g2.is_valid else g2.buffer(0)


def _xy_ring_list(poly: Polygon, tol: float = 1.0) -> list[list[list[float]]]:
    simp = poly.simplify(tol, preserve_topology=True)
    if simp.is_empty:
        return []
    rings: list[list[list[float]]] = []
    for p in ([simp] if simp.geom_type == "Polygon" else list(simp.geoms)):
        ext = [[round(float(x), 1), round(float(y), 1)] for x, y in p.exterior.coords]
        if len(ext) >= 4:
            rings.append(ext)
    return rings


def build_grid_and_owner(
    tf: Transformer,
    nat_geojson: dict[str, Any],
    ne_countries: dict[str, Any],
) -> tuple[dict[str, Any], list[Any], np.ndarray, np.ndarray, np.ndarray, Any, list[list[list[float]]]]:
    prov_idx_by_code = {p["code"]: p["idx"] for p in PROVINCE_ORDER}

    # Compute China Albers bounding box across all 34 provinces
    xmin, xmax, ymin, ymax = 1e9, -1e9, 1e9, -1e9

    def _walk(coords: Any) -> None:
        nonlocal xmin, xmax, ymin, ymax
        if isinstance(coords[0], (int, float)):
            xa, ya = tf.transform(coords[0], coords[1])
            xmin = min(xmin, xa)
            xmax = max(xmax, xa)
            ymin = min(ymin, ya)
            ymax = max(ymax, ya)
        else:
            for item in coords:
                _walk(item)

    for feat in nat_geojson["features"]:
        ad = str(feat["properties"].get("adcode", ""))
        if ad in prov_idx_by_code:
            _walk(feat["geometry"]["coordinates"])

    x_left = xmin - MARGIN_KM
    y_top = ymax + MARGIN_KM
    width_km = (xmax - xmin) + 2.0 * MARGIN_KM
    height_km = (ymax - ymin) + 2.0 * MARGIN_KM

    cols = int(math.ceil(width_km / SPACING_KM)) + 1
    rows = int(math.ceil(height_km / H_STEP_KM)) + 1
    n_cells = cols * rows

    grid = {
        "spacing_km": SPACING_KM,
        "W": SPACING_KM,
        "R": round(R_KM, 6),
        "H_step": round(H_STEP_KM, 6),
        "cols": cols,
        "rows": rows,
        "x_left": round(x_left, 4),
        "y_top": round(y_top, 4),
        "width_km": round(width_km, 2),
        "height_km": round(height_km, 2),
        "margin_km": MARGIN_KM,
        "proj": PROJ_STRING,
        "hex_area_km2": round(HEX_AREA_KM2, 4),
    }

    prov_geoms: list[Any] = [None] * 34
    scs_line: list[list[list[float]]] = []
    for feat in nat_geojson["features"]:
        ad = str(feat["properties"].get("adcode", ""))
        if ad in prov_idx_by_code:
            prov_geoms[prov_idx_by_code[ad]] = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
        elif ad == "100000_JD":
            jd_geom = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
            parts = list(jd_geom.geoms) if hasattr(jd_geom, "geoms") else [jd_geom]
            for part in parts:
                coords = np.asarray(part.exterior.coords)
                if len(coords) < 2:
                    continue
                # Find the two farthest vertices along the elongated dash pill
                d2 = np.sum((coords[:, None, :] - coords[None, :, :]) ** 2, axis=-1)
                i0, i1 = np.unravel_index(np.argmax(d2), d2.shape)
                p0 = coords[i0]
                p1 = coords[i1]
                # Order consistently north-to-south
                if p0[1] > p1[1]:
                    p0, p1 = p1, p0
                scs_line.append([
                    [round(float(p0[0]), 1), round(float(p0[1]), 1)],
                    [round(float(p1[0]), 1), round(float(p1[1]), 1)],
                ])

    centers_x = np.empty(n_cells, dtype=np.float64)
    centers_y = np.empty(n_cells, dtype=np.float64)
    for r in range(rows):
        cy = r * H_STEP_KM
        off = (r & 1) * 0.5
        row_start = r * cols
        for c in range(cols):
            centers_x[row_start + c] = (c + off) * SPACING_KM
            centers_y[row_start + c] = cy

    pts = sh_points(centers_x, centers_y)
    owner = np.full(n_cells, -1, dtype=np.int32)
    ptree = STRtree(prov_geoms)
    qi, ti = ptree.query(pts, predicate="intersects")
    for q_idx, t_idx in zip(qi, ti):
        owner[q_idx] = int(t_idx)

    # Ensure every province 0..33 owns >=1 hex cell (e.g. Macau 820000)
    # Also ensure major coastal/island territories (Sansha Yongxing Island, Penghu) aren't missed
    prov_counts = Counter(int(v) for v in owner if v >= 0)
    for p_idx in range(34):
        if prov_counts[p_idx] == 0:
            rep = _largest_poly(prov_geoms[p_idx]).representative_point()
            d2 = (centers_x - rep.x) ** 2 + (centers_y - rep.y) ** 2
            best_cell = int(np.argmin(d2))
            owner[best_cell] = p_idx
            prov_counts[p_idx] += 1

    # Add Yongxing Island (Sansha seat) & Penghu cell if unassigned
    for lon_i, lat_i, p_idx in [(112.338, 16.834, 20), (119.575, 23.571, 31)]:
        xa, ya = tf.transform(lon_i, lat_i)
        gx, gy = xa - x_left, y_top - ya
        d2 = (centers_x - gx) ** 2 + (centers_y - gy) ** 2
        cid = int(np.argmin(d2))
        if owner[cid] == -1:
            owner[cid] = p_idx

    # Neighboring foreign land mask (owner = -2) using Natural Earth 50m countries
    foreign_geoms: list[Any] = []
    grid_box = box(-50.0, -50.0, width_km + 50.0, height_km + 50.0)
    for feat in ne_countries["features"]:
        props = feat["properties"]
        iso = str(props.get("ISO_A3", ""))
        adm0 = str(props.get("ADM0_A3", ""))
        name = str(props.get("NAME", ""))
        if iso in ("CHN", "TWN", "HKG", "MAC") or adm0 in ("CHN", "TWN", "HKG", "MAC"):
            continue
        if name in ("China", "Taiwan", "Hong Kong", "Macao"):
            continue
        g = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
        if g.intersects(grid_box):
            g_clip = g.intersection(grid_box)
            if not g_clip.is_empty:
                foreign_geoms.append(g_clip)

    if foreign_geoms:
        ftree = STRtree(foreign_geoms)
        water_idx = np.where(owner == -1)[0]
        fqi, _ = ftree.query(pts[water_idx], predicate="intersects")
        if len(fqi) > 0:
            owner[water_idx[np.unique(fqi)]] = -2

    return grid, prov_geoms, owner, centers_x, centers_y, pts, scs_line


def _is_protected(name: str) -> bool:
    return any(kw in name for kw in PROTECTED_COUNTY_KEYWORDS)


def build_1302_counties(
    tf: Transformer,
    grid: dict[str, Any],
    owner: np.ndarray,
    pts: Any,
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """Reconcile DataV 2,874 + GADM TWN_2 20 units into EXACTLY 1,302 real Chinese counties."""
    x_left = grid["x_left"]
    y_top = grid["y_top"]
    prov_idx_by_code = {p["code"]: p["idx"] for p in PROVINCE_ORDER}

    dv = json.loads((RAW_GEO_DIR / "datav_counties_raw.json").read_text(encoding="utf-8"))
    raw_units: list[dict[str, Any]] = []
    for feat in dv["features"]:
        p = feat["properties"]
        prov_ad = p["_prov_adcode"]
        raw_units.append(
            {
                "code": str(p["adcode"]),
                "name": p["name"],
                "prov_idx": prov_idx_by_code[prov_ad],
                "pref": str(p.get("_parent_adcode") or prov_ad),
                "pref_name": str(p.get("_parent_name") or PROVINCE_ORDER[prov_idx_by_code[prov_ad]]["name"]),
                "geom": _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top),
            }
        )

    with zipfile.ZipFile(RAW_GEO_DIR / "gadm41_TWN_2.json.zip") as z:
        t2 = json.loads(z.read(z.namelist()[0]))
    for feat in t2["features"]:
        p = feat["properties"]
        if p["NAME_1"] == "Fujian":
            continue  # Kinmen & Lienkiang already in DataV Fujian 350527 / 350122
        code, cname = TWN_COUNTY_MAP[p["NAME_2"]]
        raw_units.append(
            {
                "code": code,
                "name": cname,
                "prov_idx": 31,
                "pref": "710000",
                "pref_name": "台湾省",
                "geom": _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top),
            }
        )

    # Step 1: Urban core consolidation
    # - Consolidate HK (18 -> 1) and Macau (8 -> 1)
    # - Consolidate small inner-city districts (区, < 450 km2) within each prefecture/municipality
    step1: list[dict[str, Any]] = []
    hk_units = [u for u in raw_units if u["prov_idx"] == 32]
    mac_units = [u for u in raw_units if u["prov_idx"] == 33]
    step1.append(
        {
            "code": "810001",
            "name": "香港特别行政区",
            "prov_idx": 32,
            "pref": "810000",
            "pref_name": "香港特别行政区",
            "geom": unary_union([u["geom"] for u in hk_units]),
            "is_core": True,
        }
    )
    step1.append(
        {
            "code": "820001",
            "name": "澳门特别行政区",
            "prov_idx": 33,
            "pref": "820000",
            "pref_name": "澳门特别行政区",
            "geom": unary_union([u["geom"] for u in mac_units]),
            "is_core": True,
        }
    )

    by_pref: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for u in raw_units:
        if u["prov_idx"] in (32, 33):
            continue
        by_pref[(u["prov_idx"], u["pref"])].append(u)

    for (pidx, pref), grp in by_pref.items():
        # For municipalities & prefectures, merge small inner-city districts (< 450 km2) into urban core
        small_dist = [u for u in grp if u["name"].endswith("区") and u["geom"].area < 450.0]
        others = [u for u in grp if not (u["name"].endswith("区") and u["geom"].area < 450.0)]
        if len(small_dist) >= 2:
            small_dist.sort(key=lambda x: x["code"])
            pname = grp[0]["pref_name"] or PROVINCE_ORDER[pidx]["name"]
            short_p = (
                pname.replace("市", "")
                .replace("地区", "")
                .replace("自治州", "")
                .replace("盟", "")
                .replace("自治区", "")
            )
            core_name = f"{short_p}中心城区" if pidx in (0, 1, 8, 21) else f"{short_p}城区"
            step1.append(
                {
                    "code": small_dist[0]["code"],
                    "name": core_name,
                    "prov_idx": pidx,
                    "pref": pref,
                    "pref_name": pname,
                    "geom": unary_union([u["geom"] for u in small_dist]),
                    "is_core": True,
                }
            )
            for u in others:
                u["is_core"] = False
                step1.append(u)
        else:
            for u in grp:
                u["is_core"] = False
                step1.append(u)

    # Assign all China hexes to Step-1 units strictly within the same province
    by_prov: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for idx, u in enumerate(step1):
        u["id"] = idx
        u["area"] = float(u["geom"].area)
        u["cells"] = []
        u["alive"] = True
        u["rep"] = _largest_poly(u["geom"]).representative_point()
        by_prov[u["prov_idx"]].append(u)

    china_cells = np.where(owner >= 0)[0]
    prov_hex_counts: dict[int, int] = {}
    for pidx in range(34):
        units = by_prov[pidx]
        p_cells = china_cells[owner[china_cells] == pidx]
        prov_hex_counts[pidx] = int(len(p_cells))
        if len(units) == 1:
            units[0]["cells"] = p_cells.tolist()
            continue
        utree = STRtree([u["geom"] for u in units])
        qi, ti = utree.query(pts[p_cells], predicate="intersects")
        assigned: dict[int, int] = {}
        for q_idx, t_idx in zip(qi, ti):
            c_id = int(p_cells[q_idx])
            if c_id not in assigned:
                assigned[c_id] = int(t_idx)
        for c_id in p_cells:
            c_id = int(c_id)
            if c_id in assigned:
                units[assigned[c_id]]["cells"].append(c_id)
            else:
                pt = pts[c_id]
                best_t = min(range(len(units)), key=lambda k: units[k]["geom"].distance(pt))
                units[best_t]["cells"].append(c_id)

    # Build within-province adjacency graph
    adj: dict[int, set[int]] = defaultdict(set)
    for pidx in range(34):
        units = by_prov[pidx]
        if len(units) <= 1:
            continue
        buf_geoms = [u["geom"].buffer(2.5) for u in units]
        btree = STRtree(buf_geoms)
        qi, ti = btree.query(buf_geoms, predicate="intersects")
        for a, c in zip(qi, ti):
            if a != c:
                adj[units[int(a)]["id"]].add(units[int(c)]["id"])

    prov_alive = {p: sum(1 for u in by_prov[p] if u["alive"]) for p in range(34)}
    # Fair proportional minimum floor per province so every province keeps good county detail
    prov_min = {}
    for p in range(34):
        hx = prov_hex_counts[p]
        if p in (32, 33):
            prov_min[p] = 1
        elif p in (0, 1, 8):  # Beijing, Tianjin, Shanghai
            prov_min[p] = min(prov_alive[p], max(3, hx // 5))
        elif p == 31:  # Taiwan
            prov_min[p] = min(prov_alive[p], 8)
        else:
            prov_min[p] = max(2, min(prov_alive[p], max(2, hx // 18)))

    alive_count = len(step1)
    # Priority queue: (zero_cell_flag, protected_penalty, hex_count, area, uid)
    pq: list[tuple[int, int, int, float, int]] = []
    for u in step1:
        prot = 1 if _is_protected(u["name"]) else 0
        heapq.heappush(pq, (0 if len(u["cells"]) == 0 else 1, prot, len(u["cells"]), u["area"], u["id"]))

    def _merge_pair(u: dict[str, Any], v: dict[str, Any]) -> None:
        nonlocal alive_count
        u_old_area = u["area"]
        v_old_area = v["area"]
        u_prot = _is_protected(u["name"])
        v_prot = _is_protected(v["name"])

        v["geom"] = unary_union([v["geom"], u["geom"]])
        v["area"] = float(v["geom"].area)
        v["cells"].extend(u["cells"])
        v["rep"] = _largest_poly(v["geom"]).representative_point()

        keep_u_identity = False
        if u_prot and not v_prot:
            keep_u_identity = True
        elif u_prot == v_prot:
            if u["is_core"] and not v["is_core"]:
                keep_u_identity = True
            elif u["is_core"] == v["is_core"] and u_old_area > v_old_area:
                keep_u_identity = True

        if keep_u_identity:
            v["name"] = u["name"]
            v["code"] = u["code"]
            v["pref"] = u["pref"]
            v["pref_name"] = u["pref_name"]
            v["is_core"] = u["is_core"]

        u["alive"] = False
        prov_alive[u["prov_idx"]] -= 1
        alive_count -= 1

        uid, vid = u["id"], v["id"]
        for nid in list(adj[uid]):
            adj[nid].discard(uid)
            if nid != vid and step1[nid]["alive"]:
                adj[vid].add(nid)
                adj[nid].add(vid)
        adj[uid].clear()
        prot = 1 if _is_protected(v["name"]) else 0
        heapq.heappush(pq, (0 if len(v["cells"]) == 0 else 1, prot, len(v["cells"]), v["area"], vid))

    # First pass: eliminate all 0-cell counties and merge down to TARGET_COUNTY_COUNT
    deferred: list[dict[str, Any]] = []
    while alive_count > TARGET_COUNTY_COUNT and pq:
        zf, prot, hc, ar, uid = heapq.heappop(pq)
        u = step1[uid]
        if not u["alive"]:
            continue
        pidx = u["prov_idx"]
        if prov_alive[pidx] <= 1:
            continue
        if len(u["cells"]) > 0 and prov_alive[pidx] <= prov_min[pidx]:
            deferred.append(u)
            continue

        nbs = [step1[nid] for nid in adj[uid] if step1[nid]["alive"]]
        if nbs:
            v = min(
                nbs,
                key=lambda x: (
                    0 if x["pref"] == u["pref"] else 1,
                    1 if x["is_core"] else 0,
                    len(x["cells"]),
                    x["area"],
                ),
            )
        else:
            cands = [x for x in by_prov[pidx] if x["alive"] and x["id"] != uid]
            if not cands:
                continue
            v = min(
                cands,
                key=lambda x: (
                    0 if x["pref"] == u["pref"] else 1,
                    u["rep"].distance(x["rep"]),
                ),
            )
        _merge_pair(u, v)

    # Safety pass if deferred units still keep alive_count > TARGET_COUNTY_COUNT
    if alive_count > TARGET_COUNTY_COUNT:
        rem = [u for u in step1 if u["alive"] and prov_alive[u["prov_idx"]] > 1]
        rem.sort(key=lambda x: (1 if _is_protected(x["name"]) else 0, len(x["cells"]), x["area"]))
        for u in rem:
            if alive_count <= TARGET_COUNTY_COUNT:
                break
            if not u["alive"] or prov_alive[u["prov_idx"]] <= 1:
                continue
            pidx = u["prov_idx"]
            nbs = [step1[nid] for nid in adj[u["id"]] if step1[nid]["alive"]]
            cands = nbs if nbs else [x for x in by_prov[pidx] if x["alive"] and x["id"] != u["id"]]
            if not cands:
                continue
            v = min(cands, key=lambda x: (0 if x["pref"] == u["pref"] else 1, len(x["cells"]), x["area"]))
            _merge_pair(u, v)

    final_units = [u for u in step1 if u["alive"]]
    if len(final_units) != TARGET_COUNTY_COUNT:
        raise RuntimeError(f"Expected {TARGET_COUNTY_COUNT} counties, got {len(final_units)}")

    # Sort canonically by (province_idx, code, name) and ensure unique 6-digit codes
    final_units.sort(key=lambda u: (u["prov_idx"], u["code"], u["name"]))
    seen_codes: set[str] = set()
    county_arr = np.full(len(owner), -1, dtype=np.int32)
    county_records: list[dict[str, Any]] = []

    for c_idx, u in enumerate(final_units):
        code = u["code"]
        if code in seen_codes:
            # Make unique 6-digit code in same province prefix
            prefix = code[:4]
            for suffix in range(90, 99):
                cand = f"{prefix}{suffix:02d}"
                if cand not in seen_codes:
                    code = cand
                    break
        seen_codes.add(code)

        if not u["cells"]:
            raise RuntimeError(f"County {code} {u['name']} has 0 hex cells!")
        for cid in u["cells"]:
            county_arr[cid] = c_idx

        county_records.append(
            {
                "idx": c_idx,
                "code": code,
                "name": u["name"],
                "province_idx": u["prov_idx"],
                "province_name": PROVINCE_ORDER[u["prov_idx"]]["name"],
                "prefecture": u["pref_name"],
                "geom": u["geom"],
                "area_km2": round(u["area"], 1),
                "cells": sorted(set(int(c) for c in u["cells"])),
            }
        )

    return county_arr, county_records


def sample_terrarium_dem(
    grid: dict[str, Any],
    owner: np.ndarray,
    centers_x: np.ndarray,
    centers_y: np.ndarray,
    tf_inv: Transformer,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Sample real AWS Terrarium zoom-5 DEM inside each land hex using a 19-point stencil."""
    dem_dir = RAW_GEO_DIR / "terrarium_z5"
    tiles: dict[tuple[int, int], np.ndarray] = {}
    for p in dem_dir.glob("5_*.png"):
        _, tx_s, ty_s = p.stem.split("_")
        arr = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
        elev = (arr[:, :, 0] * 256.0 + arr[:, :, 1] + arr[:, :, 2] / 256.0) - 32768.0
        tiles[(int(tx_s), int(ty_s))] = elev

    n_cells = len(owner)
    elev_mean = np.zeros(n_cells, dtype=np.int32)
    elev_max = np.zeros(n_cells, dtype=np.int32)
    relief = np.zeros(n_cells, dtype=np.int32)

    land_idx = np.where(owner != -1)[0]
    if len(land_idx) == 0:
        return elev_mean, elev_max, relief

    # 19-point hexagonal sampling stencil inside radius 0.85 * R_KM
    offsets: list[tuple[float, float]] = [(0.0, 0.0)]
    for k in range(6):
        ang = k * math.pi / 3.0
        offsets.append((0.45 * R_KM * math.cos(ang), 0.45 * R_KM * math.sin(ang)))
    for k in range(12):
        ang = k * math.pi / 6.0
        offsets.append((0.85 * R_KM * math.cos(ang), 0.85 * R_KM * math.sin(ang)))

    off_x = np.array([o[0] for o in offsets], dtype=np.float64)[None, :]
    off_y = np.array([o[1] for o in offsets], dtype=np.float64)[None, :]

    x_left = grid["x_left"]
    y_top = grid["y_top"]
    sx_aea = centers_x[land_idx, None] + off_x + x_left
    sy_aea = y_top - (centers_y[land_idx, None] + off_y)

    lons, lats = tf_inv.transform(sx_aea.ravel(), sy_aea.ravel())
    lons = np.clip(lons, -179.99, 179.99)
    lats = np.clip(lats, -85.0, 85.0)

    n = 32.0
    xt = (lons + 180.0) / 360.0 * n
    lat_r = np.radians(lats)
    yt = (1.0 - np.arcsinh(np.tan(lat_r)) / math.pi) / 2.0 * n

    txs = np.clip(xt.astype(np.int32), 0, 31)
    tys = np.clip(yt.astype(np.int32), 0, 31)
    pxs = np.clip(((xt - txs) * 256.0).astype(np.int32), 0, 255)
    pys = np.clip(((yt - tys) * 256.0).astype(np.int32), 0, 255)

    vals = np.zeros(len(lons), dtype=np.float64)
    for (tx, ty), tile_arr in tiles.items():
        mask = (txs == tx) & (tys == ty)
        if np.any(mask):
            vals[mask] = tile_arr[pys[mask], pxs[mask]]

    mat = vals.reshape(len(land_idx), len(offsets))
    # Preserve real Turpan depression in Xinjiang (owner==30), clamp coastal ocean bleed elsewhere
    means = np.mean(mat, axis=1)
    maxs = np.max(mat, axis=1)
    mins = np.min(mat, axis=1)

    non_xinjiang = owner[land_idx] != 30
    means[non_xinjiang] = np.maximum(0.0, means[non_xinjiang])
    maxs[non_xinjiang] = np.maximum(0.0, maxs[non_xinjiang])
    mins[non_xinjiang] = np.maximum(0.0, mins[non_xinjiang])
    spans = maxs - mins

    rel = np.zeros(len(land_idx), dtype=np.int32)
    rel[(spans >= 160) | ((means >= 450) & (spans >= 90))] = 1
    rel[(spans >= 520) | ((means >= 2500) & (spans >= 320))] = 2
    rel[(spans >= 1150) | ((maxs >= 4500) & (spans >= 650))] = 3

    elev_mean[land_idx] = np.round(means).astype(np.int32)
    elev_max[land_idx] = np.round(maxs).astype(np.int32)
    relief[land_idx] = rel
    return elev_mean, elev_max, relief


def extract_rivers_and_lakes(
    tf: Transformer,
    grid: dict[str, Any],
    ne_rivers: dict[str, Any],
    ne_lakes: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[Any]]:
    """Project and clip Natural Earth 10m rivers and lakes to grid bounds."""
    x_left = grid["x_left"]
    y_top = grid["y_top"]
    w_km = grid["width_km"]
    h_km = grid["height_km"]
    bbox = box(0.0, 0.0, w_km, h_km)

    rivers_out: list[dict[str, Any]] = []
    for feat in ne_rivers["features"]:
        props = feat["properties"]
        srank = props.get("scalerank", 8)
        if srank is not None and srank > 8:
            continue
        g = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
        if not g.intersects(bbox):
            continue
        clipped = g.intersection(bbox)
        if clipped.is_empty:
            continue
        lines = [clipped] if clipped.geom_type == "LineString" else [
            ln for ln in getattr(clipped, "geoms", []) if ln.geom_type == "LineString"
        ]
        en_name = str(props.get("name_en") or props.get("name") or "")
        zh_name = _translate_river_name(en_name)
        for ln in lines:
            if ln.length < 30.0:
                continue
            simp = ln.simplify(1.5, preserve_topology=False)
            pts_list = [[round(float(x), 1), round(float(y), 1)] for x, y in simp.coords]
            if len(pts_list) >= 2:
                rivers_out.append(
                    {
                        "name": zh_name,
                        "name_en": en_name,
                        "scalerank": int(srank) if srank is not None else 6,
                        "pts": pts_list,
                    }
                )

    lakes_out: list[dict[str, Any]] = []
    lake_geoms: list[Any] = []
    for feat in ne_lakes["features"]:
        props = feat["properties"]
        g = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
        if not g.intersects(bbox):
            continue
        clipped = g.intersection(bbox)
        if clipped.is_empty or clipped.area < 80.0:
            continue
        lake_geoms.append(clipped)
        rings: list[list[list[float]]] = []
        polys = [clipped] if clipped.geom_type == "Polygon" else [
            p for p in getattr(clipped, "geoms", []) if p.geom_type == "Polygon"
        ]
        for p in polys:
            rings.extend(_xy_ring_list(p, tol=1.0))
        if rings:
            lakes_out.append(
                {
                    "name": _translate_lake_name(props),
                    "name_en": str(props.get("name_en") or props.get("name") or ""),
                    "scalerank": int(props.get("scalerank") or 5),
                    "area_km2": round(float(clipped.area), 1),
                    "rings": rings,
                }
            )

    return rivers_out, lakes_out, lake_geoms


def build_land_cover(
    tf: Transformer,
    tf_inv: Transformer,
    grid: dict[str, Any],
    owner: np.ndarray,
    centers_x: np.ndarray,
    centers_y: np.ndarray,
    elev_mean: np.ndarray,
    elev_max: np.ndarray,
    relief: np.ndarray,
    rivers: list[dict[str, Any]],
    lake_geoms: list[Any],
) -> tuple[np.ndarray, dict[str, list[float]]]:
    """Compute calibrated 7-channel land cover pct and cover class 0..9 from GIS + DEM + climate."""
    n_cells = len(owner)
    x_left = grid["x_left"]
    y_top = grid["y_top"]

    cover = np.zeros(n_cells, dtype=np.int32)
    ch_names = ("forest", "crop", "grass", "shrub", "wetland", "developed", "alpine")
    pct_arr = {k: np.zeros(n_cells, dtype=np.float64) for k in ch_names}

    land_idx = np.where(owner != -1)[0]
    if len(land_idx) == 0:
        return cover, {k: pct_arr[k].tolist() for k in ch_names}

    # Build hex polygons for land cells
    angles = [math.pi / 6.0 + k * math.pi / 3.0 for k in range(6)]
    cos_a = [R_KM * math.cos(a) for a in angles]
    sin_a = [R_KM * math.sin(a) for a in angles]
    hex_polys = [
        Polygon([(centers_x[i] + cos_a[k], centers_y[i] + sin_a[k]) for k in range(6)])
        for i in land_idx
    ]
    htree = STRtree(hex_polys)

    # Geographic coordinates for land cells
    xa = centers_x[land_idx] + x_left
    ya = y_top - centers_y[land_idx]
    lons, lats = tf_inv.transform(xa, ya)

    bbox = box(-20.0, -20.0, grid["width_km"] + 20.0, grid["height_km"] + 20.0)

    def _frac_overlap(geojson_path: Path, filter_fn: Any = None) -> np.ndarray:
        frac = np.zeros(len(land_idx), dtype=np.float64)
        gj = json.loads(geojson_path.read_text(encoding="utf-8"))
        geoms = []
        for feat in gj["features"]:
            if filter_fn and not filter_fn(feat["properties"]):
                continue
            g = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
            if g.intersects(bbox):
                gc = g.intersection(bbox)
                if not gc.is_empty:
                    geoms.append(gc)
        if not geoms:
            return frac
        gtree = STRtree(geoms)
        qi, ti = gtree.query(hex_polys, predicate="intersects")
        # Group intersections by hex index
        by_h: dict[int, list[int]] = defaultdict(list)
        for q_i, t_i in zip(qi, ti):
            by_h[int(q_i)].append(int(t_i))
        for q_i, t_list in by_h.items():
            hp = hex_polys[q_i]
            u = unary_union([geoms[t_i] for t_i in t_list])
            frac[q_i] = min(1.0, hp.intersection(u).area / HEX_AREA_KM2)
        return frac

    urban_frac = _frac_overlap(RAW_GEO_DIR / "ne_10m_urban_areas.geojson")
    glacier_frac = _frac_overlap(RAW_GEO_DIR / "ne_10m_glaciated_areas.geojson")

    # Lake overlap fraction
    lake_frac = np.zeros(len(land_idx), dtype=np.float64)
    if lake_geoms:
        ltree = STRtree(lake_geoms)
        qi, ti = ltree.query(hex_polys, predicate="intersects")
        by_h: dict[int, list[int]] = defaultdict(list)
        for q_i, t_i in zip(qi, ti):
            by_h[int(q_i)].append(int(t_i))
        for q_i, t_list in by_h.items():
            u = unary_union([lake_geoms[t_i] for t_i in t_list])
            lake_frac[q_i] = min(1.0, hex_polys[q_i].intersection(u).area / HEX_AREA_KM2)

    # River proximity wetland signal
    river_geoms = [LineString(r["pts"]) for r in rivers if len(r["pts"]) >= 2]
    river_prox = np.zeros(len(land_idx), dtype=np.float64)
    if river_geoms:
        rtree = STRtree([rg.buffer(12.0) for rg in river_geoms])
        qi, _ = rtree.query(sh_points(centers_x[land_idx], centers_y[land_idx]), predicate="intersects")
        if len(qi) > 0:
            river_prox[np.unique(qi)] = 1.0

    # Natural Earth geographic region masks (deserts, plains, plateaus, mountains)
    reg_gj = json.loads((RAW_GEO_DIR / "ne_10m_geography_regions_polys.geojson").read_text(encoding="utf-8"))
    desert_geoms, plain_geoms, forest_mtn_geoms, steppe_geoms = [], [], [], []
    for feat in reg_gj["features"]:
        p = feat["properties"]
        name_u = str(p.get("NAME") or "").upper()
        fcla = str(p.get("FEATURECLA") or "")
        g = _to_xy_geom(shape(feat["geometry"]), tf, x_left, y_top)
        if not g.intersects(bbox):
            continue
        gc = g.intersection(bbox)
        if gc.is_empty:
            continue
        if fcla == "Desert" or any(k in name_u for k in ("TAKLIMAKAN", "GOBI", "MU US", "TARIM BASIN", "QAIDAM")):
            desert_geoms.append(gc)
        elif fcla in ("Plain", "Delta") or "SICHUAN BASIN" in name_u:
            plain_geoms.append(gc)
        elif any(k in name_u for k in ("KHINGAN", "QINLING", "WUYI", "NAN LING", "DABIE", "TAIHANG", "TSANGPO")):
            forest_mtn_geoms.append(gc)
        elif any(k in name_u for k in ("MONGOLIAN PLATEAU", "JUNGGAR", "TIBET")):
            steppe_geoms.append(gc)

    def _mask_overlap(geoms: list[Any]) -> np.ndarray:
        out = np.zeros(len(land_idx), dtype=np.float64)
        if not geoms:
            return out
        tree = STRtree(geoms)
        qi, _ = tree.query(sh_points(centers_x[land_idx], centers_y[land_idx]), predicate="intersects")
        if len(qi) > 0:
            out[np.unique(qi)] = 1.0
        return out

    in_desert = _mask_overlap(desert_geoms)
    in_plain = _mask_overlap(plain_geoms)
    in_forest_mtn = _mask_overlap(forest_mtn_geoms)
    in_steppe = _mask_overlap(steppe_geoms)

    # Metro urban boost from major Chinese cities (captures post-2010 expansion)
    metro_boost = np.zeros(len(land_idx), dtype=np.float64)
    lx = centers_x[land_idx]
    ly = centers_y[land_idx]
    for mlon, mlat, rad_km, peak in MAJOR_METRO_CORES:
        mx, my = tf.transform(mlon, mlat)
        mx -= x_left
        my = y_top - my
        dist = np.hypot(lx - mx, ly - my)
        boost = peak * np.exp(-(dist / rad_km) ** 2)
        metro_boost = np.maximum(metro_boost, boost)

    el = elev_mean[land_idx].astype(np.float64)
    el_m = elev_max[land_idx].astype(np.float64)
    rl = relief[land_idx].astype(np.float64)

    # Moisture index across China (monsoon SE/S -> arid NW, plus boreal NE)
    # 800mm Qinling-Huaihe (~33N in E), 400mm Daxing'anling-Yinshan-Lanzhou-Lhasa diagonal
    se_diag = (lons - 95.0) * 0.45 + (35.0 - lats) * 0.65
    moisture = np.clip(0.45 + 0.032 * se_diag, 0.03, 0.98)
    # Boreal NE China (Heilongjiang/E Inner Mongolia) is humid despite high latitude
    ne_humid = (lons > 118.0) & (lats > 41.0)
    moisture[ne_humid] = np.maximum(moisture[ne_humid], 0.58)
    # Sichuan Basin & Yunnan-Guizhou are humid
    sw_humid = (lons >= 98.0) & (lons <= 110.0) & (lats >= 21.0) & (lats <= 32.5)
    moisture[sw_humid] = np.maximum(moisture[sw_humid], 0.68)
    # Tianshan / Altai orographic moisture
    tianshan = (lons >= 80.0) & (lons <= 92.0) & (lats >= 42.0) & (lats <= 48.5) & (el >= 1400.0)
    moisture[tianshan] = np.maximum(moisture[tianshan], 0.34)

    # Compute raw channel weights per land cell
    developed = np.clip(np.maximum(urban_frac * 1.35, metro_boost), 0.0, 0.90)
    # Suppress urban in extreme mountains or ocean-edge lakes
    developed = np.where(el > 3800.0, developed * 0.15, developed)

    alpine = np.clip(
        glacier_frac * 1.5
        + np.clip((el - 3600.0) / 1400.0, 0.0, 0.85)
        + np.clip((el_m - 4400.0) / 1600.0, 0.0, 0.35),
        0.0,
        0.95,
    )

    # Wetland: lakes + river plains + Sanjiang Plain (NE Heilongjiang) + Zoige + Sanjiangyuan
    sanjiang = (lons > 129.0) & (lats > 45.0) & (el < 200.0)
    zoige = (lons >= 101.5) & (lons <= 103.8) & (lats >= 32.5) & (lats <= 34.5) & (el >= 3200.0)
    sanjiangyuan = (lons >= 90.0) & (lons <= 100.0) & (lats >= 32.0) & (lats <= 35.8)
    wetland = np.clip(
        lake_frac * 0.85
        + river_prox * (0.09 + 0.08 * (rl == 0))
        + np.where(sanjiang, 0.24, 0.0)
        + np.where(zoige, 0.28, 0.0)
        + np.where(sanjiangyuan, 0.14, 0.0),
        0.0,
        0.85,
    )

    # Shrub / Desert: Taklamakan, Gobi, Badain Jaran, Tengger, Qaidam, Turpan, arid NW
    aridity = np.clip(1.0 - moisture * 1.45, 0.0, 1.0)
    shrub = np.clip(
        0.58 * in_desert * (el < 3800.0)
        + 0.42 * aridity * np.where(el < 3200.0, 1.0, 0.45)
        + 0.10 * (1.0 - moisture) * (rl >= 1),
        0.02,
        0.92,
    )

    # Cropland: fertile plains, low relief, adequate moisture, < 2000m (or oasis)
    temp_ok = np.clip(1.0 - np.maximum(0.0, el - 1400.0) / 1800.0, 0.0, 1.0)
    flatness = np.where(rl == 0, 1.0, np.where(rl == 1, 0.48, 0.12))
    crop = np.clip(
        (0.55 * in_plain + 0.42 * moisture * flatness) * temp_ok * (1.0 - 0.65 * in_desert),
        0.01,
        0.85,
    )
    # Tarim/Hexi oasis agriculture along rivers
    oasis = (lons >= 75.0) & (lons <= 104.0) & (lats >= 36.0) & (lats <= 45.0) & (river_prox > 0) & (el < 2000.0)
    crop = np.where(oasis, np.maximum(crop, 0.22), crop)

    # Forest: humid hills/mountains + boreal NE + Taiwan/Fujian/Zhejiang/Jiangxi/Yunnan/SE Tibet
    treeline = np.clip(1.0 - np.maximum(0.0, el - 3400.0) / 1100.0, 0.0, 1.0)
    south_ne_forest = np.clip((moisture - 0.30) * 1.25, 0.0, 0.90)
    mtn_bonus = np.where(rl >= 1, 0.26, 0.05) + 0.22 * in_forest_mtn
    forest = np.clip((south_ne_forest * (0.45 + mtn_bonus)) * treeline * (1.0 - 0.7 * in_plain * (rl == 0)), 0.01, 0.88)
    # Keep high forest cover in Greater/Lesser Khingan & Changbai & South China hills
    boreal = (lons >= 119.0) & (lats >= 47.0) & (el >= 300.0)
    forest = np.where(boreal, np.maximum(forest, 0.65), forest)
    se_hills = (lons >= 106.0) & (lats <= 31.0) & (rl >= 1)
    forest = np.where(se_hills, np.maximum(forest, 0.56), forest)

    # Grassland / Steppe / Alpine meadow
    grass = np.clip(
        0.45 * in_steppe * np.where(el < 4500.0, 1.0, 0.35)
        + 0.36 * np.exp(-((moisture - 0.35) / 0.18) ** 2) * (1.0 - 0.5 * in_desert)
        + 0.24 * ((el >= 2800.0) & (el < 4400.0) & (moisture >= 0.22)),
        0.02,
        0.85,
    )

    # Stack and normalize so the 7 channels sum cleanly to 1.0 on every land hex
    stack = np.vstack([forest, crop, grass, shrub, wetland, developed, alpine])
    totals = np.maximum(1e-6, np.sum(stack, axis=0))
    stack /= totals[None, :]

    for k_i, k_name in enumerate(ch_names):
        arr = np.round(stack[k_i], 3)
        pct_arr[k_name][land_idx] = arr

    # Dominant cover class 0..9
    f_v, c_v, g_v, s_v, w_v, d_v, a_v = stack
    cov = np.zeros(len(land_idx), dtype=np.int32)
    for j in range(len(land_idx)):
        if lake_frac[j] >= 0.55:
            cov[j] = 0
        elif glacier_frac[j] >= 0.16 or el[j] >= 5300.0:
            cov[j] = 1
        elif a_v[j] >= 0.38 or el[j] >= 4450.0:
            cov[j] = 2
        elif d_v[j] >= 0.34:
            cov[j] = 9
        elif w_v[j] >= 0.26:
            cov[j] = 8
        else:
            # Pick max among forest(3), shrub(4), grass(5/6), crop(7)
            scores = [(f_v[j], 3), (s_v[j], 4), (c_v[j], 7), (g_v[j], 5)]
            _, best_cls = max(scores, key=lambda x: x[0])
            if best_cls == 5 and (lats[j] < 35.0 and el[j] < 2200.0):
                best_cls = 6  # southern/loess pasture/savanna
            cov[j] = best_cls

    cover[land_idx] = cov
    pct_lists = {k: [0 if v == 0.0 else float(v) for v in pct_arr[k]] for k in ch_names}
    return cover, pct_lists


def main() -> None:
    t0 = time.time()
    tf = Transformer.from_crs("EPSG:4326", PROJ_STRING, always_xy=True)
    tf_inv = Transformer.from_crs(PROJ_STRING, "EPSG:4326", always_xy=True)

    nat_geojson = json.loads((RAW_GEO_DIR / "datav_100000_full.json").read_text(encoding="utf-8"))
    ne_countries = json.loads((RAW_GEO_DIR / "ne_50m_admin_0_countries.geojson").read_text(encoding="utf-8"))
    ne_rivers = json.loads((RAW_GEO_DIR / "ne_10m_rivers_lake_centerlines.geojson").read_text(encoding="utf-8"))
    ne_lakes = json.loads((RAW_GEO_DIR / "ne_10m_lakes.geojson").read_text(encoding="utf-8"))

    print("1/6 Building China Albers 25km hex grid and 34-province + foreign land owner mask...")
    grid, prov_geoms, owner, centers_x, centers_y, pts, scs_line = build_grid_and_owner(
        tf, nat_geojson, ne_countries
    )
    print(f"    Grid: {grid['cols']}x{grid['rows']} = {len(owner)} cells | China hexes: {int(np.sum(owner >= 0))} | Foreign land: {int(np.sum(owner == -2))}")

    print("2/6 Reconciling DataV + GADM into EXACTLY 1,302 Chinese counties...")
    county_arr, county_records = build_1302_counties(tf, grid, owner, pts)
    print(f"    Counties built: {len(county_records)} | Unmapped China cells: {int(np.sum((owner >= 0) & (county_arr < 0)))}")

    print("3/6 Sampling real AWS Terrarium zoom-5 DEM elevation...")
    elev_mean, elev_max, relief = sample_terrarium_dem(grid, owner, centers_x, centers_y, tf_inv)
    tibet_cells = np.where(owner == 25)[0]
    beijing_cells = np.where(owner == 0)[0]
    shanghai_cells = np.where(owner == 8)[0]
    print(
        f"    Elevation sanity -> Tibet mean: {np.mean(elev_mean[tibet_cells]):.0f}m (max {np.max(elev_max[tibet_cells])}m) | "
        f"Beijing mean: {np.mean(elev_mean[beijing_cells]):.0f}m | Shanghai mean: {np.mean(elev_mean[shanghai_cells]):.0f}m"
    )

    print("4/6 Extracting Natural Earth 10m rivers and lakes...")
    rivers_out, lakes_out, lake_geoms = extract_rivers_and_lakes(tf, grid, ne_rivers, ne_lakes)
    print(f"    Rivers: {len(rivers_out)} | Lakes: {len(lakes_out)} | SCS line dashes: {len(scs_line)}")

    print("5/6 Computing calibrated 7-channel land cover pct & cover 0..9...")
    cover, pct_lists = build_land_cover(
        tf, tf_inv, grid, owner, centers_x, centers_y, elev_mean, elev_max, relief, rivers_out, lake_geoms
    )
    cov_counts = Counter(int(cover[i]) for i in np.where(owner >= 0)[0])
    print(f"    China cover distribution: {dict(sorted(cov_counts.items()))}")

    print("6/6 Writing web/data/world.json and web/data/geo_lookup.json...")
    x_left, y_top = grid["x_left"], grid["y_top"]

    # Build 34 province metadata entries (world.states & geo_lookup.provinces)
    world_states: list[dict[str, Any]] = []
    lookup_provinces: list[dict[str, Any]] = []
    for p in PROVINCE_ORDER:
        pidx = p["idx"]
        cells = np.where(owner == pidx)[0]
        main_poly = _largest_poly(prov_geoms[pidx])
        rep = main_poly.representative_point()
        # Snap label/cell to closest cell owned by this province
        d2 = (centers_x[cells] - rep.x) ** 2 + (centers_y[cells] - rep.y) ** 2
        best_cell = int(cells[int(np.argmin(d2))])
        cx_p, cy_p = float(centers_x[best_cell]), float(centers_y[best_cell])
        lon_p, lat_p = tf_inv.transform(cx_p + x_left, y_top - cy_p)
        # Keep representative point for smooth visual label, cell for hex anchor
        lon_lbl, lat_lbl = tf_inv.transform(rep.x + x_left, y_top - rep.y)

        p_elev_mean = round(float(np.mean(elev_mean[cells])), 1)
        p_elev_max = int(np.max(elev_max[cells]))
        area_km2 = round(float(prov_geoms[pidx].area), 1)
        cov_pcts = {
            k: round(float(np.mean([pct_lists[k][c] for c in cells])), 3)
            for k in ("forest", "crop", "grass", "shrub", "wetland", "developed", "alpine")
        }

        world_states.append(
            {
                "idx": pidx,
                "code": p["code"],
                "name": p["name"],
                "short": p["short"],
                "abbr": p["abbr"],
                "region": p["region"],
                "capital": p["capital"],
                "x": round(float(rep.x), 2),
                "y": round(float(rep.y), 2),
                "lon": round(float(lon_lbl), 4),
                "lat": round(float(lat_lbl), 4),
                "cell": best_cell,
                "cell_count": int(len(cells)),
                "area_km2": area_km2,
            }
        )
        lookup_provinces.append(
            {
                "idx": pidx,
                "code": p["code"],
                "name": p["name"],
                "short": p["short"],
                "abbr": p["abbr"],
                "region": p["region"],
                "capital": p["capital"],
                "lon": round(float(lon_p), 4),
                "lat": round(float(lat_p), 4),
                "x": round(cx_p, 2),
                "y": round(cy_p, 2),
                "cell": best_cell,
                "area_km2": area_km2,
                "elev_mean": p_elev_mean,
                "elev_max": p_elev_max,
                "cover_pcts": cov_pcts,
                "cells": cells.tolist(),
            }
        )

    # Build 1,302 county metadata entries
    world_counties: list[dict[str, Any]] = []
    lookup_counties: list[dict[str, Any]] = []
    for rec in county_records:
        c_arr = np.array(rec["cells"], dtype=np.int32)
        main_c = _largest_poly(rec["geom"]).representative_point()
        d2 = (centers_x[c_arr] - main_c.x) ** 2 + (centers_y[c_arr] - main_c.y) ** 2
        best_c = int(c_arr[int(np.argmin(d2))])
        cx_c = float(np.mean(centers_x[c_arr]))
        cy_c = float(np.mean(centers_y[c_arr]))
        lon_c, lat_c = tf_inv.transform(cx_c + x_left, y_top - cy_c)

        c_elev_mean = round(float(np.mean(elev_mean[c_arr])), 1)
        c_elev_max = int(np.max(elev_max[c_arr]))
        cov_pcts = {
            k: round(float(np.mean([pct_lists[k][c] for c in c_arr])), 3)
            for k in ("forest", "crop", "grass", "shrub", "wetland", "developed", "alpine")
        }

        world_counties.append(
            {
                "idx": rec["idx"],
                "code": rec["code"],
                "name": rec["name"],
                "province_idx": rec["province_idx"],
                "x": round(cx_c, 2),
                "y": round(cy_c, 2),
                "lon": round(float(lon_c), 4),
                "lat": round(float(lat_c), 4),
                "cell": best_c,
                "area_km2": rec["area_km2"],
            }
        )
        lookup_counties.append(
            {
                "idx": rec["idx"],
                "code": rec["code"],
                "name": rec["name"],
                "province_idx": rec["province_idx"],
                "province_name": rec["province_name"],
                "prefecture": rec["prefecture"],
                "lon": round(float(lon_c), 4),
                "lat": round(float(lat_c), 4),
                "x": round(cx_c, 2),
                "y": round(cy_c, 2),
                "cell": best_c,
                "area_km2": rec["area_km2"],
                "elev_mean": c_elev_mean,
                "elev_max": c_elev_max,
                "cover_pcts": cov_pcts,
                "cells": rec["cells"],
            }
        )

    WORLD_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    world_obj = {
        "version": 1,
        "grid": grid,
        "cover_labels": COVER_LABELS,
        "states": world_states,
        "counties": world_counties,
        "owner": owner.tolist(),
        "county": county_arr.tolist(),
        "cover": cover.tolist(),
        "elev": elev_mean.tolist(),
        "elev_max": elev_max.tolist(),
        "relief": relief.tolist(),
        "pct": pct_lists,
        "rivers": rivers_out,
        "lakes": lakes_out,
        "scs_line": scs_line,
    }
    lookup_obj = {
        "version": 1,
        "grid": grid,
        "provinces": lookup_provinces,
        "counties": lookup_counties,
    }

    WORLD_JSON_PATH.write_text(json.dumps(world_obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    GEO_LOOKUP_PATH.write_text(json.dumps(lookup_obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    w_mb = WORLD_JSON_PATH.stat().st_size / (1024 * 1024)
    g_mb = GEO_LOOKUP_PATH.stat().st_size / (1024 * 1024)
    print(f"Done in {time.time() - t0:.2f}s! world.json={w_mb:.2f} MB, geo_lookup.json={g_mb:.2f} MB")


if __name__ == "__main__":
    main()
