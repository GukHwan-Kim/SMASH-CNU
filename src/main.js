import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { loadRealCampus, buildFallbackCampus } from './geo.js';
import { makeBuildingGeometry, makeRoadGeometry, makeWallMaterial } from './world.js';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const isMobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);

// ───────── 오류 표시 (선물 받는 사람 화면에서 조용히 멈추지 않도록) ─────────
function showErr(msg) {
  const e = $('err');
  e.textContent = '문제가 생겼어요: ' + msg;
  e.style.display = 'block';
}
window.addEventListener('error', (e) => showErr(e.message || 'unknown'));
window.addEventListener('unhandledrejection', (e) => showErr((e.reason && e.reason.message) || String(e.reason)));

// ───────── 개인화: ?to=이름&msg=메시지 ─────────
const params = new URLSearchParams(location.search);
const TO = (params.get('to') || '').slice(0, 20);
const MSG = (params.get('msg') || '').slice(0, 80);
if (TO) { $('to').textContent = 'To. ' + TO; $('to').style.display = 'block'; }
if (MSG) { $('msg').textContent = MSG; $('msg').style.display = 'block'; }

// ───────── 렌더러 · 씬 ─────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: $('c'), antialias: !isMobile, alpha: true, powerPreference: 'high-performance',
  });
} catch (e) {
  showErr('이 브라우저에서는 3D(WebGL)를 쓸 수 없어요. 최신 크롬/사파리로 열어 주세요.');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 2));
renderer.setClearColor(0x000000, 0);
if (!isMobile) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 8, 9000);
const fog = new THREE.Fog(0xd4e9fb, 1500, 7000);
scene.fog = fog;

const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6c7a55, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d8, 2.0);
sun.position.set(-380, 620, 300);
sun.target.position.set(0, 0, 0);
scene.add(sun, sun.target);
if (!isMobile) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1800;
}

const groundMat = new THREE.MeshLambertMaterial({ color: 0x86a566 });
const ground = new THREE.Mesh(new THREE.CircleGeometry(9000, 48).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true;
scene.add(ground);
const lawnMat = new THREE.MeshLambertMaterial({ color: 0x93b370, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 56).rotateX(-Math.PI / 2), lawnMat);
lawn.position.y = 0.08;
lawn.receiveShadow = true;
scene.add(lawn);
const roadMat = new THREE.MeshLambertMaterial({ color: 0x6f757c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 40;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const scale = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  particleMat.uniforms.uScale.value = scale;
}
window.addEventListener('resize', resize);

// ───────── 재질 ─────────
const nightU = { value: 0 };
const wallMat = makeWallMaterial(nightU);
const capMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const rubbleCap = new THREE.MeshLambertMaterial({ color: 0x57524b });
const rubbleWall = new THREE.MeshLambertMaterial({ color: 0x4a463f });
// 창문 셰이더가 컴파일에 실패하면 창문 없는 기본 재질로 자동 전환
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  console.warn('창문 셰이더 컴파일 실패 → 기본 재질로 대체');
  wallMat.onBeforeCompile = () => {};
  wallMat.needsUpdate = true;
};

// ───────── 파티클 ─────────
const particleMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 800 } },
  transparent: true, depthWrite: false,
  vertexShader: `
    attribute float aSize; attribute vec4 aColor;
    uniform float uScale; varying vec4 vC;
    void main(){
      vC = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = clamp(aSize * uScale / max(-mv.z, 1.0), 0.0, 400.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec4 vC;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.05, d);
      gl_FragColor = vec4(vC.rgb, vC.a * a);
    }`,
});

class Particles {
  constructor(n) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4); this.base = new Float32Array(n * 4);
    this.size = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grow = new Float32Array(n); this.drag = new Float32Array(n); this.rise = new Float32Array(n);
    this.kind = new Uint8Array(n);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aSize', this.aSize); g.setAttribute('aColor', this.aCol);
    this.points = new THREE.Points(g, particleMat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, size, grow, life, kind, a, drag, rise, r = 0.4, g = 0.4, b = 0.4) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.max[i] = life;
    this.kind[i] = kind; this.drag[i] = drag; this.rise[i] = rise;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
  }
  update(dt) {
    const { pos, vel, col, size, life, max, grow, drag, rise, kind, base } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
      const t = 1 - life[i] / max[i];
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr + rise[i] * dt; vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.5 && kind[i] === 2) { pos[i * 3 + 1] = 0.5; vel[i * 3 + 1] *= -0.3; }
      size[i] += grow[i] * dt;
      let r, g, b, a;
      const k = kind[i];
      if (k === 0) {
        if (t < 0.35) { const u = t / 0.35; r = 1; g = 0.92 - 0.47 * u; b = 0.55 - 0.45 * u; }
        else { const u = Math.min(1, (t - 0.35) / 0.45); r = 1 - 0.75 * u; g = 0.45 - 0.23 * u; b = 0.1 + 0.1 * u; }
        a = base[i * 4 + 3] * Math.pow(1 - t, 0.6);
      } else if (k === 1) {
        r = base[i * 4]; g = base[i * 4 + 1]; b = base[i * 4 + 2];
        a = base[i * 4 + 3] * (1 - t) * Math.min(1, t * 10);
      } else {
        r = 1; g = 0.85 - 0.45 * t; b = 0.4 - 0.3 * t; a = 1 - t * t;
      }
      col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = a;
    }
    this.aPos.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.size.fill(0); this.col.fill(0); }
}
const P = new Particles(isMobile ? 3000 : 6000);

