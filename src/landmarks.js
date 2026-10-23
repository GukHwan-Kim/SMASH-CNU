// 랜드마크: 충남대임을 한눈에 알 수 있게 하는 요소들
//  - 교문(정문·서문·후문) 3D 모델 + 학교명 간판
//  - 상징물 백마상
//  - 랜드마크 건물: 옥상 간판 · 금색 라벨 · 바닥 하이라이트 링 · 파괴 보너스
import * as THREE from 'three';
import { hashStr } from './geo.js';

export const SCHOOL = { ko: '충남대학교', en: 'CHUNGNAM NATIONAL UNIVERSITY', short: '충남대' };

// [이름 패턴, 아이콘, 표시 이름(없으면 OSM 이름), 한 줄 설명, 우선순위]
// 패턴은 OSM 건물 이름(접두 "충남대학교 " 제거 후)에 대해 검사합니다. 먼저 맞는 규칙 하나만 적용.
export const LANDMARKS = [
  [/정심화/, '🎭', '정심화국제문화회관', '입학식·졸업식·공연이 열리는 충남대의 대표 행사장', 100],
  [/중앙도서관/, '📚', '중앙도서관', '시험기간 자리 전쟁의 성지', 98],
  [/대학본부|^본부$|^본관$/, '🏛️', '대학본부', '학교 행정의 중심', 95],
  [/백마상|백마\s*동상/, '🐎', '백마상', '충남대의 상징, 백마', 94],
  [/제?1\s*학생회관|^학생회관/, '🍱', '제1학생회관', '학식·동아리·휴게의 중심', 90],
  [/제?2\s*학생회관/, '🥤', '제2학생회관', '학생 활동 공간', 80],
  [/한누리/, '🏨', '한누리회관', '행사·숙박·식당이 있는 복합 회관', 82],
  [/백마교양|교양교육관/, '📝', '백마교양교육관', '교양 수업이 몰리는 곳', 78],
  [/산학연|산학협력/, '🔬', '산학연교육연구관', '산학협력·연구의 거점', 76],
  [/국제교류|국제언어|언어교육원/, '🌏', '국제교류관', '교환학생·어학 프로그램', 70],
  [/박물관/, '🏺', '박물관', '대학 박물관', 72],
  [/체육관|실내체육/, '🏀', null, '체육대회·시험 대신 농구', 74],
  [/운동장|대운동장|경기장/, '🏃', null, '대운동장', 60],
  [/농업생명과학대학|농생대|농대/, '🌾', null, '농업생명과학대학', 66],
  [/자연과학대학|자연대/, '🧪', null, '자연과학대학', 66],
  [/인문대학|인문대/, '📖', null, '인문대학', 66],
  [/사회과학대학|사회대/, '⚖️', null, '사회과학대학', 66],
  [/경상대학|경상대|경영/, '📈', null, '경상대학', 66],
  [/사범대학|사범대/, '🎓', null, '사범대학', 64],
  [/예술대학|예술대|음악관/, '🎨', null, '예술대학', 64],
  [/약학대학|약대/, '💊', null, '약학대학', 62],
  [/수의과대학|수의대|동물병원/, '🐾', null, '수의과대학', 62],
  [/생활과학대학|생활대/, '🏡', null, '생활과학대학', 60],
  [/생명시스템|생명과학/, '🧬', null, '생명시스템과학대학', 60],
  [/공과대학\s*1호관|공대\s*1호관/, '⚙️', null, '공과대학의 시작, 1호관', 68],
  [/공과대학|공대/, '⚙️', null, '공과대학', 50],
  [/학생생활관|기숙사|생활관/, '🛏️', null, '학생생활관(기숙사)', 55],
  [/법학|로스쿨/, '📜', null, '법학전문대학원', 58],
  [/의과대학|의대|병원/, '🏥', null, '의과대학', 58],
];

// 건물 목록에 랜드마크 표시 (같은 규칙에 여러 건물이 걸리면 면적 큰 순으로 최대 n개)
export function tagLandmarks(buildings) {
  const groups = new Map();
  for (const b of buildings) {
    const nm = b.short || b.name || '';
    if (!nm) continue;
    for (let i = 0; i < LANDMARKS.length; i++) {
      if (LANDMARKS[i][0].test(nm)) {
        if (!groups.has(i)) groups.set(i, []);
        groups.get(i).push(b);
        break;
      }
    }
  }
  const out = [];
  for (const [i, list] of groups) {
    const [, icon, disp, desc, pri] = LANDMARKS[i];
    list.sort((a, b) => b.area * b.h - a.area * a.h);
    const cap = pri >= 70 ? 1 : pri >= 60 ? 2 : 3;
    list.slice(0, cap).forEach((b, k) => {
      b.landmark = { icon, title: disp || b.short, desc, pri: pri - k, rule: i };
      out.push(b);
    });
  }
  out.sort((a, b) => b.landmark.pri - a.landmark.pri);
  return out;
}

