// bUild sTudio · CHAOS BRUSHES — every stroke = wild geometry + a living material, at the same time (3D watercolours).
//  Recipes studied from real animals (4K wildlife film): fine features (scales, hair) sit on a SEPARATE, bigger colour
//  pattern · dark seams, light ridges · mud / moss on top, pale belly · patterns shrink toward the ends · ±8 % jitter per feature.
//  Everything is a 3D function of the point → carving later REVEALS the pattern inside (like marble / a real animal's fur depth).
import * as THREE from 'three';
import { vnoise, fbm } from './sculpt.js';
import { alphaData, alphaAt } from './alphas.js';
const AK = alphaData('snake keeled'), AB = alphaData('belly scutes'), AD = alphaData('dragon round'), AC = alphaData('croc plates'), AG = alphaData('gecko granules'), AL = alphaData('gila beads');
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- fast noise (no allocations)
const fr = x => x - Math.floor(x);
const hh = (x, y, z) => fr(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
let W1 = 0, W2 = 0, WID = 0, WX = 0, WY = 0, WZ = 0;           // worley: nearest, second, cell id (0..1), nearest point
function wor(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); W1 = W2 = 9;
  for (let c = -1; c <= 1; c++) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const X = xi + a, Y = yi + b, Z = zi + c, px = X + hh(X, Y, Z), py = Y + hh(Y + 7.1, Z, X), pz = Z + hh(Z + 3.3, X, Y);
    const dx = px - x, dy = py - y, dz = pz - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < W1) { W2 = W1; W1 = d; WID = hh(X + 11.3, Y - 4.7, Z + 2.9); WX = px; WY = py; WZ = pz; } else if (d < W2) W2 = d;
  }
}
const sm = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const ridged = (x, y, z) => 1 - Math.abs(fbm(x, y, z) * 2 - 1);
const lin = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const mix3 = (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; };
const mulv = (o, k) => { o[0] *= k; o[1] *= k; o[2] *= k; };

// ---------------------------------------------------------------- recipes
//  geo(x,y,z, nx,ny,nz, s, X) → outward displacement in units of R (stroke base radius); x,y,z already divided by R; s = along-stroke / R
//  col(x,y,z, nx,ny,nz, s, X, g, o) → o = [r, g, b, rough, metal] (linear colour); g = the geo value (seams / ridges)
//  pad = max |displacement| (R) · extra = what sprouts from the stroke
const P = pals => pals.map(lin);
// scale coordinates on a body: around = ang / 2π (seamless when the tile count is whole)
// LIVE SKIN per recipe: [alpha, belly alpha, tile size in body radii] — the same scales the bake later paints at texture res
export const SKIN_OF = { dragon: ['dragon round', 'belly scutes', 1.35], snake: ['snake keeled', 'belly scutes', 1.6], python: ['snake keeled', 'belly scutes', 1.7], croc: ['croc plates', null, 2],
  gila: ['gila beads', null, 1.3], lizard: ['gecko granules', null, 1.4], gecko: ['gecko granules', null, 1.4], rhino: ['wrinkles', null, 3.5], vulture: ['wrinkles', null, 2.4],
  mountain: ['rock', null, 7], bark: ['bark', null, 3.5], lava: ['cracked skin', null, 3.5], coral: ['honeycomb', null, 2.5], horn: ['wrinkles', null, 4], tentacle: ['warts', null, 3] };