// ───────── 잔해 (인스턴스 박스) ─────────
class Debris {
  constructor(n) {
    this.n = n; this.i = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.st = new Float32Array(n * 13); // x y z vx vy vz rx ry rz wx wy wz s
    this.active = new Uint8Array(n);
    this.dummy = new THREE.Object3D();
    const c = new THREE.Color(0xffffff);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < n; k++) { this.mesh.setMatrixAt(k, zero); this.mesh.setColorAt(k, c); }
    scene.add(this.mesh);
  }
  spawn(x, y, z, vx, vy, vz, s, color) {
    const k = this.i; this.i = (k + 1) % this.n;
    const o = k * 13, st = this.st;
    st[o] = x; st[o + 1] = y; st[o + 2] = z; st[o + 3] = vx; st[o + 4] = vy; st[o + 5] = vz;
    st[o + 6] = rand(0, 6); st[o + 7] = rand(0, 6); st[o + 8] = rand(0, 6);
    st[o + 9] = rand(-8, 8); st[o + 10] = rand(-8, 8); st[o + 11] = rand(-8, 8); st[o + 12] = s;
    this.active[k] = 1;
    this._c = this._c || new THREE.Color();
    this._c.copy(color).multiplyScalar(rand(0.55, 1.05));
    this.mesh.setColorAt(k, this._c);
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const { st, active, dummy, mesh } = this;
    let any = false;
    for (let k = 0; k < this.n; k++) {
      if (!active[k]) continue;
      any = true;
      const o = k * 13;
      st[o + 4] -= 38 * dt;
      st[o] += st[o + 3] * dt; st[o + 1] += st[o + 4] * dt; st[o + 2] += st[o + 5] * dt;
      st[o + 6] += st[o + 9] * dt; st[o + 7] += st[o + 10] * dt; st[o + 8] += st[o + 11] * dt;
      const half = st[o + 12] * 0.5;
      if (st[o + 1] < half) {
        st[o + 1] = half;
        st[o + 4] *= -0.28; st[o + 3] *= 0.62; st[o + 5] *= 0.62;
        st[o + 9] *= 0.5; st[o + 10] *= 0.5; st[o + 11] *= 0.5;
        if (Math.abs(st[o + 4]) < 1.2 && Math.abs(st[o + 3]) + Math.abs(st[o + 5]) < 1.5) active[k] = 2; // 정지
      }
      dummy.position.set(st[o], st[o + 1], st[o + 2]);
      dummy.rotation.set(st[o + 6], st[o + 7], st[o + 8]);
      dummy.scale.setScalar(st[o + 12]);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      if (active[k] === 2) active[k] = 0; // 마지막 한 번 그린 뒤 더 이상 갱신하지 않음
    }
    if (any) mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < this.n; k++) this.mesh.setMatrixAt(k, zero);
    this.active.fill(0);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const D = new Debris(isMobile ? 1400 : 2800);

// ───────── 사운드 (WebAudio로 즉석 합성) ─────────
let actx = null, master = null, muted = false, noiseBuf = null;
function unlockAudio() {
  if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  } catch (e) { actx = null; }
}
function boom(power = 1, delay = 0) {
  if (!actx || muted) return;
  const t0 = actx.currentTime + delay;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900 + 1500 * power, t0);
  lp.frequency.exponentialRampToValueAtTime(70, t0 + 0.5 + power * 1.4);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.9 * Math.min(1, 0.4 + power), t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6 + power * 1.8);
  src.connect(lp); lp.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + 2.6);
  const o = actx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(95, t0); o.frequency.exponentialRampToValueAtTime(28, t0 + 0.6 + power * 0.8);
  const og = actx.createGain();
  og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.8 * Math.min(1, 0.3 + power), t0 + 0.03);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8 + power * 1.2);
  o.connect(og); og.connect(master); o.start(t0); o.stop(t0 + 2.2);
}
function zap(dur = 0.9) {
  if (!actx || muted) return;
  const t0 = actx.currentTime;
  const o = actx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(220, t0); o.frequency.linearRampToValueAtTime(980, t0 + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.1);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.2);
}
function whoosh() {
  if (!actx || muted) return;
  const t0 = actx.currentTime;
  const src = actx.createBufferSource(); src.buffer = noiseBuf;
  const bp = actx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.setValueAtTime(400, t0); bp.frequency.exponentialRampToValueAtTime(2200, t0 + 0.2); bp.Q.value = 1.2;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(t0); src.stop(t0 + 0.4);
}

// ───────── 게임 상태 ─────────
const S = {
  started: false, buildings: [], meshes: [], totalVol: 0, lostVol: 0, score: 0, destroyed: 0,
  night: 0, nightTarget: 0, shake: 0, time: 0, weapon: 'bomb', cd: {},
  projectiles: [], rings: [], timers: [], nukes: [], quake: null, lasers: [], clouds: [], temp: [],
  radius: 600, data: null, taps: 0,
};
const buildingGroup = new THREE.Group();
scene.add(buildingGroup);
const roadGroup = new THREE.Group();
scene.add(roadGroup);

function after(sec, fn) { S.timers.push({ t: S.time + sec, fn }); }

function clearWorld() {
  for (const m of S.meshes) { buildingGroup.remove(m); m.geometry.dispose(); }
  S.buildings = []; S.meshes = [];
  while (roadGroup.children.length) { const c = roadGroup.children.pop(); c.geometry.dispose(); }
}

