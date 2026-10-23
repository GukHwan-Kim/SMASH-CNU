// 지도 데이터(OpenStreetMap) 로딩 · 변환 · 건물 스타일 분류 · 내장 근사 캠퍼스
// 순수 JS 모듈이라 Node에서도 테스트할 수 있습니다.

// 충남대학교 대전 대덕캠퍼스 중심 (대략)
export const CENTER = { lat: 36.3667, lon: 127.3447 };
export const MAX_RADIUS = 1700; // 중심에서 이 거리(m) 안의 건물만 사용
export const SCHOOL_PREFIX = /^(국립)?충남대(학교)?\s*/;

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const HIGHWAY_RE =
  '^(primary|secondary|tertiary|residential|service|unclassified|pedestrian|footway|living_street|path|steps|cycleway|track)$';
const LAND_SEL = `
way["leisure"~"^(park|garden|pitch|track|playground|stadium)$"](area.a);
way["landuse"~"^(grass|forest|meadow|scrub|reservoir|basin|village_green|recreation_ground)$"](area.a);
way["natural"~"^(wood|water|scrub|grassland)$"](area.a);
way["amenity"="parking"](area.a);
node["natural"="tree"](area.a);
node["name"~"정문|후문|서문|북문|동문|남문|백마|시계탑|분수"](area.a);
node["highway"="bus_stop"]["name"~"충남대"](around:1400,${CENTER.lat},${CENTER.lon});
node["tourism"="artwork"](area.a);node["historic"](area.a);`;

// 캠퍼스 경계(amenity=university) 안의 건물·도로·녹지·나무 + 경계 자체
export const Q_AREA = `[out:json][timeout:40];
(way["amenity"="university"]["name"~"충남대"];relation["amenity"="university"]["name"~"충남대"];)->.u;
.u map_to_area->.a;
(way["building"](area.a);way["highway"~"${HIGHWAY_RE}"](area.a);${LAND_SEL}.u;);
out geom tags;`;

// 경계를 못 찾을 때: 반경 1.5km
export const Q_AROUND = `[out:json][timeout:40];
(way["building"](around:1500,${CENTER.lat},${CENTER.lon});
way["highway"~"${HIGHWAY_RE}"](around:1500,${CENTER.lat},${CENTER.lon});
way["leisure"~"^(park|garden|pitch|track|playground)$"](around:1500,${CENTER.lat},${CENTER.lon});
way["landuse"~"^(grass|forest|meadow|scrub)$"](around:1500,${CENTER.lat},${CENTER.lon});
way["natural"~"^(wood|water)$"](around:1500,${CENTER.lat},${CENTER.lon});
way["amenity"="university"]["name"~"충남대"](around:1500,${CENTER.lat},${CENTER.lon}););
out geom tags;`;

export function project(lat, lon) {
  const kx = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
  return [(lon - CENTER.lon) * kx, -(lat - CENTER.lat) * 110574];
}

export function hashInt(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}
export function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// 결정적 난수 (같은 데이터면 늘 같은 모습)
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}
export function pointInRing(x, z, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[j];
    if ((z1 > z) !== (z2 > z) && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) c = !c;
  }
  return c;
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

export const ROAD_WIDTH = {
  primary: 12, secondary: 10.5, tertiary: 9, residential: 6.5, unclassified: 6.5,
  service: 4.5, living_street: 5, pedestrian: 4.5, footway: 2.4, path: 2.0,
  steps: 2.6, cycleway: 2.4, track: 3,
};
export const FOOT = new Set(['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track']);

const NAME_BLOCK = /^(?:\d+|[A-Za-z]?\d+[A-Za-z]?)$/;

// ───────── 건물 스타일 (이름·용도 → 외벽 재질 · 층수 추정) ─────────
// 스타일 번호는 world.js 의 STYLES 순서와 같아야 합니다.
export const STYLE_INDEX = { stone: 0, brick: 1, glass: 2, concrete: 3, tan: 4, metal: 5, modern: 6 };

