#!/usr/bin/env python3
"""Build web/data/{resources,infrastructure,military,wonders,trade}.json bound to ChinaCiv's 25km hex grid."""

from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from geo_common import (
    GEO_LOOKUP_PATH,
    PROVINCE_BY_CODE,
    PROVINCE_ORDER,
    ROOT_DIR,
    WORLD_JSON_PATH,
    cell_center,
    cell_neighbors,
    load_grid,
    lonlat_to_cell,
    lonlat_to_xy,
    xy_to_cell,
)

RAW_DIR = ROOT_DIR / "raw_data" / "infra"
OUT_DIR = ROOT_DIR / "web" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Spatial binding helpers (25km hex grid + 34 provinces)
# ---------------------------------------------------------------------------

class GeoBinder:
    def __init__(self) -> None:
        with WORLD_JSON_PATH.open("r", encoding="utf-8") as f:
            self.world = json.load(f)
        with GEO_LOOKUP_PATH.open("r", encoding="utf-8") as f:
            self.geo_lookup = json.load(f)
        self.grid = self.world["grid"]
        self.cols = self.grid["cols"]
        self.rows = self.grid["rows"]
        self.total_cells = self.cols * self.rows
        self.owner: list[int] = self.world["owner"]

        # Precompute province centers in km for fast nearest fallback
        self.prov_centers: list[tuple[int, float, float, int]] = []
        provs = self.geo_lookup.get("provinces") or self.world.get("states") or []
        for idx, p in enumerate(provs):
            cells = p.get("cells") or []
            c0 = cells[0] if cells else int(p.get("cell", 0))
            if "x" in p and "y" in p:
                px, py = float(p["x"]), float(p["y"])
            else:
                px, py = cell_center(c0, self.grid)
            self.prov_centers.append((idx, px, py, c0))

        # Index all China land cells by province for nearest-land lookup
        self.land_cells_coords: list[tuple[int, int, float, float]] = []
        for cid, ov in enumerate(self.owner):
            if 0 <= ov < 34:
                cx, cy = cell_center(cid, self.grid)
                self.land_cells_coords.append((cid, ov, cx, cy))

    def bind_lonlat(self, lon: float, lat: float, force_province_idx: int | None = None) -> dict[str, Any]:
        x, y = lonlat_to_xy(lon, lat, self.grid)
        cell = xy_to_cell(x, y, self.grid, clamp=True)
        prov_idx = force_province_idx
        if prov_idx is None:
            ov = self.owner[cell]
            if 0 <= ov < 34:
                prov_idx = ov
            else:
                # Search immediate hex neighborhood first (coastal/island sites)
                best_ov = -1
                for nb in cell_neighbors(cell, self.grid):
                    if nb >= 0 and 0 <= self.owner[nb] < 34:
                        best_ov = self.owner[nb]
                        break
                if best_ov >= 0:
                    prov_idx = best_ov
                else:
                    # Nearest China land cell in km
                    best_d2 = float("inf")
                    best_p = 0
                    for _, ov2, lx, ly in self.land_cells_coords:
                        d2 = (lx - x) ** 2 + (ly - y) ** 2
                        if d2 < best_d2:
                            best_d2 = d2
                            best_p = ov2
                    prov_idx = best_p
        return {
            "x": round(x, 1),
            "y": round(y, 1),
            "cell": int(cell),
            "lon": round(lon, 4),
            "lat": round(lat, 4),
            "province_idx": int(prov_idx),
            "province": PROVINCE_ORDER[prov_idx]["name"],
        }

    def is_china_xy(self, x: float, y: float, allow_buffer: bool = True) -> bool:
        c = xy_to_cell(x, y, self.grid, clamp=False)
        if c < 0:
            return False
        if 0 <= self.owner[c] < 34:
            return True
        if allow_buffer:
            for nb in cell_neighbors(c, self.grid):
                if nb >= 0 and 0 <= self.owner[nb] < 34:
                    return True
        return False


def _simplify_xy(pts: list[tuple[float, float]], min_dist_km: float = 12.0) -> list[list[float]]:
    if len(pts) <= 2:
        return [[round(p[0], 1), round(p[1], 1)] for p in pts]
    out = [pts[0]]
    d2_min = min_dist_km * min_dist_km
    for p in pts[1:-1]:
        lx, ly = out[-1]
        if (p[0] - lx) ** 2 + (p[1] - ly) ** 2 >= d2_min:
            out.append(p)
    out.append(pts[-1])
    return [[round(p[0], 1), round(p[1], 1)] for p in out]


# ---------------------------------------------------------------------------
# 1. RESOURCES: WRI Power Plants + Verified Recent Plants + CGS/USGS Mines
# ---------------------------------------------------------------------------

RESOURCE_TYPES = [
    {"id": "nuclear", "name": "核电站", "category": "energy", "emoji": "☢️", "icon": "r-nuclear", "color": "#e8d44d", "unit": "MW", "description": "在运及并网商业核电基地（含华龙一号、EPR、CAP1000、高温气冷堆），数据来自 WRI GPPD v1.3 与 2024–2025 核能行业公报核验。"},
    {"id": "hydro", "name": "大型水电站", "category": "energy", "emoji": "💧", "icon": "r-hydro", "color": "#3fa7d6", "unit": "MW", "description": "大型常规水电枢纽（三峡、白鹤滩、溪洛渡、乌东德、向家坝等），数据来自 WRI GPPD 与水利部/能源局公开装机。"},
    {"id": "coal_plant", "name": "火电基地", "category": "energy", "emoji": "🔥", "icon": "r-coal_plant", "color": "#d96b38", "unit": "MW", "description": "大型燃煤及燃气热电联产核心基地（坑口电站与负荷中心大机组），空间抽样自 WRI GPPD 全部 1,100+ 座火电机组。"},
    {"id": "wind", "name": "风电基地", "category": "energy", "emoji": "🌬️", "icon": "r-wind", "color": "#6cd4b8", "unit": "MW", "description": "陆上千万千瓦级风电基地（酒泉、蒙西、蒙东、哈密、张北）与海上风电集群（如东、阳江、福清、彰滨）。"},
    {"id": "solar", "name": "光伏基地", "category": "energy", "emoji": "☀️", "icon": "r-solar", "color": "#f6be3b", "unit": "MW", "description": "沙戈荒大型光伏基地与分布式光伏集群（青海塔拉滩、库布齐、腾格里、准东、大同等）。"},
    {"id": "pumped_storage", "name": "抽水蓄能", "category": "energy", "emoji": "🔋", "icon": "r-pumped_storage", "color": "#4dc7e8", "unit": "MW", "description": "电网调峰储能核心抽水蓄能电站（丰宁、惠州、广蓄、长龙山、天荒坪、绩溪、仙居等）。"},
    {"id": "coal_mine", "name": "煤矿", "category": "mineral", "emoji": "⛏️", "icon": "r-coal_mine", "color": "#5b534c", "unit": "万吨/年", "description": "大型亿吨级/千万吨级煤炭生产基地与露天煤矿（神东、准格尔、平朔、准东、大同、淮南、六盘水等）。"},
    {"id": "oil", "name": "油田", "category": "mineral", "emoji": "🛢️", "icon": "r-oil", "color": "#383e47", "unit": "万吨/年", "description": "主力陆上与海上油田（大庆、长庆、渤海、胜利、塔里木、玛湖、南海东部/西部等）。"},
    {"id": "gas", "name": "气田", "category": "mineral", "emoji": "🔵", "icon": "r-gas", "color": "#4f8df5", "unit": "亿方/年", "description": "常规天然气及页岩气主力气田（苏里格、安岳、普光、涪陵、克拉2、深海一号等）。"},
    {"id": "rare_earths", "name": "稀土矿", "category": "mineral", "emoji": "✨", "icon": "r-rare_earths", "color": "#c57ce6", "unit": "万吨REO", "description": "轻稀土与南方离子吸附型中重稀土重要矿区（白云鄂博、凉山牦牛坪、赣州龙南/寻乌等，CGS/USGS 矿床资料）。"},
    {"id": "iron", "name": "铁矿", "category": "mineral", "emoji": "⛓️", "icon": "r-iron", "color": "#9b5534", "unit": "亿吨储量", "description": "鞍本型、钒钛磁铁矿及沉积变质型大型铁矿基地（鞍山、本溪、冀东、攀枝花、白云鄂博、马鞍山、西昌等）。"},
    {"id": "copper", "name": "铜矿", "category": "mineral", "emoji": "🥉", "icon": "r-copper", "color": "#c87a43", "unit": "万吨储量", "description": "斑岩型及矽卡岩型大型铜矿基地（德兴、驱龙、甲玛、玉龙、普朗、多宝山、铜陵、紫金山等）。"},
    {"id": "gold", "name": "金矿", "category": "mineral", "emoji": "🥇", "icon": "r-gold", "color": "#e5be45", "unit": "吨储量", "description": "胶东型、卡林型及浅成低温热液大型金矿床（焦家、三山岛、西岭、紫金山、阳山、水银洞等）。"},
    {"id": "lithium", "name": "锂矿", "category": "mineral", "emoji": "⚡", "icon": "r-lithium", "color": "#9ce672", "unit": "万吨LCE", "description": "盐湖卤水与硬岩锂辉石/锂云母资源基地（察尔汗、扎布耶、甲基卡、可尔因、宜春、大红柳滩等）。"},
    {"id": "tungsten", "name": "钨锡矿", "category": "mineral", "emoji": "🪨", "icon": "r-tungsten", "color": "#8093a6", "unit": "万吨储量", "description": "南岭及滇桂战略优势钨锡锑多金属矿区（赣州西华山、朱溪、大湖塘、柿竹园、个旧、大厂等）。"},
    {"id": "bauxite", "name": "铝土矿", "category": "mineral", "emoji": "🧱", "icon": "r-bauxite", "color": "#c96a53", "unit": "亿吨储量", "description": "喀斯特及沉积型大型铝土矿资源带（平果、孝义、三门峡、修文、务正道等）。"},
]

# Known pumped storage matches inside WRI + verified recent 2021-2025 supplements/overrides
PUMPED_STORAGE_WRI_KEYWORDS = (
    "pumped", "tianhuangping", "guangzhou", "huizhou", "zhanghewan", "xilongchi",
    "baoquan", "pushihe", "tongbai", "heimifeng", "xiangshuijian", "bailianhe",
    "hongping", "qingyuan", "xianju", "liyang", "jixi", "daguan", "mingtan",
    "tai'an", "taian pumped", "panlong", "dunhua", "huanggou", "yixing",
)

# Verified major recent plants / corrected capacities (2021-2025)
VERIFIED_PLANT_OVERRIDES: list[dict[str, Any]] = [
    # Nuclear (dedup/update WRI + newly commissioned 2021-2025)
    {"match_wri": "Fuqing", "type": "nuclear", "name": "福清核电站 (Fuqing · 华龙一号首堆)", "mw": 6660.0, "lon": 119.4440, "lat": 25.4426, "prov": 12, "note": "6台机组含华龙一号全球首堆5/6号机组，总装机 6,660 MW (CNEA 2024)"},
    {"match_wri": "Fangchenggang", "type": "nuclear", "name": "防城港核电站 (Fangchenggang · 华龙一号)", "mw": 4360.0, "lon": 108.5600, "lat": 21.6700, "prov": 19, "note": "4台机组（1-2号CPR1000 + 3-4号华龙一号），总装机 4,360 MW (CNEA 2024)"},
    {"match_wri": "Taishan", "type": "nuclear", "name": "台山核电站 (Taishan · EPR)", "mw": 3500.0, "lon": 112.9820, "lat": 21.9180, "prov": 18, "note": "2台全球单机最大EPR三代机组，3,500 MW (CNEA 2024)"},
    {"match_wri": "Sanmen", "type": "nuclear", "name": "三门核电站 (Sanmen · AP1000)", "mw": 2500.0, "lon": 121.6400, "lat": 29.1010, "prov": 10, "note": "AP1000全球首堆基地，2,500 MW"},
    {"match_wri": "Haiyang", "type": "nuclear", "name": "海阳核电站 (Haiyang · AP1000)", "mw": 2500.0, "lon": 121.3810, "lat": 36.7090, "prov": 14, "note": "2台AP1000兼供胶东核能供暖，2,500 MW"},
    {"match_wri": "Tianwan", "type": "nuclear", "name": "田湾核电站 (Tianwan)", "mw": 6570.0, "lon": 119.4600, "lat": 34.6870, "prov": 9, "note": "6台在运百万千瓦机组，6,570 MW"},
    {"match_wri": "Hongyanhe", "type": "nuclear", "name": "红沿河核电站 (Hongyanhe)", "mw": 6710.0, "lon": 121.4800, "lat": 39.8000, "prov": 5, "note": "东北首座核电站6台机组全部投运，6,710 MW"},
    {"match_wri": "Yangjiang", "type": "nuclear", "name": "阳江核电站 (Yangjiang)", "mw": 6516.0, "lon": 112.2600, "lat": 21.7100, "prov": 18, "note": "6台百万千瓦级机组，6,516 MW"},
    {"match_wri": None, "type": "nuclear", "name": "石岛湾高温气冷堆核电站 (Shidaowan HTR-PM)", "mw": 210.0, "lon": 122.5250, "lat": 36.9710, "prov": 14, "note": "全球首座四代商业高温气冷堆示范工程，2023年底商运 (CNEA)"},
    {"match_wri": None, "type": "nuclear", "name": "漳州核电站 (Zhangzhou · 华龙一号)", "mw": 1212.0, "lon": 117.4930, "lat": 23.8290, "prov": 12, "note": "华龙一号批量化建设首台1号机组2024年底商运 (CNEA)"},
    {"match_wri": None, "type": "nuclear", "name": "昌江核电站 (Changjiang)", "mw": 1300.0, "lon": 108.9020, "lat": 19.4600, "prov": 20, "note": "海南昌江核电基地（含玲龙一号小堆示范），1,300 MW"},

    # Hydro (2021-2025 commissioned giants missing or partial in WRI v1.3)
    {"match_wri": "Baihetan Dam", "type": "hydro", "name": "白鹤滩水电站 (Baihetan)", "mw": 16000.0, "lon": 102.9040, "lat": 27.2240, "prov": 22, "note": "世界单机容量最大（16×1000MW）金沙江梯级水电站，2022全面投产，16,000 MW (三峡集团)"},
    {"match_wri": None, "type": "hydro", "name": "乌东德水电站 (Wudongde)", "mw": 10200.0, "lon": 102.6330, "lat": 26.3340, "prov": 24, "note": "金沙江下游四大梯级最上游电站（12×850MW），2021全面投产，10,200 MW (三峡集团)"},
    {"match_wri": None, "type": "hydro", "name": "两河口水电站 (Lianghekou)", "mw": 3000.0, "lon": 101.0070, "lat": 30.1630, "prov": 22, "note": "雅砻江中游龙头水库电站，3,000 MW (2022全容量投产)"},
    {"match_wri": None, "type": "hydro", "name": "杨房沟水电站 (Yangfanggou)", "mw": 1500.0, "lon": 101.2020, "lat": 28.6450, "prov": 22, "note": "雅砻江中游1,500 MW水电站 (2021投产)"},
    {"match_wri": None, "type": "hydro", "name": "大藤峡水利枢纽 (Datengxia)", "mw": 1600.0, "lon": 109.9610, "lat": 23.4700, "prov": 19, "note": "珠江流域关键控制性枢纽，1,600 MW (2023全面投产)"},
    {"match_wri": None, "type": "hydro", "name": "藏木-加查雅江梯级水电 (Zangmu-Jiacha)", "mw": 870.0, "lon": 92.5170, "lat": 29.1900, "prov": 25, "note": "西藏雅鲁藏布江干流已投产骨干水电站集群，870 MW"},

    # Pumped storage mega stations
    {"match_wri": None, "type": "pumped_storage", "name": "丰宁抽水蓄能电站 (Fengning)", "mw": 3600.0, "lon": 116.4790, "lat": 41.6810, "prov": 2, "note": "目前世界装机规模最大抽水蓄能电站，3,600 MW (国网新源 2024)"},
    {"match_wri": None, "type": "pumped_storage", "name": "长龙山抽水蓄能电站 (Changlongshan)", "mw": 2100.0, "lon": 119.6200, "lat": 30.4830, "prov": 10, "note": "华东高水头大库容抽水蓄能基地，2,100 MW (2022全面投产)"},
    {"match_wri": None, "type": "pumped_storage", "name": "文登抽水蓄能电站 (Wendeng)", "mw": 1800.0, "lon": 122.0200, "lat": 37.3100, "prov": 14, "note": "胶东核电/风电调峰抽蓄电站，1,800 MW (2023投产)"},
    {"match_wri": None, "type": "pumped_storage", "name": "阳江抽水蓄能电站 (Yangjiang PS)", "mw": 1200.0, "lon": 111.7800, "lat": 21.8900, "prov": 18, "note": "单机400MW高水头抽蓄电站，1,200 MW (南网储能)"},
    {"match_wri": None, "type": "pumped_storage", "name": "梅州抽水蓄能电站 (Meizhou PS)", "mw": 1200.0, "lon": 115.6500, "lat": 24.0800, "prov": 18, "note": "粤东抽水蓄能基地一期，1,200 MW"},
    {"match_wri": None, "type": "pumped_storage", "name": "阜康抽水蓄能电站 (Fukang PS)", "mw": 1200.0, "lon": 88.2400, "lat": 43.9500, "prov": 30, "note": "新疆首座投产抽水蓄能电站，1,200 MW (2024)"},
    {"match_wri": None, "type": "pumped_storage", "name": "荒沟抽水蓄能电站 (Huanggou PS)", "mw": 1200.0, "lon": 129.9300, "lat": 44.3900, "prov": 7, "note": "高寒地区首座大型抽水蓄能电站，1,200 MW (2022)"},

    # Mega Wind & Solar desert/offshore bases
    {"match_wri": None, "type": "solar", "name": "青海海南州塔拉滩光伏基地 (Talatan)", "mw": 12000.0, "lon": 100.5600, "lat": 36.1200, "prov": 28, "note": "全球连片规模最大沙戈荒光伏园区，装机超12 GW (NEA 2024)"},
    {"match_wri": None, "type": "solar", "name": "库布齐沙漠鄂尔多斯新能源光伏基地 (Kubuqi)", "mw": 8000.0, "lon": 109.1200, "lat": 40.3500, "prov": 4, "note": "沙漠生态治理+外送大基地标杆，规划与并网超8 GW"},
    {"match_wri": None, "type": "solar", "name": "腾格里沙漠中卫光伏基地 (Tengger)", "mw": 3000.0, "lon": 105.0100, "lat": 37.5500, "prov": 29, "note": "国家第一批沙戈荒外送基地中卫3 GW并网项目 (2023)"},
    {"match_wri": None, "type": "solar", "name": "格尔木乌图美仁光伏基地 (Golmud Solar)", "mw": 4500.0, "lon": 94.3600, "lat": 36.4400, "prov": 28, "note": "柴达木盆地特高压外送光伏基地，4.5 GW"},
    {"match_wri": None, "type": "solar", "name": "准东沙戈荒大型风光基地 (Zhundong Solar)", "mw": 5000.0, "lon": 89.2500, "lat": 44.6200, "prov": 30, "note": "吉泉特高压配套光伏基地，5.0 GW"},
    {"match_wri": None, "type": "wind", "name": "酒泉瓜州-玉门千万千瓦级风电基地 (Jiuquan Wind)", "mw": 10000.0, "lon": 96.1500, "lat": 40.5300, "prov": 27, "note": "中国首个千万千瓦级风电基地集群，逾10 GW (NEA)"},
    {"match_wri": None, "type": "wind", "name": "乌兰察布陆上大基地风电 (Ulanqab Wind)", "mw": 6000.0, "lon": 112.9500, "lat": 41.3200, "prov": 4, "note": "国家大型风电外送基地核心区，6.0 GW"},
    {"match_wri": None, "type": "wind", "name": "江苏如东海上风电集群 (Rudong Offshore)", "mw": 4800.0, "lon": 121.4500, "lat": 32.5500, "prov": 9, "note": "亚洲最大海上风电群（含柔性直流送出），4.8 GW"},
    {"match_wri": None, "type": "wind", "name": "广东阳江沙扒海上风电基地 (Yangjiang Offshore)", "mw": 3000.0, "lon": 111.5800, "lat": 21.3800, "prov": 18, "note": "粤西千万千瓦级海上风电先行基地，3.0 GW"},
    {"match_wri": None, "type": "wind", "name": "福建兴化湾海上风电集群 (Xinghua Bay Offshore)", "mw": 1200.0, "lon": 119.4100, "lat": 25.4300, "prov": 12, "note": "海峡风口大兆瓦海上风电机组示范基地，1.2 GW"},
    {"match_wri": None, "type": "wind", "name": "台湾彰化离岸风电场群 (Changhua Offshore)", "mw": 2400.0, "lon": 120.2200, "lat": 24.0600, "prov": 31, "note": "台湾海峡离岸风电主力风场集群，2.4 GW"},
]