function createWorld(data) {
  clearWorld();
  S.data = data; S.radius = data.radius || 600;
  data.buildings.forEach((d, i) => {
    const geo = makeBuildingGeometry(d.pts, d.color, i + 1);
    const mesh = new THREE.Mesh(geo, [capMat, wallMat]);
    mesh.scale.y = d.h;
    mesh.castShadow = !isMobile; mesh.receiveShadow = !isMobile;
    const b = {
      id: d.id, name: d.name, cx: d.cx, cz: d.cz, r: d.r, area: d.area,
      h0: d.h, h: d.h, th: d.h, dead: false, mesh, color: new THREE.Color(d.color), top: d.h,
    };
    mesh.userData.b = b;
    buildingGroup.add(mesh);
    S.buildings.push(b); S.meshes.push(mesh);
  });
  S.totalVol = S.buildings.reduce((s, b) => s + b.area * b.h0, 0);
  S.lostVol = 0; S.score = 0; S.destroyed = 0;
  if (data.roads.length) {
    const rm = new THREE.Mesh(makeRoadGeometry(data.roads), roadMat);
    rm.receiveShadow = !isMobile;
    roadGroup.add(rm);
  }
  lawn.scale.setScalar(S.radius + 160);
  const e = S.radius + 120;
  const sc = sun.shadow.camera;
  sc.left = -e; sc.right = e; sc.top = e; sc.bottom = -e;
  sc.updateProjectionMatrix();
  controls.maxDistance = S.radius * 3.4;
  controls.target.set(0, 0, 0);
  const dist = S.radius * 1.5;
  camera.position.set(dist * 0.15, dist * 0.8, dist * 0.95);
  controls.update();
}

function resetWorld() {
  for (const b of S.buildings) {
    b.h = b.th = b.h0; b.dead = false; b.rubble = false;
    b.mesh.scale.y = b.h0; b.mesh.material = [capMat, wallMat]; b.mesh.position.set(0, 0, 0);
  }
  S.lostVol = 0; S.score = 0; S.destroyed = 0; S.projectiles.forEach((p) => scene.remove(p.mesh)); S.projectiles = [];
  S.rings.forEach((r) => scene.remove(r.mesh)); S.rings = [];
  S.lasers.forEach((l) => scene.remove(l.mesh)); S.lasers = [];
  S.clouds.forEach((c) => c.dispose()); S.clouds = [];
  S.temp.forEach((o) => scene.remove(o)); S.temp = [];
  S.nukes = []; S.quake = null; S.timers = []; S.shake = 0;
  P.clear(); D.clear();
  hud();
}

// ───────── 피해 · 파괴 ─────────
function toast(text) {
  const t = $('toast');
  const el = document.createElement('div');
  el.className = 'toastItem'; el.textContent = text;
  t.appendChild(el);
  while (t.children.length > 3) t.removeChild(t.firstChild);
  setTimeout(() => el.remove(), 2600);
}

function dustAt(b, n) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, 6.283), rr = Math.sqrt(Math.random()) * b.r * 0.9;
    const x = b.cx + Math.cos(a) * rr, z = b.cz + Math.sin(a) * rr;
    P.emit(x, rand(0.5, Math.max(2, b.h * 0.4)), z, rand(-3, 3), rand(2, 8), rand(-3, 3),
      rand(5, 10), rand(5, 9), rand(1.2, 2.6), 1, 0.45, 0.8, 1.2, 0.62, 0.6, 0.57);
  }
}

function spawnDebris(b, lost, ex, ez, power = 1) {
  const cnt = Math.floor(clamp(lost * Math.sqrt(b.area) * 0.07, 0, 38) * (isMobile ? 0.6 : 1) + Math.random());
  for (let i = 0; i < cnt; i++) {
    const a = rand(0, 6.283), rr = Math.sqrt(Math.random()) * b.r * 0.8;
    const x = b.cx + Math.cos(a) * rr, z = b.cz + Math.sin(a) * rr;
    const y = Math.max(1, b.h - rand(0, lost));
    let dx = x - ex, dz = z - ez;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const sp = rand(3, 20) * power;
    D.spawn(x, y, z, dx * sp + rand(-3, 3), rand(4, 18) * power, dz * sp + rand(-3, 3), rand(0.9, 3.6), b.color);
  }
}

function applyDrop(b, drop, ex, ez, power = 1) {
  if (b.dead || drop < 0.3) return 0;
  const before = b.th;
  b.th = Math.max(0, b.th - drop);
  if (b.th <= 2.6) b.th = 0.6;
  const lost = before - b.th;
  if (lost <= 0) return 0;
  S.lostVol += lost * b.area;
  S.score += lost * Math.sqrt(b.area) * 0.35;
  spawnDebris(b, lost, ex, ez, power);
  if (b.th <= 0.61) {
    b.dead = true; S.destroyed++;
    S.score += 40 + Math.sqrt(b.area) * 2;
    if (b.name) toast(`💥 ${b.name} 붕괴!`);
    else if (b.h0 > 30) toast('💥 고층 건물 붕괴!');
  }
  return lost;
}

function damageAt(x, z, R, Pw, power = 1) {
  for (const b of S.buildings) {
    if (b.dead) continue;
    const d = Math.hypot(b.cx - x, b.cz - z) - b.r * 0.55;
    if (d >= R) continue;
    const f = 1 - Math.max(0, d) / R;
    applyDrop(b, Pw * f * f + (f > 0.6 ? Pw * 0.3 : 0), x, z, power);
  }
}