export function skinFor(key, R0) { const s = SKIN_OF[key]; return s ? { a: s[0], b: s[1], t: +(s[2] * R0).toFixed(5), k: .75, c: .8, ...(NAT_OF[key] || {}) } : null; }
// NATURE per recipe: g age · w wet · s scars · d dust (the live skin carries it, so it syncs + saves with the sculpt)
export const NAT_OF = { dragon: { g: .55, w: .35, s: .8, d: .7 }, snake: { g: .3, w: .6, s: .4, d: .5 }, python: { g: .3, w: .6, s: .4, d: .5 }, croc: { g: .75, w: .8, s: .9, d: .9 }, gila: { g: .45, w: .2, s: .5, d: 1 }, lizard: { g: .35, w: .3, s: .5, d: .8 }, gecko: { g: .4, w: .3, s: .5, d: .8 }, rhino: { g: .85, w: .2, s: 1, d: 1 }, mountain: { g: .9, w: .2, s: 0, d: 1 }, bark: { g: .85, w: .4, s: .3, d: .6 } };
// live skin on → the SHADER draws the scales; the voxels keep only the big forms + colour zones (no 3-voxel scale mush / streaks)
let _flat = false;
const fa = (A, u, v) => _flat ? .62 : alphaAt(A, u, v);
const bodyH = (A, s, ang, along, around) => fa(A, s / along, (ang / TAU + .5) * around);
const belly = ang => sm(2.15, 2.6, Math.abs(ang));                  // 0 = back + flanks, 1 = belly
const RECIPES = {
  snake: { icon: '🐍', label: 'snake', pad: .06, calm: true, pal: P(['#5E5028', '#1E1810', '#B09860', '#D8CCA4', '#3A3018']), rough: .45,
    geo(x, y, z, nx, ny, nz, s, X, ang) { const b = belly(ang), d = bodyH(AK, s, ang, 2.6, 2), v = fa(AB, s / .9, .5); return ((d - .5) * (1 - b) + (v - .5) * b) * .07; },
    col(x, y, z, nx, ny, nz, s, X, g, o, ang) {
      const p = this.pal, b = belly(ang), a = Math.abs(ang), sc = bodyH(AK, s, ang, 2.6, 2);
      mix3(o, p[0], p[4], fbm(x * .9 + X.seed, y * .9, z * .9));                                   // olive / brown flank
      const dia = Math.abs(fr(s / 2.2 + X.seed) - .5) * 2 + a / 1.1;                                // rattlesnake / viper diamonds down the spine
      if (dia < .78) mix3(o, o, p[1], sm(.78, .62, dia)); if (dia > .6 && dia < .92) mix3(o, o, p[2], sm(.6, .7, dia) * sm(.92, .82, dia) * .9);
      const fl = Math.abs(fr(s / 2.2 + X.seed + .5) - .5) * 2 + Math.abs(a - 1.6) / .5; if (fl < .7) mix3(o, o, p[1], sm(.7, .45, fl) * .8);   // side blotches
      const v = fa(AB, s / .9, .5); const bc = [0, 0, 0]; mix3(bc, p[3], p[2], 1 - v); mix3(o, o, bc, b);
      mulv(o, .55 + .55 * (b > .5 ? v : sc)); o[3] = .38 + (1 - sc) * .25; o[4] = 0;
    } },
  dragon: { icon: '🐉', label: 'DRAGON', pad: .08, calm: true, pal: P(['#2E4A26', '#16261A', '#8A7A30', '#D8C890', '#C8A040']), rough: .4, extra: { spikes: { every: .3, h: .7, w: .3 } },
    geo(x, y, z, nx, ny, nz, s, X, ang) { const b = belly(ang), d = bodyH(AD, s, ang, 2.2, 3), v = fa(AB, s / 1.1, .5); return ((d - .5) * (1 - b) + (v - .5) * b) * .1 + Math.max(0, 1 - Math.abs(ang) * 3) * .05; },
    col(x, y, z, nx, ny, nz, s, X, g, o, ang) {
      const p = this.pal, b = belly(ang), a = Math.abs(ang), sc = bodyH(AD, s, ang, 2.2, 3);
      mix3(o, p[1], p[0], sm(0, 1.6, a));                                                            // darker spine → green flanks
      mix3(o, o, p[2], sm(1.6, 2.2, a) * .7);                                                        // olive-gold toward the belly
      mix3(o, o, p[4], sm(.75, 1, sc) * .35);                                                        // gold glint on each scale top
      const v = fa(AB, s / 1.1, .5), bc = [0, 0, 0]; mix3(bc, p[3], p[2], 1 - v); mix3(o, o, bc, b);
      mulv(o, (.5 + .6 * (b > .5 ? v : sc)) * (.92 + vnoise(x * 3 + X.seed, y * 3, z * 3) * .16)); o[3] = .3 + (1 - sc) * .3; o[4] = sm(.85, 1, sc) * .15;
    } },
  croc: { icon: '🐊', label: 'croc', pad: .08, calm: true, pal: P(['#4A4A30', '#2A2A1A', '#6A6440', '#D8D0A8']), rough: .6,
    geo(x, y, z, nx, ny, nz, s, X, ang) { const a = Math.abs(ang), b = belly(ang), back = sm(1.1, .7, a); const d = bodyH(AC, s, ang, 2, 2), side = bodyH(AG, s, ang, 1.2, 4), v = fa(AC, s / 1.4, (ang / TAU + .5) * 3); return ((d - .5) * back + (side - .5) * .5 * (1 - back) * (1 - b) + (v - .5) * .6 * b) * .09; },
    col(x, y, z, nx, ny, nz, s, X, g, o, ang) { const p = this.pal, a = Math.abs(ang), b = belly(ang); mix3(o, p[1], p[0], sm(0, 1.4, a)); mix3(o, o, p[2], sm(1.2, 2, a) * .6); mix3(o, o, p[3], b); const h = sm(1.1, .7, a) ? bodyH(AC, s, ang, 2, 2) : .6; mulv(o, .6 + .5 * h); o[3] = .55 + (1 - h) * .3; o[4] = 0; } },
  gila: { icon: '🦎', label: 'gila beads', pad: .05, calm: true, pal: P(['#E07030', '#F0A050', '#1A1410', '#2A1E18']), rough: .55,
    geo(x, y, z, nx, ny, nz, s, X, ang) { return (bodyH(AL, s, ang, .9, 6) - .5) * .06; },
    col(x, y, z, nx, ny, nz, s, X, g, o, ang) { const p = this.pal, h = bodyH(AL, s, ang, .9, 6); mix3(o, p[0], p[1], vnoise(x * 2, y * 2, z * 2)); const bl = fbm(x * 1.3 + X.seed, y * 1.3, z * 1.3); mix3(o, o, p[2], sm(.48, .56, bl)); mulv(o, .55 + .55 * h); o[3] = .5; o[4] = 0; } },

  python: { icon: '🐍', label: 'python', pad: .08, pal: P(['#C8D030', '#A8B020', '#4A3A20', '#E8E8A0', '#F0EAC0']), rough: .42,
    geo(x, y, z) { wor(x * 8, y * 8, z * 8); const dome = Math.sqrt(Math.max(0, 1 - W1 * W1 * 2.2)); return dome * .05 - sm(0, .12, W2 - W1) * 0 - (1 - sm(0, .1, W2 - W1)) * .03; },
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal; wor(x * 8, y * 8, z * 8); const seam = 1 - sm(0, .12, W2 - W1), id = WID;
      mix3(o, p[0], p[1], fbm(x * .8 + X.seed, y * .8, z * .8));
      wor(x * 1.6 + X.seed, y * 1.6, z * 1.6); const chain = 1 - sm(.18, .3, Math.abs(W2 - W1 - .18));   // beaded dark chain on a bigger pattern
      if (chain > .5) mix3(o, o, p[2], .85); if (W1 < .16) mix3(o, o, p[3], .9);
      if (ny < -.35) mix3(o, o, p[4], sm(-.35, -.75, ny));           // pale belly
      mulv(o, (1 - seam * .45) * (.92 + id * .16)); o[3] = .38 + seam * .3; o[4] = 0;
    } },
  lizard: { icon: '🦎', label: 'crest lizard', pad: .04, pal: P(['#6FA82E', '#9CC83A', '#C8E070', '#6A4A20', '#E0E8D0']), rough: .5, extra: { spikes: { every: .22, h: .55, w: .22 } },
    geo(x, y, z) { return (vnoise(x * 12, y * 12, z * 12) - .5) * .05; },
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal; mix3(o, p[0], p[1], fbm(x * .7, y * .7 + X.seed, z * .7));
      const stripe = 1 - sm(.05, .14, Math.abs(ny - .05)); mix3(o, o, p[2], stripe * .8);
      mix3(o, o, p[3], sm(.62, .78, fbm(x * 1.3 + 9, y * 1.3, z * 1.3)) * .7);
      if (ny < -.4) mix3(o, o, p[4], .5); mulv(o, .9 + (g + .025) * 3); o[3] = .5; o[4] = 0;
    } },
  gecko: { icon: '🌿', label: 'lichen gecko', pad: .06, pal: P(['#7A8040', '#A0A050', '#6A3A28', '#3A3A28', '#C8C090']), rough: .65,
    geo(x, y, z) { return (vnoise(x * 20, y * 20, z * 20) - .5) * .02 + Math.max(0, vnoise(x * 3, y * 3, z * 3) - .62) * .2; },
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal, f = fbm(x * 1.1 + X.seed, y * 1.1, z * 1.1);
      mix3(o, p[0], p[1], sm(.35, .65, f)); if (f > .68) mix3(o, o, p[2], .8);
      const band = sm(.82, .92, .5 + .5 * Math.sin(s * 2.4 + fbm(x, y, z) * 3)); mix3(o, o, p[3], band * .75 * sm(-.2, .4, ny));
      mulv(o, .88 + vnoise(x * 20, y * 20, z * 20) * .24); o[3] = .62; o[4] = 0;
    } },
  rhino: { icon: '🦏', label: 'rhino hide / mountain', pad: .14, pal: P(['#8A8478', '#5A5448', '#A89878', '#6E6A60']), rough: .85,
    geo(x, y, z, nx, ny, nz, s) { wor(x * 5, y * 5, z * 5); const crack = 1 - sm(0, .1, W2 - W1); return -crack * .045 + Math.sin(s * 2.1 + fbm(x * .5, y * .5, z * .5) * 4) * .06 + (fbm(x * 1.5, y * 1.5, z * 1.5) - .5) * .12; },
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal; mix3(o, p[0], p[3], fbm(x * .6 + X.seed, y * .6, z * .6));
      wor(x * 5, y * 5, z * 5); const crack = 1 - sm(0, .1, W2 - W1); mix3(o, o, p[1], crack * .8);
      mix3(o, o, p[2], sm(.35, .8, ny) * sm(.4, .7, fbm(x * 2, y * 2, z * 2)) * .85);   // dried mud on top
      mulv(o, .92 + WID * .14); o[3] = .82 + crack * .1; o[4] = 0;
    } },
  mountain: { icon: '🏔', label: 'mountain', pad: .45, pal: P(['#6A6A66', '#8A8880', '#4A4A44', '#5A7A30', '#E8ECF0']), rough: .9,
    geo(x, y, z) { const r = ridged(x * 1.5, y * 1.5, z * 1.5); const h = r * r * .42 + (vnoise(x * 6, y * 6, z * 6) - .5) * .06; return Math.round(h / .06) * .06 * .5 + h * .5 - .1; },   // ridges + terraces
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal; mix3(o, p[0], p[1], sm(.15, .35, g)); if (g < .02) mix3(o, o, p[2], .7);
      if (ny > .55 && g < .25) mix3(o, o, p[3], sm(.55, .8, ny) * sm(.4, .6, fbm(x * 3, y * 3, z * 3)));   // grass on flat tops
      if (ny > .3 && y > X.top) mix3(o, o, p[4], sm(.3, .7, ny));                                     // snow up high
      mulv(o, .9 + vnoise(x * 9, y * 9, z * 9) * .2); o[3] = .9; o[4] = 0;
    } },
  tiger: { icon: '🐅', label: 'tiger fur', pad: .025, pal: P(['#E09030', '#F0B060', '#1A1410', '#F8F0E8']), rough: .9,
    geo(x, y, z, nx, ny, nz, s) { return (vnoise(x * 3 + s * 9, y * 22, z * 22) - .5) * .025; },        // short fur along the stroke
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal; mix3(o, p[0], p[1], sm(.2, .6, ny * .5 + .5));
      const w = Math.sin(s * 5.5 + fbm(x * 1.4, y * 1.4, z * 1.4) * 4.5 + X.seed), stripe = sm(.55, .75, w) * sm(-.5, .2, ny);   // stripes wrap the body
      mix3(o, o, p[2], stripe); if (ny < -.35) mix3(o, o, p[3], sm(-.35, -.7, ny));
      mulv(o, .93 + (g + .012) * 4); o[3] = .88; o[4] = 0;
    } },
  leopard: { icon: '🐆', label: 'leopard', pad: .025, pal: P(['#D8B060', '#B88848', '#2A2018', '#F0E8D0']), rough: .9,
    geo(x, y, z, nx, ny, nz, s) { return (vnoise(x * 3 + s * 9, y * 22, z * 22) - .5) * .022; },
    col(x, y, z, nx, ny, nz, s, X, g, o) {
      const p = this.pal; o[0] = p[0][0]; o[1] = p[0][1]; o[2] = p[0][2];
      const f = 2.4 * (1 + Math.max(0, -ny) * .5); wor(x * f + X.seed, y * f, z * f);
      const ring = sm(.28, .34, W1) * (1 - sm(.4, .48, W1)) * sm(.3, .6, vnoise(x * 9, y * 9, z * 9) + .3);
      if (W1 < .3) mix3(o, o, p[1], .7); mix3(o, o, p[2], ring);
      if (ny < -.35) mix3(o, o, p[3], sm(-.35, -.7, ny)); mulv(o, .94 + WID * .1); o[3] = .9; o[4] = 0;
    } },
  giraffe: { icon: '🦒', label: 'giraffe net', pad: .01, pal: P(['#6A3A1A', '#8A4A20', '#F0E0C0']), rough: .85,
    geo(x, y, z) { wor(x * 3, y * 3, z * 3); return (1 - sm(0, .15, W2 - W1)) * -.008; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; wor(x * 3 + X.seed, y * 3, z * 3); mix3(o, p[0], p[1], WID); mix3(o, o, p[2], 1 - sm(.06, .13, W2 - W1)); o[3] = .85; o[4] = 0; } },
  vulture: { icon: '🦃', label: 'wrinkle skin', pad: .07, pal: P(['#C8283A', '#8A1A28', '#E8A0A0']), rough: .55,
    geo(x, y, z, nx, ny, nz, s) { return Math.abs(Math.sin(s * 9 + fbm(x * 2, y * 2, z * 2) * 5)) * .05 + Math.max(0, vnoise(x * 10, y * 10, z * 10) - .65) * .12; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[0], p[1], fbm(x + X.seed, y, z)); if (g < .012) mix3(o, o, p[2], .55); mulv(o, .9 + g * 3); o[3] = .5; o[4] = 0; } },
  axolotl: { icon: '🦎', label: 'soft folds', pad: .1, pal: P(['#C8A8B8', '#8A6A80', '#4A3A48', '#F0D8E0']), rough: .3, extra: { branch: { every: .9, len: 2.2, r: .16, n: 3, curl: .9 } },
    geo(x, y, z, nx, ny, nz, s) { return (fbm(x * 2, y * 2, z * 2) - .5) * .16 - (1 - sm(0, .25, Math.abs(fr(s * 2) - .5))) * .04; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[0], p[3], sm(-.3, -.7, ny)); if (vnoise(x * 12, y * 12, z * 12) > .78) mix3(o, o, p[2], .7); mix3(o, o, p[1], sm(-.02, -.07, g) * .6); o[3] = .3; o[4] = 0; } },
  bark: { icon: '🌳', label: 'bark', pad: .1, pal: P(['#8A8070', '#4A4038', '#A89888', '#6A7A30']), rough: .95, extra: { branch: { every: 1.6, len: 3, r: .45, n: 1, curl: .35 } },
    geo(x, y, z, nx, ny, nz, s) { wor(x * 4, y * 4, s * 1.3); return -(1 - sm(0, .14, W2 - W1)) * .08 + (fbm(x * 3, y * 3, z * 3) - .5) * .04; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[0], p[2], fbm(x * 2 + X.seed, y * 2, z * 2)); if (g < -.04) { mix3(o, o, p[1], .8); if (ny > .2) mix3(o, o, p[3], .6); } o[3] = .95; o[4] = 0; } },
  coral: { icon: '🪸', label: 'coral', pad: .05, pal: P(['#E8A080', '#C85A50', '#F8E0C8', '#7A3A48']), rough: .7, extra: { branch: { every: .5, len: 1.6, r: .55, n: 2, curl: .6, sub: 1 } },
    geo(x, y, z) { return -(vnoise(x * 15, y * 15, z * 15) > .72 ? .04 : 0) + (fbm(x * 3, y * 3, z * 3) - .5) * .04; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[1], p[0], sm(0, 2.5, X.depth || 0)); if (X.tip) mix3(o, o, p[2], X.tip); if (g < -.02) mix3(o, o, p[3], .6); o[3] = .68; o[4] = 0; } },
  crystal: { icon: '💎', label: 'crystals', pad: .02, pal: P(['#A0C8E8', '#E8F0F8', '#5A6A8A', '#B080E0']), rough: .06, metal: .3, extra: { crystal: { every: .6, n: 5, len: 1.4 } },
    geo(x, y, z) { return 0; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[2], p[0], sm(0, 1.4, X.depth || 0)); if (X.tip) mix3(o, o, p[1], X.tip); mix3(o, o, p[3], sm(.6, .8, fbm(x + X.seed, y, z)) * .5); o[3] = .06; o[4] = .3; } },
  lava: { icon: '🌋', label: 'lava crust', pad: .06, pal: P(['#1A1614', '#3A2A24', '#FF5A10', '#FFC040']), rough: .8,
    geo(x, y, z) { wor(x * 4, y * 4, z * 4); return (1 - sm(0, .1, W2 - W1)) * -.05 + WID * .03; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; wor(x * 4, y * 4, z * 4); const crack = 1 - sm(0, .09, W2 - W1); mix3(o, p[0], p[1], WID); if (crack > .2) { mix3(o, o, p[2], crack); mix3(o, o, p[3], sm(.7, 1, crack)); } o[3] = .85 - crack * .3; o[4] = 0; } },
  tentacle: { icon: '🐙', label: 'tentacle', pad: .05, pal: P(['#8A2A4A', '#C85A70', '#F0C8C0', '#3A1020']), rough: .3, taper: 7, extra: { cups: { every: .35 } },
    geo(x, y, z, nx, ny, nz, s) { return (fbm(x * 2.5, y * 2.5, z * 2.5) - .5) * .06; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[0], p[1], fbm(x * 1.5 + X.seed, y * 1.5, z * 1.5)); if (ny < -.3) mix3(o, o, p[2], sm(-.3, -.7, ny)); if (vnoise(x * 9, y * 9, z * 9) > .74) mix3(o, o, p[3], .6); o[3] = .3; o[4] = 0; } },
  horn: { icon: '🦴', label: 'horn / tusk', pad: .02, pal: P(['#5A5040', '#A89880', '#E8E0C8']), rough: .5, taper: 4.5,
    geo(x, y, z, nx, ny, nz, s) { return (vnoise(s * 1.5, Math.atan2(nx, nz) * 2.4, 0) - .5) * .03 - Math.abs(Math.sin(Math.atan2(nx, nz) * 7)) * .012; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal, k = Math.min(1, s / 4); mix3(o, p[0], p[1], sm(0, .6, k)); mix3(o, o, p[2], sm(.6, 1, k)); o[3] = .7 - k * .35; o[4] = 0; } },
  moss: { icon: '🌱', label: 'moss carpet', pad: .06, pal: P(['#8AB040', '#5A7A28', '#C8D870']), rough: .75,
    geo(x, y, z) { wor(x * 25, y * 25, z * 25); return Math.max(0, .35 - W1) * .06 + (fbm(x * 2, y * 2, z * 2) - .5) * .06; },
    col(x, y, z, nx, ny, nz, s, X, g, o) { const p = this.pal; mix3(o, p[1], p[0], sm(0, .04, g)); wor(x * 25, y * 25, z * 25); if (W1 < .15) mix3(o, o, p[2], .4); o[3] = .75; o[4] = 0; } },
};
export const RECIPE_KEYS = Object.keys(RECIPES);
export const recipeOf = k => RECIPES[k] || RECIPES.python;

