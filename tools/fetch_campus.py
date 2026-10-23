#!/usr/bin/env python3
"""충남대 캠퍼스 건물·도로 데이터를 OpenStreetMap(Overpass)에서 받아 campus.json 으로 저장합니다.

사용법 (인터넷이 되는 본인 PC에서 한 번만):
    python3 tools/fetch_campus.py

생성된 campus.json 을 index.html 옆에 두면, 게임이 지도 서버를 거치지 않고
이 파일을 먼저 읽습니다. (받는 사람 기기에서 더 빠르고 안정적)
데이터 © OpenStreetMap contributors (ODbL)
"""
import json, sys, urllib.parse, urllib.request

CENTER = (36.3667, 127.3447)
HW = '^(primary|secondary|tertiary|residential|service|unclassified|pedestrian|footway|living_street|path|steps|cycleway)$'
Q_AREA = f'''[out:json][timeout:60];
(way["amenity"="university"]["name"~"충남대"];relation["amenity"="university"]["name"~"충남대"];)->.u;
.u map_to_area->.a;
(way["building"](area.a);way["highway"~"{HW}"](area.a););
out geom tags;'''
Q_AROUND = f'''[out:json][timeout:60];
(way["building"](around:1500,{CENTER[0]},{CENTER[1]});way["highway"~"{HW}"](around:1500,{CENTER[0]},{CENTER[1]}););
out geom tags;'''
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

def run(query):
    body = urllib.parse.urlencode({'data': query}).encode()
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers={'User-Agent': 'smash-cnu-gift/1.0'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:
            print('실패:', url, e, file=sys.stderr)
    return None

def count_buildings(d):
    return sum(1 for e in (d or {}).get('elements', []) if e.get('type') == 'way' and 'building' in e.get('tags', {}))

data = run(Q_AREA)
if count_buildings(data) < 15:
    print('대학 경계로는 건물이 적어, 반경 1.5km 방식으로 다시 시도합니다.')
    data = run(Q_AROUND)
if count_buildings(data) < 15:
    sys.exit('건물 데이터를 받지 못했어요. 잠시 후 다시 시도해 주세요.')
with open('campus.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False)
print(f'campus.json 저장 완료 — 건물 {count_buildings(data)}동')