# Real Major Chinese Mines & Oil/Gas Fields (CGS / USGS MCS / CNPC / Sinopec / CNOOC / Minmetals)
MINERAL_CATALOG: list[dict[str, Any]] = [
    # coal_mine (unit: 万吨/年产能)
    {"type": "coal_mine", "name": "神东矿区 (神府-东胜)", "lon": 110.18, "lat": 39.29, "prov": 26, "value": 20000, "detail": "国家亿吨级煤炭基地，年产约2亿吨（陕北神木-蒙南鄂尔多斯）"},
    {"type": "coal_mine", "name": "准格尔黑岱沟露天煤矿", "lon": 111.27, "lat": 39.77, "prov": 4, "value": 3400, "detail": "特大型露天煤矿，年产3,400万吨（内蒙古鄂尔多斯）"},
    {"type": "coal_mine", "name": "哈尔乌素露天煤矿", "lon": 111.21, "lat": 39.73, "prov": 4, "value": 3500, "detail": "年产3,500万吨超大型露天煤矿（准格尔煤田）"},
    {"type": "coal_mine", "name": "平朔安太堡-安家岭露天矿", "lon": 112.35, "lat": 39.46, "prov": 3, "value": 6500, "detail": "晋北煤炭基地核心露天矿群，年产逾6,500万吨（山西朔州）"},
    {"type": "coal_mine", "name": "大同塔山煤矿", "lon": 113.06, "lat": 39.92, "prov": 3, "value": 2500, "detail": "千万吨级特厚煤层综放矿井，年产2,500万吨（山西大同）"},
    {"type": "coal_mine", "name": "准东五彩湾一号露天矿", "lon": 89.11, "lat": 44.78, "prov": 30, "value": 5000, "detail": "新疆疆煤外运核心矿区，整装煤田储量3,900亿吨（昌吉吉木萨尔）"},
    {"type": "coal_mine", "name": "红沙泉露天煤矿 (准东)", "lon": 90.08, "lat": 44.58, "prov": 30, "value": 3000, "detail": "准东大型千万吨级露天煤矿（新疆奇台）"},
    {"type": "coal_mine", "name": "伊敏河露天煤矿", "lon": 119.77, "lat": 48.59, "prov": 4, "value": 3500, "detail": "蒙东煤电一体化示范基地（内蒙古呼伦贝尔鄂温克）"},
    {"type": "coal_mine", "name": "宝日希勒露天煤矿", "lon": 119.73, "lat": 49.42, "prov": 4, "value": 3500, "detail": "高寒地区无人驾驶示范露天矿（呼伦贝尔陈巴尔虎旗）"},
    {"type": "coal_mine", "name": "胜利一号露天煤矿 (锡林浩特)", "lon": 115.96, "lat": 43.99, "prov": 4, "value": 2800, "detail": "锡林郭勒大型褐煤露天矿（内蒙古）"},
    {"type": "coal_mine", "name": "霍林河露天煤矿", "lon": 119.64, "lat": 45.52, "prov": 4, "value": 3800, "detail": "中国五大露天煤矿之一，煤电铝集群核心（通辽霍林郭勒）"},
    {"type": "coal_mine", "name": "哈密淖毛湖-三塘湖煤田", "lon": 94.96, "lat": 43.76, "prov": 30, "value": 4200, "detail": "东疆疆煤东运重要露天煤炭基地（新疆伊吾）"},
    {"type": "coal_mine", "name": "宁东羊场湾-枣泉矿区", "lon": 106.59, "lat": 38.07, "prov": 29, "value": 4500, "detail": "宁东亿吨级煤炭及煤化工基地核心矿区（银川灵武）"},
    {"type": "coal_mine", "name": "彬长矿区 (大佛寺-胡家河)", "lon": 107.98, "lat": 35.06, "prov": 26, "value": 3800, "detail": "黄陇煤炭基地主力矿区（陕西咸阳彬州）"},
    {"type": "coal_mine", "name": "开滦矿区 (唐山)", "lon": 118.21, "lat": 39.63, "prov": 2, "value": 2800, "detail": "华北炼焦煤重要生产基地（河北唐山）"},
    {"type": "coal_mine", "name": "兖州兴隆庄-东滩矿区", "lon": 116.84, "lat": 35.51, "prov": 14, "value": 3200, "detail": "鲁西大型动力煤及气肥煤基地（山东济宁）"},
    {"type": "coal_mine", "name": "淮南潘集-顾桥矿区", "lon": 116.72, "lat": 32.78, "prov": 11, "value": 4800, "detail": "两淮亿吨级煤炭基地，华东主要坑口电源（安徽淮南）"},
    {"type": "coal_mine", "name": "平顶山煤炭基地", "lon": 113.28, "lat": 33.76, "prov": 15, "value": 3000, "detail": "河南核心焦煤与动力煤基地（平顶山）"},
    {"type": "coal_mine", "name": "六盘水盘江矿区", "lon": 104.58, "lat": 25.81, "prov": 23, "value": 4000, "detail": "“江南煤海”云贵基地主力焦煤产区（贵州六盘水盘州）"},
    {"type": "coal_mine", "name": "七台河-双鸭山煤炭基地", "lon": 131.01, "lat": 45.77, "prov": 7, "value": 2200, "detail": "东北重要主焦煤与动力煤产区（黑龙江）"},

    # oil (unit: 万吨/年油气当量或原油)
    {"type": "oil", "name": "大庆油田 (Daqing)", "lon": 125.03, "lat": 46.59, "prov": 7, "value": 3000, "detail": "中国第一大老油田稳产3,000万吨油气当量（黑龙江大庆）"},
    {"type": "oil", "name": "长庆油田 (庆城页岩油/鄂尔多斯)", "lon": 107.88, "lat": 36.02, "prov": 27, "value": 2600, "detail": "全国第一大油气田，原油年产超2,600万吨（陕甘宁盆地）"},
    {"type": "oil", "name": "渤海油田 (蓬莱19-3 / 渤中)", "lon": 119.95, "lat": 38.38, "prov": 1, "value": 3600, "detail": "中国第一大海上原油生产基地，年产油气当量超3,600万吨（CNOOC）"},
    {"type": "oil", "name": "胜利油田 (东营)", "lon": 118.67, "lat": 37.43, "prov": 14, "value": 2340, "detail": "中国石化第一大主力油田（山东东营黄河三角洲）"},
    {"type": "oil", "name": "塔里木油田 (富满超深油区)", "lon": 83.25, "lat": 40.65, "prov": 30, "value": 750, "detail": "8,000米级超深断控油藏主力产区（新疆库尔勒-沙雅）"},
    {"type": "oil", "name": "克拉玛依-玛湖油田 (新疆)", "lon": 85.15, "lat": 45.62, "prov": 30, "value": 1480, "detail": "准噶尔盆地十亿吨级玛湖砾岩大油区（新疆克拉玛依）"},
    {"type": "oil", "name": "吉木萨尔国家级陆相页岩油区", "lon": 89.18, "lat": 44.08, "prov": 30, "value": 150, "detail": "准噶尔盆地页岩油开发示范区（新疆昌吉）"},
    {"type": "oil", "name": "辽河油田 (盘锦)", "lon": 122.07, "lat": 41.12, "prov": 5, "value": 1000, "detail": "中国重要稠油及天然气生产基地（辽宁盘锦）"},
    {"type": "oil", "name": "大港油田 (滨海新区)", "lon": 117.48, "lat": 38.72, "prov": 1, "value": 420, "detail": "渤海湾盆地京津冀油气保供基地（天津滨海）"},
    {"type": "oil", "name": "冀东南堡油田", "lon": 118.42, "lat": 39.06, "prov": 2, "value": 350, "detail": "渤海湾北岸滩海主力油田（河北唐山曹妃甸）"},
    {"type": "oil", "name": "延长油田 (延安)", "lon": 109.48, "lat": 36.58, "prov": 26, "value": 1150, "detail": "中国陆上最早油田，千万吨级稳定产区（陕西延安）"},
    {"type": "oil", "name": "吉林油田 (松原)", "lon": 124.82, "lat": 45.14, "prov": 6, "value": 450, "detail": "松辽盆地南部主力油田与CCUS示范区（吉林松原）"},
    {"type": "oil", "name": "南海东部油田群 (流花/惠州)", "lon": 115.65, "lat": 20.95, "prov": 18, "value": 2000, "detail": "珠江口盆地深水及陆架主力油田群（年产2,000万吨当量，CNOOC）"},
    {"type": "oil", "name": "南海西部涠洲油田群", "lon": 108.92, "lat": 20.85, "prov": 19, "value": 1100, "detail": "北部湾及琼东南油田主力产区（CNOOC）"},
    {"type": "oil", "name": "青海油田 (花土沟/冷湖)", "lon": 90.85, "lat": 38.25, "prov": 28, "value": 720, "detail": "世界海拔最高油田之一，柴达木盆地油气中心（青海海西）"},

    # gas (unit: 亿立方米/年)
    {"type": "gas", "name": "苏里格气田 (鄂尔多斯)", "lon": 108.62, "lat": 38.92, "prov": 4, "value": 300, "detail": "中国陆上单体储量最大致密气田，年产超300亿方（长庆油田）"},
    {"type": "gas", "name": "安岳气田 (磨溪-龙王庙)", "lon": 105.33, "lat": 30.11, "prov": 22, "value": 150, "detail": "四川盆地万亿方级碳酸盐岩特大型气田（资阳-遂宁）"},
    {"type": "gas", "name": "涪陵页岩气田 (焦石坝)", "lon": 107.52, "lat": 29.71, "prov": 21, "value": 72, "detail": "中国首个投入商业开发的大型页岩气田（重庆涪陵）"},
    {"type": "gas", "name": "长宁-威远国家级页岩气区", "lon": 104.92, "lat": 28.58, "prov": 22, "value": 125, "detail": "川南深层及中浅层页岩气核心产区（宜宾-内江）"},
    {"type": "gas", "name": "普光气田 (达州)", "lon": 107.76, "lat": 31.42, "prov": 22, "value": 95, "detail": "川气东送工程核心气源，特大型高含硫气田（四川达州）"},
    {"type": "gas", "name": "元坝气田 (广元)", "lon": 106.08, "lat": 31.78, "prov": 22, "value": 42, "detail": "全球首个超深生物礁高含硫大气田（四川苍溪）"},
    {"type": "gas", "name": "克拉2-克深大气田 (库车)", "lon": 83.48, "lat": 41.96, "prov": 30, "value": 180, "detail": "西气东输第一大主力气源地（新疆阿克苏库车）"},
    {"type": "gas", "name": "博孜-大北超深气区", "lon": 81.92, "lat": 41.78, "prov": 30, "value": 90, "detail": "塔里木盆地天山南麓万亿方级超深凝析气区（新疆拜城）"},
    {"type": "gas", "name": "靖边气田 (陕北)", "lon": 108.81, "lat": 37.59, "prov": 26, "value": 65, "detail": "鄂尔多斯盆地西气东输及京津供气骨干气田（陕西榆林）"},
    {"type": "gas", "name": "涩北气田 (柴达木)", "lon": 94.96, "lat": 37.38, "prov": 28, "value": 58, "detail": "中国海拔最高整装第四系生物成因大气田（青海格尔木）"},
    {"type": "gas", "name": "深海一号大气田 (陵水17-2)", "lon": 110.35, "lat": 17.52, "prov": 20, "value": 45, "detail": "中国首个1,500米超深水自营大气田（海南陵水东南海域）"},
    {"type": "gas", "name": "松辽庆深气田 (大庆深层)", "lon": 125.32, "lat": 46.12, "prov": 7, "value": 55, "detail": "东北地区最大深层火山岩天然气田（黑龙江）"},
    {"type": "gas", "name": "东海平湖-春晓油气田", "lon": 124.85, "lat": 29.85, "prov": 10, "value": 30, "detail": "东海陆架盆地西湖凹陷向沪浙供气主力海上气田"},

    # rare_earths (unit: 万吨REO储量)
    {"type": "rare_earths", "name": "白云鄂博稀土-铁-铌矿", "lon": 109.97, "lat": 41.79, "prov": 4, "value": 3500, "detail": "世界第一大轻稀土矿床（REO储量约3,500万吨，包钢/北方稀土，CGS/USGS）"},
    {"type": "rare_earths", "name": "凉山冕宁牦牛坪稀土矿", "lon": 102.04, "lat": 28.43, "prov": 22, "value": 310, "detail": "中国第二大轻稀土基地（四川凉山冕宁）"},
    {"type": "rare_earths", "name": "凉山德昌大陆槽稀土矿", "lon": 102.18, "lat": 27.32, "prov": 22, "value": 120, "detail": "攀西裂谷带高品位氟碳铈矿（四川德昌）"},
    {"type": "rare_earths", "name": "赣州龙南离子吸附型重稀土矿", "lon": 114.79, "lat": 24.91, "prov": 13, "value": 180, "detail": "“稀土王国”核心中重稀土富集区（江西赣州龙南）"},
    {"type": "rare_earths", "name": "赣州寻乌-定南稀土矿区", "lon": 115.64, "lat": 24.95, "prov": 13, "value": 150, "detail": "南方风化壳离子型稀土主力矿山（江西赣州）"},
    {"type": "rare_earths", "name": "山东微山湖稀土矿", "lon": 117.13, "lat": 34.81, "prov": 14, "value": 160, "detail": "华东重要岩浆碳酸岩型轻稀土矿（山东济宁微山）"},
    {"type": "rare_earths", "name": "福建长汀离子型稀土矿", "lon": 116.36, "lat": 25.83, "prov": 12, "value": 85, "detail": "武夷山南麓中重稀土重要开采基地（福建龙岩）"},
    {"type": "rare_earths", "name": "广西崇左-玉林稀土矿", "lon": 107.36, "lat": 22.41, "prov": 19, "value": 95, "detail": "桂西南风化壳离子型中重稀土矿区（广西）"},
    {"type": "rare_earths", "name": "湖南江华离子型稀土矿", "lon": 111.58, "lat": 25.18, "prov": 17, "value": 75, "detail": "湘南战略中重稀土资源基地（湖南永州）"},
    {"type": "rare_earths", "name": "云南临沧-红河离子型稀土", "lon": 100.09, "lat": 23.88, "prov": 24, "value": 110, "detail": "滇西重要中重稀土矿带（云南）"},

    # iron (unit: 亿吨矿石储量)
    {"type": "iron", "name": "鞍山齐大山-大孤山铁矿", "lon": 123.09, "lat": 41.09, "prov": 5, "value": 45, "detail": "鞍本BIF型铁矿群核心，中国最大钢铁原料矿区（辽宁鞍山）"},
    {"type": "iron", "name": "本溪南芬-思山岭铁矿", "lon": 123.75, "lat": 41.10, "prov": 5, "value": 38, "detail": "含思山岭超大型深部富铁矿（24.8亿吨级，辽宁本溪）"},
    {"type": "iron", "name": "冀东司家营-水厂铁矿", "lon": 118.74, "lat": 39.74, "prov": 2, "value": 32, "detail": "华北最大BIF磁铁矿基地（河北唐山滦州-迁安）"},
    {"type": "iron", "name": "攀枝花钒钛磁铁矿 (红格/白马)", "lon": 101.76, "lat": 26.62, "prov": 22, "value": 48, "detail": "世界级钒钛磁铁矿共生矿床，伴生全国绝大部分钛与钒资源（四川攀枝花）"},
    {"type": "iron", "name": "西昌太和钒钛磁铁矿", "lon": 102.18, "lat": 27.84, "prov": 22, "value": 14, "detail": "攀西地区大型岩浆型钒钛磁铁矿（四川凉山）"},
    {"type": "iron", "name": "白云鄂博伴生铁矿", "lon": 109.96, "lat": 41.80, "prov": 4, "value": 15, "detail": "包钢核心铁矿石原料基地（内蒙古包头）"},
    {"type": "iron", "name": "马鞍山凹山-南山铁矿", "lon": 118.61, "lat": 31.66, "prov": 11, "value": 11, "detail": "宁芜玢岩型铁矿代表，华东重要钢铁原料矿（安徽马鞍山）"},
    {"type": "iron", "name": "霍邱周集-张庄铁矿", "lon": 116.28, "lat": 32.35, "prov": 11, "value": 20, "detail": "华东最大隐伏沉积变质铁矿带（安徽六安霍邱）"},
    {"type": "iron", "name": "大冶-程潮铁矿", "lon": 114.98, "lat": 30.12, "prov": 16, "value": 6, "detail": "百年矽卡岩富铁矿基地，武钢主力矿山（湖北黄石/鄂州）"},
    {"type": "iron", "name": "山西袁家村铁矿 (岚县)", "lon": 111.54, "lat": 38.28, "prov": 3, "value": 13, "detail": "太钢核心大型露天沉积变质铁矿（山西吕梁）"},
    {"type": "iron", "name": "海南石碌富铁矿", "lon": 109.04, "lat": 19.24, "prov": 20, "value": 4, "detail": "中国品位最高的富赤铁矿产区之一（海南昌江）"},
    {"type": "iron", "name": "新疆备战-式克尔大型铁矿", "lon": 83.85, "lat": 43.25, "prov": 30, "value": 12, "detail": "西天山海相火山岩型大型富铁矿（新疆和静）"},
    {"type": "iron", "name": "山东莱芜张家洼-齐河铁矿", "lon": 117.68, "lat": 36.22, "prov": 14, "value": 9, "detail": "鲁中-鲁西富铁矿成矿带（含禹城李屯深部富铁矿）"},

    # copper (unit: 万吨铜金属储量)
    {"type": "copper", "name": "德兴铜矿 (江西铜业)", "lon": 117.73, "lat": 29.02, "prov": 13, "value": 950, "detail": "亚洲大型露天斑岩铜矿，江铜核心主力矿山（江西上饶德兴）"},
    {"type": "copper", "name": "驱龙-甲玛铜多金属矿 (拉萨)", "lon": 91.89, "lat": 29.66, "prov": 25, "value": 2400, "detail": "中国单体规模最大斑岩铜矿基地，铜资源量超2,000万吨（西藏墨竹工卡）"},
    {"type": "copper", "name": "玉龙铜矿 (昌都)", "lon": 97.73, "lat": 31.38, "prov": 25, "value": 650, "detail": "青藏高原东缘特大型斑岩-矽卡岩铜矿（西藏昌都江达）"},
    {"type": "copper", "name": "普朗铜矿 (香格里拉)", "lon": 99.98, "lat": 28.04, "prov": 24, "value": 510, "detail": "中国规模最大地下自然崩落法开采斑岩铜矿（云南迪庆）"},
    {"type": "copper", "name": "多宝山铜矿 (嫩江)", "lon": 125.78, "lat": 50.25, "prov": 7, "value": 360, "detail": "东北最大斑岩型铜钼矿基地（黑龙江黑河嫩江）"},
    {"type": "copper", "name": "乌努格吐山铜钼矿 (满洲里)", "lon": 117.62, "lat": 49.41, "prov": 4, "value": 280, "detail": "高寒大型斑岩铜钼矿（内蒙古呼伦贝尔新巴尔虎右旗）"},
    {"type": "copper", "name": "铜陵冬瓜山铜矿", "lon": 117.85, "lat": 30.93, "prov": 11, "value": 220, "detail": "长江中下游成矿带千米深井大型铜矿（安徽铜陵）"},
    {"type": "copper", "name": "大冶铜绿山铜铁矿", "lon": 114.92, "lat": 30.08, "prov": 16, "value": 160, "detail": "三千年古铜矿遗址与现代主力矽卡岩铜矿（湖北黄石）"},
    {"type": "copper", "name": "中条山铜矿峪铜矿", "lon": 111.67, "lat": 35.33, "prov": 3, "value": 240, "detail": "华北最大地下大型铜矿基地（山西运城垣曲）"},
    {"type": "copper", "name": "福建紫金山铜金矿", "lon": 116.41, "lat": 25.18, "prov": 12, "value": 250, "detail": "高硫化浅成低温热液与斑岩铜金复合矿床（福建龙岩上杭）"},
    {"type": "copper", "name": "新疆阿舍勒铜矿", "lon": 86.26, "lat": 48.20, "prov": 30, "value": 120, "detail": "阿尔泰VMS型高品位铜锌多金属矿（新疆阿勒泰哈巴河）"},
    {"type": "copper", "name": "雄村-朱诺斑岩铜矿 (日喀则)", "lon": 88.45, "lat": 29.36, "prov": 25, "value": 600, "detail": "冈底斯铜矿带大型接续斑岩铜金基地（西藏日喀则）"},

    # gold (unit: 吨黄金金属储量)
    {"type": "gold", "name": "焦家-三山岛金矿带 (莱州)", "lon": 119.95, "lat": 37.39, "prov": 14, "value": 1500, "detail": "胶东世界第三大金矿集区核心断裂带蚀变岩型金矿（山东烟台莱州）"},
    {"type": "gold", "name": "招远玲珑-西岭金矿", "lon": 120.42, "lat": 37.37, "prov": 14, "value": 1200, "detail": "“中国金都”核心矿区，含西岭超大型深部金矿（580吨单体）"},
    {"type": "gold", "name": "紫金山金矿 (上杭)", "lon": 116.42, "lat": 25.19, "prov": 12, "value": 320, "detail": "“上金下铜”世界级浅成低温热液金矿床（福建上杭）"},
    {"type": "gold", "name": "甘肃阳山超大型金矿 (文县)", "lon": 104.88, "lat": 33.11, "prov": 27, "value": 360, "detail": "亚洲最大类卡林型金矿床（甘肃陇南文县）"},
    {"type": "gold", "name": "小秦岭灵宝金矿带", "lon": 110.65, "lat": 34.48, "prov": 15, "value": 450, "detail": "全国第二大产金基地秦岭石英脉型金矿（河南三门峡灵宝）"},
    {"type": "gold", "name": "贵州烂泥沟-水银洞金矿", "lon": 105.72, "lat": 25.12, "prov": 23, "value": 340, "detail": "滇黔桂“金三角”卡林型微细浸染金矿（贵州黔西南）"},
    {"type": "gold", "name": "辽宁五龙-大东沟金矿 (丹东)", "lon": 124.21, "lat": 40.23, "prov": 5, "value": 420, "detail": "辽东半岛石英脉及最新探明千吨级大东沟金矿成矿带（辽宁丹东）"},
    {"type": "gold", "name": "云南鹤庆北衙金多金属矿", "lon": 100.19, "lat": 26.15, "prov": 24, "value": 280, "detail": "“三江”成矿带大型斑岩-矽卡岩型金矿（云南大理鹤庆）"},
    {"type": "gold", "name": "内蒙古长山壕金矿", "lon": 109.12, "lat": 41.37, "prov": 4, "value": 190, "detail": "大型低品位露天堆浸金矿（内蒙古包头固阳）"},
    {"type": "gold", "name": "新疆阿希金矿 (伊宁)", "lon": 81.55, "lat": 44.23, "prov": 30, "value": 95, "detail": "西天山古火山口浅成低温热液金矿（新疆伊犁）"},
    {"type": "gold", "name": "黑龙江黑河东安-争光金矿", "lon": 127.85, "lat": 49.42, "prov": 7, "value": 140, "detail": "大兴安岭东麓浅成低温热液高品位金矿（黑龙江逊克/嫩江）"},
    {"type": "gold", "name": "台湾金瓜石金铜矿 (历史遗址)", "lon": 121.86, "lat": 25.11, "prov": 31, "value": 90, "detail": "东亚著名浅成低温热液金铜矿山（新北瑞芳）"},

    # lithium (unit: 万吨碳酸锂当量 LCE)
    {"type": "lithium", "name": "察尔汗盐湖锂矿 (格尔木)", "lon": 95.32, "lat": 36.82, "prov": 28, "value": 1200, "detail": "中国最大可溶性钾镁盐湖锂资源基地（青海格尔木）"},
    {"type": "lithium", "name": "东台吉乃尔-一里坪盐湖", "lon": 93.86, "lat": 37.50, "prov": 28, "value": 680, "detail": "柴达木盆地富锂镁锂比优良盐湖基地（青海海西）"},
    {"type": "lithium", "name": "扎布耶茶卡盐湖锂矿", "lon": 84.08, "lat": 31.35, "prov": 25, "value": 184, "detail": "世界级高品位碳酸锂型盐湖，全球少数天然析出碳酸锂矿（西藏日喀则仲巴）"},
    {"type": "lithium", "name": "甘孜甲基卡锂辉石矿", "lon": 100.92, "lat": 30.23, "prov": 22, "value": 310, "detail": "亚洲规模最大硬岩伟晶岩型锂辉石矿田（四川甘孜康定）"},
    {"type": "lithium", "name": "阿坝可尔因-李家沟锂矿", "lon": 101.85, "lat": 31.82, "prov": 22, "value": 240, "detail": "川西硬岩锂辉石主力开发带（四川马尔康/金川）"},
    {"type": "lithium", "name": "宜春414-枧下窝锂云母矿", "lon": 114.54, "lat": 27.64, "prov": 13, "value": 350, "detail": "“亚洲锂都”花岗伟晶岩型锂云母资源集群（江西宜春）"},
    {"type": "lithium", "name": "新疆大红柳滩锂铍矿", "lon": 79.15, "lat": 36.02, "prov": 30, "value": 220, "detail": "西昆仑高海拔超大型伟晶岩型锂辉石成矿带（新疆和田皮山）"},
    {"type": "lithium", "name": "湖南临武鸡脚山锂矿", "lon": 112.56, "lat": 25.28, "prov": 17, "value": 130, "detail": "南岭蚀变花岗岩型大型锂云母矿（湖南郴州临武）"},
    {"type": "lithium", "name": "内蒙古加不斯铌钽锂矿", "lon": 114.65, "lat": 43.92, "prov": 4, "value": 105, "detail": "北方大型钠长石花岗岩锂铷铌钽多金属矿（内蒙古锡林郭勒）"},

    # tungsten (unit: 万吨WO3/Sn储量)
    {"type": "tungsten", "name": "赣州西华山-大吉山钨矿", "lon": 114.32, "lat": 25.43, "prov": 13, "value": 65, "detail": "“世界钨都”百年黑钨矿发源地（江西赣州大余/全南）"},
    {"type": "tungsten", "name": "朱溪超大型钨铜矿 (景德镇)", "lon": 117.39, "lat": 29.36, "prov": 13, "value": 344, "detail": "探明WO3超344万吨，刷新世界最大单体钨矿纪录（江西浮梁，CGS）"},
    {"type": "tungsten", "name": "大湖塘超大型钨矿 (九江)", "lon": 114.86, "lat": 29.04, "prov": 13, "value": 120, "detail": "江南古陆斑岩-热液型超大型白钨矿床（江西武宁）"},
    {"type": "tungsten", "name": "郴州柿竹园钨多金属矿", "lon": 113.14, "lat": 25.73, "prov": 17, "value": 85, "detail": "“世界有色金属博物馆”特大型钨锡钼铋矿（湖南郴州）"},
    {"type": "tungsten", "name": "冷水江锡矿山锑矿", "lon": 111.49, "lat": 27.76, "prov": 17, "value": 80, "detail": "“世界锑都”特大型辉锑矿矿田（湖南娄底冷水江）"},
    {"type": "tungsten", "name": "个旧超大型锡多金属矿", "lon": 103.16, "lat": 23.36, "prov": 24, "value": 190, "detail": "“中国锡都”世界级锡铜多金属矿区（云南红河个旧）"},
    {"type": "tungsten", "name": "广西大厂锡多金属矿 (南丹)", "lon": 107.61, "lat": 24.84, "prov": 19, "value": 140, "detail": "特大型锡锑锌铅铟多金属矿集区（广西河池南丹）"},
    {"type": "tungsten", "name": "福建清流行洛坑钨矿", "lon": 116.92, "lat": 26.25, "prov": 12, "value": 32, "detail": "武夷成矿带大型斑岩-石英脉复合白钨矿（福建三明）"},
    {"type": "tungsten", "name": "甘肃肃南小柳沟钨钼矿", "lon": 98.48, "lat": 39.21, "prov": 27, "value": 28, "detail": "北祁连大型矽卡岩型白钨矿基地（甘肃张掖）"},

    # bauxite (unit: 亿吨铝土矿储量)
    {"type": "bauxite", "name": "广西平果铝土矿 (百色)", "lon": 107.59, "lat": 23.32, "prov": 19, "value": 3.5, "detail": "中国优质岩溶堆积型一水硬铝石核心产区（广西百色平果）"},
    {"type": "bauxite", "name": "广西靖西新圩铝土矿", "lon": 106.42, "lat": 23.13, "prov": 19, "value": 2.4, "detail": "桂西大型喀斯特铝土矿带重要接续矿区（广西百色靖西）"},
    {"type": "bauxite", "name": "山西孝义-交口铝土矿", "lon": 111.77, "lat": 37.14, "prov": 3, "value": 4.8, "detail": "中国铝土矿储量第一大省主力矿区（山西吕梁）"},
    {"type": "bauxite", "name": "山西兴县-保德铝土矿", "lon": 111.12, "lat": 38.46, "prov": 3, "value": 3.9, "detail": "晋西北大型煤下铝及古风化壳铝土矿带（山西忻州/吕梁）"},
    {"type": "bauxite", "name": "河南三门峡-渑池铝土矿", "lon": 111.76, "lat": 34.76, "prov": 15, "value": 3.2, "detail": "豫西优质高铝耐火粘土与铝土矿产区（河南三门峡）"},
    {"type": "bauxite", "name": "河南巩义-登封铝土矿", "lon": 112.97, "lat": 34.75, "prov": 15, "value": 2.6, "detail": "中原氧化铝及电解铝集群原料基地（河南郑州）"},
    {"type": "bauxite", "name": "贵州修文-清镇铝土矿", "lon": 106.59, "lat": 26.84, "prov": 23, "value": 3.4, "detail": "黔中大型沉积型一水硬铝石矿区（贵州贵阳）"},
    {"type": "bauxite", "name": "贵州务正道铝土矿带", "lon": 107.56, "lat": 28.58, "prov": 23, "value": 4.2, "detail": "黔北特大型整装铝土矿成矿带（遵义务川-正安-道真）"},
    {"type": "bauxite", "name": "云南文山铝土矿", "lon": 104.24, "lat": 23.38, "prov": 24, "value": 2.1, "detail": "“中国绿色铝谷”滇东南主力铝土矿源（云南文山）"},
]


