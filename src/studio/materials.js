// bUild sTudio · MATERIALS: smart presets + paint you can lay onto any surface (colour AND roughness/metal, like 3D-Coat).
import * as THREE from 'three';
import { alphaTexture } from './alphas.js';
export const COLORS = ['#f2f2f2', '#2a2a2e', '#e8d6b8', '#8a5a3a', '#ffc23a', '#ff7a1a', '#ff3b30', '#ff5ab4', '#b45cff', '#3a8bff', '#33d6e0', '#3fd17a'];
// rough/metal are what the paint lays down; the rest makes the look
export const MATS = {
  clay:    { label: 'clay',   rough: .72, metal: 0 },
  plastic: { label: 'plastic', rough: .32, metal: 0, clearcoat: .4 },
  gold:    { label: 'gold',   rough: .2, metal: 1, tint: '#ffcf6a' },
  chrome:  { label: 'chrome', rough: .04, metal: 1, tint: '#f4f4f4' },
  car:     { label: 'car',    rough: .3, metal: .55, clearcoat: 1, ccRough: .04 },
  stone:   { label: 'stone',  rough: .92, metal: 0, noise: 'stone' },
  wood:    { label: 'wood',   rough: .6, metal: 0, noise: 'wood' },
  glass:   { label: 'glass',  rough: .03, metal: 0, glass: true },
  neon:    { label: 'neon',   rough: .4, metal: 0, glow: 2.2 },
  // SMART materials (Painter): the surface decides — edges wear bright, cavities collect grime / rust / moss
  worn:    { label: 'worn gold', rough: .32, metal: 1, base: '#b8862a', smart: { edge: ['#fff0b0', .12, 1], cav: ['#2e2210', .85, .1], noise: .5 } },
  rust:    { label: 'rust',   rough: .85, metal: .2, base: '#4e2410', smart: { edge: ['#8d8a84', .38, 1], cav: ['#1e0b03', .95, 0], noise: .55, blotch: ['#8a3f14', .9, .05] } },
  moss:    { label: 'moss stone', rough: .95, metal: 0, base: '#55524b', smart: { edge: ['#8e897d', .9, 0], cav: ['#3d6a1c', 1, 0], noise: .7, blotch: ['#4d5a2e', 1, 0] } },
  chipped: { label: 'chipped', rough: .42, metal: 0, base: null, smart: { edge: ['#9c9ea2', .3, 1], cav: ['#1c1a18', .8, 0], noise: .9 } },
  bronze:  { label: 'bronze', rough: .35, metal: 1, base: '#8a5a2c', smart: { edge: ['#e0a86a', .2, 1], cav: ['#2f7a62', .7, 0], noise: .6 } },
};
export const MAT_KEYS = Object.keys(MATS);

