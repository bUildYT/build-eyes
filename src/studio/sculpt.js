// bUild sTudio · SCULPT ENGINE (the Modeler core): a sparse voxel field, chunked, meshed with surface nets.
//  density d per voxel in [-1, 1], > 0 = inside. Band = 3 voxels → smooth, crisp surfaces at any scale.
//  per voxel also: colour (RGB) + roughness/metal = the Painter layer (smart materials bake into it).
//  brushes: clay (union) · carve · smooth · flatten · grab · inflate · paint · fill — mirror + undo handled by the studio.
import * as THREE from 'three';
import { MATS, sculptMaterial, toneCPU, natVec } from './materials.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export const C = 24;                      // voxels per chunk side
const C3 = C * C * C, BAND = 3;
const idx = (x, y, z) => x + C * (y + C * z);
const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);     // numeric keys: fast Map lookups
const unkey = k => [Math.floor(k / 1048576) - 512, Math.floor(k / 1024) % 1024 - 512, k % 1024 - 512];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth01 = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
// cheap 3D value noise for smart-material breakup
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), L(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
           L(L(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), L(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w);
}
// worley cells (scales / pebbles): distance to the nearest random point
function worley(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); let d1 = 9, d2 = 9;
  for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const X = xi + a, Y = yi + b, Z = zi + c, px = X + h3(X, Y, Z), py = Y + h3(Y + 7, Z, X), pz = Z + h3(Z + 3, X, Y), d = Math.hypot(px - x, py - y, pz - z);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [d1, d2];
}
const fbm = (x, y, z) => vnoise(x, y, z) * .6 + vnoise(x * 2.1, y * 2.1, z * 2.1) * .3 + vnoise(x * 4.3, y * 4.3, z * 4.3) * .1;