def _classify_wri_plant(row: dict[str, str]) -> str:
    fuel = (row.get("primary_fuel") or "").strip()
    name_l = (row.get("name") or "").lower()
    if fuel == "Nuclear":
        return "nuclear"
    if fuel == "Hydro":
        if any(kw in name_l for kw in PUMPED_STORAGE_WRI_KEYWORDS):
            return "pumped_storage"
        return "hydro"
    if fuel == "Wind":
        return "wind"
    if fuel == "Solar":
        return "solar"
    return "coal_plant"  # Coal, Gas, Oil thermal stations


def _clean_plant_name(raw_name: str, fuel_type: str) -> str:
    name = (raw_name or "").strip()
    if "}" in name:
        name = name.replace("}", "").strip()
    return name


def build_resources(binder: GeoBinder) -> dict[str, Any]:
    pp_path = RAW_DIR / "wri_power_plants_chn_twn.csv"
    type_names = {t["id"]: t["name"] for t in RESOURCE_TYPES}
    all_plants: list[dict[str, Any]] = []
    override_by_wri = {o["match_wri"].lower(): o for o in VERIFIED_PLANT_OVERRIDES if o["match_wri"]}

    seen_overrides = set()
    with pp_path.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not row.get("latitude") or not row.get("longitude"):
                continue
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            mw = float(row.get("capacity_mw") or 0.0)
            if mw <= 0:
                continue
            raw_name = (row.get("name") or "").strip()
            low_name = raw_name.lower()
            ov = override_by_wri.get(low_name)
            if ov:
                seen_overrides.add(low_name)
                ptype = ov["type"]
                mw = ov["mw"]
                lon = ov["lon"]
                lat = ov["lat"]
                display_name = ov["name"]
                loc = binder.bind_lonlat(lon, lat, force_province_idx=ov["prov"])
                detail = ov["note"]
                src = "WRI GPPD v1.3 + 2024核验"
            else:
                ptype = _classify_wri_plant(row)
                display_name = _clean_plant_name(raw_name, ptype)
                loc = binder.bind_lonlat(lon, lat)
                fuel_raw = row.get("primary_fuel") or ptype
                year = row.get("commissioning_year") or ""
                yr_txt = f" · 投产 {int(float(year))}" if year and year.replace(".", "").isdigit() else ""
                detail = f"装机 {mw:,.0f} MW · 燃料 {fuel_raw}{yr_txt} · {loc['province']} (WRI GPPD)"
                src = "WRI GPPD v1.3"

            all_plants.append({
                "type": ptype,
                "type_label": type_names[ptype],
                "fuel": type_names[ptype],
                "name": display_name,
                **loc,
                "value": round(mw, 1),
                "capacity_mw": round(mw, 1),
                "unit": "MW",
                "detail": detail,
                "source": src,
            })

    # Add newly commissioned supplements not matched in WRI
    for ov in VERIFIED_PLANT_OVERRIDES:
        if ov["match_wri"] and ov["match_wri"].lower() in seen_overrides:
            continue
        loc = binder.bind_lonlat(ov["lon"], ov["lat"], force_province_idx=ov["prov"])
        all_plants.append({
            "type": ov["type"],
            "type_label": type_names[ov["type"]],
            "fuel": type_names[ov["type"]],
            "name": ov["name"],
            **loc,
            "value": round(ov["mw"], 1),
            "capacity_mw": round(ov["mw"], 1),
            "unit": "MW",
            "detail": ov["note"],
            "source": "NEA / CNEA / 三峡集团公开核验 (2021-2025)",
        })

    # Aggregate FULL national & provincial MW totals across ALL 4,274+ plants
    nat_mw: dict[str, float] = defaultdict(float)
    prov_totals: dict[str, dict[str, Any]] = {}
    for p in PROVINCE_ORDER:
        prov_totals[p["code"]] = {
            "province_idx": p["idx"],
            "name": p["name"],
            "all_plants_count": 0,
            "all_plants_mw": {t["id"]: 0.0 for t in RESOURCE_TYPES if t["category"] == "energy"},
            "total_mw": 0.0,
            "mapped_count": 0,
        }

    for pl in all_plants:
        pcode = PROVINCE_ORDER[pl["province_idx"]]["code"]
        t = pl["type"]
        val = pl["value"]
        nat_mw[t] += val
        nat_mw["total"] += val
        prov_totals[pcode]["all_plants_count"] += 1
        prov_totals[pcode]["all_plants_mw"][t] += val
        prov_totals[pcode]["total_mw"] += val

    # Spatially distributed selection of ~430 top energy sites (guaranteeing provincial + hex diversity)
    quotas = {
        "nuclear": 30,
        "pumped_storage": 30,
        "hydro": 95,
        "coal_plant": 125,
        "wind": 80,
        "solar": 80,
    }
    selected_plants: list[dict[str, Any]] = []
    for ptype, q in quotas.items():
        pool = [p for p in all_plants if p["type"] == ptype]
        pool.sort(key=lambda x: -x["value"])
        if ptype in ("nuclear", "pumped_storage"):
            # Keep almost all unique hexes (dedup exact same cell for pumped storage if needed)
            picked: list[dict[str, Any]] = []
            cell_seen: dict[int, int] = defaultdict(int)
            for item in pool:
                if cell_seen[item["cell"]] >= 2 and len(pool) > q:
                    continue
                picked.append(item)
                cell_seen[item["cell"]] += 1
                if len(picked) >= q:
                    break
            selected_plants.extend(picked)
        else:
            # First pass: guarantee top 1-2 plants per province that actually has this fuel
            picked = []
            used_keys = set()
            cell_cnt: dict[int, int] = defaultdict(int)
            by_prov: dict[int, list[dict[str, Any]]] = defaultdict(list)
            for item in pool:
                by_prov[item["province_idx"]].append(item)
            for pidx in range(34):
                for item in by_prov.get(pidx, [])[:2]:
                    key = (item["name"], item["cell"])
                    if key not in used_keys and cell_cnt[item["cell"]] == 0:
                        picked.append(item)
                        used_keys.add(key)
                        cell_cnt[item["cell"]] += 1
            # Second pass: fill remaining quota with largest capacity, limiting per-hex density
            for item in pool:
                if len(picked) >= q:
                    break
                key = (item["name"], item["cell"])
                if key in used_keys:
                    continue
                if cell_cnt[item["cell"]] >= 1:
                    continue
                picked.append(item)
                used_keys.add(key)
                cell_cnt[item["cell"]] += 1
            # Third pass if still short (allow 2 per hex)
            for item in pool:
                if len(picked) >= q:
                    break
                key = (item["name"], item["cell"])
                if key in used_keys:
                    continue
                if cell_cnt[item["cell"]] >= 2:
                    continue
                picked.append(item)
                used_keys.add(key)
                cell_cnt[item["cell"]] += 1
            selected_plants.extend(picked)

    # Mineral & oil/gas sites
    type_units = {t["id"]: t["unit"] for t in RESOURCE_TYPES}
    mineral_items: list[dict[str, Any]] = []
    for m in MINERAL_CATALOG:
        loc = binder.bind_lonlat(m["lon"], m["lat"], force_province_idx=m["prov"])
        unit = type_units[m["type"]]
        label = type_names[m["type"]]
        metric_str = f"{m['value']} {unit}"
        item = {
            "type": m["type"],
            "type_label": label,
            "commodity": label,
            "name": m["name"],
            **loc,
            "value": m["value"],
            "unit": unit,
            "note": m["detail"],
            "detail": m["detail"],
            "source": "自然资源部/中国地质调查局 (CGS) & USGS MCS 2024",
        }
        if m["type"] in ("coal_mine", "oil", "gas"):
            item["output"] = metric_str
        else:
            item["reserves"] = metric_str
            item["reserve"] = metric_str
        mineral_items.append(item)

    all_items = selected_plants + mineral_items
    mapped_by_type: dict[str, int] = defaultdict(int)
    for it in all_items:
        mapped_by_type[it["type"]] += 1
        pcode = PROVINCE_ORDER[it["province_idx"]]["code"]
        prov_totals[pcode]["mapped_count"] += 1

    # Round provincial totals
    for pcode, pdata in prov_totals.items():
        pdata["total_mw"] = round(pdata["total_mw"], 1)
        pdata["all_plants_mw"] = {k: round(v, 1) for k, v in pdata["all_plants_mw"].items()}

    energy_type_ids = [t["id"] for t in RESOURCE_TYPES if t["category"] == "energy"]
    by_type_summary = {
        tid: {
            "count": sum(1 for pl in all_plants if pl["type"] == tid),
            "capacity_mw": round(nat_mw[tid], 1),
        }
        for tid in energy_type_ids
    }
    cap_mw_by_type = {tid: round(nat_mw[tid], 1) for tid in energy_type_ids}

    return {
        "version": 1,
        "vintage": "WRI Global Power Plant Database v1.3 + 2021–2025 NEA/CNEA/CGS/USGS 核验补充",
        "sources": ["wri_gppd", "nea_2025", "cgs_minerals", "usgs_mcs_2025"],
        "types": RESOURCE_TYPES,
        "items": all_items,
        "summary": {
            "note": (
                f"全量统计涵盖 WRI GPPD 全部 {len(all_plants):,} 座中国及台港澳电站"
                "（含2021–2025白鹤滩/乌东德/华龙一号/沙戈荒风光基地等核验补充）；"
                f"地图点位精选 {len(all_items)} 处空间代表性电站与矿产油气基地。"
            ),
            "total_capacity_mw": round(nat_mw["total"], 1),
            "by_type": by_type_summary,
            "capacity_mw_by_type": cap_mw_by_type,
            "national": {
                "all_plants_count": len(all_plants),
                "all_plants_mw": {k: round(v, 1) for k, v in nat_mw.items()},
                "nea_2024_gw": {
                    "coal_thermal": 1444.5,
                    "hydro": 436.0,
                    "wind": 520.7,
                    "solar": 886.7,
                    "nuclear": 60.8,
                    "pumped_storage": 58.7,
                    "total_gw": 3348.6,
                },
                "mapped_items_count": len(all_items),
                "mapped_energy_count": len(selected_plants),
                "mapped_mineral_count": len(mineral_items),
                "mapped_by_type": dict(mapped_by_type),
            },
            "provinces": prov_totals,
        },
    }


