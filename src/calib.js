// bUild mOnster — the math that puts the monsters ON your real table.
//  solvePose: 4 clicked corners of an A4 sheet  →  where the camera is (R, t) and how wide it sees (f)
//  handIn3D:  one camera's hand (21 picture points + the hand's own metric shape) → the hand in metres, in front of the camera
//  Camera frame = OpenCV style (x right, y down, z forward). Table frame: x, z on the table, y UP, metres, sheet centre = 0.
export const A4 = [0.297, 0.210];

function solveN(A, b) {                       // Gauss with pivoting, A n×n (copied)
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function homography(src, dst) {       // src [[X,Z]] → dst [[u,v]], h33 = 1
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i], [u, v] = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]); b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]); b.push(v);
  }
  const h = solveN(A, b); if (!h) return null;
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const sc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = a => sc(a, 1 / len(a));

// clicks go AROUND the sheet in any order the person clicked → sort them by angle around their centre
export function aroundOrder(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  return [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

// img: 4 [u,v] pixels; W, H: picture size; fKnown: a focal length already known (else it is measured from the sheet)
// prefer: the last R → of the 4 equal readings (any corner can be "first") keep the one closest to it, so the table never jumps 90°
export function solvePose(img, W, H, fKnown = 0, paper = A4, prefer = null) {
  const cx = W / 2, cy = H / 2, P = aroundOrder(img).map(([u, v]) => [u - cx, v - cy]);
  let best = null;
  for (const [a, b] of [paper, [paper[1], paper[0]]]) {
    const base = [[-a / 2, -b / 2], [a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2]];
    for (const refl of [false, true]) {
      const ring = refl ? [...base].reverse() : base;
      const Hm = homography(ring, P); if (!Hm) continue;
      const h1 = [Hm[0][0], Hm[1][0], Hm[2][0]], h2 = [Hm[0][1], Hm[1][1], Hm[2][1]], h3 = [Hm[0][2], Hm[1][2], Hm[2][2]];
      // focal length from "the sheet's two sides are square and equally scaled" (camera centred, square pixels)
      const fo = -(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]);
      const fn = -((h1[0] ** 2 + h1[1] ** 2) - (h2[0] ** 2 + h2[1] ** 2)) / (h1[2] ** 2 - h2[2] ** 2);
      const ok = x => isFinite(x) && x > (0.35 * W) ** 2 && x < (3 * W) ** 2;
      let f, score;
      if (fKnown) { f = fKnown; score = 0; }
      else if (ok(fo) && ok(fn)) { f = Math.sqrt(Math.sqrt(fo * fn)); score = Math.abs(Math.log(fo / fn)); }
      else if (ok(fo)) { f = Math.sqrt(fo); score = 0.5; }
      else if (ok(fn)) { f = Math.sqrt(fn); score = 0.5; }
      else { f = 0.85 * W; score = 1; }                       // looking straight down: f cannot be measured → a usual webcam
      const a1 = [h1[0] / f, h1[1] / f, h1[2]], a2 = [h2[0] / f, h2[1] / f, h2[2]], a3 = [h3[0] / f, h3[1] / f, h3[2]];
      let lam = 2 / (len(a1) + len(a2)); if (a3[2] * lam < 0) lam = -lam;
      const r1 = sc(a1, lam), r2 = sc(a2, lam), t = sc(a3, lam);
      const orth = Math.abs(dot(r1, r2)) / (len(r1) * len(r2)) + Math.abs(len(r1) - len(r2)) / ((len(r1) + len(r2)) / 2);
      const x = nrm(r1), z = nrm(sub(r2, sc(x, dot(r2, x)))), y = cross(z, x);
      const R = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];   // columns = table axes seen from the camera
      const C = camCentre(R, t);
      if (C[1] <= 0) continue;                                   // camera under the table = the mirrored reading
      let s = score + (fKnown ? orth : orth * 0.3);
      if (prefer) { let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += R[i][j] * prefer[i][j]; s += (3 - tr) * 0.5; }
      if (!best || s < best.score) best = { R, t, f, score: s, shape: fKnown ? orth : score, C, paper: [a, b] };
    }
  }
  return best;
}

export const camCentre = (R, t) => [0, 1, 2].map(j => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2]));   // −Rᵀt
export const toCam = (R, t, p) => [0, 1, 2].map(i => R[i][0] * p[0] + R[i][1] * p[1] + R[i][2] * p[2] + t[i]);
export const toTable = (R, t, q) => { const d = sub(q, t); return [0, 1, 2].map(j => R[0][j] * d[0] + R[1][j] * d[1] + R[2][j] * d[2]); };
export const project = (f, W, H, q) => [f * q[0] / q[2] + W / 2, f * q[1] / q[2] + H / 2];

// one camera's hand → metric, in front of the camera. MediaPipe's world points are the hand's real shape in metres
// (turned like the camera sees it); only the distance is unknown → least squares over all 21 points.
export function handIn3D(p, w, W, H, f) {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  const add = (row, rhs) => { for (let i = 0; i < 3; i++) { b[i] += row[i] * rhs; for (let j = 0; j < 3; j++) A[i][j] += row[i] * row[j]; } };
  for (let i = 0; i < 21; i++) {
    const u = p[i][0] * W - W / 2, v = p[i][1] * H - H / 2;
    add([f, 0, -u], u * w[i][2] - f * w[i][0]);
    add([0, f, -v], v * w[i][2] - f * w[i][1]);
  }
  const T = solveN(A, b); if (!T || T[2] < 0.05) return null;
  return w.map(q => [q[0] + T[0], q[1] + T[1], q[2] + T[2]]);
}
