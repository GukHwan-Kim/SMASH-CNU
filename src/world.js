// 3D 지오메트리 · 재질 (건물 외벽 셰이더 · 윤곽선 · 바닥 텍스처 · 나무)
import * as THREE from 'three';
import { FOOT, ROAD_WIDTH, mulberry, polyArea } from './geo.js';

// ───────── 건물 외벽 스타일 (geo.js STYLE_INDEX 순서) ─────────
// wall 외벽 · glass 유리 · roof 지붕 · frame 창틀 · bay 창 간격(m) · winW/winH 창 비율 · sill 창턱 · brick 벽돌 · kind 0 일반 1 커튼월 2 금속패널
export const STYLES = [
  { name: 'stone',    wall: '#d8d1c2', glass: '#2c3843', roof: '#8f8d86', frame: '#ebe8e0', bay: 3.4, winW: 0.52, winH: 0.50, sill: 0.30, brick: 0, kind: 0 },
  { name: 'brick',    wall: '#9a5540', glass: '#28313a', roof: '#6f6d68', frame: '#e8e2d6', bay: 3.0, winW: 0.46, winH: 0.55, sill: 0.28, brick: 1, kind: 0 },
  { name: 'glass',    wall: '#b7bfc6', glass: '#5f85a3', roof: '#858a8e', frame: '#3b4248', bay: 1.6, winW: 0.90, winH: 0.84, sill: 0.08, brick: 0, kind: 1 },
  { name: 'concrete', wall: '#b9b6ad', glass: '#2b353f', roof: '#8c8a84', frame: '#8f9396', bay: 4.0, winW: 0.92, winH: 0.42, sill: 0.36, brick: 0, kind: 0 },
  { name: 'tan',      wall: '#c9b596', glass: '#2e3740', roof: '#857f75', frame: '#efe9db', bay: 3.2, winW: 0.56, winH: 0.50, sill: 0.30, brick: 0, kind: 0 },
  { name: 'metal',    wall: '#aeb4b8', glass: '#3a4a58', roof: '#6d7278', frame: '#55595e', bay: 2.0, winW: 0.80, winH: 0.30, sill: 0.55, brick: 0, kind: 2 },
  { name: 'modern',   wall: '#e9e6df', glass: '#2f4f5a', roof: '#9a9b97', frame: '#3a3f44', bay: 2.4, winW: 0.94, winH: 0.46, sill: 0.34, brick: 0, kind: 0 },
];

const col = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };

function styleGLSL() {
  // 스타일 번호 → 색·치수 (프래그먼트에서 if 체인으로 상수 인덱스만 사용: 모바일 GPU 호환)
  let s = '';
  STYLES.forEach((st, i) => {
    s += `${i ? 'else ' : ''}if (si < ${i}.5) { wall = ${col(st.wall)}; glass = ${col(st.glass)}; roof = ${col(st.roof)}; frame = ${col(st.frame)}; `
      + `p = vec4(${st.bay.toFixed(2)}, ${st.winW.toFixed(2)}, ${st.winH.toFixed(2)}, ${st.sill.toFixed(2)}); brick = ${st.brick.toFixed(1)}; kind = ${st.kind.toFixed(1)}; }\n`;
  });
  return s;
}

const NOISE = /* glsl */`
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.2 * vnoise(p * 4.3 + 9.1); }
float band(float x, float a, float b, float w) { return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
`;