# ---------------------------------------------------------------------------
# 2. INFRASTRUCTURE: Roads, Rail + 八纵八横 HSR, Top 50 Ports, Top 120 Airports
# ---------------------------------------------------------------------------

HSR_CORRIDORS: list[tuple[str, list[tuple[float, float]]]] = [
    ("京沪高铁", [(116.38, 39.86), (117.21, 39.09), (116.30, 37.43), (116.99, 36.67), (117.13, 35.60), (117.28, 34.26), (117.39, 32.94), (118.80, 31.97), (119.95, 31.78), (120.62, 31.33), (121.32, 31.19)]),
    ("京广深港高铁", [(116.32, 39.89), (115.48, 38.87), (114.48, 38.01), (114.49, 36.60), (113.78, 34.76), (114.08, 32.98), (114.17, 32.12), (114.42, 30.61), (113.06, 28.15), (112.61, 26.90), (113.03, 25.77), (113.27, 23.15), (114.03, 22.61), (114.16, 22.30)]),
    ("京哈高铁", [(116.43, 39.90), (117.93, 40.95), (120.45, 41.57), (123.43, 41.82), (124.38, 43.17), (125.32, 43.91), (126.63, 45.76)]),
    ("沪昆高铁", [(121.32, 31.19), (120.21, 30.29), (118.87, 28.97), (117.94, 28.45), (115.96, 28.62), (113.86, 27.64), (113.06, 28.15), (110.02, 27.55), (106.63, 26.62), (102.78, 24.89)]),
    ("沿江高铁 (沪汉蓉)", [(121.32, 31.19), (118.80, 31.97), (117.29, 31.80), (116.48, 31.74), (114.42, 30.61), (112.24, 30.33), (111.35, 30.71), (108.41, 30.81), (106.55, 29.61), (104.14, 30.63)]),
    ("徐兰-兰新高铁", [(119.18, 34.60), (117.28, 34.26), (113.78, 34.76), (112.45, 34.68), (108.94, 34.38), (107.14, 34.36), (105.72, 34.58), (103.85, 36.03), (101.78, 36.62), (100.45, 38.93), (98.49, 39.73), (93.51, 42.83), (89.19, 42.95), (87.52, 43.84)]),
    ("沿海高铁北段 (沈大-青盐-沪通)", [(123.43, 41.82), (122.23, 40.66), (121.62, 38.98), (117.21, 39.09), (118.06, 36.81), (120.37, 36.10), (119.52, 35.42), (119.18, 34.60), (120.16, 33.35), (120.89, 32.01), (121.32, 31.19)]),
    ("沿海高铁南段 (杭深-广湛-海南环岛)", [(120.21, 30.29), (121.54, 29.86), (121.42, 28.66), (120.69, 27.99), (119.32, 26.08), (118.61, 24.91), (118.07, 24.64), (116.68, 23.35), (114.03, 22.61), (113.27, 23.15), (110.36, 21.27), (110.33, 20.02), (109.51, 18.26)]),
    ("京呼银兰通道", [(116.32, 39.94), (114.88, 40.76), (113.12, 40.98), (111.67, 40.84), (109.84, 40.65), (106.23, 38.48), (105.19, 37.51), (103.85, 36.03)]),
    ("西成-成贵-成昆高铁", [(108.94, 34.38), (107.03, 33.07), (105.84, 32.43), (104.14, 30.63), (103.76, 29.55), (104.64, 28.75), (105.29, 27.30), (106.63, 26.62)]),
    ("成昆高铁复线 (成都-攀枝花-昆明)", [(104.14, 30.63), (102.26, 27.88), (101.72, 26.58), (102.78, 24.89)]),
    ("贵广-南广高铁", [(106.63, 26.62), (110.29, 25.27), (112.46, 23.05), (113.27, 23.15), (108.36, 22.84), (111.28, 23.48), (113.12, 23.02)]),
    ("合福-京福高铁", [(117.29, 31.80), (118.36, 29.73), (117.94, 28.45), (118.03, 27.75), (119.32, 26.08)]),
    ("郑渝高铁", [(113.78, 34.76), (112.53, 33.00), (112.12, 32.01), (109.48, 31.05), (108.41, 30.81), (106.55, 29.61)]),
    ("大西-郑太高铁", [(113.30, 40.08), (112.56, 37.86), (112.85, 36.19), (113.78, 34.76), (111.52, 36.09), (111.01, 35.02), (108.94, 34.38)]),
    ("银西高铁", [(106.23, 38.48), (107.64, 35.71), (108.94, 34.38)]),
    ("南昆-云桂高铁", [(108.36, 22.84), (106.62, 23.90), (104.24, 23.38), (102.78, 24.89)]),
    ("哈齐-牡佳高铁", [(126.63, 45.76), (125.03, 46.59), (123.95, 47.34), (129.62, 44.58), (130.36, 46.81)]),
    ("川藏-拉林铁路骨干段", [(104.14, 30.63), (103.01, 29.99), (101.96, 30.05), (94.36, 29.65), (91.77, 29.24), (91.07, 29.62)]),
    ("台湾高速铁路 (台北-左营)", [(121.52, 25.05), (121.21, 25.01), (121.04, 24.81), (120.61, 24.11), (120.32, 23.46), (120.29, 22.92), (120.31, 22.69)]),
]

# Top 50 MOT Coastal & Yangtze/Pearl River Ports (cargo_mt = million tonnes, teu_m = million TEU, 2024 MOT)
PORT_CATALOG: list[tuple[str, str, int, float, float, float, float]] = [
    # name, kind, prov_idx, lon, lat, cargo_mt, teu_m
    ("宁波舟山港", "coastal", 10, 121.88, 29.93, 1377.0, 39.30),
    ("唐山港", "coastal", 2, 118.92, 39.18, 862.0, 3.60),
    ("青岛港", "coastal", 14, 120.28, 36.07, 710.0, 30.87),
    ("广州港", "coastal", 18, 113.52, 22.92, 680.0, 26.40),
    ("日照港", "coastal", 14, 119.55, 35.38, 608.0, 6.70),
    ("苏州港", "river", 9, 120.89, 31.78, 595.0, 9.70),
    ("上海港", "coastal", 8, 121.62, 31.34, 580.0, 51.51),
    ("天津港", "coastal", 1, 117.74, 38.99, 570.0, 23.28),
    ("烟台港", "coastal", 14, 121.40, 37.56, 510.0, 4.90),
    ("泰州港", "river", 9, 119.90, 32.30, 445.0, 0.72),
    ("镇江港", "river", 9, 119.48, 32.22, 410.0, 0.55),
    ("北部湾港", "coastal", 19, 108.62, 21.62, 430.0, 9.01),
    ("黄骅港", "coastal", 2, 117.78, 38.34, 355.0, 1.15),
    ("南通港", "river", 9, 120.84, 31.96, 350.0, 2.35),
    ("连云港港", "coastal", 9, 119.45, 34.75, 340.0, 6.69),
    ("大连港", "coastal", 5, 121.65, 38.94, 335.0, 5.20),
    ("深圳港", "coastal", 18, 113.88, 22.48, 325.0, 33.38),
    ("南京港", "river", 9, 118.73, 32.11, 305.0, 3.65),
    ("江阴港", "river", 9, 120.26, 31.92, 340.0, 0.85),
    ("营口港", "coastal", 5, 122.12, 40.30, 240.0, 5.45),
    ("九江港", "river", 13, 116.02, 29.74, 225.0, 1.02),
    ("厦门港", "coastal", 12, 118.08, 24.49, 222.0, 12.25),
    ("重庆港", "river", 21, 106.62, 29.60, 220.0, 1.45),
    ("秦皇岛港", "coastal", 2, 119.61, 39.92, 205.0, 0.65),
    ("福州港", "coastal", 12, 119.48, 26.02, 335.0, 3.85),
    ("扬州港", "river", 9, 119.42, 32.33, 175.0, 0.72),
    ("芜湖港", "river", 11, 118.36, 31.34, 172.0, 1.55),
    ("岳阳港", "river", 17, 113.14, 29.44, 165.0, 1.25),
    ("香港葵青港", "coastal", 32, 114.12, 22.33, 178.0, 13.68),
    ("湛江港", "coastal", 18, 110.42, 21.19, 285.0, 1.45),
    ("珠海港", "coastal", 18, 113.21, 21.93, 155.0, 2.15),
    ("武汉港", "river", 16, 114.32, 30.62, 148.0, 2.85),
    ("东莞港", "coastal", 18, 113.62, 22.91, 195.0, 3.80),
    ("泉州港", "coastal", 12, 118.68, 24.85, 142.0, 2.05),
    ("安庆港", "river", 11, 117.04, 30.50, 138.0, 0.28),
    ("嘉兴港", "coastal", 10, 121.09, 30.60, 145.0, 3.55),
    ("高雄港", "coastal", 31, 120.28, 22.58, 118.0, 9.20),
    ("锦州港", "coastal", 5, 121.08, 40.82, 115.0, 1.95),
    ("台州港", "coastal", 10, 121.48, 28.68, 108.0, 0.85),
    ("温州港", "coastal", 10, 120.88, 27.99, 105.0, 1.42),
    ("荆州-宜昌港", "river", 16, 111.31, 30.68, 110.0, 0.35),
    ("佛山港", "river", 18, 113.06, 22.98, 105.0, 4.10),
    ("贵港港", "river", 19, 109.61, 23.09, 102.0, 0.42),
    ("台北-基隆港", "coastal", 31, 121.38, 25.16, 98.0, 3.30),
    ("台中港", "coastal", 31, 120.51, 24.26, 96.0, 1.85),
    ("威海港", "coastal", 14, 122.17, 37.45, 92.0, 1.35),
    ("泸州港", "river", 22, 105.44, 28.91, 88.0, 0.32),
    ("洋浦港", "coastal", 20, 109.18, 19.72, 85.0, 2.05),
    ("海口港", "coastal", 20, 110.27, 20.03, 135.0, 2.25),
    ("马鞍山港", "river", 11, 118.46, 31.72, 122.0, 0.38),
]

