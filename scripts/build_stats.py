#!/usr/bin/env python3
"""Build socioeconomic, demographic, census, Civ yield, district, citizen, 19-lens,
and data-source JSON datasets for ChinaCiv.

Owned by @data-stats.
Reads:
  - scripts/geo_common.py (PROVINCE_ORDER, projection, grid helpers)
  - web/data/world.json
  - web/data/geo_lookup.json
  - scripts/usgs_china_eq_2000.csv (live USGS M>=4.5 China earthquake catalog since 2000)

Writes:
  - web/data/nation.json
  - web/data/states.json
  - web/data/cities.json
  - web/data/counties.json
  - web/data/districts.json
  - web/data/lenses.json
  - web/data/sources.json
"""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

ROOT_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT_DIR / "scripts"
DATA_DIR = ROOT_DIR / "web" / "data"
USGS_CSV_PATH = SCRIPTS_DIR / "usgs_china_eq_2000.csv"

sys.path.insert(0, str(SCRIPTS_DIR))
import geo_common  # noqa: E402


# ---------------------------------------------------------------------------
# 1. Authoritative Data Sources (30 real public Chinese & international sources)
# ---------------------------------------------------------------------------
SOURCES_LIST: list[dict[str, str]] = [
    {
        "id": "nbs_2024_communique",
        "name": "中华人民共和国2024年国民经济和社会发展统计公报",
        "org": "国家统计局 (NBS)",
        "vintage": "2024–2025",
        "url": "https://www.stats.gov.cn/sj/zxfb/202502/t20250228_1958817.html",
        "category": "宏观经济",
        "description": "全国GDP(134.9万亿元初步核算/134.8万亿元最终核实)、常住人口(14.0828亿)、城乡可支配收入(41,314元)、三次产业增加值与粮食产量(70,650万吨)。",
    },
    {
        "id": "nbs_5th_econ_census",
        "name": "第五次全国经济普查及2024年分省GDP最终核实公报",
        "org": "国家统计局 / 省级统计局",
        "vintage": "2024–2025",
        "url": "https://www.stats.gov.cn/sj/pcsj/",
        "category": "宏观经济",
        "description": "中国31省份及主要城市经五经普修订后的2024年地区生产总值、产业结构及就业人员核实数据。",
    },
    {
        "id": "nbs_census_7th",
        "name": "第七次全国人口普查公报（分省、分县常住人口/学历/年龄）",
        "org": "国务院第七次全国人口普查领导小组办公室 / 国家统计局",
        "vintage": "2020–2024",
        "url": "https://www.stats.gov.cn/sj/pcsj/rkpc/7rp/indexch.htm",
        "category": "人口普查",
        "description": "全国及31省份受教育程度(每10万人大学文化程度)、年龄结构、跨省迁移流动人口与城乡住房自有率基准。",
    },
    {
        "id": "nbs_yearbook_2024",
        "name": "中国统计年鉴 2024（分行业就业、工资与研发投入）",
        "org": "国家统计局",
        "vintage": "2024",
        "url": "https://www.stats.gov.cn/sj/ndsj/",
        "category": "就业与科技",
        "description": "全国7.34亿就业人员分产业分行业构成、城镇单位平均工资、区域创新与科技人才密度统计。",
    },
    {
        "id": "most_rd_2024",
        "name": "全国科技经费投入统计公报 & 科技人力资源发展研究报告",
        "org": "国家统计局 / 科学技术部 / 中国科协",
        "vintage": "2024",
        "url": "https://www.most.gov.cn/xxgk/",
        "category": "科技人才",
        "description": "全国R&D经费36,326.8亿元(强度2.69%)、约5,355万工程技术与STEM劳动者(全国平均每14名劳动者中1名)及重点科创城市分布。",
    },
    {
        "id": "moe_universities_rd",
        "name": "教育部直属高校及双一流建设高校年度科技统计与研发经费汇编",
        "org": "中华人民共和国教育部科学技术与信息化司",
        "vintage": "2024",
        "url": "http://www.moe.gov.cn/",
        "category": "高等教育",
        "description": "清华大学、北京大学、浙江大学、上海交通大学、中国科大等研究型大学年度科研经费支出排名及学院区分布。",
    },
    {
        "id": "hk_censtatd",
        "name": "香港特别行政区政府统计处年度本地生产总值及人口统计",
        "org": "香港特别行政区政府统计处 (C&SD)",
        "vintage": "2024",
        "url": "https://www.censtatd.gov.hk/",
        "category": "港澳台统计",
        "description": "2024年香港年中人口752.4万、名义GDP约3.18万亿港元(约2.90万亿元人民币)、劳动人口及收入中位数。",
    },
    {
        "id": "mo_dsec",
        "name": "澳门特别行政区统计暨普查局本地生产总值与人口资料",
        "org": "澳门特别行政区统计暨普查局 (DSEC)",
        "vintage": "2024",
        "url": "https://www.dsec.gov.mo/",
        "category": "港澳台统计",
        "description": "2024年澳门人口68.6万、GDP约4,033亿澳门元(约3,574亿元人民币)、就业人口与旅游会展业结构。",
    },
    {
        "id": "tw_dgbas",
        "name": "台湾地区国民所得及家庭收支调查统计",
        "org": "台湾统计主计机构",
        "vintage": "2024",
        "url": "https://www.stat.gov.tw/",
        "category": "港澳台统计",
        "description": "2024年台湾人口2,341万、名义GDP约25.55万亿新台币(约5.67万亿元人民币)及人均可支配收入与半导体产业就业。",
    },
    {
        "id": "mnr_land_survey",
        "name": "全国国土变更调查及第三次全国国土调查主要数据公报",
        "org": "中华人民共和国自然资源部",
        "vintage": "2023–2024",
        "url": "https://www.mnr.gov.cn/",
        "category": "国土资源",
        "description": "全国19.4亿亩耕地面积、城镇建设用地、湿地与各省国土利用空间分布。",
    },
    {
        "id": "nfga_forest_2024",
        "name": "中国国土绿化状况公报 & 国家公园发展报告",
        "org": "国家林业和草原局 (NFGA)",
        "vintage": "2024",
        "url": "https://www.forestry.gov.cn/",
        "category": "生态林业",
        "description": "全国森林覆盖率25.09%、各省森林覆盖率清查排名以及三江源、大熊猫、东北虎豹、武夷山、海南热带雨林等国家公园面积与游客量。",
    },
    {
        "id": "mee_ecology_2024",
        "name": "中国生态环境状况公报",
        "org": "中华人民共和国生态环境部",
        "vintage": "2024",
        "url": "https://www.mee.gov.cn/",
        "category": "生态环境",
        "description": "空气质量、流域水质、自然保护区与生态屏障空间格局。",
    },
    {
        "id": "nea_power_2024",
        "name": "2024年全国电力工业统计数据",
        "org": "国家能源局 (NEA) / 中电联",
        "vintage": "2024",
        "url": "https://www.nea.gov.cn/",
        "category": "能源电力",
        "description": "全国水电、火电、核电、风电、光伏及抽水蓄能装机容量、发电量与主要能源基地分布。",
    },
    {
        "id": "wri_gppd",
        "name": "Global Power Plant Database (v1.3) & 中国重大清洁能源工程库",
        "org": "World Resources Institute (WRI)",
        "vintage": "2021–2024",
        "url": "https://datasets.wri.org/dataset/globalpowerplantdatabase",
        "category": "能源电力",
        "description": "全球电厂数据库中国及台湾地区装机站点经纬度与燃料分类，结合白鹤滩、乌东德、华龙一号等新投产大型基地核定。",
    },
    {
        "id": "cgs_usgs_minerals",
        "name": "中国矿产资源报告 & USGS Mineral Commodity Summaries",
        "org": "中国地质调查局 (CGS) / USGS",
        "vintage": "2024",
        "url": "https://www.cgs.gov.cn/",
        "category": "战略矿产",
        "description": "稀土(白云鄂博/赣州)、锂(青海盐湖/川西/宜春)、钨、煤炭、油气、铁铜金铝土等重点矿区与产储量。",
    },
    {
        "id": "usgs_earthquake_catalog",
        "name": "USGS ComCat M>=4.5 地震历史目录 (2000–2026)",
        "org": "U.S. Geological Survey (USGS) / 中国地震台网中心",
        "vintage": "2000–2026",
        "url": "https://earthquake.usgs.gov/fdsnws/event/1/query",
        "category": "灾害风险",
        "description": "2000年以来东经73°–136°、北纬18°–54°范围内11,564次4.5级以上地震精定位与震级数据，映射至1,302县级网格。",
    },
    {
        "id": "mem_disasters_2024",
        "name": "全国自然灾害基本情况及防灾减灾公报",
        "org": "中华人民共和国应急管理部 (MEM)",
        "vintage": "2024",
        "url": "https://www.mem.gov.cn/",
        "category": "灾害风险",
        "description": "东南沿海台风、长江流域洪涝、西南滑坡泥石流与北方旱涝综合风险县域校准。",
    },
    {
        "id": "miit_broadband_2024",
        "name": "2024年通信业统计公报",
        "org": "中华人民共和国工业和信息化部 (MIIT)",
        "vintage": "2024",
        "url": "https://www.miit.gov.cn/",
        "category": "数字基建",
        "description": "全国固定宽带及千兆光网普及率、5G基站密度及东西部城乡数字基础设施差异。",
    },
    {
        "id": "caupd_commute_2024",
        "name": "2024年度中国主要城市通勤监测报告",
        "org": "中国城市规划设计研究院 (CAUPD)",
        "vintage": "2024",
        "url": "https://www.caupd.com/",
        "category": "城市生活",
        "description": "全国重点都市圈及90城平均单程通勤时长、45分钟通勤比重与职住分离指数。",
    },
    {
        "id": "nhc_cdc_health",
        "name": "中国卫生健康统计年鉴 & 国家疾控局居民健康素养监测",
        "org": "国家卫生健康委员会 (NHC) / 中国疾控中心",
        "vintage": "2023–2024",
        "url": "http://www.nhc.gov.cn/",
        "category": "医疗民生",
        "description": "分省千人口执业医师数、三甲医院床位可及性、期望寿命与基层医疗服务缺口评估。",
    },
    {
        "id": "cfps_cgss_wellbeing",
        "name": "中国家庭追踪调查 (CFPS) & 中国综合社会调查 (CGSS)",
        "org": "北京大学中国社会科学调查中心 / 中国人民大学",
        "vintage": "2022–2024",
        "url": "http://www.isss.pku.edu.cn/cfps/",
        "category": "社会福祉",
        "description": "居民主观幸福感指数、宗教信仰与民间民俗参与度、城乡社会资本分布。",
    },
    {
        "id": "sara_religion_survey",
        "name": "中国宗教白皮书及多源学术调查信仰地理汇编",
        "org": "国务院新闻办公室 / 社科院世界宗教研究所",
        "vintage": "2018–2024",
        "url": "https://www.scio.gov.cn/",
        "category": "信仰民俗",
        "description": "汉传佛教、道教及民间信仰、藏传佛教、伊斯兰教、基督宗教及少数民族传统信仰在省县尺度的地理分布。",
    },
    {
        "id": "mot_ports_2024",
        "name": "全国港口货物吞吐量与集装箱吞吐量统计公报",
        "org": "中华人民共和国交通运输部 (MOT)",
        "vintage": "2024",
        "url": "https://www.mot.gov.cn/",
        "category": "交通物流",
        "description": "宁波舟山、上海洋山、唐山、广州、青岛、深圳、苏州等全国50强沿海与内河大港吞吐量与铁水联运走廊。",
    },
    {
        "id": "caac_airports_2024",
        "name": "2024年全国民用运输机场生产统计公报 & OurAirports",
        "org": "中国民用航空局 (CAAC) / OurAirports",
        "vintage": "2024",
        "url": "https://www.caac.gov.cn/",
        "category": "交通物流",
        "description": "浦东、首都、白云、深圳、天府、大兴、虹桥、香港、桃园等120座核心运输机场旅客与货邮吞吐量。",
    },
    {
        "id": "creis_home_price_2024",
        "name": "2024年中国百城住宅价格指数与重点城市二手房监测",
        "org": "中指研究院 / 国家统计局70城房价指数",
        "vintage": "2024",
        "url": "https://www.stats.gov.cn/",
        "category": "房地产",
        "description": "全国重点城市及县域住宅均价(元/㎡)与房价收入比基准。",
    },
    {
        "id": "mct_cultural_heritage",
        "name": "全国文化和旅游统计公报 & 中国世界遗产名录",
        "org": "中华人民共和国文化和旅游部 / 国家文物局",
        "vintage": "2024",
        "url": "https://www.mct.gov.cn/",
        "category": "文旅奇观",
        "description": "故宫、长城、兵马俑、莫高窟、布达拉宫、良渚等世界文化遗产与重点文旅文博产业统计。",
    },
    {
        "id": "mwr_water_2024",
        "name": "中国水资源公报 & 南水北调/三峡工程运行年报",
        "org": "中华人民共和国水利部 (MWR)",
        "vintage": "2024",
        "url": "http://www.mwr.gov.cn/",
        "category": "水利工程",
        "description": "长江、黄河、珠江、松花江流域水资源及重大水利枢纽工程。",
    },
    {
        "id": "datav_geoatlas",
        "name": "阿里云 DataV GeoAtlas 中国省市县三级标准行政边界",
        "org": "阿里云 DataV / 自然资源部审图基准",
        "vintage": "2024",
        "url": "https://datav.aliyun.com/portal/school/atlas/area_selector",
        "category": "空间地理",
        "description": "GB/T 2260 34省级行政区与1,302个区县单元边界及南海诸岛十段线空间拓扑。",
    },
    {
        "id": "aws_terrarium_dem",
        "name": "Mapzen / AWS Terrarium 全球高程瓦片 (Zoom 5 DEM)",
        "org": "Amazon Web Services Open Data / SRTM / ASTER",
        "vintage": "2020–2024",
        "url": "https://registry.opendata.aws/terrain-tiles/",
        "category": "空间地理",
        "description": "25km六边形网格内真实平均海拔、最高海拔与地形起伏度提取。",
    },
    {
        "id": "natural_earth_v5",
        "name": "Natural Earth 10m/50m 全球陆地、河流、湖泊、道路与铁路矢量",
        "org": "Natural Earth",
        "vintage": "v5.1",
        "url": "https://www.naturalearthdata.com/",
        "category": "空间地理",
        "description": "周边国家陆地掩膜、主要河湖水系、高速公路与国铁普速干线基础矢量。",
    },
    {
        "id": "mod_defense",
        "name": "《新时代的中国国防》白皮书及五大战区体制公开资料",
        "org": "中华人民共和国国防部 / 国务院新闻办公室",
        "vintage": "2019–2025",
        "url": "http://www.mod.gov.cn/",
        "category": "国防安全",
        "description": "东部、南部、西部、北部、中部五大战区司令部驻地、军兵种改革与防务地理框架。",
    },
    {
        "id": "cnsa_space",
        "name": "《2021中国的航天》白皮书及四大卫星发射中心公开运行信息",
        "org": "国家航天局 (CNSA)",
        "vintage": "2022–2025",
        "url": "https://www.cnsa.gov.cn/",
        "category": "航天科工",
        "description": "酒泉、太原、西昌、文昌四大航天发射场及深空探测与卫星测控基地公开空间信息。",
    },
    {
        "id": "public_osint",
        "name": "中国海事局航行警告与公开国防科工重镇空间索引",
        "org": "中华人民共和国海事局 / 公开学术文献",
        "vintage": "2024",
        "url": "https://www.msa.gov.cn/",
        "category": "国防安全",
        "description": "公开军港、船厂、演训靶场与国防军工城市坐标空间整理。",
    },
]


