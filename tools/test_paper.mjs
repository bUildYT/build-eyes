// bUild eYes · camera EYE alignment test (node, no browser): render a fake camera picture of the A4 paper with the two
// corner dots from random places ALL AROUND the table (incl. the far side, where a plain sheet reads 180° wrong),
// run paperPose, compare with the truth. node tools/test_paper.mjs [N]
import { paperPose } from '../src/paperpose.js';
import { camCentre } from '../src/calib.js';
const N = +(process.argv[2] || 40), PW = 1920, PH = 1080, SW = +(process.argv[3] || 480), SH = SW * 9 / 16, k = PW / SW;
const rnd = (a, b) => a + Math.random() * (b - a);
const sub = (a, b) => a.map((x, i) => x - b[i]), nrm = a => { const l = Math.hypot(...a); return a.map(x => x / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
let good = 0, flips = 0, worstC = 0; const errs = [], pxs = [];
for (let n = 0; n < N; n++) {
  const az = rnd(0, Math.PI * 2), dist = rnd(.45, 1.1), h = rnd(.25, .85);
  const C = [Math.sin(az) * dist, h, Math.cos(az) * dist], tgt = [rnd(-.05, .05), 0, rnd(-.05, .05)];
  const zc = nrm(sub(tgt, C)), xc = nrm(cross(zc, [0, 1, 0])), yc = cross(zc, xc);   // x right, y DOWN, z forward
  const roll = rnd(-.15, .15), xr = xc.map((v, i) => v * Math.cos(roll) + yc[i] * Math.sin(roll)), yr = yc.map((v, i) => -xc[i] * Math.sin(roll) + v * Math.cos(roll));
  const R = [xr, yr, zc], t = R.map(r => -(r[0] * C[0] + r[1] * C[1] + r[2] * C[2]));
  const f = PW / 2 / Math.tan(rnd(30, 42) * Math.PI / 180);
  const data = new Uint8ClampedArray(SW * SH * 4);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const d = [((x + .5) * k - PW / 2) / f, ((y + .5) * k - PH / 2) / f, 1];
    const w = [0, 1, 2].map(j => R[0][j] * d[0] + R[1][j] * d[1] + R[2][j] * d[2]);
    let g = 40 + 20 * Math.random();
    if (w[1] < 0) {
      const s = -C[1] / w[1], X = C[0] + w[0] * s, Z = C[2] + w[2] * s;
      g = 105 + ((Math.floor(X * 40) + Math.floor(Z * 6)) & 1) * 12 + 10 * Math.random();          // wood-ish table
      if (Math.abs(X) < .1485 && Math.abs(Z) < .105) {
        g = 232 + 10 * Math.random();
        if (Math.hypot(Math.abs(X) - (.1485 - .02), Z - (.105 - .02)) < .007) g = 35;               // the two dots: corner 1 + 2 (near edge, +Z)
      }
    }
    const i = (y * SW + x) * 4; data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
  }
  const img = { width: SW, height: SH, data }, E = { PW, PH };
  let cal = null; for (let r = 0; r < 7; r++) cal = paperPose(img, E) || cal;
  if (!cal) { errs.push(`#${n} no paper (az ${(az * 57).toFixed(0)}°, ${dist.toFixed(2)} m, h ${h.toFixed(2)})`); continue; }
  const Ce = camCentre(cal.R, cal.t), dC = Math.hypot(...sub(Ce, C));
  let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += cal.R[i][j] * R[i][j];
  const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 57.3;
  // what the viewer sees: creatures anywhere within 25 cm of the paper centre, up to 8 cm tall → how many pixels off?
  const pj = (RR, tt, ff, p) => { const q = [0, 1, 2].map(i => RR[i][0] * p[0] + RR[i][1] * p[1] + RR[i][2] * p[2] + tt[i]); return [ff * q[0] / q[2], ff * q[1] / q[2]]; };
  let px = 0; for (const X of [-.25, 0, .25]) for (const Z of [-.2, 0, .2]) for (const Y of [0, .08]) { const a = pj(R, t, f, [X, Y, Z]), b = pj(cal.R, cal.t, cal.f, [X, Y, Z]); px = Math.max(px, Math.hypot(a[0] - b[0], a[1] - b[1])); }
  pxs.push(px);
  if (ang > 90) flips++;
  if (px < 20) good++; else errs.push(`#${n} ${px.toFixed(0)} px az ${(az * 57).toFixed(0)}° dist ${dist.toFixed(2)} h ${h.toFixed(2)}: turn off ${ang.toFixed(1)}°, camera off ${(dC * 100).toFixed(1)} cm, sure ${cal.sure}`);
  if (ang < 90) worstC = Math.max(worstC, dC);
}
pxs.sort((a, b) => a - b); console.log(`picture error at 1920 px: median ${pxs[pxs.length >> 1].toFixed(1)} px, 90 % ${pxs[pxs.length * .9 | 0].toFixed(1)} px`);
console.log(`paper EYE: ${good}/${N} right (creatures < 20 px off in a 1920 picture) · ${flips} read the wrong way round · worst place error (not flipped) ${(worstC * 100).toFixed(1)} cm`);
errs.slice(0, 12).forEach(e => console.log('   ' + e));
if (good < N * .9 || flips) process.exitCode = 1;