// 18 directions (faces + edges of a cube) for the smart-tone rings
const TD = []; for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const n = Math.abs(x) + Math.abs(y) + Math.abs(z); if (n === 1 || n === 2) { const l = Math.hypot(x, y, z); TD.push(x / l, y / l, z / l); } }
const TDN = TD.length / 3;
const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]];
const OCC = []; for (let z = -4; z <= 4; z++) for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) { const r = Math.hypot(x, y, z); if (r <= 4.2 && r > 0 && (x + y + z) % 2 === 0) OCC.push([x, y, z]); }
export class Sculpt {
  constructor(rec) {
    this.rec = rec; this.vs = rec.vs;
    this.group = new THREE.Group(); this.group.userData.sculpt = this;
    this.mat = sculptMaterial(rec.mat || 'clay', rec.tone || 'reptile', rec.skin);
    this.chunks = new Map(); this.dirty = new Set(); this.changed = new Set();   // changed = chunk keys whose DATA changed (→ live sync)
    if (rec.data) this.load(rec.data);
  }
  // ---------------------------------------------------------------- storage
  chunk(cx, cy, cz, create) {
    const k = key(cx, cy, cz); let ch = this.chunks.get(k);
    if (!ch && create) {
      ch = { cx, cy, cz, k, d: new Float32Array(C3).fill(-1), col: new Uint8Array(C3 * 3).fill(200), rm: new Uint8Array(C3 * 2), mesh: null };
      for (let i = 0; i < C3; i++) { ch.rm[i * 2] = 185; ch.rm[i * 2 + 1] = 0; }
      this.chunks.set(k, ch); this._lc = null;
    }
    return ch;
  }
  get(gx, gy, gz) {
    const cx = Math.floor(gx / C), cy = Math.floor(gy / C), cz = Math.floor(gz / C), k = key(cx, cy, cz);
    let ch = this._lc; if (!ch || this._lk !== k) { ch = this.chunks.get(k); this._lc = ch; this._lk = k; }   // one-chunk cache
    return ch ? ch.d[idx(gx - cx * C, gy - cy * C, gz - cz * C)] : -1;
  }
  solidAt(p) { const v = this.vs; return this.get(Math.round(p.x / v), Math.round(p.y / v), Math.round(p.z / v)) > 0; }
  empty() { for (const ch of this.chunks.values()) for (let i = 0; i < C3; i++) if (ch.d[i] > 0) return false; return true; }
  // visit every voxel in a sphere (local metres): fn(ch, i, gx, gy, gz, t = dist/r)
  each(p, r, create, fn, pad = 0) {
    const v = this.vs, R = r / v + pad, gx0 = Math.floor(p.x / v - R), gx1 = Math.ceil(p.x / v + R), gy0 = Math.floor(p.y / v - R), gy1 = Math.ceil(p.y / v + R), gz0 = Math.floor(p.z / v - R), gz1 = Math.ceil(p.z / v + R);
    const px = p.x / v, py = p.y / v, pz = p.z / v, iR = v / r, tMax = 1 + pad * v / r;
    for (let cz = Math.floor(gz0 / C); cz <= Math.floor(gz1 / C); cz++) for (let cy = Math.floor(gy0 / C); cy <= Math.floor(gy1 / C); cy++) for (let cx = Math.floor(gx0 / C); cx <= Math.floor(gx1 / C); cx++) {
      const ch = this.chunk(cx, cy, cz, create); if (!ch) continue;
      if (this.snap) this.snapshot(ch);          // copy BEFORE the brush touches it (undo)
      let touched = false;
      const x0 = Math.max(gx0, cx * C), x1 = Math.min(gx1, cx * C + C - 1), y0 = Math.max(gy0, cy * C), y1 = Math.min(gy1, cy * C + C - 1), z0 = Math.max(gz0, cz * C), z1 = Math.min(gz1, cz * C + C - 1);
      for (let gz = z0; gz <= z1; gz++) for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const ex = gx - px, ey = gy - py, ez = gz - pz, t = Math.sqrt(ex * ex + ey * ey + ez * ez) * iR; if (t > tMax) continue;
        if (fn(ch, idx(gx - cx * C, gy - cy * C, gz - cz * C), gx, gy, gz, t) !== false) touched = true;
      }
      if (touched) this.markDirty(cx, cy, cz);
    }
  }
  markDirty(cx, cy, cz) { this.changed.add(key(cx, cy, cz)); this.ver = (this.ver || 0) + 1; this._markMesh(cx, cy, cz); }
  _markMesh(cx, cy, cz) { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const ch = this.chunks.get(key(cx + a, cy + b, cz + c)); if (ch) this.dirty.add(ch); } }
  // ---------------------------------------------------------------- undo: copy chunks the first time a stroke touches them
  begin() { this.snap = new Map(); }
  snapshot(ch) { if (this.snap && !this.snap.has(ch.k)) this.snap.set(ch.k, { d: ch.d.slice(), col: ch.col.slice(), rm: ch.rm.slice(), existed: true }); }
  end() {
    const before = this.snap; this.snap = null; if (!before || !before.size) return null;
    const after = new Map(); for (const k of before.keys()) { const ch = this.chunks.get(k); after.set(k, { d: ch.d.slice(), col: ch.col.slice(), rm: ch.rm.slice() }); }
    const apply = m => { for (const [k, s] of m) { const [cx, cy, cz] = unkey(k), ch = this.chunk(cx, cy, cz, true); ch.d.set(s.d); ch.col.set(s.col); ch.rm.set(s.rm); this.markDirty(cx, cy, cz); } };
    return { undo: () => apply(before), redo: () => apply(after) };
  }
  // pre-stroke value (grab samples the shape as it was when you grabbed it)
  orig(gx, gy, gz) {
    const cx = Math.floor(gx / C), cy = Math.floor(gy / C), cz = Math.floor(gz / C), k = key(cx, cy, cz);
    const s = this.snap && this.snap.get(k); if (s) return s.d[idx(gx - cx * C, gy - cy * C, gz - cz * C)];
    return this.get(gx, gy, gz);
  }
  origTri(x, y, z) {   // trilinear
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0, o = (a, b, c) => this.orig(x0 + a, y0 + b, z0 + c);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(o(0, 0, 0), o(1, 0, 0), fx), l(o(0, 1, 0), o(1, 1, 0), fx), fy), l(l(o(0, 0, 1), o(1, 0, 1), fx), l(o(0, 1, 1), o(1, 1, 1), fx), fy), fz);
  }

  // a voxel that just turned solid takes the paint of a solid neighbour (no grey specks after inflate / texture / smooth / grab)
  inheritI(ch, i) { const z = Math.floor(i / (C * C)), y = Math.floor(i / C) % C, x = i % C; this.inherit(ch, i, ch.cx * C + x, ch.cy * C + y, ch.cz * C + z); }
  inherit(ch, i, gx, gy, gz) {
    for (const [a, b, c] of NB6) {
      const X = gx + a, Y = gy + b, Z = gz + c, cx = Math.floor(X / C), cy = Math.floor(Y / C), cz = Math.floor(Z / C), n = this.chunks.get(key(cx, cy, cz)); if (!n) continue;
      const j = idx(X - cx * C, Y - cy * C, Z - cz * C); if (n.d[j] <= 0) continue;
      ch.col[i * 3] = n.col[j * 3]; ch.col[i * 3 + 1] = n.col[j * 3 + 1]; ch.col[i * 3 + 2] = n.col[j * 3 + 2]; ch.rm[i * 2] = n.rm[j * 2]; ch.rm[i * 2 + 1] = n.rm[j * 2 + 1]; return;
    }
  }
  // ---------------------------------------------------------------- brushes (p, r in local metres)
  setPaint(ch, i, col, rough, metal, a) {
    const c = ch.col, j = i * 3; c[j] += (col.r * 255 - c[j]) * a; c[j + 1] += (col.g * 255 - c[j + 1]) * a; c[j + 2] += (col.b * 255 - c[j + 2]) * a;
    ch.rm[i * 2] += (rough * 255 - ch.rm[i * 2]) * a; ch.rm[i * 2 + 1] += (metal * 255 - ch.rm[i * 2 + 1]) * a;
  }
  add(p, r, color, matKey) {
    const w = BAND, col = new THREE.Color(color), M = MATS[matKey] || MATS.clay, base = M.base ? new THREE.Color(M.base) : col;
    this.each(p, r, true, (ch, i, gx, gy, gz, t) => {
      const s = clamp((1 - t) * r / this.vs / w, -1, 1);
      if (s > ch.d[i]) { if (ch.d[i] < .2) this.setPaint(ch, i, base, M.rough, M.metal, 1); ch.d[i] = s; return true; }
      return false;
    }, w);
  }
  // a capsule from a to b (radius ra → rb): smooth strokes instead of a chain of beads
  segment(a, b, ra, rb, sub, color, matKey) {
    const v = this.vs, w = BAND, M = MATS[matKey] || MATS.clay, base = sub ? null : (M.base ? new THREE.Color(M.base) : new THREE.Color(color));
    const ab = b.clone().sub(a), L2 = ab.lengthSq() || 1e-12, mid = a.clone().add(b).multiplyScalar(.5), R = Math.max(ra, rb) + ab.length() / 2;
    const ax = a.x, ay = a.y, az = a.z, bx = ab.x, by = ab.y, bz = ab.z, iw = 1 / (v * w);
    this.each(mid, R, !sub, (ch, i, gx, gy, gz) => {
      const px = gx * v - ax, py = gy * v - ay, pz = gz * v - az;          // plain numbers: no garbage per voxel (Quest CPU)
      let t = (px * bx + py * by + pz * bz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - bx * t, qy = py - by * t, qz = pz - bz * t, d = Math.sqrt(qx * qx + qy * qy + qz * qz), r = ra + (rb - ra) * t;
      const sv = clamp((r - d) * iw, -1, 1);
      if (sub) { if (-sv < ch.d[i]) { ch.d[i] = -sv; return true; } return false; }
      if (sv > ch.d[i]) { if (ch.d[i] < .2) this.setPaint(ch, i, base, M.rough, M.metal, 1); ch.d[i] = sv; return true; }
      return false;
    }, w);
  }
  carve(p, r) {
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => { const s = -clamp((1 - t) * r / this.vs / BAND, -1, 1); if (s < ch.d[i]) { ch.d[i] = s; return true; } return false; }, BAND);
  }
  inflate(p, r, k) {     // grow / shrink the surface where you brush (Substance "inflate")
    this.each(p, r, k > 0, (ch, i, gx, gy, gz, t) => { const f = smooth01(1 - t) * k; if (!f) return false; const was = ch.d[i]; ch.d[i] = clamp(was + f, -1, 1); if (was <= -.6 && ch.d[i] > -.6) this.inherit(ch, i, gx, gy, gz); return true; });
  }
  smooth(p, r, k) {
    const upd = [];
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => {
      const d = ch.d[i]; if (d > .99 || d < -.99) { const a = this.get(gx + 1, gy, gz), b = this.get(gx - 1, gy, gz); if (Math.abs(a - d) < 1e-3 && Math.abs(b - d) < 1e-3) return false; }
      let s = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) s += this.get(gx + a, gy + b, gz + c);
      upd.push(ch, i, d + (s / 27 - d) * k * smooth01(1 - t)); return false;
    });
    for (let j = 0; j < upd.length; j += 3) { const ch = upd[j], i = upd[j + 1]; if (this.snap) this.snapshot(ch); const was = ch.d[i]; ch.d[i] = upd[j + 2]; if (was <= -.6 && ch.d[i] > -.6) this.inheritI(ch, i); this.markDirty(ch.cx, ch.cy, ch.cz); }
  }
  // surface detail: rock grain, dragon scales, skin wrinkles — pushed in and out of the surface you brush
  texture(p, r, k, pattern = 'rock') {
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => {
      const d = ch.d[i]; if (d < -.97 || d > .97) return false;
      const f = smooth01(1 - t) * k; if (!f) return false;
      let n;
      if (pattern === 'scales') { const [d1, d2] = worley(gx * .22, gy * .22, gz * .22); n = Math.min(1, (d2 - d1) * 2.2) - .55; }
      else if (pattern === 'wrinkle') n = Math.abs(fbm(gx * .25, gy * .9, gz * .25) - .5) * -2.4 + .3;
      else n = (fbm(gx * .3, gy * .3, gz * .3) - .5) * 1.6 + (h3(gx, gy, gz) - .5) * .25;
      ch.d[i] = clamp(d + f * n, -1, 1); if (d <= -.6 && ch.d[i] > -.6) this.inherit(ch, i, gx, gy, gz); return true;
    });
  }
  flatten(p, r, n, pp, k) {   // pull the surface onto the plane (pp, n) — n points out of the material
    const v = this.vs;
    this.each(p, r, true, (ch, i, gx, gy, gz, t) => {
      const dist = (gx * v - pp.x) * n.x + (gy * v - pp.y) * n.y + (gz * v - pp.z) * n.z, target = clamp(-dist / v / BAND, -1, 1);
      const f = smooth01(1 - t) * k; if (!f) return false; ch.d[i] += (target - ch.d[i]) * f; return true;
    });
  }
  grab(p0, delta, r) {        // drag the material: every voxel pulls from where it was, weighted by distance to the grab point
    const v = this.vs, dv = delta.clone().multiplyScalar(1 / v), c = p0.clone().add(delta), R = r / v;
    const upd = [];
    this.each(c, r + delta.length(), true, (ch, i, gx, gy, gz) => {
      const sx = gx - dv.x, sy = gy - dv.y, sz = gz - dv.z, t = Math.hypot(sx - p0.x / v, sy - p0.y / v, sz - p0.z / v) / R, w = smooth01(1 - t);
      const val = this.origTri(gx - dv.x * w, gy - dv.y * w, gz - dv.z * w);
      upd.push(ch, i, val); return false;
    });
    for (let j = 0; j < upd.length; j += 3) { const ch = upd[j], i = upd[j + 1]; if (this.snap) this.snapshot(ch); const was = ch.d[i]; ch.d[i] = upd[j + 2]; if (was <= -.6 && ch.d[i] > -.6) this.inheritI(ch, i); this.markDirty(ch.cx, ch.cy, ch.cz); }
  }
  // Painter: colour + rough/metal on the surface voxels; smart materials read the shape (edges, cavities) + noise
  paint(p, r, color, matKey, strength = .6, mask = 'all') {
    const M = MATS[matKey] || MATS.clay, col = new THREE.Color(color);
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => {
      if (ch.d[i] < -.95 || ch.d[i] > .99) return false;
      let a = smooth01(1 - t) * strength; if (a <= 0) return false;
      if (mask !== 'all') { const k = this.curvature(gx, gy, gz); a *= mask === 'edges' ? smooth01((k - .05) / .08) : smooth01((-k - .015) / .07); if (a <= .01) return false; }   // generators: only edges / only cavities
      const [c, ro, me] = this.smartAt(M, col, gx, gy, gz); this.setPaint(ch, i, c, ro, me, a); return true;
    }, 1);
  }
  fill(color, matKey) {
    const M = MATS[matKey] || MATS.clay, col = new THREE.Color(color);
    if (this.snap) for (const ch of this.chunks.values()) this.snapshot(ch);
    for (const ch of this.chunks.values()) {
      for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
        const i = idx(x, y, z); if (ch.d[i] < -.95) continue;
        const [c, ro, me] = this.smartAt(M, col, ch.cx * C + x, ch.cy * C + y, ch.cz * C + z); this.setPaint(ch, i, c, ro, me, 1);
      }
      this.dirty.add(ch); this.changed.add(ch.k); this.ver = (this.ver || 0) + 1;
    }
    if (this.rec.mat !== matKey) { this.rec.mat = matKey; this._remat(); }
  }
  // + = convex edge, − = cavity: how much of a small ball around the point is solid (flat wall = half)
  curvature(gx, gy, gz) {
    let s = 0; for (const [a, b, c] of OCC) s += this.get(gx + a, gy + b, gz + c) * .5 + .5;   // continuous: no voxel stairs
    // a voxel that sits h voxels inside a flat wall already sees more than half solid: take that out (ball radius 4.2)
    const R = 4.2, h = clamp(this.get(gx, gy, gz), -1, 1) * BAND, flat = .5 + (3 * h) / (4 * R) - h * h * h / (4 * R * R * R);
    return flat - s / OCC.length;
  }
  smartAt(M, col, gx, gy, gz) {
    const base = M.base ? new THREE.Color(M.base) : col.clone();
    if (M.tint) base.lerp(new THREE.Color(M.tint), .35);
    if (!M.smart) return [base, M.rough, M.metal];
    const S = M.smart, k = this.curvature(gx, gy, gz), n = fbm(gx * .18, gy * .18, gz * .18), n2 = fbm(gx * .07 + 9, gy * .07, gz * .07);
    let c = base, ro = M.rough, me = M.metal;
    const edge = smooth01((k - .085) / .075) * smooth01((n - (1 - S.noise) * .45) / .25);
    const cav = smooth01((-k - .025) / .09) * (.55 + .45 * n);
    if (S.blotch) { const b = smooth01((n2 - .55) / .15); c = c.clone().lerp(new THREE.Color(S.blotch[0]), b); ro += (S.blotch[1] - ro) * b; me += (S.blotch[2] - me) * b; }
    if (edge > 0) { c = c.clone().lerp(new THREE.Color(S.edge[0]), edge); ro += (S.edge[1] - ro) * edge; me += (S.edge[2] - me) * edge; }
    if (cav > 0) { c = c.clone().lerp(new THREE.Color(S.cav[0]), cav); ro += (S.cav[1] - ro) * cav; me += (S.cav[2] - me) * cav; }
    c = c.clone().multiplyScalar(.92 + .16 * n);      // a little life in every surface
    return [c, clamp(ro, 0, 1), clamp(me, 0, 1)];
  }

  // ---------------------------------------------------------------- surface nets mesher (one chunk)
  remesh(ch) {
    const P = C + 2, pd = new Float32Array(P * P * P), pc = new Uint8Array(P * P * P * 3), pr = new Uint8Array(P * P * P * 2);
    const nb = []; for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) nb.push(this.chunks.get(key(ch.cx + a, ch.cy + b, ch.cz + c)));
    let any = false, anyIn = false;
    for (let z = -1; z <= C; z++) for (let y = -1; y <= C; y++) for (let x = -1; x <= C; x++) {
      const ax = x < 0 ? -1 : x >= C ? 1 : 0, ay = y < 0 ? -1 : y >= C ? 1 : 0, az = z < 0 ? -1 : z >= C ? 1 : 0, src = nb[(ax + 1) + 3 * (ay + 1) + 9 * (az + 1)];
      const pi = (x + 1) + P * ((y + 1) + P * (z + 1));
      if (!src) { pd[pi] = -1; continue; }
      const i = idx(x - ax * C, y - ay * C, z - az * C), d = src.d[i]; pd[pi] = d;
      if (d > 0) anyIn = true; else any = true;
      pc[pi * 3] = src.col[i * 3]; pc[pi * 3 + 1] = src.col[i * 3 + 1]; pc[pi * 3 + 2] = src.col[i * 3 + 2]; pr[pi * 2] = src.rm[i * 2]; pr[pi * 2 + 1] = src.rm[i * 2 + 1];
    }
    if (!anyIn || !any) { this.setMesh(ch, null); return; }
    const v = this.vs, ox = ch.cx * C, oy = ch.cy * C, oz = ch.cz * C;
    const cellV = new Int32Array(P * P * P).fill(-1);
    const pos = [], nor = [], col = [], rmA = [], ind = [], ton = [];
    const occ = (x, y, z) => { const d = this.get(Math.round(x), Math.round(y), Math.round(z)); return d > 1 ? 1 : d < -1 ? 0 : d * .5 + .5; };
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const cv = new Float32Array(8), ci = new Int32Array(8);
    // one vertex per cell that the surface crosses (cells -1..C-1 → padded 0..C)
    for (let z = 0; z <= C; z++) for (let y = 0; y <= C; y++) for (let x = 0; x <= C; x++) {
      let mask = 0;
      for (let k = 0; k < 8; k++) { const pi = (x + CO[k][0]) + P * ((y + CO[k][1]) + P * (z + CO[k][2])); ci[k] = pi; cv[k] = pd[pi]; if (cv[k] > 0) mask |= 1 << k; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of E) {
        const va = cv[a], vb = cv[b]; if ((va > 0) === (vb > 0)) continue;
        const t = va / (va - vb); sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++;
      }
      sx /= n; sy /= n; sz /= n;
      // gradient (points into the material) → the normal points out
      const gx = (cv[1] - cv[0]) + (cv[3] - cv[2]) + (cv[5] - cv[4]) + (cv[7] - cv[6]);
      const gy = (cv[2] - cv[0]) + (cv[3] - cv[1]) + (cv[6] - cv[4]) + (cv[7] - cv[5]);
      const gz = (cv[4] - cv[0]) + (cv[5] - cv[1]) + (cv[6] - cv[2]) + (cv[7] - cv[3]);
      const gl = Math.hypot(gx, gy, gz) || 1;
      cellV[x + P * (y + P * z)] = pos.length / 3;
      pos.push((ox + x - 1 + sx) * v, (oy + y - 1 + sy) * v, (oz + z - 1 + sz) * v); nor.push(-gx / gl, -gy / gl, -gz / gl);
      // colour: weighted by how deep inside each corner is
      let w = 0, r = 0, g = 0, bl = 0, ro = 0, me = 0;
      for (let k = 0; k < 8; k++) { const wk = 1.02 - Math.abs(cv[k]); if (wk <= 0) continue; const q = wk * wk; /* the voxels AT the surface carry the paint */ w += q; r += pc[ci[k] * 3] * q; g += pc[ci[k] * 3 + 1] * q; bl += pc[ci[k] * 3 + 2] * q; ro += pr[ci[k] * 2] * q; me += pr[ci[k] * 2 + 1] * q; }
      w = w * 255 || 1; col.push(r / w, g / w, bl / w); rmA.push(ro / w, me / w);
      { const vx = ox + x - 1 + sx, vy = oy + y - 1 + sy, vz = oz + z - 1 + sz; let f = 0, wd = 0;
        for (let k = 0; k < TD.length; k += 3) { f += occ(vx + TD[k] * 2.2, vy + TD[k + 1] * 2.2, vz + TD[k + 2] * 2.2); wd += occ(vx + TD[k] * 5.5, vy + TD[k + 1] * 5.5, vz + TD[k + 2] * 5.5); }
        ton.push((f / TDN - .5) * 2, (wd / TDN - .5) * 2); }
    }
    // quads: every voxel edge (owned by this chunk) where the sign flips
    const cell = (x, y, z) => cellV[(x + 1) + P * ((y + 1) + P * (z + 1))];
    const D = (x, y, z) => pd[(x + 1) + P * ((y + 1) + P * (z + 1))];
    for (let z = 0; z < C; z++) for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const d0 = D(x, y, z), in0 = d0 > 0;
      // x edge: cells around it lie in (y, z)
      if (in0 !== (D(x + 1, y, z) > 0)) quad(cell(x, y - 1, z - 1), cell(x, y, z - 1), cell(x, y, z), cell(x, y - 1, z), in0);
      if (in0 !== (D(x, y + 1, z) > 0)) quad(cell(x - 1, y, z - 1), cell(x - 1, y, z), cell(x, y, z), cell(x, y, z - 1), in0);
      if (in0 !== (D(x, y, z + 1) > 0)) quad(cell(x - 1, y - 1, z), cell(x, y - 1, z), cell(x, y, z), cell(x - 1, y, z), in0);
    }
    function quad(a, b, c, d, flip) {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) ind.push(a, b, c, a, c, d); else ind.push(a, c, b, a, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setAttribute('rm', new THREE.Float32BufferAttribute(rmA, 2)); geo.setAttribute('tone', new THREE.Float32BufferAttribute(ton, 2));
    geo.setIndex(ind); geo.computeBoundingSphere(); geo.computeBoundingBox();
    this.setMesh(ch, geo);
  }
  setMesh(ch, geo) {
    if (ch.mesh) { ch.mesh.geometry.dispose(); if (!geo) { this.group.remove(ch.mesh); ch.mesh = null; } }
    if (!geo) return;
    if (!ch.mesh) { ch.mesh = new THREE.Mesh(geo, this.mat); ch.mesh.castShadow = ch.mesh.receiveShadow = true; ch.mesh.userData.part = true; this.group.add(ch.mesh); }
    else ch.mesh.geometry = geo;
  }
  // remesh dirty chunks within a time budget (ms)
  update(budget = 6) {
    const t0 = performance.now();
    for (const ch of this.dirty) { this.dirty.delete(ch); this.remesh(ch); if (performance.now() - t0 > budget) break; }
    return this.dirty.size;
  }
  flush() { while (this.dirty.size) this.update(1e9); }
  tris() { let n = 0; for (const ch of this.chunks.values()) if (ch.mesh) n += ch.mesh.geometry.index.count / 3; return n; }

  // ---------------------------------------------------------------- save / load (only chunks with something in them)
  save() {
    const out = [];
    const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
    for (const ch of this.chunks.values()) {
      let any = false; for (let i = 0; i < C3; i++) if (ch.d[i] > -.99) { any = true; break; } if (!any) continue;
      const q = new Uint8Array(C3); for (let i = 0; i < C3; i++) q[i] = Math.round((ch.d[i] + 1) * 127.5);
      out.push([ch.cx, ch.cy, ch.cz, b64(q), b64(ch.col), b64(ch.rm)]);
    }
    return out;
  }
  load(data) {
    const u8 = s => { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
    for (const [cx, cy, cz, d, col, rm] of data) {
      const ch = this.chunk(cx, cy, cz, true), q = u8(d); for (let i = 0; i < C3; i++) ch.d[i] = q[i] / 127.5 - 1;
      ch.col.set(u8(col)); ch.rm.set(u8(rm)); this.dirty.add(ch);
    }
    this.flush();
  }
  // ---------------------------------------------------------------- CHAOS: a displaced capsule that paints while it grows (3D watercolours)
  //  E = evaluator from chaos.js: geo(...) → outward displacement (m), paint(...) → [r,g,b,rough,metal], pad = max displacement, wet = blend into existing colour
  //  s0 = along-stroke metres at a · cap = true → it's a cut (suction cups etc.)
  chaosSeg(a, b, ra, rb, E, s0 = 0, cut = false) {
    const v = this.vs, w = BAND, ab = b.clone().sub(a), L = ab.length(), L2 = L * L || 1e-12, mid = a.clone().add(b).multiplyScalar(.5), R = Math.max(ra, rb) + L / 2 + E.pad;
    const ax = a.x, ay = a.y, az = a.z, bx = ab.x, by = ab.y, bz = ab.z, iw = 1 / (v * w), out = [0, 0, 0, 0, 0], wet = E.wet ?? .35;
    const dn = L > 1e-9 ? ab.clone().multiplyScalar(1 / L) : new THREE.Vector3(1, 0, 0), sd = new THREE.Vector3().crossVectors(dn, new THREE.Vector3(0, 1, 0)); if (sd.lengthSq() < 1e-6) sd.set(1, 0, 0); sd.normalize(); const pp = new THREE.Vector3().crossVectors(sd, dn).normalize();
    this.each(mid, R, !cut, (ch, i, gx, gy, gz) => {
      const px = gx * v, py = gy * v, pz = gz * v, qx0 = px - ax, qy0 = py - ay, qz0 = pz - az;
      let t = (qx0 * bx + qy0 * by + qz0 * bz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = qx0 - bx * t, qy = qy0 - by * t, qz = qz0 - bz * t, d = Math.sqrt(qx * qx + qy * qy + qz * qz), r = ra + (rb - ra) * t;
      if (d > r + E.pad + v * w) return false;
      const nx = d > 1e-9 ? qx / d : 0, ny = d > 1e-9 ? qy / d : 1, nz = d > 1e-9 ? qz / d : 0, s = s0 + t * L;
      const ang = Math.atan2(nx * sd.x + ny * sd.y + nz * sd.z, nx * pp.x + ny * pp.y + nz * pp.z);
      const g = E.geo(px, py, pz, nx, ny, nz, s, ang), sv = clamp((r + g - d) * iw, -1, 1);
      if (cut) { if (-sv < ch.d[i]) { ch.d[i] = -sv; return true; } return false; }
      if (sv <= ch.d[i]) return false;
      const was = ch.d[i];
      E.paint(px, py, pz, nx, ny, nz, s, g, out, ang);
      const k = was < .2 ? 1 : wet * (1 - clamp(d / Math.max(r, 1e-6), 0, 1));        // new matter takes the colour · old matter gets a wash
      const c = ch.col, j = i * 3; c[j] += (out[0] * 255 - c[j]) * k; c[j + 1] += (out[1] * 255 - c[j + 1]) * k; c[j + 2] += (out[2] * 255 - c[j + 2]) * k;
      ch.rm[i * 2] += (out[3] * 255 - ch.rm[i * 2]) * k; ch.rm[i * 2 + 1] += (out[4] * 255 - ch.rm[i * 2 + 1]) * k;
      ch.d[i] = sv; return true;
    }, w + E.pad / v + 1);
  }
  // ---------------------------------------------------------------- TEXTURE-SCULPT: an alpha dragged along the surface (u = along the stroke, v = across)
  //  lifts the alpha's tops, sinks its seams, and (col) tones the colour at the same time: tops lighter, seams dark, toward the brush colour
  alphaSeg(a, b, n, r, A, alphaAt, o) {
    const v = this.vs, ab = b.clone().sub(a), L = ab.length(); if (L < 1e-9) return;
    const dir = ab.clone().multiplyScalar(1 / L), side = new THREE.Vector3().crossVectors(n, dir); if (side.lengthSq() < 1e-8) side.set(n.y, -n.x, 0).lengthSq() < 1e-8 ? side.set(0, n.z, -n.y) : 0; side.normalize(); const _u = 0, mid = a.clone().add(b).multiplyScalar(.5), R = r + L / 2;
    const col = o.color ? new THREE.Color(o.color) : null, tile = o.tile, k = o.k, s0 = o.s0, ck = o.colK ?? .5, best = o.best || new Map();
    this.each(mid, R, false, (ch, i, gx, gy, gz) => {
      const snap = this.snap && this.snap.get(ch.k), d = snap ? snap.d[i] : ch.d[i]; if (d < -.97 || d > .97) return false;
      const px = gx * v - a.x, py = gy * v - a.y, pz = gz * v - a.z; let t = (px * ab.x + py * ab.y + pz * ab.z) / (L * L); t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - ab.x * t, qy = py - ab.y * t, qz = pz - ab.z * t, across = qx * side.x + qy * side.y + qz * side.z, up = qx * n.x + qy * n.y + qz * n.z;
      const dist = Math.sqrt(across * across + up * up * .25); if (dist > r) return false;
      const fall = smooth01(1 - dist / r), bk = ch.k * 32768 + i; if ((best.get(bk) || 0) >= fall) return false; best.set(bk, fall);   // closest pass of this stroke wins, nothing piles up
      const h = alphaAt(A, (s0 + t * L) / tile, across / tile + .5);
      ch.d[i] = clamp(d + (h - .5) * k * fall, -1, 1);
      if (col) {   // tops toward the brush colour (a bit lighter), seams dark + rough — from the pre-stroke colour
        const c = ch.col, oc = snap ? snap.col : c, j = i * 3, tone = .38 + .78 * h, w = ck * fall;
        c[j] = oc[j] + (Math.min(255, col.r * 255 * tone) - oc[j]) * w; c[j + 1] = oc[j + 1] + (Math.min(255, col.g * 255 * tone) - oc[j + 1]) * w; c[j + 2] = oc[j + 2] + (Math.min(255, col.b * 255 * tone) - oc[j + 2]) * w;
        const orr = snap ? snap.rm[i * 2] : ch.rm[i * 2]; ch.rm[i * 2] = orr + ((o.rough ?? .55) * 255 * (1.35 - h * .5) - orr) * w * .6;
      }
      if (d <= -.6 && ch.d[i] > -.6) this.inherit(ch, i, gx, gy, gz);
      return true;
    }, 1);
  }
  // ---------------------------------------------------------------- SMART CUTS (define the shape by taking away; cuts show the inside, a bit fresher)
  reveal(ch, i, was, now, k = .18) {      // a voxel that was deep inside comes to the surface → fresh-cut look
    if (was > .5 && now < .5) { const c = ch.col, j = i * 3; c[j] += (255 - c[j]) * k; c[j + 1] += (255 - c[j + 1]) * k; c[j + 2] += (255 - c[j + 2]) * k; ch.rm[i * 2] = Math.min(255, ch.rm[i * 2] + 18); }
  }
  // chisel: everything in front of the plane (c, n = out of the material) within r goes → flat facets (cars, armour, crystals, cliffs)
  planeCut(c, n, r, soft = .25) {
    const v = this.vs, iw = 1 / (v * BAND);
    this.each(c, r, false, (ch, i, gx, gy, gz, t) => {
      const dist = (gx * v - c.x) * n.x + (gy * v - c.y) * n.y + (gz * v - c.z) * n.z;   // > 0 = in front (to remove)
      const edge = 1 - smooth01((t - (1 - soft)) / soft);                                   // full strength inside, soft rim
      const target = clamp(-dist * iw, -1, 1), was = ch.d[i];
      if (target < was) { ch.d[i] = was + (target - was) * edge; this.reveal(ch, i, was, ch.d[i]); return true; } return false;
    }, BAND);
  }
  // erode: takes away where a ridged noise is low → rock, weathering, cliffs, bones
  erode(p, r, k, freq) {
    this.each(p, r, false, (ch, i, gx, gy, gz, t) => {
      const was = ch.d[i]; if (was < -.95) return false;
      const n = 1 - Math.abs(fbm(gx * freq, gy * freq, gz * freq) * 2 - 1), f = smooth01(1 - t) * k * (1.15 - n) * 1.4;
      if (f <= 0) return false; ch.d[i] = clamp(was - f, -1, 1); this.reveal(ch, i, was, ch.d[i], .1); return true;
    });
  }
  // gouge: a sharp V groove along the stroke (detail lines, eyelids, panel lines)
  gouge(a, b, r, depth) {
    const v = this.vs, ab = b.clone().sub(a), L2 = ab.lengthSq() || 1e-12, mid = a.clone().add(b).multiplyScalar(.5), R = r + Math.sqrt(L2) / 2;
    this.each(mid, R, false, (ch, i, gx, gy, gz) => {
      const px = gx * v - a.x, py = gy * v - a.y, pz = gz * v - a.z; let t = (px * ab.x + py * ab.y + pz * ab.z) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - ab.x * t, py - ab.y * t, pz - ab.z * t); if (d > r) return false;
      const was = ch.d[i], cut = (1 - d / r) * depth; if (cut <= 0) return false;
      ch.d[i] = clamp(was - cut, -1, 1); this.reveal(ch, i, was, ch.d[i], .08); return true;
    });
  }
  // ---------------------------------------------------------------- live sync: one chunk = d (8 bit) + colour + rough/metal in one byte array
  _remat() { const old = this.mat; this.mat = sculptMaterial(this.rec.mat || 'clay', this.rec.tone || 'reptile', this.rec.skin); for (const ch of this.chunks.values()) if (ch.mesh) ch.mesh.material = this.mat; if (old && old !== this.mat) old.dispose(); }
  setTone(t) { if ((this.rec.tone || 'reptile') === t) return; this.rec.tone = t; this._remat(); }
  setMat(matKey) { if (this.rec.mat === matKey) return; this.rec.mat = matKey; this._remat(); }
  setSkin(s) {
    const o = this.rec.skin; if (JSON.stringify(o || null) === JSON.stringify(s || null)) return;
    if (s) this.rec.skin = s; else delete this.rec.skin;
    const U = this.mat.userData.tone;
    if (o && s && o.a === s.a && (o.b || null) === (s.b || null) && U.skinP) { U.skinP.value.set(1 / Math.max(1e-4, s.t), (s.k ?? 1) * s.t * .045, s.c ?? .7, s.b ? 1 : 0); if (U.natP) U.natP.value.copy(natVec(s)); return; }
    this._remat();
  }
  packChunk(k) {
    const ch = this.chunks.get(k); if (!ch) return null;
    const u = new Uint8Array(C3 * 6); for (let i = 0; i < C3; i++) u[i] = Math.round((ch.d[i] + 1) * 127.5);
    u.set(ch.col, C3); u.set(ch.rm, C3 * 4); return [ch.cx, ch.cy, ch.cz, u];
  }
  applyChunk(cx, cy, cz, u) {   // from another device: never counts as a local change (no echo)
    const ch = this.chunk(cx, cy, cz, true); for (let i = 0; i < C3; i++) ch.d[i] = u[i] / 127.5 - 1;
    ch.col.set(u.subarray(C3, C3 * 4)); ch.rm.set(u.subarray(C3 * 4, C3 * 6)); this._markMesh(cx, cy, cz);
  }
  // one plain mesh for export (Blender / phones)
  bake() {
    const geos = [...this.chunks.values()].filter(c => c.mesh).map(c => c.mesh.geometry);
    // ONE clean mesh per sculpt (Blender-friendly): position, normal, colour; roughness/metal → the material's average
    let ro = 0, me = 0, n = 0;
    const tk = this.rec.tone || 'reptile';
    const parts = geos.map(geo => { const c = new THREE.BufferGeometry(); for (const a of ['position', 'normal', 'color']) c.setAttribute(a, geo.attributes[a].clone()); c.setIndex(geo.index.clone());
      { const C = c.attributes.color, T = geo.attributes.tone, Nn = c.attributes.normal, Pp = c.attributes.position, cc = [0, 0, 0]; if (T) for (let i = 0; i < C.count; i++) { cc[0] = C.getX(i); cc[1] = C.getY(i); cc[2] = C.getZ(i); toneCPU(cc, [T.getX(i), T.getY(i)], [Nn.getX(i), Nn.getY(i), Nn.getZ(i)], [Pp.getX(i), Pp.getY(i), Pp.getZ(i)], tk); C.setXYZ(i, cc[0], cc[1], cc[2]); } }
      const rm = geo.attributes.rm; for (let i = 0; i < rm.count; i++) { ro += rm.getX(i); me += rm.getY(i); n++; } return c; });
    const merged = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
    const M = MATS[this.rec.mat] || MATS.clay;
    const m = new THREE.Mesh(merged, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: n ? ro / n : .6, metalness: n ? me / n : 0, clearcoat: M.clearcoat || 0 }));
    m.name = 'sculpt';
    return m;
  }
}
export { h3, vnoise, worley, fbm };