# ---------------------------------------------------------------------------
# 2. 34 Provincial-Level Divisions (ordered 0..33 matching geo_common.PROVINCE_ORDER)
# ---------------------------------------------------------------------------
# Each dict holds verified 2024/2025 NBS + 7th Census + HK/MO/TW official baselines.
# gdp in 亿元, population in persons, disposable_income in 元, home_price in 元/㎡,
# urbanization/bachelors_pct/forest_pct/farmland_pct/developed_pct/migrant_pct/
# broadband_pct/homeownership_pct/healthcare_gap_pct/low_income in 0..100 (%),
# stem_share in 0..1, grain_mt in 万吨, avg_pay in 元/年.
PROVINCE_BASE: dict[str, dict[str, Any]] = {
    "110000": {
        "pop": 21_830_000, "emp": 11_850_000, "gdp": 49_843.1, "disp": 85_415,
        "home": 56_800, "growth_5y": 32.8, "growth_24": 5.2, "urb": 88.2,
        "med_age": 40.4, "bach": 42.0, "migrant": 38.5, "broadband": 98.4,
        "commute": 47.0, "own": 68.5, "hgap": 6.5, "low_inc": 2.4,
        "forest": 44.9, "farm": 8.8, "dev": 22.4, "faith_100": 13.5,
        "faith_trad": "多元世俗/无宗教为主", "wellbeing": 83.2, "grain_mt": 57.6,
        "stem_share": 0.170, "avg_pay": 218_000,
        "sec_pct": (0.2, 14.5, 85.3),
        "pop_hist": [2768000, 7568000, 9231000, 10819000, 13820000, 19612000, 21893000, 21830000],
        "badge": "双学院科技首善",
        "summary": "首都与全国科技创新中心，海淀高校群与中关村·怀柔科学城构成双学院区核心，服务业占比超85%。",
    },
    "120000": {
        "pop": 13_640_000, "emp": 7_280_000, "gdp": 18_024.3, "disp": 53_581,
        "home": 23_500, "growth_5y": 24.5, "growth_24": 5.1, "urb": 86.0,
        "med_age": 41.1, "bach": 26.9, "migrant": 26.4, "broadband": 96.2,
        "commute": 38.0, "own": 77.5, "hgap": 9.8, "low_inc": 3.8,
        "forest": 13.2, "farm": 32.5, "dev": 24.1, "faith_100": 14.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 77.6, "grain_mt": 270.6,
        "stem_share": 0.098, "avg_pay": 138_000,
        "sec_pct": (1.4, 34.8, 63.8),
        "pop_hist": [2694000, 6249000, 7764000, 8785000, 10010000, 12938000, 13866000, 13640000],
        "badge": "北方航运港城",
        "summary": "京津冀海上门户与先进制造基地，滨海新区航空航天与北方国际航运核心区联动发展。",
    },
    "130000": {
        "pop": 73_780_000, "emp": 38_100_000, "gdp": 47_526.9, "disp": 34_655,
        "home": 10_800, "growth_5y": 27.6, "growth_24": 5.4, "urb": 63.4,
        "med_age": 39.1, "bach": 12.4, "migrant": 7.8, "broadband": 92.6,
        "commute": 30.5, "own": 90.2, "hgap": 18.2, "low_inc": 8.6,
        "forest": 26.8, "farm": 34.6, "dev": 10.4, "faith_100": 16.5,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 70.8, "grain_mt": 3908.8,
        "stem_share": 0.056, "avg_pay": 92_000,
        "sec_pct": (9.8, 37.5, 52.7),
        "pop_hist": [35985000, 45688000, 53006000, 61082000, 67440000, 71854000, 74610000, 73780000],
        "badge": "京畿钢铁粮仓",
        "summary": "环渤海钢铁装备重镇与华北平原主产粮区，雄安新区与唐山万亿港口工业双翼协同。",
    },
    "140000": {
        "pop": 34_460_000, "emp": 17_850_000, "gdp": 25_494.7, "disp": 32_441,
        "home": 8_900, "growth_5y": 28.9, "growth_24": 2.3, "urb": 66.3,
        "med_age": 39.2, "bach": 17.4, "migrant": 6.2, "broadband": 91.5,
        "commute": 28.5, "own": 89.4, "hgap": 19.5, "low_inc": 10.4,
        "forest": 24.8, "farm": 24.7, "dev": 6.2, "faith_100": 21.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 69.2, "grain_mt": 1468.7,
        "stem_share": 0.058, "avg_pay": 90_500,
        "sec_pct": (5.2, 47.2, 47.6),
        "pop_hist": [14314000, 18015000, 25291000, 28759000, 32970000, 35712000, 34916000, 34460000],
        "badge": "三晋煤炭能源",
        "summary": "国家综合能源保供核心与晋商文旅重镇，兼具云冈、五台山、平遥古城与太原卫星发射基地。",
    },
    "150000": {
        "pop": 23_880_000, "emp": 12_650_000, "gdp": 26_314.6, "disp": 40_077,
        "home": 8_400, "growth_5y": 35.1, "growth_24": 5.8, "urb": 70.7,
        "med_age": 40.3, "bach": 18.7, "migrant": 9.8, "broadband": 90.8,
        "commute": 25.0, "own": 86.0, "hgap": 21.8, "low_inc": 8.9,
        "forest": 21.2, "farm": 9.8, "dev": 2.1, "faith_100": 22.5,
        "faith_trad": "少数民族传统信仰", "wellbeing": 71.4, "grain_mt": 4100.5,
        "stem_share": 0.060, "avg_pay": 102_000,
        "sec_pct": (10.9, 46.8, 42.3),
        "pop_hist": [6100000, 12349000, 19274000, 21457000, 23760000, 24706000, 24049000, 23880000],
        "badge": "北疆绿电矿都",
        "summary": "兼具世界稀土之都白云鄂博、鄂尔多斯现代煤化工与千万千瓦级风光绿电及绿色算力基地。",
    },
    "210000": {
        "pop": 41_550_000, "emp": 21_400_000, "gdp": 32_612.7, "disp": 39_844,
        "home": 10_200, "growth_5y": 24.1, "growth_24": 5.1, "urb": 74.2,
        "med_age": 43.2, "bach": 18.2, "migrant": 8.6, "broadband": 93.4,
        "commute": 32.0, "own": 84.8, "hgap": 14.5, "low_inc": 7.8,
        "forest": 40.5, "farm": 34.9, "dev": 9.6, "faith_100": 12.8,
        "faith_trad": "多元世俗/无宗教为主", "wellbeing": 72.1, "grain_mt": 2500.3,
        "stem_share": 0.074, "avg_pay": 98_500,
        "sec_pct": (8.6, 38.2, 53.2),
        "pop_hist": [18545000, 26946000, 35722000, 39460000, 42380000, 43746000, 42591000, 41550000],
        "badge": "重装制造摇篮",
        "summary": "共和国装备制造与造船工业重地，沈大走廊集聚航空发动机、高档数控机床与东北出海门户。",
    },
    "220000": {
        "pop": 23_170_000, "emp": 11_980_000, "gdp": 14_361.2, "disp": 31_318,
        "home": 8_100, "growth_5y": 21.8, "growth_24": 4.3, "urb": 65.8,
        "med_age": 42.5, "bach": 16.7, "migrant": 5.4, "broadband": 91.2,
        "commute": 29.5, "own": 87.2, "hgap": 16.4, "low_inc": 9.5,
        "forest": 45.2, "farm": 39.8, "dev": 5.8, "faith_100": 13.0,
        "faith_trad": "多元世俗/无宗教为主", "wellbeing": 70.4, "grain_mt": 4266.0,
        "stem_share": 0.064, "avg_pay": 91_000,
        "sec_pct": (11.8, 34.4, 53.8),
        "pop_hist": [11290000, 15669000, 22560000, 24659000, 27280000, 27462000, 24073000, 23170000],
        "badge": "黑土汽车粮仓",
        "summary": "国家黄金玉米带与一汽汽车工业发祥地，长白山生态区与长春光机航天产业底蕴深厚。",
    },
    "230000": {
        "pop": 30_290_000, "emp": 15_600_000, "gdp": 16_476.9, "disp": 31_296,
        "home": 7_600, "growth_5y": 19.6, "growth_24": 3.2, "urb": 68.1,
        "med_age": 43.1, "bach": 14.8, "migrant": 4.2, "broadband": 90.4,
        "commute": 28.0, "own": 88.5, "hgap": 17.8, "low_inc": 10.1,
        "forest": 47.3, "farm": 37.8, "dev": 3.9, "faith_100": 11.2,
        "faith_trad": "多元世俗/无宗教为主", "wellbeing": 69.8, "grain_mt": 8001.7,
        "stem_share": 0.060, "avg_pay": 89_500,
        "sec_pct": (22.4, 28.8, 48.8),
        "pop_hist": [11897000, 20118000, 32666000, 35215000, 36890000, 38312000, 31850000, 30290000],
        "badge": "中华第一大粮仓",
        "summary": "全国粮食总产量突破8000万吨稳居第一，大庆油田、哈工大重器及冰雪文旅协同转型。",
    },
    "310000": {
        "pop": 24_800_000, "emp": 13_680_000, "gdp": 53_926.7, "disp": 88_366,
        "home": 64_200, "growth_5y": 30.2, "growth_24": 5.0, "urb": 89.9,
        "med_age": 41.7, "bach": 33.9, "migrant": 42.1, "broadband": 99.1,
        "commute": 44.5, "own": 70.2, "hgap": 6.2, "low_inc": 2.1,
        "forest": 19.1, "farm": 23.8, "dev": 45.2, "faith_100": 18.0,
        "faith_trad": "多元世俗/无宗教为主", "wellbeing": 84.5, "grain_mt": 98.3,
        "stem_share": 0.145, "avg_pay": 212_000,
        "sec_pct": (0.2, 23.8, 76.0),
        "pop_hist": [6204000, 10816000, 11860000, 13342000, 16738000, 23019000, 24871000, 24800000],
        "badge": "金融中心",
        "summary": "中国内地首个突破5万亿元GDP的国际化大都市，陆家嘴金融中心与洋山世界第一大港双核领先。",
    },
    "320000": {
        "pop": 85_260_000, "emp": 47_600_000, "gdp": 137_008.0, "disp": 55_415,
        "home": 21_200, "growth_5y": 31.8, "growth_24": 5.8, "urb": 75.5,
        "med_age": 40.8, "bach": 18.7, "migrant": 18.5, "broadband": 97.5,
        "commute": 33.5, "own": 88.6, "hgap": 9.4, "low_inc": 3.5,
        "forest": 24.1, "farm": 38.4, "dev": 21.5, "faith_100": 23.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 81.6, "grain_mt": 3810.1,
        "stem_share": 0.098, "avg_pay": 135_000,
        "sec_pct": (3.8, 43.2, 53.0),
        "pop_hist": [37522000, 44505000, 60521000, 67057000, 74380000, 78660000, 84748000, 85260000],
        "badge": "制造强省十三太保",
        "summary": "GDP逼近14万亿且全部13地市跻身全国百强，苏锡常先进制造、南京科教与沿海港口均衡共兴。",
    },
    "330000": {
        "pop": 66_700_000, "emp": 38_400_000, "gdp": 90_100.0, "disp": 67_015,
        "home": 25_600, "growth_5y": 32.1, "growth_24": 5.5, "urb": 75.5,
        "med_age": 39.7, "bach": 17.0, "migrant": 24.8, "broadband": 97.8,
        "commute": 33.0, "own": 85.4, "hgap": 9.0, "low_inc": 3.2,
        "forest": 61.2, "farm": 12.7, "dev": 13.8, "faith_100": 32.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 82.9, "grain_mt": 650.3,
        "stem_share": 0.096, "avg_pay": 142_000,
        "sec_pct": (2.9, 41.2, 55.9),
        "pop_hist": [22866000, 28319000, 38885000, 41446000, 46770000, 54427000, 64568000, 66700000],
        "badge": "数字民营民富首省",
        "summary": "省域居民人均可支配收入连续多年位居全国第一，杭州数字经济与宁波舟山世界第一货运大港辉映。",
    },
    "340000": {
        "pop": 61_230_000, "emp": 33_200_000, "gdp": 50_625.0, "disp": 36_782,
        "home": 11_400, "growth_5y": 34.4, "growth_24": 5.8, "urb": 62.6,
        "med_age": 39.8, "bach": 13.3, "migrant": 8.4, "broadband": 94.1,
        "commute": 30.0, "own": 90.8, "hgap": 15.2, "low_inc": 7.6,
        "forest": 30.4, "farm": 39.2, "dev": 11.8, "faith_100": 22.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 74.2, "grain_mt": 4184.3,
        "stem_share": 0.072, "avg_pay": 103_000,
        "sec_pct": (7.3, 41.0, 51.7),
        "pop_hist": [30344000, 31242000, 49666000, 56181000, 59860000, 59501000, 61027000, 61230000],
        "badge": "徽风科创智造",
        "summary": "2024年GDP跨越5万亿大关，合肥量子信息、新能源汽车与芜湖江淮制造强力崛起。",
    },
    "350000": {
        "pop": 41_930_000, "emp": 23_500_000, "gdp": 57_761.0, "disp": 47_857,
        "home": 19_500, "growth_5y": 31.2, "growth_24": 5.5, "urb": 71.8,
        "med_age": 37.9, "bach": 14.1, "migrant": 16.5, "broadband": 95.6,
        "commute": 30.5, "own": 84.2, "hgap": 12.1, "low_inc": 5.4,
        "forest": 65.1, "farm": 9.8, "dev": 10.6, "faith_100": 52.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 78.4, "grain_mt": 514.4,
        "stem_share": 0.075, "avg_pay": 112_000,
        "sec_pct": (5.7, 45.2, 49.1),
        "pop_hist": [13143000, 16757000, 25931000, 30048000, 34710000, 36894000, 41540000, 41930000],
        "badge": "山海绿肺向海兴",
        "summary": "森林覆盖率65.1%领跑全国，宁德时代动力电池、泉州民营鞋服纺织与厦漳泉港口经济活跃。",
    },
    "360000": {
        "pop": 45_020_000, "emp": 24_100_000, "gdp": 34_202.5, "disp": 36_007,
        "home": 10_100, "growth_5y": 29.8, "growth_24": 5.1, "urb": 63.8,
        "med_age": 37.6, "bach": 11.9, "migrant": 6.5, "broadband": 92.8,
        "commute": 28.0, "own": 91.2, "hgap": 16.8, "low_inc": 8.2,
        "forest": 63.4, "farm": 17.1, "dev": 7.6, "faith_100": 26.5,
        "faith_trad": "道教/民俗信仰", "wellbeing": 73.1, "grain_mt": 2196.0,
        "stem_share": 0.058, "avg_pay": 94_000,
        "sec_pct": (7.5, 42.6, 49.9),
        "pop_hist": [16773000, 21068000, 33185000, 37710000, 41400000, 44567000, 45189000, 45020000],
        "badge": "赣鄱稀土绿林",
        "summary": "江西兼具全国领先森林覆盖率与赣州稀土钨矿、景德镇陶瓷文化及南昌航空电子产业。",
    },
    "370000": {
        "pop": 100_800_000, "emp": 54_800_000, "gdp": 98_566.0, "disp": 42_077,
        "home": 13_200, "growth_5y": 30.6, "growth_24": 5.7, "urb": 66.5,
        "med_age": 40.4, "bach": 14.4, "migrant": 8.9, "broadband": 95.4,
        "commute": 30.5, "own": 90.6, "hgap": 12.6, "low_inc": 5.6,
        "forest": 19.6, "farm": 42.6, "dev": 16.2, "faith_100": 21.5,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 76.8, "grain_mt": 5705.5,
        "stem_share": 0.068, "avg_pay": 105_000,
        "sec_pct": (7.2, 39.8, 53.0),
        "pop_hist": [48877000, 55519000, 74419000, 84393000, 90790000, 95793000, 101527000, 100800000],
        "badge": "齐鲁全业大省",
        "summary": "工业门类最齐全、农业总产值全国第一的北方经济领头羊，青岛、济南、烟台三大强市联动半岛蓝区。",
    },
    "410000": {
        "pop": 97_850_000, "emp": 50_200_000, "gdp": 63_590.0, "disp": 31_552,
        "home": 9_800, "growth_5y": 25.4, "growth_24": 5.1, "urb": 59.2,
        "med_age": 37.9, "bach": 11.7, "migrant": 5.8, "broadband": 93.0,
        "commute": 30.0, "own": 92.1, "hgap": 17.5, "low_inc": 9.8,
        "forest": 25.3, "farm": 45.8, "dev": 13.5, "faith_100": 24.5,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 71.9, "grain_mt": 6716.4,
        "stem_share": 0.052, "avg_pay": 88_000,
        "sec_pct": (9.1, 38.9, 52.0),
        "pop_hist": [44215000, 50325000, 74423000, 85510000, 92560000, 94024000, 99366000, 97850000],
        "badge": "中原粮仓枢纽",
        "summary": "全国米字形高铁网络核心与重要粮食生产加工大省，郑州航空港与洛阳装备制造双城带动。",
    },
    "420000": {
        "pop": 58_340_000, "emp": 31_500_000, "gdp": 60_013.0, "disp": 36_947,
        "home": 12_800, "growth_5y": 33.4, "growth_24": 5.8, "urb": 66.4,
        "med_age": 40.1, "bach": 15.5, "migrant": 9.6, "broadband": 94.5,
        "commute": 33.5, "own": 89.2, "hgap": 13.8, "low_inc": 7.1,
        "forest": 42.2, "farm": 25.6, "dev": 9.8, "faith_100": 19.5,
        "faith_trad": "道教/民俗信仰", "wellbeing": 75.5, "grain_mt": 2785.3,
        "stem_share": 0.078, "avg_pay": 106_000,
        "sec_pct": (8.9, 37.8, 53.3),
        "pop_hist": [27790000, 33709000, 47804000, 53969000, 60280000, 57238000, 57753000, 58340000],
        "badge": "九省通衢光谷芯",
        "summary": "长江中游科教中心与三峡工程所在地，武汉东湖光谷光电子存储芯片及汽车产业链集聚。",
    },
    "430000": {
        "pop": 65_390_000, "emp": 34_800_000, "gdp": 53_231.0, "disp": 37_679,
        "home": 9_900, "growth_5y": 28.4, "growth_24": 4.8, "urb": 62.1,
        "med_age": 39.7, "bach": 13.0, "migrant": 6.8, "broadband": 93.6,
        "commute": 31.0, "own": 90.4, "hgap": 15.6, "low_inc": 7.9,
        "forest": 59.9, "farm": 17.5, "dev": 8.5, "faith_100": 26.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 74.6, "grain_mt": 3078.1,
        "stem_share": 0.065, "avg_pay": 97_000,
        "sec_pct": (9.2, 36.8, 54.0),
        "pop_hist": [33227000, 37182000, 54009000, 60659000, 64400000, 65684000, 66445000, 65390000],
        "badge": "工程机械文娱热土",
        "summary": "全球工程机械与轨道交通制造高地，叠加岳麓山高教圈与长沙极具活力的文娱消费生态。",
    },
    "440000": {
        "pop": 127_800_000, "emp": 71_200_000, "gdp": 141_633.8, "disp": 51_474,
        "home": 28_400, "growth_5y": 27.9, "growth_24": 3.5, "urb": 75.9,
        "med_age": 35.4, "bach": 15.7, "migrant": 31.2, "broadband": 97.6,
        "commute": 37.5, "own": 76.8, "hgap": 10.2, "low_inc": 4.6,
        "forest": 53.1, "farm": 10.7, "dev": 16.4, "faith_100": 42.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 79.8, "grain_mt": 1313.4,
        "stem_share": 0.105, "avg_pay": 139_000,
        "sec_pct": (4.1, 38.4, 57.5),
        "pop_hist": [34770000, 42801000, 59299000, 62829000, 86420000, 104303000, 126013000, 127800000],
        "badge": "岭南十四万亿引擎",
        "summary": "全国人口与GDP连续36年双第一大省，广深珠佛莞大湾区构建世界级数字硬件、新能源汽车与外贸港群。",
    },
    "450000": {
        "pop": 50_130_000, "emp": 26_100_000, "gdp": 28_649.4, "disp": 31_125,
        "home": 8_600, "growth_5y": 26.8, "growth_24": 4.2, "urb": 57.4,
        "med_age": 37.4, "bach": 10.8, "migrant": 5.2, "broadband": 90.2,
        "commute": 26.5, "own": 90.5, "hgap": 19.8, "low_inc": 11.8,
        "forest": 62.5, "farm": 14.1, "dev": 5.4, "faith_100": 29.0,
        "faith_trad": "少数民族传统信仰", "wellbeing": 71.2, "grain_mt": 1403.8,
        "stem_share": 0.045, "avg_pay": 87_000,
        "sec_pct": (16.4, 32.1, 51.5),
        "pop_hist": [19561000, 20845000, 36421000, 42246000, 44890000, 46027000, 50127000, 50130000],
        "badge": "八桂山水面向东盟",
        "summary": "西部陆海新通道重要出海门户与喀斯特山水生态强区，柳州汽车机械与桂林国际旅游名片突出。",
    },
    "460000": {
        "pop": 10_480_000, "emp": 5_620_000, "gdp": 7_935.7, "disp": 34_829,
        "home": 17_800, "growth_5y": 36.2, "growth_24": 3.7, "urb": 63.1,
        "med_age": 36.3, "bach": 13.9, "migrant": 14.6, "broadband": 93.4,
        "commute": 26.0, "own": 84.5, "hgap": 14.2, "low_inc": 7.5,
        "forest": 62.1, "farm": 13.5, "dev": 8.9, "faith_100": 34.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 77.2, "grain_mt": 142.4,
        "stem_share": 0.056, "avg_pay": 101_000,
        "sec_pct": (20.1, 18.8, 61.1),
        "pop_hist": [2500000, 3300000, 5668000, 6557000, 7870000, 8672000, 10081000, 10480000],
        "badge": "南海自贸热带岛",
        "summary": "中国特色自由贸易港与文昌商业航天发射场所在地，热带雨林国家公园及三亚免税旅游蓬勃发展。",
    },
    "500000": {
        "pop": 31_900_000, "emp": 16_950_000, "gdp": 32_193.2, "disp": 39_713,
        "home": 11_600, "growth_5y": 30.8, "growth_24": 5.7, "urb": 72.1,
        "med_age": 41.4, "bach": 15.4, "migrant": 11.2, "broadband": 94.8,
        "commute": 37.0, "own": 86.2, "hgap": 14.1, "low_inc": 6.8,
        "forest": 55.0, "farm": 22.8, "dev": 9.4, "faith_100": 20.5,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 75.8, "grain_mt": 1100.6,
        "stem_share": 0.074, "avg_pay": 107_000,
        "sec_pct": (6.7, 38.6, 54.7),
        "pop_hist": [17600000, 19800000, 26700000, 28866000, 30900000, 28846000, 32054000, 31900000],
        "badge": "山城汽摩枢纽",
        "summary": "中西部唯一直辖市与长江上游航运金融枢纽，2024年新能源汽车爆发带动GDP重返全国城市第四。",
    },
    "510000": {
        "pop": 83_640_000, "emp": 45_200_000, "gdp": 64_697.0, "disp": 34_325,
        "home": 12_400, "growth_5y": 32.5, "growth_24": 5.7, "urb": 60.1,
        "med_age": 40.9, "bach": 13.3, "migrant": 8.5, "broadband": 93.2,
        "commute": 33.0, "own": 89.0, "hgap": 16.5, "low_inc": 9.1,
        "forest": 40.3, "farm": 11.2, "dev": 4.2, "faith_100": 27.5,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 75.2, "grain_mt": 3633.7,
        "stem_share": 0.069, "avg_pay": 102_000,
        "sec_pct": (9.6, 35.8, 54.6),
        "pop_hist": [45000000, 48200000, 73000000, 78350000, 83290000, 80418000, 83675000, 83640000],
        "badge": "天府水电军工",
        "summary": "西部经济总量第一大省，集白鹤滩/乌东德巨型水电、成都电子信息文创及绵阳核电子航天重镇于一身。",
    },
    "520000": {
        "pop": 38_600_000, "emp": 19_600_000, "gdp": 22_667.1, "disp": 28_561,
        "home": 8_200, "growth_5y": 29.4, "growth_24": 5.3, "urb": 56.7,
        "med_age": 36.2, "bach": 11.0, "migrant": 5.8, "broadband": 91.0,
        "commute": 29.0, "own": 90.1, "hgap": 21.4, "low_inc": 13.5,
        "forest": 62.8, "farm": 19.6, "dev": 4.8, "faith_100": 28.0,
        "faith_trad": "少数民族传统信仰", "wellbeing": 69.5, "grain_mt": 1146.1,
        "stem_share": 0.046, "avg_pay": 91_000,
        "sec_pct": (13.4, 34.8, 51.8),
        "pop_hist": [15037000, 17141000, 28553000, 32391000, 35250000, 34746000, 38562000, 38600000],
        "badge": "黔贵喀斯特数谷",
        "summary": "全国大数据东数西算核心枢纽与中国天眼FAST所在地，遵义酱香白酒与喀斯特生态旅游独具特色。",
    },
    "530000": {
        "pop": 46_550_000, "emp": 24_800_000, "gdp": 31_534.1, "disp": 29_932,
        "home": 9_600, "growth_5y": 28.1, "growth_24": 3.3, "urb": 54.1,
        "med_age": 36.9, "bach": 11.6, "migrant": 6.4, "broadband": 90.5,
        "commute": 27.5, "own": 90.6, "hgap": 22.0, "low_inc": 13.2,
        "forest": 65.0, "farm": 14.0, "dev": 3.5, "faith_100": 35.0,
        "faith_trad": "少数民族传统信仰", "wellbeing": 71.8, "grain_mt": 1993.6,
        "stem_share": 0.044, "avg_pay": 92_000,
        "sec_pct": (13.6, 33.4, 53.0),
        "pop_hist": [17473000, 20510000, 32554000, 36973000, 42880000, 45966000, 47209000, 46550000],
        "badge": "彩云绿电生物库",
        "summary": "金沙江梯级水电与高原绿铝基地、全国生物多样性宝库，面向南亚东南亚的文旅与通道门户。",
    },
    "540000": {
        "pop": 3_700_000, "emp": 1_960_000, "gdp": 2_764.9, "disp": 31_358,
        "home": 9_800, "growth_5y": 42.5, "growth_24": 6.3, "urb": 39.7,
        "med_age": 32.4, "bach": 11.0, "migrant": 7.5, "broadband": 88.2,
        "commute": 21.0, "own": 91.0, "hgap": 29.5, "low_inc": 15.8,
        "forest": 12.3, "farm": 0.4, "dev": 0.4, "faith_100": 89.5,
        "faith_trad": "藏传佛教", "wellbeing": 70.2, "grain_mt": 112.9,
        "stem_share": 0.042, "avg_pay": 118_000,
        "sec_pct": (8.8, 37.6, 53.6),
        "pop_hist": [1274000, 1251000, 1892000, 2196000, 2620000, 3002000, 3648000, 3700000],
        "badge": "世界屋脊水塔",
        "summary": "青藏高原核心区与亚洲水塔，2024年GDP增速6.3%领跑全国，布达拉宫圣地文化与清洁能源潜力巨大。",
    },
    "610000": {
        "pop": 39_530_000, "emp": 21_100_000, "gdp": 35_538.8, "disp": 33_905,
        "home": 12_600, "growth_5y": 31.4, "growth_24": 5.3, "urb": 66.1,
        "med_age": 39.4, "bach": 18.4, "migrant": 8.8, "broadband": 93.8,
        "commute": 34.0, "own": 88.2, "hgap": 15.4, "low_inc": 8.4,
        "forest": 46.5, "farm": 14.3, "dev": 6.1, "faith_100": 21.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 74.1, "grain_mt": 1352.4,
        "stem_share": 0.088, "avg_pay": 103_000,
        "sec_pct": (7.5, 45.6, 46.9),
        "pop_hist": [15881000, 20767000, 28904000, 32882000, 36050000, 37327000, 39529000, 39530000],
        "badge": "秦川航天军工科教",
        "summary": "西北科教航空航天军工重镇与十三朝古都文化核心，叠加陕北榆林延安能源化工与关中半导体集群。",
    },
    "620000": {
        "pop": 24_580_000, "emp": 12_800_000, "gdp": 13_002.9, "disp": 26_612,
        "home": 7_800, "growth_5y": 32.0, "growth_24": 5.8, "urb": 56.8,
        "med_age": 38.1, "bach": 14.5, "migrant": 4.9, "broadband": 89.8,
        "commute": 26.5, "own": 90.4, "hgap": 22.8, "low_inc": 14.6,
        "forest": 11.4, "farm": 12.2, "dev": 2.4, "faith_100": 29.5,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 68.4, "grain_mt": 1296.2,
        "stem_share": 0.052, "avg_pay": 89_000,
        "sec_pct": (12.8, 35.1, 52.1),
        "pop_hist": [12928000, 12631000, 19569000, 22371000, 25620000, 25575000, 25020000, 24580000],
        "badge": "河西走廊绿氢风电",
        "summary": "丝绸之路黄金段与酒泉千万千瓦风光电及航天发射枢纽，拥有敦煌莫高窟、金昌镍钴有色金属基地。",
    },
    "630000": {
        "pop": 5_930_000, "emp": 3_120_000, "gdp": 3_950.8, "disp": 30_117,
        "home": 8_500, "growth_5y": 24.8, "growth_24": 2.7, "urb": 63.9,
        "med_age": 35.8, "bach": 14.9, "migrant": 7.2, "broadband": 89.5,
        "commute": 23.0, "own": 87.8, "hgap": 24.5, "low_inc": 12.5,
        "forest": 7.5, "farm": 0.9, "dev": 0.6, "faith_100": 54.0,
        "faith_trad": "藏传佛教", "wellbeing": 69.9, "grain_mt": 118.3,
        "stem_share": 0.055, "avg_pay": 104_000,
        "sec_pct": (9.6, 41.8, 48.6),
        "pop_hist": [1677000, 2146000, 3896000, 4457000, 5180000, 5627000, 5924000, 5930000],
        "badge": "三江源锂光生态",
        "summary": "三江源国家公园中华水塔所在，柴达木盐湖锂钾产业与海南州/海西州特高压清洁光伏基地领跑全国。",
    },
    "640000": {
        "pop": 7_290_000, "emp": 3_780_000, "gdp": 5_502.8, "disp": 33_355,
        "home": 7_900, "growth_5y": 31.6, "growth_24": 5.4, "urb": 68.2,
        "med_age": 36.7, "bach": 17.3, "migrant": 8.4, "broadband": 92.2,
        "commute": 24.0, "own": 88.5, "hgap": 18.6, "low_inc": 10.2,
        "forest": 16.9, "farm": 22.8, "dev": 4.9, "faith_100": 42.0,
        "faith_trad": "伊斯兰教", "wellbeing": 71.5, "grain_mt": 385.9,
        "stem_share": 0.057, "avg_pay": 98_000,
        "sec_pct": (7.8, 46.2, 46.0),
        "pop_hist": [1500000, 2108000, 3896000, 4655000, 5620000, 6301000, 7203000, 7290000],
        "badge": "塞上江南算力能源",
        "summary": "宁东现代煤化工基地与中卫西部算力枢纽并进，贺兰山东麓葡萄酒与枸杞农业品牌突出。",
    },
    "650000": {
        "pop": 26_230_000, "emp": 13_950_000, "gdp": 20_534.1, "disp": 30_899,
        "home": 8_100, "growth_5y": 36.8, "growth_24": 6.1, "urb": 60.4,
        "med_age": 34.9, "bach": 16.5, "migrant": 12.4, "broadband": 91.4,
        "commute": 24.5, "own": 88.0, "hgap": 20.4, "low_inc": 11.4,
        "forest": 5.1, "farm": 4.3, "dev": 1.1, "faith_100": 62.0,
        "faith_trad": "伊斯兰教", "wellbeing": 72.3, "grain_mt": 2330.1,
        "stem_share": 0.054, "avg_pay": 102_000,
        "sec_pct": (14.2, 41.2, 44.6),
        "pop_hist": [4874000, 7270000, 13082000, 15156000, 19250000, 21813000, 25852000, 26230000],
        "badge": "丝路油气棉粮宝库",
        "summary": "亚欧大陆桥核心与国家能源战略大通道，准噶尔/塔里木油气、准东煤炭、全国九成棉花与中欧班列西通道。",
    },
    "710000": {
        "pop": 23_410_000, "emp": 11_590_000, "gdp": 56_700.0, "disp": 93_851,
        "home": 54_000, "growth_5y": 24.5, "growth_24": 4.6, "urb": 82.5,
        "med_age": 44.2, "bach": 46.0, "migrant": 18.0, "broadband": 98.2,
        "commute": 33.0, "own": 84.6, "hgap": 7.5, "low_inc": 2.6,
        "forest": 60.7, "farm": 21.8, "dev": 13.5, "faith_100": 68.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 81.2, "grain_mt": 165.0,
        "stem_share": 0.135, "avg_pay": 188_000,
        "sec_pct": (1.4, 38.8, 59.8),
        "pop_hist": [8438000, 12257000, 18458000, 20353000, 22277000, 23162000, 23561000, 23410000],
        "badge": "海峡晶圆制造岛",
        "summary": "全球先进半导体晶圆代工与精密电子制造核心基地，兼具台北金融航运与中央山脉高森林覆盖生态。",
    },
    "810000": {
        "pop": 7_524_000, "emp": 3_710_000, "gdp": 29_000.0, "disp": 182_000,
        "home": 138_000, "growth_5y": 14.2, "growth_24": 2.5, "urb": 100.0,
        "med_age": 46.5, "bach": 38.5, "migrant": 36.0, "broadband": 99.5,
        "commute": 42.0, "own": 51.5, "hgap": 6.0, "low_inc": 5.2,
        "forest": 41.0, "farm": 2.5, "dev": 25.0, "faith_100": 46.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 81.8, "grain_mt": 2.0,
        "stem_share": 0.095, "avg_pay": 265_000,
        "sec_pct": (0.1, 6.3, 93.6),
        "pop_hist": [2242000, 3505000, 5264000, 5704000, 6665000, 7024000, 7481000, 7524000],
        "badge": "东方国际金融港",
        "summary": "国际金融、离岸人民币清算、自由贸易港与全球航运航空枢纽，背靠大湾区打造国际创科中心。",
    },
    "820000": {
        "pop": 686_000, "emp": 380_000, "gdp": 3_574.0, "disp": 168_000,
        "home": 86_000, "growth_5y": 16.5, "growth_24": 8.8, "urb": 100.0,
        "med_age": 40.5, "bach": 31.0, "migrant": 45.0, "broadband": 99.2,
        "commute": 22.0, "own": 71.0, "hgap": 7.2, "low_inc": 3.0,
        "forest": 24.0, "farm": 0.5, "dev": 68.0, "faith_100": 58.0,
        "faith_trad": "汉传佛教/民间信仰", "wellbeing": 80.5, "grain_mt": 0.2,
        "stem_share": 0.062, "avg_pay": 224_000,
        "sec_pct": (0.0, 5.4, 94.6),
        "pop_hist": [188000, 210000, 256000, 339000, 431000, 552000, 683000, 686000],
        "badge": "濠江文旅会展港",
        "summary": "世界旅游休闲中心与中西文化交融世遗名城，横琴粤澳深度合作区赋能中医药科技与现代金融。",
    },
}