// [정규식, 스타일, 기본 층수 범위]
const RULES = [
  [/도서관|library/i, 'stone', [5, 6]],
  [/본부|본관|행정|headquarter|administration/i, 'stone', [5, 6]],
  [/박물관|문화회관|회관|강당|hall|auditorium/i, 'stone', [3, 4]],
  [/생활관|기숙사|사택|아파트|dormitory|dorm|apartment/i, 'brick', [5, 9]],
  [/체육관|경기장|실내|gym|stadium|arena/i, 'metal', [1, 1]],
  [/공과|공학|engineer/i, 'concrete', [5, 7]],
  [/연구|실험|실습|research|lab/i, 'concrete', [4, 6]],
  [/산학|창업|융합|혁신|국제|IT|정보|컴퓨터|innovation|international|center/i, 'glass', [5, 8]],
  [/의과|약학|병원|medical|pharm|hospital/i, 'modern', [5, 7]],
  [/자연과학|생명|농업|science|bio|agri/i, 'tan', [4, 5]],
  [/인문|사회|경상|사범|법학|humanit|social|business|law|education/i, 'brick', [4, 5]],
  [/예술|음악|교양|art|music/i, 'tan', [3, 5]],
  [/학생회관|식당|카페|복지|student|cafeteria/i, 'modern', [2, 3]],
  [/수위실|경비|관리실|창고|guard|storage|shed/i, 'concrete', [1, 1]],
];

export function classify(name, tags = {}, area = 0, id = 0) {
  const b = tags.building || 'yes';
  const nm = name || '';
  for (const [re, style, lv] of RULES) if (re.test(nm)) return { style, lvRange: lv };
  if (/greenhouse/.test(b)) return { style: 'glass', lvRange: [1, 1] };
  if (/sports|stadium|hangar|warehouse|industrial|roof|shed|garage|barn/.test(b)) return { style: 'metal', lvRange: [1, 1] };
  if (/dormitory|residential|apartments|^house$|detached/.test(b)) return { style: 'brick', lvRange: [5, 9] };
  if (/university|college|school|office|commercial|public/.test(b)) {
    const k = hashInt((id | 0) + 11) % 10;
    return { style: ['stone', 'concrete', 'tan', 'tan', 'concrete', 'glass', 'stone', 'modern', 'tan', 'concrete'][k], lvRange: area > 1200 ? [4, 6] : [3, 5] };
  }
  const k = hashInt((id | 0) + 5) % 6;
  return { style: ['stone', 'concrete', 'tan', 'brick', 'concrete', 'tan'][k], lvRange: area > 1200 ? [4, 6] : area > 300 ? [3, 4] : [1, 2] };
}

export function shortName(nm) {
  return (nm || '').replace(SCHOOL_PREFIX, '').replace(/^\S+대학교\s+(?=\S)/, '')
    .replace(/\s*\([A-Z]\d+(?:-\d+)?\)\s*/g, ' ').replace(/^[A-Z]\d+(?:-\d+)?\s+/, '').replace(/^충남대\s+/, '').replace(/\s+/g, ' ').trim();
}

function finishBuilding(id, nm, tags, pts, extra = {}) {
  const area = polyArea(pts);
  const aa = Math.abs(area);
  if (area < 0) pts.reverse();
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cz));
  const { style, lvRange } = classify(nm, tags, aa, id);
  let lv = parseFloat(tags['building:levels']);
  let h = parseFloat(tags.height);
  if (!(lv > 0) && h > 0) lv = Math.max(1, Math.round(h / 3.6));
  if (!(lv > 0)) {
    const k = hashInt(id | 0) % 1000 / 1000;
    lv = Math.round(lvRange[0] + (lvRange[1] - lvRange[0]) * k);
    if (aa > 2500 && lv < 3 && style !== 'metal') lv += 1;
  }
  if (!(h > 0)) h = /greenhouse|shed|barn/.test(tags.building || '') ? 4.2 : style === 'metal' ? Math.max(9, Math.min(16, Math.sqrt(aa) * 0.35)) : lv * 3.6 + 1.2;
  h = Math.max(4, Math.min(h, 90));
  const fh = style === 'metal' ? h : Math.max(2.8, Math.min(4.6, (h - 1.2) / lv));
  return {
    id, name: nm, short: shortName(nm), pts, cx, cz, r, area: aa, h, lv, fh,
    style, styleIdx: STYLE_INDEX[style] ?? 0,
    seed: (hashInt((id | 0) ^ 0x9e3779b9) % 1000) / 37,
    ...extra,
  };
}

function closeRing(pts) {
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
}