// 건물 하나 = 높이 1짜리 압출 도형. mesh.scale.y 로 실제 높이를 조절합니다 (무너질 때 줄어듦).
// aBld = (스타일 번호, 시드, 층높이, 층수) 를 모든 정점에 같은 값으로 넣어 재질 하나로 모든 건물을 그립니다.
export function makeBuildingGeometry(b) {
  const shape = new THREE.Shape(b.pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // 압출 방향 → +y, 도형 (x, -z) → 월드 (x, z)
  g.clearGroups();
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    arr[i * 4] = b.styleIdx || 0; arr[i * 4 + 1] = b.seed || 0; arr[i * 4 + 2] = b.fh || 3.6; arr[i * 4 + 3] = b.lv || 4;
  }
  g.setAttribute('aBld', new THREE.BufferAttribute(arr, 4));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// 건물 윤곽선 (벽 모서리·지붕 테두리) — 건물 형태가 또렷하게 읽히게 합니다.
export function makeEdgeLines(geo, material) {
  const eg = new THREE.EdgesGeometry(geo, 20);
  const l = new THREE.LineSegments(eg, material);
  l.renderOrder = 1;
  return l;
}
export function makeEdgeMaterial() {
  return new THREE.LineBasicMaterial({ color: 0x1f2630, transparent: true, opacity: 0.32, depthWrite: false });
}

// 외벽 셰이더: 창문·층 구분·창틀·기단·처마·벽돌·유리 커튼월·금속 패널. 밤에는 일부 창에 불이 켜집니다.
export function makeBuildingMaterial(nightUniform) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aBld;\nvarying vec3 vWPos;\nvarying vec3 vWN;\nvarying vec4 vBld;\nvarying float vTop;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWN = normalize(mat3(modelMatrix) * objectNormal);
  vBld = aBld;
  vTop = length(modelMatrix[1].xyz);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
varying vec3 vWPos; varying vec3 vWN; varying vec4 vBld; varying float vTop;
${NOISE}
void styleOf(float si, out vec3 wall, out vec3 glass, out vec3 roof, out vec3 frame, out vec4 p, out float brick, out float kind) {
${styleGLSL()}
  else { wall = vec3(0.8); glass = vec3(0.2, 0.25, 0.3); roof = vec3(0.5); frame = vec3(0.9); p = vec4(3.0, 0.5, 0.5, 0.3); brick = 0.0; kind = 0.0; }
}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 litCol = vec3(1.0, 0.76, 0.42);
  float lit = 0.0;
  {
    vec3 wall, glass, roof, frame; vec4 p; float brick, kind;
    styleOf(vBld.x, wall, glass, roof, frame, p, brick, kind);
    float seed = vBld.y, fh = max(vBld.z, 2.5);
    float bay = p.x, ww = p.y, wh = p.z, sillB = p.w;
    vec3 c3;
    if (vWN.y > 0.5) {
      // ── 지붕: 콘크리트 질감 + 패널 이음새 + 얼룩
      vec2 xz = vWPos.xz;
      vec3 r = roof * (0.80 + 0.30 * fbm(xz * 0.22 + seed));
      vec2 g3 = fract(xz / 3.0); vec2 rw = fwidth(xz / 3.0);
      float seam = clamp((1.0 - smoothstep(0.0, 0.03 + rw.x, g3.x)) + (1.0 - smoothstep(0.0, 0.03 + rw.y, g3.y)), 0.0, 1.0);
      r *= 1.0 - 0.10 * seam * (1.0 - smoothstep(0.2, 0.6, max(rw.x, rw.y)));
      r *= 1.0 - 0.18 * smoothstep(0.55, 0.75, fbm(xz * 0.08 + seed * 2.0));
      // 지붕 위 설비 느낌의 밝은 사각 얼룩
      r = mix(r, roof * 1.18, step(0.965, vnoise(xz * 0.35 + seed * 5.0)) * 0.6);
      c3 = r;
    } else if (vWN.y < -0.5) {
      c3 = wall * 0.4;
    } else {
      // ── 벽: 벽을 따라가는 좌표 (u 가로, v 높이)
      vec2 tg = normalize(vec2(-vWN.z, vWN.x) + vec2(0.0001));
      float u = dot(vWPos.xz, tg) + seed * 7.0;
      float v = vWPos.y;
      vec2 c = vec2(u / bay, v / fh);
      vec2 fw = fwidth(c) * 1.2;
      float far = smoothstep(0.3, 0.9, max(fw.x, fw.y));
      vec2 cell = floor(c), f = fract(c);
      float fwy = fwidth(v);
      float gfl = step(v, fh) * (1.0 - kind); // 1층(로비)은 창이 크게
      float sill = mix(sillB, 0.12, gfl), wh2 = mix(wh, 0.78, gfl);
      if (kind > 1.5) { sill = 0.55; wh2 = 0.28; }
      float above = step(0.45, v) * (1.0 - step(vTop - 0.45, v));
      vec2 fr = vec2(0.09 / bay, 0.09 / fh);
      float wx = band(f.x, 0.5 - ww * 0.5, 0.5 + ww * 0.5, fw.x);
      float wy = band(f.y, sill, sill + wh2, fw.y);
      float fx = band(f.x, 0.5 - ww * 0.5 - fr.x, 0.5 + ww * 0.5 + fr.x, fw.x);
      float fy = band(f.y, sill - fr.y, sill + wh2 + fr.y, fw.y);
      float win = wx * wy * above;
      float frameM = clamp(fx * fy * above - win, 0.0, 1.0);
      float mull = band(f.x, 0.5 - 0.035 / bay, 0.5 + 0.035 / bay, fw.x) * step(1.7, ww * bay);
      float trans = band(f.y, sill + wh2 * 0.72, sill + wh2 * 0.72 + 0.06 / fh, fw.y) * step(1.9, wh2 * fh);
      float bars = clamp(mull + trans, 0.0, 1.0) * win;
      float ledge = band(f.y, sill - fr.y - 0.07 / fh, sill - fr.y, fw.y) * fx * above * (1.0 - kind);
      vec3 w = wall * (0.88 + 0.22 * fbm(vec2(u, v) * vec2(0.18, 0.35) + seed));
      if (brick > 0.5) {
        vec2 bc = vec2(u, v) / vec2(0.8, 0.25); bc.x += 0.5 * mod(floor(bc.y), 2.0);
        vec2 bw = fwidth(bc); vec2 bf = fract(bc);
        float mortar = 1.0 - smoothstep(0.0, 0.07 + bw.x, bf.x) * smoothstep(0.0, 0.14 + bw.y, bf.y);
        float bfar = smoothstep(0.25, 0.7, max(bw.x, bw.y));
        w = mix(w * (0.88 + 0.24 * h21(floor(bc) + seed)), vec3(0.6, 0.57, 0.53), mortar * 0.5 * (1.0 - bfar));
      }
      if (kind > 1.5) {
        // 금속 패널: 세로 골
        float rib = u / 0.6; float ribw = fwidth(rib);
        w *= 1.0 - 0.16 * band(fract(rib), 0.0, 0.3, ribw) * (1.0 - smoothstep(0.3, 0.8, ribw));
        // 가로 패널 이음
        float pj = band(fract(v / 1.2), 0.0, 0.05, fwy) ;
        w *= 1.0 - 0.12 * pj;
      }
      float slab = 1.0 - smoothstep(0.0, 0.05 + fw.y, f.y);
      w *= 1.0 - 0.14 * slab * (1.0 - far) * (1.0 - kind * 0.6);
      w *= 1.0 - 0.08 * vnoise(vec2(u * 0.7, v * 0.07) + seed);
      float plinth = 1.0 - smoothstep(0.5, 0.56 + fwy, v);
      w = mix(w, wall * 0.5 + vec3(0.04), plinth);
      float cornice = smoothstep(vTop - 0.75 - fwy, vTop - 0.62, v);
      w = mix(w, frame * 0.95, cornice * 0.85 * (1.0 - kind * 0.7));
      vec3 gl = glass * (0.68 + 0.64 * h21(cell + seed * 1.7));
      gl = mix(gl, vec3(0.42, 0.41, 0.38), step(0.93, h21(cell * 1.31 + seed)) * 0.5);
      gl *= mix(0.55, 1.0, smoothstep(0.0, 0.3, (sill + wh2 - f.y) / max(wh2, 0.01)));
      // 유리에 하늘 반사 느낌
      gl += vec3(0.08, 0.11, 0.14) * smoothstep(0.2, 1.0, f.y) * (0.5 + 0.5 * kind);
      vec3 nearC = mix(w, gl, win);
      nearC = mix(nearC, frame, clamp(frameM + bars, 0.0, 1.0));
      nearC = mix(nearC, frame * 1.05, ledge * 0.8);
      float cover = ww * wh2 * 0.85 * above;
      vec3 farC = mix(w, mix(glass, frame, 0.25), cover);
      c3 = mix(nearC, farC, far);
      float onL = step(0.55, h21(cell * 2.37 + seed * 3.1)) * step(1.0, v);
      litCol = mix(vec3(1.0, 0.74, 0.4), vec3(0.82, 0.9, 1.0), step(0.62, h21(cell * 0.71 + seed * 1.3)));
      lit = mix(win * (1.0 - bars) * onL, cover * 0.3, far);
    }
    diffuseColor.rgb = c3;
  }`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uNight * litCol * lit * 1.25;');
  };
  return m;
}

// 잔해 재질 (무너진 건물 바닥)
export function makeRubbleMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0x8a847a });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec2 p = vWPos.xz;
    vec3 c = vec3(0.5, 0.49, 0.46) * (0.7 + 0.55 * fbm(p * 1.3));
    c *= 1.0 - 0.32 * smoothstep(0.62, 0.7, vnoise(p * 5.0 + 7.0));
    c = mix(c, vec3(0.3, 0.19, 0.13), smoothstep(0.93, 0.97, vnoise(p * 2.2 + 3.0)));
    diffuseColor.rgb = c;
  }`);
  };
  return m;
}

