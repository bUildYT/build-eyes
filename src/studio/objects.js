// bUild sTudio · OBJECTS: strokes (tube / ribbon), shapes, clay volumes, imports (Blender / files), photos.
// Every object = one THREE.Object3D under the studio root, with userData.rec = its recipe (what gets saved + mirrored + sent).
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeMaterial } from './materials.js';
import { Sculpt } from './sculpt.js';
import { buildPmesh } from './paintable.js';
import { ZMesh, icosphere } from './zsculpt.js';
const V3 = THREE.Vector3;
let NEXT = 1;
export const newId = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (NEXT++);   // unique across devices (live sync)

// ---------------------------------------------------------------- strokes: samples [x,y,z, qx,qy,qz,qw, r]
const SIDES = 8;
export function strokeGeometry(S, shape) {
  const n = S.length, g = new THREE.BufferGeometry(); if (n < 2) return g;
  const pos = [], nor = [], uv = [], idx = [];
  const p = i => new V3(S[i][0], S[i][1], S[i][2]);
  let len = 0;
  if (shape === 'ribbon') {
    for (let i = 0; i < n; i++) {
      if (i) len += p(i).distanceTo(p(i - 1));
      const q = new THREE.Quaternion(S[i][3], S[i][4], S[i][5], S[i][6]), side = new V3(1, 0, 0).applyQuaternion(q).multiplyScalar(S[i][7]), up = new V3(0, 1, 0).applyQuaternion(q);
      const c = p(i); pos.push(...c.clone().sub(side).toArray(), ...c.clone().add(side).toArray()); nor.push(...up.toArray(), ...up.toArray()); uv.push(len * 8, 0, len * 8, 1);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
  } else {
    // tube: parallel-transported rings, round end caps
    let N = new V3(), T = new V3();
    for (let i = 0; i < n; i++) {
      const c = p(i), Tn = (i < n - 1 ? p(i + 1).sub(c) : c.clone().sub(p(i - 1))).normalize();
      if (i === 0) { N.set(0, 1, 0); if (Math.abs(N.dot(Tn)) > .9) N.set(1, 0, 0); N.sub(Tn.clone().multiplyScalar(N.dot(Tn))).normalize(); }
      else { const ax = new V3().crossVectors(T, Tn); if (ax.lengthSq() > 1e-10) { const ang = Math.acos(THREE.MathUtils.clamp(T.dot(Tn), -1, 1)); N.applyAxisAngle(ax.normalize(), ang); } len += c.distanceTo(p(i - 1)); }
      T.copy(Tn); const B = new V3().crossVectors(T, N), r = S[i][7];
      for (let k = 0; k <= SIDES; k++) { const a = k / SIDES * Math.PI * 2, d = N.clone().multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a)); pos.push(...c.clone().addScaledVector(d, r).toArray()); nor.push(...d.toArray()); uv.push(len * 6, k / SIDES); }
      if (i) { const a = (i - 1) * (SIDES + 1), b = i * (SIDES + 1); for (let k = 0; k < SIDES; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1); }
    }
    for (const [i, s] of [[0, -1], [n - 1, 1]]) {      // caps: a fan, slightly domed
      const c = p(i), Tn = (i ? c.clone().sub(p(i - 1)) : p(1).sub(c)).normalize(), base = pos.length / 3, ring = i * (SIDES + 1);
      pos.push(...c.clone().addScaledVector(Tn, s * S[i][7] * .6).toArray()); nor.push(...Tn.clone().multiplyScalar(s).toArray()); uv.push(0, 0);
      for (let k = 0; k < SIDES; k++) s > 0 ? idx.push(ring + k, ring + k + 1, base) : idx.push(ring + k + 1, ring + k, base);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeBoundingSphere(); return g;
}

// ---------------------------------------------------------------- shapes
export function shapeGeometry(prim) {
  switch (prim) {
    case 'sphere': return new THREE.SphereGeometry(.5, 40, 28);
    case 'cyl': return new THREE.CylinderGeometry(.5, .5, 1, 40, 1);
    case 'cone': return new THREE.ConeGeometry(.5, 1, 40, 1);
    case 'torus': { const g = new THREE.TorusGeometry(.38, .12, 20, 48); g.rotateX(Math.PI / 2); return g; }
    default: return new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
  }
}

// ---------------------------------------------------------------- clay: metaballs in a 50 cm box; balls [x,y,z,r,colorHex,sub]  dabs [x,y,z,r,colorHex]
export class Clay {
  constructor(rec) {
    this.L = rec.L || .5; this.rec = rec;
    this.mc = new MarchingCubes(56, makeMaterial(rec.mat, '#ffffff', { vertexColors: true }), false, true, 160000);
    this.mc.isolation = 80; this.mc.scale.setScalar(this.L / 2); this.mc.frustumCulled = false;
    this.mc.geometry.boundingSphere = new THREE.Sphere(new V3(), 1.8);
    this.dirty = true;
  }
  rebuild() {
    const { mc, L } = this, R = this.rec;
    mc.reset();
    for (const b of R.balls) { const rn = b[3] / L, str = 92 * rn * rn; mc.addBall(b[0] / L + .5, b[1] / L + .5, b[2] / L + .5, b[5] ? -str * 1.25 : str, 12); }
    mc.update();
    this.recolor(); this.dirty = false;
  }
  // colours per vertex: the nearest strong ball wins, then the paint dabs lay on top (newest last)
  recolor() {
    const { mc, L } = this, R = this.rec, cell = .03, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
    const put = (arr, i, x, y, z, r) => { const c0 = Math.floor((x - r) / cell), c1 = Math.floor((x + r) / cell), d0 = Math.floor((y - r) / cell), d1 = Math.floor((y + r) / cell), e0 = Math.floor((z - r) / cell), e1 = Math.floor((z + r) / cell);
      for (let a = c0; a <= c1; a++) for (let b = d0; b <= d1; b++) for (let c = e0; c <= e1; c++) { const k = key(a, b, c); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(arr * 1e7 + i); } };
    R.balls.forEach((b, i) => { if (!b[5]) put(0, i, b[0], b[1], b[2], b[3] * 1.6); });
    (R.dabs || []).forEach((d, i) => put(1, i, d[0], d[1], d[2], d[3]));
    const cols = R.balls.map(b => new THREE.Color(b[4])), dcols = (R.dabs || []).map(d => new THREE.Color(d[4]));
    const P = mc.positionArray, C = mc.colorArray, s = L / 2, tmp = new THREE.Color();
    for (let v = 0; v < mc.count; v++) {
      const x = P[v * 3] * s, y = P[v * 3 + 1] * s, z = P[v * 3 + 2] * s;
      const l = grid.get(key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)));
      let best = -1, bw = 0; tmp.setRGB(.8, .8, .8);
      if (l) {
        for (const e of l) if (e < 1e7) { const b = R.balls[e], d2 = (b[0] - x) ** 2 + (b[1] - y) ** 2 + (b[2] - z) ** 2, w = b[3] * b[3] / (d2 + 1e-6); if (w > bw) { bw = w; best = e; } }
        if (best >= 0) tmp.copy(cols[best]);
        const ds = l.filter(e => e >= 1e7).sort((a, b) => a - b);
        for (const e of ds) { const i = e - 1e7, d = R.dabs[i], dist = Math.hypot(d[0] - x, d[1] - y, d[2] - z); if (dist < d[3]) tmp.lerp(dcols[i], Math.min(1, (1 - dist / d[3]) * 1.6)); }
      }
      C[v * 3] = tmp.r; C[v * 3 + 1] = tmp.g; C[v * 3 + 2] = tmp.b;
    }
    mc.geometry.getAttribute('color').needsUpdate = true;
  }
  solidAt(p) {                                   // p in clay metres (centre = 0)
    if (this.dirty) this.rebuild();
    const mc = this.mc, n = mc.size, x = Math.round((p.x / this.L + .5) * n), y = Math.round((p.y / this.L + .5) * n), z = Math.round((p.z / this.L + .5) * n);
    if (x < 1 || y < 1 || z < 1 || x >= n - 1 || y >= n - 1 || z >= n - 1) return false;
    return mc.field[mc.size2 * z + n * y + x] > mc.isolation * .6;
  }
  inside(p) { const h = this.L / 2 * .93; return Math.abs(p.x) < h && Math.abs(p.y) < h && Math.abs(p.z) < h; }
  // a plain mesh copy (export / Blender)
  bake() {
    const n = this.mc.count, g = new THREE.BufferGeometry(), s = this.L / 2;
    const pos = this.mc.positionArray.slice(0, n * 3); for (let i = 0; i < pos.length; i++) pos[i] *= s;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.mc.normalArray.slice(0, n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(this.mc.colorArray.slice(0, n * 3), 3));
    const m = this.mc.material.clone(); m.vertexColors = true;
    return new THREE.Mesh(g, m);
  }
}

