// bUild sTudio · DYNAMESH CORE (3D-Coat style voxel remesh) — plain JS, no three.js: runs in a Web Worker (no frame drops) or inline.
//  mesh → SPARSE narrow-band voxels (8³ blocks along the surface only, so model size never limits detail)
//  + a coarse flood-filled solid grid (robust inside / outside for every voxel away from the surface)
//  + Smear tubes (tapered capsules) unioned in → surface nets → crumbs dropped → 1 relax pass → paint / mask / colour carried over.
//  in : { pos, idx, nrm, paint, mask, col, caps:[{a:[x,y,z], b:[…], ra, rb}], target, vsLock, maxF }
//  out: { pos, idx, paint, mask, col, vs }  (typed arrays)

// uniform hash grid over points → nearest point within r
function pointGrid(P, n, h) {
  const T = 1 << Math.max(10, Math.ceil(Math.log2(n * 2))), hs = (x, y, z) => (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (T - 1);
  const key = new Uint32Array(n), st = new Uint32Array(T + 1);
  for (let i = 0; i < n; i++) { const k = hs(Math.floor(P[i * 3] / h), Math.floor(P[i * 3 + 1] / h), Math.floor(P[i * 3 + 2] / h)); key[i] = k; st[k + 1]++; }
  for (let i = 0; i < T; i++) st[i + 1] += st[i];
  const it = new Uint32Array(n), fl = st.slice(0, T); for (let i = 0; i < n; i++) it[fl[key[i]]++] = i;
  return (x, y, z, r) => {   // → index or -1
    const R = Math.ceil(r / h), X = Math.floor(x / h), Y = Math.floor(y / h), Z = Math.floor(z / h); let best = -1, bd = r * r;
    for (let c = Z - R; c <= Z + R; c++) for (let b = Y - R; b <= Y + R; b++) for (let a = X - R; a <= X + R; a++) {
      const k = hs(a, b, c); for (let j = st[k]; j < st[k + 1]; j++) { const i = it[j], dx = P[i * 3] - x, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } }
    }
    return best;
  };
}

export function remeshCore(o) {
  // vertex normals from the positions we were given (a restored SnakeHook preview must not keep its stretched normals)
  { const P = o.pos, I = o.idx, N = new Float32Array(P.length); for (let f = 0; f < I.length; f += 3) { const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2], qx = uy * wz - uz * wy, qy = uz * wx - ux * wz, qz = ux * wy - uy * wx; for (const v of [a, b, c]) { N[v] += qx; N[v + 1] += qy; N[v + 2] += qz; } }
    for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; } o.nrm = N; }
  const P = o.pos, I = o.idx, NR = o.nrm, n = P.length / 3, F = I.length / 3, caps = o.caps || [], maxF = o.maxF || 9e5;
  let area = 0;
  for (let f = 0; f < F; f++) { const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2]; area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2; }
  for (const c of caps) area += Math.PI * (c.ra + c.rb) * Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]) * .6;
  // wanted voxel size (locked per model, or from the target count), never more than maxF triangles: the estimate (≈ 3 · area / voxel²)
  //  can be off (pulled spikes hidden inside tubes count as area) → one corrective pass either way
  const vs0 = o.vsLock || Math.sqrt(3 * area / Math.max(1000, o.target || 2e5)); let vs = Math.max(vs0, Math.sqrt(3 * area / maxF));
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = build(o, vs, maxF);
    if (attempt < 2 && r.tris > maxF * 1.15) { vs *= Math.sqrt(r.tris / maxF) * 1.03; continue; }
    if (attempt < 2 && vs > vs0 * 1.02 && r.tris < maxF * .6) { vs = Math.max(vs0, vs * Math.sqrt(r.tris / (maxF * .92))); continue; }
    return finish(o, r, vs);
  }
}