// relation 의 outer 멤버들을 닫힌 고리로 이어 붙임
function stitch(ways) {
  const segs = ways.filter((w) => w.length > 1).map((w) => w.slice());
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  while (segs.length) {
    let cur = segs.shift();
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 500) {
      let found = false;
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k];
        if (same(s[0], cur[cur.length - 1])) { cur = cur.concat(s.slice(1)); segs.splice(k, 1); found = true; break; }
        if (same(s[s.length - 1], cur[cur.length - 1])) { cur = cur.concat(s.slice().reverse().slice(1)); segs.splice(k, 1); found = true; break; }
      }
      if (!found) break;
    }
    if (cur.length >= 4) rings.push(closeRing(cur));
  }
  return rings;
}

const LAND_OF = (tags) => {
  const l = tags.leisure, u = tags.landuse, n = tags.natural;
  if (n === 'water' || u === 'reservoir' || u === 'basin') return 'water';
  if (n === 'wood' || u === 'forest') return 'wood';
  if (n === 'scrub' || u === 'scrub') return 'scrub';
  if (l === 'pitch' || l === 'track' || l === 'stadium') return 'pitch';
  if (l === 'playground') return 'pitch';
  if (tags.amenity === 'parking') return 'parking';
  if (l === 'park' || l === 'garden' || u === 'grass' || u === 'meadow' || n === 'grassland' || u === 'village_green' || u === 'recreation_ground') return 'grass';
  return null;
};

// Overpass JSON -> { buildings, roads, lands, campus, trees }
export function parseOSM(json) {
  const buildings = [];
  const roads = [];
  const lands = [];
  const campus = [];
  const trees = [];
  const gates = [];
  const monuments = [];
  const els = (json && json.elements) || [];
  const GATE_RE = /(정문|서문|후문|북문|남문|동문|쪽문)/;
  for (const el of els) {
    const tags = el.tags || {};
    const nm0 = tags['name:ko'] || tags.name || '';
    if (el.type === 'node') {
      if (typeof el.lat !== 'number') continue;
      const [x, z] = project(el.lat, el.lon);
      if (tags.natural === 'tree') trees.push([x, z, 0.8 + (hashInt(el.id | 0) % 100) / 250]);
      else if (GATE_RE.test(nm0)) gates.push({ name: nm0.match(GATE_RE)[1], x, z, src: 'node' });
      else if (/백마상/.test(nm0)) monuments.push({ kind: 'horse', name: nm0, x, z });
      else if (/영탑지|연못|호수|\S+지$/.test(nm0) && (tags.natural === 'water' || tags.water || /영탑지/.test(nm0))) monuments.push({ kind: 'pond', name: nm0, x, z, r: 25 });
      else if (/막동|조각공원/.test(nm0)) monuments.push({ kind: 'park', name: nm0, x, z, r: 25 });
      continue;
    }
    if (el.type === 'relation') {
      if (tags.amenity === 'university' && el.members) {
        const outs = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => project(g.lat, g.lon)));
        for (const ring of stitch(outs)) campus.push(ring);
      }
      continue;
    }
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const pts = el.geometry.map((g) => project(g.lat, g.lon));
    if (tags.building) {
      if (pts.length < 4) continue;
      closeRing(pts);
      if (pts.length < 3) continue;
      const aa = Math.abs(polyArea(pts));
      if (aa < 40) continue; // 너무 작은 건물(창고, 정자 등) 제외
      let cx = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cz += p[1]; }
      cx /= pts.length; cz /= pts.length;
      if (Math.hypot(cx, cz) > MAX_RADIUS) continue;
      const nm = NAME_BLOCK.test(nm0) ? '' : nm0;
      if (GATE_RE.test(nm) && aa < 400) { gates.push({ name: nm.match(GATE_RE)[1], x: cx, z: cz, src: 'building' }); continue; }
      if (/백마상/.test(nm)) { monuments.push({ kind: 'horse', name: '백마상', x: cx, z: cz, src: 'building' }); continue; }
      buildings.push(finishBuilding(el.id, nm, tags, pts));
    } else if (tags.highway) {
      const w = ROAD_WIDTH[tags.highway] || 4;
      roads.push({ pts, w, k: tags.highway, name: tags.name || '' });
    } else if (GATE_RE.test(nm0) && !tags.building) {
      let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; }
      gates.push({ name: nm0.match(GATE_RE)[1], x: cx / pts.length, z: cz / pts.length, src: 'way' });
    } else if (tags.amenity === 'university') {
      if (pts.length >= 4) campus.push(closeRing(pts));
    } else {
      const kind = LAND_OF(tags);
      if (kind && pts.length >= 4) {
        closeRing(pts);
        if (Math.abs(polyArea(pts)) > 30) lands.push({ kind, pts, name: nm0 });
      }
    }
  }
  // 이름이 있는 연못·공원(영탑지 등)은 지점 랜드마크로
  for (const l of lands) {
    if (!l.name || !(l.kind === 'water' || l.kind === 'grass' || l.kind === 'wood')) continue;
    let cx = 0, cz = 0; for (const p of l.pts) { cx += p[0]; cz += p[1]; }
    if (l.kind !== 'water' && !/막동|조각|광장/.test(l.name)) continue;
    monuments.push({ kind: l.kind === 'water' ? 'pond' : 'park', name: l.name, x: cx / l.pts.length, z: cz / l.pts.length, r: Math.sqrt(Math.abs(polyArea(l.pts)) / Math.PI) });
  }
  // 같은 이름의 교문이 여러 개면(노드+건물 등) 하나로
  const seen = new Map();
  for (const g of gates) {
    if (!seen.has(g.name) || (seen.get(g.name).src !== 'node' && g.src === 'node')) seen.set(g.name, g);
  }
  return { buildings, roads, lands, campus, trees, gates: [...seen.values()], monuments };
}