# ---------------------------------------------------------------------------
# 3. 90 Major Cities (All 34 provincial anchors + 56 industrial/coastal/regional hubs)
# ---------------------------------------------------------------------------
# tuple fields:
# (id, adcode, name, full, p_idx, is_anchor, lon, lat, pop, gdp, disp, home,
#  growth5y, unemp, stem_share, avg_pay, urb, med_age, bach, badge, spec_tag)
# spec_tag guides Civ district specialization: fin/tech/mfg/port/energy/culture/mil/agri/tourism
CITIES_DATA: list[dict[str, Any]] = [
    # --- 34 Provincial Anchors ---
    {"id": "beijing", "adcode": "110000", "name": "北京", "full": "北京市", "p_idx": 0, "anchor": True, "lon": 116.407, "lat": 39.904, "pop": 21_830_000, "gdp": 49_843.1, "disp": 85_415, "home": 56_800, "g5": 32.8, "unemp": 4.0, "stem": 0.170, "pay": 218_000, "urb": 88.2, "age": 40.4, "bach": 42.0, "badge": "双学院科技首善", "tag": "capital_tech"},
    {"id": "tianjin", "adcode": "120000", "name": "天津", "full": "天津市", "p_idx": 1, "anchor": True, "lon": 117.201, "lat": 39.085, "pop": 13_640_000, "gdp": 18_024.3, "disp": 53_581, "home": 23_500, "g5": 24.5, "unemp": 4.4, "stem": 0.098, "pay": 138_000, "urb": 86.0, "age": 41.1, "bach": 26.9, "badge": "北方航运港城", "tag": "port_mfg"},
    {"id": "shijiazhuang", "adcode": "130100", "name": "石家庄", "full": "石家庄市", "p_idx": 2, "anchor": True, "lon": 114.515, "lat": 38.042, "pop": 11_246_600, "gdp": 8_203.4, "disp": 39_800, "home": 13_200, "g5": 30.2, "unemp": 4.2, "stem": 0.078, "pay": 102_000, "urb": 72.1, "age": 38.5, "bach": 19.8, "badge": "医药电子省会", "tag": "mfg_rail"},
    {"id": "taiyuan", "adcode": "140100", "name": "太原", "full": "太原市", "p_idx": 3, "anchor": True, "lon": 112.549, "lat": 37.871, "pop": 5_514_700, "gdp": 5_418.9, "disp": 42_100, "home": 11_400, "g5": 26.4, "unemp": 4.1, "stem": 0.089, "pay": 104_000, "urb": 89.3, "age": 37.9, "bach": 26.8, "badge": "三晋特种钢与科研", "tag": "mfg_space"},
    {"id": "hohhot", "adcode": "150100", "name": "呼和浩特", "full": "呼和浩特市", "p_idx": 4, "anchor": True, "lon": 111.749, "lat": 40.842, "pop": 3_639_000, "gdp": 4_107.1, "disp": 46_200, "home": 10_600, "g5": 36.5, "unemp": 4.0, "stem": 0.086, "pay": 106_000, "urb": 81.2, "age": 38.4, "bach": 27.5, "badge": "乳业云算力草原城", "tag": "tech_agri"},
    {"id": "shenyang", "adcode": "210100", "name": "沈阳", "full": "沈阳市", "p_idx": 5, "anchor": True, "lon": 123.431, "lat": 41.806, "pop": 9_243_000, "gdp": 9_027.1, "disp": 47_600, "home": 11_800, "g5": 28.4, "unemp": 4.3, "stem": 0.095, "pay": 108_000, "urb": 85.2, "age": 42.6, "bach": 25.4, "badge": "航空重装之都", "tag": "mfg_mil"},
    {"id": "changchun", "adcode": "220100", "name": "长春", "full": "长春市", "p_idx": 6, "anchor": True, "lon": 125.324, "lat": 43.817, "pop": 9_085_100, "gdp": 7_632.2, "disp": 40_500, "home": 9_400, "g5": 22.8, "unemp": 4.4, "stem": 0.084, "pay": 99_000, "urb": 67.5, "age": 41.8, "bach": 22.6, "badge": "汽车光机摇篮", "tag": "mfg_campus"},
    {"id": "harbin", "adcode": "230100", "name": "哈尔滨", "full": "哈尔滨市", "p_idx": 7, "anchor": True, "lon": 126.535, "lat": 45.803, "pop": 9_858_000, "gdp": 6_016.3, "disp": 39_600, "home": 9_800, "g5": 20.5, "unemp": 4.5, "stem": 0.082, "pay": 98_000, "urb": 71.8, "age": 42.8, "bach": 21.5, "badge": "冰城航天重工", "tag": "campus_tourism"},
    {"id": "shanghai", "adcode": "310000", "name": "上海", "full": "上海市", "p_idx": 8, "anchor": True, "lon": 121.474, "lat": 31.230, "pop": 24_800_000, "gdp": 53_926.7, "disp": 88_366, "home": 64_200, "g5": 30.2, "unemp": 4.1, "stem": 0.145, "pay": 212_000, "urb": 89.9, "age": 41.7, "bach": 33.9, "badge": "金融中心", "tag": "fin_port"},
    {"id": "nanjing", "adcode": "320100", "name": "南京", "full": "南京市", "p_idx": 9, "anchor": True, "lon": 118.797, "lat": 32.060, "pop": 9_547_000, "gdp": 18_500.8, "disp": 74_800, "home": 29_800, "g5": 29.6, "unemp": 3.8, "stem": 0.138, "pay": 162_000, "urb": 87.3, "age": 38.9, "bach": 35.2, "badge": "六朝古都科教核", "tag": "campus_tech"},
    {"id": "hangzhou", "adcode": "330100", "name": "杭州", "full": "杭州市", "p_idx": 10, "anchor": True, "lon": 120.155, "lat": 30.274, "pop": 12_624_000, "gdp": 21_860.0, "disp": 76_400, "home": 33_200, "g5": 34.5, "unemp": 3.7, "stem": 0.158, "pay": 174_000, "urb": 84.5, "age": 38.2, "bach": 29.8, "badge": "数字经济第一城", "tag": "tech_culture"},
    {"id": "hefei", "adcode": "340100", "name": "合肥", "full": "合肥市", "p_idx": 11, "anchor": True, "lon": 117.227, "lat": 31.821, "pop": 10_002_000, "gdp": 13_507.7, "disp": 54_800, "home": 18_600, "g5": 42.1, "unemp": 3.8, "stem": 0.132, "pay": 136_000, "urb": 85.4, "age": 36.8, "bach": 26.8, "badge": "量子与新能车科创城", "tag": "tech_mfg"},
    {"id": "fuzhou", "adcode": "350100", "name": "福州", "full": "福州市", "p_idx": 12, "anchor": True, "lon": 119.296, "lat": 26.075, "pop": 8_501_000, "gdp": 14_236.8, "disp": 51_200, "home": 22_400, "g5": 35.4, "unemp": 3.9, "stem": 0.088, "pay": 121_000, "urb": 74.2, "age": 37.8, "bach": 20.5, "badge": "榕城软件数字港", "tag": "port_tech"},
    {"id": "nanchang", "adcode": "360100", "name": "南昌", "full": "南昌市", "p_idx": 13, "anchor": True, "lon": 115.858, "lat": 28.683, "pop": 6_670_400, "gdp": 7_800.4, "disp": 46_800, "home": 12_800, "g5": 31.2, "unemp": 4.0, "stem": 0.082, "pay": 108_000, "urb": 79.4, "age": 35.9, "bach": 22.8, "badge": "赣江航空光电城", "tag": "mfg_campus"},
    {"id": "jinan", "adcode": "370100", "name": "济南", "full": "济南市", "p_idx": 14, "anchor": True, "lon": 117.120, "lat": 36.651, "pop": 9_514_700, "gdp": 13_527.6, "disp": 53_400, "home": 16_800, "g5": 33.8, "unemp": 3.9, "stem": 0.104, "pay": 126_000, "urb": 75.8, "age": 39.2, "bach": 24.5, "badge": "泉城超算重工", "tag": "tech_gov"},
    {"id": "zhengzhou", "adcode": "410100", "name": "郑州", "full": "郑州市", "p_idx": 15, "anchor": True, "lon": 113.625, "lat": 34.747, "pop": 13_086_000, "gdp": 14_532.1, "disp": 44_600, "home": 13_600, "g5": 28.5, "unemp": 4.1, "stem": 0.086, "pay": 112_000, "urb": 80.2, "age": 35.2, "bach": 22.4, "badge": "中原铁路空港枢", "tag": "mfg_rail"},
    {"id": "wuhan", "adcode": "420100", "name": "武汉", "full": "武汉市", "p_idx": 16, "anchor": True, "lon": 114.305, "lat": 30.593, "pop": 13_809_000, "gdp": 21_106.2, "disp": 58_600, "home": 17_400, "g5": 34.6, "unemp": 4.0, "stem": 0.128, "pay": 134_000, "urb": 84.9, "age": 38.4, "bach": 30.8, "badge": "光谷高教名城", "tag": "campus_tech"},
    {"id": "changsha", "adcode": "430100", "name": "长沙", "full": "长沙市", "p_idx": 17, "anchor": True, "lon": 112.939, "lat": 28.228, "pop": 10_617_000, "gdp": 15_268.8, "disp": 61_200, "home": 11_500, "g5": 31.8, "unemp": 3.8, "stem": 0.108, "pay": 128_000, "urb": 83.6, "age": 37.2, "bach": 26.8, "badge": "工程机械文创星城", "tag": "mfg_culture"},
    {"id": "guangzhou", "adcode": "440100", "name": "广州", "full": "广州市", "p_idx": 18, "anchor": True, "lon": 113.264, "lat": 23.129, "pop": 18_978_000, "gdp": 31_032.5, "disp": 78_200, "home": 36_800, "g5": 24.1, "unemp": 3.9, "stem": 0.122, "pay": 164_000, "urb": 87.2, "age": 35.6, "bach": 27.6, "badge": "千年商都大湾枢纽", "tag": "fin_port"},
    {"id": "nanning", "adcode": "450100", "name": "南宁", "full": "南宁市", "p_idx": 19, "anchor": True, "lon": 108.366, "lat": 22.817, "pop": 8_971_900, "gdp": 5_995.4, "disp": 36_900, "home": 11_200, "g5": 27.6, "unemp": 4.2, "stem": 0.068, "pay": 98_000, "urb": 71.2, "age": 35.8, "bach": 19.4, "badge": "东盟绿城门户", "tag": "gov_trade"},
    {"id": "haikou", "adcode": "460100", "name": "海口", "full": "海口市", "p_idx": 20, "anchor": True, "lon": 110.331, "lat": 20.031, "pop": 3_031_000, "gdp": 2_470.6, "disp": 42_500, "home": 17_200, "g5": 38.4, "unemp": 4.0, "stem": 0.072, "pay": 112_000, "urb": 83.2, "age": 35.1, "bach": 22.4, "badge": "琼州自贸港", "tag": "port_tourism"},
    {"id": "chongqing", "adcode": "500000", "name": "重庆", "full": "重庆市", "p_idx": 21, "anchor": True, "lon": 106.551, "lat": 29.563, "pop": 31_900_000, "gdp": 32_193.2, "disp": 39_713, "home": 11_600, "g5": 30.8, "unemp": 4.2, "stem": 0.074, "pay": 107_000, "urb": 72.1, "age": 41.4, "bach": 15.4, "badge": "山城汽摩枢纽", "tag": "mfg_port"},
    {"id": "chengdu", "adcode": "510100", "name": "成都", "full": "成都市", "p_idx": 22, "anchor": True, "lon": 104.066, "lat": 30.572, "pop": 21_474_000, "gdp": 23_511.3, "disp": 51_800, "home": 18_400, "g5": 32.6, "unemp": 3.9, "stem": 0.118, "pay": 131_000, "urb": 80.8, "age": 38.5, "bach": 25.6, "badge": "天府电子文创都", "tag": "tech_culture"},
    {"id": "guiyang", "adcode": "520100", "name": "贵阳", "full": "贵阳市", "p_idx": 23, "anchor": True, "lon": 106.630, "lat": 26.647, "pop": 6_452_000, "gdp": 5_777.4, "disp": 42_100, "home": 10_800, "g5": 33.8, "unemp": 4.1, "stem": 0.088, "pay": 106_000, "urb": 80.4, "age": 35.4, "bach": 23.8, "badge": "中国数谷避暑城", "tag": "tech_tourism"},
    {"id": "kunming", "adcode": "530100", "name": "昆明", "full": "昆明市", "p_idx": 24, "anchor": True, "lon": 102.833, "lat": 24.880, "pop": 8_687_000, "gdp": 8_275.2, "disp": 45_200, "home": 13_400, "g5": 25.4, "unemp": 4.0, "stem": 0.075, "pay": 109_000, "urb": 81.5, "age": 36.8, "bach": 22.1, "badge": "春城花都南亚门户", "tag": "tourism_campus"},
    {"id": "lhasa", "adcode": "540100", "name": "拉萨", "full": "拉萨市", "p_idx": 25, "anchor": True, "lon": 91.117, "lat": 29.647, "pop": 876_400, "gdp": 990.0, "disp": 44_800, "home": 13_800, "g5": 44.2, "unemp": 3.5, "stem": 0.068, "pay": 134_000, "urb": 71.5, "age": 32.1, "bach": 22.6, "badge": "雪域圣城日光都", "tag": "holy_tourism"},
    {"id": "xian", "adcode": "610100", "name": "西安", "full": "西安市", "p_idx": 26, "anchor": True, "lon": 108.940, "lat": 34.341, "pop": 13_167_600, "gdp": 13_317.8, "disp": 44_900, "home": 16_900, "g5": 31.5, "unemp": 4.0, "stem": 0.136, "pay": 124_000, "urb": 80.1, "age": 37.8, "bach": 31.2, "badge": "长安航天古都", "tag": "campus_space"},
    {"id": "lanzhou", "adcode": "620100", "name": "兰州", "full": "兰州市", "p_idx": 27, "anchor": True, "lon": 103.834, "lat": 36.061, "pop": 4_436_500, "gdp": 3_742.3, "disp": 40_800, "home": 11_400, "g5": 28.4, "unemp": 4.1, "stem": 0.088, "pay": 105_000, "urb": 84.5, "age": 38.2, "bach": 26.4, "badge": "黄河石化重镇", "tag": "energy_campus"},
    {"id": "xining", "adcode": "630100", "name": "西宁", "full": "西宁市", "p_idx": 28, "anchor": True, "lon": 101.778, "lat": 36.617, "pop": 2_495_000, "gdp": 1_862.4, "disp": 37_200, "home": 10_200, "g5": 29.8, "unemp": 4.0, "stem": 0.072, "pay": 108_000, "urb": 80.2, "age": 36.4, "bach": 23.5, "badge": "夏都绿电锂港", "tag": "energy_gov"},
    {"id": "yinchuan", "adcode": "640100", "name": "银川", "full": "银川市", "p_idx": 29, "anchor": True, "lon": 106.231, "lat": 38.487, "pop": 2_914_700, "gdp": 2_939.5, "disp": 40_600, "home": 9_400, "g5": 35.8, "unemp": 4.0, "stem": 0.078, "pay": 105_000, "urb": 81.8, "age": 36.2, "bach": 24.8, "badge": "塞上算力明珠", "tag": "energy_tech"},
    {"id": "urumqi", "adcode": "650100", "name": "乌鲁木齐", "full": "乌鲁木齐市", "p_idx": 30, "anchor": True, "lon": 87.617, "lat": 43.825, "pop": 4_128_400, "gdp": 4_502.2, "disp": 44_200, "home": 9_800, "g5": 33.4, "unemp": 4.0, "stem": 0.085, "pay": 114_000, "urb": 96.6, "age": 37.0, "bach": 28.4, "badge": "亚欧陆桥枢纽", "tag": "trade_energy"},
    {"id": "taipei", "adcode": "710100", "name": "台北", "full": "台北市", "p_idx": 31, "anchor": True, "lon": 121.565, "lat": 25.033, "pop": 2_505_000, "gdp": 16_400.0, "disp": 115_000, "home": 118_000, "g5": 22.8, "unemp": 3.3, "stem": 0.148, "pay": 225_000, "urb": 100.0, "age": 45.2, "bach": 54.0, "badge": "海峡文创金融中心", "tag": "fin_campus"},
    {"id": "hongkong", "adcode": "810000", "name": "香港", "full": "香港特别行政区", "p_idx": 32, "anchor": True, "lon": 114.169, "lat": 22.319, "pop": 7_524_000, "gdp": 29_000.0, "disp": 182_000, "home": 138_000, "g5": 14.2, "unemp": 3.1, "stem": 0.095, "pay": 265_000, "urb": 100.0, "age": 46.5, "bach": 38.5, "badge": "东方国际金融港", "tag": "fin_port"},
    {"id": "macau", "adcode": "820000", "name": "澳门", "full": "澳门特别行政区", "p_idx": 33, "anchor": True, "lon": 113.543, "lat": 22.199, "pop": 686_000, "gdp": 3_574.0, "disp": 168_000, "home": 86_000, "g5": 16.5, "unemp": 2.4, "stem": 0.062, "pay": 224_000, "urb": 100.0, "age": 40.5, "bach": 31.0, "badge": "濠江文旅会展港", "tag": "tourism_fin"},

    # --- 56 Major Sub-Provincial, Industrial, Coastal & Regional Hubs (Total = 90) ---
    {"id": "shenzhen", "adcode": "440300", "name": "深圳", "full": "深圳市", "p_idx": 18, "anchor": False, "lon": 114.058, "lat": 22.543, "pop": 17_989_500, "gdp": 36_801.9, "disp": 81_500, "home": 58_400, "g5": 31.4, "unemp": 3.5, "stem": 0.200, "pay": 216_000, "urb": 100.0, "age": 32.8, "bach": 28.9, "badge": "科创智造都", "tag": "sz_tech"},
    {"id": "suzhou", "adcode": "320500", "name": "苏州", "full": "苏州市", "p_idx": 9, "anchor": False, "lon": 120.585, "lat": 31.299, "pop": 12_972_500, "gdp": 26_727.0, "disp": 77_500, "home": 24_800, "g5": 32.5, "unemp": 3.5, "stem": 0.146, "pay": 158_000, "urb": 82.8, "age": 38.4, "bach": 24.6, "badge": "最强地级智造园林", "tag": "mfg_tech"},
    {"id": "ningbo", "adcode": "330200", "name": "宁波", "full": "宁波市", "p_idx": 10, "anchor": False, "lon": 121.544, "lat": 29.868, "pop": 9_737_000, "gdp": 18_147.7, "disp": 74_200, "home": 23_900, "g5": 34.8, "unemp": 3.6, "stem": 0.105, "pay": 146_000, "urb": 79.9, "age": 39.5, "bach": 21.8, "badge": "世界第一货运港", "tag": "port_mfg"},
    {"id": "qingdao", "adcode": "370200", "name": "青岛", "full": "青岛市", "p_idx": 14, "anchor": False, "lon": 120.383, "lat": 36.067, "pop": 10_342_000, "gdp": 16_719.5, "disp": 58_600, "home": 20_400, "g5": 34.2, "unemp": 3.8, "stem": 0.102, "pay": 132_000, "urb": 78.6, "age": 39.8, "bach": 23.6, "badge": "海洋科创大港", "tag": "port_mfg"},
    {"id": "wuxi", "adcode": "320200", "name": "无锡", "full": "无锡市", "p_idx": 9, "anchor": False, "lon": 120.312, "lat": 31.491, "pop": 7_500_000, "gdp": 16_263.3, "disp": 72_400, "home": 20_800, "g5": 31.4, "unemp": 3.6, "stem": 0.126, "pay": 148_000, "urb": 83.2, "age": 40.2, "bach": 22.8, "badge": "物联网集成电路核", "tag": "mfg_tech"},
    {"id": "foshan", "adcode": "440600", "name": "佛山", "full": "佛山市", "p_idx": 18, "anchor": False, "lon": 113.121, "lat": 23.021, "pop": 9_661_000, "gdp": 13_361.9, "disp": 69_200, "home": 18_900, "g5": 23.5, "unemp": 3.8, "stem": 0.095, "pay": 134_000, "urb": 95.2, "age": 34.8, "bach": 17.5, "badge": "家居机器人智造城", "tag": "mfg_trade"},
    {"id": "quanzhou", "adcode": "350500", "name": "泉州", "full": "泉州市", "p_idx": 12, "anchor": False, "lon": 118.675, "lat": 24.874, "pop": 8_914_000, "gdp": 13_094.9, "disp": 52_400, "home": 14_200, "g5": 28.9, "unemp": 3.8, "stem": 0.072, "pay": 112_000, "urb": 70.6, "age": 36.5, "bach": 13.8, "badge": "海丝民营智造名城", "tag": "mfg_port"},
    {"id": "nantong", "adcode": "320600", "name": "南通", "full": "南通市", "p_idx": 9, "anchor": False, "lon": 120.894, "lat": 31.980, "pop": 7_748_000, "gdp": 12_421.9, "disp": 54_600, "home": 15_600, "g5": 24.2, "unemp": 3.9, "stem": 0.078, "pay": 119_000, "urb": 73.1, "age": 44.1, "bach": 16.4, "badge": "江海海工建筑之乡", "tag": "port_mfg"},
    {"id": "dongguan", "adcode": "441900", "name": "东莞", "full": "东莞市", "p_idx": 18, "anchor": False, "lon": 113.752, "lat": 23.021, "pop": 10_486_000, "gdp": 12_282.2, "disp": 68_400, "home": 24_600, "g5": 27.2, "unemp": 3.9, "stem": 0.118, "pay": 132_000, "urb": 92.4, "age": 33.4, "bach": 15.2, "badge": "世界智能终端工厂", "tag": "mfg_tech"},
    {"id": "changzhou", "adcode": "320400", "name": "常州", "full": "常州市", "p_idx": 9, "anchor": False, "lon": 119.974, "lat": 31.811, "pop": 5_375_000, "gdp": 10_813.6, "disp": 65_100, "home": 17_800, "g5": 36.8, "unemp": 3.7, "stem": 0.112, "pay": 136_000, "urb": 78.9, "age": 39.8, "bach": 20.4, "badge": "新能源之都", "tag": "mfg_tech"},
    {"id": "yantai", "adcode": "370600", "name": "烟台", "full": "烟台市", "p_idx": 14, "anchor": False, "lon": 121.448, "lat": 37.464, "pop": 7_035_200, "gdp": 10_782.8, "disp": 49_800, "home": 12_600, "g5": 37.6, "unemp": 3.8, "stem": 0.084, "pay": 114_000, "urb": 69.2, "age": 42.1, "bach": 17.6, "badge": "万亿海工核电港", "tag": "port_mfg"},
    {"id": "tangshan", "adcode": "130200", "name": "唐山", "full": "唐山市", "p_idx": 2, "anchor": False, "lon": 118.180, "lat": 39.631, "pop": 7_706_000, "gdp": 10_003.9, "disp": 44_200, "home": 10_600, "g5": 34.5, "unemp": 4.1, "stem": 0.068, "pay": 108_000, "urb": 67.4, "age": 41.0, "bach": 14.5, "badge": "河北首座万亿钢铁港", "tag": "port_mfg"},
    {"id": "wenzhou", "adcode": "330300", "name": "温州", "full": "温州市", "p_idx": 10, "anchor": False, "lon": 120.699, "lat": 27.994, "pop": 9_760_000, "gdp": 9_718.9, "disp": 69_800, "home": 21_400, "g5": 35.8, "unemp": 3.8, "stem": 0.078, "pay": 131_000, "urb": 74.8, "age": 38.6, "bach": 14.9, "badge": "民营商帮电气港", "tag": "mfg_trade"},
    {"id": "xuzhou", "adcode": "320300", "name": "徐州", "full": "徐州市", "p_idx": 9, "anchor": False, "lon": 117.284, "lat": 34.205, "pop": 9_020_000, "gdp": 9_537.1, "disp": 41_800, "home": 11_800, "g5": 30.2, "unemp": 4.0, "stem": 0.074, "pay": 105_000, "urb": 68.4, "age": 38.6, "bach": 16.5, "badge": "淮海工程机械枢", "tag": "mfg_rail"},
    {"id": "dalian", "adcode": "210200", "name": "大连", "full": "大连市", "p_idx": 5, "anchor": False, "lon": 121.615, "lat": 38.914, "pop": 7_452_000, "gdp": 9_516.9, "disp": 50_600, "home": 15_200, "g5": 35.1, "unemp": 4.1, "stem": 0.104, "pay": 118_000, "urb": 83.2, "age": 42.5, "bach": 24.5, "badge": "东北亚航运造船港", "tag": "port_tech"},
    {"id": "xiamen", "adcode": "350200", "name": "厦门", "full": "厦门市", "p_idx": 12, "anchor": False, "lon": 118.089, "lat": 24.479, "pop": 5_350_000, "gdp": 8_589.0, "disp": 74_800, "home": 43_200, "g5": 34.6, "unemp": 3.7, "stem": 0.118, "pay": 154_000, "urb": 90.8, "age": 34.8, "bach": 27.6, "badge": "鹭岛高颜值光电港", "tag": "port_tech"},
    {"id": "shaoxing", "adcode": "330600", "name": "绍兴", "full": "绍兴市", "p_idx": 10, "anchor": False, "lon": 120.580, "lat": 30.030, "pop": 5_394_000, "gdp": 8_369.0, "disp": 73_200, "home": 18_400, "g5": 34.2, "unemp": 3.6, "stem": 0.088, "pay": 135_000, "urb": 74.2, "age": 41.2, "bach": 17.5, "badge": "集成电路与越州名城", "tag": "mfg_culture"},
    {"id": "yangzhou", "adcode": "321000", "name": "扬州", "full": "扬州市", "p_idx": 9, "anchor": False, "lon": 119.413, "lat": 32.394, "pop": 4_586_000, "gdp": 7_809.6, "disp": 50_200, "home": 14_200, "g5": 29.1, "unemp": 3.8, "stem": 0.082, "pay": 116_000, "urb": 73.5, "age": 42.6, "bach": 17.8, "badge": "运河智造文旅名城", "tag": "culture_mfg"},
    {"id": "jiaxing", "adcode": "330400", "name": "嘉兴", "full": "嘉兴市", "p_idx": 10, "anchor": False, "lon": 120.755, "lat": 30.747, "pop": 5_584_000, "gdp": 7_569.5, "disp": 68_400, "home": 17_200, "g5": 36.8, "unemp": 3.6, "stem": 0.096, "pay": 131_000, "urb": 74.6, "age": 38.8, "bach": 18.2, "badge": "沪杭枢纽光电制造", "tag": "mfg_tech"},
    {"id": "yulin", "adcode": "610800", "name": "榆林", "full": "榆林市", "p_idx": 26, "anchor": False, "lon": 109.734, "lat": 38.285, "pop": 3_624_000, "gdp": 7_548.7, "disp": 35_400, "home": 9_600, "g5": 78.2, "unemp": 3.9, "stem": 0.062, "pay": 118_000, "urb": 64.2, "age": 35.8, "bach": 14.8, "badge": "中国科威特能化城", "tag": "energy_mfg"},
    {"id": "yancheng", "adcode": "320900", "name": "盐城", "full": "盐城市", "p_idx": 9, "anchor": False, "lon": 120.163, "lat": 33.347, "pop": 6_689_000, "gdp": 7_779.2, "disp": 44_200, "home": 11_400, "g5": 28.6, "unemp": 4.0, "stem": 0.070, "pay": 109_000, "urb": 67.8, "age": 42.4, "bach": 15.1, "badge": "海上风电湿地产粮城", "tag": "energy_agri"},
    {"id": "weifang", "adcode": "370700", "name": "潍坊", "full": "潍坊市", "p_idx": 14, "anchor": False, "lon": 119.162, "lat": 36.707, "pop": 9_350_000, "gdp": 8_203.2, "disp": 46_200, "home": 9_600, "g5": 35.2, "unemp": 3.9, "stem": 0.072, "pay": 106_000, "urb": 66.8, "age": 39.6, "bach": 15.8, "badge": "动力装备蔬菜之都", "tag": "mfg_agri"},
    {"id": "jinhua", "adcode": "330700", "name": "金华", "full": "金华市", "p_idx": 10, "anchor": False, "lon": 119.647, "lat": 29.079, "pop": 7_163_000, "gdp": 6_925.5, "disp": 64_800, "home": 18_200, "g5": 42.4, "unemp": 3.7, "stem": 0.076, "pay": 124_000, "urb": 71.2, "age": 37.8, "bach": 15.6, "badge": "义乌全球小商品枢", "tag": "trade_mfg"},
    {"id": "taizhou_zj", "adcode": "331000", "name": "台州", "full": "台州市", "p_idx": 10, "anchor": False, "lon": 121.421, "lat": 28.656, "pop": 6_712_000, "gdp": 6_656.4, "disp": 63_200, "home": 16_800, "g5": 25.8, "unemp": 3.7, "stem": 0.074, "pay": 122_000, "urb": 65.4, "age": 40.1, "bach": 13.9, "badge": "汽车医药精密制造", "tag": "mfg_port"},
    {"id": "linyi", "adcode": "371300", "name": "临沂", "full": "临沂市", "p_idx": 14, "anchor": False, "lon": 118.356, "lat": 35.105, "pop": 10_962_000, "gdp": 6_555.8, "disp": 38_400, "home": 9_800, "g5": 33.4, "unemp": 4.0, "stem": 0.056, "pay": 96_000, "urb": 61.5, "age": 37.4, "bach": 12.6, "badge": "北方商贸物流之都", "tag": "trade_agri"},
    {"id": "ordos", "adcode": "150600", "name": "鄂尔多斯", "full": "鄂尔多斯市", "p_idx": 4, "anchor": False, "lon": 109.781, "lat": 39.608, "pop": 2_240_500, "gdp": 6_363.0, "disp": 54_800, "home": 10_400, "g5": 68.5, "unemp": 3.6, "stem": 0.075, "pay": 136_000, "urb": 79.2, "age": 38.6, "bach": 21.8, "badge": "暖城煤炭绿能高地", "tag": "energy_mfg"},
    {"id": "yichang", "adcode": "420500", "name": "宜昌", "full": "宜昌市", "p_idx": 16, "anchor": False, "lon": 111.286, "lat": 30.692, "pop": 3_926_500, "gdp": 6_191.1, "disp": 39_600, "home": 9_400, "g5": 39.4, "unemp": 3.9, "stem": 0.074, "pay": 104_000, "urb": 65.8, "age": 41.2, "bach": 17.5, "badge": "三峡世界水电名城", "tag": "energy_mfg"},
    {"id": "xiangyang", "adcode": "420600", "name": "襄阳", "full": "襄阳市", "p_idx": 16, "anchor": False, "lon": 112.122, "lat": 32.009, "pop": 5_274_000, "gdp": 6_102.4, "disp": 38_400, "home": 9_200, "g5": 31.2, "unemp": 4.0, "stem": 0.068, "pay": 99_000, "urb": 64.2, "age": 39.8, "bach": 15.2, "badge": "汉江汽车军工重镇", "tag": "mfg_mil"},
    {"id": "huizhou", "adcode": "441300", "name": "惠州", "full": "惠州市", "p_idx": 18, "anchor": False, "lon": 114.416, "lat": 23.112, "pop": 6_120_000, "gdp": 6_136.4, "disp": 51_200, "home": 13_600, "g5": 42.5, "unemp": 3.8, "stem": 0.089, "pay": 122_000, "urb": 73.8, "age": 33.8, "bach": 16.8, "badge": "大湾区石化电子港", "tag": "mfg_port"},
    {"id": "luoyang", "adcode": "410300", "name": "洛阳", "full": "洛阳市", "p_idx": 15, "anchor": False, "lon": 112.454, "lat": 34.619, "pop": 7_081_000, "gdp": 5_818.6, "disp": 39_400, "home": 9_800, "g5": 16.5, "unemp": 4.1, "stem": 0.076, "pay": 102_000, "urb": 67.5, "age": 38.2, "bach": 16.8, "badge": "神都重工牡丹名城", "tag": "mfg_culture"},
    {"id": "taichung", "adcode": "710400", "name": "台中", "full": "台中市", "p_idx": 31, "anchor": False, "lon": 120.674, "lat": 24.148, "pop": 2_855_000, "gdp": 5_650.0, "disp": 89_000, "home": 46_000, "g5": 24.0, "unemp": 3.4, "stem": 0.125, "pay": 176_000, "urb": 94.0, "age": 42.8, "bach": 45.0, "badge": "精密机械中科城", "tag": "mfg_tech"},
    {"id": "kaohsiung", "adcode": "710200", "name": "高雄", "full": "高雄市", "p_idx": 31, "anchor": False, "lon": 120.301, "lat": 22.627, "pop": 2_732_000, "gdp": 5_380.0, "disp": 86_000, "home": 41_500, "g5": 21.5, "unemp": 3.5, "stem": 0.112, "pay": 169_000, "urb": 95.0, "age": 44.5, "bach": 43.0, "badge": "台湾第一深水大港", "tag": "port_mfg"},
    {"id": "wuhu", "adcode": "340200", "name": "芜湖", "full": "芜湖市", "p_idx": 11, "anchor": False, "lon": 118.433, "lat": 31.353, "pop": 3_748_000, "gdp": 5_120.5, "disp": 47_600, "home": 12_400, "g5": 38.4, "unemp": 3.8, "stem": 0.095, "pay": 115_000, "urb": 75.4, "age": 39.2, "bach": 19.6, "badge": "奇瑞汽车算力江城", "tag": "mfg_port"},
    {"id": "zhangzhou", "adcode": "350600", "name": "漳州", "full": "漳州市", "p_idx": 12, "anchor": False, "lon": 117.647, "lat": 24.513, "pop": 5_068_000, "gdp": 6_063.8, "disp": 44_200, "home": 14_800, "g5": 31.8, "unemp": 3.9, "stem": 0.068, "pay": 108_000, "urb": 64.5, "age": 36.8, "bach": 13.5, "badge": "核电石化食品港城", "tag": "energy_port"},
    {"id": "ganzhou", "adcode": "360700", "name": "赣州", "full": "赣州市", "p_idx": 13, "anchor": False, "lon": 114.934, "lat": 25.831, "pop": 8_988_000, "gdp": 4_940.5, "disp": 33_800, "home": 9_600, "g5": 35.4, "unemp": 4.0, "stem": 0.062, "pay": 94_000, "urb": 58.6, "age": 35.2, "bach": 11.4, "badge": "世界钨都稀土王国", "tag": "energy_mfg"},
    {"id": "zunyi", "adcode": "520300", "name": "遵义", "full": "遵义市", "p_idx": 23, "anchor": False, "lon": 106.927, "lat": 27.725, "pop": 6_598_000, "gdp": 5_027.7, "disp": 32_800, "home": 8_600, "g5": 36.4, "unemp": 4.1, "stem": 0.056, "pay": 96_000, "urb": 59.4, "age": 36.5, "bach": 12.2, "badge": "赤水酱酒航天名城", "tag": "mfg_culture"},
    {"id": "zibo", "adcode": "370300", "name": "淄博", "full": "淄博市", "p_idx": 14, "anchor": False, "lon": 118.055, "lat": 36.813, "pop": 4_705_000, "gdp": 4_884.1, "disp": 50_400, "home": 10_200, "g5": 30.8, "unemp": 3.9, "stem": 0.082, "pay": 112_000, "urb": 76.2, "age": 41.8, "bach": 18.2, "badge": "齐都新材料网红城", "tag": "mfg_tourism"},
    {"id": "baoding", "adcode": "130600", "name": "保定", "full": "保定市", "p_idx": 2, "anchor": False, "lon": 115.465, "lat": 38.874, "pop": 9_140_000, "gdp": 4_355.0, "disp": 34_600, "home": 10_800, "g5": 28.4, "unemp": 4.2, "stem": 0.068, "pay": 98_000, "urb": 64.5, "age": 38.8, "bach": 14.5, "badge": "新能源车与电网城", "tag": "mfg_campus"},
    {"id": "zhuhai", "adcode": "440400", "name": "珠海", "full": "珠海市", "p_idx": 18, "anchor": False, "lon": 113.577, "lat": 22.271, "pop": 2_518_500, "gdp": 4_479.1, "disp": 68_400, "home": 24_800, "g5": 28.6, "unemp": 3.6, "stem": 0.132, "pay": 152_000, "urb": 91.2, "age": 34.4, "bach": 28.6, "badge": "珠澳航空科创港", "tag": "tech_port"},
    {"id": "baotou", "adcode": "150200", "name": "包头", "full": "包头市", "p_idx": 4, "anchor": False, "lon": 109.840, "lat": 40.657, "pop": 2_761_000, "gdp": 4_575.1, "disp": 51_400, "home": 8_800, "g5": 54.6, "unemp": 3.8, "stem": 0.088, "pay": 118_000, "urb": 87.2, "age": 41.2, "bach": 24.2, "badge": "稀土硅晶军工重镇", "tag": "energy_mfg"},
    {"id": "mianyang", "adcode": "510700", "name": "绵阳", "full": "绵阳市", "p_idx": 22, "anchor": False, "lon": 104.679, "lat": 31.467, "pop": 4_898_000, "gdp": 4_344.2, "disp": 42_100, "home": 9_400, "g5": 41.8, "unemp": 3.8, "stem": 0.118, "pay": 116_000, "urb": 58.6, "age": 41.0, "bach": 17.4, "badge": "中国唯一科技城", "tag": "campus_mil"},
    {"id": "yibin", "adcode": "511500", "name": "宜宾", "full": "宜宾市", "p_idx": 22, "anchor": False, "lon": 104.643, "lat": 28.752, "pop": 4_628_000, "gdp": 4_005.8, "disp": 39_800, "home": 9_100, "g5": 42.5, "unemp": 3.9, "stem": 0.082, "pay": 108_000, "urb": 56.2, "age": 39.4, "bach": 13.8, "badge": "动力电池长江首城", "tag": "mfg_port"},
    {"id": "zhongshan", "adcode": "442000", "name": "中山", "full": "中山市", "p_idx": 18, "anchor": False, "lon": 113.393, "lat": 22.517, "pop": 4_494_000, "gdp": 4_143.3, "disp": 64_200, "home": 16_400, "g5": 28.4, "unemp": 3.7, "stem": 0.098, "pay": 131_000, "urb": 87.6, "age": 34.9, "bach": 18.2, "badge": "深中通道智造名城", "tag": "mfg_tech"},
    {"id": "nanyang", "adcode": "411300", "name": "南阳", "full": "南阳市", "p_idx": 15, "anchor": False, "lon": 112.528, "lat": 32.990, "pop": 9_487_000, "gdp": 4_879.0, "disp": 30_400, "home": 8_200, "g5": 24.5, "unemp": 4.2, "stem": 0.048, "pay": 86_000, "urb": 53.8, "age": 37.8, "bach": 10.8, "badge": "南水北调中线水源", "tag": "agri_mfg"},
    {"id": "zhuzhou", "adcode": "430200", "name": "株洲", "full": "株洲市", "p_idx": 17, "anchor": False, "lon": 113.134, "lat": 27.828, "pop": 3_871_000, "gdp": 3_902.4, "disp": 47_800, "home": 8_900, "g5": 27.6, "unemp": 3.9, "stem": 0.104, "pay": 114_000, "urb": 72.8, "age": 39.6, "bach": 18.8, "badge": "中国电力机车之都", "tag": "mfg_rail"},
    {"id": "yueyang", "adcode": "430600", "name": "岳阳", "full": "岳阳市", "p_idx": 17, "anchor": False, "lon": 113.129, "lat": 29.357, "pop": 4_995_000, "gdp": 5_127.7, "disp": 38_900, "home": 8_600, "g5": 27.8, "unemp": 4.0, "stem": 0.062, "pay": 98_000, "urb": 63.2, "age": 40.4, "bach": 13.8, "badge": "洞庭湖石化江港", "tag": "port_mfg"},
    {"id": "handan", "adcode": "130400", "name": "邯郸", "full": "邯郸市", "p_idx": 2, "anchor": False, "lon": 114.539, "lat": 36.625, "pop": 9_170_000, "gdp": 4_702.0, "disp": 35_200, "home": 9_400, "g5": 29.1, "unemp": 4.2, "stem": 0.056, "pay": 92_000, "urb": 63.4, "age": 37.6, "bach": 12.2, "badge": "晋冀鲁豫四省枢", "tag": "mfg_agri"},
    {"id": "langfang", "adcode": "131000", "name": "廊坊", "full": "廊坊市", "p_idx": 2, "anchor": False, "lon": 116.684, "lat": 39.538, "pop": 5_464_000, "gdp": 3_830.0, "disp": 44_200, "home": 14_800, "g5": 26.5, "unemp": 3.9, "stem": 0.088, "pay": 114_000, "urb": 68.2, "age": 37.4, "bach": 18.6, "badge": "京津走廊临空物流", "tag": "tech_port"},
    {"id": "shantou", "adcode": "440500", "name": "汕头", "full": "汕头市", "p_idx": 18, "anchor": False, "lon": 116.682, "lat": 23.354, "pop": 5_557_000, "gdp": 3_168.0, "disp": 37_200, "home": 12_800, "g5": 22.8, "unemp": 4.0, "stem": 0.068, "pay": 101_000, "urb": 71.2, "age": 35.8, "bach": 12.8, "badge": "潮汕海风电侨乡港", "tag": "port_energy"},
    {"id": "weihai", "adcode": "371000", "name": "威海", "full": "威海市", "p_idx": 14, "anchor": False, "lon": 122.120, "lat": 37.513, "pop": 2_915_000, "gdp": 3_728.0, "disp": 51_400, "home": 11_800, "g5": 27.6, "unemp": 3.7, "stem": 0.082, "pay": 114_000, "urb": 73.2, "age": 44.2, "bach": 18.8, "badge": "精致滨海碳纤维港", "tag": "port_tourism"},
    {"id": "liuzhou", "adcode": "450200", "name": "柳州", "full": "柳州市", "p_idx": 19, "anchor": False, "lon": 109.428, "lat": 24.326, "pop": 4_160_000, "gdp": 3_180.0, "disp": 39_800, "home": 9_400, "g5": 14.5, "unemp": 4.2, "stem": 0.072, "pay": 101_000, "urb": 71.4, "age": 37.8, "bach": 15.8, "badge": "西南工业螺蛳车城", "tag": "mfg_rail"},
    {"id": "guilin", "adcode": "450300", "name": "桂林", "full": "桂林市", "p_idx": 19, "anchor": False, "lon": 110.299, "lat": 25.274, "pop": 4_940_000, "gdp": 2_625.0, "disp": 34_600, "home": 8_800, "g5": 24.2, "unemp": 4.1, "stem": 0.062, "pay": 92_000, "urb": 55.2, "age": 38.6, "bach": 15.6, "badge": "山水甲天下文旅城", "tag": "tourism_campus"},
    {"id": "daqing", "adcode": "230600", "name": "大庆", "full": "大庆市", "p_idx": 7, "anchor": False, "lon": 125.104, "lat": 46.589, "pop": 2_715_000, "gdp": 2_890.0, "disp": 42_500, "home": 7_800, "g5": 25.4, "unemp": 4.2, "stem": 0.078, "pay": 114_000, "urb": 76.4, "age": 41.8, "bach": 19.6, "badge": "共和国石油铁人城", "tag": "energy_mfg"},
    {"id": "yanan", "adcode": "610600", "name": "延安", "full": "延安市", "p_idx": 26, "anchor": False, "lon": 109.489, "lat": 36.585, "pop": 2_269_000, "gdp": 2_412.0, "disp": 33_400, "home": 8_600, "g5": 41.5, "unemp": 4.0, "stem": 0.056, "pay": 102_000, "urb": 64.2, "age": 36.8, "bach": 16.4, "badge": "革命圣地陕北油气", "tag": "holy_energy"},
    {"id": "baoji", "adcode": "610300", "name": "宝鸡", "full": "宝鸡市", "p_idx": 26, "anchor": False, "lon": 107.237, "lat": 34.362, "pop": 3_246_000, "gdp": 2_906.0, "disp": 35_200, "home": 8_200, "g5": 27.8, "unemp": 4.1, "stem": 0.078, "pay": 99_000, "urb": 61.5, "age": 40.6, "bach": 16.2, "badge": "中国钛谷青铜器乡", "tag": "mfg_culture"},
    {"id": "jiujiang", "adcode": "360400", "name": "九江", "full": "九江市", "p_idx": 13, "anchor": False, "lon": 116.001, "lat": 29.705, "pop": 4_540_000, "gdp": 4_026.0, "disp": 38_400, "home": 9_400, "g5": 28.4, "unemp": 4.0, "stem": 0.058, "pay": 96_000, "urb": 64.8, "age": 38.4, "bach": 13.6, "badge": "鄱阳湖长江亿吨港", "tag": "port_tourism"},
    {"id": "bengbu", "adcode": "340300", "name": "蚌埠", "full": "蚌埠市", "p_idx": 11, "anchor": False, "lon": 117.389, "lat": 32.916, "pop": 3_290_000, "gdp": 2_215.0, "disp": 36_800, "home": 8_600, "g5": 14.5, "unemp": 4.2, "stem": 0.068, "pay": 95_000, "urb": 61.8, "age": 38.6, "bach": 14.2, "badge": "淮河硅基玻璃重镇", "tag": "mfg_rail"},
    {"id": "anshan", "adcode": "210300", "name": "鞍山", "full": "鞍山市", "p_idx": 5, "anchor": False, "lon": 122.994, "lat": 41.109, "pop": 3_250_000, "gdp": 2_125.0, "disp": 40_200, "home": 7_400, "g5": 21.6, "unemp": 4.4, "stem": 0.072, "pay": 94_000, "urb": 75.8, "age": 44.5, "bach": 16.5, "badge": "钢都铁矿工业基地", "tag": "mfg_energy"},
    {"id": "jilin_city", "adcode": "220200", "name": "吉林", "full": "吉林市", "p_idx": 6, "anchor": False, "lon": 126.550, "lat": 43.838, "pop": 3_520_000, "gdp": 1_665.0, "disp": 33_400, "home": 7_200, "g5": 16.8, "unemp": 4.5, "stem": 0.064, "pay": 90_000, "urb": 66.2, "age": 43.8, "bach": 16.2, "badge": "松花江化工碳纤维城", "tag": "mfg_energy"},
    {"id": "qiqihar", "adcode": "230200", "name": "齐齐哈尔", "full": "齐齐哈尔市", "p_idx": 7, "anchor": False, "lon": 123.918, "lat": 47.354, "pop": 3_920_000, "gdp": 1_368.0, "disp": 29_800, "home": 6_800, "g5": 17.5, "unemp": 4.5, "stem": 0.052, "pay": 87_000, "urb": 58.2, "age": 43.5, "bach": 12.8, "badge": "鹤城一重农机粮仓", "tag": "mfg_agri"},
    {"id": "datong", "adcode": "140200", "name": "大同", "full": "大同市", "p_idx": 3, "anchor": False, "lon": 113.300, "lat": 40.077, "pop": 3_079_000, "gdp": 1_962.0, "disp": 33_600, "home": 7_900, "g5": 35.4, "unemp": 4.1, "stem": 0.064, "pay": 93_000, "urb": 74.2, "age": 40.2, "bach": 16.2, "badge": "云冈古都东数西算", "tag": "energy_culture"},
    {"id": "chifeng", "adcode": "150400", "name": "赤峰", "full": "赤峰市", "p_idx": 4, "anchor": False, "lon": 118.887, "lat": 42.258, "pop": 3_996_000, "gdp": 2_310.0, "disp": 33_200, "home": 8_200, "g5": 30.8, "unemp": 4.1, "stem": 0.052, "pay": 90_000, "urb": 56.4, "age": 40.4, "bach": 14.5, "badge": "红山文化有色农牧城", "tag": "agri_energy"},
    {"id": "sanya", "adcode": "460200", "name": "三亚", "full": "三亚市", "p_idx": 20, "anchor": False, "lon": 109.512, "lat": 18.253, "pop": 1_068_000, "gdp": 1_003.6, "disp": 44_600, "home": 29_800, "g5": 42.8, "unemp": 3.8, "stem": 0.072, "pay": 118_000, "urb": 79.4, "age": 34.5, "bach": 21.8, "badge": "热带滨海深海科创城", "tag": "tourism_tech"},
    {"id": "sansha", "adcode": "460300", "name": "三沙", "full": "三沙市", "p_idx": 20, "anchor": False, "lon": 112.339, "lat": 16.831, "pop": 2_400, "gdp": 6.8, "disp": 48_000, "home": 18_000, "g5": 48.0, "unemp": 2.5, "stem": 0.110, "pay": 135_000, "urb": 95.0, "age": 31.5, "bach": 26.0, "badge": "南海明珠海洋守望", "tag": "port_mil"},
    {"id": "qujing", "adcode": "530300", "name": "曲靖", "full": "曲靖市", "p_idx": 24, "anchor": False, "lon": 103.796, "lat": 25.490, "pop": 5_712_000, "gdp": 3_962.0, "disp": 32_800, "home": 7_800, "g5": 41.2, "unemp": 4.0, "stem": 0.058, "pay": 92_000, "urb": 53.8, "age": 35.8, "bach": 11.8, "badge": "珠江源光伏硅谷", "tag": "mfg_energy"},
    {"id": "dali", "adcode": "532900", "name": "大理", "full": "大理白族自治州", "p_idx": 24, "anchor": False, "lon": 100.226, "lat": 25.589, "pop": 3_328_000, "gdp": 1_845.0, "disp": 32_100, "home": 10_600, "g5": 28.4, "unemp": 3.9, "stem": 0.054, "pay": 91_000, "urb": 52.8, "age": 36.8, "bach": 12.8, "badge": "苍山洱海旅居名州", "tag": "tourism_holy"},
    {"id": "rikaze", "adcode": "540200", "name": "日喀则", "full": "日喀则市", "p_idx": 25, "anchor": False, "lon": 88.881, "lat": 29.267, "pop": 808_000, "gdp": 438.0, "disp": 28_600, "home": 7_600, "g5": 38.5, "unemp": 3.6, "stem": 0.038, "pay": 112_000, "urb": 33.4, "age": 31.8, "bach": 9.8, "badge": "珠峰扎什伦布边城", "tag": "holy_mil"},
    {"id": "jiuquan", "adcode": "620900", "name": "酒泉", "full": "酒泉市", "p_idx": 27, "anchor": False, "lon": 98.494, "lat": 39.732, "pop": 1_052_000, "gdp": 982.0, "disp": 35_800, "home": 7_600, "g5": 48.2, "unemp": 3.8, "stem": 0.095, "pay": 112_000, "urb": 69.8, "age": 38.4, "bach": 18.2, "badge": "飞天航天与陆上三峡", "tag": "space_energy"},
    {"id": "tianshui", "adcode": "620500", "name": "天水", "full": "天水市", "p_idx": 27, "anchor": False, "lon": 105.725, "lat": 34.581, "pop": 2_924_000, "gdp": 918.0, "disp": 25_600, "home": 7_200, "g5": 31.5, "unemp": 4.2, "stem": 0.054, "pay": 86_000, "urb": 49.6, "age": 37.2, "bach": 13.6, "badge": "羲皇故里麦积文旅", "tag": "culture_mfg"},
    {"id": "karamay", "adcode": "650200", "name": "克拉玛依", "full": "克拉玛依市", "p_idx": 30, "anchor": False, "lon": 84.889, "lat": 45.579, "pop": 492_000, "gdp": 1_327.0, "disp": 53_800, "home": 8_200, "g5": 38.4, "unemp": 3.6, "stem": 0.112, "pay": 136_000, "urb": 98.5, "age": 37.8, "bach": 29.4, "badge": "准噶尔黑油算力城", "tag": "energy_tech"},
    {"id": "kashgar", "adcode": "653100", "name": "喀什", "full": "喀什地区", "p_idx": 30, "anchor": False, "lon": 75.990, "lat": 39.470, "pop": 4_510_000, "gdp": 1_620.0, "disp": 23_400, "home": 7_100, "g5": 42.1, "unemp": 4.1, "stem": 0.042, "pay": 94_000, "urb": 41.2, "age": 30.8, "bach": 11.4, "badge": "丝路西极喀什明珠", "tag": "trade_culture"},
    {"id": "yining", "adcode": "654002", "name": "伊宁", "full": "伊犁哈萨克自治州(伊宁)", "p_idx": 30, "anchor": False, "lon": 81.324, "lat": 43.917, "pop": 2_890_000, "gdp": 1_780.0, "disp": 31_200, "home": 7_800, "g5": 36.2, "unemp": 4.0, "stem": 0.048, "pay": 98_000, "urb": 54.6, "age": 33.8, "bach": 14.6, "badge": "塞外江南霍尔果斯口岸", "tag": "trade_agri"},
    {"id": "hsinchu", "adcode": "710800", "name": "新竹", "full": "新竹市", "p_idx": 31, "anchor": False, "lon": 120.967, "lat": 24.814, "pop": 456_000, "gdp": 4_250.0, "disp": 112_000, "home": 58_000, "g5": 38.4, "unemp": 3.0, "stem": 0.245, "pay": 268_000, "urb": 100.0, "age": 39.2, "bach": 52.0, "badge": "全球晶圆科学园", "tag": "sz_tech"},
]


