// 3D 지오메트리 생성 (건물 · 도로 · 재질). three.js 렌더러 없이도 지오메트리 생성은 Node에서 테스트 가능.
import * as THREE from 'three';

// 건물 하나 = 높이 1짜리 압출 도형. mesh.scale.y 로 실제 높이를 조절합니다 (무너질 때 줄어듦).
export function makeBuildingGeometry(pts, colorHex, seed = 0) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1, bevelEnabled: false, steps: 1, curveSegments: 1,
  });
  g.rotateX(-Math.PI / 2); // 압출 방향 → +y, 도형 (x, -z) → 월드 (x, z)
  const c = new THREE.Color(colorHex);
  const k = 0.92 + ((seed * 37) % 17) / 17 * 0.16; // 건물마다 살짝 다른 밝기
  c.multiplyScalar(k);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// 도로: 선분마다 평평한 띠를 만들어 하나의 지오메트리로 합칩니다.
export function makeRoadGeometry(roads, y = 0.3) {
  const pos = [];
  for (const r of roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x1, z1] = r.pts[i];
      const [x2, z2] = r.pts[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const hw = r.w / 2;
      const px = (-dz / len) * hw, pz = (dx / len) * hw;
      const a = [x1 + px, y, z1 + pz], b = [x1 - px, y, z1 - pz];
      const c = [x2 + px, y, z2 + pz], d = [x2 - px, y, z2 - pz];
      pos.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

// 벽에는 창문을 그려 넣고, 밤에는 일부 창문에 불이 켜지는 재질.
export function makeWallMaterial(nightUniform) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vWN = normalize(mat3(modelMatrix) * objectNormal);'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
varying vec3 vWPos;
varying vec3 vWN;
float cnuHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  vec3 winGlow = vec3(0.0);
  {
    float isWall = 1.0 - step(0.5, abs(vWN.y));
    vec2 tg = normalize(vec2(-vWN.z, vWN.x) + vec2(0.0001));
    float su = dot(vWPos.xz, tg) / 3.2;
    float sv = vWPos.y / 3.4;
    vec2 cell = vec2(fract(su), fract(sv));
    vec2 cid = vec2(floor(su), floor(sv));
    float inWin = step(0.2, cell.x) * step(cell.x, 0.8) * step(0.3, cell.y) * step(cell.y, 0.85) * step(1.2, vWPos.y) * isWall;
    float lit = step(0.5, cnuHash(cid + floor(vWPos.xz * 0.04)));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.44, 0.58), inWin * 0.78);
    winGlow = inWin * lit * uNight * vec3(1.0, 0.8, 0.42) * 0.95;
  }`
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += winGlow;');
  };
  return m;
}
