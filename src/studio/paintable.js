// bUild sTudio · PAINTABLE: anything → a painted mesh ('pmesh') with its own texture set, layers, PBR maps.
//  · shapes / strokes / Blender imports: keep good UVs (or auto-unwrap), the old look becomes the first layer
//  · SCULPTS (the Modeler → Painter bridge, like Substance "bake high → low"):
//      weld the voxel mesh → decimate (meshoptimizer) → unwrap → GPU bake from the voxels: colour + rough + metal → base layer,
//      the high-res surface detail → a tangent-space normal map under all your paint
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'three/addons/libs/meshopt_simplifier.module.js';
import { TexSet, createPainterGPU } from './painter.js';
import { unwrap, uvsUsable } from './unwrap.js';
import { MATS } from './materials.js';
const V3 = THREE.Vector3;
let G = null;
export function initPainter(renderer) { G = createPainterGPU(renderer); return G; }
export const painterGPU = () => G;

// ---------------------------------------------------------------- bytes ↔ text (saves) — chunked, no stack overflow on big arrays
export const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
export const unb64 = s => { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const f32 = a => b64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)), uf32 = s => { const u = unb64(s); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); };
const u32 = a => b64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)), uu32 = s => { const u = unb64(s); return new Uint32Array(u.buffer, u.byteOffset, u.byteLength / 4); };
export function geoOut(g) { return { p: f32(g.attributes.position.array), n: f32(g.attributes.normal.array), u: f32(g.attributes.uv.array), i: u32(g.index.array instanceof Uint32Array ? g.index.array : new Uint32Array(g.index.array)) }; }
export function geoIn(o) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(uf32(o.p), 3)); g.setAttribute('normal', new THREE.BufferAttribute(uf32(o.n), 3)); g.setAttribute('uv', new THREE.BufferAttribute(uf32(o.u), 2)); g.setIndex(new THREE.BufferAttribute(uu32(o.i), 1)); g.computeBoundingSphere(); return g; }
// layer pixels in a save: deflated bytes → base64
export const pxOut = o => { const c = { ...o }; if (c.px) c.px = c.px.map(b => b64(b)); if (c.mpx) c.mpx = b64(c.mpx); return c; };
export const pxIn = o => { const c = { ...o }; if (c.px) c.px = c.px.map(s => typeof s === 'string' ? unb64(s) : new Uint8Array(s)); if (c.mpx) c.mpx = typeof c.mpx === 'string' ? unb64(c.mpx) : new Uint8Array(c.mpx); return c; };