# ---------------------------------------------------------------------------
# 4. 28 County Field Definitions & 19 Lens Definitions
# ---------------------------------------------------------------------------
COUNTY_FIELDS: list[dict[str, Any]] = [
    {"key": "code", "label": "行政代码", "short": "代码", "format": "text", "unit": "", "type": "categorical", "higher_is": "neutral", "source": "民政部 GB/T 2260", "description": "6位县级行政区划代码", "lens": None, "group": "people"},
    {"key": "name", "label": "县区名称", "short": "县区", "format": "text", "unit": "", "type": "categorical", "higher_is": "neutral", "source": "DataV GeoAtlas / 民政部", "description": "县、自治县、旗、县级市或合并城区名称", "lens": None, "group": "people"},
    {"key": "province_idx", "label": "省级序号", "short": "省序", "format": "int", "unit": "", "type": "number", "higher_is": "neutral", "source": "ChinaCiv Geo", "description": "对应34省级行政区数组索引 (0..33)", "lens": None, "group": "people"},
    {"key": "province", "label": "所属省级", "short": "省份", "format": "text", "unit": "", "type": "categorical", "higher_is": "neutral", "source": "GB/T 2260", "description": "所属省、自治区、直辖市或特别行政区", "lens": None, "group": "people"},
    {"key": "region", "label": "所属大区", "short": "大区", "format": "text", "unit": "", "type": "categorical", "higher_is": "neutral", "source": "地理分区", "description": "华北/东北/华东/华中/华南/西南/西北/港澳台", "lens": None, "group": "people"},
    {"key": "population", "label": "常住人口", "short": "人口", "format": "pop", "unit": "人", "type": "number", "higher_is": "neutral", "source": "第七次全国人口普查及2024分省校准", "description": "县级常住人口总量(人)", "lens": "density", "group": "people"},
    {"key": "area_km2", "label": "陆地面积", "short": "面积", "format": "km2", "unit": "km²", "type": "number", "higher_is": "neutral", "source": "China Albers GIS边界", "description": "县级单元陆地面积(平方公里)", "lens": None, "group": "land"},
    {"key": "density", "label": "人口密度", "short": "密度", "format": "density", "unit": "人/km²", "type": "number", "higher_is": "neutral", "source": "人口/面积计算", "description": "每平方公里常住人口数，直观呈现胡焕庸线东西两侧差异", "lens": "density", "group": "people"},
    {"key": "gdp", "label": "地区生产总值 (GDP)", "short": "GDP", "format": "gdp", "unit": "亿元", "type": "number", "higher_is": "better", "source": "2024五经普分省核实及县域核算", "description": "县域地区生产总值(亿元人民币)", "lens": "income", "group": "prosperity"},
    {"key": "gdp_per_capita", "label": "人均 GDP", "short": "人均GDP", "format": "yuan", "unit": "元", "type": "number", "higher_is": "better", "source": "2024分省/分县国民经济核算", "description": "县域人均地区生产总值(元)", "lens": "income", "group": "prosperity"},
    {"key": "income", "label": "人均可支配收入", "short": "可支配收入", "format": "yuan", "unit": "元", "type": "number", "higher_is": "better", "source": "国家统计局住户调查2024", "description": "居民人均可支配收入(元/年)", "lens": "income", "group": "prosperity"},
    {"key": "home_price", "label": "住宅均价", "short": "房价", "format": "yuan", "unit": "元/㎡", "type": "number", "higher_is": "neutral", "source": "中指研究院 / 70城房价监测", "description": "城镇住宅参考均价(元/平方米)", "lens": "home", "group": "prosperity"},
    {"key": "low_income", "label": "低收入人群占比", "short": "低收入比", "format": "pct", "unit": "%", "type": "number", "higher_is": "worse", "source": "国家统计局住户分层 & 乡村振兴监测", "description": "相对低收入及巩固拓展脱贫攻坚人口比重(%)", "lens": "poverty", "group": "prosperity"},
    {"key": "median_age", "label": "人口中位年龄", "short": "中位年龄", "format": "years", "unit": "岁", "type": "number", "higher_is": "neutral", "source": "第七次全国人口普查分龄结构", "description": "常住人口年龄中位数(岁)", "lens": "age", "group": "people"},
    {"key": "migrant_pct", "label": "跨区流入人口占比", "short": "流动人口%", "format": "pct", "unit": "%", "type": "number", "higher_is": "neutral", "source": "第七次人口普查人户分离/迁移", "description": "外来常住流动人口占总人口比例(%)", "lens": "migrant", "group": "people"},
    {"key": "bachelors_pct", "label": "大学学历人口占比", "short": "大学学历%", "format": "pct", "unit": "%", "type": "number", "higher_is": "better", "source": "第七次人口普查受教育程度", "description": "每百人中具有大专及本科以上学历人口占比(%)", "lens": "bachelors", "group": "knowledge"},
    {"key": "broadband_pct", "label": "宽带千兆普及率", "short": "宽带%", "format": "pct", "unit": "%", "type": "number", "higher_is": "better", "source": "工信部2024通信业统计公报", "description": "家庭固定宽带及光纤网络覆盖普及率(%)", "lens": "broadband", "group": "knowledge"},
    {"key": "commute_min", "label": "平均单程通勤时长", "short": "通勤时长", "format": "min", "unit": "分钟", "type": "number", "higher_is": "worse", "source": "中规院2024通勤监测报告", "description": "就业人口平均单程通勤耗时(分钟)", "lens": "commute", "group": "life"},
    {"key": "homeownership_pct", "label": "自有住房比例", "short": "住房自有%", "format": "pct", "unit": "%", "type": "number", "higher_is": "better", "source": "第七次人口普查住房统计", "description": "家庭拥有自有产权住房户数占比(%)", "lens": "homeownership", "group": "life"},
    {"key": "healthcare_gap_pct", "label": "基层医疗缺口率", "short": "医疗缺口%", "format": "pct", "unit": "%", "type": "number", "higher_is": "worse", "source": "国家卫健委千人口医师及床位监测", "description": "基于千人口医师与30分钟急救圈评估的医疗资源缺口(%)", "lens": "healthcare_gap", "group": "life"},
    {"key": "forest_pct", "label": "森林覆盖率", "short": "森林%", "format": "pct", "unit": "%", "type": "number", "higher_is": "better", "source": "国家林草局清查 & 栅格地类", "description": "林地与森林覆盖占县域面积比例(%)", "lens": "forest", "group": "land"},
    {"key": "farmland_pct", "label": "耕地农田占比", "short": "耕地%", "format": "pct", "unit": "%", "type": "number", "higher_is": "neutral", "source": "自然资源部国土调查 & 栅格地类", "description": "水田、旱地与基本农田占县域面积比例(%)", "lens": "farmland", "group": "land"},
    {"key": "developed_pct", "label": "建设用地占比", "short": "建成区%", "format": "pct", "unit": "%", "type": "number", "higher_is": "neutral", "source": "自然资源部 & Natural Earth城镇边界", "description": "城镇村及工矿交通建设用地占比(%)", "lens": "developed", "group": "land"},
    {"key": "faith_per100", "label": "传统信仰活跃度", "short": "信仰活跃度", "format": "dec1", "unit": "人/百人", "type": "number", "higher_is": "neutral", "source": "CFPS / 民俗与宗教地理汇编", "description": "每百名居民中深度参与传统民俗信仰或宗教活动比例", "lens": "faith", "group": "faith"},
    {"key": "faith_tradition", "label": "主导信仰传统", "short": "信仰传统", "format": "text", "unit": "", "type": "categorical", "higher_is": "neutral", "source": "社科院宗教地理 / CFPS", "description": "县域最具代表性的宗教或民俗文化传统类别", "lens": "faith_tradition", "group": "faith"},
    {"key": "wellbeing", "label": "民生福祉综合指数", "short": "福祉指数", "format": "dec1", "unit": "分", "type": "number", "higher_is": "better", "source": "CFPS幸福感 & 公共服务综合评估", "description": "结合收入、医疗、教育与生态环境的0-100综合幸福指数", "lens": "wellbeing", "group": "life"},
    {"key": "disasters", "label": "历史灾害频次", "short": "灾害频次", "format": "int", "unit": "次", "type": "number", "higher_is": "worse", "source": "USGS 2000–2026地震目录 & 应急管理部", "description": "2000年以来M≥4.5地震冲击加权及台风洪涝滑坡历史频次", "lens": "disasters", "group": "hazards"},
    {"key": "stem_pct", "label": "STEM工程人才占比", "short": "STEM%", "format": "pct", "unit": "%", "type": "number", "higher_is": "better", "source": "科技部 / 统计年鉴高技术研发就业", "description": "工程师、程序员与科学家占就业人口比例(%)；全国约7.14%(1/14)，深圳约20%(1/5)", "lens": "stem", "group": "knowledge"},
]