const noiseTex = {};
function noiseMap(kind) {
  if (noiseTex[kind]) return noiseTex[kind];
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'), img = g.createImageData(N, N);
  const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const w = (a, b) => rnd(((a % 64) + 64) % 64, ((b % 64) + 64) % 64);
    return (w(xi, yi) * (1 - u) + w(xi + 1, yi) * u) * (1 - v) + (w(xi, yi + 1) * (1 - u) + w(xi + 1, yi + 1) * u) * v; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const X = x / N * 16, Y = y / N * 16; let f = 0, a = .5, s = 1; for (let o = 0; o < 5; o++) { f += vn(X * s, Y * s) * a; a *= .5; s *= 2; }
    let v = kind === 'wood' ? .62 + .38 * Math.abs(Math.sin((Y * 1.2 + f * 3.2) * 3.1)) * (.8 + .2 * vn(X * 8, Y * .5)) : .55 + .45 * f + (rnd(x, y) - .5) * .12;
    v = Math.max(0, Math.min(1, v)); const i = (y * N + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(2, 2);
  return noiseTex[kind] = t;
}

// one material per object; vertex colours for clay; paint textures once you paint on it
// sculpts: colour + roughness + metal per vertex (painted voxels) → attribute 'rm' drives the PBR
// SMART TONE (copied from nature): every sculpt is toned by its own shape — never one flat colour.
//  rim = lighter + warmer + polished · cavity = darker, shifted, rougher (dirt / blood in creases / grime) · deep creases = AO
//  belly paler (countershading) · back a touch darker · ±jitter per few mm (every scale a bit different)
//  rim: rgb gain + amount · cav: rgb gain + amount · misc: ao, belly, dorsal, jitter · rough: +cavity, −rim · belly colour
export const TONES = {
  reptile: { label: 'reptile', rim: [1.18, 1.13, .96, .85], cav: [.40, .34, .28, .85], misc: [.45, .5, .18, .16], rough: [.25, .15], belly: '#e6d9ae' },
  skin:    { label: 'skin / flesh', rim: [1.12, 1.08, 1.04, .7], cav: [.66, .36, .34, .8], misc: [.35, .3, .1, .08], rough: [.15, .1], belly: '#f0d8c8' },
  stone:   { label: 'stone', rim: [1.32, 1.3, 1.25, .85], cav: [.45, .44, .41, .9], misc: [.55, 0, 0, .2], rough: [.1, 0], belly: '#ffffff' },
  metal:   { label: 'metal', rim: [1.7, 1.55, 1.35, .9], cav: [.32, .27, .22, .95], misc: [.5, 0, 0, .06], rough: [.45, .3], belly: '#ffffff' },
  off:     { label: 'flat', rim: [1, 1, 1, 0], cav: [1, 1, 1, 0], misc: [0, 0, 0, 0], rough: [0, 0], belly: '#ffffff' },
};
export const TONE_KEYS = Object.keys(TONES);
export function toneUniforms(tone) {
  const T = TONES[tone] || TONES.reptile, b = new THREE.Color(T.belly);
  return { tRim: { value: new THREE.Vector4(...T.rim) }, tCav: { value: new THREE.Vector4(...T.cav) }, tMisc: { value: new THREE.Vector4(...T.misc) }, tRough: { value: new THREE.Vector2(...T.rough) }, tBelly: { value: new THREE.Vector3(b.r, b.g, b.b) } };
}
// the same tone on the CPU (exports: Blender, glTF) — c = linear rgb (in place), tone = [cavity, wide], n = normal, p = position (m)
const _vn = (x, y, z) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi, h = (a, b, c) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf), L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v), L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w); };
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function toneCPU(c, tone, n, p, key) {
  const T = TONES[key] || TONES.reptile; if (key === 'off') return c;
  const cav = ss(.04, .35, tone[0]), rim = ss(.04, .3, -tone[0]), ao = ss(0, .5, tone[1]);
  for (let k = 0; k < 3; k++) { c[k] = c[k] + (c[k] * T.cav[k] - c[k]) * cav * T.cav[3]; c[k] = c[k] + (c[k] * T.rim[k] - c[k]) * rim * T.rim[3]; c[k] *= 1 - ao * T.misc[0]; }
  const belly = ss(-.1, -.7, n[1]), bc = new THREE.Color(T.belly);
  if (belly > 0) { const bb = [bc.r, bc.g, bc.b]; for (let k = 0; k < 3; k++) c[k] += ((c[k] * 1.25 + bb[k]) * .5 - c[k]) * belly * T.misc[1]; }
  const dor = 1 - ss(.2, .9, n[1]) * T.misc[2], j = 1 + (_vn(p[0] * 160, p[1] * 160, p[2] * 160) - .5) * T.misc[3] * 2;
  for (let k = 0; k < 3; k++) c[k] = Math.max(0, c[k] * dor * j);
  return c;
}
export const TONE_GLSL = /* glsl */`
uniform vec4 tRim, tCav, tMisc; uniform vec2 tRough; uniform vec3 tBelly;
float tH(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float tN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(tH(i), tH(i + vec3(1,0,0)), f.x), mix(tH(i + vec3(0,1,0)), tH(i + vec3(1,1,0)), f.x), f.y), mix(mix(tH(i + vec3(0,0,1)), tH(i + vec3(1,0,1)), f.x), mix(tH(i + vec3(0,1,1)), tH(i + vec3(1,1,1)), f.x), f.y), f.z); }
vec3 toneIt(vec3 c, vec2 tone, vec3 n, vec3 p){
  float cav = smoothstep(.04, .35, tone.x), rim = smoothstep(.04, .3, -tone.x), ao = smoothstep(0., .5, tone.y);
  c = mix(c, c * tCav.rgb, cav * tCav.w); c = mix(c, c * tRim.rgb, rim * tRim.w); c *= 1. - ao * tMisc.x;
  float belly = smoothstep(-.1, -.7, n.y); c = mix(c, (c * 1.25 + tBelly) * .5, belly * tMisc.y);
  c *= 1. - smoothstep(.2, .9, n.y) * tMisc.z;
  c *= 1. + (tN(p * 160.) - .5) * tMisc.w * 2.;
  return max(c, vec3(0));
}`;
// LIVE SKIN: an alpha wrapped over the whole sculpt in the shader (triplanar, object space) — scales visible WHILE you draw,
//  at any voxel size. skin = { a: alpha, b: belly alpha | null, t: tile size (m, sculpt space), k: depth, c: colour amount }
const SKIN_GLSL = /* glsl */`
uniform sampler2D tSkin, tSkin2; uniform vec4 skinP;   // 1/tile, depth (m), colour, belly on
uniform vec4 natP;                                     // NATURE: age (clean → ancient), wet, scars, dust
uniform mat4 modelMatrix;
float sIdOut;
// height + its slope straight from the texture (3 taps: no screen-derivative streaks; mips fade the slope with distance) · G = which scale
vec3 skinT(sampler2D t, vec2 u, vec2 gx, vec2 gy){ vec2 hc = textureGrad(t, u, gx, gy).rg; float h = hc.x; sIdOut = hc.y;
  return vec3(h, (textureGrad(t, u + vec2(1. / 256., 0.), gx, gy).r - h) * 256., (textureGrad(t, u + vec2(0., 1. / 256.), gx, gy).r - h) * 256.); }
// triplanar → (height, object-space gradient per tile); planes that barely contribute are skipped · sIdAcc = the strongest plane's scale id
float sIdAcc;
vec4 skinTri(sampler2D t, vec3 p, vec3 n){ vec3 w = pow(abs(n), vec3(6.)); w /= w.x + w.y + w.z; vec3 dx = dFdx(p), dy = dFdy(p); vec4 r = vec4(0.); float ws = 0., wb = 0.;
  if (w.x > .02) { vec3 a = skinT(t, p.zy, dx.zy, dy.zy); r += w.x * vec4(a.x, 0., a.z, a.y); ws += w.x; if (w.x > wb) { wb = w.x; sIdAcc = sIdOut + .13; } }
  if (w.y > .02) { vec3 a = skinT(t, p.xz + .37, dx.xz, dy.xz); r += w.y * vec4(a.x, a.y, 0., a.z); ws += w.y; if (w.y > wb) { wb = w.y; sIdAcc = sIdOut + .41; } }
  if (w.z > .02) { vec3 a = skinT(t, p.xy + .71, dx.xy, dy.xy); r += w.z * vec4(a.x, a.y, a.z, 0.); ws += w.z; if (w.z > wb) { wb = w.z; sIdAcc = sIdOut + .77; } }
  sIdAcc = fract(sIdAcc);
  return r / max(ws, .001); }`;