// 높이를 부드럽게 낮추면서 먼지를 일으키는 애니메이션
function animateBuildings(dt) {
  for (const b of S.buildings) {
    if (b.h > b.th + 0.02) {
      const before = b.h;
      b.h = Math.max(b.th, b.h + (b.th - b.h) * Math.min(1, dt * 5.5) - 0.2 * dt);
      b.mesh.scale.y = Math.max(0.3, b.h);
      if (Math.random() < 0.5 && before - b.h > 0.02) dustAt(b, 1);
    }
    if (b.dead && !b.rubble && b.h <= b.th + 0.5) {
      b.rubble = true;
      b.mesh.material = [rubbleCap, rubbleWall];
      b.mesh.scale.y = 0.7;
      dustAt(b, 8);
    }
  }
}

// ───────── 이펙트 ─────────
function fireball(x, y, z, R, k = 1) {
  const n = Math.floor(Math.min(240, R * 3.5 * k) * (isMobile ? 0.55 : 1));
  for (let i = 0; i < n; i++) {
    const th = rand(0, 6.283), ph = Math.acos(rand(-0.3, 1));
    const sp = rand(0.15, 1) * R * 1.0;
    const dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
    P.emit(x + dx * R * 0.1, y + dy * R * 0.1, z + dz * R * 0.1, dx * sp, dy * sp + R * 0.25, dz * sp,
      R * rand(0.35, 0.8), R * 0.5, rand(0.5, 1.4), 0, 0.95, 2.4, 3);
  }
  for (let i = 0; i < n * 0.55; i++) {
    const th = rand(0, 6.283);
    const sp = rand(0.1, 0.6) * R;
    P.emit(x + rand(-1, 1) * R * 0.2, y, z + rand(-1, 1) * R * 0.2, Math.cos(th) * sp, rand(0.3, 1.1) * R * 0.5, Math.sin(th) * sp,
      R * rand(0.4, 0.8), R * 0.45, rand(2.5, 5), 1, 0.55, 0.7, R * 0.08, 0.3, 0.29, 0.29);
  }
  for (let i = 0; i < n * 0.5; i++) {
    const th = rand(0, 6.283), ph = Math.acos(rand(0, 1));
    const sp = rand(0.6, 2.2) * R;
    P.emit(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.cos(ph) * sp + R * 0.8, Math.sin(ph) * Math.sin(th) * sp,
      rand(0.9, 1.8), 0, rand(0.7, 1.7), 2, 1, 0.3, -38);
  }
}

function ring(x, z, maxR, dur = 1.0, color = 0xffd9a0) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 72).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
  );
  m.position.set(x, 1.5, z); m.scale.setScalar(1);
  scene.add(m);
  S.rings.push({ mesh: m, t: 0, dur, maxR });
}

function explode(x, y, z, R, Pw, opts = {}) {
  damageAt(x, z, R, Pw, opts.power || 1);
  fireball(x, y, z, R, opts.k || 1);
  ring(x, z, R * 1.5, 0.6 + R / 80);
  S.shake = Math.max(S.shake, clamp(R / 45, 0.25, 1.4));
  boom(clamp(R / 60, 0.25, 1));
}

function hudFlash() {
  const f = $('flash');
  f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 2400, easing: 'ease-out' });
}

// ───────── 무기 ─────────
const WEAPONS = {
  bomb: { name: '폭탄', icon: '💣', cd: 0.3, hint: '탭한 곳에 폭탄을 떨어뜨려요' },
  bat: { name: '야구 배트', icon: '⚾', cd: 0.45, hint: '탭한 건물을 배트로 후려쳐요' },
  laser: { name: '레이저', icon: '⚡', cd: 1.1, hint: '탭한 곳을 우주 레이저가 가로질러요' },
  meteor: { name: '운석', icon: '☄️', cd: 1.4, hint: '탭한 곳에 운석이 떨어져요' },
  quake: { name: '지진', icon: '🌋', cd: 8, hint: '캠퍼스 전체가 흔들려요' },
  nuke: { name: '핵폭탄', icon: '☢️', cd: 7, hint: '탭한 곳에 핵폭탄. 화면이 하얘질 수 있어요' },
};

function fireBomb(x, y, z) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3.6, 4, 10), new THREE.MeshLambertMaterial({ color: 0x2b2f36 }));
  m.position.set(x + rand(-4, 4), y + 300, z + rand(-4, 4));
  scene.add(m);
  whoosh();
  S.projectiles.push({ mesh: m, v: new THREE.Vector3(0, -150, 0), g: -330, ty: y, trail: 0,
    hit() { scene.remove(m); explode(x, y, z, 30, 34); } });
}

function fireMeteor(x, y, z) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(6.5, 1), new THREE.MeshBasicMaterial({ color: 0xffa24a }));
  const dir = new THREE.Vector3(0.55, -1, -0.55).normalize();
  m.position.set(x - dir.x * 420, y - dir.y * 420, z - dir.z * 420);
  scene.add(m);
  whoosh();
  S.projectiles.push({ mesh: m, v: dir.clone().multiplyScalar(330), g: 0, ty: y, trail: 1,
    hit() { scene.remove(m); explode(x, y, z, 52, 80, { k: 1.4, power: 1.5 }); } });
}

