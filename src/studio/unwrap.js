// bUild sTudio · UNWRAP — automatic UVs for anything (sculpts, strokes, shapes, imports without clean UVs).
//  1. every triangle picks the best of 26 projection directions (cube faces, edges, corners → max 23° slant, low stretch)
//  2. labels are smoothed over neighbours (sculpt noise would otherwise shred the charts)
//  3. charts GROW triangle by triangle and only take a triangle that doesn't overlap the chart (raster check) → never overlaps
//  4. each chart is turned to its tightest box (PCA), then all are packed (potpack) with a pixel padding
import * as THREE from 'three';
import { potpack } from 'three/addons/libs/potpack.module.js';
const V3 = THREE.Vector3;

const DIRS = []; for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) DIRS.push(new V3(x, y, z).normalize());

export function unwrap(src, { res = 1024, padPx = 6, maxSlant = .5 } = {}) {
  const t0 = performance.now();
  let geo = src.index ? src.toNonIndexed() : src.clone();
  const pos = geo.attributes.position, nT = pos.count / 3;
  // ---- weld by position (adjacency) — rounding key
  const bb = new THREE.Box3().setFromBufferAttribute(pos), size = bb.getSize(new V3()).length() || 1, q = 1e5 / size;
  const vid = new Int32Array(pos.count), keys = new Map();
  for (let i = 0; i < pos.count; i++) { const k = Math.round(pos.getX(i) * q) + ',' + Math.round(pos.getY(i) * q) + ',' + Math.round(pos.getZ(i) * q); let id = keys.get(k); if (id === undefined) { id = keys.size; keys.set(k, id); } vid[i] = id; }
  // ---- face normals + areas
  const fn = new Float32Array(nT * 3), area = new Float32Array(nT), a = new V3(), b = new V3(), c = new V3(), e1 = new V3(), e2 = new V3();
  for (let t = 0; t < nT; t++) { a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2); e1.subVectors(b, a); e2.subVectors(c, a); const n = e1.cross(e2), l = n.length(); area[t] = l / 2; if (l > 0) n.multiplyScalar(1 / l); fn[t * 3] = n.x; fn[t * 3 + 1] = n.y; fn[t * 3 + 2] = n.z; }
  // ---- adjacency through shared welded edges
  const edge = new Map(), adj = Array.from({ length: nT }, () => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const A = vid[t * 3 + k], B = vid[t * 3 + (k + 1) % 3]; if (A === B) continue; const key = A < B ? A * 4194304 + B : B * 4194304 + A;
    const o = edge.get(key); if (o === undefined) edge.set(key, t); else { adj[t].push(o); adj[o].push(t); }
  }
  // ---- best direction per triangle, then smoothing (majority of area-weighted neighbours, if that direction still faces the triangle)
  const dot = (t, d) => fn[t * 3] * DIRS[d].x + fn[t * 3 + 1] * DIRS[d].y + fn[t * 3 + 2] * DIRS[d].z;
  const lab = new Int8Array(nT);
  for (let t = 0; t < nT; t++) { let best = 0, bv = -9; for (let d = 0; d < DIRS.length; d++) { const v = dot(t, d); if (v > bv) { bv = v; best = d; } } lab[t] = best; }
  for (let it = 0; it < 4; it++) {
    const next = lab.slice();
    for (let t = 0; t < nT; t++) {
      const w = new Map(); for (const o of adj[t]) w.set(lab[o], (w.get(lab[o]) || 0) + area[o]);
      let best = lab[t], bw = (w.get(lab[t]) || 0) + area[t] * 1.2;
      for (const [d, v] of w) if (v > bw && dot(t, d) > maxSlant) { bw = v; best = d; }
      next[t] = best;
    }
    lab.set(next);
  }
  // ---- grow charts (BFS over same-label neighbours) with a raster overlap check in the chart's own plane
  const totalArea = area.reduce((s, v) => s + v, 0), cell = Math.sqrt(totalArea) / 400;
  const chartOf = new Int32Array(nT).fill(-1), tried = new Int32Array(nT).fill(-1), charts = [];
  const basis = d => { const n = DIRS[d], u = Math.abs(n.y) < .9 ? new V3(0, 1, 0).cross(n).normalize() : new V3(1, 0, 0).cross(n).normalize(), v = n.clone().cross(u); return [u, v]; };
  const P = (i, u, v) => [pos.getX(i) * u.x + pos.getY(i) * u.y + pos.getZ(i) * u.z, pos.getX(i) * v.x + pos.getY(i) * v.y + pos.getZ(i) * v.z];
  const cellsOf = (pts) => {   // raster cell centres inside the 2D triangle
    const out = []; const [p0, p1, p2] = pts;
    const x0 = Math.floor(Math.min(p0[0], p1[0], p2[0]) / cell), x1 = Math.ceil(Math.max(p0[0], p1[0], p2[0]) / cell), y0 = Math.floor(Math.min(p0[1], p1[1], p2[1]) / cell), y1 = Math.ceil(Math.max(p0[1], p1[1], p2[1]) / cell);
    if ((x1 - x0) * (y1 - y0) > 40000) return null;
    const ed = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); const s = ed(p0, p1, p2[0], p2[1]) > 0 ? 1 : -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const X = (x + .5) * cell, Y = (y + .5) * cell; if (ed(p0, p1, X, Y) * s >= 0 && ed(p1, p2, X, Y) * s >= 0 && ed(p2, p0, X, Y) * s >= 0) out.push(x * 65536 + y); }
    return out;
  };
  for (let seed = 0; seed < nT; seed++) {
    if (chartOf[seed] >= 0) continue;
    const d = lab[seed], [u, v] = basis(d), occ = new Set(), tris = [], ci = charts.length, queue = [seed];
    chartOf[seed] = ci; tried[seed] = ci;
    for (let qi = 0; qi < queue.length; qi++) {
      const t = queue[qi], pts = [P(t * 3, u, v), P(t * 3 + 1, u, v), P(t * 3 + 2, u, v)], cs = cellsOf(pts);
      if (t !== seed && (cs === null || cs.some(k => occ.has(k)))) { chartOf[t] = -1; continue; }   // would overlap → leave it for another chart
      if (cs) for (const k of cs) occ.add(k);
      tris.push(t);
      for (const o of adj[t]) if (chartOf[o] < 0 && tried[o] !== ci && lab[o] === d && dot(o, d) > .05) { chartOf[o] = ci; tried[o] = ci; queue.push(o); }
    }
    charts.push({ d, u, v, tris });
  }
  // ---- 2D coords per chart, PCA rotation to the tightest box
  const uv = new Float32Array(pos.count * 2), boxes = [];
  charts.forEach((ch, ci) => {
    const pts = []; for (const t of ch.tris) for (let k = 0; k < 3; k++) pts.push(P(t * 3 + k, ch.u, ch.v));
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of pts) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const ang = .5 * Math.atan2(2 * sxy, sxx - syy), co = Math.cos(-ang), si = Math.sin(-ang);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const rp = pts.map(p => { const x = (p[0] - mx) * co - (p[1] - my) * si, y = (p[0] - mx) * si + (p[1] - my) * co; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); return [x, y]; });
    ch.rp = rp; ch.x0 = x0; ch.y0 = y0; ch.w = x1 - x0; ch.h = y1 - y0;
  });
  // ---- pack: padding in world units derived from the final atlas size (two rounds)
  let atlas = Math.sqrt(totalArea / .55);
  for (let round = 0; round < 2; round++) {
    const pad = padPx / res * atlas * 2;
    boxes.length = 0; for (const ch of charts) boxes.push({ w: ch.w + pad, h: ch.h + pad, ch });
    const r = potpack(boxes); atlas = Math.max(r.w, r.h); if (round === 0) continue;
    for (const bx of boxes) {
      const ch = bx.ch; let i = 0;
      for (const t of ch.tris) for (let k = 0; k < 3; k++) { const p = ch.rp[i++]; uv[(t * 3 + k) * 2] = (bx.x + pad / 2 + p[0] - ch.x0) / atlas; uv[(t * 3 + k) * 2 + 1] = (bx.y + pad / 2 + p[1] - ch.y0) / atlas; }
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // ---- re-index: weld vertices that share position + uv (smaller, smooth normals keep working)
  const out = weld(geo);
  out.userData.unwrap = { charts: charts.length, ms: Math.round(performance.now() - t0), texelPerM: res / atlas };
  return out;
}

// merge identical (position, uv) vertices into an indexed geometry; normals are kept smooth across seams
export function weld(geo) {
  const pos = geo.attributes.position, uv = geo.attributes.uv, nrm = geo.attributes.normal, col = geo.attributes.color, n = pos.count;
  const map = new Map(), idx = new Uint32Array(n), P = [], U = [], N = [], C = [];
  for (let i = 0; i < n; i++) {
    const k = pos.getX(i).toFixed(6) + ',' + pos.getY(i).toFixed(6) + ',' + pos.getZ(i).toFixed(6) + '|' + uv.getX(i).toFixed(6) + ',' + uv.getY(i).toFixed(6);
    let j = map.get(k); if (j === undefined) { j = map.size; map.set(k, j); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); U.push(uv.getX(i), uv.getY(i)); if (nrm) N.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i)); if (col) C.push(col.getX(i), col.getY(i), col.getZ(i)); }
    idx[i] = j;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  if (C.length) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (N.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); else g.computeVertexNormals();
  smoothNormalsAcrossSeams(g);
  return g;
}
// vertices at the same position (split by a UV seam) get the same normal → no lighting seams
function smoothNormalsAcrossSeams(g) {
  const pos = g.attributes.position, nrm = g.attributes.normal, groups = new Map();
  for (let i = 0; i < pos.count; i++) { const k = pos.getX(i).toFixed(5) + ',' + pos.getY(i).toFixed(5) + ',' + pos.getZ(i).toFixed(5); let l = groups.get(k); if (!l) groups.set(k, l = []); l.push(i); }
  const s = new V3();
  const out = [];
  for (const l of groups.values()) {
    if (l.length < 2) continue;
    for (const i of l) {     // average with the vertices here whose normal is within ~35° (a hard edge keeps its two normals)
      s.set(0, 0, 0); const ni = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
      for (const k of l) { const nk = [nrm.getX(k), nrm.getY(k), nrm.getZ(k)]; if (ni[0] * nk[0] + ni[1] * nk[1] + ni[2] * nk[2] > .82) { s.x += nk[0]; s.y += nk[1]; s.z += nk[2]; } }
      s.normalize(); out.push(i, s.x, s.y, s.z);
    }
  }
  for (let k = 0; k < out.length; k += 4) nrm.setXYZ(out[k], out[k + 1], out[k + 2], out[k + 3]);
  nrm.needsUpdate = true;
}