// NATURE layer (runs after the skin, same pass): every scale its own shade · grime in the seams · dust on what faces up ·
//  worn + polished scale tips · scratches · scars where scales are rubbed off · moss in old seams · wet patches. One age slider drives it.
const NATURE_GLSL = /* glsl */`
  float nAge = natP.x, sId = sIdAcc, nJ = sId - .5;
  vec3 nP = sP;                                                       // in scale tiles: the weathering scales with the creature
  float nUp = smoothstep(.2, .85, sN.y), nSeam = 1. - smoothstep(.1, .5, sH), nTip = smoothstep(.7, .95, sH);
  float nOdd = step(.93, fract(sId * 7.31));                          // ~7 % odd scales (darker, older)
  float nScar = smoothstep(.74, .8, tN(nP * .32 + 11.)) * natP.z * smoothstep(.15, .7, nAge);
  float nDust = nUp * smoothstep(.35, .75, tN(nP * .45 + 3.) * .8 + tN(nP * 2.3) * .3) * (1. - nSeam * .7) * natP.w * min(1., nAge * 1.4);
  float nMoss = nSeam * smoothstep(.0, .6, sN.y) * smoothstep(.55, 1., nAge) * smoothstep(.42, .62, tN(nP * .9 + 5.));
  float nSl = fract(dot(nP, vec3(.83, .31, .57)) * 2.1 + tN(nP * .6) * 2.5), nScr = (1. - smoothstep(0., .035, abs(nSl - .5))) * smoothstep(.55, .72, tN(nP * .5 + 7.)) * nAge * sLod;
  float nWet = smoothstep(.58, .66, tN(nP * .22 + 19.)) * natP.y;
  vec3 c0 = diffuseColor.rgb;
  diffuseColor.rgb *= 1. + nJ * .6 * sLod;                                                          // every scale a bit different
  float nHue = fract(sId * 3.71);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.05, .62), smoothstep(.55, 1., nHue) * .7 * sLod);   // some olive / gold
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.8, .92, 1.08), smoothstep(.45, 0., nHue) * .45 * sLod);    // some cooler
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.58, .52, .46), nOdd * (.35 + .4 * nAge) * sLod);
  diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb, c0) * vec3(.22, .17, .11), nSeam * (.45 + .5 * nAge) * sLod);  // grime in the seams
  diffuseColor.rgb *= 1. + nTip * (.06 + .3 * nAge) * sLod;                                          // worn, lighter tips
  diffuseColor.rgb = mix(diffuseColor.rgb, c0 * vec3(.75, .5, .45) + vec3(.06, .03, .02), nScar * .75);              // scar tissue
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.55 + vec3(.05), nScr * .55);           // scratches
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.5, .45, .37), nDust * .55);                           // dust
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.13, .2, .05) * (.8 + .4 * tN(nP * 3.)), nMoss * .9);  // moss
  diffuseColor.rgb *= 1. - nWet * .18;`;
