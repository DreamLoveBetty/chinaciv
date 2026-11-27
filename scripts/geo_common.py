"""Shared China Albers projection, 25km pointy-top hex grid math, and 34-province constants."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from pyproj import Transformer

ROOT_DIR = Path(__file__).resolve().parent.parent
RAW_GEO_DIR = ROOT_DIR / "raw_data" / "geo"
WORLD_JSON_PATH = ROOT_DIR / "web" / "data" / "world.json"
GEO_LOOKUP_PATH = ROOT_DIR / "web" / "data" / "geo_lookup.json"

PROJ_STRING = (
    "+proj=aea +lat_1=25 +lat_2=47 +lat_0=35 +lon_0=105 "
    "+x_0=0 +y_0=0 +datum=WGS84 +units=km +no_defs"
)

SPACING_KM = 25.0
R_KM = SPACING_KM / math.sqrt(3.0)
H_STEP_KM = 1.5 * R_KM
MARGIN_KM = 200.0
HEX_AREA_KM2 = 0.5 * 3.0 * math.sqrt(3.0) * R_KM * R_KM  # ~541.265877 km^2

# Pointy-top even/odd-r 6 neighbors (d=0..5: E, SE, SW, W, NW, NE)
EVEN_NEIGHBORS = ((1, 0), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1))
ODD_NEIGHBORS = ((1, 0), (1, 1), (0, 1), (-1, 0), (0, -1), (1, -1))

# Canonical 34 provincial-level divisions ordered 0..33 by GB/T 2260 adcode
PROVINCE_ORDER: list[dict[str, Any]] = [
    {"idx": 0, "code": "110000", "name": "北京市", "short": "北京", "abbr": "京", "region": "华北", "capital": "北京市", "en": "Beijing"},
    {"idx": 1, "code": "120000", "name": "天津市", "short": "天津", "abbr": "津", "region": "华北", "capital": "天津市", "en": "Tianjin"},
    {"idx": 2, "code": "130000", "name": "河北省", "short": "河北", "abbr": "冀", "region": "华北", "capital": "石家庄市", "en": "Hebei"},
    {"idx": 3, "code": "140000", "name": "山西省", "short": "山西", "abbr": "晋", "region": "华北", "capital": "太原市", "en": "Shanxi"},
    {"idx": 4, "code": "150000", "name": "内蒙古自治区", "short": "内蒙古", "abbr": "蒙", "region": "华北", "capital": "呼和浩特市", "en": "Inner Mongolia"},
    {"idx": 5, "code": "210000", "name": "辽宁省", "short": "辽宁", "abbr": "辽", "region": "东北", "capital": "沈阳市", "en": "Liaoning"},
    {"idx": 6, "code": "220000", "name": "吉林省", "short": "吉林", "abbr": "吉", "region": "东北", "capital": "长春市", "en": "Jilin"},
    {"idx": 7, "code": "230000", "name": "黑龙江省", "short": "黑龙江", "abbr": "黑", "region": "东北", "capital": "哈尔滨市", "en": "Heilongjiang"},
    {"idx": 8, "code": "310000", "name": "上海市", "short": "上海", "abbr": "沪", "region": "华东", "capital": "上海市", "en": "Shanghai"},
    {"idx": 9, "code": "320000", "name": "江苏省", "short": "江苏", "abbr": "苏", "region": "华东", "capital": "南京市", "en": "Jiangsu"},
    {"idx": 10, "code": "330000", "name": "浙江省", "short": "浙江", "abbr": "浙", "region": "华东", "capital": "杭州市", "en": "Zhejiang"},
    {"idx": 11, "code": "340000", "name": "安徽省", "short": "安徽", "abbr": "皖", "region": "华东", "capital": "合肥市", "en": "Anhui"},
    {"idx": 12, "code": "350000", "name": "福建省", "short": "福建", "abbr": "闽", "region": "华东", "capital": "福州市", "en": "Fujian"},
    {"idx": 13, "code": "360000", "name": "江西省", "short": "江西", "abbr": "赣", "region": "华东", "capital": "南昌市", "en": "Jiangxi"},
    {"idx": 14, "code": "370000", "name": "山东省", "short": "山东", "abbr": "鲁", "region": "华东", "capital": "济南市", "en": "Shandong"},
    {"idx": 15, "code": "410000", "name": "河南省", "short": "河南", "abbr": "豫", "region": "华中", "capital": "郑州市", "en": "Henan"},
    {"idx": 16, "code": "420000", "name": "湖北省", "short": "湖北", "abbr": "鄂", "region": "华中", "capital": "武汉市", "en": "Hubei"},
    {"idx": 17, "code": "430000", "name": "湖南省", "short": "湖南", "abbr": "湘", "region": "华中", "capital": "长沙市", "en": "Hunan"},
    {"idx": 18, "code": "440000", "name": "广东省", "short": "广东", "abbr": "粤", "region": "华南", "capital": "广州市", "en": "Guangdong"},
    {"idx": 19, "code": "450000", "name": "广西壮族自治区", "short": "广西", "abbr": "桂", "region": "华南", "capital": "南宁市", "en": "Guangxi"},
    {"idx": 20, "code": "460000", "name": "海南省", "short": "海南", "abbr": "琼", "region": "华南", "capital": "海口市", "en": "Hainan"},
    {"idx": 21, "code": "500000", "name": "重庆市", "short": "重庆", "abbr": "渝", "region": "西南", "capital": "重庆市", "en": "Chongqing"},
    {"idx": 22, "code": "510000", "name": "四川省", "short": "四川", "abbr": "川", "region": "西南", "capital": "成都市", "en": "Sichuan"},
    {"idx": 23, "code": "520000", "name": "贵州省", "short": "贵州", "abbr": "贵", "region": "西南", "capital": "贵阳市", "en": "Guizhou"},
    {"idx": 24, "code": "530000", "name": "云南省", "short": "云南", "abbr": "云", "region": "西南", "capital": "昆明市", "en": "Yunnan"},
    {"idx": 25, "code": "540000", "name": "西藏自治区", "short": "西藏", "abbr": "藏", "region": "西南", "capital": "拉萨市", "en": "Tibet"},
    {"idx": 26, "code": "610000", "name": "陕西省", "short": "陕西", "abbr": "陕", "region": "西北", "capital": "西安市", "en": "Shaanxi"},
    {"idx": 27, "code": "620000", "name": "甘肃省", "short": "甘肃", "abbr": "甘", "region": "西北", "capital": "兰州市", "en": "Gansu"},
    {"idx": 28, "code": "630000", "name": "青海省", "short": "青海", "abbr": "青", "region": "西北", "capital": "西宁市", "en": "Qinghai"},
    {"idx": 29, "code": "640000", "name": "宁夏回族自治区", "short": "宁夏", "abbr": "宁", "region": "西北", "capital": "银川市", "en": "Ningxia"},
    {"idx": 30, "code": "650000", "name": "新疆维吾尔自治区", "short": "新疆", "abbr": "新", "region": "西北", "capital": "乌鲁木齐市", "en": "Xinjiang"},
    {"idx": 31, "code": "710000", "name": "台湾省", "short": "台湾", "abbr": "台", "region": "港澳台", "capital": "台北市", "en": "Taiwan"},
    {"idx": 32, "code": "810000", "name": "香港特别行政区", "short": "香港", "abbr": "港", "region": "港澳台", "capital": "香港", "en": "Hong Kong"},
    {"idx": 33, "code": "820000", "name": "澳门特别行政区", "short": "澳门", "abbr": "澳", "region": "港澳台", "capital": "澳门", "en": "Macau"},
]

PROVINCE_BY_CODE = {p["code"]: p for p in PROVINCE_ORDER}
PROVINCE_BY_NAME = {p["name"]: p for p in PROVINCE_ORDER}
PROVINCE_BY_SHORT = {p["short"]: p for p in PROVINCE_ORDER}

_FWD_TRANSFORMER = Transformer.from_crs("EPSG:4326", PROJ_STRING, always_xy=True)
_INV_TRANSFORMER = Transformer.from_crs(PROJ_STRING, "EPSG:4326", always_xy=True)
_GRID_CACHE: dict[str, Any] | None = None


def load_grid(force_reload: bool = False) -> dict[str, Any]:
    """Load and cache the frozen grid metadata from web/data/world.json."""
    global _GRID_CACHE
    if _GRID_CACHE is None or force_reload:
        with WORLD_JSON_PATH.open("r", encoding="utf-8") as f:
            world = json.load(f)
        _GRID_CACHE = world["grid"]
    return _GRID_CACHE


def aea_to_xy(x_aea: float, y_aea: float, grid: dict[str, Any] | None = None) -> tuple[float, float]:
    """Convert China Albers km coordinates (y north-up) to flipped grid km coordinates (top-left origin)."""
    g = grid or load_grid()
    return x_aea - g["x_left"], g["y_top"] - y_aea


def xy_to_aea(x: float, y: float, grid: dict[str, Any] | None = None) -> tuple[float, float]:
    """Convert flipped grid km coordinates back to China Albers km coordinates."""
    g = grid or load_grid()
    return x + g["x_left"], g["y_top"] - y


def lonlat_to_xy(lon: float, lat: float, grid: dict[str, Any] | None = None) -> tuple[float, float]:
    """Project WGS84 (lon, lat) degrees to flipped grid (x, y) km coordinates."""
    x_aea, y_aea = _FWD_TRANSFORMER.transform(lon, lat)
    return aea_to_xy(x_aea, y_aea, grid)


def xy_to_lonlat(x: float, y: float, grid: dict[str, Any] | None = None) -> tuple[float, float]:
    """Project flipped grid (x, y) km coordinates back to WGS84 (lon, lat) degrees."""
    x_aea, y_aea = xy_to_aea(x, y, grid)
    return _INV_TRANSFORMER.transform(x_aea, y_aea)


def cell_center(cell_idx: int, grid: dict[str, Any] | None = None) -> tuple[float, float]:
    """Return (cx, cy) km coordinates for a flat hex cell index."""
    g = grid or load_grid()
    cols = g["cols"]
    r, c = divmod(cell_idx, cols)
    w = g.get("W", SPACING_KM)
    h_step = g.get("H_step", H_STEP_KM)
    return (c + (r & 1) * 0.5) * w, r * h_step


def hex_corners(cx: float, cy: float, r_km: float = R_KM) -> list[tuple[float, float]]:
    """Return the 6 corner vertices of a pointy-top hex centered at (cx, cy)."""
    return [
        (cx + r_km * math.cos(math.pi / 6.0 + k * math.pi / 3.0),
         cy + r_km * math.sin(math.pi / 6.0 + k * math.pi / 3.0))
        for k in range(6)
    ]


def cell_neighbors(cell_idx: int, grid: dict[str, Any] | None = None) -> list[int]:
    """Return valid neighbor cell indices in (E, SE, SW, W, NW, NE) order (-1 if out of bounds)."""
    g = grid or load_grid()
    cols, rows = g["cols"], g["rows"]
    r, c = divmod(cell_idx, cols)
    offsets = ODD_NEIGHBORS if (r & 1) else EVEN_NEIGHBORS
    out: list[int] = []
    for dc, dr in offsets:
        nc, nr = c + dc, r + dr
        if 0 <= nc < cols and 0 <= nr < rows:
            out.append(nr * cols + nc)
        else:
            out.append(-1)
    return out


def xy_to_rc(x: float, y: float, grid: dict[str, Any] | None = None) -> tuple[int, int]:
    """Convert grid (x, y) km coordinates to nearest pointy-top odd-r (c, r) via O(1) cube rounding."""
    g = grid or load_grid()
    r_km = g.get("R", R_KM)
    w_km = g.get("W", SPACING_KM)

    r_frac = y / (1.5 * r_km)
    q_frac = (x / w_km) - 0.5 * r_frac
    s_frac = -q_frac - r_frac

    rq = round(q_frac)
    rr = round(r_frac)
    rs = round(s_frac)

    dq = abs(rq - q_frac)
    dr = abs(rr - r_frac)
    ds = abs(rs - s_frac)

    if dq > dr and dq > ds:
        rq = -rr - rs
    elif dr > ds:
        rr = -rq - rs

    col = int(rq + (rr - (rr & 1)) // 2)
    row = int(rr)
    return col, row


def xy_to_cell(x: float, y: float, grid: dict[str, Any] | None = None, clamp: bool = False) -> int:
    """Convert grid (x, y) km coordinates to flat cell index (or -1 if outside grid unless clamp=True)."""
    g = grid or load_grid()
    cols, rows = g["cols"], g["rows"]
    col, row = xy_to_rc(x, y, g)
    if clamp:
        col = max(0, min(cols - 1, col))
        row = max(0, min(rows - 1, row))
        return row * cols + col
    if 0 <= col < cols and 0 <= row < rows:
        return row * cols + col
    return -1


def lonlat_to_cell(lon: float, lat: float, grid: dict[str, Any] | None = None, clamp: bool = False) -> int:
    """Project WGS84 (lon, lat) directly to the nearest grid cell index."""
    g = grid or load_grid()
    x, y = lonlat_to_xy(lon, lat, g)
    return xy_to_cell(x, y, g, clamp=clamp)
