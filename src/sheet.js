// bUild mOnster — find the white A4 sheet in the camera picture by itself (no tapping).
// bright blob → its outline → 4 straight sides fitted by least squares → corners where the sides cross.
// findSheet(ImageData) → { corners: 4 × [x, y] in that picture's pixels, fill } or null
export function findSheet(img) {
  const { width: w, height: h, data } = img, n = w * h, g = new Uint8Array(n);
  for (let i = 0; i < n; i++) g[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
  const hist = new Array(256).fill(0); for (let i = 0; i < n; i++) hist[g[i]]++;
  // Otsu: the brightness that best splits the picture in two
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, otsu = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const d = sB / wB - (sum - sB) / wF, v = wB * wF * d * d; if (v > best) { best = v; otsu = t; } }
  let found = null;
  for (const T of [otsu, otsu + 25, otsu + 50, Math.max(otsu - 20, 40)]) {
    if (T > 250) continue;
    const r = blobs(g, w, h, T);
    if (r && (!found || r.area > found.area)) found = r;
  }
  return found;
}

function blobs(g, w, h, T) {
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h); let next = 0, best = null;
  for (let s = 0; s < w * h; s++) {
    if (lab[s] || g[s] < T) continue;
    next++; let sp = 0, area = 0, edge = [], touches = false, cx = 0, cy = 0; stack[sp++] = s; lab[s] = next;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0; area++; cx += x; cy += y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      let border = false;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || (j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) { border = true; continue; }
        if (g[j] < T) { border = true; continue; }
        if (!lab[j]) { lab[j] = next; stack[sp++] = j; }
      }
      if (border) edge.push([x + .5, y + .5]);
    }
    if (touches || area < w * h * .008 || area > w * h * .6) continue;
    if (best && area <= best.area) continue;
    const q = quad(edge); if (!q) continue;
    const qa = polyArea(q);
    const fill = area / qa;
    if (fill < .86 || fill > 1.12) continue;
    // sides must not be wildly different (a sheet seen in perspective stays a sane 4-gon)
    const sides = q.map((p, k) => Math.hypot(q[(k + 1) % 4][0] - p[0], q[(k + 1) % 4][1] - p[1]));
    if (Math.min(...sides) < Math.max(...sides) * .2) continue;
    best = { corners: q, fill, area };
  }
  return best;
}

const polyArea = q => Math.abs(q.reduce((s, p, k) => s + p[0] * q[(k + 1) % 4][1] - q[(k + 1) % 4][0] * p[1], 0)) / 2;

function quad(edge) {
  if (edge.length < 40) return null;
  // the 4 corners = the biggest 4-gon whose corners sit on the outline's convex hull
  const P = [...edge].sort((p, q) => p[0] - q[0] || p[1] - q[1]), crs = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length > 1 && crs(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length > 1 && crs(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  let hull = lo.slice(0, -1).concat(hi.slice(0, -1));
  if (hull.length < 4) return null;
  if (hull.length > 64) { const st = hull.length / 64; hull = Array.from({ length: 64 }, (_, i) => hull[Math.floor(i * st)]); }
  const m = hull.length, tri = (i, j, k) => Math.abs(crs(hull[i], hull[j], hull[k]));
  let bestA = -1, rough = null;
  for (let i = 0; i < m; i++) for (let k = i + 2; k < m; k++) {
    let bj = -1, aj = -1, bl = -1, al = -1;
    for (let j = i + 1; j < k; j++) { const t = tri(i, j, k); if (t > aj) { aj = t; bj = j; } }
    for (let l = k + 1; l < m + i; l++) { const t = tri(k, l % m, i); if (t > al) { al = t; bl = l % m; } }
    if (bj >= 0 && bl >= 0 && aj + al > bestA) { bestA = aj + al; rough = [hull[i], hull[bj], hull[k], hull[bl]]; }
  }
  if (!rough) return null;

  // each side: the outline points close to it (not near the corners) → a straight line by least squares
  const lines = [];
  for (let k = 0; k < 4; k++) {
    const a = rough[k], b = rough[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 8) return null;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, pts = [];
    for (const p of edge) { const t = (p[0] - a[0]) * ux + (p[1] - a[1]) * uy, d = Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux); if (t > L * .12 && t < L * .88 && d < Math.max(2.5, L * .03)) pts.push(p); }
    if (pts.length < 6) return null;
    let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0; for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const ang = .5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) });
  }
  const out = [];
  for (let k = 0; k < 4; k++) {
    const A = lines[(k + 3) % 4], B = lines[k], den = A.dx * B.dy - A.dy * B.dx; if (Math.abs(den) < 1e-6) return null;
    const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
    const p = [A.px + A.dx * t, A.py + A.dy * t];
    if (Math.hypot(p[0] - rough[k][0], p[1] - rough[k][1]) > 12) return null;   // the fit ran away: not a clean 4-gon
    out.push(p);
  }
  return out;
}