// NATURE defaults: g = age 0..1, w = wet, s = scars, d = dust
export const natVec = skin => new THREE.Vector4(skin.g ?? .5, skin.w ?? .5, skin.s ?? .7, skin.d ?? .8);
export function sculptMaterial(key, tone = 'reptile', skin = null) {
  const M = MATS[key] || MATS.clay;
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true, side: THREE.FrontSide });
  if (M.clearcoat) { m.clearcoat = M.clearcoat; m.clearcoatRoughness = M.ccRough ?? .2; }
  if (M.glow) { m.emissive = new THREE.Color(0x222222); m.emissiveIntensity = 1; }
  const U = toneUniforms(tone); m.userData.tone = U;
  if (skin && skin.a) {
    Object.assign(U, { tSkin: { value: alphaTexture(skin.a) }, tSkin2: { value: alphaTexture(skin.b || skin.a) }, skinP: { value: new THREE.Vector4(1 / Math.max(1e-4, skin.t), (skin.k ?? 1) * skin.t * .045, skin.c ?? .7, skin.b ? 1 : 0) }, natP: { value: natVec(skin) } });
    m.defines = { SKIN: 1 };
  }
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'attribute vec2 rm;\nattribute vec2 tone;\nvarying vec2 vRm;\nvarying vec2 vTone;\nvarying vec3 vON;\nvarying vec3 vOP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRm = rm; vTone = tone; vON = normal; vOP = position;');
    const NL = String.fromCharCode(10), SK = !!(skin && skin.a);
    sh.fragmentShader = 'varying vec2 vRm;\nvarying vec2 vTone;\nvarying vec3 vON;\nvarying vec3 vOP;\n' + TONE_GLSL + NL + (SK ? SKIN_GLSL : '') + NL + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = toneIt(diffuseColor.rgb, vTone, normalize(vON), vOP);' + (SK ? NL + `
  vec3 sN = normalize(vON), sP = vOP * skinP.x;
  sP += (vec3(tN(sP * .55), tN(sP * .55 + 7.3), tN(sP * .55 + 13.1)) - .5) * .5;   // rows wander, scales grow + shrink: never a perfect grid
  vec4 sK = skinTri(tSkin, sP, sN);
  if (skinP.w > .5) { float bel = smoothstep(-.25, -.65, sN.y); if (bel > .001) { vec4 s2 = skinTri(tSkin2, sP * .7, sN); s2.yzw *= .7; sK = mix(sK, s2, bel); } }
  float sH = sK.x;
  float sLod = 1. - smoothstep(.05, .16, length(fwidth(sP)));
  float sCav = 1. - smoothstep(.15, .6, vTone.x) * .7;
  float sTone = mix(.8, .4 + .74 * sH, sLod);
  diffuseColor.rgb *= mix(1., sTone, skinP.z * sCav);` + NATURE_GLSL + `
  vec3 sG = sK.yzw * skinP.x * skinP.y * sLod * sCav * (1. - nScar * .85); sG -= dot(sG, sN) * sN;   // surface slope (object space)` : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vRm.x + smoothstep(.04, .35, vTone.x) * tRough.x - smoothstep(.04, .3, -vTone.x) * tRough.y, .03, 1.);' + (SK ? NL + 'roughnessFactor = clamp(roughnessFactor + (.55 - sH) * .3 * skinP.z * sLod + nJ * .16 * sLod + nSeam * .2 * nAge - nTip * .18 * nAge + nDust * .6 + nScar * .1, .6, 1.); roughnessFactor = mix(roughnessFactor, .25, nWet);' : ''))
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + (SK ? NL + '{ vec3 sGv = mat3(viewMatrix) * (mat3(modelMatrix) * sG); normal = normalize(normal - sGv / dot(modelMatrix[0].xyz, modelMatrix[0].xyz)); }' : ''))
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRm.y;');
  };
  m.customProgramCacheKey = () => skin && skin.a ? 'sculpt-tone-skin' : 'sculpt-tone';
  m.userData.key = key;
  return m;
}
export function makeMaterial(key, color, { vertexColors = false } = {}) {
  const M = MATS[key] || MATS.clay;
  const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(M.base || color), roughness: M.rough, metalness: M.metal, vertexColors, side: THREE.DoubleSide });
  if (M.tint && !vertexColors) m.color.lerp(new THREE.Color(M.tint), .35);
  if (M.clearcoat) { m.clearcoat = M.clearcoat; m.clearcoatRoughness = M.ccRough ?? .2; }
  if (M.noise && !vertexColors) { m.map = noiseMap(M.noise); m.bumpMap = m.map; m.bumpScale = M.noise === 'stone' ? 2.2 : .6; }
  if (M.glass) { m.transmission = 1; m.thickness = .03; m.ior = 1.5; m.transparent = true; m.opacity = 1; }
  if (M.glow) { m.emissive = new THREE.Color(color); m.emissiveIntensity = M.glow; }
  m.userData.key = key;
  return m;
}