// ───────── 글자 텍스처 ─────────
export function textTexture(lines, { w = 1024, h = 256, bg = '#15213a', fg = '#ffffff', font = 'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif', pad = 0.1, border = '#d8b85a' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = h * 0.05; g.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08); }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = (typeof ln === 'string' ? h * (n === 1 ? 0.55 : i === 0 ? 0.42 : 0.2) : ln.size * h);
    const txt = typeof ln === 'string' ? ln : ln.text;
    g.font = `${i === 0 ? '900' : '600'} ${size}px ${font}`;
    const y = n === 1 ? h / 2 : i === 0 ? h * 0.4 : h * 0.76;
    // 폭에 맞춰 축소
    const mw = w * (1 - pad * 2);
    const tw = g.measureText(txt).width;
    if (tw > mw) g.font = `${i === 0 ? '900' : '600'} ${Math.floor(size * mw / tw)}px ${font}`;
    g.fillText(txt, w / 2, y);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ───────── 교문 ─────────
// 두 기둥 + 가로보 + 학교명 간판. span = 기둥 사이 거리(m). name = 정문/서문/후문
export function makeGate(name = '정문', span = 16) {
  const grp = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd9d3c6 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3b4149 });
  const pH = 7.5, pW = 1.8;
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(pW, pH, pW), stone);
    pillar.position.set(sx * span / 2, pH / 2, 0);
    const base = new THREE.Mesh(new THREE.BoxGeometry(pW * 1.4, 0.6, pW * 1.4), dark);
    base.position.set(sx * span / 2, 0.3, 0);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(pW * 1.25, 0.35, pW * 1.25), dark);
    cap.position.set(sx * span / 2, pH + 0.17, 0);
    grp.add(pillar, base, cap);
  }
  // 가로보 (살짝 위로 띄워 통과 가능하게)
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span + pW, 1.1, 1.2), dark);
  beam.position.set(0, pH + 0.6, 0);
  grp.add(beam);
  // 간판: 양면
  const isMain = /정문/.test(name);
  const tex = textTexture(isMain ? [SCHOOL.ko, SCHOOL.en] : [`${SCHOOL.ko} ${name}`], { w: 1024, h: isMain ? 256 : 200 });
  const sw = span * 0.78, sh = isMain ? sw / 4 : sw / 5.1;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  sign.position.set(0, pH + 0.6 + 0.4 + sh / 2, 0);
  grp.add(sign);
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.4, sh + 0.4, 0.3), dark);
  signBack.position.copy(sign.position); signBack.position.z = 0; // 간판 뒤판
  sign.position.z = 0.17;
  const sign2 = sign.clone(); sign2.position.z = -0.17; sign2.rotation.y = Math.PI;
  grp.add(signBack, sign2);
  // 경비실(작은 박스)
  const booth = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3, 2.6), new THREE.MeshLambertMaterial({ color: 0xe8e4da }));
  booth.position.set(span / 2 + 3.4, 1.5, 0.4);
  const boothRoof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.3, 3.2), dark);
  boothRoof.position.set(span / 2 + 3.4, 3.1, 0.4);
  grp.add(booth, boothRoof);
  // 깃대 (정문)
  if (isMain) {
    for (const sx of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 11, 6), new THREE.MeshLambertMaterial({ color: 0xcfd3d8 }));
      pole.position.set(sx * (span / 2 + 7), 5.5, -2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), new THREE.MeshBasicMaterial({ color: sx < 0 ? 0x1f3f8f : 0xf2f2f2, side: THREE.DoubleSide }));
      flag.position.set(sx * (span / 2 + 7) + 1.3, 10, -2);
      grp.add(pole, flag);
    }
  }
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

