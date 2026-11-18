// hAnd bUilder · where is the webcam? Your real hands are seen by the camera (2D) and by the Quest (3D): that pair gives the camera's position, direction and lens.
const rot = (q, v) => { const [x, y, z, w] = q, a = 2 * (y * v[2] - z * v[1]), b = 2 * (z * v[0] - x * v[2]), c = 2 * (x * v[1] - y * v[0]); return [v[0] + w * a + y * c - z * b, v[1] + w * b + z * a - x * c, v[2] + w * c + x * b - y * a]; };
const conj = q => [-q[0], -q[1], -q[2], q[3]];
const mul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const norm = q => { const l = Math.hypot(...q) || 1; return q.map(v => v / l); };
const dq = w => { const t = Math.hypot(w[0], w[1], w[2]); if (t < 1e-9) return [w[0] / 2, w[1] / 2, w[2] / 2, 1]; const s = Math.sin(t / 2) / t; return [w[0] * s, w[1] * s, w[2] * s, Math.cos(t / 2)]; };
function lookQ(p, c) {            // camera looks down -z
  let z = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(...z) || 1; z = z.map(v => v / l); let x = [z[2], 0, -z[0]]; l = Math.hypot(...x) || 1; x = x.map(v => v / l); const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2], t = m00 + m11 + m22; let s;
  if (t > 0) { s = .5 / Math.sqrt(t + 1); return norm([(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, .25 / s]); }
  if (m00 > m11 && m00 > m22) { s = 2 * Math.sqrt(1 + m00 - m11 - m22); return norm([.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]); }
  if (m11 > m22) { s = 2 * Math.sqrt(1 + m11 - m00 - m22); return norm([(m01 + m10) / s, .25 * s, (m12 + m21) / s, (m02 - m20) / s]); }
  s = 2 * Math.sqrt(1 + m22 - m00 - m11); return norm([(m02 + m20) / s, (m12 + m21) / s, .25 * s, (m10 - m01) / s]);
}
function res(c, S, out) { const iq = conj(c.q); let e = 0; for (let i = 0; i < S.length; i++) { const s = S[i], v = rot(iq, [s.X[0] - c.p[0], s.X[1] - c.p[1], s.X[2] - c.p[2]]), z = -v[2]; let a, b; if (z < .05) { a = b = 3; } else { a = c.f * v[0] / z - s.u; b = c.f * v[1] / z - s.v; } if (out) { out[2 * i] = a; out[2 * i + 1] = b; } e += a * a + b * b; } return e; }
const step = (c, d) => ({ p: [c.p[0] + d[0], c.p[1] + d[1], c.p[2] + d[2]], q: norm(mul(c.q, dq([d[3], d[4], d[5]]))), f: Math.min(4, Math.max(.7, c.f + d[6])) });
function solve7(A, b) { const n = 7, M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; if (Math.abs(M[i][i]) < 1e-12) return null; for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; } } const x = Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; } return x; }
function lm(c, S, its) {
  let lam = 1e-3, e = res(c, S); const m = S.length * 2, r0 = new Float64Array(m), r1 = new Float64Array(m), J = Array.from({ length: 7 }, () => new Float64Array(m)), E = [1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-4, 1e-3];
  for (let it = 0; it < its; it++) {
    res(c, S, r0); for (let j = 0; j < 7; j++) { const d = Array(7).fill(0); d[j] = E[j]; res(step(c, d), S, r1); for (let k = 0; k < m; k++) J[j][k] = (r1[k] - r0[k]) / E[j]; }
    const A = Array.from({ length: 7 }, () => Array(7).fill(0)), b = Array(7).fill(0); for (let i = 0; i < 7; i++) { for (let j = i; j < 7; j++) { let s = 0; for (let k = 0; k < m; k++) s += J[i][k] * J[j][k]; A[i][j] = A[j][i] = s; } let s = 0; for (let k = 0; k < m; k++) s -= J[i][k] * r0[k]; b[i] = s; }
    let ok = false; for (let t = 0; t < 6 && !ok; t++) { const B = A.map((r, i) => r.map((v, j) => i === j ? v * (1 + lam) + 1e-9 : v)), d = solve7(B, b); if (d) { const n = step(c, d), en = res(n, S); if (en < e) { c = n; e = en; ok = true; lam = Math.max(1e-6, lam * .4); break; } } lam *= 4; } if (!ok) break;
  }
  return { c, e };
}
// S = [{ X: world point, u, v }], u/v: image position with height = -1..1, centre = 0. Returns { p, q, f, rms } (q = camera rotation, looks down -z)
export function solveCamera(S, init) {
  if (S.length < 24) return null; const C = [0, 0, 0]; for (const s of S) for (let a = 0; a < 3; a++) C[a] += s.X[a] / S.length; const few = S.filter((_, i) => i % Math.max(1, Math.floor(S.length / 50)) === 0); let best = null;
  const tryIt = (c, its) => { const r = lm(c, few, its); if (!best || r.e < best.e) best = r; };
  if (init) tryIt({ p: [...init.p], q: [...init.q], f: init.f }, 12);
  if (!init || best.e / few.length / 2 > .0016) for (let k = 0; k < 8; k++) for (const d of [.6, 1.1]) { const t = k / 8 * Math.PI * 2, p = [C[0] + Math.sin(t) * d, C[1] + .12, C[2] + Math.cos(t) * d]; tryIt({ p, q: lookQ(p, C), f: 1.5 }, 10); }
  let c = lm(best.c, S, 10).c, use = S;
  for (let pass = 0; pass < 2; pass++) { const R = new Float64Array(use.length * 2); res(c, use, R); const er = use.map((_, i) => R[2 * i] ** 2 + R[2 * i + 1] ** 2), cut = [...er].sort((a, b) => a - b)[Math.floor(er.length * .75)]; use = use.filter((_, i) => er[i] <= cut); c = lm(c, use, 8).c; }
  return { p: c.p, q: c.q, f: c.f, rms: Math.sqrt(res(c, use) / use.length / 2), n: use.length };
}
export { lookQ, rot };