// the voxel field stays in the worker between Smears (3D-Coat keeps its volume too): a Smear right after a Smear only ADDS its tube —
//  no re-sampling of the mesh, so nothing can drift or pile up. After other brushes changed the mesh, the field is re-read from it.
let CACHE = null;
function build(o, vs, maxF) {
  let S = o.reuse && CACHE && CACHE.key === o.reuse && CACHE.vs === vs ? CACHE.S : null;
  if (!S) S = field(o, vs);
  CACHE = { key: o.newKey || null, vs, S };
  return nets(o, S, vs);
}
function field(o, vs) {
  let _t = performance.now(); const PF = k => { if (globalThis.__prof) { const t = performance.now(); globalThis.__prof[k] = Math.round(t - _t); _t = t; } };
  const P = o.pos, I = o.idx, NR = o.nrm, n = P.length / 3, F = I.length / 3, caps = o.caps || [], iv = 1 / vs;
  // ---- coarse solid grid (cell = 4 voxels) over the old mesh: band where samples fall, flood the outside, the rest is inside
  const H = vs * 3, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const g0 = mn.map(v => v - H * 2), gd = [0, 1, 2].map(k => Math.ceil((mx[k] - mn[k]) / H) + 5), gxy = gd[0] * gd[1], GN = gxy * gd[2];
  const G = new Uint8Array(GN);   // 0 inside · 1 band · 2 outside
  const gIdx = (x, y, z) => { const a = Math.floor((x - g0[0]) / H), b = Math.floor((y - g0[1]) / H), c = Math.floor((z - g0[2]) / H); return a < 0 || b < 0 || c < 0 || a >= gd[0] || b >= gd[1] || c >= gd[2] ? -1 : a + b * gd[0] + c * gxy; };
  PF('A');
  // ---- fine sparse band
  const blocks = new Map(), bkey = (bx, by, bz) => ((bx + 2048) * 4096 + (by + 2048)) * 4096 + (bz + 2048), li = (x, y, z) => (x & 7) | ((y & 7) << 3) | ((z & 7) << 6);
  let lk = -1, lb = null;
  const blk = (x, y, z, make) => { const bx = x >> 3, by = y >> 3, bz = z >> 3, k = bkey(bx, by, bz); if (k === lk) return lb; let b = blocks.get(k); if (!b && make) { b = { v: new Float32Array(512), d: new Float32Array(512).fill(Infinity), vi: null, x: bx, y: by, z: bz }; blocks.set(k, b); } if (b) { lk = k; lb = b; } return b; };
  const splat = (px, py, pz, qx, qy, qz) => {
    const gi = gIdx(px, py, pz); if (gi >= 0) G[gi] = 1;
    const gx = px * iv, gy = py * iv, gz = pz * iv, X = Math.floor(gx), Y = Math.floor(gy), Z = Math.floor(gz);
    for (let z = Z - 1; z <= Z + 2; z++) for (let y = Y - 1; y <= Y + 2; y++) {
      const dy = y - gy, dz = z - gz, yz = dy * dy + dz * dz, pyz = dy * qy + dz * qz;
      for (let x = X - 1; x <= X + 2; x++) {
        const dx = x - gx, d2 = dx * dx + yz, b = blk(x, y, z, true), l = li(x, y, z);
        if (d2 < b.d[l]) { b.d[l] = d2; b.v[l] = -(dx * qx + pyz); }
      }
    }
  };
  for (let f = 0; f < F; f++) {
    const a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3, ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    let qx = uy * wz - uz * wy, qy = uz * wx - ux * wz, qz = ux * wy - uy * wx; const ql = Math.hypot(qx, qy, qz); if (ql < 1e-20) continue; qx /= ql; qy /= ql; qz /= ql;
    const L = Math.max(Math.hypot(ux, uy, uz), Math.hypot(wx, wy, wz), Math.hypot(wx - ux, wy - uy, wz - uz)), k = Math.ceil(L / vs);
    if (k <= 1) { splat(P[a] + (ux + wx) / 3, P[a + 1] + (uy + wy) / 3, P[a + 2] + (uz + wz) / 3, qx, qy, qz); continue; }
    for (let i = 0; i <= k; i++) for (let j = 0; j <= k - i; j++) { const s = i / k, t = j / k; splat(P[a] + ux * s + wx * t, P[a + 1] + uy * s + wy * t, P[a + 2] + uz * s + wz * t, qx, qy, qz); }
  }
  PF('splat');
  for (const b of blocks.values()) for (let l = 0; l < 512; l++) if (b.d[l] < Infinity) { b.d[l] = 0; const v = b.v[l]; b.v[l] = v > 2.5 ? 2.5 : v < -2.5 ? -2.5 : v; }
  // coarse: dilate the band once (watertight), then flood the outside (6-connected) from the border
  { const Q = new Int32Array(GN); let qh = 0, qt = 0; const seed = i => { if (G[i] === 0) { G[i] = 2; Q[qt++] = i; } };
    for (let c = 0; c < gd[2]; c++) for (let b = 0; b < gd[1]; b++) { seed(b * gd[0] + c * gxy); seed(gd[0] - 1 + b * gd[0] + c * gxy); }
    for (let c = 0; c < gd[2]; c++) for (let a = 0; a < gd[0]; a++) { seed(a + c * gxy); seed(a + (gd[1] - 1) * gd[0] + c * gxy); }
    for (let b = 0; b < gd[1]; b++) for (let a = 0; a < gd[0]; a++) { seed(a + b * gd[0]); seed(a + b * gd[0] + (gd[2] - 1) * gxy); }
    while (qh < qt) { const i = Q[qh++], a = i % gd[0], b = ((i / gd[0]) | 0) % gd[1], c = (i / gxy) | 0;
      if (a > 0) seed(i - 1); if (a < gd[0] - 1) seed(i + 1); if (b > 0) seed(i - gd[0]); if (b < gd[1] - 1) seed(i + gd[0]); if (c > 0) seed(i - gxy); if (c < gd[2] - 1) seed(i + gxy); } }
  PF('flood');
  // inside / outside of the OLD mesh anywhere: coarse grid, and in its band the nearest old vertex's normal decides
  const near = pointGrid(P, n, H);
  const solid = (x, y, z) => { if (globalThis.__prof) globalThis.__prof.nSolid = (globalThis.__prof.nSolid || 0) + 1;  // voxel coords → +2.5 inside / −2.5 outside
    const px = x * vs, py = y * vs, pz = z * vs, gi = gIdx(px, py, pz); if (gi < 0) return -2.5; const s = G[gi];
    if (s === 2) return -2.5;
    if (s === 0) { const j = near(px, py, pz, H * 2.5); if (j < 0) return 2.5; return (px - P[j * 3]) * NR[j * 3] + (py - P[j * 3 + 1]) * NR[j * 3 + 1] + (pz - P[j * 3 + 2]) * NR[j * 3 + 2] < 0 ? 2.5 : -2.5; }   // sealed air pockets between roots: the nearby surface decides if (globalThis.__prof) globalThis.__prof.nNear = (globalThis.__prof.nNear || 0) + 1;
    const i = near(px, py, pz, H * 3);
    if (i < 0) { let k = 0; const ga = gi % gd[0], gb = ((gi / gd[0]) | 0) % gd[1], gc = (gi / gxy) | 0; for (const [a, b2, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const A = ga + a * 2, B = gb + b2 * 2, Cc = gc + c * 2; if (A < 0 || B < 0 || Cc < 0 || A >= gd[0] || B >= gd[1] || Cc >= gd[2]) { k--; continue; } const t = G[A + B * gd[0] + Cc * gxy]; k += t === 0 ? 1 : t === 2 ? -1 : 0; } return k > 0 ? 2.5 : -2.5; }
    return (px - P[i * 3]) * NR[i * 3] + (py - P[i * 3 + 1]) * NR[i * 3 + 1] + (pz - P[i * 3 + 2]) * NR[i * 3 + 2] < 0 ? 2.5 : -2.5;
  };
  return { blocks, blk, li, solid };
}
function nets(o, S, vs) {
  let _t = performance.now(); const PF = k => { if (globalThis.__prof) { const t = performance.now(); globalThis.__prof[k] = Math.round(t - _t); _t = t; } };
  const { blocks, blk, li, solid } = S, caps = o.caps || [], iv = 1 / vs;
  // ---- Smear tubes, unioned (max)
  for (const c of caps) {
    const ax = c.a[0], ay = c.a[1], az = c.a[2], bx = c.b[0] - ax, by = c.b[1] - ay, bz = c.b[2] - az, L2 = bx * bx + by * by + bz * bz || 1e-12, R = Math.max(c.ra, c.rb) + vs * 3;
    const x0 = Math.floor((Math.min(c.a[0], c.b[0]) - R) * iv), x1 = Math.ceil((Math.max(c.a[0], c.b[0]) + R) * iv), y0 = Math.floor((Math.min(c.a[1], c.b[1]) - R) * iv), y1 = Math.ceil((Math.max(c.a[1], c.b[1]) + R) * iv), z0 = Math.floor((Math.min(c.a[2], c.b[2]) - R) * iv), z1 = Math.ceil((Math.max(c.a[2], c.b[2]) + R) * iv);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x * vs - ax, py = y * vs - ay, pz = z * vs - az; let t = (px * bx + py * by + pz * bz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = px - bx * t, qy = py - by * t, qz = pz - bz * t, tv = (c.ra + (c.rb - c.ra) * t - Math.sqrt(qx * qx + qy * qy + qz * qz)) * iv;
      if (tv < -2.5) continue;   // the whole inside of the tube is written (a corner deep in a tube must not fall back to "outside")
      const b = blk(x, y, z, true), l = li(x, y, z);
      const tc = tv > 2.5 ? 2.5 : tv; if (b.d[l] === Infinity) { b.d[l] = 0; b.v[l] = tc >= 2.5 ? 2.5 : Math.max(solid(x, y, z), tc); } else if (tc > b.v[l]) b.v[l] = tc;
    }
  }
  PF('caps');
  // ---- surface nets (a voxel outside the band takes its value from the solid grid → no skipped cubes, no holes)
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]], ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]], E3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const cv = new Float32Array(8), pos = [], tri = [], OFF = CO.map(([a, b, c]) => a + b * 8 + c * 64), EA = ED.map(e => e[0]), EB = ED.map(e => e[1]), CX = CO.map(c => c[0]), CY = CO.map(c => c[1]), CZ = CO.map(c => c[2]);
  // a voxel outside the band gets its value ONCE (then stored) → every cube around an edge sees the same numbers → no holes
  const guess = (b, l, x, y, z, hint) => { const v = hint > .7 ? 2.5 : hint < -.7 ? -2.5 : solid(x, y, z); b.d[l] = 0; b.v[l] = v; return v; };
  const val = (x, y, z, hint = 0) => { const b = blk(x, y, z, true); if (!b.vi) b.vi = new Int32Array(512).fill(-1); const l = li(x, y, z); return b.d[l] !== Infinity ? b.v[l] : guess(b, l, x, y, z, hint); };
  // every voxel next to the surface gets all 26 neighbours filled first → each crossing cube and its neighbours are complete
  for (const b of [...blocks.values()]) for (let l = 0; l < 512; l++) { if (b.d[l] === Infinity) continue; const v0 = b.v[l]; if (v0 > 1.6 || v0 < -1.6) continue; const x = b.x * 8 + (l & 7), y = b.y * 8 + ((l >> 3) & 7), z = b.z * 8 + (l >> 6);
    for (let c = -1; c <= 1; c++) for (let bb = -1; bb <= 1; bb++) for (let a = -1; a <= 1; a++) { const nb = blk(x + a, y + bb, z + c, true), nl = li(x + a, y + bb, z + c); if (nb.d[nl] === Infinity) guess(nb, nl, x + a, y + bb, z + c, v0); } }
  const origins = [...blocks.values()];
  for (const b of origins) b.vi = new Int32Array(512).fill(-1);
  const vidx = (x, y, z) => { const b = blk(x, y, z, false); return b && b.vi ? b.vi[li(x, y, z)] : -1; };
  for (const b of origins) for (let l = 0; l < 512; l++) {
    if (b.d[l] === Infinity) continue; const v0 = b.v[l]; if (v0 >= 2.4 || v0 <= -2.4) continue;   // far from the surface: its cube cannot be crossed (and must not grow the field)
    const x = b.x * 8 + (l & 7), y = b.y * 8 + ((l >> 3) & 7), z = b.z * 8 + (l >> 6); let ins = 0;
    const lx = l & 7, ly = (l >> 3) & 7, lz = l >> 6, inner = lx < 7 && ly < 7 && lz < 7, V = b.v, D = b.d;
    for (let c = 0; c < 8; c++) { let v; if (inner) { const j = l + OFF[c]; v = D[j] !== Infinity ? V[j] : guess(b, j, x + CO[c][0], y + CO[c][1], z + CO[c][2], V[l]); } else v = c ? val(x + CO[c][0], y + CO[c][1], z + CO[c][2], V[l]) : V[l]; cv[c] = v; if (v > 0) ins++; }
    if (ins === 0 || ins === 8) continue;
    let sx = 0, sy = 0, sz = 0, sc = 0;
    for (let k = 0; k < 12; k++) { const a = EA[k], e = EB[k], va = cv[a], vb = cv[e]; if ((va > 0) === (vb > 0)) continue; const t = va / (va - vb); sx += CX[a] + (CX[e] - CX[a]) * t; sy += CY[a] + (CY[e] - CY[a]) * t; sz += CZ[a] + (CZ[e] - CZ[a]) * t; sc++; }
    b.vi[l] = pos.length / 3; pos.push((x + sx / sc) * vs, (y + sy / sc) * vs, (z + sz / sc) * vs);
  }
  PF('verts');
  for (const b of origins) for (let l = 0; l < 512; l++) {
    if (b.d[l] === Infinity) continue; if (b.v[l] >= 2.4 || b.v[l] <= -2.4) continue;
    const x = b.x * 8 + (l & 7), y = b.y * 8 + ((l >> 3) & 7), z = b.z * 8 + (l >> 6), a = b.v[l] > 0;
    for (let ax = 0; ax < 3; ax++) {
      const e = E3[ax], lj = ax === 0 ? (l & 7) : ax === 1 ? ((l >> 3) & 7) : (l >> 6), j = l + (ax === 0 ? 1 : ax === 1 ? 8 : 64);
      const w = lj < 7 ? (b.d[j] !== Infinity ? b.v[j] : guess(b, j, x + e[0], y + e[1], z + e[2], b.v[l])) : val(x + e[0], y + e[1], z + e[2], b.v[l]); if ((w > 0) === a) continue;
      const du = E3[(ax + 1) % 3], dv = E3[(ax + 2) % 3];
      const q0 = vidx(x, y, z), q1 = vidx(x - du[0], y - du[1], z - du[2]), q2 = vidx(x - du[0] - dv[0], y - du[1] - dv[1], z - du[2] - dv[2]), q3 = vidx(x - dv[0], y - dv[1], z - dv[2]);
      if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
      if (a) tri.push(q0, q1, q2, q0, q2, q3); else tri.push(q0, q2, q1, q0, q3, q2);
    }
  }
  PF('faces'); if (globalThis.__prof) { globalThis.__prof.blocks = blocks.size; let c = 0, deep = 0; for (const b of blocks.values()) for (let l = 0; l < 512; l++) if (b.d[l] !== Infinity) { c++; if (Math.abs(b.v[l]) >= 2.4) deep++; } globalThis.__prof.cells = c; globalThis.__prof.deep = deep; }
  return { pos, tri, tris: tri.length / 3, val, iv };
}