LENS_GROUPS: list[dict[str, str]] = [
    {"id": "people", "label": "人口与迁徙"},
    {"id": "prosperity", "label": "经济民生"},
    {"id": "knowledge", "label": "科教数字"},
    {"id": "life", "label": "日常生活"},
    {"id": "faith", "label": "信仰民俗"},
    {"id": "hazards", "label": "灾害风险"},
    {"id": "land", "label": "国土生态"},
]

LENS_SPECS: list[dict[str, Any]] = [
    {"id": "density", "group": "people", "label": "人口密度", "short": "人口密度", "countyField": "density", "unit": "人/km²", "scale": "log", "ramp": "amber", "description": "每平方公里常住人口密度，清晰刻画黑河—腾冲(胡焕庸)线东西两侧人口分布悬殊格局。", "source": "第七次全国人口普查 / 2024分省常住人口"},
    {"id": "migrant", "group": "people", "label": "流动人口占比", "short": "流动人口", "countyField": "migrant_pct", "unit": "%", "scale": "linear", "ramp": "viridis", "description": "跨省与跨市流入常住人口占比，珠三角、长三角及京津冀净流入显著。", "source": "第七次全国人口普查迁移流动数据"},
    {"id": "age", "group": "people", "label": "中位年龄", "short": "中位年龄", "countyField": "median_age", "unit": "岁", "scale": "linear", "ramp": "diverging", "description": "常住人口年龄中位数，反映珠三角青年劳力聚集与东北/川渝/江浙沪老龄化分化。", "source": "第七次全国人口普查分龄人口"},
    {"id": "income", "group": "prosperity", "label": "人均可支配收入", "short": "可支配收入", "countyField": "income", "unit": "元", "scale": "log", "ramp": "viridis", "description": "2024年居民人均可支配收入，展现长三角、京津、粤港澳及东南沿海领先格局。", "source": "国家统计局住户调查 2024"},
    {"id": "home", "group": "prosperity", "label": "住宅均价", "short": "房价", "countyField": "home_price", "unit": "元/㎡", "scale": "log", "ramp": "crimson", "description": "主要城市及县域住宅参考均价(元/㎡)，映射核心都市圈资产密度与住房成本。", "source": "中指研究院 / 70城房价监测 2024"},
    {"id": "poverty", "group": "prosperity", "label": "低收入人口比", "short": "低收入比", "countyField": "low_income", "unit": "%", "scale": "linear", "ramp": "crimson", "description": "相对低收入人群比重，反映中西部山区与重点帮扶县区增收挑战。", "source": "国家统计局 / 农业农村部监测"},
    {"id": "bachelors", "group": "knowledge", "label": "大学学历占比", "short": "高学历比", "countyField": "bachelors_pct", "unit": "%", "scale": "linear", "ramp": "ice", "description": "每百人拥有大专及本科以上学历比重，北京42%、上海33.9%及各高校驻地高耸。", "source": "第七次全国人口普查教育统计"},
    {"id": "stem", "group": "knowledge", "label": "STEM工程师占比", "short": "STEM人才", "countyField": "stem_pct", "unit": "%", "scale": "log", "ramp": "ice", "description": "工程师、程序员与科研人员占就业人口比例：全国约7.14%(14中1)，深圳高达20%(5中1)。", "source": "科技部 / 国家统计局高技术就业"},
    {"id": "broadband", "group": "knowledge", "label": "宽带普及率", "short": "宽带覆盖", "countyField": "broadband_pct", "unit": "%", "scale": "linear", "ramp": "emerald", "description": "千兆光纤与家庭宽带接入覆盖率，体现信息基建“村村通”成果与区域细微梯度。", "source": "工信部2024通信业统计公报"},
    {"id": "commute", "group": "life", "label": "单程通勤时长", "short": "通勤时长", "countyField": "commute_min", "unit": "分钟", "scale": "linear", "ramp": "purple", "description": "就业人员平均单程通勤分钟数，超大都市圈40分钟+与中小县城20分钟形成对比。", "source": "中规院2024中国主要城市通勤报告"},
    {"id": "homeownership", "group": "life", "label": "自有住房率", "short": "自有住房", "countyField": "homeownership_pct", "unit": "%", "scale": "linear", "ramp": "emerald", "description": "拥有自有产权住房的家庭比例，三四线县域与农村普遍高于外来租住集中区。", "source": "第七次全国人口普查住房统计"},
    {"id": "healthcare_gap", "group": "life", "label": "基层医疗缺口", "short": "医疗缺口", "countyField": "healthcare_gap_pct", "unit": "%", "scale": "linear", "ramp": "crimson", "description": "结合千人口执业医师与地形交通可及性的医疗服务缺口度。", "source": "国家卫健委卫生健康统计年鉴"},
    {"id": "wellbeing", "group": "life", "label": "民生福祉指数", "short": "福祉指数", "countyField": "wellbeing", "unit": "分", "scale": "linear", "ramp": "emerald", "description": "综合收入水平、医疗保障、教育资源与环境质量的社会福祉指数(0–100)。", "source": "CFPS / 公共服务综合监测"},
    {"id": "faith", "group": "faith", "label": "信仰民俗活跃度", "short": "信仰活跃度", "countyField": "faith_per100", "unit": "人/百人", "scale": "linear", "ramp": "amber", "description": "每百人中深度参与传统民俗信仰或宗教文化活动比例，西藏、闽粤台、西北民族地区较高。", "source": "CFPS / 信仰民俗地理调查"},
    {
        "id": "faith_tradition", "group": "faith", "label": "主导信仰传统", "short": "信仰分布",
        "countyField": "faith_tradition", "unit": "", "scale": "categorical", "type": "categorical",
        "categoryColors": {
            "汉传佛教/民间信仰": "#d8a648",
            "道教/民俗信仰": "#6cb89c",
            "藏传佛教": "#c85a47",
            "伊斯兰教": "#4b9e6b",
            "基督宗教": "#6b9ed4",
            "多元世俗/无宗教为主": "#78889a",
            "少数民族传统信仰": "#a878bd",
        },
        "description": "各县域最具历史代表性的宗教或民俗传统空间版图。",
        "source": "社科院宗教地理 / 多源民俗汇编",
    },
    {"id": "disasters", "group": "hazards", "label": "地震与灾害风险", "short": "灾害风险", "countyField": "disasters", "unit": "次", "scale": "log", "ramp": "crimson", "description": "基于2000–2026年USGS实测M≥4.5地震目录与沿海台风/流域洪涝综合历史灾害次数。", "source": "USGS地震目录 & 应急管理部"},
    {"id": "forest", "group": "land", "label": "森林覆盖率", "short": "森林覆盖", "countyField": "forest_pct", "unit": "%", "scale": "linear", "ramp": "emerald", "description": "大小兴安岭、长白山、武夷山、横断山区及江南丘陵绿色屏障分布。", "source": "国家林草局 / 25km网格地类"},
    {"id": "farmland", "group": "land", "label": "耕地农田占比", "short": "耕地占比", "countyField": "farmland_pct", "unit": "%", "scale": "linear", "ramp": "amber", "description": "东北黑土带、华北黄淮海、长江中下游与四川盆地核心耕地空间。", "source": "自然资源部国土变更调查 / 网格地类"},
    {"id": "developed", "group": "land", "label": "城镇建成区占比", "short": "建成区", "countyField": "developed_pct", "unit": "%", "scale": "log", "ramp": "purple", "description": "京津冀、长三角、珠三角及川渝城市群建设用地集约密度。", "source": "自然资源部 / Natural Earth"},
]


