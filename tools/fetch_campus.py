#!/usr/bin/env python3
"""충남대 캠퍼스 데이터를 OpenStreetMap(Overpass)에서 받아 campus.json 으로 저장합니다.

받는 것: 캠퍼스 경계 · 건물(이름·층수) · 도로 · 녹지/운동장/연못/주차장 · 나무 · 교문(정문/서문/후문) · 백마상
사용법 (인터넷이 되는 본인 PC에서 한 번만):
    python3 tools/fetch_campus.py
생성된 campus.json 을 index.html 옆에 두면, 게임이 지도 서버를 거치지 않고
이 파일을 먼저 읽습니다. (받는 사람 기기에서 더 빠르고 안정적)
데이터 © OpenStreetMap contributors (ODbL)
"""
import json, sys, urllib.parse, urllib.request

CENTER = (36.3667, 127.3447)
HW = '^(primary|secondary|tertiary|residential|service|unclassified|pedestrian|footway|living_street|path|steps|cycleway|track)$'
LAND = '''
way["leisure"~"^(park|garden|pitch|track|playground|stadium)$"](area.a);
way["landuse"~"^(grass|forest|meadow|scrub|reservoir|basin|village_green|recreation_ground)$"](area.a);
way["natural"~"^(wood|water|scrub|grassland)$"](area.a);
way["amenity"="parking"](area.a);
node["natural"="tree"](area.a);
node["name"~"정문|서문|후문|북문|남문|동문|쪽문"](area.a);
way["name"~"정문|서문|후문|북문|남문|동문"](area.a);
node["name"~"백마"](area.a);
node["entrance"="main"](area.a);'''
Q_AREA = f'''[out:json][timeout:90];
(way["amenity"="university"]["name"~"충남대"];relation["amenity"="university"]["name"~"충남대"];)->.u;
.u map_to_area->.a;
(way["building"](area.a);way["highway"~"{HW}"](area.a);{LAND}.u;);
out geom tags;'''
Q_AROUND = f'''[out:json][timeout:90];
(way["building"](around:1500,{CENTER[0]},{CENTER[1]});
way["highway"~"{HW}"](around:1500,{CENTER[0]},{CENTER[1]});
way["leisure"~"^(park|garden|pitch|track|playground)$"](around:1500,{CENTER[0]},{CENTER[1]});
way["landuse"~"^(grass|forest|meadow|scrub)$"](around:1500,{CENTER[0]},{CENTER[1]});
way["natural"~"^(wood|water)$"](around:1500,{CENTER[0]},{CENTER[1]});
node["name"~"정문|서문|후문|백마"](around:1500,{CENTER[0]},{CENTER[1]});
way["amenity"="university"]["name"~"충남대"](around:1500,{CENTER[0]},{CENTER[1]}););
out geom tags;'''
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
KEEP_TAGS = {'name', 'name:ko', 'building', 'building:levels', 'height', 'highway', 'leisure', 'landuse', 'natural', 'amenity', 'entrance', 'barrier'}

def run(query):
    body = urllib.parse.urlencode({'data': query}).encode()
    for url in MIRRORS:
        try:
            req = urllib.request.Request(url, data=body, headers={'User-Agent': 'smash-cnu-gift/2.0'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception as e:
            print('실패:', url, e, file=sys.stderr)
    return None

def count(d, pred):
    return sum(1 for e in (d or {}).get('elements', []) if pred(e))

def slim(d):
    """게임에 필요 없는 태그를 지워 파일을 줄입니다 (구조는 Overpass 형식 그대로)."""
    out = []
    for e in d.get('elements', []):
        t = {k: v for k, v in (e.get('tags') or {}).items() if k in KEEP_TAGS}
        n = {'type': e['type'], 'id': e['id'], 'tags': t}
        if e['type'] == 'node':
            n['lat'] = e['lat']; n['lon'] = e['lon']
        elif e['type'] == 'way':
            n['geometry'] = [{'lat': round(g['lat'], 7), 'lon': round(g['lon'], 7)} for g in e.get('geometry', [])]
        elif e['type'] == 'relation':
            n['members'] = [{'type': m['type'], 'ref': m.get('ref'), 'role': m.get('role', ''),
                             'geometry': [{'lat': round(g['lat'], 7), 'lon': round(g['lon'], 7)} for g in m.get('geometry', [])]}
                            for m in e.get('members', []) if 'geometry' in m]
        out.append(n)
    return {'elements': out}

is_b = lambda e: e.get('type') == 'way' and 'building' in e.get('tags', {})
data = run(Q_AREA)
if count(data, is_b) < 15:
    print('대학 경계로는 건물이 적어, 반경 1.5km 방식으로 다시 시도합니다.')
    data = run(Q_AROUND)
if count(data, is_b) < 15:
    sys.exit('건물 데이터를 받지 못했어요. 잠시 후 다시 시도해 주세요.')
data = slim(data)
with open('campus.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
nb = count(data, is_b)
named = count(data, lambda e: is_b(e) and (e['tags'].get('name') or e['tags'].get('name:ko')))
gates = [e['tags'].get('name') for e in data['elements'] if e.get('type') == 'node' and any(k in (e['tags'].get('name') or '') for k in ('정문', '서문', '후문'))]
trees = count(data, lambda e: e.get('type') == 'node' and e['tags'].get('natural') == 'tree')
print(f'campus.json 저장 완료 — 건물 {nb}동(이름 {named}) · 나무 {trees}그루 · 교문 {gates or "없음(게임이 동쪽 경계에 정문을 자동 배치)"}')
print('이름이 없는 건물이 많다면 openstreetmap.org 에서 건물 이름(name)을 직접 보태 주세요. 다음 실행부터 반영됩니다.')