function finish(o, r, vs) {
  let _t = performance.now(); const PF = k => { if (globalThis.__prof) { const t = performance.now(); globalThis.__prof[k] = Math.round(t - _t); _t = t; } };
  const { pos, tri, val, iv } = r; if (!tri.length) return null;
  // drop crumbs: islands far smaller than the main body
  let np, ni, nv;
  { const nv0 = pos.length / 3, par = new Int32Array(nv0); for (let v = 0; v < nv0; v++) par[v] = v;
    const fd = v => { while (par[v] !== v) { par[v] = par[par[v]]; v = par[v]; } return v; };
    for (let f = 0; f < tri.length; f += 3) { const a = fd(tri[f]), b = fd(tri[f + 1]); par[b] = a; const c = fd(tri[f + 2]); par[c] = fd(a); }
    const cnt = new Map(); for (let f = 0; f < tri.length; f += 3) { const k = fd(tri[f]); cnt.set(k, (cnt.get(k) || 0) + 1); }
    let big = 0; for (const v of cnt.values()) if (v > big) big = v;
    const keepMin = Math.max(80, big * .004), remap = new Int32Array(nv0).fill(-1), P2 = [], T2 = [];
    for (let f = 0; f < tri.length; f += 3) { if (cnt.get(fd(tri[f])) < keepMin) continue; for (let k = 0; k < 3; k++) { const v = tri[f + k]; if (remap[v] < 0) { remap[v] = P2.length / 3; P2.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } T2.push(remap[v]); } }
    np = Float32Array.from(P2); ni = Uint32Array.from(T2); nv = np.length / 3; }
  if (!ni.length) return null;
  // winding: normals out of the solid
  let out = 0; for (let f = 0; f < ni.length; f += 3 * 7) { const a = ni[f] * 3, b = ni[f + 1] * 3, c = ni[f + 2] * 3, ux = np[b] - np[a], uy = np[b + 1] - np[a + 1], uz = np[b + 2] - np[a + 2], wx = np[c] - np[a], wy = np[c + 1] - np[a + 1], wz = np[c + 2] - np[a + 2], qx = uy * wz - uz * wy, qy = uz * wx - ux * wz, qz = ux * wy - uy * wx, l = Math.hypot(qx, qy, qz) || 1;
    const v = val(Math.round(((np[a] + np[b] + np[c]) / 3 + qx / l * vs * 1.2) * iv), Math.round(((np[a + 1] + np[b + 1] + np[c + 1]) / 3 + qy / l * vs * 1.2) * iv), Math.round(((np[a + 2] + np[b + 2] + np[c + 2]) / 3 + qz / l * vs * 1.2) * iv));
    out += v > 0 ? -1 : 1; }
  if (out < 0) for (let f = 0; f < ni.length; f += 3) { const t = ni[f + 1]; ni[f + 1] = ni[f + 2]; ni[f + 2] = t; }
  // relax: no voxel stair hints
  { const nb = new Float32Array(nv * 3), cnt = new Uint16Array(nv);
    for (let f = 0; f < ni.length; f += 3) for (let k = 0; k < 3; k++) { const a = ni[f + k], b = ni[f + (k + 1) % 3]; nb[a * 3] += np[b * 3]; nb[a * 3 + 1] += np[b * 3 + 1]; nb[a * 3 + 2] += np[b * 3 + 2]; cnt[a]++; nb[b * 3] += np[a * 3]; nb[b * 3 + 1] += np[a * 3 + 1]; nb[b * 3 + 2] += np[a * 3 + 2]; cnt[b]++; }
    // mostly tangential (no shrinking / folding of thin tips → no flipped faces for the next DynaMesh to trip over)
    const vn = new Float32Array(nv * 3), RX = globalThis.__relax ?? .5;
    for (let f = 0; f < ni.length; f += 3) { const a = ni[f] * 3, b = ni[f + 1] * 3, c = ni[f + 2] * 3, ux = np[b] - np[a], uy = np[b + 1] - np[a + 1], uz = np[b + 2] - np[a + 2], wx = np[c] - np[a], wy = np[c + 1] - np[a + 1], wz = np[c + 2] - np[a + 2], qx = uy * wz - uz * wy, qy = uz * wx - ux * wz, qz = ux * wy - uy * wx; vn[a] += qx; vn[a + 1] += qy; vn[a + 2] += qz; vn[b] += qx; vn[b + 1] += qy; vn[b + 2] += qz; vn[c] += qx; vn[c + 1] += qy; vn[c + 2] += qz; }
    for (let v = 0; v < nv; v++) { if (!cnt[v]) continue; const i = v * 3, l = Math.hypot(vn[i], vn[i + 1], vn[i + 2]) || 1, nx = vn[i] / l, ny = vn[i + 1] / l, nz = vn[i + 2] / l; let dx = nb[i] / cnt[v] - np[i], dy = nb[i + 1] / cnt[v] - np[i + 1], dz = nb[i + 2] / cnt[v] - np[i + 2]; const dn = (dx * nx + dy * ny + dz * nz) * .75; np[i] += (dx - nx * dn) * RX; np[i + 1] += (dy - ny * dn) * RX; np[i + 2] += (dz - nz * dn) * RX; } }
  PF('clean');
  // carry paint, mask + colour from the nearest old vertex
  const P = o.pos, n = P.length / 3, near = pointGrid(P, n, vs * 2), pw = new Float32Array(nv), mk = new Float32Array(nv), col = o.col ? new Float32Array(nv * 3) : null;
  for (let v = 0; v < nv; v++) {
    let i = -1; for (let r = vs * 2, t = 0; t < 3 && i < 0; t++, r *= 2.5) i = near(np[v * 3], np[v * 3 + 1], np[v * 3 + 2], r);
    if (i < 0) continue; pw[v] = o.paint[i]; mk[v] = o.mask[i]; if (col) { col[v * 3] = o.col[i * 3]; col[v * 3 + 1] = o.col[i * 3 + 1]; col[v * 3 + 2] = o.col[i * 3 + 2]; }
  }
  PF('transfer');
  const M = mortonOrder(np, ni, [[col, 3], [mk, 1], [pw, 1]]);   // done here, not on the main thread
  return { pos: M.pos, idx: M.idx, paint: M.extra[2], mask: M.extra[1], col: M.extra[0], vs, ordered: true };
}