# ---------------------------------------------------------------------------
# 5. Helper utilities for yields, districts, citizens, and county disaggregation
# ---------------------------------------------------------------------------
def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def slug_match(text: str, targets: list[str]) -> bool:
    return any(t in text for t in targets)


def load_usgs_earthquakes() -> list[tuple[float, float, float]]:
    """Load real USGS M>=4.5 China catalog -> list of (x_km, y_km, mag)."""
    if not USGS_CSV_PATH.exists():
        raise FileNotFoundError(f"Missing USGS CSV: {USGS_CSV_PATH}")
    grid = geo_common.load_grid()
    events: list[tuple[float, float, float]] = []
    with USGS_CSV_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row["latitude"])
                lon = float(row["longitude"])
                mag = float(row["mag"])
            except (KeyError, ValueError, TypeError):
                continue
            if not (math.isfinite(lat) and math.isfinite(lon) and math.isfinite(mag)):
                continue
            x, y = geo_common.lonlat_to_xy(lon, lat, grid)
            events.append((x, y, mag))
    return events


def compute_jobs_breakdown(
    emp: int, sec_pct: tuple[float, float, float], stem_share: float,
    tag: str, urban_ratio: float
) -> dict[str, int]:
    """Compute realistic 9-sector workforce counts summing strictly to `emp`."""
    p1, p2, p3 = sec_pct
    # Primary share of employment is ~2.8x primary GDP share nationally (6.8% GDP vs 22.2% emp)
    emp_agri_share = clamp((p1 / 100.0) * 2.75 if p1 > 1.0 else p1 / 100.0 * 1.6, 0.002, 0.56)
    if "agri" in tag:
        emp_agri_share = clamp(emp_agri_share * 1.15, 0.05, 0.56)

    # Secondary employment share
    emp_sec_share = clamp((p2 / 100.0) * 0.80, 0.05, 0.52)
    if emp_agri_share + emp_sec_share > 0.72:
        scale = 0.72 / (emp_agri_share + emp_sec_share)
        emp_agri_share *= scale
        emp_sec_share *= scale

    emp_ter_share = max(0.22, 1.0 - emp_agri_share - emp_sec_share)

    # Split secondary into manufacturing, construction, mining/energy
    if "energy" in tag:
        w_mfg, w_con, w_mine = 0.55, 0.25, 0.20
    elif "mfg" in tag or "sz_tech" in tag:
        w_mfg, w_con, w_mine = 0.74, 0.21, 0.05
    else:
        w_mfg, w_con, w_mine = 0.66, 0.26, 0.08

    # Split tertiary into trade/logistics, finance/biz, it/rd, culture/tourism, edu/health/gov
    it_share = clamp(stem_share * 0.62, 0.015, 0.16)
    fin_share = clamp(0.085 if "fin" in tag else (0.055 if urban_ratio > 0.75 else 0.032), 0.02, 0.16)
    cult_share = clamp(0.085 if ("tourism" in tag or "culture" in tag or "holy" in tag) else 0.038, 0.025, 0.14)
    pub_share = clamp(0.095 if ("gov" in tag or "capital" in tag or "campus" in tag) else 0.072, 0.05, 0.14)
    rem_ter = max(0.05, emp_ter_share - it_share - fin_share - cult_share - pub_share)
    if emp_ter_share < it_share + fin_share + cult_share + pub_share + 0.05:
        ratio = (emp_ter_share * 0.72) / (it_share + fin_share + cult_share + pub_share)
        it_share *= ratio
        fin_share *= ratio
        cult_share *= ratio
        pub_share *= ratio
        rem_ter = emp_ter_share - (it_share + fin_share + cult_share + pub_share)

    shares = {
        "农林牧渔": emp_agri_share,
        "制造业": emp_sec_share * w_mfg,
        "建筑工程": emp_sec_share * w_con,
        "采矿与能源": emp_sec_share * w_mine,
        "商贸物流": rem_ter,
        "金融与商务": fin_share,
        "信息软件与科研": it_share,
        "文旅文娱住宿": cult_share,
        "科教文卫公共": pub_share,
    }
    total_w = sum(shares.values())
    counts: dict[str, int] = {}
    running = 0
    keys = list(shares.keys())
    for k in keys[:-1]:
        c = int(round(emp * shares[k] / total_w))
        counts[k] = max(1, c)
        running += counts[k]
    counts[keys[-1]] = max(1, emp - running)
    return counts


def compute_gdp_by_industry(
    gdp: float, sec_pct: tuple[float, float, float], stem_share: float, tag: str
) -> dict[str, float]:
    """Compute 7-industry GDP breakdown in 亿元 summing to `gdp`."""
    p1, p2, p3 = sec_pct
    s1 = p1 / 100.0
    s2 = p2 / 100.0
    s3 = p3 / 100.0

    # Split secondary
    if "energy" in tag:
        w_m, w_c, w_e = 0.56, 0.18, 0.26
    elif "mfg" in tag or "sz_tech" in tag:
        w_m, w_c, w_e = 0.78, 0.16, 0.06
    else:
        w_m, w_c, w_e = 0.70, 0.21, 0.09

    # Split tertiary
    w_fin = 0.28 if "fin" in tag else 0.14
    w_it = clamp(stem_share * 1.45, 0.05, 0.34)
    w_cul = 0.15 if ("tourism" in tag or "culture" in tag or "holy" in tag) else 0.07
    w_pub = 0.18 if ("gov" in tag or "capital" in tag) else 0.13
    w_tr = max(0.18, 1.0 - w_fin - w_it - w_cul - w_pub)
    t_sum = w_fin + w_it + w_cul + w_pub + w_tr

    raw = {
        "农林牧渔业": gdp * s1,
        "制造业": gdp * s2 * w_m,
        "建筑与能源": gdp * s2 * (w_c + w_e),
        "商贸与交运": gdp * s3 * (w_tr / t_sum),
        "金融与商业服务": gdp * s3 * (w_fin / t_sum),
        "信息与科研技术": gdp * s3 * (w_it / t_sum),
        "文旅与公共服务": gdp * s3 * ((w_cul + w_pub) / t_sum),
    }
    return {k: round(v, 1) for k, v in raw.items()}


def compute_yields(
    gdp: float, grain_mt: float, sec_pct: tuple[float, float, float],
    stem_workers: int, gdp_ind: dict[str, float], tag: str
) -> dict[str, float]:
    """Map real socioeconomic data onto Civilization 5 yields."""
    food = round(grain_mt + gdp_ind["农林牧渔业"] * 0.22, 1)
    production = round(gdp * (sec_pct[1] / 100.0), 1)
    gold = round(gdp, 1)
    science = int(round(stem_workers))
    culture_base = gdp_ind["文旅与公共服务"] * 0.58 + gdp_ind["信息与科研技术"] * 0.12
    if "tourism" in tag or "culture" in tag or "holy" in tag or "capital" in tag:
        culture_base *= 1.18
    culture = round(culture_base, 1)
    return {
        "food": max(1.0, food),
        "production": max(1.0, production),
        "gold": max(1.0, gold),
        "science": max(100, science),
        "culture": max(1.0, culture),
    }


def build_citizens_list(
    emp: int, stem_workers: int, jobs: dict[str, int],
    nat_shares: dict[str, float]
) -> list[dict[str, Any]]:
    """Build 6 Civ citizen role cards summing to 1.0 share."""
    stem_w = min(emp - 5, max(1, int(round(stem_workers))))
    agri_w = jobs.get("农林牧渔", 0)
    mfg_w = max(1, int(round(jobs.get("制造业", 0) + jobs.get("采矿与能源", 0) - stem_w * 0.28)))
    comm_w = jobs.get("商贸物流", 0) + jobs.get("金融与商务", 0)
    pub_w = jobs.get("科教文卫公共", 0) + jobs.get("文旅文娱住宿", 0)
    const_w = max(1, emp - stem_w - agri_w - mfg_w - comm_w - pub_w)

    # Rebalance softly if subtraction drove const_w tiny
    raw_roles = [
        ("stem", "工程师与科研人才 (STEM)", "🔬", "#38bdf8", stem_w, "包含程序员、软硬件研发、半导体/装备工程师与高校院所科学家。"),
        ("manufacturing", "先进制造与能源技工", "⚙️", "#f97316", max(1, mfg_w), "一线产业工人、装备技师、能源电力运维与矿冶生产人员。"),
        ("commerce", "商贸金融与现代服务", "🏛️", "#f59e0b", max(1, comm_w), "银行证券、跨境电商、批发零售及现代供应链服务人员。"),
        ("construction", "建筑基建与交运物流", "🏗️", "#fb7185", max(1, const_w), "高铁公路港航调度、城市建设与城乡物流配送劳动者。"),
        ("public", "科教文卫与文旅从业", "🎭", "#c084fc", max(1, pub_w), "中小学与高校教师、医护人员、文化旅游及公共治理人员。"),
        ("agriculture", "现代农业与生态农林", "🌾", "#84cc16", max(1, agri_w), "粮食作物种植、畜牧水产养殖与生态林草管护劳动者。"),
    ]
    total_w = sum(r[4] for r in raw_roles)
    citizens = []
    for role, label, icon, color, w_cnt, note in raw_roles:
        sh = round(w_cnt / total_w, 4)
        citizens.append({
            "role": role,
            "label": label,
            "icon": icon,
            "color": color,
            "workers": int(round(emp * sh)),
            "share": sh,
            "national_share": round(nat_shares.get(role, sh), 4),
            "note": note,
        })
    return citizens


def build_districts_for_entity(
    name: str, code: str, entity_id: str, badge: str, emp: int, avg_pay: int,
    stem_share: float, jobs: dict[str, int], tag: str, is_coastal: bool = False
) -> dict[str, Any]:
    """Generate authentic Civ Districts + Citizens for a province or city."""
    districts: list[dict[str, Any]] = []

    # --- Special Frozen Invariants ---
    if entity_id == "beijing" or code == "110000":
        districts = [
            {
                "type": "campus",
                "name": "海淀高教学院区",
                "icon": "🎓",
                "lq": 3.18,
                "emp": int(emp * 0.095),
                "avg_pay": 265_000,
                "sector": "高等教育与基础研究",
                "note": "清华、北大、北航、中科院等80余所高校院所集聚，基础研究与原始创新密度全国第一。",
            },
            {
                "type": "campus",
                "name": "中关村·怀柔科学城学院区",
                "icon": "🔬",
                "lq": 2.94,
                "emp": int(emp * 0.115),
                "avg_pay": 298_000,
                "sector": "人工智能与大科学装置",
                "note": "全国首个国家自主创新示范区叠加怀柔综合性国家科学中心大科学装置群，构成北京标志性双学院区。",
            },
            {
                "type": "commercial",
                "name": "金融街·CBD商业中心",
                "icon": "🏛️",
                "lq": 2.65,
                "emp": int(emp * 0.145),
                "avg_pay": 286_000,
                "sector": "总部金融与专业服务",
                "note": "全国金融监管总部、大型国有商业银行总行与跨国公司地区总部核心承载区。",
            },
            {
                "type": "gov",
                "name": "中轴线·通州政务区",
                "icon": "🏯",
                "lq": 2.85,
                "emp": int(emp * 0.105),
                "avg_pay": 182_000,
                "sector": "国家治理与外交中心",
                "note": "中央政务中枢、国际交往中心与北京城市副中心行政协同区。",
            },
            {
                "type": "industrial",
                "name": "亦庄经开高精尖工业区",
                "icon": "⚙️",
                "lq": 1.38,
                "emp": int(emp * 0.102),
                "avg_pay": 195_000,
                "sector": "集成电路与商业航天",
                "note": "聚集北方华创、中芯京城、小米智能制造与国家信创园。",
            },
            {
                "type": "theater",
                "name": "故宫·大运河文旅广场",
                "icon": "🎭",
                "lq": 1.88,
                "emp": int(emp * 0.078),
                "avg_pay": 168_000,
                "sector": "全国文化中心",
                "note": "坐拥八项世界遗产与国家博物馆群，影视演艺与文博产业产出居全国前列。",
            },
        ]
        return {"badge": badge, "emp": emp, "avg_pay": avg_pay, "districts": districts}

    if entity_id == "shanghai" or code == "310000":
        districts = [
            {
                "type": "commercial",
                "name": "金融中心",
                "icon": "🏛️",
                "lq": 2.95,
                "emp": int(emp * 0.148),
                "avg_pay": 296_000,
                "sector": "国际金融与资本市场",
                "note": "陆家嘴聚集上交所、外汇交易中心、黄金交易所及持牌金融机构1,700余家，为中国第一金融中心。",
            },
            {
                "type": "harbor",
                "name": "洋山·外高桥国际港口区",
                "icon": "⚓",
                "lq": 2.68,
                "emp": int(emp * 0.095),
                "avg_pay": 184_000,
                "sector": "全球航运与自贸港",
                "note": "连续多年集装箱吞吐量位居世界第一，洋山四期自动化码头与浦东国际航空港形成世界级枢纽。",
            },
            {
                "type": "campus",
                "name": "张江科学城学院区",
                "icon": "🎓",
                "lq": 2.24,
                "emp": int(emp * 0.108),
                "avg_pay": 252_000,
                "sector": "集成电路与生物医药研发",
                "note": "复旦、交大、同济叠加张江光源与“中国芯”“创新药”研发集群。",
            },
            {
                "type": "industrial",
                "name": "临港·嘉定高端智造区",
                "icon": "⚙️",
                "lq": 1.46,
                "emp": int(emp * 0.185),
                "avg_pay": 176_000,
                "sector": "国产大飞机与新能源汽车",
                "note": "中国商飞C919总装、特斯拉超级工厂与船舶海工高端制造核心区。",
            },
            {
                "type": "theater",
                "name": "外滩·西岸文化剧院区",
                "icon": "🎭",
                "lq": 1.72,
                "emp": int(emp * 0.082),
                "avg_pay": 169_000,
                "sector": "海派演艺与数字文创",
                "note": "亚洲演艺之都与游戏电竞、艺术博览会聚落。",
            },
        ]
        return {"badge": "金融中心", "emp": emp, "avg_pay": avg_pay, "districts": districts}

    if entity_id == "shenzhen" or code == "440300":
        districts = [
            {
                "type": "campus",
                "name": "南山·光明科创学院区",
                "icon": "🎓",
                "lq": 2.86,
                "emp": int(emp * 0.195),
                "avg_pay": 288_000,
                "sector": "PCT专利与企业研发中枢",
                "note": "每5名劳动者中有1名STEM工程师/程序员/科学家(全国每14人中1名)，大湾区综合性科学中心主阵地。",
            },
            {
                "type": "industrial",
                "name": "宝安·龙岗先进制造工业区",
                "icon": "⚙️",
                "lq": 2.42,
                "emp": int(emp * 0.285),
                "avg_pay": 178_000,
                "sector": "新一代电子信息与新能源汽车",
                "note": "规上工业总产值连续居全国城市首位，构建20+8战略性新兴产业完整硬件供应链。",
            },
            {
                "type": "commercial",
                "name": "前海·福田金融商业区",
                "icon": "🏛️",
                "lq": 2.34,
                "emp": int(emp * 0.145),
                "avg_pay": 264_000,
                "sector": "深港创投金融与跨境商贸",
                "note": "深交所、前海深港现代服务业合作区与高密度创投基金群驱动科技金融闭环。",
            },
            {
                "type": "harbor",
                "name": "盐田·蛇口国际港口区",
                "icon": "⚓",
                "lq": 2.15,
                "emp": int(emp * 0.072),
                "avg_pay": 162_000,
                "sector": "外贸集装箱与海洋经济",
                "note": "华南跨境电商与外贸出口核心大港，连续30余年领跑中国外贸总额。",
            },
            {
                "type": "theater",
                "name": "深圳湾数字文旅广场",
                "icon": "🎭",
                "lq": 1.48,
                "emp": int(emp * 0.068),
                "avg_pay": 172_000,
                "sector": "工业设计与数字文创",
                "note": "联合国教科文组织“设计之都”，汇聚无人机演出与数字文化创意龙头。",
            },
        ]
        return {"badge": badge, "emp": emp, "avg_pay": avg_pay, "districts": districts}

    # --- General Bespoke District Generator for all 34 provinces & 90 cities ---
    # Pick 3 to 5 districts matching real regional profile
    if stem_share >= 0.09 or "tech" in tag or "campus" in tag:
        lq_c = round(clamp(stem_share / 0.0714 * 1.15, 1.05, 2.8), 2)
        districts.append({
            "type": "campus",
            "name": f"{name}高新科创学院区",
            "icon": "🎓",
            "lq": lq_c,
            "emp": max(1000, int(emp * clamp(stem_share * 0.9, 0.05, 0.18))),
            "avg_pay": int(avg_pay * 1.42),
            "sector": "高校研发与数字科创",
            "note": f"{name}拥有集中高教实验室与高技术研发团队，STEM人才密度达{stem_share*100:.1f}%。",
        })

    if "space" in tag:
        districts.append({
            "type": "spaceport",
            "name": f"{name}航天科工港",
            "icon": "🚀",
            "lq": 2.75,
            "emp": max(800, int(emp * 0.055)),
            "avg_pay": int(avg_pay * 1.38),
            "sector": "航天发射与深空探测",
            "note": f"{name}承担国家航天运载、卫星测控或核心动力科研任务。",
        })

    if "fin" in tag or "trade" in tag or emp > 4_000_000:
        lq_f = round(2.35 if "fin" in tag else (1.72 if "trade" in tag else 1.25), 2)
        districts.append({
            "type": "commercial",
            "name": f"{name}金融商贸中心",
            "icon": "🏛️",
            "lq": lq_f,
            "emp": max(1200, int(emp * 0.13)),
            "avg_pay": int(avg_pay * 1.32),
            "sector": "区域金融与现代商贸",
            "note": f"{name}承担区域资本融通、大宗商贸流通与跨境消费枢纽功能。",
        })

    if "mfg" in tag or "energy" in tag or jobs.get("制造业", 0) / max(1, emp) >= 0.18:
        mfg_ratio = jobs.get("制造业", 0) / max(1, emp)
        lq_i = round(clamp(mfg_ratio / 0.19 * 1.18, 1.05, 2.55), 2)
        ind_label = "能源化工工业区" if "energy" in tag else "先进制造工业区"
        districts.append({
            "type": "industrial",
            "name": f"{name}{ind_label}",
            "icon": "⚙️",
            "lq": lq_i,
            "emp": max(1500, int(jobs.get("制造业", 0) + jobs.get("采矿与能源", 0) * 0.6)),
            "avg_pay": int(avg_pay * 1.05),
            "sector": "现代制造与能源产业",
            "note": f"{name}以规模化制造业或能源矿产加工为实业压舱石，支撑区域生产力产出。",
        })

    if "port" in tag or is_coastal:
        districts.append({
            "type": "harbor",
            "name": f"{name}国际航运港口区",
            "icon": "⚓",
            "lq": 2.18 if "port" in tag else 1.45,
            "emp": max(500, int(emp * 0.068)),
            "avg_pay": int(avg_pay * 1.16),
            "sector": "港口物流与临港贸易",
            "note": f"依托深水岸线或长江黄金水道，打造集装箱与大宗商品转运大港。",
        })

    if "mil" in tag:
        districts.append({
            "type": "encampment",
            "name": f"{name}国防军工防务区",
            "icon": "🛡️",
            "lq": 2.10,
            "emp": max(600, int(emp * 0.045)),
            "avg_pay": int(avg_pay * 1.18),
            "sector": "军工科研与战略防务",
            "note": f"{name}集聚关键国防军工科研院所或战区防务保障节点。",
        })

    if "holy" in tag:
        districts.append({
            "type": "holy",
            "name": f"{name}历史人文圣地",
            "icon": "⛩️",
            "lq": 2.65,
            "emp": max(500, int(emp * 0.075)),
            "avg_pay": int(avg_pay * 0.96),
            "sector": "世界遗产与民俗文化",
            "note": f"{name}保存深厚的历史圣地、石窟寺院或红色文化精神地标。",
        })

    if "culture" in tag or "tourism" in tag or len(districts) < 3:
        districts.append({
            "type": "theater",
            "name": f"{name}文旅剧院广场",
            "icon": "🎭",
            "lq": 1.85 if ("culture" in tag or "tourism" in tag) else 1.18,
            "emp": max(500, int(jobs.get("文旅文娱住宿", 0))),
            "avg_pay": int(avg_pay * 0.95),
            "sector": "文化旅游与城市演艺",
            "note": f"{name}以人文遗产、自然风光与现代演艺节庆带动第三产业活力。",
        })

    if "gov" in tag or "capital" in tag:
        districts.append({
            "type": "gov",
            "name": f"{name}省级政务核心区",
            "icon": "🏯",
            "lq": 1.68,
            "emp": max(800, int(emp * 0.065)),
            "avg_pay": int(avg_pay * 1.12),
            "sector": "公共治理与区域协调",
            "note": f"统筹全省公共基础设施、教育医疗配置与城市群一体化协调。",
        })

    # Ensure at least 3 districts and at most 5
    if len(districts) < 3:
        districts.append({
            "type": "commercial",
            "name": f"{name}中心商业区",
            "icon": "🏛️",
            "lq": 1.15,
            "emp": max(500, int(emp * 0.11)),
            "avg_pay": int(avg_pay * 1.08),
            "sector": "消费零售与生活服务",
            "note": f"{name}核心城市商圈与现代商贸枢纽。",
        })

    return {
        "badge": badge,
        "emp": emp,
        "avg_pay": avg_pay,
        "districts": districts[:5],
    }