# Top 2024 CAAC / HKG / TPE / MFM Passenger & Cargo stats keyed by IATA
CAAC_AIRPORT_STATS: dict[str, tuple[str, str, float, float]] = {
    # IATA: (Chinese Name, City, pax_m, cargo_kt)
    "PVG": ("上海浦东国际机场", "上海", 76.78, 3778.0),
    "CAN": ("广州白云国际机场", "广州", 76.37, 2382.0),
    "PEK": ("北京首都国际机场", "北京", 67.38, 1443.0),
    "SZX": ("深圳宝安国际机场", "深圳", 61.47, 1881.0),
    "TFU": ("成都天府国际机场", "成都", 54.90, 385.0),
    "HKG": ("香港国际机场", "香港", 53.10, 4938.0),
    "PKX": ("北京大兴国际机场", "北京", 49.42, 326.0),
    "CKG": ("重庆江北国际机场", "重庆", 48.68, 470.0),
    "HGH": ("杭州萧山国际机场", "杭州", 48.05, 738.0),
    "SHA": ("上海虹桥国际机场", "上海", 47.97, 424.0),
    "KMG": ("昆明长水国际机场", "昆明", 47.14, 384.0),
    "XIY": ("西安咸阳国际机场", "西安", 47.03, 290.0),
    "TPE": ("台北桃园国际机场", "台北", 44.92, 2271.0),
    "CTU": ("成都双流国际机场", "成都", 32.43, 643.0),
    "WUH": ("武汉天河国际机场", "武汉", 31.40, 330.0),
    "NKG": ("南京禄口国际机场", "南京", 31.18, 412.0),
    "CSX": ("长沙黄花国际机场", "长沙", 31.22, 198.0),
    "CGO": ("郑州新郑国际机场", "郑州", 28.51, 825.0),
    "URC": ("乌鲁木齐天山国际机场", "乌鲁木齐", 27.76, 236.0),
    "TAO": ("青岛胶东国际机场", "青岛", 26.18, 279.0),
    "XMN": ("厦门高崎国际机场", "厦门", 27.90, 375.0),
    "SYX": ("三亚凤凰国际机场", "三亚", 21.42, 108.0),
    "HAK": ("海口美兰国际机场", "海口", 26.89, 210.0),
    "HRB": ("哈尔滨太平国际机场", "哈尔滨", 23.80, 148.0),
    "SHE": ("沈阳桃仙国际机场", "沈阳", 23.74, 216.0),
    "TSN": ("天津滨海国际机场", "天津", 20.14, 192.0),
    "KWE": ("贵阳龙洞堡国际机场", "贵阳", 22.31, 122.0),
    "DLC": ("大连周水子国际机场", "大连", 19.35, 165.0),
    "TNA": ("济南遥墙国际机场", "济南", 20.01, 152.0),
    "CGQ": ("长春龙嘉国际机场", "长春", 17.80, 108.0),
    "LHW": ("兰州中川国际机场", "兰州", 17.02, 85.0),
    "FOC": ("福州长乐国际机场", "福州", 15.20, 125.0),
    "NNG": ("南宁吴圩国际机场", "南宁", 14.08, 192.0),
    "TYN": ("太原武宿国际机场", "太原", 14.80, 58.0),
    "NGB": ("宁波栎社国际机场", "宁波", 14.70, 168.0),
    "HET": ("呼和浩特白塔国际机场", "呼和浩特", 13.40, 52.0),
    "HFE": ("合肥新桥国际机场", "合肥", 12.60, 118.0),
    "WNZ": ("温州龙湾国际机场", "温州", 12.50, 116.0),
    "KHN": ("南昌昌北国际机场", "南昌", 11.20, 72.0),
    "SJW": ("石家庄正定国际机场", "石家庄", 11.30, 75.0),
    "ZUH": ("珠海金湾国际机场", "珠海", 12.97, 36.0),
    "JJN": ("泉州晋江国际机场", "泉州", 8.90, 78.0),
    "WUX": ("无锡硕放国际机场", "无锡", 10.50, 168.0),
    "YNT": ("烟台蓬莱国际机场", "烟台", 8.40, 72.0),
    "INC": ("银川河东国际机场", "银川", 8.20, 48.0),
    "MFM": ("澳门国际机场", "澳门", 7.64, 108.0),
    "KHH": ("高雄国际机场", "高雄", 6.10, 62.0),
    "TSA": ("台北松山机场", "台北", 5.80, 41.0),
    "XNN": ("西宁曹家堡国际机场", "西宁", 7.50, 38.0),
    "LXA": ("拉萨贡嘎国际机场", "拉萨", 5.95, 51.0),
    "KWL": ("桂林两江国际机场", "桂林", 6.30, 26.0),
    "LJG": ("丽江三义国际机场", "丽江", 8.20, 18.0),
    "JHG": ("西双版纳嘎洒国际机场", "景洪", 7.10, 19.0),
    "KHG": ("喀什徕宁国际机场", "喀什", 4.50, 22.0),
    "NTG": ("南通兴东国际机场", "南通", 4.10, 65.0),
    "CZX": ("常州奔牛国际机场", "常州", 4.30, 24.0),
    "XUZ": ("徐州观音国际机场", "徐州", 3.60, 14.0),
    "BHY": ("北海福成国际机场", "北海", 2.90, 8.0),
    "YIH": ("宜昌三峡国际机场", "宜昌", 3.40, 16.0),
    "MIG": ("绵阳南郊机场", "绵阳", 4.20, 12.0),
    "RMQ": ("台中清泉岗机场", "台中", 2.10, 15.0),
    "YNJ": ("延吉朝阳川机场", "延吉", 1.80, 7.0),
    "LZY": ("林芝米林机场", "林芝", 0.72, 3.5),
    "HLD": ("呼伦贝尔海拉尔机场", "呼伦贝尔", 3.20, 9.0),
    "BAV": ("包头东河机场", "包头", 2.40, 8.5),
    "DSN": ("鄂尔多斯伊金霍洛机场", "鄂尔多斯", 2.90, 11.0),
    "DYG": ("张家界荷花国际机场", "张家界", 2.80, 4.0),
    "TXN": ("黄山屯溪国际机场", "黄山", 1.15, 3.2),
    "LZH": ("柳州白莲机场", "柳州", 1.35, 6.2),
    "ZHA": ("湛江吴川国际机场", "湛江", 3.30, 9.5),
    "SWA": ("揭阳潮汕国际机场", "揭阳", 8.66, 38.0),
    "LYG": ("连云港花果山机场", "连云港", 1.85, 5.5),
    "WEH": ("威海大水泊国际机场", "威海", 2.75, 18.0),
    "LYA": ("洛阳北郊机场", "洛阳", 1.65, 3.0),
    "YCU": ("运城张孝机场", "运城", 2.10, 5.0),
    "DAT": ("大同云冈国际机场", "大同", 1.35, 3.5),
    "YIN": ("伊宁机场", "伊犁", 2.25, 8.2),
    "KRL": ("库尔勒梨城机场", "库尔勒", 2.65, 14.0),
    "AKU": ("阿克苏红旗坡机场", "阿克苏", 2.35, 9.5),
    "HTN": ("和田昆冈机场", "和田", 1.85, 6.0),
    "GOQ": ("格尔木机场", "格尔木", 0.35, 1.5),
    "DNH": ("敦煌莫高国际机场", "敦煌", 1.32, 2.2),
    "YBP": ("宜宾五粮液机场", "宜宾", 2.25, 9.8),
    "ZYI": ("遵义新舟机场", "遵义", 2.45, 4.5),
}


def build_infrastructure(binder: GeoBinder) -> dict[str, Any]:
    # 1. Roads from ne_10m_roads_china.geojson
    roads_out: list[dict[str, Any]] = []
    with (RAW_DIR / "ne_10m_roads_china.geojson").open("r", encoding="utf-8") as f:
        road_gj = json.load(f)
    for feat in road_gj.get("features", []):
        props = feat.get("properties") or {}
        sr = props.get("scalerank") or 9
        rtype = props.get("type") or ""
        expr = props.get("expressway") or 0
        if sr > 6 and expr != 1 and rtype != "Major Highway":
            continue
        cls = 0 if (expr == 1 or rtype == "Major Highway" or sr <= 4) else 1
        geom = feat.get("geometry") or {}
        lines = (
            [geom["coordinates"]]
            if geom.get("type") == "LineString"
            else (geom.get("coordinates") or [])
        )
        for line in lines:
            run: list[tuple[float, float]] = []
            for pt in line:
                x, y = lonlat_to_xy(pt[0], pt[1], binder.grid)
                if binder.is_china_xy(x, y, allow_buffer=True):
                    run.append((x, y))
                else:
                    if len(run) >= 2:
                        spts = _simplify_xy(run, 14.0)
                        if len(spts) >= 2:
                            roads_out.append({"cls": cls, "name": props.get("name") or ("国家高速" if cls == 0 else "干线公路"), "pts": spts})
                    run = []
            if len(run) >= 2:
                spts = _simplify_xy(run, 14.0)
                if len(spts) >= 2:
                    roads_out.append({"cls": cls, "name": props.get("name") or ("国家高速" if cls == 0 else "干线公路"), "pts": spts})

    # 2. Conventional Rail from ne_10m_railroads_china.geojson + 八纵八横 HSR
    rail_out: list[dict[str, Any]] = []
    with (RAW_DIR / "ne_10m_railroads_china.geojson").open("r", encoding="utf-8") as f:
        rail_gj = json.load(f)
    for feat in rail_gj.get("features", []):
        props = feat.get("properties") or {}
        sr = props.get("scalerank") or 9
        cat = props.get("category") or 2
        if sr > 8 and cat not in (1, 2):
            continue
        geom = feat.get("geometry") or {}
        lines = (
            [geom["coordinates"]]
            if geom.get("type") == "LineString"
            else (geom.get("coordinates") or [])
        )
        for line in lines:
            run = []
            for pt in line:
                x, y = lonlat_to_xy(pt[0], pt[1], binder.grid)
                if binder.is_china_xy(x, y, allow_buffer=True):
                    run.append((x, y))
                else:
                    if len(run) >= 2:
                        spts = _simplify_xy(run, 14.0)
                        if len(spts) >= 2:
                            rail_out.append({"tier": "rail", "name": "普速铁路干线", "pts": spts})
                    run = []
            if len(run) >= 2:
                spts = _simplify_xy(run, 14.0)
                if len(spts) >= 2:
                    rail_out.append({"tier": "rail", "name": "普速铁路干线", "pts": spts})

    for cname, wps in HSR_CORRIDORS:
        pts_xy = [lonlat_to_xy(lon, lat, binder.grid) for lon, lat in wps]
        rail_out.append({
            "tier": "hsr",
            "name": cname,
            "pts": [[round(p[0], 1), round(p[1], 1)] for p in pts_xy],
        })

    # 3. Top 50 Ports sorted by cargo_mt desc
    ports_sorted = sorted(PORT_CATALOG, key=lambda p: -p[5])
    ports_out: list[dict[str, Any]] = []
    for idx, (pname, kind, pidx, lon, lat, cargo_mt, teu_m) in enumerate(ports_sorted, start=1):
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        ports_out.append({
            "rank": idx,
            "name": pname,
            "kind": kind,
            "cargo_mt": cargo_mt,
            "teu_m": teu_m,
            **loc,
        })

    # 4. Top 120 Airports (OurAirports + CAAC 2024 throughput enrichment)
    ap_candidates: list[dict[str, Any]] = []
    seen_iata = set()
    with (RAW_DIR / "ourairports_cn_hk_mo_tw.csv").open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            iata = (row.get("iata_code") or "").strip().upper()
            atype = row.get("type") or ""
            sched = row.get("scheduled_service") == "yes"
            if not iata or atype not in ("large_airport", "medium_airport") or not sched:
                continue
            if iata in seen_iata:
                continue
            lat = float(row["latitude_deg"])
            lon = float(row["longitude_deg"])
            seen_iata.add(iata)
            caac = CAAC_AIRPORT_STATS.get(iata)
            if caac:
                cn_name, city, pax_m, cargo_kt = caac
            else:
                cn_name = row.get("name") or iata
                city = row.get("municipality") or cn_name
                pax_m = 1.2 if atype == "large_airport" else 0.55
                cargo_kt = 4.0 if atype == "large_airport" else 1.2
            hub = "L" if pax_m >= 18.0 else ("M" if pax_m >= 5.0 else "S")
            # Override HK/MO/TW/BJ/SH province if on border
            iso = row.get("iso_country")
            fprov = {"HK": 32, "MO": 33, "TW": 31}.get(iso)
            loc = binder.bind_lonlat(lon, lat, force_province_idx=fprov)
            ap_candidates.append({
                "iata": iata,
                "name": cn_name,
                "name_en": row.get("name") or "",
                "city": city,
                "hub": hub,
                "pax_m": round(pax_m, 2),
                "cargo_kt": round(cargo_kt, 1),
                "_sort_key": (1 if iata in CAAC_AIRPORT_STATS else 0, pax_m, 1 if atype == "large_airport" else 0),
                **loc,
            })

    ap_candidates.sort(key=lambda a: a["_sort_key"], reverse=True)
    # Guarantee all CAAC_AIRPORT_STATS entries + regional coverage up to 120
    airports_out: list[dict[str, Any]] = []
    for idx, ap in enumerate(ap_candidates[:120], start=1):
        ap.pop("_sort_key", None)
        ap["rank"] = idx
        airports_out.append(ap)

    return {
        "version": 1,
        "vintage": {
            "roads": "Natural Earth 1:10m v5.1",
            "rail": "Natural Earth 1:10m + 国铁八纵八横高铁网 (2024)",
            "ports": "交通运输部 MOT 全国港口吞吐量公报 (2024)",
            "airports": "OurAirports + 中国民航局 CAAC 机场生产统计公报 (2024)",
        },
        "sources": ["ne_10m_roads", "ne_10m_railroads", "mot_ports_2024", "ourairports", "caac_2024"],
        "rules": {
            "roads": "Natural Earth 1:10m 中国境内干线公路（scalerank <= 6 或高速公路），按 14km 抽稀并投影至 25km 网格坐标系。",
            "rail": "Natural Earth 普速铁路干线（tier='rail'）叠加以真实枢纽坐标构建的八纵八横与台湾高铁主通道（tier='hsr'）。",
            "ports": "交通运输部及台港公布吞吐量前 50 位沿海与长江/珠江内河大港（含上海5,151万TEU、宁波舟山13.77亿吨）。",
            "airports": "OurAirports 在用大型/中型定期客运机场结合 2024 CAAC 年报吞吐量前 120 位枢纽机场。",
        },
        "road_classes": [
            {"id": 0, "name": "国家高速公路与主干道"},
            {"id": 1, "name": "省际国道与干线公路"},
        ],
        "rail_tiers": [
            {"id": "hsr", "name": "八纵八横高速铁路"},
            {"id": "rail", "name": "普速铁路干线"},
        ],
        "roads": roads_out,
        "rail": rail_out,
        "ports": ports_out,
        "airports": airports_out,
    }


# ---------------------------------------------------------------------------
# 3. MILITARY: 5 PLA Theater Commands, ~76 Public Installations, 8 Ranges
# ---------------------------------------------------------------------------

THEATER_DEFS: list[dict[str, Any]] = [
    {
        "id": "eastern",
        "name": "东部战区",
        "hq_city": "南京",
        "hq_province_idx": 9,
        "lon": 118.7969,
        "lat": 32.0603,
        "provinces": [8, 9, 10, 11, 12, 13, 31],
        "role": "统筹东海、台海方向及东南沿海联合海空防卫、登岛与远海前出投送。",
    },
    {
        "id": "southern",
        "name": "南部战区",
        "hq_city": "广州",
        "hq_province_idx": 18,
        "lon": 113.2644,
        "lat": 23.1291,
        "provinces": [17, 18, 19, 20, 23, 24, 32, 33],
        "role": "担负南海岛礁海空维权管控、西南边境防卫与印度洋远海护航基地保障。",
    },
    {
        "id": "western",
        "name": "西部战区",
        "hq_city": "成都",
        "hq_province_idx": 22,
        "lon": 104.0665,
        "lat": 30.5723,
        "provinces": [21, 22, 25, 27, 28, 29, 30],
        "role": "负责青藏高原、中印及西北边防、反恐维稳与西部战略纵深机动防卫。",
    },
    {
        "id": "northern",
        "name": "北部战区",
        "hq_city": "沈阳",
        "hq_province_idx": 5,
        "lon": 123.4315,
        "lat": 41.8057,
        "provinces": [4, 5, 6, 7, 14],
        "role": "统筹东北亚、黄渤海防御、北部边疆装甲机械化与寒区联合行动。",
    },
    {
        "id": "central",
        "name": "中部战区",
        "hq_city": "北京",
        "hq_province_idx": 0,
        "lon": 116.4074,
        "lat": 39.9042,
        "provinces": [0, 1, 2, 3, 15, 16, 26],
        "role": "担负京畿卫戍防空、战略预备队、空降机动以及跨战区战略支援投送枢纽。",
    },
]

MILITARY_COMPONENTS = [
    {"id": "joint", "name": "战区联指/卫戍机关"},
    {"id": "army", "name": "陆军 (PLAA)"},
    {"id": "navy", "name": "海军 (PLAN)"},
    {"id": "air_force", "name": "空军 (PLAAF)"},
    {"id": "rocket_force", "name": "火箭军与战略威慑"},
    {"id": "aerospace", "name": "军事航天与发射基地"},
    {"id": "defense_industry", "name": "国防科工与军工重镇"},
]