// ---------------------------------------------------------------- build a pmesh object from its recipe
// rec = { type: 'pmesh', id, m, geo, res, layers: [layer JSON (+ px when loading a save)], bn: deflated baked-normal bytes? }
export function buildPmesh(rec) {
  const geo = geoIn(rec.geo), mesh = new THREE.Mesh(geo);
  const ts = new TexSet(G, mesh, { res: rec.res || 1024 });
  for (const l of rec.layers || []) ts.layerIn(pxIn(l));
  if (rec.bn) setBakedNormal(ts, typeof rec.bn === 'string' ? unb64(rec.bn) : new Uint8Array(rec.bn), rec.bnRes || ts.res);
  ts.sel = Math.max(0, ts.layers.length - 1); ts.update();
  mesh.material = ts.material; mesh.userData.ts = ts; mesh.castShadow = mesh.receiveShadow = true;
  rec.layers = ts.layers.map(l => ts.layerOut(l, false));   // the recipe keeps params only; pixels live on the GPU
  delete rec.bn; delete rec.bnRes; rec.hasBn = !!ts.bnTex;
  return mesh;
}
// the baked sculpt detail (tangent-space normal, RGBA8 bytes)
import { unzlibSync, zlibSync } from 'fflate';
export function setBakedNormal(ts, z, R = ts.res) {
  const bytes = unzlibSync(z), t = new THREE.DataTexture(bytes, R, R, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  if (ts.bnTex) ts.bnTex.dispose(); ts.bnTex = t; ts.bnBytes = z; ts.bnRes = R; ts.full();
}
export function bakedNormalOut(ts) { return ts.bnBytes || null; }

// ---------------------------------------------------------------- object → painted mesh
// geometry of an object in ITS OWN space (children merged), + a starting look
function geometryOf(o) {
  const parts = []; o.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
  o.traverse(c => {
    if (!c.isMesh || !c.geometry || c.userData.ui) return;
    let g = c.geometry.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (c !== o) g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (!parts.length) return null;
  const hasUv = parts.every(p => p.attributes.uv);
  if (!hasUv) parts.forEach(p => p.deleteAttribute('uv'));
  return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
}
export function startLayerFor(rec) {
  const M = MATS[rec.mat] || MATS.clay, col = M.base || M.tint || rec.color || '#bbbbbb';
  return { kind: 'fill', name: 'base · ' + (M.label || 'colour'), colA: col, colB: col, rmA: [M.rough, M.metal, 0, M.glow ? 1 : 0], rmB: [M.rough, M.metal, 0, M.glow ? 1 : 0], emitOn: M.glow ? 1 : 0, pat: M.noise === 'stone' ? 7 : M.noise === 'wood' ? 5 : 0, scale: 20, contrast: M.noise ? .5 : 1 };
}
// returns the recipe of the new pmesh (the caller swaps the objects + handles undo)
export async function toPmesh(o, { res = 1024, keepUVs = true } = {}) {
  const r = o.userData.rec;
  if (o.userData.sculpt) return sculptToPmesh(o, { res });
  let g = geometryOf(o); if (!g) return null;
  let geo;
  let kept = false; if (keepUVs && g.attributes.uv) { const idx = mergeVertices(g); if (uvsUsable(idx)) { geo = idx; kept = true; } }
  if (!geo) geo = unwrap(g, { res });
  o.updateMatrix();
  const rec = { type: 'pmesh', id: r.id, m: o.matrix.toArray(), res, geo: geoOut(geo), layers: [startLayerFor(r)], from: r.type, keptUVs: kept, bl: r.bl, name: r.name };
  return rec;
}

// ---------------------------------------------------------------- SCULPT → PAINTER: decimate + unwrap + bake from the voxels
export async function sculptToPmesh(o, { res = 1024, keep = .3, maxTris = 60000 } = {}) {
  const sc = o.userData.sculpt; sc.flush();
  const t0 = performance.now();
  // 1. the full voxel surface, welded across chunk borders
  const parts = [...sc.chunks.values()].filter(c => c.mesh).map(c => { const g = new THREE.BufferGeometry(); g.setAttribute('position', c.mesh.geometry.attributes.position.clone()); g.setIndex(c.mesh.geometry.index.clone()); return g; });
  if (!parts.length) return null;
  let hi = mergeVertices(mergeGeometries(parts, false), sc.vs * 1e-3);
  // 2. decimate (meshoptimizer: quadric error, keeps the silhouette)
  await MeshoptSimplifier.ready;
  const tris = hi.index.count / 3, target = Math.max(2000, Math.min(maxTris, Math.round(tris * keep)));
  const [ind] = MeshoptSimplifier.simplify(new Uint32Array(hi.index.array), new Float32Array(hi.attributes.position.array), 3, target * 3, sc.vs * 1.5, ['ErrorAbsolute']);
  let lo = new THREE.BufferGeometry(); lo.setAttribute('position', hi.attributes.position); lo.setIndex(new THREE.BufferAttribute(ind, 1));
  lo = compact(lo); lo.computeVertexNormals();
  // 3. unwrap
  const geo = unwrap(lo, { res });
  const t1 = performance.now();
  // 4. bake from the voxels (GPU): colour / rough / metal → a paint layer, detail → normal map
  o.updateMatrix();
  const rec = { type: 'pmesh', id: o.userData.rec.id, m: o.matrix.toArray(), res, geo: geoOut(geo), layers: [], from: 'sculpt', src: { tris, low: geo.index.count / 3 } };
  const mesh = buildPmesh(rec);
  bakeFromVoxels(mesh.userData.ts, sc);
  const ts = mesh.userData.ts; ts.update();
  rec.layers = ts.layers.map(l => ts.layerOut(l, false));
  console.log(`[painter] sculpt → painter: ${tris} → ${rec.src.low} tris, ${geo.userData.unwrap.charts} charts, ${Math.round(t1 - t0)} ms + bake ${Math.round(performance.now() - t1)} ms`);
  return { rec, mesh };
}
function compact(g) {   // drop vertices the simplifier no longer uses
  const idx = g.index.array, pos = g.attributes.position, map = new Int32Array(pos.count).fill(-1), P = [], I = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) { const v = idx[i]; if (map[v] < 0) { map[v] = P.length / 3; P.push(pos.getX(v), pos.getY(v), pos.getZ(v)); } I[i] = map[v]; }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); o.setIndex(new THREE.BufferAttribute(I, 1)); return o;
}

const BAKE_FRAG = /* glsl */`
  in vec2 vUv; uniform sampler2D tP, tN, tT; uniform sampler3D tD, tC, tM; uniform vec3 g0, dims; uniform float vs, reach;
  layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oP; layout(location = 2) out vec4 oA; layout(location = 3) out vec4 oNrm;
  vec3 tc(vec3 p){ return (p / vs - g0 + .5) / dims; }
  float dens(vec3 p){ return texture(tD, tc(p)).r; }
  vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
  void main(){
    vec4 P = texture(tP, vUv); if (P.w < .5){ oC = vec4(0); oP = vec4(0); oA = vec4(0); oNrm = vec4(.5, .5, 1, 1); return; }
    vec3 N = normalize(texture(tN, vUv).xyz); vec4 T4 = texture(tT, vUv); vec3 T = normalize(T4.xyz), B = cross(N, T) * sign(T4.w);
    // find the high-res surface along the low-poly normal (density .5 = the surface)
    float best = 0., bd = 1e9; float prev = dens(P.xyz - N * reach) - .5;
    for (int i = 1; i <= 40; i++){
      float t = -reach + 2. * reach * float(i) / 40.; float cur = dens(P.xyz + N * t) - .5;
      if (sign(cur) != sign(prev)){ float tp = t - 2. * reach / 40.; float tz = tp + (t - tp) * prev / (prev - cur); if (abs(tz) < bd){ bd = abs(tz); best = tz; } }
      prev = cur;
    }
    vec3 H = P.xyz + N * best, e = vec3(vs, 0, 0);
    vec3 g = vec3(dens(H + e.xyy) - dens(H - e.xyy), dens(H + e.yxy) - dens(H - e.yxy), dens(H + e.yyx) - dens(H - e.yyx));
    vec3 Nh = length(g) > 1e-6 ? normalize(-g) : N;
    vec3 inside = H - Nh * vs * .6; vec4 c = texture(tC, tc(inside)); float metal = texture(tM, tc(inside)).r;
    oC = vec4(srgb(c.rgb), 1.); oP = vec4(c.a, metal, .5, 0.); oA = vec4(1, 1, 0, 0);
    vec3 nt = normalize(vec3(dot(Nh, T), dot(Nh, B), dot(Nh, N)));
    oNrm = vec4(nt * .5 + .5, 1.);
  }`;
let bakeMat = null;
export function bakeFromVoxels(ts, sc) {
  // dense 3D textures over the sculpt's chunks: density · colour + rough · metal
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const C = 24;
  for (const ch of sc.chunks.values()) { const o = [ch.cx * C, ch.cy * C, ch.cz * C]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], o[k]); mx[k] = Math.max(mx[k], o[k] + C); } }
  const D = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], N = D[0] * D[1] * D[2];
  if (N > 300 ** 3) { console.warn('[painter] sculpt too big for one bake', D); return false; }
  const den = new Uint8Array(N), col = new Uint8Array(N * 4), met = new Uint8Array(N), I = (x, y, z) => x + D[0] * (y + D[1] * z);
  for (const ch of sc.chunks.values()) {
    const ox = ch.cx * C - mn[0], oy = ch.cy * C - mn[1], oz = ch.cz * C - mn[2];
    for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const i = x + C * (y + C * z), j = I(ox + x, oy + y, oz + z);
      den[j] = Math.round((ch.d[i] + 1) * 127.5); col[j * 4] = ch.col[i * 3]; col[j * 4 + 1] = ch.col[i * 3 + 1]; col[j * 4 + 2] = ch.col[i * 3 + 2]; col[j * 4 + 3] = ch.rm[i * 2]; met[j] = ch.rm[i * 2 + 1];
    }
  }
  const tex = (data, fmt) => { const t = new THREE.Data3DTexture(data, D[0], D[1], D[2]); t.format = fmt; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true; return t; };
  const tD = tex(den, THREE.RedFormat), tC = tex(col, THREE.RGBAFormat), tM = tex(met, THREE.RedFormat);
  if (!bakeMat) bakeMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    vertexShader: 'precision highp float;\nin vec3 position; out vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'precision highp float; precision highp sampler3D;\n' + BAKE_FRAG,
    uniforms: { tP: { value: null }, tN: { value: null }, tT: { value: null }, tD: { value: null }, tC: { value: null }, tM: { value: null }, g0: { value: new V3() }, dims: { value: new V3() }, vs: { value: 1 }, reach: { value: 1 } } });
  const U = bakeMat.uniforms;
  U.tP.value = ts.bake.textures[0]; U.tN.value = ts.bake.textures[1]; U.tT.value = ts.bake.textures[2]; U.tD.value = tD; U.tC.value = tC; U.tM.value = tM;
  U.g0.value.set(mn[0], mn[1], mn[2]); U.dims.value.set(D[0], D[1], D[2]); U.vs.value = sc.vs; U.reach.value = sc.vs * 4;
  // one pass into 4 targets: the 3 paint-layer targets + the normal map
  const R = ts.res, out = new THREE.WebGLRenderTarget(R, R, { count: 4, type: THREE.UnsignedByteType, depthBuffer: false });
  G.pass(bakeMat, out);
  const l = ts.addLayer({ kind: 'paint', name: 'sculpt colours', chan: [1, 1, 1, 0] }, 0);
  const U3 = G.copy3Mat.uniforms; U3.t0.value = out.textures[0]; U3.t1.value = out.textures[1]; U3.t2.value = out.textures[2]; G.pass(G.copy3Mat, l.rt);
  const bn = ts.read(out, 3); setBakedNormal(ts, zlibSync(bn, { level: 6 }));
  out.dispose(); tD.dispose(); tC.dispose(); tM.dispose();
  l.ver++; ts.full(); return true;
}

// ---------------------------------------------------------------- brush from the studio pointer
export function dabsFor(mesh, hitWorld, dirWorld, rWorld, mirrorX) {
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert(), p = hitWorld.clone().applyMatrix4(inv), d = dirWorld.clone().transformDirection(inv), s = mesh.getWorldScale(new V3()).x;
  const out = [{ p, r: rWorld / s, dir: d }];
  if (mirrorX) out.push({ p: new V3(-p.x, p.y, p.z), r: rWorld / s, dir: new V3(-d.x, d.y, d.z) });
  return out;
}