function fireBat(x, y, z) {
  const grp = new THREE.Group();
  const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.6, 24, 14), new THREE.MeshLambertMaterial({ color: 0xc99a5b }));
  bat.position.y = -12;
  grp.add(bat);
  grp.position.set(x, y + 24, z);
  const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  grp.rotation.y = az;
  scene.add(grp);
  S.temp.push(grp);
  const start = S.time;
  let hit = false;
  S.projectiles.push({
    mesh: grp, custom: true,
    step() {
      const t = (S.time - start) / 0.34;
      grp.rotation.z = lerp(1.9, -1.9, easeOut(t * 0.9 + 0.1 * t));
      if (!hit && t > 0.2) {
        hit = true;
        whoosh();
        damageAt(x, z, 20, 20, 1.6);
        for (let i = 0; i < 26; i++) {
          const a = rand(-1.2, 1.2) + az + Math.PI / 2;
          const sp = rand(8, 34);
          P.emit(x, y + rand(0, 5), z, Math.cos(a) * sp, rand(4, 20), -Math.sin(a) * sp, rand(1, 2.2), 0, rand(0.5, 1.1), 2, 1, 0.4, -38);
        }
        for (let i = 0; i < 6; i++) P.emit(x + rand(-4, 4), y + 2, z + rand(-4, 4), rand(-6, 6), rand(2, 9), rand(-6, 6), rand(6, 11), 8, rand(1, 2), 1, 0.5, 1, 1, 0.65, 0.62, 0.58);
        S.shake = Math.max(S.shake, 0.45);
        boom(0.35);
      }
      if (t >= 1.2) { scene.remove(grp); const i = S.temp.indexOf(grp); if (i >= 0) S.temp.splice(i, 1); return true; }
      return false;
    },
  });
}

function fireLaser(x, y, z) {
  const ang = rand(0, Math.PI);
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const L = 70;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 900, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff3a5c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 900, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  beam.add(core);
  beam.position.set(x - dx * L, 440, z - dz * L);
  scene.add(beam);
  zap(1.0);
  const start = S.time, dur = 1.0;
  S.lasers.push({
    mesh: beam,
    step(dt) {
      const t = (S.time - start) / dur;
      const p = clamp(t, 0, 1);
      const px = x - dx * L + dx * 2 * L * p, pz = z - dz * L + dz * 2 * L * p;
      beam.position.set(px, 440, pz);
      beam.material.opacity = 0.55 * (0.8 + 0.2 * Math.sin(S.time * 60));
      damageAt(px, pz, 19, 280 * dt, 0.8);
      for (let i = 0; i < 3; i++) {
        P.emit(px + rand(-3, 3), rand(1, 14), pz + rand(-3, 3), rand(-10, 10), rand(6, 24), rand(-10, 10), rand(1, 2.4), 0, rand(0.4, 0.9), 2, 1, 0.5, -38);
      }
      if (Math.random() < 0.6) P.emit(px, 3, pz, rand(-2, 2), rand(3, 9), rand(-2, 2), rand(7, 12), 7, rand(0.6, 1.2), 0, 0.8, 1.5, 3);
      S.shake = Math.max(S.shake, 0.18);
      if (t >= 1) { scene.remove(beam); return true; }
      return false;
    },
  });
}

function fireQuake() {
  S.quake = { start: S.time, dur: 6.5, acc: 0 };
  S.shake = Math.max(S.shake, 0.9);
  boom(0.9);
  toast('🌋 지진 발생!');
}

function updateQuake(dt) {
  const q = S.quake; if (!q) return;
  const t = (S.time - q.start) / q.dur;
  if (t >= 1) {
    S.quake = null;
    for (const b of S.buildings) b.mesh.position.set(0, 0, 0);
    return;
  }
  const inten = Math.sin(clamp(t, 0, 1) * Math.PI) * 0.9 + 0.1;
  S.shake = Math.max(S.shake, 0.9 * inten);
  for (const b of S.buildings) {
    if (b.dead) { b.mesh.position.set(0, 0, 0); continue; }
    b.mesh.position.set(rand(-0.5, 0.5) * inten, 0, rand(-0.5, 0.5) * inten);
  }
  q.acc += dt;
  while (q.acc > 0.1) {
    q.acc -= 0.1;
    for (const b of S.buildings) {
      if (b.dead) continue;
      if (Math.random() < 0.06 * inten + 0.01) {
        applyDrop(b, rand(0.04, 0.14) * b.h0 * inten + rand(0.3, 1.2), b.cx + rand(-1, 1), b.cz + rand(-1, 1), 0.5);
        dustAt(b, 2);
      }
    }
  }
}

class Cloud {
  constructor(x, z) {
    this.t = 0; this.x = x; this.z = z;
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.92, fog: false, depthWrite: false });
    this.stemMat = mat(0xff9a3a); this.capMat = mat(0xffb44f);
    this.stem = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, 1, 20, 1, true), this.stemMat);
    this.cap = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 18), this.capMat);
    this.base = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), mat(0xd9792a));
    this.base.scale.set(70, 22, 70);
    this.base.position.set(x, 8, z);
    scene.add(this.stem, this.cap, this.base);
  }
  update(dt) {
    this.t += dt;
    const t = this.t;
    const H = 300 * easeOut(t / 4);
    const stemR = 14 + t * 4;
    this.stem.scale.set(stemR, Math.max(1, H), stemR);
    this.stem.position.set(this.x, H / 2, this.z);
    const capR = 38 + 105 * easeOut(t / 5);
    this.cap.scale.set(capR, capR * 0.62, capR);
    this.cap.position.set(this.x, H + capR * 0.25, this.z);
    const cool = clamp(t / 9, 0, 1);
    const c = new THREE.Color(0xffa040).lerp(new THREE.Color(0x5b5047), cool);
    this.capMat.color.copy(c); this.stemMat.color.copy(c).multiplyScalar(0.92);
    const op = t < 9 ? 0.92 : Math.max(0, 0.92 * (1 - (t - 9) / 5));
    this.capMat.opacity = this.stemMat.opacity = op;
    this.base.material.opacity = op * 0.8;
    this.base.scale.set(70 + t * 22, 22 + t * 2, 70 + t * 22);
    if (t < 4 && Math.random() < 0.9) {
      const a = rand(0, 6.283), rr = rand(0, stemR);
      P.emit(this.x + Math.cos(a) * rr, rand(0, H), this.z + Math.sin(a) * rr, rand(-6, 6), rand(10, 40), rand(-6, 6), rand(18, 34), 18, rand(1.2, 2.4), 0, 0.8, 1, 6);
    }
    return t >= 14;
  }
  dispose() { scene.remove(this.stem, this.cap, this.base); }
}