# ~76 documented public installations/hubs
INSTALLATIONS_CATALOG: list[tuple[str, str, str, str, str, int, float, float, str]] = [
    # id, name, branch, theater, kind, prov_idx, lon, lat, role
    ("hq-eastern", "东部战区机关 (南京)", "joint", "eastern", "战区总部", 9, 118.79, 32.06, "东部战区联合作战指挥中心"),
    ("hq-southern", "南部战区机关 (广州)", "joint", "southern", "战区总部", 18, 113.26, 23.13, "南部战区联合作战指挥中心"),
    ("hq-western", "西部战区机关 (成都)", "joint", "western", "战区总部", 22, 104.07, 30.57, "西部战区联合作战指挥中心"),
    ("hq-northern", "北部战区机关 (沈阳)", "joint", "northern", "战区总部", 5, 123.43, 41.81, "北部战区联合作战指挥中心"),
    ("hq-central", "中部战区机关 (北京)", "joint", "central", "战区总部", 0, 116.40, 39.90, "中部战区及京畿卫戍联合指挥核心"),

    # Space Launch Centers & Aerospace Test Hubs
    ("space-jiuquan", "酒泉卫星发射中心 (东风航天城)", "aerospace", "western", "航天发射场", 4, 100.29, 40.96, "载人航天工程与各类低轨卫星核心发射基地"),
    ("space-taiyuan", "太原卫星发射中心 (岢岚)", "aerospace", "central", "航天发射场", 3, 111.61, 38.85, "太阳同步轨道卫星及多型号导弹发射试验场"),
    ("space-xichang", "西昌卫星发射中心", "aerospace", "western", "航天发射场", 22, 102.03, 28.25, "北斗导航及地球同步轨道主力航天发射场"),
    ("space-wenchang", "文昌航天发射场", "aerospace", "southern", "航天发射场", 20, 110.95, 19.61, "中国首个低纬度滨海重型火箭（长征五号/九号）与空间站发射场"),
    ("space-xian", "西安卫星测控中心", "aerospace", "central", "航天测控", 26, 108.97, 34.25, "全国航天器在轨测控与应急管理枢纽"),
    ("space-beijing", "北京航天飞行控制中心 (航天城)", "aerospace", "central", "航天飞控", 0, 116.26, 40.07, "载人航天、探月与深空探测任务飞控中心"),

    # Navy Bases & Major Naval Shipyards
    ("navy-qingdao", "青岛古镇口航母综合保障基地", "navy", "northern", "航母母港", 14, 120.13, 35.82, "北海舰队驻地及首艘航母辽宁舰母港保障基地"),
    ("navy-sanya", "三亚亚龙湾-榆林航母及潜艇基地", "navy", "southern", "航母/潜艇基地", 20, 109.69, 18.22, "南海战略投送枢纽、航母（山东舰）与深海核潜艇母港"),
    ("navy-zhanjiang", "湛江南海舰队总部军港", "navy", "southern", "舰队母港", 18, 110.41, 21.18, "南部战区海军司令部驻地及主力水面舰艇母港"),
    ("navy-ningbo", "宁波东海舰队驻地及军港", "navy", "eastern", "舰队母港", 10, 121.65, 29.88, "东部战区海军司令部驻地及东海主力舰艇支撑基地"),
    ("navy-zhoushan", "舟山定海海军基地", "navy", "eastern", "海军基地", 10, 122.11, 30.01, "东海前出驱护舰支队核心驻泊母港"),
    ("navy-lushun", "旅顺军港 (大连)", "navy", "northern", "海军基地", 5, 121.25, 38.80, "黄渤海门户百年军港，常规潜艇及训练保障基地"),
    ("navy-huludao", "葫芦岛潜艇基地及渤海造船厂", "navy", "northern", "潜艇/造船基地", 5, 120.99, 40.72, "核潜艇制造与海军试验核心基地"),
    ("navy-jiangnan", "江南造船长兴岛大型水面舰艇基地", "navy", "eastern", "海军造船", 8, 121.74, 31.36, "福建舰等大型航母及055型驱逐舰主力建造船坞"),
    ("navy-dalian-yard", "大连造船厂军船基地", "navy", "northern", "海军造船", 5, 121.64, 38.93, "北方主力航母及驱逐舰设计建造与大修船厂"),
    ("navy-hudong", "沪东中华造船军船基地", "navy", "eastern", "海军造船", 8, 121.58, 31.29, "两栖攻击舰（075/076）与导弹护卫舰主力建造基地"),
    ("navy-sanduao", "宁德三都澳军港", "navy", "eastern", "海军基地", 12, 119.67, 26.64, "台海北翼深水天然良港海军基地"),
    ("navy-xiamen", "厦门海军水警区基地", "navy", "eastern", "海军基地", 12, 118.08, 24.46, "海峡前沿近海防御及两栖投送港口"),
    ("navy-guangzhou-huangpu", "中船黄埔文冲军船基地", "navy", "southern", "海军造船", 18, 113.45, 23.08, "华南护卫舰与海警主力舰艇建造枢纽"),
    ("navy-zuoying", "台湾左营海军基地 (参照)", "navy", "eastern", "区域海军基地", 31, 120.28, 22.69, "台湾海峡东南向主要军港（公开地标）"),
    ("navy-suao", "台湾苏澳海军基地 (参照)", "navy", "eastern", "区域海军基地", 31, 121.86, 24.59, "台湾东海岸主要防空海港（公开地标）"),
    ("hk-ngongshunchau", "驻香港部队昂船洲海军基地", "navy", "southern", "驻军基地", 32, 114.13, 22.32, "中国人民解放军驻香港部队联合海防基地"),
    ("mo-garrison", "驻澳门部队氹仔营区", "joint", "southern", "驻军营区", 33, 113.56, 22.15, "中国人民解放军驻澳门部队主力防卫营区"),

    # Air Force Bases & Aviation Test/Manufacturing
    ("af-yanliang", "西安阎良空军试飞院 (西飞)", "air_force", "central", "试飞/军工", 26, 109.24, 34.65, "中国唯一国家级飞行试验研究院与运-20/轰炸机研制基地"),
    ("af-chengdu-htb", "成都黄田坝空军基地 (成飞)", "air_force", "western", "空军/航空工业", 22, 103.95, 30.70, "歼-20/歼-10隐身战机总装与试飞基地"),
    ("af-shenyang-bl", "沈阳北陵空军基地 (沈飞)", "air_force", "northern", "空军/航空工业", 5, 123.43, 41.87, "重型双发战机及舰载机歼-15/歼-35研发制造基地"),
    ("af-cangzhou", "沧州空军飞行试验训练基地", "air_force", "central", "空军基地", 2, 116.92, 38.40, "空军战术战法与新机接装训练基地"),
    ("af-wuhu", "芜湖湾里空军基地", "air_force", "eastern", "空军基地", 11, 118.41, 31.39, "东部战区空军精锐重型战斗机联队驻地"),
    ("af-foshan", "佛山沙堤空军基地", "air_force", "southern", "空军基地", 18, 113.07, 23.08, "珠三角核心空防枢纽（含航空防卫训练单元）"),
    ("af-zhangzhou", "漳州空军前沿机场", "air_force", "eastern", "空军基地", 12, 117.65, 24.56, "海峡前沿重要防空与对海空军枢纽"),
    ("af-quzhou", "衢州空军航空兵基地", "air_force", "eastern", "空军基地", 10, 118.90, 28.97, "浙西战略防空与远程打击航空兵枢纽"),
    ("af-nanjing-luhe", "南京六合空军基地", "air_force", "eastern", "空军基地", 9, 118.79, 32.38, "长江下游主力空防与运输机基地"),
    ("af-suining", "遂宁-广汉空军训练基地", "air_force", "western", "空军航校", 22, 105.55, 30.48, "西南航空兵飞行训练与高原备降枢纽"),
    ("af-gonggar", "拉萨贡嘎高原空军航空基地", "air_force", "western", "高原空军", 25, 90.91, 29.30, "青藏高原空中防线核心高海拔保障基地"),
    ("af-hotan", "和田高原前线航空基地", "air_force", "western", "高原空军", 30, 79.86, 37.04, "喀喇昆仑-西昆仑空域战略保障机场"),
    ("af-urumqi", "乌鲁木齐南郊空军枢纽", "air_force", "western", "空军基地", 30, 87.48, 43.90, "北疆联合防空与战略运输机场"),
    ("af-qiqihar", "齐齐哈尔三家子空军基地", "air_force", "northern", "空军基地", 7, 123.91, 47.24, "高寒地区主力航空兵防空枢纽"),
    ("af-jiamusi", "佳木斯空军航空基地", "air_force", "northern", "空军基地", 7, 130.46, 46.84, "东北边疆空防前哨基地"),
    ("af-wugong", "武功空军运输机基地", "air_force", "central", "战略空运", 26, 108.26, 34.28, "运-20/大型运输机战略投送枢纽"),
    ("af-dangyang", "当阳空降及运输航空枢纽", "air_force", "central", "空军/空降", 16, 111.82, 30.80, "中部战区空降兵战略投送支撑基地"),
    ("af-hualien", "台湾花莲佳山洞库空军基地 (参照)", "air_force", "eastern", "区域空军基地", 31, 121.61, 24.02, "台湾东岸防空洞库基地（公开地标）"),

    # Army Group Garrisons & Strategic Airborne
    ("army-xiaogan", "空降兵部队驻地 (孝感)", "air_force", "central", "战略空降", 16, 113.92, 30.92, "战略快速反应空降兵主力驻地（湖北孝感）"),
    ("army-shijiazhuang", "中部战区陆军机关 (石家庄)", "army", "central", "战区陆军", 2, 114.51, 38.04, "京畿南翼重装机械化部队及陆军学院聚集区"),
    ("army-baoding", "保定第82集团军驻地", "army", "central", "集团军驻地", 2, 115.46, 38.87, "“万岁军”重型合成机械化与京畿防御主力"),
    ("army-zhangjiakou", "张家口第81集团军驻地", "army", "central", "集团军驻地", 2, 114.88, 40.82, "北部入京咽喉守备与装甲合成部队"),
    ("army-xinxiang", "新乡第83集团军驻地", "army", "central", "集团军驻地", 15, 113.93, 35.30, "中原快速机动合成部队与陆航旅驻地"),
    ("army-jinan", "北部战区陆军机关 (济南)", "army", "northern", "战区陆军", 14, 117.12, 36.65, "北部战区陆军指挥枢纽"),
    ("army-weifang", "潍坊第80集团军驻地", "army", "northern", "集团军驻地", 14, 119.16, 36.71, "胶东半岛防御与两栖机动作战主力"),
    ("army-jinzhou", "锦州第79集团军驻地", "army", "northern", "集团军驻地", 5, 121.13, 41.11, "辽西走廊机械化与防空作战主力"),
    ("army-changchun", "长春第78集团军驻地", "army", "northern", "集团军驻地", 6, 125.32, 43.82, "东北纵深寒区机动合成部队"),
    ("army-fuzhou", "东部战区陆军机关 (福州)", "army", "eastern", "战区陆军", 12, 119.30, 26.07, "东南沿海陆军防卫指挥枢纽"),
    ("army-xuzhou", "徐州第71集团军驻地", "army", "eastern", "集团军驻地", 9, 117.28, 34.20, "“临汾旅”所在华东战略机动集团军"),
    ("army-huzhou", "湖州第72集团军驻地", "army", "eastern", "集团军驻地", 10, 120.09, 30.89, "长三角两栖合成与跨海突击主力"),
    ("army-xiamen-73", "厦门第73集团军驻地", "army", "eastern", "集团军驻地", 12, 118.09, 24.48, "台海前沿两栖合成主力集团军"),
    ("army-nanning", "南部战区陆军机关 (南宁)", "army", "southern", "战区陆军", 19, 108.37, 22.82, "南部边海防陆军指挥枢纽"),
    ("army-huizhou-74", "惠州第74集团军驻地", "army", "southern", "集团军驻地", 18, 114.42, 23.11, "华南两栖与轻高机快速反应主力"),
    ("army-kunming-75", "昆明第75集团军驻地", "army", "southern", "集团军驻地", 24, 102.83, 24.88, "西南山地丛林及特种作战主力"),
    ("army-lanzhou", "西部战区陆军机关 (兰州)", "army", "western", "战区陆军", 27, 103.83, 36.06, "西北及青藏方向陆军指挥枢纽"),
    ("army-xining-76", "西宁第76集团军驻地", "army", "western", "集团军驻地", 28, 101.78, 36.62, "青藏高原高寒山地机动作战主力"),
    ("army-chongqing-77", "重庆第77集团军驻地", "army", "western", "集团军驻地", 21, 106.55, 29.56, "西南战略预备队及高原快速驰援主力"),
    ("army-tibet", "西藏军区驻地 (拉萨)", "army", "western", "边防军区", 25, 91.14, 29.65, "高原边防一线联合防卫指挥中心"),
    ("army-xinjiang", "新疆军区驻地 (乌鲁木齐)", "army", "western", "边防军区", 30, 87.62, 43.83, "南疆喀喇昆仑及北疆边防联合指挥中心"),

    # Rocket Force & Defense Industry Hubs
    ("rf-beijing", "火箭军机关 (北京)", "rocket_force", "central", "军种总部", 0, 116.32, 39.96, "战略导弹部队最高指挥枢纽"),
    ("rf-huangshan", "安徽黄山战略导弹保障基地", "rocket_force", "eastern", "导弹基地", 11, 118.34, 29.71, "华东战略导弹作战支撑基地"),
    ("rf-luoyang", "河南洛阳战略保障基地", "rocket_force", "central", "导弹基地", 15, 112.45, 34.62, "中原导弹工程与战略后勤保障核心"),
    ("rf-kunming", "云南昆明常规/战略导弹基地", "rocket_force", "southern", "导弹基地", 24, 102.72, 25.04, "西南战略威慑力支撑基地"),
    ("rf-xining", "青海西宁高原战略威慑基地", "rocket_force", "western", "导弹基地", 28, 101.75, 36.65, "高原纵深战略威慑部署区"),
    ("rf-tonghua", "吉林通化东北导弹基地", "rocket_force", "northern", "导弹基地", 6, 125.94, 41.73, "长白山纵深战略导弹基地"),
    ("ind-baotou", "包头北方重工-一机集团 (装甲基地)", "defense_industry", "northern", "兵工重镇", 4, 109.95, 40.66, "主战坦克（99A）与重型火炮核心制造基地"),
    ("ind-mianyang", "绵阳中国工程物理研究院 (科学城)", "defense_industry", "western", "核武器研试", 22, 104.76, 31.50, "国家战略核武器物理研究与空气动力试验基地"),
    ("ind-chongqing", "重庆长安-嘉陵国防兵工集群", "defense_industry", "western", "兵工重镇", 21, 106.56, 29.59, "常规弹药、特种车辆与光电火控重镇"),
    ("ind-harbin", "哈尔滨哈飞-东安航空动力基地", "defense_industry", "northern", "航空军工", 7, 126.64, 45.62, "直-20等军用直升机与航空发动机主力基地"),
    ("ind-nanchang", "南昌洪都航空基地", "defense_industry", "eastern", "航空军工", 13, 115.92, 28.64, "军用教练机（L-15/K-8）与无人机核心研产基地"),
    ("ind-guiyang", "贵阳航发黎阳军用发动机基地", "defense_industry", "southern", "航发军工", 23, 106.67, 26.42, "军用涡扇航空发动机关键制造枢纽"),
]

RANGES_CATALOG: list[tuple[str, str, str, str, int, float, float, float, str]] = [
    ("range-zhurihe", "朱日和合同战术训练基地", "army", "northern", 4, 112.90, 42.40, 55.0, "亚洲最大、信息化程度最高陆军合成旅红蓝对抗基地（内蒙古锡林郭勒）"),
    ("range-dingxin", "鼎新空军综合训练试验基地", "air_force", "western", 27, 99.78, 40.38, 60.0, "中国空军“红剑”大规模体系对抗演习与新机武器打靶场（甘肃酒泉金塔）"),
    ("range-ejina", "酒泉东风航天着陆及试验靶场", "aerospace", "western", 4, 100.85, 41.35, 75.0, "神舟飞船主着陆场与航空航天综合测控靶场区（内蒙古额济纳）"),
    ("range-korla", "库尔勒高原荒漠武器试验训练区", "army", "western", 30, 86.25, 41.65, 65.0, "荒漠防空反导与陆军装备试验综合靶场（新疆巴州）"),
    ("range-queshan", "确山合同战术训练基地", "army", "central", 15, 113.85, 32.82, 35.0, "山地丘陵步坦协同与实兵实弹战术训练基地（河南驻马店）"),
    ("range-taonan", "洮南合同战术训练基地", "army", "northern", 6, 122.65, 45.38, 40.0, "高寒湿地装甲机械化重装实弹演习基地（吉林白城）"),
    ("range-qingtongxia", "青铜峡合同战术训练基地", "army", "western", 29, 105.82, 37.92, 38.0, "戈壁山地跨区机动演习训练基地（宁夏吴忠）"),
    ("range-shandan", "山丹高原综合训练场", "army", "western", 27, 101.20, 38.28, 42.0, "河西走廊高海拔军马场及装甲炮兵实弹射击区（甘肃张掖）"),
]


def build_military(binder: GeoBinder) -> dict[str, Any]:
    theaters_out: list[dict[str, Any]] = []
    theater_map: dict[str, dict[str, Any]] = {}
    for th in THEATER_DEFS:
        loc = binder.bind_lonlat(th["lon"], th["lat"], force_province_idx=th["hq_province_idx"])
        entry = {
            "id": th["id"],
            "name": th["name"],
            "hq": th["hq_city"],
            "hq_city": th["hq_city"],
            "hq_province_idx": th["hq_province_idx"],
            "province_indices": th["provinces"],
            "provinces": [PROVINCE_ORDER[i]["name"] for i in th["provinces"]],
            "role": th["role"],
            "x": loc["x"],
            "y": loc["y"],
            "cell": loc["cell"],
        }
        theaters_out.append(entry)
        theater_map[th["id"]] = entry

    branch_names = {
        "joint": "联勤/综合",
        "army": "陆军",
        "navy": "海军",
        "air_force": "空军",
        "rocket_force": "火箭军",
        "aerospace": "军事航天/发射场",
        "defense_industry": "联勤/综合",
    }

    insts_out: list[dict[str, Any]] = []
    for iid, name, branch, theater, kind, pidx, lon, lat, role in INSTALLATIONS_CATALOG:
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        insts_out.append({
            "id": iid,
            "name": name,
            "branch": branch_names.get(branch, branch),
            "branch_id": branch,
            "theater": theater_map[theater]["name"],
            "theater_id": theater,
            "kind": kind,
            "tier": "major" if kind in ("战区总部", "航母母港", "航母/潜艇基地", "航天发射场", "军种总部") else "base",
            "role": role,
            **loc,
        })

    ranges_out: list[dict[str, Any]] = []
    for rid, name, branch, theater, pidx, lon, lat, radius_km, role in RANGES_CATALOG:
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        ranges_out.append({
            "id": rid,
            "name": name,
            "branch": branch_names.get(branch, branch),
            "branch_id": branch,
            "theater": theater_map[theater]["name"],
            "theater_id": theater,
            "radius_km": radius_km,
            "role": role,
            **loc,
        })

    # All 34 provinces breakdown
    prov_to_theater: dict[int, dict[str, Any]] = {}
    for th in THEATER_DEFS:
        for pidx in th["provinces"]:
            prov_to_theater[pidx] = th

    provinces_out: dict[str, Any] = {}
    for p in PROVINCE_ORDER:
        pidx = p["idx"]
        pcode = p["code"]
        th = prov_to_theater[pidx]
        p_insts = [it for it in insts_out if it["province_idx"] == pidx]
        p_ranges = [rg for rg in ranges_out if rg["province_idx"] == pidx]
        branches = sorted({it["branch"] for it in p_insts})
        tier = (
            "战略核心" if pidx in (0, 8, 9, 18, 22, 5, 26, 20, 14)
            else ("边海防要冲" if pidx in (12, 19, 25, 30, 4, 7, 24, 31, 32)
            else "战区纵深支撑")
        )
        provinces_out[pcode] = {
            "code": pcode,
            "name": p["name"],
            "province_idx": pidx,
            "theater": th["id"],
            "theater_name": th["name"],
            "installations": len(p_insts),
            "bases": len(p_insts),
            "installation_count": len(p_insts),
            "range_count": len(p_ranges),
            "branches": branches,
            "strategic_tier": tier,
            "installation_ids": [it["id"] for it in p_insts],
        }

    branch_counts = defaultdict(int)
    for it in insts_out:
        branch_counts[it["branch"]] += 1

    return {
        "version": 1,
        "vintage": "中国国防白皮书 / 五大战区公开体制与航天基地公报 (2024)",
        "sources": ["prc_defense_whitepaper", "pla_theaters_public", "space_launch_centers_public"],
        "rule": "依据公开战区体制（五大战区）、四大航天发射场、三大舰队驻地及公开报道空军/陆军/军工基地与大型训练靶场整理。",
        "caveats": "仅收录公开新闻与白皮书确认之基地与战略区划，不涉及涉密部队番号或精确驻军人员数。",
        "components": MILITARY_COMPONENTS,
        "theaters": theaters_out,
        "installations": insts_out,
        "ranges": ranges_out,
        "provinces": provinces_out,
        "national": {
            "active_personnel_m": 2.0,
            "defense_budget_bcny_2024": 1665.54,
            "budget_gdp_pct": 0.0124,
            "theaters_count": len(theaters_out),
            "installations_count": len(insts_out),
            "ranges_count": len(ranges_out),
            "by_branch": dict(branch_counts),
            "note": "2024年中央本级国防预算 16,655.4 亿元（约占GDP 1.24%），军队现役总员额保持约200万（公开白皮书口径）。",
        },
    }


# ---------------------------------------------------------------------------
# 4. WONDERS: 4 Explicit Public Rules -> 60 Wonders
# ---------------------------------------------------------------------------

