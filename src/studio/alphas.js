// bUild sTudio · ALPHAS — tileable height stamps copied from nature (256², 0 = deepest seam, 1 = top of the scale).
//  u = along the stroke / body, v = across / around it. Used by the texture-sculpt brush, the chaos recipes and the Painter.
import * as THREE from 'three';
const N = 256;
const idCache = new Map();
const fr = x => x - Math.floor(x);
const hp = (i, j, s = 0) => fr(Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453);             // hash of an integer cell
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// periodic value noise (period P cells) → tileable
function pnoise(x, y, P, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), m = k => ((k % P) + P) % P;
  const a = hp(m(xi), m(yi), s), b = hp(m(xi + 1), m(yi), s), c = hp(m(xi), m(yi + 1), s), d = hp(m(xi + 1), m(yi + 1), s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
const pfbm = (x, y, P, s = 0) => pnoise(x, y, P, s) * .55 + pnoise(x * 2, y * 2, P * 2, s + 1) * .3 + pnoise(x * 4, y * 4, P * 4, s + 2) * .15;
// periodic worley on a P×P grid: [d1, d2, id, cx, cy]
function pwor(x, y, P, jit = 1, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9, id = 0, cx = 0, cy = 0; const m = k => ((k % P) + P) % P;
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const X = xi + a, Y = yi + b, px = X + .5 + (hp(m(X), m(Y), s) - .5) * jit, py = Y + .5 + (hp(m(X), m(Y), s + 9) - .5) * jit, d = Math.hypot(px - x, py - y);
    if (d < d1) { d2 = d1; d1 = d; id = hp(m(X), m(Y), s + 3); cx = px - x; cy = py - y; } else if (d < d2) d2 = d;
  }
  LID = id; return [d1, d2, id, cx, cy];
}
// overlapping shingles: rows across v, each scale raised toward its back edge, the next row lies on top (max)
let LID = -1;   // the id (0..1) of the scale that won at the last sample → every scale its own colour / age in the shader
function shingle(u, v, nu, nv, shape) {
  let h = 0, id = 0;
  for (let k = -1; k <= 1; k++) {
    const row = Math.floor(v * nv) + k, off = (row & 1) * .5, cu = (Math.floor(u * nu + off - .5 * 0) + .5 - off), lu = u * nu + off - Math.floor(u * nu + off) - .5, lv = v * nv - row - .5;
    for (let j = -1; j <= 1; j++) { const du = lu - j, cc = Math.floor(u * nu + off) + j, s = shape(du, lv, row, cc); if (s > h) { h = s; id = hp(((row % nv) + nv) % nv, ((cc % nu) + nu) % nu, 21); } }
  }
  LID = id; return h;
}
// ---------------------------------------------------------------- the library
const GEN = {
  'snake keeled': (u, v) => shingle(u, v, 10, 8, (du, dv, r, c) => {          // diamond dorsal scales with a keel ridge (viper / python back)
    const dd = Math.abs(du) * 1.05 + Math.abs(dv) * 1.25; if (dd > .62) return 0;
    const body = sm(.62, .45, dd), ramp = .55 + .45 * sm(-.5, .45, du), keel = Math.exp(-(dv * dv) / .004) * .22 * sm(-.4, .2, du);
    return (body * ramp + keel) * (.85 + hp(r, c, 5) * .15);
  }),
  'belly scutes': (u, v) => { LID = hp(Math.floor(u * 6) % 6, 0, 23); const f = fr(u * 6), band = sm(0, .12, f) * (.6 + .4 * sm(.1, .95, f)); const side = sm(0, .08, v) * sm(1, .92, v) * .25 + .75; return band * side * (.9 + pnoise(u * 6, v * 2, 6) * .1); },
  'dragon round': (u, v) => shingle(u, v, 7, 7, (du, dv, r, c) => { const d = Math.hypot(du * 1.1, dv); if (d > .62) return 0; return sm(.62, .4, d) * (.45 + .55 * sm(-.6, .45, du)) * (.85 + hp(r, c) * .15); }),
  'croc plates': (u, v) => { const nu = 5, nv = 4, rw = Math.floor(v * nv); LID = hp(((Math.floor(u * nu + (rw & 1) * .5)) % nu + nu) % nu, rw % nv, 25); const cu = fr(u * nu + (Math.floor(v * nv) & 1) * .5), cv = fr(v * nv), e = Math.min(cu, 1 - cu, cv, 1 - cv); const box = sm(0, .12, e), ridge = Math.exp(-((cv - .5) ** 2) / .01) * sm(.15, .5, cu) * sm(.95, .6, cu) * .45; return box * (.55 + ridge) + pfbm(u * 8, v * 8, 8) * .1; },
  'gecko granules': (u, v) => { const [d1] = pwor(u * 22, v * 22, 22, .8); return Math.sqrt(Math.max(0, 1 - d1 * d1 * 2.6)); },
  'warts': (u, v) => { const [d1] = pwor(u * 6, v * 6, 6, .9, 4), [g1] = pwor(u * 24, v * 24, 24, .8, 2); return Math.max(Math.sqrt(Math.max(0, 1 - (d1 / .33) ** 2)), Math.sqrt(Math.max(0, 1 - g1 * g1 * 2.4)) * .35); },
  'gila beads': (u, v) => { const [d1, , id] = pwor(u * 12, v * 12, 12, .5, 7); return Math.sqrt(Math.max(0, 1 - (d1 / .5) ** 2)) * (.8 + id * .2); },
  'honeycomb': (u, v) => { const x = u * 9, y = v * 9 * 1.1547, r = Math.floor(y), xo = x + (r & 1) * .5; const [d1, d2] = pwor(xo, y, 9, 0, 1); return sm(0, .14, d2 - d1) * (.7 + .3 * sm(.5, 0, d1)); },
  'wrinkles': (u, v) => { const w = Math.abs(Math.sin((v * 14 + pfbm(u * 3, v * 3, 3) * 2.2) * Math.PI)); return 1 - Math.pow(1 - w, 3) * .9; },
  'cracked skin': (u, v) => { const [d1, d2] = pwor(u * 7, v * 7, 7, 1, 11); return sm(0, .09, d2 - d1) * (.8 + pfbm(u * 6, v * 6, 6) * .2); },
  'big plates': (u, v) => { const [d1, d2, id] = pwor(u * 3.5, v * 3.5, 4, 1, 13); return sm(0, .07, d2 - d1) * (.7 + .3 * sm(.7, 0, d1)) * (.85 + id * .15); },
  'spikes': (u, v) => { const [d1, , id] = pwor(u * 5, v * 5, 5, .8, 17); return Math.max(0, 1 - d1 / (.22 + id * .12)) ** 1.5; },
  'fish scales': (u, v) => shingle(u, v, 9, 9, (du, dv) => { const d = Math.hypot(du, dv * 1.1); if (d > .58) return 0; return sm(.58, .48, d) * (.4 + .6 * sm(-.55, .5, du)); }),
  'feather': (u, v) => { const shaft = Math.exp(-((fr(v * 3) - .5) ** 2) / .002); const barb = .5 + .5 * Math.sin((u * 60 + Math.abs(fr(v * 3) - .5) * 40) * Math.PI); return Math.max(shaft, barb * .7 * sm(.5, .05, Math.abs(fr(v * 3) - .5))); },
  'bark': (u, v) => { const [d1, d2] = pwor(u * 2.5, v * 8, 8, 1, 19); return sm(0, .12, d2 - d1) * (.7 + pfbm(u * 4, v * 8, 8) * .3); },
  'rock': (u, v) => pfbm(u * 5, v * 5, 5) * .7 + pfbm(u * 16, v * 16, 16, 5) * .3,
};
export const ALPHA_KEYS = Object.keys(GEN);
const cache = new Map();
export function alphaData(key) {
  let a = cache.get(key); if (a) return a;
  const g = GEN[key] || GEN['snake keeled']; a = new Float32Array(N * N); const ids = new Float32Array(N * N);
  let mn = 1e9, mx = -1e9;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { LID = -1; const h = g(x / N, y / N); a[y * N + x] = h; ids[y * N + x] = LID >= 0 ? LID : pnoise(x / N * 6, y / N * 6, 6, 31); if (h < mn) mn = h; if (h > mx) mx = h; }
  idCache.set(key, ids);
  const k = 1 / Math.max(1e-6, mx - mn); for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) * k;
  cache.set(key, a); return a;
}
// bilinear, wrapping
export function alphaAt(a, u, v) {
  const x = fr(u) * N - .5, y = fr(v) * N - .5, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, m = k => (k + N) % N;
  const x0 = m(xi), x1 = m(xi + 1), y0 = m(yi), y1 = m(yi + 1);
  return (a[y0 * N + x0] * (1 - xf) + a[y0 * N + x1] * xf) * (1 - yf) + (a[y1 * N + x0] * (1 - xf) + a[y1 * N + x1] * xf) * yf;
}
// a GPU copy (the Painter's stamp / height brush)
const texCache = new Map();
export function alphaTexture(key) {
  let t = texCache.get(key); if (t) return t;
  // HALF FLOAT: 8-bit height gave the slope in steps → bright stripes inside every scale
  const a = alphaData(key), ids = idCache.get(key), hf = new Uint16Array(N * N * 4), H = THREE.DataUtils.toHalfFloat, one = H(1);
  for (let i = 0; i < a.length; i++) { hf[i * 4] = hf[i * 4 + 2] = H(a[i]); hf[i * 4 + 1] = H(ids[i]); hf[i * 4 + 3] = one; }   // R = height · G = which scale (0..1)
  t = new THREE.DataTexture(hf, N, N, THREE.RGBAFormat, THREE.HalfFloatType); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  texCache.set(key, t); return t;
}
// thumbnail for the panels
export function alphaThumb(key, size = 96) {
  const a = alphaData(key), cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d'), img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = alphaAt(a, x / size, y / size), hx = alphaAt(a, (x + 1) / size, y / size) - h, hy = alphaAt(a, x / size, (y + 1) / size) - h;
    const l = Math.max(0, Math.min(1, .25 + h * .75 + (-hx + -hy) * 4)), i = (y * size + x) * 4;
    img.data[i] = 30 + l * 215; img.data[i + 1] = 28 + l * 200; img.data[i + 2] = 24 + l * 170; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return cv;
}