// ---------------------------------------------------------------- paint layers on a mesh with UVs
const PS = 1024;
export function ensurePaint(mesh) {
  const ud = mesh.userData; if (ud.paint) return ud.paint;
  const m = mesh.material, col = document.createElement('canvas'), orm = document.createElement('canvas'); col.width = col.height = orm.width = orm.height = PS;
  const gc = col.getContext('2d', { willReadFrequently: true }), go = orm.getContext('2d', { willReadFrequently: true });
  // start from what the object looks like now: its colour (and the stone/wood pattern) + its roughness/metal
  if (m.map && m.map.image) { gc.fillStyle = '#' + m.color.getHexString(); gc.fillRect(0, 0, PS, PS); gc.globalCompositeOperation = 'multiply'; for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) gc.drawImage(m.map.image, i * PS / 2, j * PS / 2, PS / 2, PS / 2); gc.globalCompositeOperation = 'source-over'; }
  else { gc.fillStyle = '#' + m.color.getHexString(); gc.fillRect(0, 0, PS, PS); }
  go.fillStyle = `rgb(255,${m.roughness * 255 | 0},${m.metalness * 255 | 0})`; go.fillRect(0, 0, PS, PS);
  const tc = new THREE.CanvasTexture(col); tc.colorSpace = THREE.SRGBColorSpace; const to = new THREE.CanvasTexture(orm);
  m.map = tc; m.color.set(0xffffff); m.roughnessMap = m.metalnessMap = to; m.roughness = m.metalness = 1; m.needsUpdate = true;
  return ud.paint = { col, orm, gc, go, tc, to };
}
// a soft dab at uv (0..1), radius in uv units
export function dab(mesh, uv, r, color, key, a = .5) {
  const P = ensurePaint(mesh), M = MATS[key] || MATS.clay, x = uv.x * PS, y = (1 - uv.y) * PS, R = Math.max(2, r * PS);
  const soft = (g, css) => { const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, css(a)); gr.addColorStop(.6, css(a * .6)); gr.addColorStop(1, css(0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); };
  const c = new THREE.Color(color); if (M.tint) c.lerp(new THREE.Color(M.tint), .35);
  soft(P.gc, al => `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${al})`);
  soft(P.go, al => `rgba(255,${M.rough * 255 | 0},${M.metal * 255 | 0},${al})`);
  P.tc.needsUpdate = P.to.needsUpdate = true;
}
export function paintSnapshot(mesh) { const P = mesh.userData.paint; return P ? [P.gc.getImageData(0, 0, PS, PS), P.go.getImageData(0, 0, PS, PS)] : null; }
export function paintRestore(mesh, snap) { const P = mesh.userData.paint; if (!P || !snap) return; P.gc.putImageData(snap[0], 0, 0); P.go.putImageData(snap[1], 0, 0); P.tc.needsUpdate = P.to.needsUpdate = true; }
export function paintStamp(mesh, img) {               // a photo becomes the object's whole colour layer
  const P = ensurePaint(mesh); P.gc.drawImage(img, 0, 0, PS, PS); P.tc.needsUpdate = true;
}
