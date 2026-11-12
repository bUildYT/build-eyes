// bUild eYes — a camera picture with the A4 paper → where that camera stands in the TABLE frame (see table.js).
// The paper alone is the same turned by 180°; the two thick dots at corner 1 and corner 2 say which long edge faces the player.
import { solvePose, A4 } from './calib.js';
import { findSheet } from './sheet.js';
const nearest = (L, c) => L.reduce((b, p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(b[0] - c[0], b[1] - c[1]) ? p : b);
// table frame = solver frame turned by th about y  →  R' = R · RotY(th)
export function turnR(R, th) { const c = Math.cos(th), s = Math.sin(th); const Y = [[c, 0, s], [0, 1, 0], [-s, 0, c]]; return R.map(row => [0, 1, 2].map(j => row[0] * Y[0][j] + row[1] * Y[1][j] + row[2] * Y[2][j])); }
// img: ImageData of the picture scaled to SW wide · E: { PW, PH, fLock, fSeen, smooth, cal } (kept between calls) → E.cal or null
export function paperPose(img, E) {
  const SW = img.width, k = E.PW / SW;
  const s = findSheet(img); if (!s) { E.seen = false; return null; }
  const C4 = s.corners.map(c => [c[0] * k, c[1] * k]);
  E.smooth = E.smooth ? E.smooth.map(c => { const n = nearest(C4, c); const a = Math.hypot(n[0] - c[0], n[1] - c[1]) > 6 ? 1 : .35; return [c[0] + (n[0] - c[0]) * a, c[1] + (n[1] - c[1]) * a]; }) : C4;
  const pose = solvePose(E.smooth, E.PW, E.PH, E.fLock || 0, A4, E.cal && E.cal.R0); if (!pose) return null;
  if (E.fLock && pose.shape > .05) return null;
  if (!E.fLock) { (E.fSeen = E.fSeen || []).push(pose.f); if (E.fSeen.length >= 5) { E.fSeen.sort((a, b) => a - b); E.fLock = E.fSeen[2]; } }
  const proj = (X, Z) => { const { R, t, f } = pose; const q = [0, 1, 2].map(i => R[i][0] * X + R[i][2] * Z + t[i]); if (q[2] <= 0) return null; return [(f * q[0] / q[2] + E.PW / 2) / k, (f * q[1] / q[2] + E.PH / 2) / k]; };
  const gray = (X, Z) => { let sum = 0, n = 0; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const p = proj(X + dx * .004, Z + dz * .004); if (!p) continue; const x = Math.round(p[0]), y = Math.round(p[1]); if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue; const i = (y * img.width + x) * 4; sum += img.data[i] * .3 + img.data[i + 1] * .59 + img.data[i + 2] * .11; n++; } return n ? sum / n : 255; };
  const [a, b] = pose.paper, inX = a / 2 - .02, inZ = b / 2 - .02;
  let bestRot = 0, bestDark = 1e9, all = [];
  for (let r = 0; r < 4; r++) {
    const th = r * Math.PI / 2, c = Math.cos(th), sn = Math.sin(th);
    const long = r % 2 === 0 ? a : b; if (Math.abs(long - A4[0]) > .01) continue;          // the dots sit on a LONG edge
    const L = r % 2 === 0 ? inX : inZ, S = r % 2 === 0 ? inZ : inX;
    const dk = [[-L, S], [L, S]].map(([x, z]) => gray(c * x + sn * z, -sn * x + c * z)), dark = dk[0] + dk[1];
    all.push(dark); if (dark < bestDark) { bestDark = dark; bestRot = th; }
  }
  // the dots must be clearly darker than the other long edge's corners, else keep the last answer's turn
  const sure = all.length === 2 && Math.max(...all) - Math.min(...all) > 60;
  if (!sure && E.cal && E.cal.th !== undefined) bestRot = E.cal.th;
  E.seen = true;
  E.cal = { R: turnR(pose.R, bestRot), t: pose.t, f: pose.f, R0: pose.R, th: bestRot, sure };
  return E.cal;
}