function fireNuke(x, y, z) {
  hudFlash();
  S.shake = 2.0;
  boom(1);
  boom(1, 0.35);
  S.nukes.push({ x, z, r: 0, prev: 0, max: 310, speed: 330 });
  ring(x, z, 330, 1.0, 0xfff2cc);
  S.clouds.push(new Cloud(x, z));
  fireball(x, 4, z, 90, 1.8);
  toast('☢️ 핵폭탄 투하!');
}

function updateNukes(dt) {
  for (let i = S.nukes.length - 1; i >= 0; i--) {
    const n = S.nukes[i];
    n.prev = n.r; n.r += n.speed * dt;
    for (const b of S.buildings) {
      if (b.dead) continue;
      const d = Math.hypot(b.cx - n.x, b.cz - n.z) - b.r * 0.5;
      if (d >= n.prev && d < n.r) {
        const k = clamp(1.25 - (d / n.max) * 1.05, 0.12, 1);
        applyDrop(b, b.th * k + 10, n.x, n.z, 2.2);
        dustAt(b, 6);
      }
    }
    for (let j = 0; j < 14; j++) {
      const a = rand(0, 6.283);
      P.emit(n.x + Math.cos(a) * n.r, rand(1, 12), n.z + Math.sin(a) * n.r, Math.cos(a) * 30, rand(2, 10), Math.sin(a) * 30,
        rand(14, 26), 12, rand(0.8, 1.6), 1, 0.45, 1.5, 2, 0.72, 0.66, 0.6);
    }
    if (n.r >= n.max) S.nukes.splice(i, 1);
  }
}

function useWeapon(id, hit) {
  const w = WEAPONS[id];
  const now = S.time;
  if ((S.cd[id] || 0) > now) return;
  S.cd[id] = now + w.cd;
  const { x, y, z, b } = hit;
  if (b && b.name) showTarget(b.name);
  if (id === 'bomb') fireBomb(x, y, z);
  else if (id === 'bat') fireBat(x, y, z);
  else if (id === 'laser') fireLaser(x, y, z);
  else if (id === 'meteor') fireMeteor(x, y, z);
  else if (id === 'quake') fireQuake();
  else if (id === 'nuke') fireNuke(x, y, z);
}

let targetTimer = 0;
function showTarget(name) {
  const el = $('target');
  el.textContent = '🎯 ' + name;
  el.style.opacity = 1;
  clearTimeout(targetTimer);
  targetTimer = setTimeout(() => { el.style.opacity = 0; }, 1800);
}

// ───────── 입력 ─────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmpV = new THREE.Vector3();

function pick(clientX, clientY) {
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(S.meshes, false);
  if (hits.length) {
    const h = hits[0];
    return { x: h.point.x, y: Math.max(0, h.point.y), z: h.point.z, b: h.object.userData.b };
  }
  if (raycaster.ray.intersectPlane(groundPlane, tmpV)) {
    return { x: tmpV.x, y: 0, z: tmpV.z, b: null };
  }
  return null;
}