// ───────── 바닥 텍스처 (잔디 · 숲 · 운동장 · 물 · 주차장 · 도로) ─────────
// 캔버스 한 장에 캠퍼스 전체를 그려 지면에 입힙니다. ext = 원점에서 가장자리까지(m).
export function paintGround(canvas, data, ext, night = 0) {
  const size = canvas.width;
  const g = canvas.getContext('2d');
  const PX = size / (2 * ext);
  const X = (x) => (x + ext) * PX, Y = (z) => (z + ext) * PX;
  const R = mulberry(7);
  const ring = (pts) => { pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); };
  const line = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke(); };
  const lerpHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
  const n = night;

  // 바탕: 캠퍼스 밖은 차분한 도시색, 캠퍼스 안은 잔디
  g.fillStyle = lerpHex('#a3a98f', '#2a3330', n); g.fillRect(0, 0, size, size);
  g.fillStyle = lerpHex('#8db36a', '#2d4432', n);
  if (data.campus && data.campus.length) { g.beginPath(); data.campus.forEach(ring); g.fill('evenodd'); }
  else { g.beginPath(); g.arc(X(0), Y(0), (data.radius + 140) * PX, 0, 6.283); g.fill(); }

  // 잔디 얼룩 (단조로움 제거)
  for (let i = 0; i < 2600; i++) {
    const x = R() * size, y = R() * size, r = (6 + R() * 40) * PX;
    const dark = R() < 0.55;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, dark ? 'rgba(20,34,10,.11)' : 'rgba(255,250,220,.08)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  const LANDC = {
    grass: lerpHex('#83b35c', '#28402c', n), wood: lerpHex('#4e7f3e', '#1a2d1e', n), scrub: lerpHex('#6f9a4c', '#223726', n),
    pitch: lerpHex('#c08457', '#4a3a2e', n), water: lerpHex('#5c9ad0', '#17304a', n), parking: lerpHex('#8d8f8c', '#2f3236', n),
  };
  for (const k of ['grass', 'scrub', 'wood', 'parking', 'pitch', 'water']) {
    g.fillStyle = LANDC[k];
    for (const L of data.lands || []) if (L.kind === k) { g.beginPath(); ring(L.pts); g.fill(); }
  }
  // 숲: 어두운 점묘
  g.save(); g.beginPath();
  for (const L of data.lands || []) if (L.kind === 'wood') ring(L.pts);
  g.clip();
  for (let i = 0; i < 4000; i++) {
    const L = (data.lands || []).filter((l) => l.kind === 'wood'); if (!L.length) break;
    const x = R() * size, y = R() * size, r = (1.5 + R() * 3) * PX;
    g.fillStyle = R() < 0.5 ? 'rgba(10,30,8,.25)' : 'rgba(150,200,90,.14)';
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
  }
  g.restore();
  // 운동장: 트랙 선 + 안쪽 잔디
  for (const L of data.lands || []) if (L.kind === 'pitch') {
    const A = Math.abs(polyArea(L.pts));
    if (A > 3000) {
      g.save(); g.beginPath(); ring(L.pts); g.clip();
      let cx = 0, cz = 0; for (const p of L.pts) { cx += p[0]; cz += p[1]; } cx /= L.pts.length; cz /= L.pts.length;
      const rr = Math.sqrt(A / Math.PI) * 0.62;
      g.fillStyle = lerpHex('#79ad57', '#26402a', n);
      g.beginPath(); g.ellipse(X(cx), Y(cz), rr * 1.25 * PX, rr * 0.75 * PX, 0, 0, 6.283); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.35 * PX;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(X(cx), Y(cz), (rr * 1.25 + k * 1.3) * PX, (rr * 0.75 + k * 1.3) * PX, 0, 0, 6.283); g.stroke(); }
      g.restore();
    }
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 0.4 * PX; g.beginPath(); ring(L.pts); g.stroke();
  }
  // 주차장 칸 선
  for (const L of data.lands || []) if (L.kind === 'parking') {
    g.save(); g.beginPath(); ring(L.pts); g.clip();
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of L.pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 0.2 * PX;
    for (let x = minx; x < maxx; x += 2.6) { g.beginPath(); g.moveTo(X(x), Y(minz)); g.lineTo(X(x), Y(maxz)); g.stroke(); }
    g.restore();
  }
  // 물: 잔물결
  for (const L of data.lands || []) if (L.kind === 'water') {
    g.save(); g.beginPath(); ring(L.pts); g.clip();
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 0.3 * PX;
    for (let i = 0; i < 40; i++) { const x = R() * size, y = R() * size; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 3 * PX, y - 1 * PX, x + 6 * PX, y); g.stroke(); }
    g.restore();
  }
  // 캠퍼스 경계선
  if (data.campus && data.campus.length) {
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 0.9 * PX; g.setLineDash([6 * PX, 4 * PX]);
    g.beginPath(); data.campus.forEach(ring); g.stroke(); g.setLineDash([]);
  }

  // 도로
  g.lineCap = 'round'; g.lineJoin = 'round';
  const roads = data.roads || [];
  const cars = roads.filter((r) => !FOOT.has(r.k)), feet = roads.filter((r) => FOOT.has(r.k));
  const W = (r) => ROAD_WIDTH[r.k] || r.w || 4;
  g.strokeStyle = lerpHex('#b7b2a6', '#3a3d42', n);
  for (const r of cars) { g.lineWidth = (W(r) + 3.2) * PX; line(r.pts); }   // 인도
  g.strokeStyle = lerpHex('#7e7b73', '#2a2c30', n);
  for (const r of cars) { g.lineWidth = (W(r) + 0.6) * PX; line(r.pts); }   // 연석
  g.strokeStyle = lerpHex('#4a4d52', '#1c1e22', n);
  for (const r of cars) { g.lineWidth = W(r) * PX; line(r.pts); }           // 아스팔트
  g.strokeStyle = '#d9b43e'; g.lineWidth = Math.max(0.22 * PX, 0.8);
  for (const r of cars) if (r.k === 'tertiary' || r.k === 'secondary' || r.k === 'primary') line(r.pts);
  g.strokeStyle = 'rgba(240,240,235,.7)'; g.setLineDash([3 * PX, 4 * PX]); g.lineWidth = Math.max(0.14 * PX, 0.6);
  for (const r of cars) if (r.k === 'residential' || r.k === 'unclassified') line(r.pts);
  g.setLineDash([]);
  for (const r of feet) {
    g.lineWidth = W(r) * PX;
    g.strokeStyle = r.k === 'path' || r.k === 'track' ? lerpHex('#9b8a6c', '#3a342a', n) : r.k === 'steps' ? lerpHex('#a69e90', '#3b3833', n) : lerpHex('#c2baa9', '#3f3d38', n);
    line(r.pts);
    if (r.k === 'steps') { g.strokeStyle = 'rgba(40,36,30,.35)'; g.setLineDash([0.12 * PX, 0.3 * PX]); g.lineCap = 'butt'; line(r.pts); g.setLineDash([]); g.lineCap = 'round'; }
  }
  // 입자감
  const nc = document.createElement('canvas'); nc.width = nc.height = 256;
  const nx = nc.getContext('2d'), img = nx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) { const v = 100 + R() * 56; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  nx.putImageData(img, 0, 0);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.4;
  g.fillStyle = g.createPattern(nc, 'repeat'); g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}