// ---------------------------------------------------------------- a chaos stroke = state across segments (seed, length, palette jitter)
export function chaosStroke(key, R0, opts = {}) {
  const rc = recipeOf(key), seed = opts.seed ?? Math.random() * 100;
  const rnd = mulberry(seed * 1e5 | 0), chaos = opts.wild ? 1 : (opts.chaos ?? .6);
  let extra = rc.extra;
  if (!extra && (opts.wild || chaos > .85)) extra = [{ spikes: { every: .3, h: .7, w: .25 } }, { branch: { every: .8, len: 2, r: .35, n: 2, curl: .8 } }, { crystal: { every: .7, n: 4, len: 1.2 } }, { branch: { every: 1.2, len: 2.8, r: .5, n: 1, curl: .5, sub: 1 } }][rnd() * 4 | 0];
  const every = extra ? Object.values(extra)[0].every : 0;
  return { key, rc, R0, Rp: Math.max(R0, (opts.vs || 0) * 12), seed, s: 0, chaos, extra, nextExtra: extra ? every * R0 * (.5 + rnd() * .6) : 1e9, top: opts.top ?? 1e9, hue: opts.hue ?? (Math.random() - .5) * (opts.wild ? .25 : .06), wild: !!opts.wild, rnd };
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// the per-voxel evaluator the sculpt engine calls
const _o = [0, 0, 0, 0, 0], _hsl = { h: 0, s: 0, l: 0 }, _c = new THREE.Color();
export function evaluator(X, extraCtx = {}) {
  const rc = X.rc, R = X.R0, Rp = X.Rp || R, ctx = Object.assign({ seed: X.seed, top: X.top }, extraCtx), ch = X.chaos ?? .6, sd = X.seed;
  const amp = (X.wild ? 1.6 : 1) * R, lump = ch * .5 * R;
  return {
    pad: rc.pad * amp + lump * .6,
    geo: (px, py, pz, nx, ny, nz, s, ang = 0) => (_flat = !!X.skin, rc.geo(px / Rp, py / Rp, pz / Rp, nx, ny, nz, s / Rp, ctx, ang)) * amp + (fbm(px / R * .8 + sd, py / R * .8, pz / R * .8) - .5) * lump * (rc.calm ? .35 : 1),
    paint: (px, py, pz, nx, ny, nz, s, g, out, ang = 0) => {
      _flat = !!X.skin; rc.col(px / Rp, py / Rp, pz / Rp, nx, ny, nz, s / Rp, ctx, g / amp, _o, ang); _flat = false;
      if (X.hue) { _c.setRGB(_o[0], _o[1], _o[2]); _c.getHSL(_hsl); _c.setHSL(fr(_hsl.h + X.hue), _hsl.s, _hsl.l); _o[0] = _c.r; _o[1] = _c.g; _o[2] = _c.b; }
      out[0] = _o[0]; out[1] = _o[1]; out[2] = _o[2]; out[3] = _o[3]; out[4] = _o[4] || rc.metal || 0;
    },
    wet: .35,
  };
}

// ---------------------------------------------------------------- what sprouts from a stroke (spikes, branches, crystals, suction cups)
//  calls seg(a, b, ra, rb, ctx) in sculpt-local metres; up = local up (y), dir = stroke direction
export function sprout(X, p, dir, r, seg) {
  const ex = X.extra || X.rc.extra; if (!ex) return;
  const rnd = X.rnd, R = X.R0, up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(dir, up);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0); side.normalize();
  const perp = new THREE.Vector3().crossVectors(side, dir).normalize();          // "up", perpendicular to the stroke
  if (ex.spikes) {   // dorsal crest
    const a = p.clone().addScaledVector(perp, r * .6), b = p.clone().addScaledVector(perp, r + ex.spikes.h * R * (.6 + rnd() * .8) * (X.wild ? 1.5 : 1)).addScaledVector(dir, -r * .3);
    seg(a, b, r * ex.spikes.w * 1.6, R * .015, { tip: 1, depth: 1 });
  }
  if (ex.cups) {     // suction cups underneath
    for (const sgn of [-1, 1]) { const c = p.clone().addScaledVector(perp, -r * .85).addScaledVector(side, sgn * r * .45); seg(c, c.clone().addScaledVector(perp, -r * .12), r * .2, r * .22, { tip: .8 }, true); }
  }
  if (ex.branch) {   // tendrils / coral arms / branches, curling, tapering, maybe splitting
    const B = ex.branch, n = Math.max(1, Math.round(B.n * (X.wild ? 1.6 : 1) * (.5 + rnd())));
    for (let k = 0; k < n; k++) {
      const d = perp.clone().multiplyScalar(.4 + rnd()).addScaledVector(side, (rnd() - .5) * 2.2).addScaledVector(dir, (rnd() - .3) * .8).normalize();
      grow(p.clone().addScaledVector(d, r * .5), d, r * B.r * (1.4 + rnd()), B.len * R * (.6 + rnd() * .8), B, 0);
    }
  }
  if (ex.crystal) {
    const C = ex.crystal, n = Math.max(2, Math.round(C.n * (.5 + rnd()) * (X.wild ? 1.5 : 1)));
    for (let k = 0; k < n; k++) {
      const d = perp.clone().multiplyScalar(.8).addScaledVector(side, (rnd() - .5) * 1.8).addScaledVector(dir, (rnd() - .5) * 1.4).normalize(), L = C.len * R * (.4 + rnd());
      const w = R * (.12 + rnd() * .16), a = p.clone().addScaledVector(d, r * .3), m = a.clone().addScaledVector(d, L * .82), tip = a.clone().addScaledVector(d, L);
      seg(a, m, w, w * .95, { crystal: 1, depth: .3 }); seg(m, tip, w * .95, R * .006, { crystal: 1, depth: 1.4, tip: 1 });
    }
  }
  function grow(a, d, ra, len, B, depth) {
    const steps = 5; let cur = a.clone(), dd = d.clone(), r0 = ra;
    for (let i = 0; i < steps; i++) {
      dd.add(new THREE.Vector3(rnd() - .5, rnd() - .5 + .25, rnd() - .5).multiplyScalar(B.curl)).normalize();
      const nx = cur.clone().addScaledVector(dd, len / steps), r1 = ra * (1 - (i + 1) / (steps + .6));
      seg(cur, nx, r0, Math.max(R * .01, r1), { depth: depth + (i + 1) / steps * 1.5, tip: i === steps - 1 ? 1 : 0 });
      if (B.sub && depth === 0 && i === 2 && rnd() < .7) grow(nx.clone(), dd.clone().add(new THREE.Vector3(rnd() - .5, .3, rnd() - .5)).normalize(), r1 * .8, len * .55, B, 1);
      cur = nx; r0 = r1;
    }
  }
}
