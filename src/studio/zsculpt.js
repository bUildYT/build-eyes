// bUild sTudio · Z SCULPT — ZBrush-style sculpting on a dense mesh.
//  Brushes: Standard · Clay · ClayBuildup · DamStandard · Inflate · Pinch · Smooth · Flatten · Trim · Move · Smear (SnakeHook → voxel tube) · Layer · hPolish · Mask · Paint
//  DynaMesh: sparse narrow-band voxels + surface nets (3D-Coat style) — auto after Smear, any size, crumbs dropped, paint kept
//  FLUID materials: 4-colour falloff by form (cavity → rim, core → tips) + marbled flow, pour cells, metallic veins
//  LIVE MATERIAL: per-vertex curvature (fine + broad) updated with every dab → cavity dirt + worn rims + 2-material paint layer, no bake
//  Strokes: Freehand (lazy mouse) · DragRect (drag = size + turn, live) · Spray.  Alphas: stamps + nature + your own images.
//  Mesh: dense triangle mesh, vertex grid for brush queries, BVH for picking, partial GPU uploads, per-stroke undo, X symmetry.
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { zlibSync, unzlibSync } from 'fflate';
import { alphaData, ALPHA_KEYS } from './alphas.js';
import { remeshCore, mortonOrder } from './zremesh.js';

export const ZBRUSHES = {
  standard: { label: 'Standard', icon: '●', alpha: true },
  clay:     { label: 'Clay', icon: '◒', alpha: true },
  buildup:  { label: 'ClayBuildup', icon: '▣', alpha: true },
  dam:      { label: 'DamStandard', icon: '⌄', alpha: false },
  inflate:  { label: 'Inflate', icon: '◉', alpha: true },
  pinch:    { label: 'Pinch', icon: '⋈', alpha: false },
  smooth:   { label: 'Smooth', icon: '〜', alpha: false },
  flatten:  { label: 'Flatten', icon: '▭', alpha: false },
  trim:     { label: 'Trim', icon: '⌓', alpha: false },
  move:     { label: 'Move', icon: '✋', alpha: false },
  snake:    { label: 'Smear', icon: '➰', alpha: false },    // SnakeHook: grab + drag out tentacles, horns, roots — DynaMesh re-voxels the stretch
  layer:    { label: 'Layer', icon: '▤', alpha: true },     // rises to ONE height per stroke (panels, plates, inset with ZSub)
  planar:   { label: 'hPolish', icon: '◆', alpha: false },  // flat facets: the plane is fixed where you pressed
  mask:     { label: 'Mask', icon: '◐', alpha: true },
  paint:    { label: 'Paint', icon: '🖌', alpha: true },     // paints the 2nd material (gold trim on black armor …)
};
export const ZBRUSH_KEYS = Object.keys(ZBRUSHES);
export const ZSTROKES = { free: 'Freehand', rect: 'DragRect', spray: 'Spray' };