// vertices in Morton order → a brush touches a short index range (small GPU uploads, cache friendly)
export function mortonOrder(pos, idx, extra) {
  const n = pos.length / 3; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const sp = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2], 1e-9), part = v => { v &= 1023; v = (v | (v << 16)) & 0x030000FF; v = (v | (v << 8)) & 0x0300F00F; v = (v | (v << 4)) & 0x030C30C3; v = (v | (v << 2)) & 0x09249249; return v; };
  const code = new Uint32Array(n), ord = new Uint32Array(n);
  for (let i = 0; i < n; i++) { ord[i] = i; code[i] = (part((pos[i * 3] - mn[0]) / sp * 1023) | (part((pos[i * 3 + 1] - mn[1]) / sp * 1023) << 1) | (part((pos[i * 3 + 2] - mn[2]) / sp * 1023) << 2)) >>> 0; }
  ord.sort((a, b) => code[a] - code[b]);
  const inv = new Uint32Array(n); for (let i = 0; i < n; i++) inv[ord[i]] = i;
  const np = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const o = ord[i]; np[i * 3] = pos[o * 3]; np[i * 3 + 1] = pos[o * 3 + 1]; np[i * 3 + 2] = pos[o * 3 + 2]; }
  const ni = new Uint32Array(idx.length); for (let i = 0; i < idx.length; i++) ni[i] = inv[idx[i]];
  const ex = extra.map(([a, s]) => { if (!a) return null; const b = new Float32Array(n * s); for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) b[i * s + k] = a[ord[i] * s + k]; return b; });
  return { pos: np, idx: ni, extra: ex };
}
