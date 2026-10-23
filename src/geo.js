// 지도 데이터(OpenStreetMap) 로딩 · 변환 · 내장 근사 캠퍼스
// 순수 JS 모듈이라 Node에서도 테스트할 수 있습니다.

// 충남대학교 대전 본캠퍼스 중심 (대략)
export const CENTER = { lat: 36.3667, lon: 127.3447 };
export const MAX_RADIUS = 1700; // 중심에서 이 거리(m) 안의 건물만 사용

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const HIGHWAY_RE =
  '^(primary|secondary|tertiary|residential|service|unclassified|pedestrian|footway|living_street|path|steps|cycleway)$';

const Q_AREA = `[out:json][timeout:30];
(way["amenity"="university"]["name"~"충남대"];relation["amenity"="university"]["name"~"충남대"];)->.u;
.u map_to_area->.a;
(way["building"](area.a);way["highway"~"${HIGHWAY_RE}"](area.a););
out geom tags;`;

const Q_AROUND = `[out:json][timeout:30];
(way["building"](around:1500,${CENTER.lat},${CENTER.lon});
way["highway"~"${HIGHWAY_RE}"](around:1500,${CENTER.lat},${CENTER.lon}););
out geom tags;`;

export function project(lat, lon) {
  const kx = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
  return [(lon - CENTER.lon) * kx, -(lat - CENTER.lat) * 110574];
}

function hashInt(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

const ROAD_WIDTH = {
  primary: 11, secondary: 10, tertiary: 9, residential: 7, unclassified: 7,
  service: 5, living_street: 5, pedestrian: 5, footway: 2.6, path: 2.2,
  steps: 2.4, cycleway: 2.6,
};

const NAME_BLOCK = /^(?:\d+|[A-Za-z]?\d+[A-Za-z]?)$/;

// Overpass JSON -> { buildings, roads }
export function parseOSM(json) {
  const buildings = [];
  const roads = [];
  const els = (json && json.elements) || [];
  for (const el of els) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const tags = el.tags || {};
    const pts = el.geometry.map((g) => project(g.lat, g.lon));
    if (tags.building) {
      if (pts.length < 4) continue;
      if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) continue;
      const area = polyArea(pts);
      const aa = Math.abs(area);
      if (aa < 40) continue; // 너무 작은 건물(창고, 정자 등) 제외
      if (area < 0) pts.reverse();
      let cx = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cz += p[1]; }
      cx /= pts.length; cz /= pts.length;
      if (Math.hypot(cx, cz) > MAX_RADIUS) continue;
      let r = 0;
      for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cz));
      let h = parseFloat(tags.height);
      if (!(h > 0)) {
        const lv = parseFloat(tags['building:levels']);
        if (lv > 0) h = lv * 3.4 + 1.5;
      }
      if (!(h > 0)) {
        const k = hashInt(el.id | 0) % 100;
        h = 9 + (k / 100) * 14; // 정보가 없으면 9~23m 사이
        if (aa > 1500) h += 6;
      }
      h = Math.max(4.5, Math.min(h, 90));
      const nm = tags['name:ko'] || tags.name || '';
      buildings.push({
        id: el.id, name: NAME_BLOCK.test(nm) ? '' : nm,
        pts, cx, cz, r, area: aa, h,
        color: pickColor(el.id, tags),
      });
    } else if (tags.highway) {
      const w = ROAD_WIDTH[tags.highway] || 4;
      roads.push({ pts, w });
    }
  }
  return { buildings, roads };
}

const PALETTE = [0xd9d2c3, 0xc9c3b6, 0xe2dccd, 0xbfb8aa, 0xcdbfa7, 0xd8c7b0, 0xb9c0c4, 0xc4cfd2, 0xe6e0d4];
function pickColor(id, tags) {
  const k = hashInt((id | 0) + 7) % PALETTE.length;
  if (tags && /dormitory|residential|apartments/.test(tags.building || '')) return 0xd6b9a3;
  return PALETTE[k];
}

// 캠퍼스 중심을 원점으로 이동
export function recenter(data) {
  const bs = data.buildings;
  if (!bs.length) return data;
  const xs = bs.map((b) => b.cx).sort((a, b) => a - b);
  const zs = bs.map((b) => b.cz).sort((a, b) => a - b);
  const mx = xs[xs.length >> 1], mz = zs[zs.length >> 1];
  for (const b of bs) {
    for (const p of b.pts) { p[0] -= mx; p[1] -= mz; }
    b.cx -= mx; b.cz -= mz;
  }
  for (const r of data.roads) for (const p of r.pts) { p[0] -= mx; p[1] -= mz; }
  data.radius = Math.max(250, ...bs.map((b) => Math.hypot(b.cx, b.cz) + b.r));
  return data;
}

function sourceStats(data) {
  return `건물 ${data.buildings.length}동 · 도로 ${data.roads.length}개`;
}

async function postOverpass(url, query, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: 'data=' + encodeURIComponent(query),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const CACHE_KEY = 'cnu-smash-campus-v1';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || Date.now() - o.t > 30 * 864e5) return null;
    return o.d;
  } catch (e) { return null; }
}
function writeCache(d) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* 용량 초과 등은 무시 */ }
}