// ───────── 나무 (인스턴스) ─────────
export function makeTrees(trees, { castShadow = false } = {}) {
  const n = trees.length;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1, 5); trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = crownGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.16 * Math.sin(7.1 * x + 1.3) * Math.sin(6.3 * y + 0.7) * Math.sin(6.7 * z + 2.1);
      p.setXYZ(i, x * k, y * k * 1.12 + 0.1, z * k);
    }
    crownGeo.computeVertexNormals();
  }
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, n));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(1, n));
  crowns.castShadow = castShadow; crowns.receiveShadow = false;
  trunks.frustumCulled = false; crowns.frustumCulled = false;
  const hidden = new Uint8Array(n);
  const c = new THREE.Color(), R = mulberry(11);
  for (let i = 0; i < n; i++) { c.setHSL(0.24 + R() * 0.08, 0.42 + R() * 0.2, 0.22 + R() * 0.12); crowns.setColorAt(i, c); }
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function place() {
    for (let i = 0; i < n; i++) {
      const [x, z, sc] = trees[i], k = hidden[i] ? 0 : 1;
      q.setFromAxisAngle(up, (i * 2.399) % 6.283);
      m.compose(p.set(x, -0.2, z), q, s.set(k * sc, k * 3.2 * sc, k * sc)); trunks.setMatrixAt(i, m);
      m.compose(p.set(x, 3.9 * sc, z), q, s.set(k * 2.4 * sc, k * 2.6 * sc, k * 2.4 * sc)); crowns.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true; crowns.instanceMatrix.needsUpdate = true;
  }
  place();
  // 반경 r 안의 나무를 쓰러뜨림. 쓰러진 수를 돌려줍니다.
  function knock(x, z, r) {
    let gone = 0;
    for (let i = 0; i < n; i++) {
      if (hidden[i]) continue;
      const t = trees[i];
      if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < r * r) { hidden[i] = 1; gone++; }
    }
    if (gone) place();
    return gone;
  }
  function reset() { hidden.fill(0); place(); }
  return { trunks, crowns, place, knock, reset, hidden, trees };
}