// ---------------------------------------------------------------- build any object from its recipe
const gltf = new GLTFLoader();
export function buildObject(rec) {
  let obj;
  if (rec.type === 'stroke') { obj = new THREE.Mesh(strokeGeometry(rec.s, rec.shape), makeMaterial(rec.mat, rec.color)); }
  else if (rec.type === 'shape') { obj = new THREE.Mesh(shapeGeometry(rec.prim), makeMaterial(rec.mat, rec.color)); }
  else if (rec.type === 'sculpt') { const sc = new Sculpt(rec); obj = sc.group; delete rec.data; }
  else if (rec.type === 'pmesh') { obj = buildPmesh(rec); }
  else if (rec.type === 'zmesh') { const geo = rec._geo || (rec.zg ? ZMesh.geoFrom(rec.zg) : icosphere(rec.lvl ?? 6, rec.r ?? .08)); delete rec.zg; delete rec._geo; obj = new ZMesh(rec, geo, !!rec.gid).mesh; }
  else if (rec.type === 'clay') { const c = new Clay(rec); obj = c.mc; obj.userData.clay = c; c.rebuild(); }
  else if (rec.type === 'photo') {
    const img = new Image(); img.src = rec.src; const tex = new THREE.Texture(img); img.onload = () => { tex.needsUpdate = true; }; tex.colorSpace = THREE.SRGBColorSpace;
    obj = new THREE.Mesh(new THREE.PlaneGeometry(1, rec.aspect || .75), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    obj.userData.img = img;
  } else if (rec.type === 'import') {
    obj = new THREE.Group();
    gltf.load(rec.url, g => { if (rec.local) for (const c of g.scene.children) { c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1); } g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; o.userData.part = true; } }); obj.add(g.scene); obj.userData.loaded = true; }, undefined, e => console.warn('import failed', rec.url, e && e.message));
  }
  if (rec.m) { obj.matrixAutoUpdate = true; new THREE.Matrix4().fromArray(rec.m).decompose(obj.position, obj.quaternion, obj.scale); }
  obj.userData.rec = rec; obj.name = rec.type + '_' + rec.id;
  obj.castShadow = obj.receiveShadow = true;
  return obj;
}
// the mirror twin of a recipe (across the root's x = 0 plane)
const MX = new THREE.Matrix4().makeScale(-1, 1, 1);
export function mirrorMatrix(arr) { const m = new THREE.Matrix4().fromArray(arr); return MX.clone().multiply(m).multiply(MX).toArray(); }
export function mirrorQuat(q) { return [q[0], -q[1], -q[2], q[3]]; }