def compute_ranks(items: list[dict[str, Any]], keys: list[str]) -> None:
    """Populate 1-based descending rank dict `ranks` on each item."""
    for it in items:
        it.setdefault("ranks", {})
    for k in keys:
        def val_fn(item: dict[str, Any]) -> float:
            if k in item.get("yields", {}):
                return float(item["yields"][k])
            return float(item.get(k, 0.0))

        ordered = sorted(range(len(items)), key=lambda i: val_fn(items[i]), reverse=True)
        for rank_idx, orig_idx in enumerate(ordered, start=1):
            items[orig_idx]["ranks"][k] = rank_idx


def calibrate_county_faith(prov_code: str, county_name: str, elev: float, prov_faith_100: float, prov_trad: str) -> tuple[float, str]:
    """Differentiate county faith_tradition & faith_per100 realistically within provinces."""
    f100 = prov_faith_100
    trad = prov_trad
    if prov_code == "540000":
        return round(clamp(89.5 + (elev - 4000) / 800, 82.0, 95.0), 1), "藏传佛教"
    if prov_code == "630000":
        if slug_match(county_name, ["西宁", "城中", "城东", "城西", "城北", "大通", "湟中", "湟源", "海东", "平安", "乐都", "互助", "民和"]):
            if slug_match(county_name, ["化隆", "循化", "民和"]):
                return 68.5, "伊斯兰教"
            return 34.0, "汉传佛教/民间信仰"
        return round(clamp(76.0 + (elev - 3200) / 400, 66.0, 88.0), 1), "藏传佛教"
    if prov_code == "510000" and slug_match(county_name, ["甘孜", "康定", "理塘", "稻城", "巴塘", "德格", "色达", "炉霍", "阿坝", "马尔康", "若尔盖", "红原", "松潘", "木里"]):
        return 74.0, "藏传佛教"
    if prov_code == "530000":
        if slug_match(county_name, ["香格里拉", "德钦", "维西", "迪庆"]):
            return 72.0, "藏传佛教"
        if slug_match(county_name, ["怒江", "泸水", "福贡", "贡山", "兰坪"]):
            return 56.0, "基督宗教"
        if slug_match(county_name, ["西双版纳", "景洪", "勐海", "勐腊", "德宏", "瑞丽", "芒市"]):
            return 62.0, "汉传佛教/民间信仰"
        if slug_match(county_name, ["红河", "文山", "楚雄", "大理", "普洱", "临沧"]):
            return 38.0, "少数民族传统信仰"
    if prov_code == "620000":
        if slug_match(county_name, ["甘南", "合作", "夏河", "玛曲", "碌曲", "卓尼", "天祝"]):
            return 76.0, "藏传佛教"
        if slug_match(county_name, ["临夏", "广河", "东乡", "积石山", "康乐", "张家川"]):
            return 72.0, "伊斯兰教"
    if prov_code == "650000":
        if slug_match(county_name, ["克拉玛依", "石河子", "五家渠", "阿拉尔", "图木舒克", "北屯", "铁门关", "可克达拉", "乌鲁木齐", "天山", "沙依巴克", "新市", "水磨沟", "昌吉", "奎屯", "哈密"]):
            return 28.0, "多元世俗/无宗教为主"
        return 74.0, "伊斯兰教"
    if prov_code == "640000":
        if slug_match(county_name, ["同心", "海原", "西吉", "泾源", "隆德", "原州", "吴忠", "利通", "红寺堡"]):
            return 64.0, "伊斯兰教"
        return 22.0, "汉传佛教/民间信仰"
    if prov_code == "330000" and slug_match(county_name, ["温州", "乐清", "瑞安", "平阳", "苍南", "龙港", "永嘉"]):
        return 46.0, "基督宗教"
    if prov_code in ("350000", "710000", "440000") and slug_match(county_name, ["莆田", "泉州", "晋江", "南安", "惠安", "漳州", "潮州", "汕头", "揭阳", "梅州", "台北", "台南", "台中", "高雄", "彰化", "云林"]):
        return round(clamp(prov_faith_100 * 1.15, 38.0, 76.0), 1), "道教/民俗信仰"
    return round(clamp(f100, 6.0, 92.0), 1), trad


