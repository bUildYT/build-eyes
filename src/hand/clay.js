// hAnd bUilder · the clay: bUild sTudio's voxel field + worker meshing + the sculpt-and-paint brushes (idea from bUild fOrge).
import * as THREE from 'three';
import { Sculpt, C } from '../studio/sculpt.js';
import { MATS, TONES } from '../studio/materials.js';
import { M, N, P } from './mesher.js';

export const HMATS = {
  pearl: { label: 'pearl', rough: .36, metal: 0 }, matte: { label: 'clay', rough: .78, metal: 0 }, hgold: { label: 'gold', rough: .2, metal: 1, base: '#ffc65c' },
  hchrome: { label: 'chrome', rough: .05, metal: 1, base: '#f2f3f5' }, hstone: { label: 'stone', rough: .96, metal: 0 }, hobs: { label: 'obsidian', rough: .08, metal: 0, base: '#0b0b0f' },
};
Object.assign(MATS, HMATS);
TONES.pearl = { label: 'pearl', rim: [1.14, 1.11, 1.07, .75], cav: [.56, .49, .45, .85], misc: [.55, 0, 0, .025], rough: [.12, .06], belly: '#ffffff' };

const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
const idx = (x, y, z) => x + C * (y + C * z);
const ss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const NN = N * N, PP = P * P, V = THREE.Vector3, C3 = C * C * C, BYTES = C3 * 9;
const isEmpty = d => { for (let i = 0; i < d.length; i++) if (d[i] > -.999) return false; return true; };
const eq = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const same3 = (a, b) => eq(a.d, b.d) && eq(a.col, b.col) && eq(a.rm, b.rm);
let workers = null, nextW = 0, jobId = 1; const owners = new Map(), pool = [];
function getWorkers() {
  if (workers) return workers;
  const n = Math.max(2, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));   // the Quest browser reports 3 cores
  workers = Array.from({ length: n }, () => {
    const w = new Worker(new URL('./mesher.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = e => { const m = e.data, cb = owners.get(m.k); owners.delete(m.k); pool.push({ d: m.d, col: m.col, rm: m.rm }); cb && cb(m.g); };
    w.onerror = e => console.error('[mesher]', e.message);
    return w;
  });
  return workers;
}

export class HandClay extends Sculpt {
  constructor(rec) {
    const data = rec.data; delete rec.data; super(rec);
    this.focus = new V(); this.flying = 0; this.meshVer = 0; this.floor = false; this.clusters = new Map(); this.recs = []; this.killed = []; this.lod = 1; this.viewScale = 1; this.busy = false; this.rough = new Set(); const ua = self.__UA || navigator.userAgent; this.triBudget = /Quest|OculusBrowser/.test(ua) ? 7e5 : /Mobi|Android/.test(ua) ? 25e4 : 4e6;   // a huge piece stays fluid: it is drawn with fewer triangles, nothing is lost
    if (data) this.load(data);
  }
  flush() { }                                // meshing is asynchronous: whatever is dirty arrives over the next frames
  markDirty(cx, cy, cz) { super.markDirty(cx, cy, cz); (this.unsaved ||= new Set()).add(key(cx, cy, cz)); }
  applyChunk(cx, cy, cz, u) { super.applyChunk(cx, cy, cz, u); if (this.ready) (this.unsaved ||= new Set()).add(key(cx, cy, cz)); }
  unsavedTake() { const u = this.unsaved; this.unsaved = null; return u || []; }
  // ---------------------------------------------------------------- memory: a headset has ~2 GB. Empty blocks do not exist, undo keeps only what really changed
  // ---------------------------------------------------------------- draw calls: blocks at rest are merged, 4x4x4 per draw. The block you touch splits off again
  setMesh(ch, geo) {
    super.setMesh(ch, geo); const k = key(ch.cx >> 2, ch.cy >> 2, ch.cz >> 2); let cl = this.clusters.get(k);
    if (!cl) { if (!ch.mesh) return; cl = { x: ch.cx >> 2, y: ch.cy >> 2, z: ch.cz >> 2, set: new Set(), m: null, ok: false, t: 0 }; this.clusters.set(k, cl); }
    if (ch.mesh) cl.set.add(ch); else cl.set.delete(ch);
    cl.ok = false; cl.t = performance.now(); if (cl.m) { cl.m.visible = false; for (const c of cl.set) c.mesh.visible = true; } if (ch.mesh) ch.mesh.visible = true;
    if (!cl.set.size) { this.freeCluster(cl); this.clusters.delete(k); }
  }
  freeCluster(cl) { if (cl.m) { cl.m.geometry.dispose(); this.group.remove(cl.m); cl.m = null; } }
  mergeStep() { const now = performance.now(); for (const cl of this.clusters.values()) if (!cl.ok && now - cl.t > 350) { this.mergeCluster(cl); return; } }
  mergeCluster(cl) {
    cl.ok = true; const L = [...cl.set]; if (L.length < 2) { this.freeCluster(cl); for (const c of L) c.mesh.visible = true; return; }
    let nv = 0, ni = 0; for (const c of L) { const g = c.mesh.geometry; nv += g.attributes.position.count; ni += g.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Uint8Array(nv * 3), rm = new Uint8Array(nv * 2), tone = new Int8Array(nv * 2), ind = new Uint32Array(ni); let v = 0, i = 0;
    for (const c of L) { const g = c.mesh.geometry, A = g.attributes, I = g.index.array; pos.set(A.position.array, v * 3); nor.set(A.normal.array, v * 3); col.set(A.color.array, v * 3); rm.set(A.rm.array, v * 2); tone.set(A.tone.array, v * 2); for (let j = 0; j < I.length; j++) ind[i++] = I[j] + v; v += A.position.count; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true)); geo.setAttribute('rm', new THREE.BufferAttribute(rm, 2, true)); geo.setAttribute('tone', new THREE.BufferAttribute(tone, 2, true)); geo.setIndex(new THREE.BufferAttribute(ind, 1));
    const s = this.vs * C * 4; geo.boundingSphere = new THREE.Sphere(new V((cl.x + .5) * s, (cl.y + .5) * s, (cl.z + .5) * s), s * .91);
    if (cl.m) { cl.m.geometry.dispose(); cl.m.geometry = geo; cl.m.material = this.mat; } else { cl.m = new THREE.Mesh(geo, this.mat); cl.m.castShadow = cl.m.receiveShadow = true; cl.m.userData.part = true; this.group.add(cl.m); }
    cl.m.visible = true; for (const c of L) c.mesh.visible = false;
  }
  areaRec(spheres) {                            // everything solid inside the spheres you drew becomes a selection
    const seen = new Set(), G = [], D = [], K = [], R = [], snap = this.snap; this.snap = null;
    for (const [p, r] of spheres) this.each(p, r, false, (ch, i, gx, gy, gz) => { const d = ch.d[i], id = ch.k * C3 + i; if (d <= -.97 || seen.has(id)) return false; seen.add(id); G.push(gx, gy, gz); D.push(d); K.push(ch.col[i * 3], ch.col[i * 3 + 1], ch.col[i * 3 + 2]); R.push(ch.rm[i * 2], ch.rm[i * 2 + 1]); return false; });
    this.snap = snap; if (D.length < 30) return null;
    const g = Int32Array.from(G), box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let i = 0; i < g.length; i += 3) for (let a = 0; a < 3; a++) { if (g[i + a] < box[a]) box[a] = g[i + a]; if (g[i + a] > box[a + 3]) box[a + 3] = g[i + a]; }
    return { g, d: Float32Array.from(D), was: new Float32Array(D.length).fill(-1), col: Uint8Array.from(K), rm: Uint8Array.from(R), box, dead: false };
  }
  connected(p, r, limit = 3e5) {                // the separate lump of clay at this spot, as one object
    let seed = null, best = 1e9; const snap = this.snap; this.snap = null; this.each(p, r, false, (ch, i, gx, gy, gz, t) => { if (ch.d[i] > 0 && t < best) { best = t; seed = [gx, gy, gz]; } return false; }); this.snap = snap; if (!seed) return null;
    const K = 16384, O = 8192, id = (x, y, z) => ((x + O) * K + y + O) * K + z + O, seen = new Set([id(...seed)]), st = [...seed], L = [...seed], N = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
    while (st.length) { const z = st.pop(), y = st.pop(), x = st.pop(); for (let k = 0; k < 18; k += 3) { const a = x + N[k], b = y + N[k + 1], e = z + N[k + 2], n = id(a, b, e); if (seen.has(n)) continue; const d = this.get(a, b, e); if (d <= -.97) continue; seen.add(n); L.push(a, b, e); if (d > 0) st.push(a, b, e); if (L.length > limit * 3) return null; } }
    const m = L.length / 3, g = Int32Array.from(L), D = new Float32Array(m), col = new Uint8Array(m * 3), rm = new Uint8Array(m * 2), box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (let j = 0; j < m; j++) { const X = g[j * 3], Y = g[j * 3 + 1], Z = g[j * 3 + 2], cx = Math.floor(X / C), cy = Math.floor(Y / C), cz = Math.floor(Z / C), h = this.chunks.get(key(cx, cy, cz)), q = idx(X - cx * C, Y - cy * C, Z - cz * C); D[j] = h.d[q]; col[j * 3] = h.col[q * 3]; col[j * 3 + 1] = h.col[q * 3 + 1]; col[j * 3 + 2] = h.col[q * 3 + 2]; rm[j * 2] = h.rm[q * 2]; rm[j * 2 + 1] = h.rm[q * 2 + 1]; if (X < box[0]) box[0] = X; if (Y < box[1]) box[1] = Y; if (Z < box[2]) box[2] = Z; if (X > box[3]) box[3] = X; if (Y > box[4]) box[4] = Y; if (Z > box[5]) box[5] = Z; }
    return { g, d: D, was: new Float32Array(m).fill(-1), col, rm, box, dead: false };
  }
  recNear(s, p, r) { const iv = 1 / this.vs, x = p.x * iv, y = p.y * iv, z = p.z * iv, R = r * iv, R2 = R * R, b = s.box; if (x < b[0] - R || y < b[1] - R || z < b[2] - R || x > b[3] + R || y > b[4] + R || z > b[5] + R) return false; for (let k = 0; k < s.g.length; k += 3) { const e = s.g[k] - x, f = s.g[k + 1] - y, h = s.g[k + 2] - z; if (e * e + f * f + h * h < R2) return true; } return false; }
  stampShape(kind, c, q, h, color, ro, me) {    // box, cylinder or cone as clean solid form
    const v = this.vs, iw = 1 / (v * 3), m = new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()).elements, R = color.r * 255, G = color.g * 255, B = color.b * 255, RO = ro * 255, ME = me * 255, rr = h * .8;
    this.each(c, h * 1.75 + v * 4, true, (ch, i, gx, gy, gz) => {
      const wx = gx * v - c.x, wy = gy * v - c.y, wz = gz * v - c.z, x = m[0] * wx + m[4] * wy + m[8] * wz, y = m[1] * wx + m[5] * wy + m[9] * wz, z = m[2] * wx + m[6] * wy + m[10] * wz; let sd;
      if (kind === 'box') { const a = Math.abs(x) - h, b = Math.abs(y) - h, e = Math.abs(z) - h, A = Math.max(a, 0), B = Math.max(b, 0), E = Math.max(e, 0); sd = Math.sqrt(A * A + B * B + E * E) + Math.min(Math.max(a, b, e), 0); }
      else { const l = Math.sqrt(x * x + z * z), rad = kind === 'cone' ? rr * (h - y) / (2 * h) : rr, a = (l - rad) * (kind === 'cone' ? .85 : 1), b = Math.abs(y) - h, A = Math.max(a, 0), B = Math.max(b, 0); sd = Math.sqrt(A * A + B * B) + Math.min(Math.max(a, b), 0); }
      let sv = -sd * iw; sv = sv < -1 ? -1 : sv > 1 ? 1 : sv; if (sv <= ch.d[i]) return false; ch.d[i] = sv; const j = i * 3; ch.col[j] = R; ch.col[j + 1] = G; ch.col[j + 2] = B; ch.rm[i * 2] = RO; ch.rm[i * 2 + 1] = ME; return true;
    });
  }
  pick(p, r) {                                  // newest stroke with material at this spot
    const iv = 1 / this.vs, x = p.x * iv, y = p.y * iv, z = p.z * iv, R = r * iv, R2 = R * R;
    for (let j = this.recs.length - 1; j >= 0; j--) { const s = this.recs[j], b = s.box; if (s.dead || x < b[0] - R || y < b[1] - R || z < b[2] - R || x > b[3] + R || y > b[4] + R || z > b[5] + R) continue; for (let i = 0; i < s.d.length; i++) { if (s.d[i] <= 0) continue; const k = i * 3, e = s.g[k] - x, f = s.g[k + 1] - y, h = s.g[k + 2] - z; if (e * e + f * f + h * h < R2) return s; } }
    return null;
  }
  lift(s, cut) {                                // the stroke becomes its own little sculpt that rides on your hand
    const g = new HandClay({ id: 'ghost', type: 'sculpt', vs: this.vs, mat: this.rec.mat, tone: this.rec.tone }); g.floor = false; g.lod = this.lod; g.triBudget = 1e12; g.viewScale = this.viewScale; const touched = new Set();
    for (let i = 0; i < s.d.length; i++) {
      const k = i * 3, X = s.g[k], Y = s.g[k + 1], Z = s.g[k + 2], cx = Math.floor(X / C), cy = Math.floor(Y / C), cz = Math.floor(Z / C), n = idx(X - cx * C, Y - cy * C, Z - cz * C), h = g.chunk(cx, cy, cz, true); h.d[n] = s.d[i]; h.col[n * 3] = s.col[k]; h.col[n * 3 + 1] = s.col[k + 1]; h.col[n * 3 + 2] = s.col[k + 2]; h.rm[n * 2] = s.rm[i * 2]; h.rm[n * 2 + 1] = s.rm[i * 2 + 1]; touched.add(h);
      if (cut) { const m = this.chunk(cx, cy, cz, false); if (m && Math.abs(m.d[n] - s.d[i]) < .03) { this.snapshot(m); m.d[n] = s.was[i]; this.markDirty(cx, cy, cz); } }
    }
    for (const h of touched) g.markDirty(h.cx, h.cy, h.cz); if (cut) { s.dead = true; this.killed.push(s); } return g;
  }
  stamp(g, M) {                                 // put it down: every target voxel looks up where it came from, so turning leaves no holes
    const v = this.vs, iv = 1 / v, I = M.clone().invert().elements, p = new V(), touched = new Set(), S = C * v;
    for (const h of g.chunks.values()) {
      let a = [1e9, 1e9, 1e9], b = [-1e9, -1e9, -1e9]; for (let k = 0; k < 8; k++) { p.set((h.cx + (k & 1)) * S, (h.cy + (k >> 1 & 1)) * S, (h.cz + (k >> 2 & 1)) * S).applyMatrix4(M).multiplyScalar(iv); [p.x, p.y, p.z].forEach((q, n) => { a[n] = Math.min(a[n], q); b[n] = Math.max(b[n], q); }); }
      for (let Z = Math.floor(a[2]) - 1; Z <= b[2] + 1; Z++) for (let Y = Math.floor(a[1]) - 1; Y <= b[1] + 1; Y++) for (let X = Math.floor(a[0]) - 1; X <= b[0] + 1; X++) {
        const wx = X * v, wy = Y * v, wz = Z * v, qx = (I[0] * wx + I[4] * wy + I[8] * wz + I[12]) * iv, qy = (I[1] * wx + I[5] * wy + I[9] * wz + I[13]) * iv, qz = (I[2] * wx + I[6] * wy + I[10] * wz + I[14]) * iv, rx = Math.round(qx), ry = Math.round(qy), rz = Math.round(qz);
        if (Math.floor(rx / C) !== h.cx || Math.floor(ry / C) !== h.cy || Math.floor(rz / C) !== h.cz) continue; const n0 = idx(rx - h.cx * C, ry - h.cy * C, rz - h.cz * C), val = h.d[n0]; if (val <= -.97) continue;
        const cx = Math.floor(X / C), cy = Math.floor(Y / C), cz = Math.floor(Z / C), t = this.chunk(cx, cy, cz, true), n = idx(X - cx * C, Y - cy * C, Z - cz * C); if (val <= t.d[n]) continue;
        this.snapshot(t); t.d[n] = val; t.col[n * 3] = h.col[n0 * 3]; t.col[n * 3 + 1] = h.col[n0 * 3 + 1]; t.col[n * 3 + 2] = h.col[n0 * 3 + 2]; t.rm[n * 2] = h.rm[n0 * 2]; t.rm[n * 2 + 1] = h.rm[n0 * 2 + 1]; touched.add(t);
      }
    }
    for (const t of touched) this.markDirty(t.cx, t.cy, t.cz);
  }
  relod() { this._lodV = -1; }
  lodWant() {                                   // shrunk piece = its voxels are tiny on screen: draw every 2nd one and nobody can tell
    const sc = this.viewScale || 1, t = this.tris(); let s = 1; while (s < 4 && s * 2 * sc <= 1.05) s *= 2;
    const est = l => t * (this.lod / l) ** 2, cap = l => l < this.lod ? this.triBudget * .7 : this.triBudget; while (s < 4 && est(s) > cap(s)) s *= 2; return s;
  }
  dropChunk(ch) { ch.gone = true; this.rough.delete(ch); this.setMesh(ch, null); this.chunks.delete(ch.k); this.dirty.delete(ch); this._lc = null; }
  packChunk(k) {                                // a block that was emptied still has to reach viewers and the save file
    const c = super.packChunk(k); if (c) return c;
    return [Math.floor(k / 1048576) - 512, Math.floor(k / 1024) % 1024 - 512, k % 1024 - 512, new Uint8Array(C3 * 6)];
  }
  end() {
    const before = this.snap; this.snap = null; if (!before || !before.size) return null;
    const B = [], A = []; let bytes = 0; const G = [], D = [], W = [], K = [], R = [];
    for (const [k, s] of before) {
      const ch = this.chunks.get(k); if (!ch) continue;
      const nowEmpty = isEmpty(ch.d), wasEmpty = isEmpty(s.d), same = nowEmpty && wasEmpty || same3(ch, s), at = [ch.cx, ch.cy, ch.cz];
      if (!same) {
        if (!nowEmpty) for (let i = 0; i < C3; i++) { const a = ch.d[i], b = wasEmpty ? -1 : s.d[i]; if (a > b + .01 && a > -.97) { G.push(ch.cx * C + i % C, ch.cy * C + (i / C | 0) % C, ch.cz * C + (i / (C * C) | 0)); D.push(a); W.push(b); K.push(ch.col[i * 3], ch.col[i * 3 + 1], ch.col[i * 3 + 2]); R.push(ch.rm[i * 2], ch.rm[i * 2 + 1]); } }
        B.push([at, wasEmpty ? null : s]); A.push([at, nowEmpty ? null : { d: ch.d.slice(), col: ch.col.slice(), rm: ch.rm.slice() }]);
        bytes += (wasEmpty ? 0 : BYTES) + (nowEmpty ? 0 : BYTES);
      }
      if (nowEmpty) { this.dropChunk(ch); if (!same) { this.changed.add(k); (this.unsaved ||= new Set()).add(k); this._markMesh(ch.cx, ch.cy, ch.cz); } }
    }
    if (!B.length) return null;
    const apply = L => {
      for (const [[cx, cy, cz], s] of L) {
        if (!s) { const ch = this.chunk(cx, cy, cz, false); if (ch) this.dropChunk(ch); this.markDirty(cx, cy, cz); continue; }
        const ch = this.chunk(cx, cy, cz, true); ch.d.set(s.d); ch.col.set(s.col); ch.rm.set(s.rm); this.markDirty(cx, cy, cz);
      }
    };
    let rec = null; const killed = this.killed; this.killed = [];
    if (D.length > 40) {                         // every stroke stays a thing you can pick up again
      const g = Int32Array.from(G), box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (let i = 0; i < g.length; i += 3) for (let a = 0; a < 3; a++) { if (g[i + a] < box[a]) box[a] = g[i + a]; if (g[i + a] > box[a + 3]) box[a + 3] = g[i + a]; }
      rec = { g, d: Float32Array.from(D), was: Float32Array.from(W), col: Uint8Array.from(K), rm: Uint8Array.from(R), box, dead: false }; this.recs.push(rec); let n = 0; for (const r of this.recs) n += r.d.length; while (n > 25e5 && this.recs.length > 1) n -= this.recs.shift().d.length;
    }
    return { bytes, undo: () => { apply(B); if (rec) rec.dead = true; for (const r of killed) r.dead = false; }, redo: () => { apply(A); if (rec) rec.dead = false; for (const r of killed) r.dead = true; } };
  }
  block(ch) {
    const b = pool.pop() || { d: new Float32Array(N * NN), col: new Uint8Array(P * PP * 3), rm: new Uint8Array(P * PP * 2) }, { d, col, rm } = b;
    const R = [[-M, -1, C], [0, C - 1, 0], [C, C + M - 1, -C]];
    for (let az = -1; az <= 1; az++) for (let ay = -1; ay <= 1; ay++) for (let ax = -1; ax <= 1; ax++) {
      const n = this.chunks.get(key(ch.cx + ax, ch.cy + ay, ch.cz + az)), X = R[ax + 1], Y = R[ay + 1], Z = R[az + 1], len = X[1] - X[0] + 1;
      for (let z = Z[0]; z <= Z[1]; z++) for (let y = Y[0]; y <= Y[1]; y++) {
        const to = (X[0] + M) + N * (y + M) + NN * (z + M);
        if (!n) d.fill(-1, to, to + len); else { const s = idx(X[0] + X[2], y + Y[2], z + Z[2]); d.set(n.d.subarray(s, s + len), to); }
        if (n && z >= -1 && z <= C && y >= -1 && y <= C) {
          const x0 = Math.max(X[0], -1), x1 = Math.min(X[1], C), l = x1 - x0 + 1; if (l <= 0) continue;
          const pi = (x0 + 1) + P * (y + 1) + PP * (z + 1), s = idx(x0 + X[2], y + Y[2], z + Z[2]);
          col.set(n.col.subarray(s * 3, (s + l) * 3), pi * 3); rm.set(n.rm.subarray(s * 2, (s + l) * 2), pi * 2);
        }
      }
    }
    if (this.floor) { const oy = ch.cy * C; if (oy - M < 0) for (let y = -M; y < C + M && oy + y < 0; y++) for (let z = 0; z < N; z++) { const a = N * (y + M) + NN * z; d.fill(-1, a, a + N); } }   // nothing grows through the table
    return b;
  }
  update(budget = 3) {
    this.mergeStep();
    if (!this.dirty.size && !this.flying) {
      if (this._lodV !== this.meshVer) { this._lodV = this.meshVer; const l = this.lodWant(); if (l !== this.lod) { this.lod = l; this.rough.clear(); for (const ch of this.chunks.values()) if (ch.mesh) this.dirty.add(ch); } }
      if (!this.dirty.size && !this.busy && this.rough.size) { for (const ch of this.rough) if (!ch.gone) this.dirty.add(ch); this.rough.clear(); }
    }
    if (!this.dirty.size) return 0;
    const W = getWorkers(), maxFly = W.length * 3, t0 = performance.now(), f = this.focus, v = this.vs * C;
    while (this.flying < maxFly && performance.now() - t0 < budget) {
      let best = null, bd = 1e9;
      for (const ch of this.dirty) { if (ch.fly) continue; const dx = (ch.cx + .5) * v - f.x, dy = (ch.cy + .5) * v - f.y, dz = (ch.cz + .5) * v - f.z, q = dx * dx + dy * dy + dz * dz; if (q < bd) { bd = q; best = ch; } }
      if (!best) break;
      const ch = best; this.dirty.delete(ch); ch.fly = true; this.flying++;
      const b = this.block(ch), k = jobId++, fine = this.busy ? 0 : 1; if (fine) this.rough.delete(ch); else this.rough.add(ch);
      owners.set(k, g => { ch.fly = false; this.flying--; if (!this.dead) this.applyMesh(ch, g); });
      W[nextW++ % W.length].postMessage({ k, d: b.d, col: b.col, rm: b.rm, ox: ch.cx * C, oy: ch.cy * C, oz: ch.cz * C, v: this.vs, s: this.lod, q: fine }, [b.d.buffer, b.col.buffer, b.rm.buffer]);
    }
    return this.dirty.size;
  }
  applyMesh(ch, g) {
    if (ch.gone) return;
    this.meshVer++;
    if (!g) { this.setMesh(ch, null); return; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(g.nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(g.col, 3, true)); geo.setAttribute('rm', new THREE.BufferAttribute(g.rm, 2, true)); geo.setAttribute('tone', new THREE.BufferAttribute(g.tone, 2, true));
    geo.setIndex(new THREE.BufferAttribute(g.ind, 1));
    const s = this.vs * C; geo.boundingSphere = new THREE.Sphere(new V((ch.cx + .5) * s, (ch.cy + .5) * s, (ch.cz + .5) * s), s * 1.05);
    this.setMesh(ch, geo);
  }
  dispose() { this.dead = true; for (const cl of this.clusters.values()) this.freeCluster(cl); for (const ch of this.chunks.values()) if (ch.mesh) ch.mesh.geometry.dispose(); this.mat.dispose(); }
  // ---------------------------------------------------------------- reads
  near(p, r) {
    const v = this.vs, g = (x, y, z) => this.get(Math.round(x / v), Math.round(y / v), Math.round(z / v));
    if (g(p.x, p.y, p.z) > -.99) return true;
    for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) if (g(p.x + a * r, p.y + b * r, p.z + c * r) > -.99) return true;
    return false;
  }
  normalAt(p, out = new V()) {
    const v = this.vs, x = p.x / v, y = p.y / v, z = p.z / v, s = 2, g = (a, b, c) => this.get(Math.round(x + a), Math.round(y + b), Math.round(z + c));
    out.set(g(-s, 0, 0) - g(s, 0, 0), g(0, -s, 0) - g(0, s, 0), g(0, 0, -s) - g(0, 0, s)); if (out.lengthSq() < 1e-6) out.set(0, 1, 0); return out.normalize();
  }
  // first solid point along a ray (local space): the mouse / touch cursor, no meshes needed
  rayHit(o, d, max = 3) {
    const s = this.vs * .8, iv = 1 / this.vs; let was = -1;
    for (let t = 0; t < max; t += s) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; 
      const q = this.get(Math.round(x * iv), Math.round(y * iv), Math.round(z * iv));
      if (q > 0) { const k = t - s * q / Math.max(1e-3, q - was); return new V(o.x + d.x * k, o.y + d.y * k, o.z + d.z * k); }
      was = q;
    }
    return null;
  }
  // ---------------------------------------------------------------- brushes that must stay cheap on a headset CPU
  paintFast(p, r, c, ro, me, a) {
    const R = c.r * 255, G = c.g * 255, B = c.b * 255, RO = ro * 255, ME = me * 255;
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => {
      const d = ch.d[i]; if (d < -.97 || d > .985) return false;
      const k = ss(1 - t) * a; if (k <= .002) return false;
      const q = ch.col, j = i * 3; q[j] += (R - q[j]) * k; q[j + 1] += (G - q[j + 1]) * k; q[j + 2] += (B - q[j + 2]) * k;
      const m = ch.rm; m[i * 2] += (RO - m[i * 2]) * k; m[i * 2 + 1] += (ME - m[i * 2 + 1]) * k; return true;
    }, 1);
  }
  press(p, r, n, pp, k) {                       // n = out of the back of the hand: nothing stays on that side of the palm
    const v = this.vs, iw = 1 / (v * 3);
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => {
      let target = -((gx * v - pp.x) * n.x + (gy * v - pp.y) * n.y + (gz * v - pp.z) * n.z) * iw; target = target < -1 ? -1 : target > 1 ? 1 : target; const d = ch.d[i]; if (d <= target) return false;
      ch.d[i] = d + (target - d) * ss(1 - t) * k; return true;
    });
  }
  // pull: every voxel near the hand follows it for this frame's step (reads the current field, so long pulls stay cheap); paint travels along
  grabStep(p, dl, r) {
    const v = this.vs, iv = 1 / v, dx = dl.x * iv, dy = dl.y * iv, dz = dl.z * iv, px = p.x * iv, py = p.y * iv, pz = p.z * iv, iR = v / r, L = dl.length(), c = new V().copy(p).add(dl), up = [];
    const l = (s, t, u) => s + (t - s) * u;
    const tri = (x, y, z) => { const a = Math.floor(x), b = Math.floor(y), e = Math.floor(z), f = x - a, g = y - b, h = z - e, q = (i, j, k) => this.get(a + i, b + j, e + k); return l(l(l(q(0, 0, 0), q(1, 0, 0), f), l(q(0, 1, 0), q(1, 1, 0), f), g), l(l(q(0, 0, 1), q(1, 0, 1), f), l(q(0, 1, 1), q(1, 1, 1), f), g), h); };
    this.each(c, r + L, this.near(p, r), (ch, i, gx, gy, gz) => {   // pulling thin air creates nothing
      const e = gx - dx - px, f = gy - dy - py, g = gz - dz - pz, w = ss(1 - Math.sqrt(e * e + f * f + g * g) * iR); if (w <= 0) return false;
      const X = gx - dx * w, Y = gy - dy * w, Z = gz - dz * w; up.push(ch, i, tri(X, Y, Z), this.colAt(X, Y, Z)); return false;
    });
    const touched = new Set();
    for (let j = 0; j < up.length; j += 4) {
      const ch = up[j], i = up[j + 1], was = ch.d[i], nw = up[j + 2], s = up[j + 3]; ch.d[i] = nw;
      if (s && nw > -.9) { const q = i * 3, a = s[0], b = s[1]; ch.col[q] = s[2]; ch.col[q + 1] = s[3]; ch.col[q + 2] = s[4]; ch.rm[i * 2] = a; ch.rm[i * 2 + 1] = b; }
      if (was !== nw) touched.add(ch);
    }
    for (const ch of touched) this.markDirty(ch.cx, ch.cy, ch.cz);
  }
  colAt(x, y, z) {   // value copy: the source voxel may be overwritten in the same step
    const X = Math.round(x), Y = Math.round(y), Z = Math.round(z), cx = Math.floor(X / C), cy = Math.floor(Y / C), cz = Math.floor(Z / C), n = this.chunks.get(key(cx, cy, cz)); if (!n) return null;
    const i = idx(X - cx * C, Y - cy * C, Z - cz * C); if (n.d[i] <= -.97) return null;
    return [n.rm[i * 2], n.rm[i * 2 + 1], n.col[i * 3], n.col[i * 3 + 1], n.col[i * 3 + 2]];
  }
}
