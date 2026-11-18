// hAnd bUilder · surface nets for one chunk, runs in a worker: the headset's main thread only ever touches hands + drawing.
//  block = the chunk + margin M (for smooth normals and the cavity / rim tone) · d in [-1, 1], > 0 = inside.
export const C = 24, M = 7, N = C + 2 * M, P = C + 2;
const TD = []; for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) { const n = Math.abs(x) + Math.abs(y) + Math.abs(z); if (n === 1 || n === 2) { const l = Math.hypot(x, y, z); TD.push(x / l, y / l, z / l); } }
const T6 = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
const E0 = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], E1 = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
const CX = [0, 1, 0, 1, 0, 1, 0, 1], CY = [0, 0, 1, 1, 0, 0, 1, 1], CZ = [0, 0, 0, 0, 1, 1, 1, 1];
const MAXV = P * P * P, cellV = new Int32Array(MAXV), cv = new Float32Array(8);
const tP = new Float32Array(MAXV * 3), tN = new Float32Array(MAXV * 3), tC = new Uint8Array(MAXV * 3), tR = new Uint8Array(MAXV * 2), tT = new Int8Array(MAXV * 2), tI = new Uint16Array(300000);

export function meshBlock({ d, col, rm, ox, oy, oz, v, s = 1, q: fine = 1 }) {   // s = 1, 2, 4: every s-th voxel, the same for the whole piece so no seams open
  const NN = N * N, base = M + N * M + NN * M;
  const at = (x, y, z) => d[base + x + N * y + NN * z];
  const cl = a => a < -M ? -M : a > C + M - 1 ? C + M - 1 : a;
  const occ = (x, y, z) => at(cl(Math.round(x)), cl(Math.round(y)), cl(Math.round(z))) * .5 + .5;
  const tri = (x, y, z) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), fx = x - x0, fy = y - y0, fz = z - z0, i = base + x0 + N * y0 + NN * z0;
    const a = d[i], b = d[i + 1], c = d[i + N], e = d[i + N + 1], f = d[i + NN], g = d[i + NN + 1], h = d[i + NN + N], k = d[i + NN + N + 1];
    const p = a + (b - a) * fx, q = c + (e - c) * fx, r = f + (g - f) * fx, s = h + (k - h) * fx, t = p + (q - p) * fy, u = r + (s - r) * fy;
    return t + (u - t) * fz;
  };
  const PP = P * P, gs = Math.min(s, 2), TT = fine ? TD : T6, TDN = TT.length / 3; cellV.fill(-1); let nv = 0, ni = 0;
  const sN = s * N, sNN = s * NN, ci = (x, y, z) => (x + s) / s + P * ((y + s) / s) + PP * ((z + s) / s);
  for (let z = -s; z < C; z += s) for (let y = -s; y < C; y += s) for (let x = -s; x < C; x += s) {
    let mask = 0; const i0 = base + x + N * y + NN * z;
    for (let k = 0; k < 8; k++) { const q = d[i0 + s * CX[k] + sN * CY[k] + sNN * CZ[k]]; cv[k] = q; if (q > 0) mask |= 1 << k; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let e = 0; e < 12; e++) { const a = E0[e], b = E1[e], va = cv[a], vb = cv[b]; if ((va > 0) === (vb > 0)) continue; const t = va / (va - vb); sx += CX[a] + (CX[b] - CX[a]) * t; sy += CY[a] + (CY[b] - CY[a]) * t; sz += CZ[a] + (CZ[b] - CZ[a]) * t; n++; }
    sx /= n; sy /= n; sz /= n;
    const px = x + sx * s, py = y + sy * s, pz = z + sz * s;
    let gx = tri(px + gs, py, pz) - tri(px - gs, py, pz), gy = tri(px, py + gs, pz) - tri(px, py - gs, pz), gz = tri(px, py, pz + gs) - tri(px, py, pz - gs);
    const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1; gx /= gl; gy /= gl; gz /= gl;
    cellV[ci(x, y, z)] = nv;
    const j = nv * 3; tP[j] = (ox + px) * v; tP[j + 1] = (oy + py) * v; tP[j + 2] = (oz + pz) * v; tN[j] = -gx; tN[j + 1] = -gy; tN[j + 2] = -gz;
    let w = 0, r = 0, g = 0, b = 0, ro = 0, me = 0;
    for (let k = 0; k < 8; k++) {   // the voxels AT the surface carry the paint
      const c = cv[k], qx = x + s * CX[k], qy = y + s * CY[k], qz = z + s * CZ[k]; if (c <= -.999 || c >= .999 || qx < -1 || qy < -1 || qz < -1 || qx > C || qy > C || qz > C) continue;
      const wk = 1.02 - Math.abs(c), q = wk * wk, pv = (qx + 1) + P * (qy + 1) + PP * (qz + 1), pi = pv * 3, pr = pv * 2;
      w += q; r += col[pi] * q; g += col[pi + 1] * q; b += col[pi + 2] * q; ro += rm[pr] * q; me += rm[pr + 1] * q;
    }
    if (!w) { r = g = b = 200; ro = 185; me = 0; w = 1; }
    tC[j] = r / w; tC[j + 1] = g / w; tC[j + 2] = b / w; tR[nv * 2] = ro / w; tR[nv * 2 + 1] = me / w;
    let f = 0, wd = 0;
    for (let k = 0; k < TT.length; k += 3) { f += occ(px + TT[k] * 2.2, py + TT[k + 1] * 2.2, pz + TT[k + 2] * 2.2); wd += occ(px + TT[k] * 5.5, py + TT[k + 1] * 5.5, pz + TT[k + 2] * 5.5); }
    tT[nv * 2] = Math.max(-1, Math.min(1, (f / TDN - .5) * 2)) * 127; tT[nv * 2 + 1] = Math.max(-1, Math.min(1, (wd / TDN - .5) * 2)) * 127;
    nv++;
  }
  const cell = (x, y, z) => cellV[ci(x, y, z)];
  const quad = (a, b, c, e, flip) => {
    if (a < 0 || b < 0 || c < 0 || e < 0 || ni > tI.length - 6) return;
    if (flip) { tI[ni++] = a; tI[ni++] = b; tI[ni++] = c; tI[ni++] = a; tI[ni++] = c; tI[ni++] = e; }
    else { tI[ni++] = a; tI[ni++] = c; tI[ni++] = b; tI[ni++] = a; tI[ni++] = e; tI[ni++] = c; }
  };
  for (let z = 0; z < C; z += s) for (let y = 0; y < C; y += s) for (let x = 0; x < C; x += s) {
    const i = base + x + N * y + NN * z, in0 = d[i] > 0;
    if (in0 !== (d[i + s] > 0)) quad(cell(x, y - s, z - s), cell(x, y, z - s), cell(x, y, z), cell(x, y - s, z), in0);
    if (in0 !== (d[i + sN] > 0)) quad(cell(x - s, y, z - s), cell(x - s, y, z), cell(x, y, z), cell(x, y, z - s), in0);
    if (in0 !== (d[i + sNN] > 0)) quad(cell(x - s, y - s, z), cell(x, y - s, z), cell(x, y, z), cell(x - s, y, z), in0);
  }
  if (!ni) return null;
  return { pos: tP.slice(0, nv * 3), nor: tN.slice(0, nv * 3), col: tC.slice(0, nv * 3), rm: tR.slice(0, nv * 2), tone: tT.slice(0, nv * 2), ind: tI.slice(0, ni) };
}