// 캠퍼스 경계가 있으면 그 안(또는 가까운) 건물만 남깁니다 (주변 아파트 등 제외)
export function clipToCampus(data, margin = 25) {
  if (!data.campus.length) return data;
  // 다른 캠퍼스(보운캠퍼스 등) 경계는 제외: 건물 중앙값에서 1500m 밖의 링
  if (data.buildings.length) {
    const xs = data.buildings.map((b) => b.cx).sort((a, b) => a - b), zs = data.buildings.map((b) => b.cz).sort((a, b) => a - b);
    const mx = xs[xs.length >> 1], mz = zs[zs.length >> 1];
    data.campus = data.campus.filter((ring) => { let cx = 0, cz = 0; for (const p of ring) { cx += p[0]; cz += p[1]; } return Math.hypot(cx / ring.length - mx, cz / ring.length - mz) < 1500; });
    if (!data.campus.length) return data;
  }
  const inside = (x, z) => data.campus.some((ring) => pointInRing(x, z, ring));
  const near = (x, z) => data.campus.some((ring) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (segDist(x, z, a[0], a[1], b[0], b[1]) < margin) return true;
    }
    return false;
  });
  const keep = data.buildings.filter((b) => inside(b.cx, b.cz) || near(b.cx, b.cz));
  if (keep.length >= 10) {
    for (const b of data.buildings) b.campus = inside(b.cx, b.cz) || near(b.cx, b.cz);
    data.buildings = keep;
  } else {
    for (const b of data.buildings) b.campus = true;
  }
  return data;
}

// 캠퍼스 중심을 원점으로 이동
export function recenter(data) {
  const bs = data.buildings;
  if (!bs.length) return data;
  const xs = bs.map((b) => b.cx).sort((a, b) => a - b);
  const zs = bs.map((b) => b.cz).sort((a, b) => a - b);
  const mx = xs[xs.length >> 1], mz = zs[zs.length >> 1];
  const sh = (p) => { p[0] -= mx; p[1] -= mz; };
  for (const b of bs) { b.pts.forEach(sh); b.cx -= mx; b.cz -= mz; }
  for (const r of data.roads) r.pts.forEach(sh);
  for (const l of data.lands || []) l.pts.forEach(sh);
  for (const c of data.campus || []) c.forEach(sh);
  for (const t of data.trees || []) sh(t);
  for (const g of data.gates || []) { g.x -= mx; g.z -= mz; }
  for (const m of data.monuments || []) { m.x -= mx; m.z -= mz; }
  data.shift = [mx, mz];
  data.radius = Math.max(250, ...bs.map((b) => Math.hypot(b.cx, b.cz) + b.r));
  return data;
}