WONDER_RULES = [
    {
        "id": "national_park",
        "kind": "national_park",
        "title": "国家公园与顶级自然遗产",
        "label": "国家公园与顶级自然遗产",
        "year": 2024,
        "text": "遴选首批正式设立的国家公园及 UNESCO 自然/双遗产代表景区，按 2024 公开年游客量 (visits_m 百万) 与核心保护区面积 (area_km2) 排序（15处）。",
        "description": "遴选首批正式设立的国家公园及 UNESCO 自然/双遗产代表景区，按 2024 公开年游客量 (visits_m 百万) 与核心保护区面积 (area_km2) 排序（15处）。",
    },
    {
        "id": "university",
        "kind": "university",
        "title": "顶尖研究型大学 (R&D Top 18)",
        "label": "顶尖研究型大学 (R&D Top 18)",
        "year": 2024,
        "text": "严格依据教育部/科技部公开高校科技经费统计及港校年报，按年度科研研发经费支出 (rd_bcny 亿元) 排名中国（含港澳）Top 18 顶尖研究型大学。",
        "description": "严格依据教育部/科技部公开高校科技经费统计及港校年报，按年度科研研发经费支出 (rd_bcny 亿元) 排名中国（含港澳）Top 18 顶尖研究型大学。",
    },
    {
        "id": "cultural",
        "kind": "cultural",
        "title": "世界文化遗产与中华国宝奇观",
        "label": "世界文化遗产与中华国宝奇观",
        "year": 2024,
        "text": "依据 UNESCO 世界文化遗产名录与中华文明探源标志性考古遗址遴选 15 处代表性文化奇观（与自然遗产规则不重复）。",
        "description": "依据 UNESCO 世界文化遗产名录与中华文明探源标志性考古遗址遴选 15 处代表性文化奇观（与自然遗产规则不重复）。",
    },
    {
        "id": "megaproject",
        "kind": "megaproject",
        "title": "当代超级工程奇观",
        "label": "当代超级工程奇观",
        "year": 2024,
        "text": "依据国家发改委与工程界公认的世界级超级工程及大科学装置里程碑遴选 12 项工程奇观。",
        "description": "依据国家发改委与工程界公认的世界级超级工程及大科学装置里程碑遴选 12 项工程奇观。",
    },
]

# Rule 1: 15 National Parks & Top Natural Heritages (with real visits_m & area_km2)
PARKS_CATALOG: list[tuple[str, str, str, int, str, float, float, float, float, str, str]] = [
    # id, name, short, prov_idx, city, lon, lat, visits_m, area_km2, badge, desc
    ("park-huangshan", "黄山风景区 (世界自然与文化双遗产)", "黄山", 11, "黄山市", 118.17, 30.13, 4.92, 160.6, "UNESCO双遗产", "五岳归来不看山，黄山归来不看岳；奇松怪石云海温泉四绝，2024游客492万人次。"),
    ("park-zhangjiajie", "张家界武陵源风景名胜区", "张家界武陵源", 17, "张家界市", 110.44, 29.34, 8.12, 397.5, "UNESCO自然遗产", "三千奇峰拔地而起的石英砂岩峰林地貌奇观，2024核心景区客流逾812万人次。"),
    ("park-guilin", "桂林喀斯特山水景观", "桂林漓江", 19, "桂林市", 110.48, 24.78, 12.50, 230.0, "UNESCO自然遗产", "百里漓江峰林峰丛水墨画卷，中国喀斯特岩溶地貌标杆，核心区年游客逾1,250万人次。"),
    ("park-jiuzhaigou", "九寨沟国家级自然保护区", "九寨沟", 22, "阿坝州", 103.92, 33.26, 4.55, 720.0, "UNESCO自然遗产", "高原钙华彩池、叠瀑与雪峰原始森林童话世界，2024年接待游客约455万人次。"),
    ("park-changbaishan", "长白山自然保护区 (天池)", "长白山", 6, "延边州", 128.05, 42.01, 3.41, 1964.6, "世界地质公园", "东北第一神山，休眠火山口天池与垂直植被带完整保存。"),
    ("park-taishan", "泰山风景名胜区", "东岳泰山", 14, "泰安市", 117.10, 36.26, 8.62, 426.0, "UNESCO双遗产", "五岳独尊、帝王封禅文化与华北古老变质岩地质地标，年登顶客流逾860万人次。"),
    ("park-emeishan", "峨眉山—乐山大佛景区", "峨眉山", 22, "乐山市", 103.33, 29.52, 5.10, 154.0, "UNESCO双遗产", "高差两千余米的立体生物气候带与普贤菩萨道场文化双遗产。"),
    ("park-wuyishan", "武夷山国家公园", "武夷山", 12, "南平市", 117.95, 27.72, 3.20, 1280.0, "首批国家公园", "中国首批正式设立的5个国家公园之一，完整保存中亚热带森林生态系统与丹霞九曲溪。"),
    ("park-giant-panda", "大熊猫国家公园 (卧龙核心)", "大熊猫国家公园", 22, "阿坝/雅安", 103.18, 31.03, 1.85, 22000.0, "首批国家公园", "横跨川陕甘三省，总面积2.2万平方公里，保护全国逾70%野生大熊猫栖息地。"),
    ("park-sanjiangyuan", "三江源国家公园", "三江源", 28, "玉树/果洛", 95.80, 34.45, 0.28, 190700.0, "首批国家公园", "面积19.07万平方公里的“中华水塔”，长江、黄河、澜沧江发源地。"),
    ("park-tiger-leopard", "东北虎豹国家公园", "东北虎豹", 6, "延边/牡丹江", 130.52, 43.18, 0.42, 14100.0, "首批国家公园", "横跨吉林黑龙江，庇护野生东北虎、东北豹种群恢复的温带针阔混交林生态系统。"),
    ("park-hainan-rainforest", "海南热带雨林国家公园", "海南热带雨林", 20, "五指山/白沙", 109.42, 18.88, 1.35, 4269.0, "首批国家公园", "中国分布最集中、保存最完好的大陆性岛屿型热带雨林，海南长臂猿唯一栖息地。"),
    ("park-kanas", "喀纳斯国家级自然保护区", "喀纳斯", 30, "阿勒泰地区", 87.03, 48.72, 3.80, 2201.6, "阿尔泰生态明珠", "中国唯一阿尔泰山泰加林冰川堰塞湖景观，秋色闻名亚欧。"),
    ("park-yading", "稻城亚丁生态保护区", "稻城亚丁", 22, "甘孜州", 100.34, 28.45, 1.68, 1457.5, "香格里拉之魂", "三座雪域神山（仙乃日、央迈勇、夏诺多吉）与冰蚀湖泊构成的横断山极地画卷。"),
    ("park-taroko", "台湾太鲁阁大理石峡谷", "太鲁阁峡谷", 31, "花莲县", 121.49, 24.16, 4.10, 920.0, "岛屿地质奇观", "立雾溪千万年深切大理石岩层形成的百米垂直绝壁峡谷。"),
]

# Rule 2: Top 18 Research Universities strictly ranked by public annual R&D expenditure (rd_bcny in 亿元)
UNIS_CATALOG: list[tuple[str, str, str, int, str, float, float, float, int, str]] = [
    # id, name, short, prov_idx, city, lon, lat, rd_bcny, state_labs, desc
    ("uni-tsinghua", "清华大学", "清华", 0, "北京", 116.33, 40.00, 154.6, 13, "全国高校科研经费榜首（154.6亿元），信息科学、人工智能、核能、材料及芯片研发核心引擎。"),
    ("uni-zju", "浙江大学", "浙大", 10, "杭州", 120.09, 30.30, 126.4, 10, "长三角科研重镇（126.4亿元），计算机、控制科学、农学与医学交叉创新实力雄厚。"),
    ("uni-sjtu", "上海交通大学", "上交", 8, "上海", 121.44, 31.03, 113.2, 8, "船舶海洋工程、人工智能、临床医学与集成电路全国顶尖（113.2亿元）。"),
    ("uni-pku", "北京大学", "北大", 0, "北京", 116.31, 39.99, 102.8, 12, "基础理学、人文社科、生命科学及前沿数学全球领先（102.8亿元）。"),
    ("uni-hit", "哈尔滨工业大学", "哈工大", 7, "哈尔滨", 126.63, 45.74, 79.5, 9, "“国防七子”之首，航天器控制、机器人与极寒材料工程核心主力（79.5亿元）。"),
    ("uni-hust", "华中科技大学", "华科", 16, "武汉", 114.41, 30.51, 76.2, 6, "武汉光电国家研究中心与脉冲强磁场大科学装置所在地（76.2亿元）。"),
    ("uni-fudan", "复旦大学", "复旦", 8, "上海", 121.50, 31.30, 75.4, 5, "基础医学、微电子芯片、气候物理与哲学社科名校（75.4亿元）。"),
    ("uni-xjtu", "西安交通大学", "西交", 26, "西安", 108.99, 34.25, 72.1, 5, "中国西部科技创新港核心，动力工程、电气绝缘与精密制造领先（72.1亿元）。"),
    ("uni-sysu", "中山大学", "中大", 18, "广州", 113.30, 23.10, 68.5, 4, "粤港澳大湾区综合性高水平研究引擎，海洋、超算与临床医学实力突出（68.5亿元）。"),
    ("uni-buaa", "北京航空航天大学", "北航", 0, "北京", 116.35, 39.98, 67.3, 7, "航空宇航科学与技术、无人系统及空天动力国家战略科研基地（67.3亿元）。"),
    ("uni-bit", "北京理工大学", "北理", 0, "北京", 116.32, 39.96, 65.1, 6, "特种车辆、光电制导、新能源动力与防务科技创新重镇（65.1亿元）。"),
    ("uni-ustc", "中国科学技术大学", "中科大", 11, "合肥", 117.27, 31.84, 62.4, 7, "量子信息（九章/墨子号）、同步辐射及核聚变（EAST）基础科学圣殿（62.4亿元）。"),
    ("uni-tongji", "同济大学", "同济", 8, "上海", 121.50, 31.28, 59.2, 4, "土木建筑、轨道交通、新能源汽车与深海地球科学国际一流（59.2亿元）。"),
    ("uni-nju", "南京大学", "南大", 9, "南京", 118.96, 32.12, 57.6, 7, "凝聚态物理、天文天体、地球科学及半导体材料基础研究泰斗（57.6亿元）。"),
    ("uni-whu", "武汉大学", "武大", 16, "武汉", 114.36, 30.54, 56.3, 4, "测绘遥感信息工程全球第一梯队，法学、生命科学名校（56.3亿元）。"),
    ("uni-scu", "四川大学", "川大", 22, "成都", 104.08, 30.63, 54.1, 4, "华西医学中心、生物材料与高分子工程西南第一研究高校（54.1亿元）。"),
    ("uni-tju", "天津大学", "天大", 1, "天津", 117.17, 39.11, 52.3, 4, "中国第一所现代大学，化工、精密仪器与地震工程大科学装置基地（52.3亿元）。"),
    ("uni-hku", "香港大学 (HKU)", "香港大学", 32, "香港", 114.14, 22.28, 48.5, 5, "亚洲顶尖国际化研究型大学，传染病学、金融与建筑学科领先（科研经费约48.5亿元等效）。"),
]

# Rule 3: 15 Cultural Heritages & Civilization Landmarks
CULTURAL_CATALOG: list[tuple[str, str, str, int, str, float, float, int, str, str]] = [
    # id, name, short, prov_idx, city, lon, lat, unesco_year, era, desc
    ("cul-forbidden-city", "故宫博物院 (紫禁城)", "故宫", 0, "北京", 116.397, 39.916, 1987, "明清 (1420)", "世界现存规模最大、保存最完整的木结构宫殿建筑群，年参观超1,900万人次。"),
    ("cul-great-wall", "万里长城 (八达岭—慕田峪段)", "长城", 0, "北京/河北", 116.020, 40.354, 1987, "春秋至明", "横贯北方万里边疆的古代防御工程奇迹，中华文明最著名象征。"),
    ("cul-terracotta", "秦始皇陵及兵马俑坑", "兵马俑", 26, "西安", 109.273, 34.384, 1987, "秦代 (前210)", "“世界第八大奇迹”，数千尊与真人等高陶俑军阵再现大一统帝国气象。"),
    ("cul-mogao", "敦煌莫高窟", "莫高窟", 27, "酒泉敦煌", 94.803, 40.036, 1987, "前秦至元", "丝绸之路佛窟艺术宝库，现存洞窟735个、壁画4.5万平方米。"),
    ("cul-potala", "布达拉宫历史建筑群", "布达拉宫", 25, "拉萨", 91.117, 29.658, 1994, "吐蕃至清", "世界海拔最高宫堡式建筑，藏式建筑、宗教与雪域历史文化巅峰。"),
    ("cul-dujiangyan", "都江堰古代水利工程", "都江堰", 22, "成都", 103.610, 31.001, 2000, "战国秦 (前256)", "全世界年代最久且仍在使用的无坝引水灌溉工程，造就“天府之国”。"),
    ("cul-grand-canal", "中国大运河 (扬州—杭州枢纽段)", "京杭大运河", 9, "扬州/苏州/杭州", 119.440, 32.390, 2014, "春秋至清", "全长近3,200公里、沟通五大水系的世界最长人工运河系统。"),
    ("cul-suzhou-gardens", "苏州古典园林 (拙政园/留园)", "苏州园林", 9, "苏州", 120.629, 31.324, 1997, "宋至清", "“咫尺之内再造乾坤”的东方造园艺术极致典范。"),
    ("cul-qufu", "曲阜孔庙、孔林及孔府", "曲阜三孔", 14, "济宁曲阜", 116.990, 35.596, 1994, "东周至清", "两千五百年儒家文化圣地与东方最大祭祀礼制建筑群。"),
    ("cul-liangzhu", "良渚古城遗址", "良渚古城", 10, "杭州", 119.992, 30.398, 2019, "新石器 (前3300)", "实证中华五千多年文明史的史前大型水城与礼制玉器文明中心。"),
    ("cul-sanxingdui", "三星堆古蜀文明遗址", "三星堆", 22, "德阳广汉", 104.197, 30.992, 2023, "商周 (前1600)", "青铜纵目面具、黄金权杖与青铜神树震撼世界的长江上游古蜀文明。"),
    ("cul-tulou", "福建土楼 (永定/南靖)", "福建土楼", 12, "龙岩/漳州", 117.015, 24.660, 2008, "宋元至民国", "利用生土夯筑的大型聚族防卫民居建筑奇观，兼具生态与宗族秩序。"),
    ("cul-yinxu", "安阳殷墟甲骨文遗址", "殷墟", 15, "安阳", 114.316, 36.124, 2006, "商代晚期", "中国第一个有文献可考并被考古证实的都城遗址，甲骨文诞生地。"),
    ("cul-longmen", "龙门石窟", "龙门石窟", 15, "洛阳", 112.470, 34.556, 2000, "北魏至唐", "伊水两岸绵延一公里、逾十万尊石刻造像的中原佛教石窟巅峰。"),
    ("cul-westlake", "杭州西湖文化景观", "杭州西湖", 10, "杭州", 120.141, 30.244, 2011, "唐宋至明清", "天人合一的山湖城融合典范，中国古典诗词与画境的真实投影。"),
]

# Rule 4: 12 Modern Megaproject Wonders
MEGAPROJECT_CATALOG: list[tuple[str, str, str, int, str, float, float, int, float, str, str]] = [
    # id, name, short, prov_idx, city, lon, lat, year, invest_bcny, scale, desc
    ("mega-three-gorges", "三峡水利枢纽工程", "三峡工程", 16, "宜昌", 111.003, 30.824, 2009, 2500.0, "22.5 GW · 全球最大水电站", "集防洪、发电、航运为一体的世界最大水利工程与万吨级五级船闸。"),
    ("mega-hzmb", "港珠澳大桥", "港珠澳大桥", 18, "珠海/香港/澳门", 113.780, 22.280, 2018, 1269.0, "全长55 km · 世界最长跨海桥隧", "跨越伶仃洋的超大型桥岛隧集群工程，将香港至珠海澳门车程缩至45分钟。"),
    ("mega-qinghai-tibet", "青藏铁路 (格拉段)", "青藏铁路", 25, "格尔木—拉萨", 91.950, 32.980, 2006, 330.0, "1,956 km · 海拔5,072m", "世界海拔最高、线路最长的高原冻土铁路，“天路”贯通雪域高原。"),
    ("mega-fast", "500米口径球面射电望远镜 (中国天眼 FAST)", "中国天眼 FAST", 23, "黔南平塘", 106.857, 25.653, 2016, 12.0, "500m 口径 · 发现脉冲星900+", "世界最大单口径、最灵敏射电望远镜，显著拓展人类观测脉冲星与快速射电暴能力。"),
    ("mega-baihetan", "白鹤滩水电站", "白鹤滩水电站", 22, "宁南/巧家", 102.904, 27.224, 2022, 2200.0, "16.0 GW · 单机100万千瓦", "当今世界单机容量最大、技术难度最高的特高拱坝水电站。"),
    ("mega-snwd", "南水北调工程 (中线丹江口渠首)", "南水北调", 15, "南阳淅川", 111.680, 32.680, 2014, 5000.0, "累计调水超750亿立方米", "世界规模最大跨流域调水工程，惠及京津冀豫逾1.85亿人口。"),
    ("mega-yangshan", "洋山深水港四期全自动化码头", "洋山自动化港", 8, "上海浦东", 122.070, 30.630, 2017, 1300.0, "吞吐超5,151万TEU母港", "全球单体规模最大、自动化程度最高的集装箱无人码头群。"),
    ("mega-daxing", "北京大兴国际机场", "大兴机场", 0, "北京/廊坊", 116.410, 39.510, 2019, 4500.0, "70万㎡单栋航站楼", "全球建筑设计及综合交通换乘标杆工程，京津冀双枢纽新门户。"),
    ("mega-deep-channel", "深中通道", "深中通道", 18, "深圳/中山", 113.710, 22.580, 2024, 500.0, "24 km · 全球最高海中悬索桥", "集“桥、岛、隧、水下互通”于一体的粤港澳大湾区核心跨海动脉，2024通车。"),
    ("mega-west-east-gas", "西气东输能源管网 (轮南首站)", "西气东输", 30, "巴州轮台", 84.240, 41.780, 2004, 3000.0, "干支线逾2万公里", "横贯塔里木盆地至长三角的能源大动脉，重塑中国东部能源结构。"),
    ("mega-east", "全超导托卡马克核聚变装置 (东方超环 EAST)", "人造太阳 EAST", 11, "合肥科学岛", 117.160, 31.908, 2006, 20.0, "403秒长脉冲高约束模", "国际领先稳态核聚变大科学装置，多次刷新长脉冲高约束等离子体世界纪录。"),
    ("mega-sichuan-tibet", "川藏铁路-雅安林芝超级桥隧工程", "川藏线超级工程", 25, "林芝/雅安", 94.360, 29.650, 2021, 3198.0, "桥隧比超90% · 穿越横断山", "人类铁路建设史上地形地质最复杂的世纪超级工程，串联成都与拉萨。"),
]