// ───────── 백마상 ─────────
// 받침대 위에서 앞발을 든 흰 말 (단순 도형 조합)
export function makeHorseStatue() {
  const grp = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f3ee });
  const stone = new THREE.MeshLambertMaterial({ color: 0x6c6a66 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 3), stone);
  plinth.position.y = 1.6;
  const plinthTop = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.3, 3.4), new THREE.MeshLambertMaterial({ color: 0x8a8782 }));
  plinthTop.position.y = 3.35;
  const steps = new THREE.Mesh(new THREE.BoxGeometry(8, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0x9a968f }));
  steps.position.y = 0.25;
  grp.add(plinth, plinthTop, steps);
  const horse = new THREE.Group();
  horse.position.y = 3.5;
  // 몸통 (뒤가 낮고 앞이 들린 자세)
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 2.2, 4, 10), white);
  body.rotation.z = Math.PI / 2 - 0.55; body.position.set(0.1, 2.3, 0);
  // 목
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.4, 4, 8), white);
  neck.rotation.z = -0.35; neck.position.set(1.35, 3.6, 0);
  // 머리
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.6, 0.55), white);
  head.rotation.z = -0.5; head.position.set(2.0, 4.35, 0);
  const ear1 = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 5), white); ear1.position.set(1.65, 4.75, 0.18);
  const ear2 = ear1.clone(); ear2.position.z = -0.18;
  // 다리: 뒷다리 두 개 서 있고, 앞다리 두 개 들림
  const leg = (x, y, z, rz, len) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, len, 7), white); m.position.set(x, y, z); m.rotation.z = rz; return m; };
  horse.add(leg(-1.0, 0.95, 0.35, 0.12, 1.9), leg(-1.0, 0.95, -0.35, -0.08, 1.9));
  horse.add(leg(1.1, 2.1, 0.35, -1.1, 1.5), leg(1.25, 2.3, -0.35, -1.4, 1.5));
  // 꼬리
  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 1.3, 3, 6), white);
  tail.rotation.z = 0.9; tail.position.set(-1.4, 1.7, 0);
  // 갈기
  const mane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.25, 0.22), white);
  mane.rotation.z = -0.35; mane.position.set(1.2, 4.05, 0);
  horse.add(body, neck, head, ear1, ear2, tail, mane);
  grp.add(horse);
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}

// ───────── 옥상 간판 ─────────
// 가장 긴 벽을 따라 서 있는 양면 간판. 반환: { mesh, update(h) }
export function makeRoofSign(b) {
  const pts = b.pts;
  let bestL = 0, ax = 0, az = 0, bx = 0, bz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L > bestL) { bestL = L; ax = p[0]; az = p[1]; bx = q[0]; bz = q[1]; }
  }
  const title = b.landmark.title;
  const w = Math.min(bestL * 0.8, Math.max(10, title.length * 3.2 + 2));
  const h = Math.max(2.8, Math.min(4.2, w / Math.max(3, title.length) * 1.25));
  const tex = textTexture([title], { w: 1024, h: 192, bg: '#1c1f26', fg: '#fff5d6', border: null, pad: 0.06 });
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: false });
  const grp = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  board.position.y = h / 2 + 0.7;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.25), new THREE.MeshLambertMaterial({ color: 0x2a2e36 }));
  frame.position.y = h / 2 + 0.7; frame.position.z = -0.14;
  const board2 = board.clone(); board2.rotation.y = Math.PI; board2.position.z = -0.28;
  for (const sx of [-0.4, 0.4]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), new THREE.MeshLambertMaterial({ color: 0x2a2e36 }));
    leg.position.set(sx * w, 0.4, -0.14); grp.add(leg);
  }
  grp.add(board, board2, frame);
  // 벽 중앙에서 안쪽으로 1.2m
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz) || 1;
  // 안쪽 방향: 중심 쪽
  let nx = -dz / L, nz = dx / L;
  if ((b.cx - mx) * nx + (b.cz - mz) * nz < 0) { nx = -nx; nz = -nz; }
  grp.position.set(mx + nx * 1.4, b.h, mz + nz * 1.4);
  grp.rotation.y = -Math.atan2(dz, dx); // 로컬 x축을 벽 방향에 맞춤 (양면이라 앞뒤 무관)
  grp.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { mesh: grp, update(hh) { grp.position.y = hh; } };
}

// ───────── 바닥 하이라이트 링 ─────────
export function makeHalo(b) {
  const r = b.r + 5;
  const geo = new THREE.RingGeometry(r * 0.93, r, 48).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(b.cx, 0.35, b.cz);
  m.renderOrder = 2;
  return m;
}

// 교문 방향: 캠퍼스 중심을 향하는 벡터에 수직 (보가 길 방향을 가로지름)
export function gateRotation(x, z, cx = 0, cz = 0) {
  return Math.atan2(cx - x, cz - z) ; // group의 로컬 x축이 보 방향, z축이 통과 방향
}

export function landmarkKey(b) { return b.landmark ? `${b.landmark.rule}:${hashStr(b.id)}` : ''; }