// 나무 심기: 숲·공원·잔디에 촘촘히, 캠퍼스 빈 땅에 드문드문 (건물·도로 피함)
export function plantTrees(data, max = 2600) {
  const R = mulberry(20240601);
  const out = (data.trees || []).slice();
  const bs = data.buildings;
  const roads = data.roads;
  const radius = data.radius || 600;
  // 간단한 격자 색인으로 "건물 안인가" 검사 속도 확보
  const cell = 60, grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (const b of bs) {
    const k0 = Math.floor((b.cx - b.r) / cell), k1 = Math.floor((b.cx + b.r) / cell);
    const j0 = Math.floor((b.cz - b.r) / cell), j1 = Math.floor((b.cz + b.r) / cell);
    for (let i = k0; i <= k1; i++) for (let j = j0; j <= j1; j++) {
      const k = `${i},${j}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
    }
  }
  const rgrid = new Map();
  for (const r of roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const seg = { a, b, w: r.w / 2 + 2.5 };
      const minx = Math.min(a[0], b[0]) - 8, maxx = Math.max(a[0], b[0]) + 8;
      const minz = Math.min(a[1], b[1]) - 8, maxz = Math.max(a[1], b[1]) + 8;
      for (let x = Math.floor(minx / cell); x <= Math.floor(maxx / cell); x++)
        for (let z = Math.floor(minz / cell); z <= Math.floor(maxz / cell); z++) {
          const k = `${x},${z}`;
          if (!rgrid.has(k)) rgrid.set(k, []);
          rgrid.get(k).push(seg);
        }
    }
  }
  const blocked = (x, z) => {
    const k = key(x, z);
    for (const b of grid.get(k) || []) {
      if (Math.hypot(b.cx - x, b.cz - z) < b.r + 3 && pointInRing(x, z, b.pts)) return true;
      if (Math.hypot(b.cx - x, b.cz - z) < b.r + 3) {
        for (let i = 0; i < b.pts.length; i++) {
          const a = b.pts[i], c = b.pts[(i + 1) % b.pts.length];
          if (segDist(x, z, a[0], a[1], c[0], c[1]) < 3) return true;
        }
      }
    }
    for (const s of rgrid.get(k) || []) if (segDist(x, z, s.a[0], s.a[1], s.b[0], s.b[1]) < s.w) return true;
    return false;
  };
  const inCampus = (x, z) => !data.campus.length || data.campus.some((ring) => pointInRing(x, z, ring));
  const inWater = (x, z) => (data.lands || []).some((l) => (l.kind === 'water' || l.kind === 'pitch' || l.kind === 'parking') && pointInRing(x, z, l.pts));

  // 1) 녹지 안
  for (const l of data.lands || []) {
    if (!(l.kind === 'wood' || l.kind === 'grass' || l.kind === 'scrub')) continue;
    const A = Math.abs(polyArea(l.pts));
    const density = l.kind === 'wood' ? 1 / 55 : l.kind === 'scrub' ? 1 / 140 : 1 / 320;
    const n = Math.min(600, Math.floor(A * density));
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of l.pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const x = minx + R() * (maxx - minx), z = minz + R() * (maxz - minz);
      if (!pointInRing(x, z, l.pts) || blocked(x, z) || inWater(x, z)) continue;
      out.push([x, z, l.kind === 'wood' ? 0.9 + R() * 0.6 : 0.8 + R() * 0.5]);
      i++;
    }
    if (out.length > max) break;
  }
  // 2) 캠퍼스 빈 땅에 드문드문
  const want = Math.min(max - out.length, Math.floor((radius * radius) / 2600));
  for (let i = 0, tries = 0; i < want && tries < want * 8; tries++) {
    const a = R() * 6.283, rr = Math.sqrt(R()) * radius * 1.05;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (!inCampus(x, z) || inWater(x, z) || blocked(x, z)) continue;
    out.push([x, z, 0.75 + R() * 0.6]);
    i++;
  }
  data.trees = out.slice(0, max);
  return data;
}

// 정문 데이터가 없으면: 캠퍼스 중심에서 동쪽(충남대 정문은 대학로 쪽) 경계와 만나는 지점에 두고, 가까운 도로 위로 붙입니다.
// 수동 보정표: OSM에 없는 이름·지점을 위도/경도로 직접 지정 (실제 데이터 확인 후 채웁니다)
// { lat, lon, name, kind: 'building'(가장 가까운 건물에 이름 부여) | 'pond' | 'horse' | 'gate' }
export const MANUAL = [];
export function applyManual(data) {
  const [mx, mz] = data.shift || [0, 0];
  for (const m of MANUAL) {
    const [x0, z0] = project(m.lat, m.lon);
    const x = x0 - mx, z = z0 - mz;
    if (m.kind === 'building') {
      let best = null, bd = 60;
      for (const b of data.buildings) { const d = Math.hypot(b.cx - x, b.cz - z); if (d < bd) { bd = d; best = b; } }
      if (best) { best.name = m.name; best.short = shortName(m.name); }
    } else if (m.kind === 'gate') {
      data.gates = (data.gates || []).filter((g) => g.name !== m.name);
      data.gates.push({ name: m.name, x, z, src: 'manual' });
    } else {
      data.monuments = (data.monuments || []).filter((o) => o.name !== m.name);
      data.monuments.push({ kind: m.kind, name: m.name, x, z, r: m.r || 25, src: 'manual' });
    }
  }
  return data;
}

const ROAD_RANK = { motorway: 7, trunk: 7, primary: 6, primary_link: 5, secondary: 5, secondary_link: 4, tertiary: 3, tertiary_link: 3, unclassified: 2, residential: 2, living_street: 1, service: 1 };
export function ensureGates(data) {
  applyManual(data);
  data.gates = data.gates || [];
  data.monuments = data.monuments || [];
  if (!data.gates.some((g) => g.name === '정문')) {
    // 캠퍼스 경계를 가로지르는 차도 중 등급이 가장 높은 곳 = 정문 (충남대: 남쪽 대학로 쪽)
    const ring = (data.campus || []).reduce((a, b) => (a && a.length > b.length ? a : b), null);
    let gx = null, gz = null, src = 'guess';
    if (ring) {
      const cross = [];
      for (const r of data.roads) {
        const rank = ROAD_RANK[r.k]; if (!rank) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          if (pointInRing(a[0], a[1], ring) !== pointInRing(b[0], b[1], ring)) cross.push({ rank, x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2 });
        }
      }
      if (cross.length) {
        // 60m 안에 모인 교차점을 묶어 등급 합이 가장 큰 무리를 고름
        let best = null;
        for (const c of cross) {
          const grp = cross.filter((o) => Math.hypot(o.x - c.x, o.z - c.z) < 60);
          const score = grp.reduce((s, o) => s + o.rank, 0) + Math.max(...grp.map((o) => o.rank)) * 3;
          if (!best || score > best.score) best = { score, grp };
        }
        gx = best.grp.reduce((s, o) => s + o.x, 0) / best.grp.length;
        gz = best.grp.reduce((s, o) => s + o.z, 0) / best.grp.length;
        src = 'road';
      }
    }
    if (gx === null) {
      const dir = [1, 0.25]; const L = Math.hypot(dir[0], dir[1]); dir[0] /= L; dir[1] /= L;
      gx = dir[0] * data.radius * 0.95; gz = dir[1] * data.radius * 0.95;
    }
    // 경계에서 캠퍼스 안쪽으로 18m
    const dd = Math.hypot(gx, gz) || 1;
    data.gates.push({ name: '정문', x: gx - (gx / dd) * 18, z: gz - (gz / dd) * 18, src });
  }
  // 교문 방향: 가장 가까운 차도의 진행 방향에 맞춤 (보가 길을 가로지르게)
  for (const g of data.gates) {
    // 45m 안의 차도 중 등급이 가장 높은(같으면 가까운) 구간을 골라, 그 위로 옮기고 방향을 맞춤
    let best = null;
    for (const r of data.roads) {
      const rank = ROAD_RANK[r.k]; if (!rank) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const dd = segDist(g.x, g.z, a[0], a[1], b[0], b[1]);
        if (dd > 45) continue;
        if (!best || rank > best.rank || (rank === best.rank && dd < best.dd)) best = { rank, dd, a, b };
      }
    }
    if (best) {
      const { a, b } = best;
      const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((g.x - a[0]) * dx + (g.z - a[1]) * dz) / L2));
      if (g.src !== 'node' && g.src !== 'manual') { g.x = a[0] + dx * t; g.z = a[1] + dz * t; }
      g.ang = Math.atan2(dx, dz);
      g.span = best.rank >= 5 ? 26 : best.rank >= 3 ? 20 : 14; // 큰길이면 넓게
    }
  }
  if (!data.monuments.some((m) => m.kind === 'horse')) {
    const g = data.gates.find((x) => x.name === '정문');
    const d = Math.hypot(g.x, g.z) || 1;
    const ix = -g.x / d, iz = -g.z / d; // 안쪽 방향
    const px = -iz, pz = ix;             // 옆 방향
    data.monuments.push({ kind: 'horse', name: '백마상', x: g.x + ix * 55 + px * 16, z: g.z + iz * 55 + pz * 16, src: 'guess' });
  }
  return data;
}

function sourceStats(data) {
  const named = data.buildings.filter((b) => b.name).length;
  return `건물 ${data.buildings.length}동(이름 ${named}) · 도로 ${data.roads.length}개`;
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

const CACHE_KEY = 'cnu-smash-campus-v2';

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

export function finalize(json, source) {
  const d = ensureGates(recenter(clipToCampus(parseOSM(json))));
  d.source = source;
  d.stats = sourceStats(d);
  return d;
}

// 1) ./campus.json (미리 저장한 데이터) 2) 브라우저 캐시 3) Overpass 서버 순서로 시도
export async function loadRealCampus(onStatus = () => {}) {
  const say = (m) => { try { onStatus(m); } catch (e) { /* noop */ } };

  say('저장된 캠퍼스 데이터 확인 중…');
  try {
    const r = await fetch('./campus.json', { cache: 'no-cache' });
    if (r.ok) {
      const d = finalize(await r.json(), 'file');
      if (d.buildings.length >= 15) return d;
    }
  } catch (e) { /* 파일이 없으면 다음 단계 */ }

  const cached = readCache();
  if (cached) {
    const d = finalize(cached, 'cache');
    if (d.buildings.length >= 15) return d;
  }

  const queries = [Q_AREA, Q_AROUND];
  for (const q of queries) {
    for (let i = 0; i < MIRRORS.length; i++) {
      say(`지도 서버에서 캠퍼스 불러오는 중… (${i + 1}/${MIRRORS.length})`);
      try {
        const json = await postOverpass(MIRRORS[i], q, 28000);
        const d = finalize(json, 'osm');
        if (d.buildings.length >= 15) { writeCache(json); return d; }
        break; // 응답은 왔지만 건물이 부족 → 다음 쿼리
      } catch (e) { /* 다음 미러 */ }
    }
  }
  throw new Error('지도 서버에 연결하지 못했어요');
}

// ───────── 내장 근사 캠퍼스 (지도를 못 불러왔을 때) ─────────
// [이름, 중심x, 중심z, 가로, 세로, 층수, 회전(도), 모양('L'이면 ㄱ자)]
const FALLBACK = [
  ['정심화국제문화회관', 0, -70, 70, 46, 4, 0, 'L'],
  ['중앙도서관', -120, -100, 84, 46, 6, 0],
  ['대학본부', 130, -130, 58, 36, 6, 0],
  ['제1학생회관', 0, -210, 54, 40, 3, 0],
  ['인문대학', -270, -160, 92, 40, 5, 0, 'L'],
  ['사회과학대학', -270, -50, 84, 40, 5, 0],
  ['경상대학', -270, 60, 72, 40, 5, 0, 'L'],
  ['자연과학대학', 270, -160, 84, 46, 5, 0, 'L'],
  ['생명시스템과학대학', 270, -60, 62, 40, 4, 0],
  ['농업생명과학대학', 400, 50, 104, 46, 4, 0, 'L'],
  ['공과대학 1호관', -70, 150, 72, 36, 5, 0],
  ['공과대학 2호관', -200, 170, 70, 36, 6, 0],
  ['공과대학 3호관', 60, 170, 72, 36, 9, 0],
  ['공과대학 4호관', 190, 170, 70, 36, 8, 0],
  ['공과대학 5호관', 320, 190, 66, 36, 7, 0],
  ['약학대학', -410, -110, 54, 36, 5, 0],
  ['사범대학', -400, 20, 64, 36, 4, 0, 'L'],
  ['생활과학대학', -390, 130, 54, 36, 4, 0],
  ['예술대학', -130, 320, 64, 42, 4, 0, 'L'],
  ['음악관', -30, 330, 46, 34, 3, 0],
  ['체육관', 190, -270, 92, 62, 1, 0],
  ['박물관', 60, -320, 48, 32, 3, 0],
  ['학생생활관 1동', 500, -200, 52, 20, 10, 0],
  ['학생생활관 2동', 500, -140, 52, 20, 10, 0],
  ['학생생활관 3동', 500, -80, 52, 20, 11, 0],
  ['학생생활관 4동', 440, -250, 20, 52, 10, 0],
  ['산학협력관', 150, 40, 58, 34, 7, 0],
  ['연구실험동', 360, -240, 56, 34, 5, 0],
  ['보건대학', -90, 250, 50, 30, 5, 0],
  ['동아리방', 100, -20, 40, 20, 2, 15],
  ['카페테리아', -30, -150, 36, 24, 2, 0],
  ['학군단', 220, 90, 40, 24, 2, -10],
  ['공동실험실습관', 440, 150, 56, 32, 6, 0],
  ['창업지원센터', -190, 40, 46, 28, 5, 0],
  ['평생교육원', -190, -230, 50, 30, 4, 0],
  ['연구동 A', 140, 270, 48, 30, 6, 0],
  ['연구동 B', 240, 280, 48, 30, 7, 0],
  ['강당', -300, 250, 60, 44, 3, 0],
  ['소극장', 330, -40, 34, 26, 2, 0],
];

export function buildFallbackCampus() {
  const buildings = [];
  FALLBACK.forEach((f, i) => {
    const [name, cx, cz, w, d, lv, rot, shape] = f;
    const a = (rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    let corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    if (shape === 'L') {
      // ㄱ자: 오른쪽 아래를 파냄
      corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, 0], [0, 0], [0, d / 2], [-w / 2, d / 2]];
    }
    const pts = corners.map(([x, z]) => [cx + x * ca - z * sa, cz + x * sa + z * ca]);
    const tags = { building: 'university', 'building:levels': String(lv) };
    buildings.push(finishBuilding(900000 + i, name, tags, pts, { campus: true }));
  });
  const roads = [];
  const line = (x1, z1, x2, z2, k) => roads.push({ pts: [[x1, z1], [x2, z2]], w: ROAD_WIDTH[k], k, name: '' });
  line(0, 460, 0, -380, 'secondary');       // 중앙 대로
  line(-520, 100, 540, 100, 'tertiary');   // 가로 대로
  line(-520, -30, 540, -30, 'residential');
  line(-520, -180, 540, -180, 'residential');
  line(-520, 290, 400, 290, 'residential');
  line(-350, -300, -350, 330, 'residential');
  line(350, -300, 350, 330, 'residential');
  line(200, -380, 200, 330, 'service');
  line(-190, -380, -190, 330, 'service');
  for (let i = -4; i <= 4; i++) line(-520, i * 60 + 10, 540, i * 60 + 10, 'footway');
  const lands = [
    { kind: 'pitch', pts: [[-480, -330], [-240, -330], [-240, -210], [-480, -210]] },
    { kind: 'grass', pts: [[-110, -40], [110, -40], [110, 80], [-110, 80]] },
    { kind: 'water', pts: [[-60, 20], [60, 20], [70, 60], [-50, 60]] },
    { kind: 'wood', pts: [[280, 230], [560, 230], [600, 360], [250, 380]] },
    { kind: 'wood', pts: [[-600, -340], [-450, -360], [-470, -220], [-560, -200]] },
    { kind: 'parking', pts: [[380, -330], [500, -330], [500, -290], [380, -290]] },
  ];
  const campus = [[[-620, -400], [620, -400], [640, 470], [-600, 480]]];
  const gates = [
    { name: '정문', x: 0, z: 452, src: 'fallback' },
    { name: '서문', x: -612, z: 100, src: 'fallback' },
    { name: '후문', x: 200, z: -392, src: 'fallback' },
  ];
  const monuments = [
    { kind: 'horse', name: '백마상', x: 16, z: 385, src: 'fallback' },
    { kind: 'pond', name: '영탑지', x: 5, z: 40, r: 30, src: 'fallback' },
    { kind: 'park', name: '막동 조각공원', x: -470, z: 300, r: 26, src: 'fallback' },
  ];
  const data = { buildings, roads, lands, campus, trees: [], gates, monuments, source: 'fallback', stats: `내장 근사 캠퍼스 · 건물 ${buildings.length}동` };
  data.radius = 640;
  return data;
}