def build_wonders(binder: GeoBinder) -> dict[str, Any]:
    wonders: list[dict[str, Any]] = []

    # 1. Parks sorted by visits_m desc
    parks_sorted = sorted(PARKS_CATALOG, key=lambda x: -x[7])
    for r, (wid, name, short, pidx, city, lon, lat, visits_m, area_km2, badge, desc) in enumerate(parks_sorted, start=1):
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        wonders.append({
            "id": wid,
            "name": name,
            "short": short,
            "kind": "national_park",
            "rule": "national_park",
            "rank": r,
            "city_name": city,
            "metrics": {
                "visits_m": visits_m,
                "visits": int(round(visits_m * 1_000_000)),
                "area_km2": area_km2,
                "badge": badge,
                "year": 2024,
            },
            "description": desc,
            **loc,
        })

    # 2. Universities sorted strictly by rd_bcny desc
    unis_sorted = sorted(UNIS_CATALOG, key=lambda x: -x[7])
    for r, (wid, name, short, pidx, city, lon, lat, rd_bcny, labs, desc) in enumerate(unis_sorted, start=1):
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        wonders.append({
            "id": wid,
            "name": name,
            "short": short,
            "kind": "university",
            "rule": "university",
            "rank": r,
            "city_name": city,
            "metrics": {
                "rd_bcny": rd_bcny,
                "state_labs": labs,
                "year": 2024,
            },
            "description": desc,
            **loc,
        })

    # 3. Cultural heritage
    for r, (wid, name, short, pidx, city, lon, lat, uyear, era, desc) in enumerate(CULTURAL_CATALOG, start=1):
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        wonders.append({
            "id": wid,
            "name": name,
            "short": short,
            "kind": "cultural",
            "rule": "cultural",
            "rank": r,
            "city_name": city,
            "metrics": {
                "unesco_year": uyear,
                "era": era,
                "highlight": f"UNESCO {uyear} · {era}",
            },
            "description": desc,
            **loc,
        })

    # 4. Megaprojects
    for r, (wid, name, short, pidx, city, lon, lat, cyear, inv_bcny, scale, desc) in enumerate(MEGAPROJECT_CATALOG, start=1):
        loc = binder.bind_lonlat(lon, lat, force_province_idx=pidx)
        wonders.append({
            "id": wid,
            "name": name,
            "short": short,
            "kind": "megaproject",
            "rule": "megaproject",
            "rank": r,
            "city_name": city,
            "metrics": {
                "completed_year": cyear,
                "investment_bcny": inv_bcny,
                "scale": scale,
                "highlight": scale,
            },
            "description": desc,
            **loc,
        })

    total_park_visits = round(sum(p[7] for p in parks_sorted), 2)
    return {
        "version": 1,
        "vintage": {
            "national_park": "国家林草局/文旅部 2024 统计公报",
            "university": "教育部高校科技经费统计 2024",
            "cultural": "UNESCO 世界遗产名录 (2024)",
            "megaproject": "国家重大工程档案 (2024)",
        },
        "sources": ["nfga_parks_2024", "moe_rd_stats_2024", "unesco_china_2024", "ndrc_megaprojects"],
        "rules": WONDER_RULES,
        "national": {
            "total_wonders": len(wonders),
            "park_visits_m": total_park_visits,
            "top_universities_rd_bcny": round(sum(u[7] for u in unis_sorted), 1),
            "unesco_total_china": 59,
        },
        "wonders": wonders,
    }


# ---------------------------------------------------------------------------
# 5. TRADE: 40 Interprovincial Freight Corridors
# ---------------------------------------------------------------------------

HUB_COORDS: dict[str, tuple[int, float, float]] = {
    "上海": (8, 121.47, 31.23),
    "苏州": (9, 120.59, 31.30),
    "南京": (9, 118.80, 32.06),
    "杭州": (10, 120.15, 30.27),
    "宁波": (10, 121.55, 29.87),
    "合肥": (11, 117.23, 31.82),
    "深圳": (18, 114.06, 22.54),
    "广州": (18, 113.26, 23.13),
    "东莞": (18, 113.75, 23.02),
    "佛山": (18, 113.12, 23.02),
    "北京": (0, 116.40, 39.90),
    "天津": (1, 117.20, 39.08),
    "唐山": (2, 118.18, 39.63),
    "秦皇岛": (2, 119.60, 39.94),
    "石家庄": (2, 114.51, 38.04),
    "大同": (3, 113.30, 40.08),
    "太原": (3, 112.55, 37.87),
    "鄂尔多斯": (4, 109.78, 39.61),
    "包头": (4, 109.84, 40.66),
    "沈阳": (5, 123.43, 41.81),
    "大连": (5, 121.62, 38.91),
    "长春": (6, 125.32, 43.82),
    "哈尔滨": (7, 126.64, 45.75),
    "青岛": (14, 120.38, 36.07),
    "济南": (14, 117.12, 36.65),
    "郑州": (15, 113.62, 34.75),
    "武汉": (16, 114.30, 30.59),
    "宜昌": (16, 111.29, 30.69),
    "长沙": (17, 112.94, 28.23),
    "厦门": (12, 118.09, 24.48),
    "福州": (12, 119.30, 26.07),
    "泉州": (12, 118.68, 24.87),
    "南昌": (13, 115.86, 28.68),
    "重庆": (21, 106.55, 29.56),
    "成都": (22, 104.07, 30.57),
    "攀枝花": (22, 101.72, 26.58),
    "贵阳": (23, 106.63, 26.65),
    "昆明": (24, 102.83, 24.88),
    "南宁": (19, 108.37, 22.82),
    "北部湾": (19, 108.62, 21.62),
    "海口": (20, 110.33, 20.03),
    "西安": (26, 108.94, 34.34),
    "榆林": (26, 109.73, 38.29),
    "兰州": (27, 103.83, 36.06),
    "西宁": (28, 101.78, 36.62),
    "银川": (29, 106.23, 38.49),
    "乌鲁木齐": (30, 87.62, 43.83),
    "库尔勒": (30, 86.17, 41.73),
    "拉萨": (25, 91.14, 29.65),
    "香港": (32, 114.17, 22.32),
    "台北": (31, 121.56, 25.03),
}

COMMODITY_NAMES = {
    "coal": "煤炭及焦炭",
    "oil_gas": "油气及石化产品",
    "electronics": "电子信息与半导体器件",
    "auto_machinery": "新能源汽车与高端装备",
    "steel_ore": "铁矿石、钢铁与金属材料",
    "consumer_agri": "粮食、冷链生鲜与消费品",
    "chemicals": "精细化工与新能源材料",
    "ecommerce": "快递电商与混合高值货流",
}

MODE_NAMES = {
    "rail_water": "铁水/江海联运",
    "highway": "高速干线公路",
    "rail": "铁路重载专线",
    "water": "沿海/长江水运",
    "air_express": "航空快件专线",
    "pipeline": "油气管道与特高压",
}

# 40 major interprovincial freight corridors: (from_hub, to_hub, value_bcny, tonnage_mt, commodity, mode, note)
ROUTES_CATALOG: list[tuple[str, str, float, float, str, str, str]] = [
    ("苏州", "深圳", 1860.0, 28.5, "electronics", "highway", "长三角—珠三角电子信息、芯片模组与智能终端核心产业对流"),
    ("上海", "深圳", 1620.0, 32.0, "ecommerce", "water", "沪深沿海集装箱快线及高技术供应链干线"),
    ("北京", "上海", 1480.0, 24.0, "ecommerce", "highway", "京沪高速与高铁快运高端装备、医药及商务快件走廊"),
    ("深圳", "香港", 1420.0, 19.2, "electronics", "highway", "深港陆路口岸高价值集成电路、消费电子跨境主通道"),
    ("重庆", "上海", 1180.0, 86.0, "auto_machinery", "water", "长江黄金水道“渝沪快线”汽车、笔电与装备出海走廊"),
    ("宁波", "合肥", 1120.0, 74.0, "auto_machinery", "rail_water", "宁波舟山港海铁联运直达合肥新能源汽车与面板基地"),
    ("郑州", "深圳", 1090.0, 14.5, "electronics", "air_express", "中原航空港区与大湾区消费电子空陆联运高值动脉"),
    ("广州", "武汉", 980.0, 52.0, "consumer_agri", "highway", "京港澳主轴珠三角家电建材向长江中游分拨通道"),
    ("成都", "上海", 960.0, 41.0, "electronics", "rail_water", "成渝电子装备沿长江江海联运东出通道"),
    ("广州", "北京", 920.0, 34.0, "ecommerce", "air_express", "南货北运核心航空快递与生鲜冷链走廊"),
    ("鄂尔多斯", "唐山", 880.0, 410.0, "coal", "rail", "西煤东运核心大秦/唐呼重载铁路能源动脉"),
    ("上海", "青岛", 850.0, 58.0, "chemicals", "water", "长三角与山东半岛沿海化工、机械滚装海运线"),
    ("武汉", "上海", 830.0, 95.0, "steel_ore", "water", "长江中下游钢铁、汽车整车与大宗化工水上黄金线"),
    ("杭州", "广州", 810.0, 26.5, "ecommerce", "highway", "两大电商之都日均千万级快件对流干线"),
    ("大同", "秦皇岛", 790.0, 425.0, "coal", "rail", "中国第一煤炭重载专线“大秦铁路”核心段"),
    ("天津", "上海", 770.0, 64.0, "auto_machinery", "water", "环渤海与长三角沿海集装箱及大件装备干线"),
    ("东莞", "杭州", 740.0, 21.0, "electronics", "highway", "湾区制造—长三角互联网硬件与纺服供应链通道"),
    ("厦门", "上海", 710.0, 38.0, "consumer_agri", "water", "东南沿海与长三角机电及冷链海上快线"),
    ("沈阳", "天津", 690.0, 48.0, "auto_machinery", "highway", "东北老工业基地汽车零部件与重装入关通道"),
    ("哈尔滨", "大连", 660.0, 92.0, "consumer_agri", "rail", "“北粮南运”东北商品粮经大连港下水出海大动脉"),
    ("西安", "郑州", 640.0, 55.0, "auto_machinery", "highway", "关中—中原装备制造与中欧班列集结联动轴"),
    ("乌鲁木齐", "西安", 620.0, 88.0, "oil_gas", "pipeline", "西气东输、疆煤外运与亚欧陆桥咽喉复合能源通道"),
    ("榆林", "武汉", 610.0, 115.0, "coal", "rail", "“浩吉铁路”北煤南运华中能源保供大动脉"),
    ("唐山", "苏州", 590.0, 78.0, "steel_ore", "water", "曹妃甸钢铁卷板经海江联运供应长三角制造带"),
    ("长沙", "广州", 580.0, 46.0, "auto_machinery", "highway", "长株潭工程机械经珠三角港口出海通道"),
    ("青岛", "郑州", 560.0, 67.0, "steel_ore", "rail_water", "沿黄流域最重要铁海联运出海口岸走廊"),
    ("昆明", "成都", 540.0, 42.0, "consumer_agri", "rail", "滇中磷矿、烟草与云花冷链北上成渝双城圈"),
    ("北部湾", "重庆", 520.0, 54.0, "chemicals", "rail_water", "西部陆海新通道铁海联运主干线"),
    ("合肥", "北京", 510.0, 19.5, "electronics", "highway", "合肥科创集群与京津冀研发总部品控联动通道"),
    ("南昌", "深圳", 495.0, 31.0, "steel_ore", "rail", "赣南稀土钨铜及电子代工融入大湾区主干线"),
    ("石家庄", "济南", 480.0, 62.0, "chemicals", "highway", "华北平原医药、纺织与化工省际干线"),
    ("包头", "北京", 460.0, 49.0, "steel_ore", "rail", "蒙西稀土功能材料、电力与农畜产品进京通道"),
    ("长春", "北京", 450.0, 27.0, "auto_machinery", "rail", "东北整车制造与京津冀零部件循环通道"),
    ("泉州", "广州", 435.0, 29.0, "consumer_agri", "highway", "海西鞋服轻工与华南商贸大市场快速通道"),
    ("太原", "石家庄", 420.0, 110.0, "coal", "rail", "石太重载通道晋煤与特种钢外运走廊"),
    ("海口", "广州", 390.0, 35.0, "consumer_agri", "water", "琼州海峡海南热带果蔬与免税供应链生命线"),
    ("库尔勒", "兰州", 375.0, 68.0, "oil_gas", "pipeline", "塔里木超深油气西气东输与东疆物流通道"),
    ("银川", "西安", 350.0, 52.0, "chemicals", "rail", "宁东煤化工烯烃及新材料南下关中通道"),
    ("成都", "拉萨", 310.0, 16.0, "consumer_agri", "highway", "川藏进藏物资与高原特色产品双向保障生命线"),
    ("福州", "台北", 295.0, 12.8, "electronics", "water", "海峡两岸电子元器件及冷链海运直航通道"),
]


def _curved_arc_xy(x1: float, y1: float, x2: float, y2: float, n_pts: int = 12) -> list[list[float]]:
    dx, dy = x2 - x1, y2 - y1
    dist = math.hypot(dx, dy)
    if dist < 1e-6:
        return [[round(x1, 1), round(y1, 1)], [round(x2, 1), round(y2, 1)]]
    # Gentle quadratic Bezier offset (~8% of distance, clamped to 65 km) perpendicular to chord
    nx, ny = -dy / dist, dx / dist
    bulge = min(65.0, dist * 0.08)
    mx, my = 0.5 * (x1 + x2) + nx * bulge, 0.5 * (y1 + y2) + ny * bulge
    pts = []
    for i in range(n_pts + 1):
        t = i / n_pts
        omt = 1.0 - t
        px = omt * omt * x1 + 2.0 * omt * t * mx + t * t * x2
        py = omt * omt * y1 + 2.0 * omt * t * my + t * t * y2
        pts.append([round(px, 1), round(py, 1)])
    return pts


def build_trade(binder: GeoBinder) -> dict[str, Any]:
    routes_sorted = sorted(ROUTES_CATALOG, key=lambda r: -r[2])
    routes_out: list[dict[str, Any]] = []
    for rank, (f_name, t_name, val_bcny, tons_mt, comm, mode, note) in enumerate(routes_sorted, start=1):
        fpidx, flon, flat = HUB_COORDS[f_name]
        tpidx, tlon, tlat = HUB_COORDS[t_name]
        f_loc = binder.bind_lonlat(flon, flat, force_province_idx=fpidx)
        t_loc = binder.bind_lonlat(tlon, tlat, force_province_idx=tpidx)
        dist_km = round(math.hypot(t_loc["x"] - f_loc["x"], t_loc["y"] - f_loc["y"]), 1)
        pts = _curved_arc_xy(f_loc["x"], f_loc["y"], t_loc["x"], t_loc["y"])
        routes_out.append({
            "rank": rank,
            "from_name": f_name,
            "to_name": t_name,
            "from_province_idx": f_loc["province_idx"],
            "to_province_idx": t_loc["province_idx"],
            "from_province": f_loc["province"],
            "to_province": t_loc["province"],
            "from_cell": f_loc["cell"],
            "to_cell": t_loc["cell"],
            "from_x": f_loc["x"],
            "from_y": f_loc["y"],
            "to_x": t_loc["x"],
            "to_y": t_loc["y"],
            "value_bcny": val_bcny,
            "tonnage_mt": tons_mt,
            "commodity": COMMODITY_NAMES[comm],
            "commodity_id": comm,
            "commodity_name": COMMODITY_NAMES[comm],
            "mode": MODE_NAMES[mode],
            "mode_id": mode,
            "mode_name": MODE_NAMES[mode],
            "dist_km": dist_km,
            "note": note,
            "pts": pts,
        })

    return {
        "version": 1,
        "year": 2024,
        "vintage": "交通运输部全国货运与物流通道统计 (2024)",
        "sources": ["mot_freight_2024", "nbs_interprovincial_2024"],
        "rule": "中国40条跨省大宗能源与高附加值制造核心货运走廊（覆盖八大区域城市群及港澳台，按2024年度估算货运额排序）。",
        "path_note": "路线曲线为枢纽城市间走廊流向示意弧线，非精确逐公里铁路/公路路网轨迹。",
        "modes": [{"id": k, "name": v} for k, v in MODE_NAMES.items()],
        "commodities": COMMODITY_NAMES,
        "national": {
            "freight_tonnage_bt": 56.9,
            "freight_value_tcny": 48.5,
            "corridors_count": len(routes_out),
            "corridors_total_value_bcny": round(sum(r["value_bcny"] for r in routes_out), 1),
            "corridors_total_tonnage_mt": round(sum(r["tonnage_mt"] for r in routes_out), 1),
        },
        "routes": routes_out,
    }


def main() -> None:
    if not WORLD_JSON_PATH.exists() or not GEO_LOOKUP_PATH.exists():
        raise FileNotFoundError(
            f"Waiting for data-geo outputs: {WORLD_JSON_PATH} and {GEO_LOOKUP_PATH}"
        )

    binder = GeoBinder()
    outputs = {
        "resources.json": build_resources(binder),
        "infrastructure.json": build_infrastructure(binder),
        "military.json": build_military(binder),
        "wonders.json": build_wonders(binder),
        "trade.json": build_trade(binder),
    }

    for fname, payload in outputs.items():
        path = OUT_DIR / fname
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        size_kb = path.stat().st_size / 1024.0
        print(f"[wrote] {path} ({size_kb:.1f} KB)")

    res = outputs["resources.json"]
    infra = outputs["infrastructure.json"]
    mil = outputs["military.json"]
    wond = outputs["wonders.json"]
    trade = outputs["trade.json"]
    print(
        f"Summary -> resources: {len(res['items'])} items "
        f"(plants_mapped={res['summary']['national']['mapped_energy_count']}, "
        f"mines_mapped={res['summary']['national']['mapped_mineral_count']}, "
        f"all_plants={res['summary']['national']['all_plants_count']}); "
        f"infra: {len(infra['roads'])} roads, {len(infra['rail'])} rail "
        f"({sum(1 for r in infra['rail'] if r['tier']=='hsr')} HSR), "
        f"{len(infra['ports'])} ports, {len(infra['airports'])} airports; "
        f"military: {len(mil['theaters'])} theaters, {len(mil['installations'])} bases, {len(mil['ranges'])} ranges; "
        f"wonders: {len(wond['wonders'])}; "
        f"trade: {len(trade['routes'])} routes"
    )


if __name__ == "__main__":
    main()