// do these UVs work for painting? (inside 0..1 and no two triangles on the same texels)
export function uvsUsable(geo, res = 256) {
  const uv = geo.attributes.uv; if (!uv) return false;
  const idx = geo.index, nT = idx ? idx.count / 3 : uv.count / 3, grid = new Uint8Array(res * res); let bad = 0, total = 0;
  const g = i => { const v = idx ? idx.getX(i) : i; return [uv.getX(v) * res, uv.getY(v) * res]; };
  for (let t = 0; t < nT; t++) {
    const [p0, p1, p2] = [g(t * 3), g(t * 3 + 1), g(t * 3 + 2)];
    if ([p0, p1, p2].some(p => p[0] < -.5 || p[1] < -.5 || p[0] > res + .5 || p[1] > res + .5)) return false;
    const x0 = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), x1 = Math.min(res - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0]))), y0 = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), y1 = Math.min(res - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const ed = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]), s = ed(p0, p1, p2[0], p2[1]) > 0 ? 1 : -1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const X = x + .5, Y = y + .5; if (ed(p0, p1, X, Y) * s > 0 && ed(p1, p2, X, Y) * s > 0 && ed(p2, p0, X, Y) * s > 0) { total++; if (grid[y * res + x]++) bad++; } }
  }
  return total > 0 && bad / total < .02;
}