// ---------------------------------------------------------------- alphas: centred stamps (0 = nothing, 1 = full) + nature tiles + yours
const AN = 256;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hh = (i, j, s = 0) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
function vn(x, y, s = 0) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hh(xi, yi, s) * (1 - u) + hh(xi + 1, yi, s) * u) * (1 - v) + (hh(xi, yi + 1, s) * (1 - u) + hh(xi + 1, yi + 1, s) * u) * v; }
function wor(x, y, s = 0) { const xi = Math.floor(x), yi = Math.floor(y); let d1 = 9, d2 = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const cx = xi + i + hh(xi + i, yi + j, s), cy = yi + j + hh(xi + i, yi + j, s + 3), d = Math.hypot(x - cx, y - cy); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return [d1, d2]; }
// x, y in -1..1 (centre 0), r = distance from centre
const STAMPS = {
  'round':    (x, y, r) => sm(1, 0, r),
  'sharp':    (x, y, r) => Math.max(0, 1 - r) ** 2.2,
  'square':   (x, y) => sm(1, .7, Math.max(Math.abs(x), Math.abs(y))),
  'ring':     (x, y, r) => Math.exp(-((r - .62) ** 2) / .012),
  'star':     (x, y, r) => { const a = Math.atan2(y, x), k = .55 + .45 * Math.cos(a * 5); return sm(k, k * .4, r); },
  'cross':    (x, y) => Math.max(sm(.25, 0, Math.abs(x)) * sm(1, .8, Math.abs(y)), sm(.25, 0, Math.abs(y)) * sm(1, .8, Math.abs(x))),
  'ridge':    (x, y) => sm(.35, 0, Math.abs(x)) * sm(1, .7, Math.abs(y)),
  'pores':    (x, y, r) => { const [d] = wor(x * 9 + 9, y * 9 + 9, 3); return sm(.32, .05, d) * sm(1, .75, r); },
  'skin':     (x, y, r) => { let f = 0, a = .5, s = 4; for (let o = 0; o < 4; o++) { f += vn(x * s + 20, y * s + 20, o) * a; a *= .5; s *= 2.1; } const [d] = wor(x * 14 + 5, y * 14 + 5, 7); return (f * .7 + sm(.3, .05, d) * .45) * sm(1, .7, r); },
  'wrinkles': (x, y, r) => { const w = Math.abs(Math.sin((y * 5 + vn(x * 2 + 4, y * 2, 2) * 1.6) * Math.PI)); return (1 - Math.pow(1 - w, 4)) * sm(1, .6, r); },
  'cracks':   (x, y, r) => { const [d1, d2] = wor(x * 4 + 11, y * 4 + 11, 5); return (1 - sm(0, .12, d2 - d1)) * sm(1, .7, r); },
  'stitch':   (x, y) => { const f = ((y + 1) * 3) % 1; return sm(.2, .05, Math.abs(x)) * sm(.45, .25, Math.abs(f - .5)) * sm(1, .85, Math.abs(y)); },
  'rivet':    (x, y, r) => Math.sqrt(Math.max(0, 1 - (r / .55) ** 2)),
  'bricks':   (x, y) => { const v = (y + 1) * 3, row = Math.floor(v), u = (x + 1) * 2.5 + (row & 1) * .5, fu = u % 1, fv = v % 1; return sm(0, .08, Math.min(fu, 1 - fu)) * sm(0, .1, Math.min(fv, 1 - fv)) * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'weave':    (x, y) => { const u = (x + 1) * 5, v = (y + 1) * 5, cu = Math.floor(u), cv = Math.floor(v), over = (cu + cv) & 1, fu = u % 1, fv = v % 1; const a = over ? Math.sin(fv * Math.PI) : Math.sin(fu * Math.PI); return (.5 + .5 * a) * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'rock':     (x, y, r) => { let f = 0, a = .5, s = 2.5; for (let o = 0; o < 5; o++) { f += vn(x * s + 40, y * s + 40, o + 9) * a; a *= .5; s *= 2; } return sm(.35, .75, f) * sm(1, .6, r); },
  // ---- hard surface (armor · mechs · ships)
  'panel':    (x, y) => { const m = Math.max(Math.abs(x), Math.abs(y)); return sm(.92, .84, m) * (1 - .85 * Math.exp(-((m - .64) ** 2) / .0009)); },
  'vent':     (x, y) => { const m = Math.max(Math.abs(x), Math.abs(y)), f = ((y + .7) * 3.6) % 1, slot = Math.abs(y) < .7 && Math.abs(x) < .72 ? sm(.3, .2, Math.abs(f - .5)) : 0; return sm(.95, .86, m) * (1 - slot * .95); },
  'hex':      (x, y) => { const s = 4.2, X = x * s, Y = y * s * 1.1547, r0 = Math.floor(Y), q = X - (r0 & 1) * .5; let best = 9; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const rr = r0 + dy, cx = Math.floor(q) + dx + (rr & 1) * .5 + .5, cy = (rr + .5), ax = Math.abs(X - cx), ay = Math.abs((Y - cy) * .866), d = Math.max(ax, ax * .5 + ay * 1.1547 * .866 * 1.155); if (d < best) best = d; } return sm(.5, .42, best) * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'greeble':  (x, y) => { const u = (x + 1) * 3, v = (y + 1) * 3, i = Math.floor(u), j = Math.floor(v), split = hh(i, j, 4) > .5, a = split ? Math.floor((u - i) * 2) : Math.floor((v - j) * 2), h = .25 + .75 * hh(i * 2 + a, j * 3 + a, 8), fu = split ? ((u - i) * 2) % 1 : u - i, fv = split ? v - j : ((v - j) * 2) % 1; return h * sm(0, .08, Math.min(fu, 1 - fu)) * sm(0, .08, Math.min(fv, 1 - fv)) * sm(1, .9, Math.max(Math.abs(x), Math.abs(y))); },
  'bolts':    (x, y, r) => { let v = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, d = Math.hypot(x - Math.cos(a) * .7, y - Math.sin(a) * .7); v = Math.max(v, Math.sqrt(Math.max(0, 1 - (d / .15) ** 2))); } return Math.max(v, .35 * sm(.9, .8, r) * sm(.45, .55, r)); },
  'seam':     (x, y) => { const groove = Math.exp(-(x * x) / .004), fy = ((y + 1) * 3) % 1, riv = Math.sqrt(Math.max(0, 1 - ((Math.hypot(Math.abs(x) - .32, (fy - .5) / 3) / .11) ** 2))); return (.55 * (1 - groove) + .45 * riv) * sm(1, .85, Math.abs(y)) * sm(.6, .45, Math.abs(x)); },
  'lamellar': (x, y) => { const v = (y + 1) * 2.5, f = v % 1, row = Math.floor(v), u = (x + 1) * 3 + (row & 1) * .5, fu = u % 1; return (.35 + .65 * f) * sm(0, .06, Math.min(fu, 1 - fu)) * sm(1, .9, Math.max(Math.abs(x), Math.abs(y))); },
  'knurl':    (x, y) => { const a = Math.abs(Math.sin((x + y) * 9)), b = Math.abs(Math.sin((x - y) * 9)); return Math.min(a, b) ** .6 * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'grille':   (x, y) => { const f = ((x + 1) * 7) % 1; return sm(.5, .3, Math.abs(f - .5)) * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'cables':   (x, y) => { const v = (y + 1) * 2, f = v % 1; return Math.sqrt(Math.max(0, 1 - ((f - .5) * 2.15) ** 2)) * sm(1, .9, Math.abs(x)); },
  'tech':     (x, y, r) => { const ring = Math.max(Math.exp(-((r - .85) ** 2) / .002), Math.exp(-((r - .5) ** 2) / .003)), a = Math.atan2(y, x), sp = sm(.08, .03, Math.abs(((a / Math.PI * 4 + 8) % 1) - .5)) * (r > .5 && r < .85 ? 1 : 0); return Math.max(sm(.95, .88, r) * .55 + ring * .45 - sp * .4, sm(.22, .18, r)); },
  'cog':      (x, y, r) => { const a = Math.atan2(y, x), t = sm(-.2, .2, Math.cos(a * 12)), R = .72 + .16 * t; return sm(R, R - .04, r) * (1 - sm(.24, .2, r) * .9); },
  'chevron':  (x, y) => { const f = ((y + Math.abs(x) * .8 + 2) * 2.2) % 1; return sm(.5, .35, Math.abs(f - .5)) * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'circuit':  (x, y) => { const u = (x + 1) * 4, v = (y + 1) * 4, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, h = hh(i, j, 2); const line = h < .33 ? Math.abs(fv - .5) : h < .66 ? Math.abs(fu - .5) : Math.abs(fu - fv) * .7; const pad = Math.hypot(fu - .5, fv - .5) < .16 && hh(i, j, 5) > .6 ? 1 : 0; return Math.max(sm(.09, .05, line), pad) * sm(1, .85, Math.max(Math.abs(x), Math.abs(y))); },
  'chips':    (x, y, r) => { const [d1] = wor(x * 3.2 + 3, y * 3.2 + 3, 12), n = vn(x * 9 + 7, y * 9, 3); return sm(.42, .3, d1 + n * .22) * (hh(Math.floor(x * 3.2 + 3 + .5), Math.floor(y * 3.2 + 3 + .5), 9) > .35 ? 1 : .0) * sm(1, .7, r); },
  'filigree': (x, y, r) => { const a = Math.atan2(y, x), w = Math.abs(Math.sin(a * 3 + r * 9)); return sm(.3, .12, w) * sm(.95, .8, r) * sm(.05, .12, r); },
  // ---- creatures (dragons · biomech · aliens)
  'scale':    (x, y) => { const yy = y + .25, d = Math.hypot(x * 1.15, yy * .9); return d < 1 ? Math.sqrt(Math.max(0, 1 - d * d)) * sm(-.95, -.4, y) * (.75 + .25 * sm(.2, -.6, y)) : 0; },
  'belly':    (x, y) => { const v = (y + 1) * 2.5, f = v % 1; return (.25 + .75 * Math.sqrt(Math.max(0, 1 - ((1 - f) * 1.05) ** 2))) * sm(.9, .7, Math.abs(x)) * sm(1, .9, Math.abs(y)); },
  'veins':    (x, y, r) => { const wx = x + (vn(x * 2 + 5, y * 2, 41) - .5) * .5, wy = y + (vn(x * 2, y * 2 + 5, 42) - .5) * .5, a = 1 - Math.abs(vn(wx * 2.6 + 3, wy * 2.6 + 9, 20) * 2 - 1), b = 1 - Math.abs(vn(wx * 6 + 1, wy * 6 + 4, 21) * 2 - 1); return Math.max(a ** 14, b ** 18 * .6) * sm(1, .6, r); },
  'fibers':   (x, y, r) => { const w = vn(x * 1.5 + 2, y * 22, 31) * .6 + vn(x * 3, y * 44, 32) * .4; return (.3 + .7 * w) * sm(1, .7, r); },
  'ribs':     (x, y) => { const f = ((y + 1) * 3.5) % 1, k = Math.sin(f * Math.PI); return k ** .7 * sm(.95, .55, Math.abs(x)) * sm(1, .88, Math.abs(y)); },
  'horn':     (x, y) => { const f = ((y + 1) * 5 + x * x * .6) % 1; return (.65 + .35 * sm(0, .3, f) * sm(1, .7, f)) * sm(.95, .7, Math.abs(x)) * sm(1, .85, Math.abs(y)); },
  'membrane': (x, y, r) => { const [d1, d2] = wor(x * 3 + 1, y * 7 + 1, 15); return (.45 + .55 * sm(0, .25, d2 - d1)) * sm(1, .6, r); },
  'crater':   (x, y, r) => sm(1, .78, r) * (.45 + .55 * Math.exp(-((r - .62) ** 2) / .02)) * (1 - .75 * sm(.55, .1, r)),
  'spikes':   (x, y) => { const u = (x + 1) * 2.5, v = (y + 1) * 2.5, i = Math.floor(u), j = Math.floor(v), d = Math.hypot(u - i - .5 - (hh(i, j, 1) - .5) * .3, v - j - .5 - (hh(i, j, 2) - .5) * .3); return Math.max(0, 1 - d / .42) ** 1.6 * sm(1, .88, Math.max(Math.abs(x), Math.abs(y))); },
};
export const ZALPHA_KEYS = ['none', ...Object.keys(STAMPS), ...ALPHA_KEYS.map(k => '~' + k)];   // ~ = nature tile (repeats inside the stamp)
const custom = new Map();   // name → Float32Array
const zcache = new Map();
export function zAlpha(key) {
  if (!key || key === 'none') return null;
  if (custom.has(key)) return custom.get(key);
  let a = zcache.get(key); if (a) return a;
  if (key[0] === '~') { a = alphaData(key.slice(1)); zcache.set(key, a); return a; }
  const f = STAMPS[key] || STAMPS.round; a = new Float32Array(AN * AN); let mx = 1e-6;
  for (let j = 0; j < AN; j++) for (let i = 0; i < AN; i++) { const x = (i + .5) / AN * 2 - 1, y = (j + .5) / AN * 2 - 1, v = Math.max(0, f(x, y, Math.hypot(x, y))); a[j * AN + i] = v; if (v > mx) mx = v; }
  for (let i = 0; i < a.length; i++) a[i] /= mx;
  zcache.set(key, a); return a;
}
export const zAlphaTiles = key => !!key && key[0] === '~';
// your own alpha from any image (white = up)
export function addCustomAlpha(name, img) {
  const cv = document.createElement('canvas'); cv.width = cv.height = AN; const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, AN, AN); const s = Math.min(AN / img.width, AN / img.height); g.drawImage(img, (AN - img.width * s) / 2, (AN - img.height * s) / 2, img.width * s, img.height * s);
  const d = g.getImageData(0, 0, AN, AN).data, a = new Float32Array(AN * AN); let mn = 1, mx = 0;
  for (let i = 0; i < a.length; i++) { const v = (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255; a[i] = v; mn = Math.min(mn, v); mx = Math.max(mx, v); }
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) / Math.max(1e-6, mx - mn);
  custom.set(name, a); if (!ZALPHA_KEYS.includes(name)) ZALPHA_KEYS.splice(1, 0, name); return name;
}
function sampleA(a, u, v, tiles) {   // u, v in 0..1 → bilinear
  if (tiles) { u -= Math.floor(u); v -= Math.floor(v); } else if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const x = u * AN - .5, y = v * AN - .5, xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const c = k => tiles ? (k + AN) % AN : Math.min(AN - 1, Math.max(0, k)), x0 = c(xi), x1 = c(xi + 1), y0 = c(yi), y1 = c(yi + 1);
  return (a[y0 * AN + x0] * (1 - xf) + a[y0 * AN + x1] * xf) * (1 - yf) + (a[y1 * AN + x0] * (1 - xf) + a[y1 * AN + x1] * xf) * yf;
}
export function zAlphaThumb(key, size = 96) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const g = cv.getContext('2d'), img = g.createImageData(size, size), a = zAlpha(key), t = zAlphaTiles(key);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size, r = Math.hypot(u * 2 - 1, v * 2 - 1);
    const h = a ? sampleA(a, t ? u * 2 : u, t ? v * 2 : v, t) : sm(1, 0, r), i = (y * size + x) * 4, l = h * 235 + 12;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = l; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return cv;
}

// ---------------------------------------------------------------- matcaps (ZBrush look: you read the form, not the lighting)
const mcCache = {};
export const ZLOOKS = { smart: 'live material', clay: 'grey clay', wax: 'red wax', white: 'white', skin: 'skin', pbr: 'scene light' };
function matcap(kind) {
  if (mcCache[kind]) return mcCache[kind];
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'), img = g.createImageData(N, N);
  const base = { clay: [.62, .6, .57], wax: [.62, .2, .16], white: [.86, .86, .85], skin: [.78, .55, .45] }[kind] || [.6, .6, .6];
  const L = [-.45, .62, .64], ll = Math.hypot(...L);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const nx = (x + .5) / N * 2 - 1, ny = 1 - (y + .5) / N * 2, r2 = nx * nx + ny * ny, i = (y * N + x) * 4; if (r2 > 1) { img.data[i + 3] = 255; continue; }
    const nz = Math.sqrt(1 - r2), d = (nx * L[0] + ny * L[1] + nz * L[2]) / ll, dif = Math.max(0, d * .75 + .25), hx = L[0] / ll, hy = L[1] / ll, hz = L[2] / ll + 1, hl = Math.hypot(hx, hy, hz);
    const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), kind === 'wax' ? 40 : 24) * (kind === 'clay' ? .22 : .38), rim = Math.pow(1 - nz, 3) * .25, amb = .16 + ny * .05;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.min(255, (base[k] * (dif + amb) + spec + rim * base[k]) * 255);
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return mcCache[kind] = t;
}
// ---------------------------------------------------------------- LIVE SMART MATERIALS: read the mesh while you sculpt it —
//  cavities fill with dirt, rims wear to bare metal / pale tips, grime + micro-bump from 3D noise. No bake, no UVs: every dab
//  updates the per-vertex curvature (fine + broad) and the shader does the rest. Two materials: base + Paint (gold trim on black …).
//  col base · cav cavity dirt · edge worn rim · m/r metal/rough · em/er rim metal/rough · cavA/edgeA/dirt/grunge amounts · bump
export const ZSMART = {
  white:    { l: 'white', col: '#d9d6ce', cav: '#2b2722', edge: '#55585d', m: 0, r: .42, em: .85, er: .38, cavA: .9, edgeA: .65, dirt: .5, grunge: .6, bump: .18 },
  black:    { l: 'black', col: '#0b0c0f', cav: '#000000', edge: '#a2a6ac', m: .3, r: .24, em: 1, er: .3, cavA: .8, edgeA: .75, dirt: .25, grunge: .5, bump: .05 },
  gold:     { l: 'gold', col: '#c8963c', cav: '#2a1a08', edge: '#ffe9ad', m: 1, r: .26, em: 1, er: .1, cavA: .85, edgeA: .7, dirt: .35, grunge: .4, bump: .1 },
  gunmetal: { l: 'gunmetal', col: '#3a3d43', cav: '#0c0c0d', edge: '#c9ccd0', m: .9, r: .42, em: 1, er: .22, cavA: .8, edgeA: .8, dirt: .45, grunge: .7, bump: .2 },
  chrome:   { l: 'chrome', col: '#d7dbe0', cav: '#15171a', edge: '#ffffff', m: 1, r: .07, em: 1, er: .03, cavA: .7, edgeA: .3, dirt: .15, grunge: .25, bump: .04 },
  obsidian: { l: 'biomech', col: '#060608', cav: '#000000', edge: '#46505e', m: .15, r: .08, em: .4, er: .05, cavA: .9, edgeA: .55, dirt: .1, grunge: .25, bump: .06 },
  red:      { l: 'red armor', col: '#7a0d10', cav: '#140203', edge: '#73767b', m: .15, r: .24, em: 1, er: .3, cavA: .85, edgeA: .7, dirt: .3, grunge: .5, bump: .1 },
  scales:   { l: 'dragon', col: '#28352d', cav: '#040705', edge: '#b0b496', m: 0, r: .58, em: 0, er: .45, cavA: 1, edgeA: .9, dirt: .35, grunge: .7, bump: .5 },
  bone:     { l: 'bone', col: '#d8cbae', cav: '#5c2b20', edge: '#f8f2e4', m: 0, r: .62, em: 0, er: .45, cavA: .9, edgeA: .6, dirt: .4, grunge: .6, bump: .35 },
  skin:     { l: 'flesh', col: '#b9796a', cav: '#4a1513', edge: '#e6b9a8', m: 0, r: .46, em: 0, er: .4, cavA: .85, edgeA: .5, dirt: .2, grunge: .4, bump: .3 },
  rust:     { l: 'rust', col: '#6b3a20', cav: '#1c0e06', edge: '#9d9ea0', m: .35, r: .85, em: 1, er: .4, cavA: .9, edgeA: .85, dirt: .5, grunge: 1, bump: .45 },
  stone:    { l: 'stone', col: '#827e77', cav: '#211f1c', edge: '#cfcac0', m: 0, r: .9, em: 0, er: .8, cavA: 1, edgeA: .7, dirt: .5, grunge: .8, bump: .6 },
  // FLUID (acrylic pour): a 4-colour falloff that follows the form — deep colour sinks into cavities, light colours ride the bumps
  //  and rims, marbled flow + pour cells in between, thin metallic veins. ramp = cavity → … → rim · vein · cells · veins · flow scale
  lagoon:   { l: 'lagoon', ramp: ['#071a45', '#1666b0', '#3ec6cc', '#f2f5f1'], vein: '#d6ad55', cells: .9, veins: .7, flow: .5, col: '#3ec6cc', cav: '#030b1f', edge: '#ffffff', m: 0, r: .2, em: 0, er: .12, cavA: .7, edgeA: .45, dirt: .2, grunge: .2, bump: .06 },
  abyss:    { l: 'abyss gold', ramp: ['#030817', '#0f2f6b', '#2f72b6', '#c79a45'], vein: '#f0c060', cells: .55, veins: 1, flow: .42, col: '#2f72b6', cav: '#01030a', edge: '#f6d58a', m: 0, r: .22, em: .9, er: .15, cavA: .8, edgeA: .5, dirt: .25, grunge: .2, bump: .06 },
  ember:    { l: 'ember', ramp: ['#062b2c', '#16806f', '#e2701c', '#f7e6c4'], vein: '#c98a3a', cells: .8, veins: .6, flow: .46, col: '#e2701c', cav: '#02100f', edge: '#fff4dc', m: 0, r: .24, em: 0, er: .15, cavA: .7, edgeA: .45, dirt: .2, grunge: .2, bump: .06 },
  coral:    { l: 'coral', ramp: ['#2a0f5c', '#1b93bf', '#e8478a', '#f6d43a'], vein: '#ffffff', cells: 1, veins: .5, flow: .55, col: '#e8478a', cav: '#12052a', edge: '#fff6c0', m: 0, r: .22, em: 0, er: .15, cavA: .7, edgeA: .4, dirt: .15, grunge: .2, bump: .06 },
  ruby:     { l: 'ruby', ramp: ['#2b030b', '#8e1a2c', '#cdbfc3', '#ffffff'], vein: '#1f7356', cells: .5, veins: .8, flow: .42, col: '#8e1a2c', cav: '#140105', edge: '#ffffff', m: 0, r: .2, em: 0, er: .12, cavA: .8, edgeA: .45, dirt: .2, grunge: .2, bump: .06 },
  jade:     { l: 'jade', ramp: ['#031f19', '#0d6b55', '#53b89c', '#eaf3ee'], vein: '#c6a457', cells: .6, veins: .6, flow: .46, col: '#53b89c', cav: '#010d0a', edge: '#ffffff', m: 0, r: .22, em: 0, er: .14, cavA: .75, edgeA: .45, dirt: .2, grunge: .2, bump: .06 },
};
export const ZSMART_KEYS = Object.keys(ZSMART);
// look string: 'clay' | 'wax' | … | 'smart:<base>:<paint>:<dirt>:<wear>'
export function parseLook(look) {
  if (!look || !look.startsWith('smart')) return null;
  const [, a, b, d, w] = look.split(':'); return { a: ZSMART[a] ? a : 'white', b: ZSMART[b] ? b : 'gold', dirt: d === undefined ? .6 : +d, wear: w === undefined ? .6 : +w };
}
export const smartLook = (a, b, dirt = .6, wear = .6) => `smart:${a}:${b}:${(+dirt).toFixed(2)}:${(+wear).toFixed(2)}`;
const SMART_GLSL = /* glsl */`
uniform vec3 zA0, zA1, zA2, zB0, zB1, zB2;   // col · cavity · edge
uniform vec4 zAp, zBp, zAk, zBk;              // m r em er · cavA edgeA dirt grunge
uniform vec2 zBump, zGlobal;                  // bump a b · dirt wear
uniform float zScale;
uniform vec3 zAR0, zAR1, zAR2, zAR3, zBR0, zBR1, zBR2, zBR3, zAV, zBV;   // fluid ramps + vein colours
uniform vec4 zAF, zBF;                                                     // fluid on · cells · veins · flow scale
uniform vec4 zCen;                                                         // mesh centre + radius (core → tip colour falloff)
varying vec2 vCav; varying float vPaint; varying vec3 vOP; varying vec3 vON;
float zh(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float zn(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(zh(i), zh(i + vec3(1,0,0)), f.x), mix(zh(i + vec3(0,1,0)), zh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(zh(i + vec3(0,0,1)), zh(i + vec3(1,0,1)), f.x), mix(zh(i + vec3(0,1,1)), zh(i + vec3(1,1,1)), f.x), f.y), f.z); }
float zfbm(vec3 p) { return zn(p) * .55 + zn(p * 2.13 + 7.) * .28 + zn(p * 4.7 + 3.) * .17; }
vec3 zRamp(vec3 a, vec3 b, vec3 c, vec3 d, float t) { return t < .35 ? mix(a, b, t / .35) : t < .7 ? mix(b, c, (t - .35) / .35) : mix(c, d, (t - .7) / .3); }
vec2 zVor(vec3 x) { vec3 i = floor(x), f = fract(x); float d1 = 8., d2 = 8.;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int h = -1; h <= 1; h++) { vec3 g = vec3(float(h), float(j), float(k)), o = vec3(zh(i + g), zh(i + g + 17.3), zh(i + g + 31.1)); float d = length(g + o - f); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(d1, d2); }
`;
const LITE = typeof navigator !== 'undefined' && /OculusBrowser|Quest|Android|iPhone/i.test((typeof window !== 'undefined' && window.__UA) || navigator.userAgent);   // headset + phones: lighter fluid shader
function smartMaterial(look) {
  const L = parseLook(look), A = ZSMART[L.a], B = ZSMART[L.b], c = h => new THREE.Color(h);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .5, metalness: 0, envMapIntensity: 1.1 });
  const U = {
    zA0: { value: c(A.col) }, zA1: { value: c(A.cav) }, zA2: { value: c(A.edge) }, zB0: { value: c(B.col) }, zB1: { value: c(B.cav) }, zB2: { value: c(B.edge) },
    zAp: { value: new THREE.Vector4(A.m, A.r, A.em, A.er) }, zBp: { value: new THREE.Vector4(B.m, B.r, B.em, B.er) },
    zAk: { value: new THREE.Vector4(A.cavA, A.edgeA, A.dirt, A.grunge) }, zBk: { value: new THREE.Vector4(B.cavA, B.edgeA, B.dirt, B.grunge) },
    zBump: { value: new THREE.Vector2(A.bump, B.bump) }, zGlobal: { value: new THREE.Vector2(L.dirt, L.wear) }, zScale: { value: 60 },
    zAR0: { value: c(0) }, zAR1: { value: c(0) }, zAR2: { value: c(0) }, zAR3: { value: c(0) }, zBR0: { value: c(0) }, zBR1: { value: c(0) }, zBR2: { value: c(0) }, zBR3: { value: c(0) },
    zAV: { value: c(0) }, zBV: { value: c(0) }, zAF: { value: new THREE.Vector4() }, zBF: { value: new THREE.Vector4() }, zCen: { value: new THREE.Vector4(0, 0, 0, 1) },
  };
  fluidU(U, A, B);
  m.userData.smart = U; m.userData.look = look;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'attribute float zmask;\nattribute vec2 zcav;\nattribute float zpaint;\nvarying float vMask;\nvarying vec2 vCav;\nvarying float vPaint;\nvarying vec3 vOP;\nvarying vec3 vON;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = zmask; vCav = zcav; vPaint = zpaint; vOP = position; vON = normal;');
    sh.fragmentShader = 'varying float vMask;\n' + SMART_GLSL + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  vec3 zp = vOP * zScale;
  float zN1 = zfbm(zp), zN2 = zfbm(zp * 3.1 + 11.), zN3 = zn(zp * 7.);
  float zcf = vCav.x, zcb = vCav.y;
  float zCav = clamp(smoothstep(.02, .09, zcf) * .6 + smoothstep(.01, .05, zcb) * .8, 0., 1.);
  float zEF = smoothstep(.035, .13, -zcf), zEB = smoothstep(.015, .07, -zcb), zEdg = clamp(zEF * .85 + zEB * .3, 0., 1.);
  float zw = smoothstep(.32, .62, vPaint);
  vec4 zK = mix(zAk, zBk, zw), zP = mix(zAp, zBp, zw);
  vec3 zfA = zA0, zfB = zB0; float zVein = 0.;
  if (zAF.x + zBF.x > 0.) {   // FLUID: marbled flow → 4-colour falloff by form (cavity dark … rim light) + pour cells + metallic veins
    vec3 q = vOP * zScale * mix(zAF.w, zBF.w, zw);
#ifdef ZLITE
    vec3 wq = vec3(zn(q), zn(q + 5.2), zn(q + 9.7));
#else
    vec3 wq = vec3(zfbm(q), zfbm(q + 5.2), zfbm(q + 9.7));
#endif
    float s = zfbm(q * 1.6 + wq * 3.);
    float band = smoothstep(.43, .49, s) * smoothstep(.61, .55, s);
    float csz = mix(3.2, 7.5, zn(q * .9 + 4.));                         // pour cells: big + small, stretched along the flow
#ifdef ZLITE
    vec2 vo = vec2(0., 1.);   // Quest: no pour cells (fill rate)
#else
    vec2 vo = zVor(q * csz + wq * 2.6);
#endif
    float ce = vo.y - vo.x;
    float cin = smoothstep(.04, .2, ce) * smoothstep(.75, .3, vo.x) * band, crim = (1. - smoothstep(.0, .045, ce)) * band;
    float zfo = clamp(length(vOP - zCen.xyz) / zCen.w, 0., 1.);            // 0 at the core … 1 at the tips
    float tA = clamp(.3 + (s - .5) * 1.9 - zCav * .9 + zEdg * .35 + zfo * .55, 0., 1.);
    vec3 fA = zRamp(zAR0, zAR1, zAR2, zAR3, tA), fB = zRamp(zBR0, zBR1, zBR2, zBR3, tA);
    fA = mix(fA, zRamp(zAR0, zAR1, zAR2, zAR3, min(1., tA + .4)), cin * zAF.y); fA = mix(fA, zAR0, crim * zAF.y * .6);
    fB = mix(fB, zRamp(zBR0, zBR1, zBR2, zBR3, min(1., tA + .4)), cin * zBF.y); fB = mix(fB, zBR0, crim * zBF.y * .6);
    zfA = mix(zA0, fA, zAF.x); zfB = mix(zB0, fB, zBF.x);
    float vv = abs(zfbm(q * 2.3 + wq * 2.2 + 3.) - .5); zVein = (1. - smoothstep(.007, .022, vv)) * mix(zAF.z, zBF.z, zw);
  }
  vec3 zc0 = mix(zfA, zfB, zw), zc1 = mix(zA1, zB1, zw), zc2 = mix(zA2, zB2, zw);
  float zdown = smoothstep(.1, -.8, normalize(vON).y);
  float zDirt = clamp((zCav * zK.x + zdown * zK.z * .35 + (zN2 - .45) * zK.z * .5) * (.35 + zGlobal.x * 1.1), 0., 1.);
  float zWear = smoothstep(.5, .66, zEdg * zK.y * (.35 + zGlobal.y * 1.1) + (zN3 - .5) * .55 * zK.w + (zN1 - .5) * .25);
  vec3 zcol = zc0 * (1. + (zN1 - .5) * .22 * zK.w);
  zcol = mix(zcol, zc1, zDirt * .92);
  zcol = mix(zcol, zc2, zWear); zcol += (zc2 - zcol) * zEB * .12 * zK.y;   // + a soft edge highlight
  zcol = mix(zcol, mix(zAV, zBV, zw), zVein);
  diffuseColor.rgb = zcol * (1. - vMask * .62);
  float zMetal = mix(mix(zP.x, zP.z, zWear) * (1. - zDirt * .5), 1., zVein);
  float zRough = mix(clamp(mix(zP.y, zP.w, zWear) + zDirt * .35 + (zN2 - .5) * .18 * zK.w, .03, 1.), .16, zVein);
  float zH = (zN2 * .6 + zN3 * .4) * mix(zBump.x, zBump.y, zw) + zWear * .25 * mix(zBump.x, zBump.y, zw);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = zRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = zMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition); float hx = dFdx(zH) * .0025, hy = dFdy(zH) * .0025;
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1); vec3 gr = sign(det) * (hx * r1 + hy * r2);
    if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - gr); }`);
  };
  if (LITE) m.defines = { ZLITE: 1 };
  m.customProgramCacheKey = () => 'zsmart2' + (LITE ? 'L' : '');
  return m;
}
function updateSmart(m, look) {   // same program, new numbers (sliders, other materials) → no recompile
  const L = parseLook(look), A = ZSMART[L.a], B = ZSMART[L.b], U = m.userData.smart;
  U.zA0.value.set(A.col); U.zA1.value.set(A.cav); U.zA2.value.set(A.edge); U.zB0.value.set(B.col); U.zB1.value.set(B.cav); U.zB2.value.set(B.edge);
  U.zAp.value.set(A.m, A.r, A.em, A.er); U.zBp.value.set(B.m, B.r, B.em, B.er); U.zAk.value.set(A.cavA, A.edgeA, A.dirt, A.grunge); U.zBk.value.set(B.cavA, B.edgeA, B.dirt, B.grunge);
  U.zBump.value.set(A.bump, B.bump); U.zGlobal.value.set(L.dirt, L.wear); fluidU(U, A, B); m.userData.look = look;
}
function fluidU(U, A, B) {
  for (const [M, p] of [[A, 'zA'], [B, 'zB']]) {
    const r = M.ramp || [M.cav, M.col, M.col, M.edge]; for (let k = 0; k < 4; k++) U[p + 'R' + k].value.set(r[k]);
    U[p + 'V'].value.set(M.vein || M.edge); U[p + 'F'].value.set(M.ramp ? 1 : 0, M.cells || 0, M.veins || 0, M.flow || .13);
  }
}
function zMaterial(look, hasColor) {
  if (parseLook(look)) return smartMaterial(look);
  const m = look === 'pbr' ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .62, metalness: 0, vertexColors: hasColor })
    : new THREE.MeshMatcapMaterial({ matcap: matcap(hasColor && look === 'clay' ? 'white' : look), color: 0xffffff, vertexColors: hasColor });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute float zmask;\nvarying float vMask;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = zmask;');
    sh.fragmentShader = 'varying float vMask;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1. - vMask * .62;');
  };
  m.customProgramCacheKey = () => 'zmask-' + look + (hasColor ? 'c' : '');
  return m;
}

// the FLUID shader on the CPU (same maths) → GLB / Blender get the colour falloffs baked into vertex colours
const fr = x => x - Math.floor(x);
function czh(x, y, z) { x = fr(x * .3183099 + .1) * 17; y = fr(y * .3183099 + .1) * 17; z = fr(z * .3183099 + .1) * 17; return fr(x * y * z * (x + y + z)); }
function czn(x, y, z) { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let fx = x - ix, fy = y - iy, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(czh(ix, iy, iz), czh(ix + 1, iy, iz), fx), L(czh(ix, iy + 1, iz), czh(ix + 1, iy + 1, iz), fx), fy), L(L(czh(ix, iy, iz + 1), czh(ix + 1, iy, iz + 1), fx), L(czh(ix, iy + 1, iz + 1), czh(ix + 1, iy + 1, iz + 1), fx), fy), fz); }
const cfbm = (x, y, z) => czn(x, y, z) * .55 + czn(x * 2.13 + 7, y * 2.13 + 7, z * 2.13 + 7) * .28 + czn(x * 4.7 + 3, y * 4.7 + 3, z * 4.7 + 3) * .17;
function cvor(x, y, z) { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz; let d1 = 8, d2 = 8;
  for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let h = -1; h <= 1; h++) { const X = ix + h, Y = iy + j, Z = iz + k, d = Math.hypot(h + czh(X, Y, Z) - fx, j + czh(X + 17.3, Y + 17.3, Z + 17.3) - fy, k + czh(X + 31.1, Y + 31.1, Z + 31.1) - fz); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return [d1, d2]; }
const css = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function cramp(R, t, out) { const [a, b, c, d] = R; if (t < .35) out.copy(a).lerp(b, t / .35); else if (t < .7) out.copy(b).lerp(c, (t - .35) / .35); else out.copy(c).lerp(d, (t - .7) / .3); return out; }
// one vertex: fluid base colour of material M (ramp as Colors) at object point (x, y, z), with cavity / edge / core→tip falloff
function fluidCPU(M, R, x, y, z, cav, edg, fo, out, tmp) {
  const k = 60 * (M.flow || .13), qx = x * k, qy = y * k, qz = z * k;
  const wx = cfbm(qx, qy, qz), wy = cfbm(qx + 5.2, qy + 5.2, qz + 5.2), wz = cfbm(qx + 9.7, qy + 9.7, qz + 9.7), s = cfbm(qx * 1.6 + wx * 3, qy * 1.6 + wy * 3, qz * 1.6 + wz * 3);
  const band = css(.43, .49, s) * css(.61, .55, s), csz = 3.2 + 4.3 * czn(qx * .9 + 4, qy * .9 + 4, qz * .9 + 4);
  const [v1, v2] = cvor(qx * csz + wx * 2.6, qy * csz + wy * 2.6, qz * csz + wz * 2.6), ce = v2 - v1, cin = css(.04, .2, ce) * css(.75, .3, v1) * band, crim = (1 - css(0, .045, ce)) * band;
  const t = Math.min(1, Math.max(0, .3 + (s - .5) * 1.9 - cav * .9 + edg * .35 + fo * .55));
  cramp(R, t, out); out.lerp(cramp(R, Math.min(1, t + .4), tmp), cin * (M.cells || 0)); out.lerp(R[0], crim * (M.cells || 0) * .6);
  const vv = Math.abs(cfbm(qx * 2.3 + wx * 2.2 + 3, qy * 2.3 + wy * 2.2 + 3, qz * 2.3 + wz * 2.2 + 3) - .5); return (1 - css(.007, .022, vv)) * (M.veins || 0);
}

// ---------------------------------------------------------------- geometry helpers
export function icosphere(level, radius) {
  const t = (1 + Math.sqrt(5)) / 2; let P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(v => { const l = Math.hypot(...v); return v.map(c => c / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const mid = new Map(), nf = [];
    const m = (a, b) => { const k = a < b ? a * 1e7 + b : b * 1e7 + a; let i = mid.get(k); if (i === undefined) { const v = [P[a][0] + P[b][0], P[a][1] + P[b][1], P[a][2] + P[b][2]], ln = Math.hypot(...v); i = P.length; P.push(v.map(c => c / ln)); mid.set(k, i); } return i; };
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = nf;
  }
  const pos = new Float32Array(P.length * 3); P.forEach((v, i) => { pos[i * 3] = v[0] * radius; pos[i * 3 + 1] = v[1] * radius; pos[i * 3 + 2] = v[2] * radius; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(F.flat()), 1)); return g;
}
// vertices in Morton order → a brush touches a short index range (small GPU uploads, cache friendly)
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
const z8 = a => zlibSync(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), { level: 4 });

// ---------------------------------------------------------------- the sculptable mesh
export class ZMesh {
  constructor(rec, geo, keep) {
    this.rec = rec; this.look = rec.look || 'clay';
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), null); this.mesh.userData.z = this; this.mesh.raycast = acceleratedRaycast;
    this.setGeometry(geo, keep); if (keep) this.sentGid = rec.gid;
  }
  // ---- (re)build everything from a geometry (create · subdivide · load · voxel → Z)
  setGeometry(geo, keepTopo) {
    if (!geo.index) geo = mergeVertices(geo, 1e-6);
    const c0 = geo.attributes.color ? geo.attributes.color.array : null, m0 = geo.attributes.zmask ? geo.attributes.zmask.array : null, w0 = geo.attributes.zpaint ? geo.attributes.zpaint.array : null;
    // a mesh from another device / a save keeps ITS vertex order (live edits travel by vertex index); new topology gets Morton order
    const R = keepTopo || (geo.userData && geo.userData.ordered) ? {   // (DynaMesh results arrive already in Morton order from the worker)
 pos: Float32Array.from(geo.attributes.position.array), idx: Uint32Array.from(geo.index.array), extra: [c0 ? Float32Array.from(c0) : null, m0 ? Float32Array.from(m0) : null, w0 ? Float32Array.from(w0) : null] }
      : mortonOrder(geo.attributes.position.array, geo.index.array, [[c0, 3], [m0, 1], [w0, 1]]);
    const n = R.pos.length / 3, F = R.idx.length / 3;
    this.n = n; this.F = F; this.pos = R.pos; this.idx = R.idx;
    this.col = R.extra[0]; this.mask = R.extra[1] || new Float32Array(n); this.paint = R.extra[2] || new Float32Array(n); this.cav = new Float32Array(n * 2); this.cr = new Float32Array(n); this.cx = new Float32Array(n); this.cx2 = new Float32Array(n); this.nrm = new Float32Array(n * 3); this.fn = new Float32Array(F * 3);
    // GPU geometry + picking tree FIRST: the BVH re-orders the triangles in place → adjacency must be built after it
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('zmask', new THREE.BufferAttribute(this.mask, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('zpaint', new THREE.BufferAttribute(this.paint, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('zcav', new THREE.BufferAttribute(this.cav, 2).setUsage(THREE.DynamicDrawUsage));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(new THREE.BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    g.boundsTree = new MeshBVH(g, { targetLeafSize: 12 });
    this.idx = R.idx = g.index.array;
    // vertex → faces and vertex → neighbours (CSR)
    const cnt = new Uint32Array(n + 1); for (let i = 0; i < R.idx.length; i++) cnt[R.idx[i] + 1]++;
    for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
    const vf = new Uint32Array(R.idx.length), fill = cnt.slice(0, n); for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) { const v = R.idx[f * 3 + k]; vf[fill[v]++] = f; }
    this.vfS = cnt; this.vf = vf;
    const nb = [], ns = new Uint32Array(n + 1), seen = new Int32Array(n).fill(-1);
    for (let v = 0; v < n; v++) { for (let j = cnt[v]; j < cnt[v + 1]; j++) { const f = vf[j]; for (let k = 0; k < 3; k++) { const u = R.idx[f * 3 + k]; if (u !== v && seen[u] !== v) { seen[u] = v; nb.push(u); } } } ns[v + 1] = nb.length; }
    this.vvS = ns; this.vv = Uint32Array.from(nb);
    // average edge → grid cell, spacing hints
    let el = 0; const ne = Math.min(F, 4000); for (let f = 0; f < ne; f++) { const a = R.idx[f * 3], b = R.idx[f * 3 + 1]; el += Math.hypot(R.pos[a * 3] - R.pos[b * 3], R.pos[a * 3 + 1] - R.pos[b * 3 + 1], R.pos[a * 3 + 2] - R.pos[b * 3 + 2]); }
    this.edge = el / Math.max(1, ne);
    this.cmark = new Uint32Array(n); this.cgen = 1; this.cq = []; this.stamp = new Uint32Array(n); this.stampN = 1; this.fstamp = new Uint32Array(F); this.fstampN = 1;
    this.ids = new Int32Array(n); this.wts = new Float32Array(n); this.tmp = new Float32Array(n * 3);
    this.allNormals(); this.allCurv(); g.attributes.normal.needsUpdate = true;
    const old = this.mesh.geometry; this.mesh.geometry = g; if (old) { old.boundsTree = null; old.dispose(); }
    this.setLook(this.look, true); this.centre();
    this.buildGrid(); this.lo = 1e9; this.hi = -1; this.drift = 0; this.refitT = 0;
    this.topo = (this.topo || 0) + 1; if (!keepTopo || !this.rec.gid) this.rec.gid = Math.random().toString(36).slice(2, 10);
    this.sync = new Set(); this.ver = (this.ver || 0) + 1;
  }
  centre() { const U = this.mesh.material && this.mesh.material.userData.smart, bs = this.mesh.geometry.boundingSphere; if (U && bs) U.zCen.value.set(bs.center.x, bs.center.y, bs.center.z, Math.max(1e-4, bs.radius)); }
  setLook(look, force) {
    if (!force && look === this.look) return; this.look = look; this.rec.look = look;
    const old = this.mesh.material;
    if (old && old.userData.smart && parseLook(look)) { updateSmart(old, look); return; }   // slider / material swap: same shader
    this.mesh.material = zMaterial(look, !!this.col); if (old && old !== this.mesh.material) old.dispose(); this.centre();
  }
  // ---- normals (area-weighted)
  faceN(f) {
    const I = this.idx, P = this.pos, a = I[f * 3] * 3, b = I[f * 3 + 1] * 3, c = I[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    this.fn[f * 3] = uy * vz - uz * vy; this.fn[f * 3 + 1] = uz * vx - ux * vz; this.fn[f * 3 + 2] = ux * vy - uy * vx;
  }
  vertN(v) {
    let x = 0, y = 0, z = 0; for (let j = this.vfS[v]; j < this.vfS[v + 1]; j++) { const f = this.vf[j] * 3; x += this.fn[f]; y += this.fn[f + 1]; z += this.fn[f + 2]; }
    const l = Math.hypot(x, y, z) || 1; this.nrm[v * 3] = x / l; this.nrm[v * 3 + 1] = y / l; this.nrm[v * 3 + 2] = z / l;
  }
  allNormals() { for (let f = 0; f < this.F; f++) this.faceN(f); for (let v = 0; v < this.n; v++) this.vertN(v); }
  // ---- curvature for the live material: raw = n·(neighbour centre − p) / summed edge  (+ = cavity, − = rim);  fine = 1 blur, broad = 3 blurs
  rawCurv(v) {
    const P = this.pos, N = this.nrm, a = this.vvS[v], b = this.vvS[v + 1], j = v * 3; if (b === a) return 0; let x = 0, y = 0, z = 0, e = 0;
    for (let q = a; q < b; q++) { const u = this.vv[q] * 3, dx = P[u] - P[j], dy = P[u + 1] - P[j + 1], dz = P[u + 2] - P[j + 2]; x += dx; y += dy; z += dz; e += Math.sqrt(dx * dx + dy * dy + dz * dz); }
    return (x * N[j] + y * N[j + 1] + z * N[j + 2]) / (e + 1e-12);
  }
  blurInto(src, v) { let s = src[v], c = 1; for (let q = this.vvS[v]; q < this.vvS[v + 1]; q++) { s += src[this.vv[q]]; c++; } return s / c; }
  allCurv() {
    const n = this.n, C = this.cav, t = this.tmp; for (let v = 0; v < n; v++) this.cr[v] = this.rawCurv(v);
    for (let v = 0; v < n; v++) { this.cx[v] = this.blurInto(this.cr, v); C[v * 2] = this.cx[v]; }
    for (let v = 0; v < n; v++) this.cx2[v] = this.blurInto(this.cx, v);
    for (let v = 0; v < n; v++) t[v] = this.blurInto(this.cx2, v);
    for (let v = 0; v < n; v++) C[v * 2 + 1] = t[v];
  }
  grow(list) { const s = ++this.stampN, out = []; for (const v of list) if (this.stamp[v] !== s) { this.stamp[v] = s; out.push(v); } const k = out.length; for (let q = 0; q < k; q++) { const v = out[q]; for (let j = this.vvS[v]; j < this.vvS[v + 1]; j++) { const u = this.vv[j]; if (this.stamp[u] !== s) { this.stamp[u] = s; out.push(u); } } } return out; }
  curvUpdate(ring) {
    for (const v of ring) this.cr[v] = this.rawCurv(v);
    const L1 = this.grow(ring); for (const v of L1) { this.cx[v] = this.blurInto(this.cr, v); this.cav[v * 2] = this.cx[v]; }
    const L2 = this.grow(L1); for (const v of L2) this.cx2[v] = this.blurInto(this.cx, v);
    const L3 = this.grow(L2), t = this.tmp; for (let q = 0; q < L3.length; q++) t[q] = this.blurInto(this.cx2, L3[q]);
    for (let q = 0; q < L3.length; q++) { const v = L3[q]; this.cav[v * 2 + 1] = t[q]; if (v < this.lo) this.lo = v; if (v > this.hi) this.hi = v; }
  }
  refreshNormals(list, m) {   // touched vertices → their faces → the vertices of those faces
    const fs = ++this.fstampN, vs = ++this.stampN, ring = [];
    for (let q = 0; q < m; q++) { const v = list[q]; for (let j = this.vfS[v]; j < this.vfS[v + 1]; j++) { const f = this.vf[j]; if (this.fstamp[f] !== fs) { this.fstamp[f] = fs; this.faceN(f); for (let k = 0; k < 3; k++) { const u = this.idx[f * 3 + k]; if (this.stamp[u] !== vs) { this.stamp[u] = vs; ring.push(u); } } } } }
    for (const u of ring) { this.vertN(u); if (u < this.lo) this.lo = u; if (u > this.hi) this.hi = u; }
    for (const u of ring) if (this.cmark[u] !== this.cgen) { this.cmark[u] = this.cgen; this.cq.push(u); }   // curvature: once a frame (flush)
  }
  // ---- spatial hash grid over the vertices
  buildGrid() {
    const n = this.n, h = this.cell = Math.max(this.edge * 3, 1e-5), T = this.T = 1 << Math.ceil(Math.log2(n * 2)), P = this.pos;
    const key = this.key = new Uint32Array(n), start = new Uint32Array(T + 1);
    for (let i = 0; i < n; i++) { const k = this.hash(Math.floor(P[i * 3] / h), Math.floor(P[i * 3 + 1] / h), Math.floor(P[i * 3 + 2] / h)); key[i] = k; start[k + 1]++; }
    for (let i = 0; i < T; i++) start[i + 1] += start[i];
    const items = new Uint32Array(n), fl = start.slice(0, T); for (let i = 0; i < n; i++) items[fl[key[i]]++] = i;
    this.gS = start; this.gI = items; this.drift = 0;
  }
  hash(x, y, z) { return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (this.T - 1); }
  // all vertices within r of c → this.ids[0..m), squared distances in this.wts
  query(cx, cy, cz, r) {
    const R = r + this.drift, h = this.cell, P = this.pos, s = ++this.stampN, R2 = r * r;
    const x0 = Math.floor((cx - R) / h), x1 = Math.floor((cx + R) / h), y0 = Math.floor((cy - R) / h), y1 = Math.floor((cy + R) / h), z0 = Math.floor((cz - R) / h), z1 = Math.floor((cz + R) / h);
    let m = 0;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > this.T) {   // brush bigger than the grid: brute force
      for (let i = 0; i < this.n; i++) { const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz; if (d2 < R2) { this.ids[m] = i; this.wts[m++] = d2; } }
      return m;
    }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const k = this.hash(x, y, z);
      for (let j = this.gS[k]; j < this.gS[k + 1]; j++) { const i = this.gI[j]; if (this.stamp[i] === s) continue; this.stamp[i] = s;
        const dx = P[i * 3] - cx, dy = P[i * 3 + 1] - cy, dz = P[i * 3 + 2] - cz, d2 = dx * dx + dy * dy + dz * dz; if (d2 < R2) { this.ids[m] = i; this.wts[m++] = d2; } }
    }
    return m;
  }
  // nearest surface point to p (VR tip) within r → {p, n} or null
  nearest(p, r) {
    const m = this.query(p.x, p.y, p.z, r); if (!m) return null; let b = 0; for (let q = 1; q < m; q++) if (this.wts[q] < this.wts[b]) b = q;
    const i = this.ids[b]; return { p: new THREE.Vector3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), n: new THREE.Vector3(this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]), d: Math.sqrt(this.wts[b]) };
  }
  // area normal + centre under the brush (what ZBrush calls the brush plane)
  area(c, r) {
    const m = this.query(c.x, c.y, c.z, r), P = this.pos, N = this.nrm; let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0, ws = 0;
    for (let q = 0; q < m; q++) { const i = this.ids[q], w = 1 - Math.sqrt(this.wts[q]) / r; nx += N[i * 3] * w; ny += N[i * 3 + 1] * w; nz += N[i * 3 + 2] * w; px += P[i * 3] * w; py += P[i * 3 + 1] * w; pz += P[i * 3 + 2] * w; ws += w; }
    if (ws <= 0) return null; const l = Math.hypot(nx, ny, nz) || 1;
    return { n: new THREE.Vector3(nx / l, ny / l, nz / l), p: new THREE.Vector3(px / ws, py / ws, pz / ws), m };
  }
  // ---- stroke bookkeeping (undo + sync)
  begin() { this.st = { ids: [], orig: [], om: [], ow: [], at: new Map() }; }
  remember(i) { const s = this.st; if (!s || s.at.has(i)) return; s.at.set(i, s.ids.length); s.ids.push(i); s.orig.push(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); s.om.push(this.mask[i]); s.ow.push(this.paint[i]); }
  end() {
    const s = this.st; this.st = null; if (!s || !s.ids.length) return null;
    const ids = Uint32Array.from(s.ids), a = Float32Array.from(s.orig), am = Float32Array.from(s.om), aw = Float32Array.from(s.ow), b = new Float32Array(a.length), bm = new Float32Array(am.length), bw = new Float32Array(aw.length);
    for (let q = 0; q < ids.length; q++) { const i = ids[q]; b[q * 3] = this.pos[i * 3]; b[q * 3 + 1] = this.pos[i * 3 + 1]; b[q * 3 + 2] = this.pos[i * 3 + 2]; bm[q] = this.mask[i]; bw[q] = this.paint[i]; }
    this.settle(); const topo = this.topo;
    const put = (P, M, Wp) => { if (this.topo !== topo) return; for (let q = 0; q < ids.length; q++) { const i = ids[q]; this.pos[i * 3] = P[q * 3]; this.pos[i * 3 + 1] = P[q * 3 + 1]; this.pos[i * 3 + 2] = P[q * 3 + 2]; this.mask[i] = M[q]; this.paint[i] = Wp[q]; this.sync.add(i); } this.refreshNormals(ids, ids.length); this.markMask(ids); this.settle(); this.ver++; };
    return { undo: () => put(a, am, aw), redo: () => put(b, bm, bw), ids, orig: a };
  }
  markMask(ids) { for (const i of ids) { if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i; } this.maskDirty = true; }
  // after a stroke: exact grid + picking tree
  settle() { this.buildGrid(); this.mesh.geometry.boundsTree.refit(); this.mesh.geometry.computeBoundingSphere(); this.mesh.geometry.computeBoundingBox(); this.flush(true); }
  // upload the touched index range (once a frame)
  flush(all) {
    if (this.cq.length) { this.curvUpdate(this.cq); this.cq = []; this.cgen++; }
    if (this.hi < this.lo && !all) return;
    const g = this.mesh.geometry, lo = all ? 0 : this.lo, hi = all ? this.n - 1 : this.hi;
    for (const [k, s] of [['position', 3], ['normal', 3], ['zmask', 1], ['zpaint', 1], ['zcav', 2]]) { const A = g.attributes[k]; A.clearUpdateRanges(); A.addUpdateRange(lo * s, (hi - lo + 1) * s); A.needsUpdate = true; }
    this.lo = 1e9; this.hi = -1;
    if (this.drift > this.cell * .6) this.buildGrid();
    const t = performance.now(); if (this.dirtyBVH && t - this.refitT > 220) { this.refitT = t; this.dirtyBVH = false; g.boundsTree.refit(); }
  }

  // ---------------------------------------------------------------- ONE DAB. c = centre (local), r = radius, o = { brush, k (signed strength), alpha, tiles, rot, dir (stroke direction), focal, plane, sym }
  //  sym: X symmetry in ONE pass — every vertex is brushed from the centre on its own side (nothing twice, the seam stays clean)
  dab(c, r, o) {
    const br = o.brush; if (br === 'move' || br === 'snake') return 0;
    const useA = o.alpha && ZBRUSHES[br].alpha, qr = useA ? r * 1.415 : r;
    const ar = o.plane || this.area(c, r); if (!ar) return 0;
    const N = ar.n.clone(), ap = ar.p.clone();
    if (o.sym) { const t = sm(0, 1, Math.abs(c.x) / qr); N.x *= t; N.normalize(); ap.x *= t; }   // brush over the seam: its plane becomes symmetric too (no ridge down the middle)
    // brush frame for the alpha: T along the stroke (or a stable axis), B = N × T, then the alpha's own turn
    let T = o.dir ? o.dir.clone().addScaledVector(N, -o.dir.dot(N)) : new THREE.Vector3(); if (T.lengthSq() < 1e-10) T.set(1, 0, 0).addScaledVector(N, -N.x); if (T.lengthSq() < 1e-10) T.set(0, 0, 1).addScaledVector(N, -N.z); T.normalize();
    if (o.rot) T.applyAxisAngle(N, o.rot); const B = new THREE.Vector3().crossVectors(N, T);
    const off = br === 'clay' ? r * .12 * Math.sign(o.k) : br === 'buildup' ? r * .2 * Math.sign(o.k) : br === 'trim' ? -r * .02 : 0;
    const F0 = { c, N, T, B, pp: ap.addScaledVector(N, off) }, mx = v => new THREE.Vector3(-v.x, v.y, v.z);
    const sym = !!o.sym, F1 = sym ? { c: mx(c), N: mx(N), T: mx(T), B: mx(B), pp: mx(F0.pp) } : F0;
    // who is under the brush (both sides, once each)
    let m = this.query(c.x, c.y, c.z, qr); let ID = this.ids.slice(0, m);
    if (sym) {
      const s = ++this.stampN; for (let q = 0; q < m; q++) this.stamp[ID[q]] = s;
      const m2 = this.query(-c.x, c.y, c.z, qr), extra = []; for (let q = 0; q < m2; q++) { const i = this.ids[q]; if (this.stamp[i] !== s) extra.push(i); }
      if (extra.length) { const nI = new Int32Array(m + extra.length); nI.set(ID); nI.set(extra, m); ID = nI; m = ID.length; }
    }
    if (!m) return 0;
    const P = this.pos, NR = this.nrm, M = this.mask, k = o.k, foc = o.focal || 0, ex = Math.pow(2, foc * 2.2), tiles = o.tiles, A = o.alpha;
    const W = new Float32Array(m), SIDE = new Uint8Array(m);
    let wsum = 0;
    for (let q = 0; q < m; q++) {
      const i = ID[q], j = i * 3, side = sym && P[j] * c.x < 0 ? 1 : 0, f = side ? F1 : F0; SIDE[q] = side;
      const dx = P[j] - f.c.x, dy = P[j + 1] - f.c.y, dz = P[j + 2] - f.c.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) / r; let w;
      if (d * r >= qr) { W[q] = 0; continue; }
      if (useA) {
        const u = (dx * f.T.x + dy * f.T.y + dz * f.T.z) / r, v = (dx * f.B.x + dy * f.B.y + dz * f.B.z) / r;
        w = sampleA(A, tiles ? u * .5 * (o.tile || 1) + .5 : u * .5 + .5, tiles ? v * .5 * (o.tile || 1) + .5 : v * .5 + .5, tiles);
        if (tiles) w *= sm(1, .7, d); else w *= sm(1, .9, Math.max(Math.abs(u), Math.abs(v)));
        if (o.round) w *= 1 - sm(0, 1, Math.pow(Math.min(1, d), ex));
      } else { if (d >= 1) { W[q] = 0; continue; } w = 1 - sm(0, 1, Math.pow(d, ex)); }
      if (br !== 'mask') w *= 1 - M[i];
      W[q] = w; wsum += w;
    }
    if (wsum <= 0) return 0;
    if (this.st) for (let q = 0; q < m; q++) if (W[q] > 0) this.remember(ID[q]);
    let moved = 0;
    if (br === 'paint') {   // 2nd material: + paints, ZSub erases
      const Wp = this.paint; for (let q = 0; q < m; q++) { if (W[q] <= 0) continue; const i = ID[q]; Wp[i] = Math.min(1, Math.max(0, Wp[i] + W[q] * k * 1.6)); if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i; this.sync.add(i); }
      this.ver++; return m;
    }
    if (br === 'mask') {
      for (let q = 0; q < m; q++) { if (W[q] <= 0) continue; const i = ID[q]; M[i] = Math.min(1, Math.max(0, M[i] + W[q] * k * 1.2)); if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i; this.sync.add(i); }
      this.maskDirty = true; this.ver++; return m;
    }
    const s = r * .06 * k;
    if (br === 'smooth') {
      const t = this.tmp, kk = Math.min(1, Math.abs(k) * .9);
      for (let q = 0; q < m; q++) { const i = ID[q]; let x = 0, y = 0, z = 0; const a = this.vvS[i], b = this.vvS[i + 1]; for (let j = a; j < b; j++) { const u = this.vv[j] * 3; x += P[u]; y += P[u + 1]; z += P[u + 2]; } const nn = Math.max(1, b - a); t[q * 3] = x / nn; t[q * 3 + 1] = y / nn; t[q * 3 + 2] = z / nn; }
      for (let q = 0; q < m; q++) { const i = ID[q], w = W[q] * kk; if (w <= 0) continue; const ax = t[q * 3] - P[i * 3], ay = t[q * 3 + 1] - P[i * 3 + 1], az = t[q * 3 + 2] - P[i * 3 + 2]; P[i * 3] += ax * w; P[i * 3 + 1] += ay * w; P[i * 3 + 2] += az * w; moved = Math.max(moved, Math.hypot(ax, ay, az) * w); }
    } else {
      for (let q = 0; q < m; q++) {
        const w = W[q]; if (w <= 0) continue; const i = ID[q], j = i * 3, f = SIDE[q] ? F1 : F0, Nf = f.N; let dx = 0, dy = 0, dz = 0;
        if (br === 'standard') { dx = Nf.x * s * w; dy = Nf.y * s * w; dz = Nf.z * s * w; }
        else if (br === 'inflate') { dx = NR[j] * s * w; dy = NR[j + 1] * s * w; dz = NR[j + 2] * s * w; }
        else if (br === 'layer') {   // one height per stroke, measured from where the vertex was when the stroke began
          const st = this.st, q0 = st ? st.at.get(i) : undefined; if (q0 === undefined) continue;
          const ox = st.orig[q0 * 3], oy = st.orig[q0 * 3 + 1], oz = st.orig[q0 * 3 + 2], H = r * .09 * Math.sign(k) * Math.min(1.4, Math.abs(k) * 1.5) * w;
          const cur = (P[j] - ox) * Nf.x + (P[j + 1] - oy) * Nf.y + (P[j + 2] - oz) * Nf.z, g = k > 0 ? Math.max(0, H - cur) : Math.min(0, H - cur);
          dx = Nf.x * g; dy = Nf.y * g; dz = Nf.z * g;
        } else if (br === 'planar') {   // hPolish: straight onto the stroke's plane, hard
          const h = (f.pp.x - P[j]) * Nf.x + (f.pp.y - P[j + 1]) * Nf.y + (f.pp.z - P[j + 2]) * Nf.z, g = h * Math.min(1, Math.abs(k) * 1.4) * Math.min(1, w * 2.2);
          dx = Nf.x * g; dy = Nf.y * g; dz = Nf.z * g;
        }
        else if (br === 'clay' || br === 'buildup' || br === 'flatten' || br === 'trim') {
          const h = (f.pp.x - P[j]) * Nf.x + (f.pp.y - P[j + 1]) * Nf.y + (f.pp.z - P[j + 2]) * Nf.z;            // + = vertex below the plane
          let g = br === 'flatten' ? h : br === 'trim' ? Math.min(0, h) : (k > 0 ? Math.max(0, h) : Math.min(0, h));
          g *= Math.min(1, Math.abs(k) * (br === 'buildup' ? .7 : .45)) * w; dx = Nf.x * g; dy = Nf.y * g; dz = Nf.z * g;
        } else if (br === 'pinch' || br === 'dam') {
          let tx = f.c.x - P[j], ty = f.c.y - P[j + 1], tz = f.c.z - P[j + 2]; const tn = tx * Nf.x + ty * Nf.y + tz * Nf.z; tx -= Nf.x * tn; ty -= Nf.y * tn; tz -= Nf.z * tn;
          if (br === 'dam' && o.dir) { const along = tx * f.T.x + ty * f.T.y + tz * f.T.z; tx -= f.T.x * along; ty -= f.T.y * along; tz -= f.T.z * along; }   // pinch across the stroke only
          const pk = Math.min(.25, Math.abs(k) * (br === 'dam' ? .14 : .1)) * w; dx = tx * pk; dy = ty * pk; dz = tz * pk;
          if (br === 'dam') { const cut = -s * .8 * w; dx += Nf.x * cut; dy += Nf.y * cut; dz += Nf.z * cut; }
        }
        P[j] += dx; P[j + 1] += dy; P[j + 2] += dz; const mv = Math.abs(dx) + Math.abs(dy) + Math.abs(dz); if (mv > moved) moved = mv;
      }
      // auto relax: vertices slide ALONG the surface toward their neighbours' centre → no stretched triangles / facets, volume stays
      const t = this.tmp, rk = (br === 'layer' || br === 'planar' ? .08 : 1) * (this.relax ?? .3);
      if (rk > 0) {
        for (let q = 0; q < m; q++) { if (W[q] <= 0) continue; const i = ID[q]; let x = 0, y = 0, z = 0; const a = this.vvS[i], b = this.vvS[i + 1]; for (let j = a; j < b; j++) { const u = this.vv[j] * 3; x += P[u]; y += P[u + 1]; z += P[u + 2]; } const nn = Math.max(1, b - a); t[q * 3] = x / nn; t[q * 3 + 1] = y / nn; t[q * 3 + 2] = z / nn; }
        for (let q = 0; q < m; q++) { const w = W[q]; if (w <= 0) continue; const j = ID[q] * 3; let ax = t[q * 3] - P[j], ay = t[q * 3 + 1] - P[j + 1], az = t[q * 3 + 2] - P[j + 2]; const dn = ax * NR[j] + ay * NR[j + 1] + az * NR[j + 2]; ax -= NR[j] * dn; ay -= NR[j + 1] * dn; az -= NR[j + 2] * dn; const f = rk * Math.min(1, w * 1.5); P[j] += ax * f; P[j + 1] += ay * f; P[j + 2] += az * f; }
      }
    }
    for (let q = 0; q < m; q++) if (W[q] > 0) this.sync.add(ID[q]);
    this.drift += moved; this.dirtyBVH = true; this.ver++;
    this.refreshNormals(ID, m);
    return m;
  }
  // ---- Move / SnakeHook: grab what is under the brush, then drag it
  grab(c, r, focal = 0) {
    const m = this.query(c.x, c.y, c.z, r), ex = Math.pow(2, focal * 2.2), g = { ids: this.ids.slice(0, m), w: new Float32Array(m), o: new Float32Array(m * 3) };
    for (let q = 0; q < m; q++) { const i = g.ids[q], d = Math.sqrt(this.wts[q]) / r; g.w[q] = (1 - sm(0, 1, Math.pow(d, ex))) * (1 - this.mask[i]); g.o[q * 3] = this.pos[i * 3]; g.o[q * 3 + 1] = this.pos[i * 3 + 1]; g.o[q * 3 + 2] = this.pos[i * 3 + 2]; this.remember(i); }
    return g;
  }
  drag(g, d) {
    const P = this.pos; let mv = 0;
    for (let q = 0; q < g.ids.length; q++) { const i = g.ids[q], w = g.w[q]; P[i * 3] = g.o[q * 3] + d.x * w; P[i * 3 + 1] = g.o[q * 3 + 1] + d.y * w; P[i * 3 + 2] = g.o[q * 3 + 2] + d.z * w; this.sync.add(i); }
    mv = d.length(); this.drift = Math.max(this.drift, mv); this.dirtyBVH = true; this.ver++;
    this.refreshNormals(g.ids, g.ids.length);
  }
  // DragRect: put back what this stamp changed last time (stamp is re-applied live while you drag)
  restore(list) { const s = this.st; if (!s) return; for (let q = 0; q < s.ids.length; q++) { const i = s.ids[q]; if (!list.has(i)) continue; this.pos[i * 3] = s.orig[q * 3]; this.pos[i * 3 + 1] = s.orig[q * 3 + 1]; this.pos[i * 3 + 2] = s.orig[q * 3 + 2]; this.mask[i] = s.om[q]; this.paint[i] = s.ow[q]; this.sync.add(i); if (i < this.lo) this.lo = i; if (i > this.hi) this.hi = i; } }
  // ---- whole-mesh actions
  maskAll(v) { this.begin(); for (let i = 0; i < this.n; i++) { this.remember(i); this.mask[i] = v === 'invert' ? 1 - this.mask[i] : v; this.sync.add(i); } this.flush(true); this.ver++; return this.end(); }
  maskBlur() { this.begin(); const t = new Float32Array(this.n); for (let i = 0; i < this.n; i++) { let s = this.mask[i], c = 1; for (let j = this.vvS[i]; j < this.vvS[i + 1]; j++) { s += this.mask[this.vv[j]]; c++; } t[i] = s / c; } for (let i = 0; i < this.n; i++) if (t[i] !== this.mask[i]) { this.remember(i); this.mask[i] = t[i]; this.sync.add(i); } this.flush(true); this.ver++; return this.end(); }
  // 4× the triangles: new edge points are smoothed (3/8 · 1/8), old points stay → the detail you made is kept
  subdivide() {
    const P = this.pos, I = this.idx, n = this.n, F = this.F, emap = new Map(), np = [], nc = [], nm = [], nw = [];
    const opp = new Map();
    for (let f = 0; f < F; f++) for (let k = 0; k < 3; k++) { const a = I[f * 3 + k], b = I[f * 3 + (k + 1) % 3], c = I[f * 3 + (k + 2) % 3], key = a < b ? a * n + b : b * n + a; const o = opp.get(key); if (o === undefined) opp.set(key, [c]); else o.push(c); }
    const mid = (a, b) => {
      const key = a < b ? a * n + b : b * n + a; let i = emap.get(key); if (i !== undefined) return i; i = n + np.length / 3; emap.set(key, i);
      const o = opp.get(key); let x, y, z;
      if (o && o.length === 2) { const [c, d] = o; x = (P[a * 3] + P[b * 3]) * .375 + (P[c * 3] + P[d * 3]) * .125; y = (P[a * 3 + 1] + P[b * 3 + 1]) * .375 + (P[c * 3 + 1] + P[d * 3 + 1]) * .125; z = (P[a * 3 + 2] + P[b * 3 + 2]) * .375 + (P[c * 3 + 2] + P[d * 3 + 2]) * .125; }
      else { x = (P[a * 3] + P[b * 3]) / 2; y = (P[a * 3 + 1] + P[b * 3 + 1]) / 2; z = (P[a * 3 + 2] + P[b * 3 + 2]) / 2; }
      np.push(x, y, z); if (this.col) nc.push((this.col[a * 3] + this.col[b * 3]) / 2, (this.col[a * 3 + 1] + this.col[b * 3 + 1]) / 2, (this.col[a * 3 + 2] + this.col[b * 3 + 2]) / 2); nm.push((this.mask[a] + this.mask[b]) / 2); nw.push((this.paint[a] + this.paint[b]) / 2);
      return i;
    };
    const ni = new Uint32Array(F * 12);
    for (let f = 0; f < F; f++) { const a = I[f * 3], b = I[f * 3 + 1], c = I[f * 3 + 2], ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); ni.set([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], f * 12); }
    const pos = new Float32Array(n * 3 + np.length); pos.set(P); pos.set(np, n * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(ni, 1));
    if (this.col) { const c = new Float32Array(pos.length); c.set(this.col); c.set(nc, n * 3); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    const mk = new Float32Array(pos.length / 3); mk.set(this.mask); mk.set(nm, n); g.setAttribute('zmask', new THREE.BufferAttribute(mk, 1));
    const pw = new Float32Array(pos.length / 3); pw.set(this.paint); pw.set(nw, n); g.setAttribute('zpaint', new THREE.BufferAttribute(pw, 1));
    this.setGeometry(g);
  }
  // ---- DynaMesh (3D-Coat voxels): see zremesh.js. remeshJob() = what the worker needs; geoFromRemesh() = its answer as a geometry
  remeshJob(target, caps = [], vsLock = 0, maxF = 9e5) {
    return { pos: this.pos.slice(), idx: this.idx.slice(), nrm: this.nrm.slice(), paint: this.paint.slice(), mask: this.mask.slice(), col: this.col ? this.col.slice() : null,
      caps: caps.map(c => ({ a: [c.a.x, c.a.y, c.a.z], b: [c.b.x, c.b.y, c.b.z], ra: c.ra, rb: c.rb })), target, vsLock, maxF };
  }
  static geoFromRemesh(r) {
    if (!r) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3)); g.setIndex(new THREE.BufferAttribute(r.idx, 1));
    g.setAttribute('zpaint', new THREE.BufferAttribute(r.paint, 1)); g.setAttribute('zmask', new THREE.BufferAttribute(r.mask, 1)); if (r.col) g.setAttribute('color', new THREE.BufferAttribute(r.col, 3));
    g.userData.vs = r.vs; g.userData.ordered = !!r.ordered; return g;
  }
  remeshGeo(target, caps = [], vsLock = 0, maxF = 9e5) { return ZMesh.geoFromRemesh(remeshCore(this.remeshJob(target, caps, vsLock, maxF))); }   // inline (tests)
  // after a Smear / SnakeHook pull: how stretched are the triangles around these vertices? (1 = like the rest of the mesh)
  stretch(ids) {
    let mx = 0; const P = this.pos;
    for (let q = 0; q < ids.length; q += 3) { const v = ids[q]; for (let j = this.vvS[v]; j < this.vvS[v + 1]; j++) { const u = this.vv[j]; const l = Math.hypot(P[v * 3] - P[u * 3], P[v * 3 + 1] - P[u * 3 + 1], P[v * 3 + 2] - P[u * 3 + 2]); if (l > mx) mx = l; } }
    return mx / Math.max(1e-9, this.edge);
  }
  tris() { return this.F; }
  // a plain mesh for GLB / Blender: geometry + the live material baked into vertex colours (cavity dirt, worn rims, paint layer)
  exportMesh() {
    const n = this.n, g = new THREE.BufferGeometry(), col = new Float32Array(n * 3), L = parseLook(this.look), ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(), 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.slice(), 3)); g.setIndex(new THREE.BufferAttribute(this.idx.slice(), 1));
    let mat;
    if (L) {
      const A = ZSMART[L.a], B = ZSMART[L.b], c = h => new THREE.Color(h), A0 = c(A.col), A1 = c(A.cav), A2 = c(A.edge), B0 = c(B.col), B1 = c(B.cav), B2 = c(B.edge), t = new THREE.Color(), u = new THREE.Color(), v = new THREE.Color();
      const RA = A.ramp && A.ramp.map(c), RB = B.ramp && B.ramp.map(c), VA = c(A.vein || A.edge), VB = c(B.vein || B.edge), fa = new THREE.Color(), fb = new THREE.Color(), tmp = new THREE.Color();
      this.mesh.geometry.computeBoundingSphere(); const bs = this.mesh.geometry.boundingSphere;
      for (let i = 0; i < n; i++) {
        const cf = this.cav[i * 2], cb = this.cav[i * 2 + 1], cav = Math.min(1, ss(.02, .09, cf) * .6 + ss(.01, .05, cb) * .8), edg = Math.min(1, ss(.035, .13, -cf) * .85 + ss(.015, .07, -cb) * .3), w = ss(.32, .62, this.paint[i]);
        const ka = A.cavA * (1 - w) + B.cavA * w, ke = A.edgeA * (1 - w) + B.edgeA * w, dirt = Math.min(1, cav * ka * (.35 + L.dirt * 1.1)), wear = ss(.5, .66, edg * ke * (.35 + L.wear * 1.1));
        let vein = 0; fa.copy(A0); fb.copy(B0);
        if (RA || RB) { const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2], fo = Math.min(1, Math.hypot(x - bs.center.x, y - bs.center.y, z - bs.center.z) / bs.radius);
          if (RA) vein += fluidCPU(A, RA, x, y, z, cav, edg, fo, fa, tmp) * (1 - w); if (RB) vein += fluidCPU(B, RB, x, y, z, cav, edg, fo, fb, tmp) * w; }
        t.copy(fa).lerp(fb, w); u.copy(A1).lerp(B1, w); v.copy(A2).lerp(B2, w); t.lerp(u, dirt * .92).lerp(v, wear); if (vein > 0) t.lerp(tmp.copy(VA).lerp(VB, w), Math.min(1, vein));
        col[i * 3] = t.r; col[i * 3 + 1] = t.g; col[i * 3 + 2] = t.b;
      }
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: A.r, metalness: A.m });
    } else { col.fill(.7); if (this.col) col.set(this.col); mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .6 }); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, mat); m.name = 'zmesh'; return m;
  }
  // ---- wire format (sync · save): deflated arrays
  pack() { const o = { p: z8(this.pos), i: z8(this.idx), m: z8(this.mask) }; if (this.col) o.c = z8(this.col); if (this.paint.some(v => v > 0)) o.w = z8(this.paint); return o; }
  packBlob() {
    const o = this.pack(), E = new Uint8Array(0), parts = [o.p, o.i, o.m, o.c || E, o.w || E], head = new Uint32Array([0x5a42, ...parts.map(x => x.length)]), out = new Uint8Array(24 + parts.reduce((a, x) => a + x.length, 0));
    out.set(new Uint8Array(head.buffer), 0); let at = 24; for (const x of parts) { out.set(x, at); at += x.length; } return out;
  }
  static geoFromBlob(u8) {
    const v2 = new Uint32Array(u8.slice(0, 4).buffer)[0] === 0x5a42, hl = v2 ? 24 : 16, h = new Uint32Array(u8.slice(v2 ? 4 : 0, hl).buffer), o = {}; let at = hl; ['p', 'i', 'm', 'c', 'w'].slice(0, v2 ? 5 : 4).forEach((k, j) => { if (h[j]) o[k] = u8.slice(at, at + h[j]); at += h[j]; });
    return ZMesh.geoFrom(o);
  }
  packB64() { if (this._b64 && this._b64v === this.ver + ":" + this.topo) return this._b64; const o = this.pack(); for (const k in o) o[k] = b64(o[k]); this._b64v = this.ver + ":" + this.topo; return this._b64 = o; }   // cached until the next edit
  static geoFrom(o) {
    const u = x => { const b = typeof x === 'string' ? unb64(x) : new Uint8Array(x); const r = unzlibSync(b); return r; }, f32 = x => { const r = u(x); return new Float32Array(r.buffer, r.byteOffset, r.byteLength / 4); };
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(f32(o.p).slice(), 3));
    const ir = u(o.i); g.setIndex(new THREE.BufferAttribute(new Uint32Array(ir.buffer, ir.byteOffset, ir.byteLength / 4).slice(), 1));
    if (o.c) g.setAttribute('color', new THREE.BufferAttribute(f32(o.c).slice(), 3)); if (o.m) g.setAttribute('zmask', new THREE.BufferAttribute(f32(o.m).slice(), 1)); if (o.w) g.setAttribute('zpaint', new THREE.BufferAttribute(f32(o.w).slice(), 1));
    return g;
  }
  // live edits: changed vertices (index + position + mask)
  takeEdits() {
    if (!this.sync.size) return null; const ids = Uint32Array.from(this.sync); this.sync.clear();
    const p = new Float32Array(ids.length * 3), m = new Float32Array(ids.length), w = new Float32Array(ids.length);
    for (let q = 0; q < ids.length; q++) { const i = ids[q]; p[q * 3] = this.pos[i * 3]; p[q * 3 + 1] = this.pos[i * 3 + 1]; p[q * 3 + 2] = this.pos[i * 3 + 2]; m[q] = this.mask[i]; w[q] = this.paint[i]; }
    return { i: z8(ids), p: z8(p), m: z8(m), w: z8(w), g: this.rec.gid };
  }
  applyEdits(e) {
    const u = x => unzlibSync(new Uint8Array(x)), ir = u(e.i), pr = u(e.p), mr = u(e.m);
    const ids = new Uint32Array(ir.buffer, ir.byteOffset, ir.byteLength / 4), p = new Float32Array(pr.buffer, pr.byteOffset, pr.byteLength / 4), m = new Float32Array(mr.buffer, mr.byteOffset, mr.byteLength / 4);
    let w = null; if (e.w) { const wr = u(e.w); w = new Float32Array(wr.buffer, wr.byteOffset, wr.byteLength / 4); }
    for (let q = 0; q < ids.length; q++) { const i = ids[q]; if (i >= this.n) continue; this.pos[i * 3] = p[q * 3]; this.pos[i * 3 + 1] = p[q * 3 + 1]; this.pos[i * 3 + 2] = p[q * 3 + 2]; this.mask[i] = m[q]; if (w) this.paint[i] = w[q]; }
    this.refreshNormals(ids, ids.length); this.markMask(ids); this.dirtyBVH = true; this.drift = this.cell; this.ver++; this.flush();
  }
}

// a voxel sculpt (or any mesh) → a Z mesh: merged, welded, coloured
export function geometryFromMeshes(meshes, toLocal) {
  const P = [], C = [], I = []; let base = 0;
  for (const me of meshes) {
    const g = me.geometry, p = g.attributes.position, c = g.attributes.color, idx = g.index, mtx = toLocal ? toLocal(me) : null, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (mtx) v.applyMatrix4(mtx); P.push(v.x, v.y, v.z); if (c) C.push(c.getX(i), c.getY(i), c.getZ(i)); else C.push(1, 1, 1); }
    if (idx) for (let i = 0; i < idx.count; i++) I.push(idx.getX(i) + base); else for (let i = 0; i < p.count; i++) I.push(i + base);
    base += p.count;
  }
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  g = mergeVertices(g, 1e-5); return g;
}