const canvas = $('c');
let gesture = null, pointers = 0, multi = false;
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  pointers++;
  if (pointers > 1) multi = true;
  if (pointers === 1) { multi = false; gesture = { x: e.clientX, y: e.clientY, t: performance.now(), btn: e.button }; }
});
canvas.addEventListener('pointerup', (e) => {
  pointers = Math.max(0, pointers - 1);
  if (!gesture || multi) { if (pointers === 0) gesture = null; return; }
  const moved = Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y);
  const dt = performance.now() - gesture.t;
  const ok = moved < 9 && dt < 650 && gesture.btn === 0;
  gesture = null;
  if (!ok || !S.started) return;
  const hit = pick(e.clientX, e.clientY);
  if (hit) { S.taps++; useWeapon(S.weapon, hit); }
});
canvas.addEventListener('pointercancel', () => { pointers = 0; gesture = null; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ───────── HUD ─────────
function pct() { return S.totalVol ? (S.lostVol / S.totalVol) * 100 : 0; }
const RANKS = [
  [90, 'SSS', '캠퍼스가 사라졌다'], [75, 'SS', '거의 다 날렸어요'], [58, 'S', '폐허가 되어 가는 중'],
  [38, 'A', '캠퍼스가 휘청'], [20, 'B', '꽤 시원하게 부쉈어요'], [8, 'C', '슬슬 달아오르는 중'], [0, 'D', '아직 몸풀기'],
];
function rankOf(p) { return RANKS.find((r) => p >= r[0]); }

let hudAcc = 0;
function hud() {
  const p = pct();
  $('pct').textContent = p.toFixed(1) + '%';
  $('bar').style.width = clamp(p, 0, 100) + '%';
  $('score').textContent = Math.floor(S.score).toLocaleString('ko-KR');
  $('cnt').textContent = `${S.destroyed} / ${S.buildings.length}동`;
}

function buildWeaponBar() {
  const bar = $('weapons');
  bar.innerHTML = '';
  Object.entries(WEAPONS).forEach(([id, w]) => {
    const b = document.createElement('button');
    b.className = 'wbtn' + (id === S.weapon ? ' on' : '');
    b.dataset.id = id;
    b.innerHTML = `<span class="ic">${w.icon}</span><span class="nm">${w.name}</span><i class="cdfill"></i>`;
    b.addEventListener('click', () => {
      unlockAudio();
      S.weapon = id;
      bar.querySelectorAll('.wbtn').forEach((x) => x.classList.toggle('on', x.dataset.id === id));
      $('hint').textContent = w.hint;
      if (id === 'quake' && S.started) useWeapon('quake', { x: 0, y: 0, z: 0, b: null });
    });
    bar.appendChild(b);
  });
  $('hint').textContent = WEAPONS[S.weapon].hint;
}

function updateCooldownUI() {
  document.querySelectorAll('.wbtn').forEach((el) => {
    const id = el.dataset.id, w = WEAPONS[id];
    const rem = (S.cd[id] || 0) - S.time;
    const f = rem > 0 ? clamp(rem / w.cd, 0, 1) : 0;
    el.querySelector('.cdfill').style.height = (f * 100) + '%';
  });
}

// 밤 모드
const DAY = { top: new THREE.Color(0x5ea6ee), bot: new THREE.Color(0xd4e9fb), ground: new THREE.Color(0x86a566), lawn: new THREE.Color(0x93b370), hemiS: new THREE.Color(0xcfe6ff), sunC: new THREE.Color(0xfff1d8) };
const NIGHT = { top: new THREE.Color(0x03050d), bot: new THREE.Color(0x172143), ground: new THREE.Color(0x2b3a2f), lawn: new THREE.Color(0x33463a), hemiS: new THREE.Color(0x6d86d6), sunC: new THREE.Color(0x8fa6ff) };
let lastNight = -1;
function applyNight(n) {
  if (Math.abs(n - lastNight) < 0.002) return;
  lastNight = n;
  const top = new THREE.Color().lerpColors(DAY.top, NIGHT.top, n);
  const bot = new THREE.Color().lerpColors(DAY.bot, NIGHT.bot, n);
  document.body.style.background = `linear-gradient(180deg, #${top.getHexString()} 0%, #${bot.getHexString()} 62%)`;
  fog.color.copy(bot);
  groundMat.color.lerpColors(DAY.ground, NIGHT.ground, n);
  lawnMat.color.lerpColors(DAY.lawn, NIGHT.lawn, n);
  hemi.color.lerpColors(DAY.hemiS, NIGHT.hemiS, n);
  hemi.intensity = lerp(1.0, 0.45, n);
  sun.color.lerpColors(DAY.sunC, NIGHT.sunC, n);
  sun.intensity = lerp(2.0, 0.55, n);
  nightU.value = n;
}

// ───────── 결과 카드 ─────────
function showResult() {
  const p = pct(), r = rankOf(p);
  $('rrank').textContent = r[1];
  $('rtitle').textContent = r[2];
  $('rpct').textContent = p.toFixed(1) + '%';
  $('rscore').textContent = Math.floor(S.score).toLocaleString('ko-KR');
  $('rcnt').textContent = `${S.destroyed} / ${S.buildings.length}동`;
  $('result').style.display = 'flex';
}

function drawCard() {
  const p = pct(), r = rankOf(p);
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 1350);
  grad.addColorStop(0, '#0b1224'); grad.addColorStop(1, '#2b1620');
  g.fillStyle = grad; g.fillRect(0, 0, 1080, 1350);
  const glow = g.createRadialGradient(540, 520, 20, 540, 520, 560);
  glow.addColorStop(0, 'rgba(255,140,40,.55)'); glow.addColorStop(1, 'rgba(255,140,40,0)');
  g.fillStyle = glow; g.fillRect(0, 0, 1080, 1350);
  g.textAlign = 'center';
  g.fillStyle = '#9db8ff'; g.font = '700 46px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  g.fillText('SMASH 충남대', 540, 130);
  g.fillStyle = '#fff'; g.font = '900 360px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  g.fillText(r[1], 540, 560);
  g.font = '700 58px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  g.fillStyle = '#ffd7a8'; g.fillText(r[2], 540, 660);
  const rows = [['파괴율', p.toFixed(1) + '%'], ['점수', Math.floor(S.score).toLocaleString('ko-KR')], ['무너뜨린 건물', `${S.destroyed} / ${S.buildings.length}동`]];
  rows.forEach((row, i) => {
    const y = 790 + i * 130;
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(150, y - 78, 780, 106);
    g.textAlign = 'left'; g.fillStyle = '#aab6d6'; g.font = '600 40px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'; g.fillText(row[0], 190, y - 10);
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = '800 54px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'; g.fillText(row[1], 890, y - 6);
  });
  g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '500 28px system-ui, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  if (TO) g.fillText('For ' + TO, 540, 1230);
  g.fillText('시험기간 스트레스 해소용 비공식 팬 게임 · 지도 © OpenStreetMap contributors', 540, 1290);
  return c;
}

async function saveCard() {
  const c = drawCard();
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'smash-cnu.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'SMASH 충남대' });
      return;
    }
  } catch (e) { /* 공유 취소 시 다운로드로 */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'smash-cnu.png';
  document.body.appendChild(a); a.click(); a.remove();
}