// 1) ./campus.json (미리 저장한 데이터) 2) 브라우저 캐시 3) Overpass 서버 순서로 시도
export async function loadRealCampus(onStatus = () => {}) {
  const say = (m) => { try { onStatus(m); } catch (e) { /* noop */ } };

  say('저장된 캠퍼스 데이터 확인 중…');
  try {
    const r = await fetch('./campus.json', { cache: 'no-cache' });
    if (r.ok) {
      const d = recenter(parseOSM(await r.json()));
      if (d.buildings.length >= 15) { d.source = 'file'; d.stats = sourceStats(d); return d; }
    }
  } catch (e) { /* 파일이 없으면 다음 단계 */ }

  const cached = readCache();
  if (cached) {
    const d = recenter(parseOSM(cached));
    if (d.buildings.length >= 15) { d.source = 'cache'; d.stats = sourceStats(d); return d; }
  }

  const queries = [Q_AREA, Q_AROUND];
  for (const q of queries) {
    for (let i = 0; i < MIRRORS.length; i++) {
      say(`지도 서버에서 캠퍼스 불러오는 중… (${i + 1}/${MIRRORS.length})`);
      try {
        const json = await postOverpass(MIRRORS[i], q, 25000);
        const d = recenter(parseOSM(json));
        if (d.buildings.length >= 15) {
          writeCache(json);
          d.source = 'osm'; d.stats = sourceStats(d);
          return d;
        }
        break; // 응답은 왔지만 건물이 부족 → 다음 쿼리
      } catch (e) { /* 다음 미러 */ }
    }
  }
  throw new Error('지도 서버에 연결하지 못했어요');
}

// ───────── 내장 근사 캠퍼스 (지도를 못 불러왔을 때) ─────────
// [이름, 중심x, 중심z, 가로, 세로, 높이, 회전(도)]
const FALLBACK = [
  ['정심화국제문화회관', 0, -70, 64, 44, 24, 0],
  ['중앙도서관', -120, -100, 84, 46, 30, 0],
  ['대학본부', 130, -130, 58, 36, 26, 0],
  ['학생회관', 0, -210, 54, 40, 17, 0],
  ['인문대학', -270, -160, 92, 40, 28, 0],
  ['사회과학대학', -270, -50, 84, 40, 26, 0],
  ['경상대학', -270, 60, 72, 40, 25, 0],
  ['자연과학대학', 270, -160, 84, 46, 28, 0],
  ['생명시스템과학대학', 270, -60, 62, 40, 22, 0],
  ['농업생명과학대학', 400, 50, 104, 46, 26, 0],
  ['공과대학 1호관', -70, 150, 72, 36, 24, 0],
  ['공과대학 2호관', -200, 170, 70, 36, 30, 0],
  ['공과대학 3호관', 60, 170, 72, 36, 44, 0],
  ['공과대학 4호관', 190, 170, 70, 36, 38, 0],
  ['공과대학 5호관', 320, 190, 66, 36, 34, 0],
  ['약학대학', -410, -110, 54, 36, 22, 0],
  ['사범대학', -400, 20, 64, 36, 22, 0],
  ['생활과학대학', -390, 130, 54, 36, 20, 0],
  ['예술대학', -130, 320, 64, 42, 20, 0],
  ['음악관', -30, 330, 46, 34, 18, 0],
  ['체육관', 190, -270, 92, 62, 20, 0],
  ['박물관', 60, -320, 48, 32, 14, 0],
  ['학생생활관 1동', 500, -200, 52, 20, 38, 0],
  ['학생생활관 2동', 500, -140, 52, 20, 38, 0],
  ['학생생활관 3동', 500, -80, 52, 20, 42, 0],
  ['학생생활관 4동', 440, -250, 20, 52, 36, 0],
  ['산학협력관', 150, 40, 58, 34, 32, 0],
  ['연구실험동', 360, -240, 56, 34, 24, 0],
  ['보건대학', -90, 250, 50, 30, 22, 0],
  ['정문 수위실', 0, 430, 18, 12, 6, 0],
  ['동아리방', 100, -20, 40, 20, 12, 15],
  ['카페테리아', -30, -150, 36, 24, 10, 0],
  ['학군단', 220, 90, 40, 24, 12, -10],
  ['공동실험실습관', 440, 150, 56, 32, 28, 0],
  ['창업지원센터', -190, 40, 46, 28, 20, 0],
  ['평생교육원', -190, -230, 50, 30, 18, 0],
  ['연구동 A', 140, 270, 48, 30, 26, 0],
  ['연구동 B', 240, 280, 48, 30, 30, 0],
  ['강당', -300, 250, 60, 44, 18, 0],
  ['소극장', 330, -40, 34, 26, 12, 0],
];

export function buildFallbackCampus() {
  const buildings = [];
  FALLBACK.forEach((f, i) => {
    const [name, cx, cz, w, d, h, rot] = f;
    const a = (rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    const pts = corners.map(([x, z]) => [cx + x * ca - z * sa, cz + x * sa + z * ca]);
    buildings.push({
      id: 900000 + i, name, pts, cx, cz,
      r: Math.hypot(w, d) / 2, area: w * d, h,
      color: PALETTE[hashInt(i + 3) % PALETTE.length],
    });
  });
  const roads = [];
  const line = (x1, z1, x2, z2, w) => roads.push({ pts: [[x1, z1], [x2, z2]], w });
  line(0, 460, 0, -380, 12);       // 중앙 대로
  line(-520, 100, 540, 100, 10);   // 가로 대로
  line(-520, -30, 540, -30, 8);
  line(-520, -180, 540, -180, 8);
  line(-520, 290, 400, 290, 8);
  line(-350, -300, -350, 330, 8);
  line(350, -300, 350, 330, 8);
  line(200, -380, 200, 330, 6);
  line(-190, -380, -190, 330, 6);
  const data = { buildings, roads, source: 'fallback', stats: `내장 근사 캠퍼스 · 건물 ${buildings.length}동` };
  data.radius = 620;
  return data;
}