# ---------------------------------------------------------------------------
# 6. Main Pipeline
# ---------------------------------------------------------------------------
def main() -> None:
    world_path = DATA_DIR / "world.json"
    lookup_path = DATA_DIR / "geo_lookup.json"
    if not world_path.exists() or not lookup_path.exists():
        raise FileNotFoundError(
            "world.json or geo_lookup.json not found yet — wait for @data-geo to finish."
        )

    print("[build_stats] Loading world.json & geo_lookup.json...")
    world = json.loads(world_path.read_text(encoding="utf-8"))
    geo_lookup = json.loads(lookup_path.read_text(encoding="utf-8"))

    grid = world["grid"]
    cols, rows = int(grid["cols"]), int(grid["rows"])
    total_cells = cols * rows
    owner_arr = world["owner"]
    elev_arr = world["elev"]
    pct_obj = world.get("pct", {})
    pct_scale = 100.0 if max(pct_obj.get("forest", [0])[:200] + [0]) <= 1.01 else 1.0

    # Pre-index cells per province
    prov_cells: list[list[int]] = [[] for _ in range(34)]
    for i, ov in enumerate(owner_arr):
        if 0 <= ov < 34:
            prov_cells[ov].append(i)

    # Load live USGS earthquake events
    eq_events = load_usgs_earthquakes()
    print(f"[build_stats] Loaded {len(eq_events)} USGS M>=4.5 earthquake events since 2000.")
    eq_xy = np.array([(x, y) for x, y, _ in eq_events], dtype=np.float64)
    eq_mag = np.array([m for _, _, m in eq_events], dtype=np.float64)

    # -----------------------------------------------------------------------
    # Build 34 States + National Aggregation
    # -----------------------------------------------------------------------
    states_out: list[dict[str, Any]] = []
    # Pre-compute national workforce & yields totals and calibrate provincial STEM baseline to 1/14 (~0.0714)
    nat_pop_34 = sum(PROVINCE_BASE[p["code"]]["pop"] for p in geo_common.PROVINCE_ORDER)
    nat_emp_34 = sum(PROVINCE_BASE[p["code"]]["emp"] for p in geo_common.PROVINCE_ORDER)
    nat_gdp_34 = sum(PROVINCE_BASE[p["code"]]["gdp"] for p in geo_common.PROVINCE_ORDER)
    raw_nat_stem = sum(
        PROVINCE_BASE[p["code"]]["emp"] * PROVINCE_BASE[p["code"]]["stem_share"]
        for p in geo_common.PROVINCE_ORDER
    )
    target_stem_share = 0.0714  # exact 1 in 14 national benchmark (~5,355万)
    stem_calib = (target_stem_share * nat_emp_34) / max(1.0, raw_nat_stem)
    for p in geo_common.PROVINCE_ORDER:
        pb = PROVINCE_BASE[p["code"]]
        pb["stem_share"] = round(pb["stem_share"] * stem_calib, 4)

    nat_stem_34 = sum(
        int(round(PROVINCE_BASE[p["code"]]["emp"] * PROVINCE_BASE[p["code"]]["stem_share"]))
        for p in geo_common.PROVINCE_ORDER
    )

    # Compute national citizen benchmark shares
    nat_jobs_accum: dict[str, int] = defaultdict(int)
    nat_gdp_ind_accum: dict[str, float] = defaultdict(float)
    for p in geo_common.PROVINCE_ORDER:
        pb = PROVINCE_BASE[p["code"]]
        jb = compute_jobs_breakdown(pb["emp"], pb["sec_pct"], pb["stem_share"], pb["badge"], pb["urb"] / 100.0)
        for k, v in jb.items():
            nat_jobs_accum[k] += v
        gi = compute_gdp_by_industry(pb["gdp"], pb["sec_pct"], pb["stem_share"], pb["badge"])
        for k, v in gi.items():
            nat_gdp_ind_accum[k] += v

    nat_stem_share = round(nat_stem_34 / nat_emp_34, 4)  # ~0.0714 (1 in 14)
    nat_citizen_shares = {
        "stem": nat_stem_share,
        "manufacturing": (nat_jobs_accum["制造业"] + nat_jobs_accum["采矿与能源"] - nat_stem_34 * 0.28) / nat_emp_34,
        "commerce": (nat_jobs_accum["商贸物流"] + nat_jobs_accum["金融与商务"]) / nat_emp_34,
        "construction": nat_jobs_accum["建筑工程"] / nat_emp_34,
        "public": (nat_jobs_accum["科教文卫公共"] + nat_jobs_accum["文旅文娱住宿"]) / nat_emp_34,
        "agriculture": nat_jobs_accum["农林牧渔"] / nat_emp_34,
    }

    # Province spatial centers from geo_lookup / world.states
    world_states = world.get("states", [])
    lookup_provs = geo_lookup.get("provinces", [])

    # County lookup entries
    g_counties = geo_lookup["counties"]
    assert len(g_counties) == 1302, f"Expected 1302 counties, got {len(g_counties)}"

    # Aggregate raw GIS area & landcover per province from counties
    prov_gis_area = [0.0] * 34
    for gc in g_counties:
        prov_gis_area[int(gc["province_idx"])] += float(gc.get("area_km2", 541.27))

    # Build city coordinate & prefecture lookup to anchor county disaggregation
    city_xy_list: list[tuple[float, float, float, int]] = []  # (x, y, pop_weight, p_idx)
    city_by_pref: dict[str, dict[str, Any]] = {}
    for cspec in CITIES_DATA:
        cx, cy = geo_common.lonlat_to_xy(cspec["lon"], cspec["lat"], grid)
        city_xy_list.append((cx, cy, math.sqrt(cspec["gdp"]), cspec["p_idx"]))
        city_by_pref[cspec["full"]] = cspec

    # -----------------------------------------------------------------------
    # Build 1,302 County Rows (mathematically tied to provincial totals + real GIS + USGS)
    # -----------------------------------------------------------------------
    counties_by_prov: list[list[dict[str, Any]]] = [[] for _ in range(34)]
    for gc in g_counties:
        c_idx = int(gc["idx"])
        p_idx = int(gc["province_idx"])
        p_meta = geo_common.PROVINCE_ORDER[p_idx]
        p_code = p_meta["code"]
        pb = PROVINCE_BASE[p_code]

        cx = float(gc["x"])
        cy = float(gc["y"])
        area = max(12.0, float(gc.get("area_km2", 541.27)))
        elev_m = float(gc.get("elev_mean", 200.0))
        elev_max = float(gc.get("elev_max", elev_m + 100.0))
        relief_span = max(0.0, elev_max - elev_m)
        cov = gc.get("cover_pcts", {}) or {}
        cells = gc.get("cells", [])

        # Extract real cell-based cover pcts (0..100)
        def cov_val(k: str) -> float:
            raw_v = cov.get(k, 0.0)
            if raw_v is None:
                return 0.0
            v = float(raw_v)
            return v * 100.0 if v <= 1.001 and max(cov.values() or [0]) <= 1.001 else v

        f_pct = cov_val("forest")
        c_pct = cov_val("crop")
        d_pct = cov_val("developed")
        if f_pct + c_pct + d_pct == 0 and cells:
            f_pct = float(np.mean([pct_obj.get("forest", [0])[ci] for ci in cells])) * pct_scale
            c_pct = float(np.mean([pct_obj.get("crop", [0])[ci] for ci in cells])) * pct_scale
            d_pct = float(np.mean([pct_obj.get("developed", [0])[ci] for ci in cells])) * pct_scale

        # Metro proximity & urban core boost
        min_city_dist = 9999.0
        metro_gravity = 0.0
        for mx, my, mw, mp_idx in city_xy_list:
            d = math.hypot(cx - mx, cy - my)
            if d < min_city_dist:
                min_city_dist = d
            if d < 280.0:
                bonus = 1.35 if mp_idx == p_idx else 0.9
                metro_gravity += bonus * mw / ((d + 22.0) ** 1.35)

        cname = str(gc["name"])
        pref_name = str(gc.get("prefecture", ""))
        anchor_city_hit = city_by_pref.get(pref_name)
        is_consolidated_core = cname.endswith("城区") or cname in ("浦东新区", "香港特别行政区", "澳门特别行政区", "台北市", "新北市", "高雄市", "台中市", "桃园市", "台南市")
        is_core = is_consolidated_core or slug_match(cname, [
            "中心", "海淀", "朝阳", "通州", "南山", "福田", "天河", "南海", "顺德",
            "昆山", "江阴", "张家港", "义乌", "萧山", "余杭", "滨海",
        ]) or cname.endswith("区")

        core_mult = 4.2 if is_consolidated_core else (2.4 if is_core else (1.45 if cname.endswith("市") else 1.0))
        elev_penalty = 1.0 / (1.0 + max(0.0, elev_m - 1200.0) / 1800.0)
        crop_boost = 1.0 + 0.55 * (c_pct / 100.0)
        dev_boost = 1.0 + 3.8 * (d_pct / 100.0)
        urban_score = clamp(
            core_mult * 0.48 + metro_gravity * 0.58 + (d_pct / 20.0) * 0.90,
            0.12,
            6.0,
        )

        # Anchor consolidated urban cores (e.g. 深圳城区, 广州城区, 苏州城区) toward real city shares
        if is_consolidated_core and anchor_city_hit and p_code not in ("110000", "310000", "120000", "500000"):
            city_pop_share = anchor_city_hit["pop"] / max(1, pb["pop"])
            pop_weight = max(0.5, city_pop_share * 42.0)
            gdp_weight = max(0.5, (anchor_city_hit["gdp"] / max(1.0, pb["gdp"])) * 42.0)
        else:
            pop_weight = max(
                0.05,
                (area ** 0.42) * elev_penalty * crop_boost * dev_boost * (0.42 + 0.78 * urban_score),
            )
            gdp_weight = pop_weight * (0.60 + 0.72 * urban_score)

        # Real USGS earthquakes within 65 km of county centroid (weighted by M>=5.5)
        dists = np.hypot(eq_xy[:, 0] - cx, eq_xy[:, 1] - cy)
        near_mask = dists <= 65.0
        eq_count = int(np.sum(near_mask))
        eq_strong = int(np.sum(near_mask & (eq_mag >= 5.5)))
        # Add realistic provincial typhoon/flood/landslide hazard component
        lon_c, lat_c = float(gc.get("lon", 110.0)), float(gc.get("lat", 30.0))
        typhoon_risk = 6 if (lon_c > 108.0 and lat_c < 29.0 and elev_m < 450) else (3 if (lon_c > 117.0 and lat_c < 38.0 and elev_m < 250) else 0)
        flood_risk = 4 if (c_pct > 30 and elev_m < 200 and lat_c < 35.0) else (2 if elev_m < 150 else 0)
        slide_risk = 3 if (relief_span > 900 and lat_c < 34.0 and lon_c < 110.0) else 0
        disasters = max(1, eq_count + eq_strong * 2 + typhoon_risk + flood_risk + slide_risk)

        counties_by_prov[p_idx].append({
            "idx": c_idx,
            "code": str(gc["code"]),
            "name": cname,
            "prefecture": pref_name,
            "anchor_city": anchor_city_hit if is_consolidated_core else None,
            "province_idx": p_idx,
            "province": p_meta["name"],
            "region": p_meta["region"],
            "lon": round(lon_c, 3),
            "lat": round(lat_c, 3),
            "x": round(cx, 2),
            "y": round(cy, 2),
            "cell": int(cells[0]) if cells else int(geo_common.xy_to_cell(cx, cy, grid, clamp=True)),
            "area_km2": round(area, 1),
            "elev_m": elev_m,
            "f_raw": f_pct,
            "c_raw": c_pct,
            "d_raw": d_pct,
            "urban_score": urban_score,
            "min_city_dist": min_city_dist,
            "pop_weight": pop_weight,
            "gdp_weight": gdp_weight,
            "disasters": disasters,
        })

    # Reconcile every province's county totals strictly to provincial baselines
    county_rows: list[dict[str, Any] | None] = [None] * 1302

    for p_idx, p_meta in enumerate(geo_common.PROVINCE_ORDER):
        p_code = p_meta["code"]
        pb = PROVINCE_BASE[p_code]
        clist = counties_by_prov[p_idx]
        assert clist, f"Province {p_code} has 0 counties!"

        sum_pw = sum(c["pop_weight"] for c in clist)
        sum_gw = sum(c["gdp_weight"] for c in clist)
        sum_area = sum(c["area_km2"] for c in clist)

        # Allocate exact integer populations summing to pb["pop"]
        raw_pops = [pb["pop"] * (c["pop_weight"] / sum_pw) for c in clist]
        int_pops = [max(500, int(round(v))) for v in raw_pops]
        diff_p = pb["pop"] - sum(int_pops)
        max_pi = max(range(len(clist)), key=lambda k: int_pops[k])
        int_pops[max_pi] = max(500, int_pops[max_pi] + diff_p)

        # Allocate GDP summing tightly to pb["gdp"]
        raw_gdps = [pb["gdp"] * (c["gdp_weight"] / sum_gw) for c in clist]

        # Calibrate provincial land cover averages to match NBS forest/farmland/developed
        raw_f_mean = sum(c["f_raw"] * c["area_km2"] for c in clist) / sum_area
        raw_c_mean = sum(c["c_raw"] * c["area_km2"] for c in clist) / sum_area
        raw_d_mean = sum(c["d_raw"] * c["area_km2"] for c in clist) / sum_area

        # Compute unscaled county profiles first so we can exact-calibrate weighted means
        u_vals = [c["urban_score"] for c in clist]
        u_mean_pop = sum(u_vals[k] * int_pops[k] for k in range(len(clist))) / max(1, sum(int_pops))

        for k, c in enumerate(clist):
            pop_k = int_pops[k]
            gdp_k = round(max(0.2, raw_gdps[k]), 2)
            gdp_pc_k = round(gdp_k * 1e8 / pop_k)

            # Relative urbanicity factor centered at 1.0 across province population
            u_rel = clamp(c["urban_score"] / max(0.2, u_mean_pop), 0.45, 2.25)
            ac = c["anchor_city"]

            # Special city core & Shenzhen districts realism
            is_sz_dist = p_code == "440000" and (c["prefecture"] == "深圳市" or slug_match(c["name"], ["深圳", "南山", "福田"]))
            is_bj_core = p_code == "110000" and slug_match(c["name"], ["北京中心城区", "海淀", "朝阳", "西城", "东城"])
            is_bj_sci = p_code == "110000" and slug_match(c["name"], ["怀柔"])
            is_sh_core = p_code == "310000" and slug_match(c["name"], ["上海中心城区", "浦东", "黄浦", "静安", "徐汇"])

            if is_sz_dist:
                income_k = 81_500
                home_k = 58_400
                med_age_k = 32.8
                mig_k = 68.2
                bach_k = 28.9
                stem_pct_k = 20.0
                comm_k = 36.5
                own_k = 43.8
            elif is_bj_core:
                income_k = 92_400
                home_k = 72_500
                med_age_k = 40.8
                mig_k = 41.2
                bach_k = 46.8
                stem_pct_k = 18.8
                comm_k = 48.0
                own_k = 64.5
            elif is_bj_sci:
                income_k = 74_200
                home_k = 34_800
                med_age_k = 41.2
                mig_k = 24.5
                bach_k = 31.5
                stem_pct_k = 14.8
                comm_k = 42.0
                own_k = 78.2
            elif is_sh_core:
                income_k = round(pb["disp"] * (1.06 if "中心" in c["name"] else 1.02))
                home_k = round(pb["home"] * (1.16 if "中心" in c["name"] else 1.04))
                med_age_k = pb["med_age"]
                mig_k = round(pb["migrant"] * 1.05, 1)
                bach_k = round(pb["bach"] * 1.08, 1)
                stem_pct_k = round(pb["stem_share"] * 100.0 * (1.08 if "浦东" in c["name"] else 1.04), 2)
                comm_k = 45.0
                own_k = 68.5
            elif ac is not None:
                income_k = round(ac["disp"])
                home_k = round(ac["home"])
                med_age_k = round(ac["age"], 1)
                mig_k = round(clamp(pb["migrant"] * (1.25 if ac["urb"] > 80 else 1.05), 4.0, 62.0), 1)
                bach_k = round(ac["bach"], 1)
                stem_pct_k = round(ac["stem"] * 100.0, 2)
                comm_k = round(clamp(pb["commute"] * 1.08, 18.0, 48.0), 1)
                own_k = round(clamp(pb["own"] - 6.5, 45.0, 92.0), 1)
            else:
                income_k = round(pb["disp"] * (0.72 + 0.28 * u_rel))
                home_k = round(max(3200.0, pb["home"] * (0.58 + 0.42 * (u_rel ** 1.15))))
                med_age_k = round(clamp(pb["med_age"] - (u_rel - 1.0) * 1.4, 27.5, 49.5), 1)
                mig_k = round(clamp(pb["migrant"] * (0.48 + 0.52 * u_rel), 1.5, 72.0), 1)
                bach_k = round(clamp(pb["bach"] * (0.56 + 0.44 * u_rel), 4.5, 64.0), 1)
                stem_pct_k = round(clamp(pb["stem_share"] * 100.0 * (0.42 + 0.58 * (u_rel ** 1.15)), 1.5, 22.0), 2)
                comm_k = round(clamp(pb["commute"] * (0.68 + 0.32 * u_rel), 14.0, 52.0), 1)
                own_k = round(clamp(pb["own"] - (u_rel - 1.0) * 7.5, 44.0, 97.5), 1)

            low_inc_k = round(clamp(pb["low_inc"] / (0.68 + 0.35 * u_rel) + max(0.0, (c["elev_m"] - 1800) / 1000.0), 0.8, 34.0), 1)
            bb_k = round(clamp(pb["broadband"] - (1.0 - min(1.3, u_rel)) * 5.5 - max(0.0, (c["elev_m"] - 2500) / 700.0), 72.0, 99.8), 1)
            hgap_k = round(clamp(pb["hgap"] * (1.28 - 0.30 * min(1.6, u_rel)) + max(0.0, (c["elev_m"] - 2200) / 450.0), 3.0, 48.0), 1)

            # Calibrated land cover (blend satellite hex cover with provincial NBS survey baseline)
            f_k = round(clamp(
                (c["f_raw"] * (pb["forest"] / raw_f_mean) if raw_f_mean > 2.0 else pb["forest"]) * 0.65 + pb["forest"] * 0.35,
                0.5, 88.0
            ), 1)
            c_k = round(clamp(
                (c["c_raw"] * (pb["farm"] / raw_c_mean) if raw_c_mean > 2.0 else pb["farm"]) * 0.65 + pb["farm"] * 0.35,
                0.2, 82.0
            ), 1)
            d_k = round(clamp(
                (c["d_raw"] * (pb["dev"] / raw_d_mean) if raw_d_mean > 1.0 else pb["dev"] * u_rel),
                0.1, 88.0
            ), 1)
            if f_k + c_k + d_k > 98.5:
                scale_lc = 98.5 / (f_k + c_k + d_k)
                f_k = round(f_k * scale_lc, 1)
                c_k = round(c_k * scale_lc, 1)
                d_k = round(d_k * scale_lc, 1)

            f100_k, ftrad_k = calibrate_county_faith(p_code, c["name"], c["elev_m"], pb["faith_100"], pb["faith_trad"])
            wb_k = round(clamp(
                pb["wellbeing"] + (u_rel - 1.0) * 3.8 - (low_inc_k - pb["low_inc"]) * 0.4 - (c["disasters"] / 35.0) * 2.5,
                54.0, 92.0
            ), 1)

            row_obj = {
                "idx": c["idx"],
                "code": c["code"],
                "name": c["name"],
                "province_idx": p_idx,
                "province": c["province"],
                "region": c["region"],
                "cell": c["cell"],
                "lon": c["lon"],
                "lat": c["lat"],
                "x": c["x"],
                "y": c["y"],
                "population": pop_k,
                "area_km2": c["area_km2"],
                "density": round(pop_k / c["area_km2"], 1),
                "gdp": gdp_k,
                "gdp_per_capita": gdp_pc_k,
                "income": income_k,
                "home_price": home_k,
                "low_income": low_inc_k,
                "median_age": med_age_k,
                "migrant_pct": mig_k,
                "bachelors_pct": bach_k,
                "broadband_pct": bb_k,
                "commute_min": comm_k,
                "homeownership_pct": own_k,
                "healthcare_gap_pct": hgap_k,
                "forest_pct": f_k,
                "farmland_pct": c_k,
                "developed_pct": d_k,
                "faith_per100": f100_k,
                "faith_tradition": ftrad_k,
                "wellbeing": wb_k,
                "disasters": int(c["disasters"]),
                "stem_pct": stem_pct_k,
            }
            county_rows[c["idx"]] = row_obj

    assert all(r is not None for r in county_rows), "Missing county row!"
    final_county_rows: list[dict[str, Any]] = [r for r in county_rows if r is not None]

    # -----------------------------------------------------------------------
    # Build 34 States Output + Province Districts
    # -----------------------------------------------------------------------
    prov_districts: dict[str, Any] = {}
    for p_idx, p_meta in enumerate(geo_common.PROVINCE_ORDER):
        p_code = p_meta["code"]
        pb = PROVINCE_BASE[p_code]
        w_st = world_states[p_idx] if p_idx < len(world_states) else {}
        lp_st = lookup_provs[p_idx] if p_idx < len(lookup_provs) else {}

        # Spatial center from world/geo_lookup or provincial capital lon/lat
        anchor_city = next((c for c in CITIES_DATA if c["p_idx"] == p_idx and c["anchor"]), None)
        cap_lon = anchor_city["lon"] if anchor_city else 105.0
        cap_lat = anchor_city["lat"] if anchor_city else 35.0
        cap_x, cap_y = geo_common.lonlat_to_xy(cap_lon, cap_lat, grid)

        st_x = float(lp_st.get("x", w_st.get("labelX", cap_x)))
        st_y = float(lp_st.get("y", w_st.get("labelY", cap_y)))
        st_cell = int(lp_st.get("cell", -1))
        if not (0 <= st_cell < total_cells):
            if prov_cells[p_idx]:
                # Pick province cell closest to centroid
                st_cell = min(
                    prov_cells[p_idx],
                    key=lambda ci: (geo_common.cell_center(ci, grid)[0] - st_x) ** 2 + (geo_common.cell_center(ci, grid)[1] - st_y) ** 2,
                )
            else:
                st_cell = geo_common.xy_to_cell(st_x, st_y, grid, clamp=True)

        p_counties = [r for r in final_county_rows if r["province_idx"] == p_idx]
        p_disasters = sum(r["disasters"] for r in p_counties)
        p_elev_mean = round(
            float(np.mean([elev_arr[ci] for ci in prov_cells[p_idx]])) if prov_cells[p_idx] else 200.0,
            1,
        )

        # Aggregate grid land percentages for province
        p_cells_list = prov_cells[p_idx] or [st_cell]
        def avg_grid_pct(key: str) -> float:
            arr = pct_obj.get(key)
            if not arr:
                return 0.0
            return round(float(np.mean([arr[ci] for ci in p_cells_list])) * pct_scale, 1)

        stem_workers = int(round(pb["emp"] * pb["stem_share"]))
        stem_ratio = round(1.0 / pb["stem_share"], 1)
        jobs = compute_jobs_breakdown(pb["emp"], pb["sec_pct"], pb["stem_share"], pb["badge"], pb["urb"] / 100.0)
        gdp_ind = compute_gdp_by_industry(pb["gdp"], pb["sec_pct"], pb["stem_share"], pb["badge"])
        yields = compute_yields(pb["gdp"], pb["grain_mt"], pb["sec_pct"], stem_workers, gdp_ind, pb["badge"])

        # Pop series
        hist_years = [1953, 1964, 1982, 1990, 2000, 2010, 2020, 2024]
        pop_series = [{"year": y, "pop": v} for y, v in zip(hist_years, pb["pop_hist"])]

        states_out.append({
            "idx": p_idx,
            "code": p_code,
            "abbr": p_meta["abbr"],
            "short": p_meta["short"],
            "name": p_meta["name"],
            "en": p_meta["en"],
            "region": p_meta["region"],
            "capital": p_meta["capital"],
            "x": round(st_x, 2),
            "y": round(st_y, 2),
            "cell": st_cell,
            "hex_count": len(prov_cells[p_idx]),
            "area_km2": round(prov_gis_area[p_idx], 1),
            "population": pb["pop"],
            "employed": pb["emp"],
            "gdp": pb["gdp"],
            "gdp_per_capita": round(pb["gdp"] * 1e8 / pb["pop"]),
            "disposable_income": pb["disp"],
            "home_price": pb["home"],
            "growth": round(((1.0 + pb["growth_5y"] / 100.0) ** 0.2 - 1.0) * 100.0, 1),
            "growth_5y_cum": pb["growth_5y"],
            "growth_years": [2020, 2025],
            "gdp_growth_annual": pb["growth_24"],
            "urbanization": pb["urb"],
            "median_age": pb["med_age"],
            "bachelors_pct": pb["bach"],
            "migrant_pct": pb["migrant"],
            "broadband_pct": pb["broadband"],
            "commute_min": pb["commute"],
            "homeownership_pct": pb["own"],
            "healthcare_gap_pct": pb["hgap"],
            "low_income": pb["low_inc"],
            "forest_pct": pb["forest"],
            "farmland_pct": pb["farm"],
            "developed_pct": pb["dev"],
            "faith_per100": pb["faith_100"],
            "faith_tradition": pb["faith_trad"],
            "wellbeing": pb["wellbeing"],
            "disasters": p_disasters,
            "grain_mt": pb["grain_mt"],
            "avg_pay": pb["avg_pay"],
            "stem_workers": stem_workers,
            "stem_share": pb["stem_share"],
            "stem_ratio_1_in_n": stem_ratio,
            "yields": yields,
            "jobs": jobs,
            "gdp_by_industry": gdp_ind,
            "land": {
                "total_km2": round(prov_gis_area[p_idx], 1),
                "forest_pct": pb["forest"],
                "farmland_pct": pb["farm"],
                "developed_pct": pb["dev"],
                "grass_pct": avg_grid_pct("grass"),
                "shrub_pct": avg_grid_pct("shrub"),
                "wetland_pct": avg_grid_pct("wetland"),
                "alpine_pct": avg_grid_pct("alpine"),
                "elev_mean": p_elev_mean,
            },
            "pop_series": pop_series,
            "badge": pb["badge"],
            "summary": pb["summary"],
        })

        # Districts + Citizens for province
        is_coastal = p_code in ("120000", "130000", "210000", "310000", "320000", "330000", "350000", "370000", "440000", "450000", "460000", "710000", "810000", "820000")
        tag = anchor_city["tag"] if anchor_city else "mfg_gov"
        d_rec = build_districts_for_entity(
            p_meta["short"], p_code, p_code, pb["badge"], pb["emp"], pb["avg_pay"],
            pb["stem_share"], jobs, tag, is_coastal=is_coastal
        )
        d_rec["citizens"] = build_citizens_list(pb["emp"], stem_workers, jobs, nat_citizen_shares)
        prov_districts[p_code] = d_rec

    compute_ranks(states_out, ["food", "production", "gold", "science", "culture", "gdp", "population", "gdp_per_capita", "disposable_income", "stem_share"])

    # -----------------------------------------------------------------------
    # Build 90 Cities Output + City Districts
    # -----------------------------------------------------------------------
    cities_out: list[dict[str, Any]] = []
    city_districts: dict[str, Any] = {}

    for cspec in CITIES_DATA:
        p_idx = int(cspec["p_idx"])
        p_meta = geo_common.PROVINCE_ORDER[p_idx]
        p_code = p_meta["code"]
        pb = PROVINCE_BASE[p_code]

        cx, cy = geo_common.lonlat_to_xy(cspec["lon"], cspec["lat"], grid)
        cell = geo_common.xy_to_cell(cx, cy, grid, clamp=True)
        # Snap cell to a China land cell if coastal point landed on water
        if not (0 <= cell < total_cells and owner_arr[cell] >= 0):
            if prov_cells[p_idx]:
                cell = min(
                    prov_cells[p_idx],
                    key=lambda ci: (geo_common.cell_center(ci, grid)[0] - cx) ** 2 + (geo_common.cell_center(ci, grid)[1] - cy) ** 2,
                )
            else:
                # Fallback to state cell
                cell = states_out[p_idx]["cell"]
            cx, cy = geo_common.cell_center(cell, grid)

        # Match counties near city (by prefecture/name + spatial radius)
        p_county_rows = [r for r in final_county_rows if r["province_idx"] == p_idx]
        radius_km = 52.0 if cspec["pop"] >= 10_000_000 else (40.0 if cspec["pop"] >= 4_000_000 else 32.0)
        matched_counties = [
            r["idx"] for r in p_county_rows
            if g_counties[r["idx"]].get("prefecture") == cspec["full"]
            or math.hypot(r["x"] - cx, r["y"] - cy) <= radius_km
            or cspec["name"] in r["name"]
        ]
        if not matched_counties and p_county_rows:
            nearest_c = min(p_county_rows, key=lambda r: math.hypot(r["x"] - cx, r["y"] - cy))
            matched_counties = [nearest_c["idx"]]

        # Build footprint cells from matched counties + hex cells within radius in same province
        fp_set: set[int] = {cell}
        for c_i in matched_counties:
            for ci in g_counties[c_i].get("cells", []):
                if 0 <= ci < total_cells:
                    fp_set.add(ci)
        for ci in prov_cells[p_idx]:
            hx, hy = geo_common.cell_center(ci, grid)
            if math.hypot(hx - cx, hy - cy) <= radius_km:
                fp_set.add(ci)
        footprint = sorted(fp_set)

        # Employed workers & STEM ratio
        emp_ratio = clamp(pb["emp"] / pb["pop"] * (1.06 if cspec["urb"] > 80 else 0.98), 0.46, 0.58)
        emp = max(1000, int(round(cspec["pop"] * emp_ratio)))
        stem_share = cspec["stem"]
        stem_workers = max(100, int(round(emp * stem_share)))
        stem_ratio = round(1.0 / stem_share, 1)

        # Industry mix calibrated by city tag & parent province
        p1, p2, p3 = pb["sec_pct"]
        tag = cspec["tag"]
        if cspec["id"] in ("beijing", "shanghai", "hongkong", "macau"):
            sec_pct = p1, p2, p3
        elif "fin" in tag or "tourism" in tag or cspec["urb"] >= 95:
            sec_pct = (max(0.3, round(p1 * 0.35, 1)), round(p2 * 0.90, 1), 0.0)
            sec_pct = (sec_pct[0], sec_pct[1], round(100.0 - sec_pct[0] - sec_pct[1], 1))
        elif "mfg" in tag or "energy" in tag or "sz_tech" in tag:
            c1 = max(0.5, round(p1 * 0.55, 1))
            c2 = clamp(round(p2 * 1.12, 1), 32.0, 56.0)
            sec_pct = (c1, c2, round(100.0 - c1 - c2, 1))
        else:
            c1 = max(1.0, round(p1 * 0.72, 1))
            c2 = clamp(round(p2 * 0.96, 1), 22.0, 48.0)
            sec_pct = (c1, c2, round(100.0 - c1 - c2, 1))

        # Grain output share for city
        city_grain = round(max(0.2, pb["grain_mt"] * (sec_pct[0] / max(0.5, p1)) * (cspec["pop"] / pb["pop"]) * 0.8), 1)
        if cspec["id"] in ("beijing", "shanghai", "tianjin", "chongqing", "hongkong", "macau"):
            city_grain = pb["grain_mt"]

        jobs = compute_jobs_breakdown(emp, sec_pct, stem_share, tag, cspec["urb"] / 100.0)
        gdp_ind = compute_gdp_by_industry(cspec["gdp"], sec_pct, stem_share, tag)
        yields = compute_yields(cspec["gdp"], city_grain, sec_pct, stem_workers, gdp_ind, tag)

        # City population series (1982-2024 realistic urban trajectory)
        p_pop_24 = cspec["pop"]
        urban_accel = 0.28 if cspec["id"] == "shenzhen" else (0.62 if cspec["urb"] > 85 else 0.74)
        city_hist_years = [1982, 1990, 2000, 2010, 2020, 2024]
        if cspec["id"] == "shenzhen":
            city_hist_pops = [351_000, 1_667_000, 7_008_000, 10_358_000, 17_560_000, p_pop_24]
        else:
            city_hist_pops = [
                int(round(p_pop_24 * (urban_accel * 0.58))),
                int(round(p_pop_24 * (urban_accel * 0.70))),
                int(round(p_pop_24 * (urban_accel * 0.86))),
                int(round(p_pop_24 * 0.89)),
                int(round(p_pop_24 * 0.98)),
                p_pop_24,
            ]
        pop_series = [{"year": y, "pop": v} for y, v in zip(city_hist_years, city_hist_pops)]

        stem_note = (
            "每5名劳动者中有1名工程师、程序员或科学家，全国平均每14人中有1名"
            if cspec["id"] == "shenzhen"
            else f"每{stem_ratio:.0f}名劳动者中有1名工程师、程序员或科学家（全国平均每14人中有1名）"
        )

        cities_out.append({
            "id": cspec["id"],
            "adcode": cspec["adcode"],
            "name": cspec["name"],
            "full": cspec["full"],
            "province_idx": p_idx,
            "province_abbr": p_meta["abbr"],
            "province_name": p_meta["name"],
            "is_provincial_anchor": cspec["anchor"],
            "capital": cspec["anchor"],
            "lon": cspec["lon"],
            "lat": cspec["lat"],
            "x": round(cx, 2),
            "y": round(cy, 2),
            "cell": cell,
            "footprint": footprint,
            "population": cspec["pop"],
            "gdp": cspec["gdp"],
            "gdp_per_capita": round(cspec["gdp"] * 1e8 / max(1, cspec["pop"])),
            "growth": round(((1.0 + cspec["g5"] / 100.0) ** 0.2 - 1.0) * 100.0, 1),
            "growth_5y_cum": cspec["g5"],
            "growth_years": [2020, 2025],
            "disposable_income": cspec["disp"],
            "home_price": cspec["home"],
            "unemployment": cspec["unemp"],
            "employed": emp,
            "avg_pay": cspec["pay"],
            "urbanization": cspec["urb"],
            "median_age": cspec["age"],
            "bachelors_pct": cspec["bach"],
            "stem_workers": stem_workers,
            "stem_share": stem_share,
            "stem_ratio_1_in_n": stem_ratio,
            "stem_note": stem_note,
            "yields": yields,
            "jobs": jobs,
            "gdp_by_industry": gdp_ind,
            "pop_series": pop_series,
            "counties": matched_counties,
            "badge": cspec["badge"],
            "summary": f"{cspec['full']}（{p_meta['name']}），{cspec['badge']}；2024年GDP {cspec['gdp']:,.1f}亿元，常住人口{cspec['pop']/10000:,.1f}万人。",
        })

        # Districts & Citizens for city
        is_coastal_c = ("port" in tag) or (cspec["id"] in ("shanghai", "shenzhen", "guangzhou", "ningbo", "qingdao", "dalian", "xiamen", "fuzhou", "tianjin", "haikou", "sanya", "hongkong", "macau", "kaohsiung"))
        cd_rec = build_districts_for_entity(
            cspec["name"], cspec["adcode"], cspec["id"], cspec["badge"], emp, cspec["pay"],
            stem_share, jobs, tag, is_coastal=is_coastal_c
        )
        cd_rec["citizens"] = build_citizens_list(emp, stem_workers, jobs, nat_citizen_shares)
        city_districts[cspec["id"]] = cd_rec

    compute_ranks(cities_out, ["food", "production", "gold", "science", "culture", "gdp", "population", "gdp_per_capita", "disposable_income", "stem_share"])

    # -----------------------------------------------------------------------
    # Build nation.json
    # -----------------------------------------------------------------------
    tot_food = round(sum(s["yields"]["food"] for s in states_out), 1)
    tot_prod = round(sum(s["yields"]["production"] for s in states_out), 1)
    tot_gold = round(sum(s["yields"]["gold"] for s in states_out), 1)
    tot_sci = int(sum(s["yields"]["science"] for s in states_out))
    tot_cul = round(sum(s["yields"]["culture"] for s in states_out), 1)

    nation_out = {
        "name": "中国",
        "full_name": "中华人民共和国",
        "vintage": "2024–2025（国家统计局公报 / 第七次人口普查 / 港澳台官方统计）",
        "population": 1_439_900_000,
        "population_mainland": 1_408_280_000,
        "population_hk_mo_tw": 31_620_000,
        "population_34_prov_sum": nat_pop_34,
        "population_note": "中国内地31省份2024年末常住人口为14.0828亿人（国家统计局公报），加计香港752.4万人、澳门68.6万人、台湾2341.0万人合计约14.40亿人（34省加总14.38亿人，含全国口径统筹差约197万人）。",
        "employed": nat_emp_34,
        "employed_mainland": 734_390_000,
        "gdp": round(nat_gdp_34, 1),
        "gdp_mainland": 1_349_084.0,
        "gdp_mainland_verified": 1_348_066.0,
        "gdp_note": "中国内地2024年GDP初步核算134.91万亿元（五经普最终核实134.81万亿元），加计港澳台约8.93万亿元，全口径合计约143.60万亿元。",
        "gdp_per_capita": round(nat_gdp_34 * 1e8 / nat_pop_34),
        "gdp_per_capita_mainland": 95_749,
        "disposable_income": 41_314,
        "disposable_income_urban": 54_188,
        "disposable_income_rural": 23_119,
        "home_price": 14_203,
        "urbanization": 67.0,
        "growth": 5.0,
        "growth_5y_cum": 27.8,
        "growth_years": [2020, 2025],
        "gdp_growth_annual": 5.0,
        "grain_mt_mainland": 70_650.0,
        "rd_expenditure_yi": 36_326.8,
        "rd_intensity_pct": 2.69,
        "stem_workers": nat_stem_34,
        "stem_share": nat_stem_share,
        "stem_ratio_1_in_n": 14,
        "benchmarks": {
            "national_stem_1_in": 14,
            "shenzhen_stem_1_in": 5,
            "national_stem_share": nat_stem_share,
            "shenzhen_stem_share": 0.20,
        },
        "yields": {
            "food": tot_food,
            "production": tot_prod,
            "gold": tot_gold,
            "science": tot_sci,
            "culture": tot_cul,
        },
        "yield_meta": {
            "food": {"label": "粮食 (农业产出)", "unit": "万吨当量", "source": "国家统计局粮食产量(70,650万吨)及第一产业当量"},
            "production": {"label": "生产力 (工业建筑)", "unit": "亿元", "source": "第二产业工业与建筑业增加值(内地49.2万亿元)"},
            "gold": {"label": "金币 (GDP总量)", "unit": "亿元", "source": "2024年地区生产总值(内地134.9万亿元+港澳台)"},
            "science": {"label": "科技 (STEM人才)", "unit": "人", "source": "信息软件、科研技术及高技术工程人员(约5,355万人，1/14)"},
            "culture": {"label": "文化 (文旅文博)", "unit": "亿元", "source": "文化体育娱乐、旅游与现代公共文化产出"},
        },
        "jobs": dict(nat_jobs_accum),
        "gdp_by_industry": {k: round(v, 1) for k, v in nat_gdp_ind_accum.items()},
        "pop_series": [
            {"year": 1953, "pop": 582_600_000},
            {"year": 1964, "pop": 694_580_000},
            {"year": 1982, "pop": 1_008_180_000},
            {"year": 1990, "pop": 1_133_680_000},
            {"year": 2000, "pop": 1_265_830_000},
            {"year": 2010, "pop": 1_339_720_000},
            {"year": 2020, "pop": 1_411_780_000},
            {"year": 2024, "pop": 1_408_280_000},
        ],
        "counts": {
            "provinces": len(states_out),
            "cities": len(cities_out),
            "counties": len(final_county_rows),
            "usgs_earthquakes_since_2000": len(eq_events),
        },
    }

    # -----------------------------------------------------------------------
    # Calibrate 19 Lenses Legend Breaks directly from 1,302 County Values
    # -----------------------------------------------------------------------
    lenses_out: list[dict[str, Any]] = []
    for lspec in LENS_SPECS:
        lens_copy = dict(lspec)
        if lens_copy.get("scale") != "categorical":
            f_key = lens_copy["countyField"]
            vals = sorted(
                float(r[f_key])
                for r in final_county_rows
                if isinstance(r.get(f_key), (int, float)) and math.isfinite(float(r[f_key]))
            )
            if vals:
                qs = [0.02, 0.18, 0.36, 0.55, 0.74, 0.90, 0.985]
                raw_breaks = [vals[min(len(vals) - 1, int(q * (len(vals) - 1)))] for q in qs]
                # Ensure strictly monotonic breaks
                clean_breaks: list[float] = []
                for b in raw_breaks:
                    rb = round(b, 2 if b < 100 else 0)
                    if clean_breaks and rb <= clean_breaks[-1]:
                        rb = round(clean_breaks[-1] + (0.5 if clean_breaks[-1] < 20 else 1.0), 2)
                    clean_breaks.append(rb)
                lens_copy["breaks"] = clean_breaks
        lenses_out.append(lens_copy)

    # -----------------------------------------------------------------------
    # Write all 7 JSON files cleanly
    # -----------------------------------------------------------------------
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    outputs: list[tuple[str, Any]] = [
        ("nation.json", nation_out),
        ("states.json", states_out),
        ("cities.json", cities_out),
        ("counties.json", {
            "vintage": "2024–2025",
            "count": len(final_county_rows),
            "fields": COUNTY_FIELDS,
            "columns": [f["key"] for f in COUNTY_FIELDS],
            "rows": final_county_rows,
        }),
        ("districts.json", {
            "version": 1,
            "vintage": "2024–2025",
            "national_stem_1_in": 14,
            "national_stem_share": nat_stem_share,
            "shenzhen_stem_1_in": 5,
            "cities": city_districts,
            "provinces": prov_districts,
        }),
        ("lenses.json", {
            "version": 1,
            "groups": LENS_GROUPS,
            "lenses": lenses_out,
        }),
        ("sources.json", {
            "version": 1,
            "vintage": "2024–2025",
            "sources": SOURCES_LIST,
        }),
    ]

    for fname, payload in outputs:
        out_path = DATA_DIR / fname
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
            encoding="utf-8",
        )
        size_kb = out_path.stat().st_size / 1024.0
        print(f"[build_stats] Wrote web/data/{fname} ({size_kb:.1f} KB)")

    print(
        f"[build_stats] DONE: 34 states, {len(cities_out)} cities, {len(final_county_rows)} counties, "
        f"{len(lenses_out)} lenses, {len(SOURCES_LIST)} sources, national STEM={nat_stem_share:.4f} (1/{round(1/nat_stem_share)})."
    )


if __name__ == "__main__":
    main()