// ───────── 메인 루프 ─────────
let last = performance.now(), shakeV = new THREE.Vector3();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  S.time += dt;

  // 예약된 일
  for (let i = S.timers.length - 1; i >= 0; i--) {
    if (S.timers[i].t <= S.time) { const f = S.timers[i].fn; S.timers.splice(i, 1); f(); }
  }
  // 발사체
  for (let i = S.projectiles.length - 1; i >= 0; i--) {
    const p = S.projectiles[i];
    if (p.custom) { if (p.step()) S.projectiles.splice(i, 1); continue; }
    p.v.y += p.g * dt;
    p.mesh.position.addScaledVector(p.v, dt);
    if (p.trail) {
      for (let k = 0; k < 3; k++) {
        const q = p.mesh.position;
        P.emit(q.x + rand(-2, 2), q.y + rand(-2, 2), q.z + rand(-2, 2), rand(-6, 6), rand(-6, 6), rand(-6, 6), rand(9, 16), 4, rand(0.5, 1.0), 0, 0.9, 1, 0);
      }
    }
    if (p.mesh.position.y <= p.ty) { S.projectiles.splice(i, 1); p.hit(); }
  }
  for (let i = S.lasers.length - 1; i >= 0; i--) if (S.lasers[i].step(dt)) S.lasers.splice(i, 1);
  for (let i = S.rings.length - 1; i >= 0; i--) {
    const r = S.rings[i]; r.t += dt;
    const u = r.t / r.dur;
    r.mesh.scale.setScalar(Math.max(0.1, r.maxR * easeOut(u)));
    r.mesh.material.opacity = 0.8 * (1 - u);
    if (u >= 1) { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); S.rings.splice(i, 1); }
  }
  for (let i = S.clouds.length - 1; i >= 0; i--) if (S.clouds[i].update(dt)) { S.clouds[i].dispose(); S.clouds.splice(i, 1); }
  updateQuake(dt);
  updateNukes(dt);
  animateBuildings(dt);
  P.update(dt);
  D.update(dt);

  S.nightTarget = $('night').classList.contains('on') ? 1 : 0;
  S.night += (S.nightTarget - S.night) * Math.min(1, dt * 3);
  applyNight(S.night);

  hudAcc += dt;
  if (hudAcc > 0.1) { hudAcc = 0; hud(); updateCooldownUI(); }

  controls.update();
  // 카메라 흔들림
  if (S.shake > 0.001) {
    const a = S.shake * 3.2;
    shakeV.set(rand(-a, a), rand(-a, a) * 0.6, rand(-a, a));
    camera.position.add(shakeV);
    renderer.render(scene, camera);
    camera.position.sub(shakeV);
    S.shake *= Math.pow(0.04, dt);
  } else {
    renderer.render(scene, camera);
  }
}

// ───────── 시작 흐름 ─────────
function startPlay() {
  S.started = true;
  controls.autoRotate = false;
  $('intro').style.display = 'none';
  $('hud').style.display = 'block';
  unlockAudio();
}

function wireUI() {
  buildWeaponBar();
  $('start').addEventListener('click', startPlay);
  $('night').addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); });
  $('mute').addEventListener('click', (e) => {
    muted = !muted;
    e.currentTarget.textContent = muted ? '🔇' : '🔊';
    if (master) master.gain.value = muted ? 0 : 0.7;
  });
  $('finish').addEventListener('click', showResult);
  $('rsave').addEventListener('click', saveCard);
  $('rcont').addEventListener('click', () => { $('result').style.display = 'none'; });
  $('rreset').addEventListener('click', () => { $('result').style.display = 'none'; resetWorld(); });
}

async function boot() {
  resize();
  wireUI();
  requestAnimationFrame(loop);
  const status = $('lstatus');
  let skipped = false, data = null;

  const skipBtn = $('skip');
  const skipTimer = setTimeout(() => { skipBtn.style.display = 'inline-block'; }, 6000);
  const skipP = new Promise((res) => skipBtn.addEventListener('click', () => { skipped = true; res(null); }));
  const realP = loadRealCampus((m) => { status.textContent = m; }).catch((e) => { console.warn(e); return null; });
  data = await Promise.race([realP, skipP]);
  clearTimeout(skipTimer);

  let note = '';
  if (!data) {
    data = buildFallbackCampus();
    note = skipped
      ? '지도를 기다리지 않고 내장 캠퍼스로 시작했어요.'
      : '지도 서버에 연결하지 못해 내장 근사 캠퍼스로 시작했어요. (인터넷 연결 후 새로고침하면 실제 지도로 불러와요)';
  }
  createWorld(data);
  $('src').textContent = (data.source === 'fallback' ? '근사 캠퍼스(실제 지도 아님)' : '건물·도로 © OpenStreetMap contributors') + ' · ' + data.stats;
  if (note) $('note').textContent = note;
  $('loading').style.display = 'none';
  $('intro').style.display = 'flex';
  hud();
}

window.__SMASH__ = { S, camera, controls }; // 디버그/테스트용
boot().catch((e) => showErr(e.message || String(e)));
