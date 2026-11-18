// bUild sTudio · PAINTER — a GPU texture painter with a real layer stack (the Substance Painter core, in the browser + in VR).
//
//  A TexSet belongs to one mesh with unique UVs. Everything happens in UV space on the GPU:
//   BAKE  (once per mesh)  position · normal + curvature · tangent frame · AO (64 directions) · occupancy grid (edges / cavities, works on HARD edges too)
//   PAINT (3D brush)       every texel knows its 3D point → the brush is a sphere in object space: no seams, no stretching, paints through UV islands
//   LAYERS                 paint layers (colour · rough · metal · height · emissive, each channel optional) · fill layers (procedural 3D materials)
//                          masks = painted mask × generator (edges, cavities, AO, top, bottom, height, curvature, noise) with level / softness / breakup
//                          blend modes, opacity, visibility — all non-destructive, recomposited only where the brush went (scissor)
//   OUTPUT                 base colour (sRGB) · ORM (AO, rough, metal = glTF) · tangent-space normal (+ the sculpt's baked detail) · height · emissive
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { zlibSync, unzlibSync } from 'fflate';
import { alphaTexture } from './alphas.js';
const V3 = THREE.Vector3;

// ================================================================== GLSL: shared noise (3D, seamless — every texel has its own 3D point)
const NOISE = /* glsl */`
float h31(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += vn(p) * a; p = p * 2.03 + 17.1; a *= .5; } return s / .97; }
vec2 wor(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec3 o = vec3(x, y, z), r = o + h33(i + o) - f; float d = dot(r, r);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return sqrt(vec2(d1, d2)); }
`;
// procedural patterns for fill layers: 0..1 (p in object metres × scale)
const PATTERNS = /* glsl */`
uniform sampler2D tAlpha;
float tri(vec3 p, vec3 n){ vec3 w = pow(abs(n), vec3(4)); w /= w.x + w.y + w.z; return texture(tAlpha, p.zy).r * w.x + texture(tAlpha, p.xz).r * w.y + texture(tAlpha, p.xy).r * w.z; }
float pattern(int k, vec3 p, vec3 n, float seed){
  p += seed * 13.7;
  if (k == 0) return 0.;
  if (k == 1) return fbm(p);                                                      // noise
  if (k == 2){ float g = fbm(p * .7) * .7 + fbm(p * 3.1) * .3; vec2 w = wor(p * .8); return smoothstep(.42, .72, g + (w.x - .35) * .35); }   // grunge
  if (k == 3){ float s = 0.; for (int i = 0; i < 4; i++){ vec3 d = normalize(h33(vec3(float(i) * 7.3, seed, 3.1)) - .5); vec3 q = p * (1. + float(i) * .37);
      float l = abs(fract(dot(q, d) * 3. + fbm(q * .6) * 2.) - .5); float mask = smoothstep(.55, .75, vn(q * .4 + float(i)));
      s = max(s, (1. - smoothstep(0., .035, l)) * mask); } return s; }                // scratches
  if (k == 4){ vec2 w = wor(p); return smoothstep(0., .45, w.y - w.x); }          // cells / scales
  if (k == 5){ float r = length(p.xz) * 4. + fbm(p * vec3(.6, .1, .6)) * 3.; return .5 + .5 * sin(r * 6.2832) * (.6 + .4 * vn(p * vec3(1, 12, 1))); }   // wood rings
  if (k == 6) return vn(p * vec3(.04, 6., 6.)) * .7 + vn(p * vec3(.08, 18., 18.)) * .3;   // brushed (along x)
  if (k == 7){ vec2 w = wor(p * .9); float crack = 1. - smoothstep(0., .07, w.y - w.x); return clamp(fbm(p * 1.3) * .8 - crack * .55 + .2, 0., 1.); }   // stone
  if (k == 8){ vec2 w = wor(p * 1.6); return 1. - smoothstep(.05, .22, w.x); }   // pores / dots
  if (k == 9){ vec3 q = abs(fract(p * .5) - .5); return step(.46, max(q.x, max(q.y, q.z))); }   // tiles grid
  if (k == 10){ float f = fbm(p * .5 + vec3(0, fbm(p * .3) * 2., 0)); return smoothstep(.45, .62, f); }   // blotches (rust, moss)
  if (k == 11) return tri(p, n);                                             // an ALPHA all over (scales, plates, warts …), projected from 3 sides
  return 0.;
}`;
export const PATTERN_NAMES = ['solid', 'noise', 'grunge', 'scratches', 'cells', 'wood', 'brushed', 'stone', 'pores', 'tiles', 'blotches', 'alpha'];
export const GEN_NAMES = ['none', 'edges', 'cavities', 'AO dirt', 'top (moss)', 'bottom', 'height', 'curvature', 'noise'];
export const BLEND_NAMES = ['normal', 'multiply', 'screen', 'overlay', 'add'];

const FS_VERT = /* glsl */`in vec3 position; out vec2 vUv; void main(){ vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }`;
const HEAD = 'precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;\n';
function raw(frag, uniforms, opts = {}) {
  return new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: HEAD + (opts.vert || FS_VERT), fragmentShader: HEAD + frag, uniforms, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...opts.mat });
}
const tri = (() => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)); return g; })();
const CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ================================================================== the engine (one per renderer)
export function createPainterGPU(renderer) {
  const scene = new THREE.Scene(), quad = new THREE.Mesh(tri, null); quad.frustumCulled = false; scene.add(quad);
  const floatOK = renderer.extensions.has('EXT_color_buffer_float');
  const G = {
    renderer, floatOK,
    // draw a full-screen pass (or a mesh) into a target; XR must be off while we render off-screen
    pass(mat, target, mesh) {
      const r = renderer, prevT = r.getRenderTarget(), xr = r.xr.enabled, ac = r.autoClear, sh = r.shadowMap.autoUpdate;
      r.xr.enabled = false; r.autoClear = false; r.shadowMap.autoUpdate = false;
      const obj = mesh || quad; if (!mesh) quad.material = mat; else mesh.material = mat;
      if (mesh) { scene.remove(quad); scene.add(mesh); }
      r.setRenderTarget(target); r.render(scene, CAM);
      if (mesh) { scene.remove(mesh); scene.add(quad); }
      r.setRenderTarget(prevT); r.xr.enabled = xr; r.autoClear = ac; r.shadowMap.autoUpdate = sh;
      return obj;
    },
    clear(target, c = [0, 0, 0, 0]) {
      const r = renderer, prevT = r.getRenderTarget(), xr = r.xr.enabled, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
      r.xr.enabled = false; r.setRenderTarget(target); r.setClearColor(new THREE.Color(c[0], c[1], c[2]), c[3]); r.clear(true, false, false);
      r.setClearColor(cc, ca); r.setRenderTarget(prevT); r.xr.enabled = xr;
    },
  };
  // ---------------------------------------------------------------- shaders
  G.bakeMat = raw(/* glsl */`
    in vec3 vP; in vec3 vN; in vec2 vU; uniform float uRes;
    layout(location = 0) out vec4 oP; layout(location = 1) out vec4 oN; layout(location = 2) out vec4 oT;
    void main(){
      vec3 N = normalize(vN), dPx = dFdx(vP), dPy = dFdy(vP); vec2 dUx = dFdx(vU), dUy = dFdy(vU);
      float det = dUx.x * dUy.y - dUx.y * dUy.x; if (abs(det) < 1e-14) det = 1e-14;
      vec3 T = (dPx * dUy.y - dPy * dUx.y) / det, B = (dPy * dUx.x - dPx * dUy.x) / det;
      vec3 dNx = dFdx(vN), dNy = dFdy(vN);
      float k = (dot(dNx, dPx) / max(dot(dPx, dPx), 1e-14) + dot(dNy, dPy) / max(dot(dPy, dPy), 1e-14)) * .5;
      vec3 Tn = T - N * dot(N, T); float tl = length(Tn); Tn = tl > 1e-9 ? Tn / tl : vec3(1, 0, 0);
      float hand = dot(cross(N, Tn), B) < 0. ? -1. : 1.;
      oP = vec4(vP, 1.); oN = vec4(N, k); oT = vec4(Tn, hand * max(length(T) / uRes, 1e-7));
    }`, { uRes: { value: 1024 } }, { vert: /* glsl */`in vec3 position; in vec3 normal; in vec2 uv; out vec3 vP; out vec3 vN; out vec2 vU;
      void main(){ vP = position; vN = normal; vU = uv; gl_Position = vec4(uv * 2. - 1., 0., 1.); }` });
  // grow every map past the island borders (no seams when sampling / exporting)
  G.dilateMat = raw(/* glsl */`
    in vec2 vUv; uniform sampler2D t0, t1, t2; uniform vec2 px;
    layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
    void main(){
      vec4 a = texture(t0, vUv); o0 = a; o1 = texture(t1, vUv); o2 = texture(t2, vUv);
      if (a.w > .5) return;
      vec4 s0 = vec4(0), s1 = vec4(0), s2 = vec4(0); float n = 0.;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 u = vUv + vec2(x, y) * px; vec4 b = texture(t0, u); if (b.w > .5){ s0 += b; s1 += texture(t1, u); s2 += texture(t2, u); n++; } }
      if (n > 0.){ o0 = vec4((s0 / n).xyz, 1.); vec4 nn = s1 / n; o1 = vec4(normalize(nn.xyz), nn.w); vec4 tt = s2 / n; o2 = vec4(normalize(tt.xyz), tt.w); }
    }`, { t0: { value: null }, t1: { value: null }, t2: { value: null }, px: { value: new THREE.Vector2() } });
  G.dilate1Mat = raw(/* glsl */`
    in vec2 vUv; uniform sampler2D t0, tCov; uniform vec2 px; out vec4 o0;
    void main(){ o0 = texture(t0, vUv); if (texture(tCov, vUv).w > .5) return;
      vec4 s = vec4(0); float n = 0.; for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 u = vUv + vec2(x, y) * px; if (texture(tCov, u).w > .5){ s += texture(t0, u); n++; } }
      if (n > 0.) o0 = s / n; }`, { t0: { value: null }, tCov: { value: null }, px: { value: new THREE.Vector2() } });
  // object-space depth from one direction (for the AO bake)
  G.depthMat = raw(/* glsl */`in float vD; out vec4 o; void main(){ o = vec4(vD, 0, 0, 1); }`, {}, {
    vert: /* glsl */`in vec3 position; uniform mat4 view; uniform vec3 dir; uniform vec3 org; out float vD; void main(){ vD = dot(position - org, dir); gl_Position = view * vec4(position, 1.); }`,
    mat: { side: THREE.DoubleSide, depthTest: true, depthWrite: true } });
  G.depthMat.uniforms = { view: { value: new THREE.Matrix4() }, dir: { value: new V3() }, org: { value: new V3() } };
  G.aoMat = raw(/* glsl */`
    in vec2 vUv; uniform sampler2D tP, tN, tD; uniform mat4 view; uniform vec3 dir, org; uniform float bias; out vec4 o;
    void main(){
      vec4 P = texture(tP, vUv); vec3 N = normalize(texture(tN, vUv).xyz); float w = max(0., dot(N, -dir));
      if (P.w < .5 || w <= 0.) { o = vec4(0); return; }
      vec3 q = P.xyz + N * bias; vec4 c = view * vec4(q, 1.); vec2 uv = c.xy * .5 + .5;
      float d = dot(q - org, dir), dm = texture(tD, uv).x;
      o = vec4(d <= dm + bias ? w : 0., w, 0, 1);
    }`, { tP: { value: null }, tN: { value: null }, tD: { value: null }, view: { value: new THREE.Matrix4() }, dir: { value: new V3() }, org: { value: new V3() }, bias: { value: .002 } },
    { mat: { blending: THREE.AdditiveBlending, transparent: true } });
  G.aoResolveMat = raw(/* glsl */`in vec2 vUv; uniform sampler2D tA; out vec4 o; void main(){ vec4 a = texture(tA, vUv); float ao = a.y > 0. ? a.x / a.y : 1.; o = vec4(ao, ao, ao, 1.); }`, { tA: { value: null } });

  // ---------------------------------------------------------------- the brush: a sphere in object space, painted into UV space (2 draws: fade the old, add the new)
  const DAB_FRAG = /* glsl */`
    in vec2 vUv; uniform sampler2D tP, tN, tStamp; uniform int nd; uniform vec4 dabs[16]; uniform vec3 dirs[16];
    uniform float hard, flow, stampOn, stampMode, tile; uniform float u0s[16]; uniform int pass; uniform vec4 vC; uniform vec4 vP; uniform vec4 on;    // vC = colour (sRGB) + colour channel on · vP = rough, metal, height, emit · on = channel switches for vP
    uniform vec3 stT[16], stB[16];
    layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
    void main(){
      vec4 P = texture(tP, vUv); if (P.w < .5) discard;
      vec3 N = normalize(texture(tN, vUv).xyz);
      float keep = 1., stv = .5, bestT = 9.;
      for (int i = 0; i < 16; i++){ if (i >= nd) break;
        vec3 d = P.xyz - dabs[i].xyz; float t = length(d) / dabs[i].w; if (t >= 1.) continue;
        float a = flow * (1. - smoothstep(hard, 1., t));
        a *= smoothstep(-.15, .35, dot(N, -dirs[i]));                                  // don't paint through to the far side
        if (stampOn > .5){
          if (stampMode < .5){ vec2 su = vec2(dot(d, stT[i]), dot(d, stB[i])) / dabs[i].w * .5 + .5; a *= texture(tStamp, su).r; }
          else if (t < bestT){ bestT = t; stv = texture(tStamp, vec2(dot(d, stT[i]) + u0s[i], dot(d, stB[i])) / tile + vec2(0., .5)).r; }   // alpha tiled along the stroke
        }
        keep *= 1. - clamp(a, 0., 1.);
      }
      float a = 1. - keep; if (a <= 0.) discard;
      vec4 ac = vec4(vec3(a * vC.w), a * vC.w), ap = a * on;
      float tone = stampMode > .5 ? .42 + .72 * stv : 1.;
      vec4 vv = stampMode > .5 ? vec4(vP.x * (1.35 - stv * .5), vP.y, mix(.5, stv, vP.z > .5 ? 1. : -1.) , vP.w) : vP;   // tops lighter + smoother, seams dark + rough, height = the alpha
      if (stampMode > .5 && vP.z < .5) vv.z = 1. - stv;
      if (pass == 0){ o0 = ac; o1 = ap; o2 = ap; }                                       // ×(1 − a)
      else { o0 = vec4(min(vC.rgb * tone, vec3(1)) * ac.r, ac.a); o1 = vv * ap; o2 = ap; } // + value × a
    }`;
  const dabU = () => ({ tP: { value: null }, tN: { value: null }, tStamp: { value: null }, nd: { value: 0 }, dabs: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) }, dirs: { value: Array.from({ length: 16 }, () => new V3()) },
    stT: { value: Array.from({ length: 16 }, () => new V3()) }, stB: { value: Array.from({ length: 16 }, () => new V3()) },
    hard: { value: .5 }, flow: { value: .5 }, stampOn: { value: 0 }, stampMode: { value: 0 }, tile: { value: 1 }, u0s: { value: new Array(16).fill(0) }, pass: { value: 0 }, vC: { value: new THREE.Vector4() }, vP: { value: new THREE.Vector4() }, on: { value: new THREE.Vector4() } });
  G.dabFade = raw(DAB_FRAG, dabU(), { mat: { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } });
  G.dabAdd = raw(DAB_FRAG, dabU(), { mat: { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor } });
  G.dabAdd.uniforms = G.dabFade.uniforms;    // one set of uniforms, two blend states
  // the mask brush: one channel, white = shows the layer
  const MASK_FRAG = DAB_FRAG.replace('layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;', '')
    .replace('if (pass == 0){ o0 = ac; o1 = ap; o2 = ap; }', 'if (pass == 0){ o0 = vec4(a); }').replace('else { o0 = vec4(vC.rgb * ac.r, ac.a); o1 = vP * ap; o2 = ap; }', 'else { o0 = vec4(a * vC.w); }');
  G.maskFade = raw(MASK_FRAG, dabU(), { mat: { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } });
  G.maskAdd = raw(MASK_FRAG, dabU(), { mat: { transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor } });
  G.maskAdd.uniforms = G.maskFade.uniforms;

  // ---------------------------------------------------------------- compositing: one pass per layer (ping-pong), linear colour in half float
  G.baseMat = raw(/* glsl */`in vec2 vUv; uniform vec3 col; uniform vec4 rmhe; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; void main(){ o0 = vec4(col, 1.); o1 = rmhe; }`,
    { col: { value: new THREE.Color(.5, .5, .5) }, rmhe: { value: new THREE.Vector4(.6, 0, 0, 0) } });
  G.layerMat = raw(/* glsl */`
    ${NOISE}${PATTERNS}
    in vec2 vUv;
    uniform sampler2D tPrevC, tPrevR, tP, tN, tAO, tLC, tLP, tLA, tMask; uniform sampler3D tOcc; uniform vec3 occMin, occSize;
    uniform int kind, blend, gen, pat, inv, maskOn; uniform float opacity, level, soft, breakup, bscale, width, scale, seed, contrast;
    uniform vec3 colA, colB; uniform vec4 rmA, rmB, chan;    // rmX = rough, metal, height, emit · chan = colour, rough, metal, height (emit follows colour)
    uniform float emitOn;
    layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
    vec3 lin(vec3 c){ return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
    vec3 mixB(vec3 a, vec3 b){
      if (blend == 1) return a * b; if (blend == 2) return 1. - (1. - a) * (1. - b);
      if (blend == 3) return mix(2. * a * b, 1. - 2. * (1. - a) * (1. - b), step(.5, a)); if (blend == 4) return a + b; return b; }
    void main(){
      vec4 pc = texture(tPrevC, vUv), pr = texture(tPrevR, vUv); o0 = pc; o1 = pr;
      vec4 P = texture(tP, vUv); if (P.w < .5) return;
      vec4 Nk = texture(tN, vUv); vec3 N = normalize(Nk.xyz);
      // ---- mask = painted mask × generator (+ noise breakup)
      float m = opacity;
      if (maskOn == 1) m *= texture(tMask, vUv).r;
      if (gen > 0){
        float g = 0.; vec3 oc = (P.xyz - occMin) / occSize;
        float occ = mix(texture(tOcc, oc).r, texture(tOcc, oc).g, width);
        if (gen == 1) g = clamp((.5 - occ) * 4., 0., 1.);                         // edges (convex)
        else if (gen == 2) g = clamp((occ - .5) * 4., 0., 1.);                    // cavities
        else if (gen == 3) g = 1. - texture(tAO, vUv).r;                          // ambient occlusion dirt
        else if (gen == 4) g = N.y * .5 + .5;                                     // facing up (moss, dust, snow)
        else if (gen == 5) g = .5 - N.y * .5;                                     // facing down (drips)
        else if (gen == 6) g = clamp((P.y - occMin.y) / occSize.y, 0., 1.);       // height gradient
        else if (gen == 7) g = clamp(Nk.w * width * .05 + .5, 0., 1.);            // curvature (mesh normals)
        else if (gen == 8) g = fbm(P.xyz * bscale + seed);
        if (breakup > 0.) g += ((fbm(P.xyz * bscale + 3.7 + seed) - .5) * 2.2 + (vn(P.xyz * bscale * 3.3 + 9.1) - .5) * 1.1) * breakup;   // chips: big + small breakup
        float s = max(.002, soft * .5); g = smoothstep(level - s, level + s, g);
        if (inv == 1) g = 1. - g;
        m *= g;
      }
      if (m <= 0.) return;
      // ---- the layer's own values
      vec3 col; float aC, aR, aM, aH, aE; vec4 v;
      if (kind == 0){                                                              // paint layer (premultiplied by its own coverage)
        vec4 C = texture(tLC, vUv), LP = texture(tLP, vUv), A = texture(tLA, vUv);
        aC = C.a; col = aC > .002 ? lin(C.rgb / aC) : vec3(0);
        vec4 cov = max(A, vec4(1e-4)); v = LP / cov; aR = A.r; aM = A.g; aH = A.b; aE = A.a;
        v.z = (v.z - .5) * 2.;                                                     // height: .5 = flat
      } else {                                                                     // fill layer: a procedural material
        float f = pattern(pat, P.xyz * scale, N, seed); f = clamp((f - .5) * contrast + .5, 0., 1.);
        col = mix(lin(colA), lin(colB), f); v = mix(rmA, rmB, f);
        aC = chan.x; aR = chan.y; aM = chan.z; aH = chan.w; aE = emitOn;
      }
      o0 = vec4(mix(pc.rgb, mixB(pc.rgb, col), aC * m), 1.);
      o1.x = mix(pr.x, v.x, aR * m); o1.y = mix(pr.y, v.y, aM * m);
      o1.z = pr.z + v.z * aH * m;                                                  // heights stack up
      o1.w = mix(pr.w, v.w, aE * m);
    }`, { tPrevC: { value: null }, tPrevR: { value: null }, tP: { value: null }, tN: { value: null }, tAO: { value: null }, tLC: { value: null }, tLP: { value: null }, tLA: { value: null }, tMask: { value: null },
    tAlpha: { value: null }, tOcc: { value: null }, occMin: { value: new V3() }, occSize: { value: new V3(1, 1, 1) },
    kind: { value: 0 }, blend: { value: 0 }, gen: { value: 0 }, pat: { value: 0 }, inv: { value: 0 }, maskOn: { value: 0 },
    opacity: { value: 1 }, level: { value: .5 }, soft: { value: .3 }, breakup: { value: 0 }, bscale: { value: 20 }, width: { value: 0 }, scale: { value: 20 }, seed: { value: 0 }, contrast: { value: 1 },
    colA: { value: new THREE.Color() }, colB: { value: new THREE.Color() }, rmA: { value: new THREE.Vector4() }, rmB: { value: new THREE.Vector4() }, chan: { value: new THREE.Vector4(1, 1, 1, 0) }, emitOn: { value: 0 } });
  // ---------------------------------------------------------------- final maps (what the material shows + what gets exported)
  G.finalMat = raw(/* glsl */`
    in vec2 vUv; uniform sampler2D tC, tR, tAO, tT, tN, tBN; uniform vec2 px; uniform float hScale, bnOn;
    layout(location = 0) out vec4 oCol; layout(location = 1) out vec4 oORM; layout(location = 2) out vec4 oNrm; layout(location = 3) out vec4 oEmi;
    void main(){
      vec4 c = texture(tC, vUv), r = texture(tR, vUv);
      oCol = vec4(c.rgb, 1.);                                                      // linear → the sRGB target encodes it
      oORM = vec4(texture(tAO, vUv).r, clamp(r.x, .02, 1.), clamp(r.y, 0., 1.), 1.);
      // height → tangent-space normal (texel size in metres from the bake), then the baked sculpt detail underneath
      float ts = max(abs(texture(tT, vUv).w), 1e-6);
      float hl = texture(tR, vUv - vec2(px.x, 0)).z, hr = texture(tR, vUv + vec2(px.x, 0)).z, hd = texture(tR, vUv - vec2(0, px.y)).z, hu = texture(tR, vUv + vec2(0, px.y)).z;
      vec3 hn = normalize(vec3((hl - hr) * hScale / (2. * ts), (hd - hu) * hScale / (2. * ts), 1.));
      vec3 bn = bnOn > .5 ? texture(tBN, vUv).xyz * 2. - 1. : vec3(0, 0, 1);
      vec3 n = normalize(vec3(bn.xy + hn.xy, bn.z * hn.z));                          // whiteout blend
      oNrm = vec4(n * .5 + .5, 1.);
      oEmi = vec4(c.rgb * r.w, 1.);
    }`, { tC: { value: null }, tR: { value: null }, tAO: { value: null }, tT: { value: null }, tN: { value: null }, tBN: { value: null }, px: { value: new THREE.Vector2() }, hScale: { value: .004 }, bnOn: { value: 0 } });
  G.copyMat = raw(/* glsl */`in vec2 vUv; uniform sampler2D t; out vec4 o; void main(){ o = texture(t, vUv); }`, { t: { value: null } });
  G.copy3Mat = raw(/* glsl */`in vec2 vUv; uniform sampler2D t0, t1, t2; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
    void main(){ o0 = texture(t0, vUv); o1 = texture(t1, vUv); o2 = texture(t2, vUv); }`, { t0: { value: null }, t1: { value: null }, t2: { value: null } });
  G.fillMaskMat = raw(/* glsl */`in vec2 vUv; uniform float v; out vec4 o; void main(){ o = vec4(v, v, v, v); }`, { v: { value: 1 } });
  return G;
}

// ================================================================== layer presets: smart materials = several layers with generators
const L = (o) => Object.assign({ kind: 'fill', name: 'fill', visible: true, opacity: 1, blend: 0, pat: 0, scale: 20, seed: 0, contrast: 1, colA: '#888888', colB: '#888888',
  rmA: [.6, 0, 0, 0], rmB: [.6, 0, 0, 0], chan: [1, 1, 1, 0], emitOn: 0, gen: 0, level: .5, soft: .3, breakup: 0, bscale: 25, width: 0, inv: 0, maskOn: 0 }, o);
export const SMART = {
  'worn gold': () => [L({ name: 'gold', colA: '#c48f2e', colB: '#9e6f1e', pat: 6, scale: 30, rmA: [.28, 1, 0, 0], rmB: [.4, 1, 0, 0] }),
    L({ name: 'polished edges', colA: '#ffe7a6', colB: '#ffd77a', rmA: [.12, 1, 0, 0], rmB: [.12, 1, 0, 0], gen: 1, level: .42, soft: .3, breakup: .22, bscale: 40, width: .3 }),
    L({ name: 'grime', colA: '#2a1e10', colB: '#3a2a16', pat: 2, scale: 25, rmA: [.85, .1, 0, 0], rmB: [.95, 0, 0, 0], gen: 3, level: .35, soft: .5, breakup: .4 })],
  'rusty iron': () => [L({ name: 'iron', colA: '#5a5a5c', colB: '#3e3e40', pat: 1, scale: 25, rmA: [.45, 1, 0, 0], rmB: [.6, 1, 0, 0] }),
    L({ name: 'rust', colA: '#7a3410', colB: '#3c1606', pat: 10, scale: 14, contrast: 1.4, rmA: [.9, .1, .3, 0], rmB: [.95, 0, .6, 0], chan: [1, 1, 1, 1], gen: 2, level: .2, soft: .6, breakup: .9, bscale: 12 }),
    L({ name: 'rust spots', colA: '#8a4416', colB: '#4a1e08', pat: 2, scale: 30, rmA: [.92, 0, .4, 0], rmB: [.95, 0, .2, 0], chan: [1, 1, 1, 1], gen: 8, level: .6, soft: .2, bscale: 18 }),
    L({ name: 'shiny edges', colA: '#9a9a9e', colB: '#88888c', rmA: [.3, 1, 0, 0], rmB: [.38, 1, 0, 0], gen: 1, level: .45, soft: .3, breakup: .25, bscale: 50 })],
  'chipped paint': () => [L({ name: 'metal', colA: '#8c8f94', colB: '#6d7075', pat: 3, scale: 40, rmA: [.3, 1, 0, 0], rmB: [.5, 1, 0, 0] }),
    L({ name: 'paint', colA: '#c4342a', colB: '#a82a22', pat: 1, scale: 30, rmA: [.42, 0, .15, 0], rmB: [.5, 0, .15, 0], chan: [1, 1, 1, 1], gen: 1, level: .38, soft: .06, breakup: .55, bscale: 30, width: .6, inv: 1 }),
    L({ name: 'dirt', colA: '#3b3226', colB: '#2a241c', pat: 2, scale: 22, rmA: [.9, 0, 0, 0], rmB: [.95, 0, 0, 0], gen: 3, level: .4, soft: .5, breakup: .5, opacity: .85 })],
  'moss stone': () => [L({ name: 'stone', colA: '#7a766c', colB: '#4a4740', pat: 7, scale: 34, rmA: [.92, 0, .25, 0], rmB: [.95, 0, -.1, 0], chan: [1, 1, 1, 1] }),
    L({ name: 'moss', colA: '#55682a', colB: '#2e3f16', pat: 1, scale: 45, rmA: [.95, 0, .3, 0], rmB: [1, 0, .5, 0], chan: [1, 1, 1, 1], gen: 4, level: .72, soft: .25, breakup: .7, bscale: 14 }),
    L({ name: 'moss in cracks', colA: '#465a22', colB: '#2a3a12', rmA: [1, 0, 0, 0], rmB: [1, 0, 0, 0], gen: 2, level: .2, soft: .4, breakup: .5 })],
  'bronze patina': () => [L({ name: 'bronze', colA: '#9a6a32', colB: '#7a5022', pat: 1, scale: 20, rmA: [.3, 1, 0, 0], rmB: [.42, 1, 0, 0] }),
    L({ name: 'patina', colA: '#3f8f78', colB: '#2a6a5a', pat: 10, scale: 16, rmA: [.8, 0, .1, 0], rmB: [.9, 0, .2, 0], chan: [1, 1, 1, 1], gen: 2, level: .15, soft: .5, breakup: .8, bscale: 16 }),
    L({ name: 'rubbed edges', colA: '#f0b878', colB: '#e0a060', rmA: [.15, 1, 0, 0], rmB: [.2, 1, 0, 0], gen: 1, level: .3, soft: .3, breakup: .4, bscale: 40 })],
  'dragon scales': () => [L({ name: 'scales', colA: '#1f4a2a', colB: '#0c2214', pat: 4, scale: 60, contrast: 1.3, rmA: [.35, 0, .6, 0], rmB: [.55, 0, -.4, 0], chan: [1, 1, 1, 1] }),
    L({ name: 'belly tone', colA: '#c8a86a', colB: '#a08048', pat: 4, scale: 60, rmA: [.5, 0, 0, 0], rmB: [.6, 0, 0, 0], gen: 5, level: .6, soft: .3, breakup: .3 }),
    L({ name: 'shine on edges', colA: '#4fbf6a', colB: '#3a9a50', rmA: [.2, 0, 0, 0], rmB: [.25, 0, 0, 0], gen: 1, level: .35, soft: .4, opacity: .7 })],
  'lava rock': () => [L({ name: 'basalt', colA: '#262422', colB: '#141210', pat: 7, scale: 20, rmA: [.9, 0, .4, 0], rmB: [.95, 0, -.3, 0], chan: [1, 1, 1, 1] }),
    L({ name: 'glowing cracks', colA: '#ff6a10', colB: '#ffb030', rmA: [.6, 0, 0, 3], rmB: [.6, 0, 0, 5], emitOn: 1, chan: [1, 1, 0, 0], gen: 2, level: .2, soft: .3, breakup: .6, bscale: 20 })],
  'car paint': () => [L({ name: 'paint', colA: '#1a3fa8', colB: '#2450c8', pat: 1, scale: 80, rmA: [.18, .55, 0, 0], rmB: [.22, .6, 0, 0] }),
    L({ name: 'dust', colA: '#8a8070', colB: '#7a7060', pat: 2, scale: 40, rmA: [.9, 0, 0, 0], rmB: [.9, 0, 0, 0], gen: 4, level: .86, soft: .2, breakup: .35, opacity: .35 })],
  'old leather': () => [L({ name: 'leather', colA: '#5a3420', colB: '#3a1e10', pat: 8, scale: 120, rmA: [.55, 0, -.2, 0], rmB: [.75, 0, .1, 0], chan: [1, 1, 1, 1] }),
    L({ name: 'worn', colA: '#8a5a38', colB: '#7a4a2a', rmA: [.45, 0, 0, 0], rmB: [.5, 0, 0, 0], gen: 1, level: .35, soft: .5, breakup: .6 })],
  'bone': () => [L({ name: 'bone', colA: '#e8dcc0', colB: '#c8b890', pat: 1, scale: 25, rmA: [.5, 0, 0, 0], rmB: [.65, 0, 0, 0] }),
    L({ name: 'pores', colA: '#a08a60', colB: '#a08a60', pat: 8, scale: 90, rmA: [.7, 0, -.3, 0], rmB: [.7, 0, -.3, 0], chan: [1, 1, 0, 1], gen: 8, level: .5, soft: .9, bscale: 8 }),
    L({ name: 'stains', colA: '#6a5030', colB: '#4a3820', rmA: [.8, 0, 0, 0], rmB: [.8, 0, 0, 0], gen: 3, level: .3, soft: .6, breakup: .5 })],
  'wood varnish': () => [L({ name: 'wood', colA: '#9a6234', colB: '#5e3418', pat: 5, scale: 14, rmA: [.35, 0, .05, 0], rmB: [.5, 0, -.05, 0], chan: [1, 1, 1, 1] }),
    L({ name: 'worn varnish', colA: '#b8875a', colB: '#a07448', rmA: [.7, 0, 0, 0], rmB: [.75, 0, 0, 0], gen: 1, level: .35, soft: .4, breakup: .5 })],
};
Object.assign(SMART, {
  'dragon skin': () => [L({ name: 'scales', pat: 11, alpha: 'dragon round', scale: 24, colA: '#16261a', colB: '#3a5a2c', rmA: [.65, 0, -.5, 0], rmB: [.28, 0, .6, 0], chan: [1, 1, 0, 1], contrast: 1.2 }),
    L({ name: 'dorsal blotches', pat: 10, scale: 7, contrast: 1.6, colA: '#0c1a10', colB: '#1a3018', rmA: [.4, 0, 0, 0], rmB: [.4, 0, 0, 0], chan: [1, 0, 0, 0], gen: 4, level: .45, soft: .5, opacity: .75 }),
    L({ name: 'scale tone', pat: 1, scale: 160, colA: '#2a4a22', colB: '#4a6a30', rmA: [.4, 0, 0, 0], rmB: [.4, 0, 0, 0], chan: [1, 0, 0, 0], blend: 3, opacity: .45 }),
    L({ name: 'glint on rims', colA: '#a89048', colB: '#a89048', rmA: [.22, .45, 0, 0], rmB: [.22, .45, 0, 0], gen: 1, level: .55, soft: .3, opacity: .3, chan: [1, 1, 1, 0] }),
    L({ name: 'belly', pat: 11, alpha: 'belly scutes', scale: 14, colA: '#6a5e30', colB: '#c8b880', rmA: [.6, 0, -.4, 0], rmB: [.45, 0, .4, 0], chan: [1, 1, 0, 1], gen: 5, level: .62, soft: .2 }),
    L({ name: 'dirt in seams', colA: '#0e140c', colB: '#1a2010', rmA: [.9, 0, 0, 0], rmB: [.9, 0, 0, 0], gen: 2, level: .3, soft: .5, opacity: .8 })],
  'snake skin': () => [L({ name: 'keeled scales', pat: 11, alpha: 'snake keeled', scale: 30, colA: '#2a2216', colB: '#7a6a3a', rmA: [.6, 0, -.5, 0], rmB: [.35, 0, .5, 0], chan: [1, 1, 0, 1], contrast: 1.2 }),
    L({ name: 'blotches', colA: '#1c160e', colB: '#2e2418', pat: 10, scale: 9, contrast: 1.8, rmA: [.5, 0, 0, 0], rmB: [.5, 0, 0, 0], chan: [1, 0, 0, 0], opacity: .85 }),
    L({ name: 'belly', colA: '#d8cca0', colB: '#e8dcb8', rmA: [.4, 0, 0, 0], rmB: [.4, 0, 0, 0], gen: 5, level: .6, soft: .25 })],
  'croc skin': () => [L({ name: 'plates', pat: 11, alpha: 'croc plates', scale: 12, colA: '#1e1e12', colB: '#4e4e32', rmA: [.75, 0, -.5, 0], rmB: [.5, 0, .7, 0], chan: [1, 1, 0, 1], contrast: 1.3 }),
    L({ name: 'granules', pat: 11, alpha: 'gecko granules', scale: 40, colA: '#2a2a1a', colB: '#4a4a30', rmA: [.7, 0, -.2, 0], rmB: [.6, 0, .2, 0], chan: [0, 0, 0, 1], gen: 4, level: .35, soft: .3, inv: 1 }),
    L({ name: 'belly', colA: '#cfc69a', colB: '#ddd4a8', rmA: [.5, 0, 0, 0], rmB: [.5, 0, 0, 0], gen: 5, level: .6, soft: .25 }),
    L({ name: 'wet shine', colA: '#5a5a40', colB: '#5a5a40', rmA: [.15, 0, 0, 0], rmB: [.15, 0, 0, 0], chan: [0, 1, 0, 0], gen: 1, level: .35, soft: .5 })],
  'gecko skin': () => [L({ name: 'granules', pat: 11, alpha: 'gecko granules', scale: 45, colA: '#4a5028', colB: '#9aa050', rmA: [.7, 0, -.4, 0], rmB: [.5, 0, .5, 0], chan: [1, 1, 0, 1] }),
    L({ name: 'camo', colA: '#6a3a28', colB: '#3a3a28', pat: 10, scale: 11, contrast: 1.6, rmA: [.6, 0, 0, 0], rmB: [.6, 0, 0, 0], chan: [1, 0, 0, 0], opacity: .8 }),
    L({ name: 'tubercles', pat: 11, alpha: 'warts', scale: 16, colA: '#5a6030', colB: '#b0b068', rmA: [.6, 0, 0, 0], rmB: [.5, 0, .7, 0], chan: [1, 0, 0, 1], opacity: .7 })],
});
export const SKIN_FOR = { dragon: 'dragon skin', snake: 'snake skin', croc: 'croc skin', gecko: 'gecko skin', lizard: 'gecko skin', python: 'snake skin', gila: 'gecko skin' };
export const SMART_KEYS = Object.keys(SMART);
export const newLayer = L;

// ================================================================== a texture set = one mesh's paint
let TS_ID = 1;
export class TexSet {
  constructor(G, mesh, { res = 1024 } = {}) {
    this.G = G; this.mesh = mesh; this.res = res; this.id = TS_ID++;
    this.layers = []; this.sel = -1; this.ver = 0; this.undo = [];
    this.dirty = null;                          // uv rect to recomposite [x0, y0, x1, y1] in 0..1
    this.hScale = .004;
    const geo = mesh.geometry; if (!geo.attributes.uv) throw new Error('TexSet: mesh has no UVs');
    const R = res, rt = (o = {}) => new THREE.WebGLRenderTarget(R, R, { depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, ...o });
    const HF = G.floatOK ? THREE.HalfFloatType : THREE.HalfFloatType;
    this.rt = rt;
    this.bake = rt({ count: 3, type: HF, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });   // pos · normal+curv · tangent+texel size
    this.bake2 = rt({ count: 3, type: HF, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.ao = rt({ type: THREE.UnsignedByteType });
    this.comp = [rt({ count: 2, type: HF }), rt({ count: 2, type: HF })];
    this.out = rt({ count: 4, type: THREE.UnsignedByteType });
    this.out.textures[0].colorSpace = THREE.SRGBColorSpace; this.out.textures[3].colorSpace = THREE.SRGBColorSpace;
    this.bnTex = null;                          // baked sculpt normal detail (tangent space), optional
    this.occ = null;
    this.bvh = new MeshBVH(geo, { maxLeafSize: 8 });
    this.bakeMaps();
    this.material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 1, map: this.out.textures[0], roughnessMap: this.out.textures[1], metalnessMap: this.out.textures[1], aoMap: this.out.textures[1],
      normalMap: this.out.textures[2], emissive: 0xffffff, emissiveMap: this.out.textures[3], side: THREE.FrontSide });
    for (const t of this.out.textures) t.anisotropy = 4;
  }
  // ---------------------------------------------------------------- bake: maps in UV space + AO + occupancy
  bakeMaps() {
    const G = this.G, geo = this.mesh.geometry, R = this.res;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    G.bakeMat.uniforms.uRes.value = R;
    G.clear(this.bake); const m = new THREE.Mesh(geo); m.frustumCulled = false; G.pass(G.bakeMat, this.bake, m);
    // dilate 8 texels (padding) — ping-pong between bake and bake2
    let a = this.bake, b = this.bake2; G.dilateMat.uniforms.px.value.set(1 / R, 1 / R);
    for (let i = 0; i < Math.max(8, R / 128); i++) { const U = G.dilateMat.uniforms; U.t0.value = a.textures[0]; U.t1.value = a.textures[1]; U.t2.value = a.textures[2]; G.pass(G.dilateMat, b); [a, b] = [b, a]; }
    this.bake = a; this.bake2 = b;
    geo.computeBoundingBox(); this.bb = geo.boundingBox.clone(); const sz = this.bb.getSize(new V3()); this.size = Math.max(sz.x, sz.y, sz.z) || .1;
    this.bakeAO(); this.bakeOcc();
  }
  bakeAO(N = 64) {
    const G = this.G, geo = this.mesh.geometry, D = 512, c = this.bb.getCenter(new V3()), rad = this.bb.getSize(new V3()).length() * .5 + 1e-3;
    const depth = new THREE.WebGLRenderTarget(D, D, { type: G.floatOK ? THREE.FloatType : THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true });
    const acc = this.rt({ type: THREE.HalfFloatType }); G.clear(acc);
    const m = new THREE.Mesh(geo); m.frustumCulled = false;
    const cam = new THREE.OrthographicCamera(-rad, rad, rad, -rad, 0, rad * 2), U = G.aoMat.uniforms;
    U.tP.value = this.bake.textures[0]; U.tN.value = this.bake.textures[1]; U.bias.value = this.size * .004;
    const r = G.renderer;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i + .5) / N * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963, dir = new V3(Math.cos(th) * rr, y, Math.sin(th) * rr);   // fibonacci sphere: light travels along dir
      const org = c.clone().addScaledVector(dir, -rad);
      cam.position.copy(org); cam.up.set(Math.abs(dir.y) > .9 ? 1 : 0, Math.abs(dir.y) > .9 ? 0 : 1, 0); cam.lookAt(c); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const view = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      G.depthMat.uniforms.view.value.copy(view); G.depthMat.uniforms.dir.value.copy(dir); G.depthMat.uniforms.org.value.copy(org);
      // depth pass needs a depth buffer + nearest wins
      const prevT = r.getRenderTarget(), xr = r.xr.enabled, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
      r.xr.enabled = false; r.setRenderTarget(depth); r.setClearColor(new THREE.Color(1e4, 0, 0), 1); r.clear(true, true, false); r.setClearColor(cc, ca); r.setRenderTarget(prevT); r.xr.enabled = xr;
      G.pass(G.depthMat, depth, m);
      U.tD.value = depth.texture; U.view.value.copy(view); U.dir.value.copy(dir); U.org.value.copy(org);
      G.pass(G.aoMat, acc);
    }
    G.aoResolveMat.uniforms.tA.value = acc.texture; G.pass(G.aoResolveMat, this.ao);
    // pad the AO too
    const tmp = this.rt({ type: THREE.UnsignedByteType }); G.copyMat.uniforms.t.value = this.ao.texture; G.pass(G.copyMat, tmp);
    G.dilate1Mat.uniforms.px.value.set(1 / this.res, 1 / this.res);
    let a = tmp, b = this.ao; for (let i = 0; i < 6; i++) { G.dilate1Mat.uniforms.t0.value = a.texture; G.dilate1Mat.uniforms.tCov.value = this.bake.textures[0]; G.pass(G.dilate1Mat, b); [a, b] = [b, a]; }
    if (a !== this.ao) { G.copyMat.uniforms.t.value = a.texture; G.pass(G.copyMat, this.ao); }
    tmp.dispose(); depth.dispose(); acc.dispose();
  }
  // occupancy grid: how much of a ball around each point is inside the mesh (flat = .5, edge < .5, cavity > .5) — 3-axis ray parity
  bakeOcc(n = 64) {
    const bb = this.bb.clone(), sz = bb.getSize(new V3()), pad = Math.max(sz.x, sz.y, sz.z) * .08 + 1e-4; bb.expandByScalar(pad);
    const S = bb.getSize(new V3()), cell = Math.max(S.x, S.y, S.z) / n, nx = Math.max(4, Math.ceil(S.x / cell)), ny = Math.max(4, Math.ceil(S.y / cell)), nz = Math.max(4, Math.ceil(S.z / cell));
    const cover = new Float32Array(nx * ny * nz), ray = new THREE.Ray(), I = (x, y, z) => x + nx * (y + ny * z), j = cell * .137;   // rays a bit off-grid: never exactly along mesh edges
    const cast = (axis) => {
      const [A, B, C] = axis === 0 ? [ny, nz, nx] : axis === 1 ? [nx, nz, ny] : [nx, ny, nz];
      for (let b = 0; b < B; b++) for (let a = 0; a < A; a++) {
        const o = new V3(), d = new V3();
        if (axis === 0) { o.set(bb.min.x - cell, bb.min.y + (a + .5) * cell + j, bb.min.z + (b + .5) * cell - j * .7); d.set(1, 0, 0); }
        else if (axis === 1) { o.set(bb.min.x + (a + .5) * cell - j * .6, bb.min.y - cell, bb.min.z + (b + .5) * cell + j); d.set(0, 1, 0); }
        else { o.set(bb.min.x + (a + .5) * cell + j * .8, bb.min.y + (b + .5) * cell - j, bb.min.z - cell); d.set(0, 0, 1); }
        ray.set(o, d); const raw = this.bvh.raycast(ray, THREE.DoubleSide).map(h => h.distance - cell).sort((p, q) => p - q);
        const hits = []; for (const h of raw) if (!hits.length || h - hits[hits.length - 1] > cell * 1e-4) hits.push(h);   // one hit per surface crossing
        if (hits.length % 2) hits.pop();
        // exact inside length per voxel along this ray
        for (let k = 0; k + 1 < hits.length; k += 2) {
          const s0 = hits[k], s1 = hits[k + 1];
          for (let c = Math.max(0, Math.floor(s0 / cell)); c <= Math.min(C - 1, Math.floor(s1 / cell)); c++) {
            const ov = Math.min(s1, (c + 1) * cell) - Math.max(s0, c * cell); if (ov > 0) cover[axis === 0 ? I(c, a, b) : axis === 1 ? I(a, c, b) : I(a, b, c)] += ov / cell / 3;
          }
        }
      }
    };
    cast(0); cast(1); cast(2);
    const occ = cover; for (let i = 0; i < occ.length; i++) occ[i] = Math.min(1, occ[i]);
    const blur = (src, r) => {   // separable box blur ×2 ≈ gaussian
      let a = src.slice(), b = new Float32Array(src.length);
      for (let it = 0; it < 2; it++) for (let ax = 0; ax < 3; ax++) {
        for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
          let s = 0, k = 0; for (let d = -r; d <= r; d++) { const X = ax === 0 ? x + d : x, Y = ax === 1 ? y + d : y, Z = ax === 2 ? z + d : z; if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) { k++; continue; } s += a[I(X, Y, Z)]; k++; }
          b[I(x, y, z)] = s / k;
        }
        [a, b] = [b, a];
      }
      return a;
    };
    const f = blur(occ, 1), w = blur(occ, 3), data = new Uint8Array(nx * ny * nz * 4);
    for (let i = 0; i < occ.length; i++) { data[i * 4] = f[i] * 255; data[i * 4 + 1] = w[i] * 255; data[i * 4 + 3] = 255; }
    if (this.occ) this.occ.dispose();
    const t = new THREE.Data3DTexture(data, nx, ny, nz); t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    this.occ = t; this.occMin = bb.min.clone(); this.occSize = new V3(nx * cell, ny * cell, nz * cell);
  }
  // ---------------------------------------------------------------- layers
  addLayer(o = {}, at = this.sel + 1) {
    const l = newLayer(o);
    if (l.kind === 'paint') { l.rt = this.rt({ count: 3, type: THREE.UnsignedByteType }); this.G.clear(l.rt); l.chan = o.chan || [1, 1, 1, 0]; }
    l.mask = null; if (l.maskOn) this.ensureMask(l, o.maskStart ?? 1);
    l.ver = 0; l.uid = Math.random().toString(36).slice(2, 9);
    this.layers.splice(Math.max(0, Math.min(at, this.layers.length)), 0, l); this.sel = this.layers.indexOf(l);
    this.full(); return l;
  }
  ensureMask(l, v = 1) { if (!l.mask) { l.mask = this.rt({ type: THREE.UnsignedByteType }); const G = this.G; G.fillMaskMat.uniforms.v.value = v; G.pass(G.fillMaskMat, l.mask); } l.maskOn = 1; }
  removeLayer(i) { const l = this.layers[i]; if (!l) return; this.layers.splice(i, 1); if (l.rt) l.rt.dispose(); if (l.mask) l.mask.dispose(); this.sel = Math.min(this.sel, this.layers.length - 1); this.full(); }
  moveLayer(i, d) { const j = i + d; if (j < 0 || j >= this.layers.length) return; const [l] = this.layers.splice(i, 1); this.layers.splice(j, 0, l); this.sel = j; this.full(); }
  addSmart(key) { const ls = SMART[key](); const at = this.sel + 1; ls.forEach((o, k) => this.addLayer(o, at + k)); this.layers.slice(at, at + ls.length).forEach(l => l.group = key); return ls.length; }
  full() { this.dirty = [0, 0, 1, 1]; this.ver++; }
  // ---------------------------------------------------------------- brush: dabs = [{ p (object space), r, dir (object space, toward surface) }]
  paint(dabs, b) {
    const l = this.layers[this.sel]; if (!l || !dabs.length) return false;
    const toMask = b.target === 'mask' || l.kind === 'fill';
    if (toMask) this.ensureMask(l, l.kind === 'fill' ? 0 : 1);
    if (!toMask && l.kind !== 'paint') return false;
    const G = this.G, fade = toMask ? G.maskFade : G.dabFade, add = toMask ? G.maskAdd : G.dabAdd, U = fade.uniforms;
    U.tP.value = this.bake.textures[0]; U.tN.value = this.bake.textures[1];
    U.hard.value = b.hard ?? .5; U.flow.value = b.flow ?? .6; U.stampOn.value = b.stamp ? 1 : 0; U.tStamp.value = b.stamp || null; U.stampMode.value = b.stampMode || 0; U.tile.value = b.tile || 1;
    const c = new THREE.Color(b.color || '#ffffff').convertLinearToSRGB(), ch = toMask ? [1, 0, 0, 0] : (b.chan || l.chan || [1, 1, 1, 0]);
    U.vC.value.set(c.r, c.g, c.b, ch[0]);                  // brush colours are sRGB values: stored as sRGB (8 bit, no banding), decoded in the composite
    U.vP.value.set(b.rough ?? .5, b.metal ?? 0, b.height != null ? b.height * .5 + .5 : .5, b.emit ?? 0);
    U.on.value.set(ch[1], ch[2], ch[3], b.emit ? 1 : 0);
    if (toMask) U.vC.value.w = b.erase ? 0 : 1;
    const target = toMask ? l.mask : l.rt;
    for (let s = 0; s < dabs.length; s += 16) {
      const part = dabs.slice(s, s + 16); U.nd.value = part.length;
      part.forEach((d, i) => { U.dabs.value[i].set(d.p.x, d.p.y, d.p.z, d.r); U.dirs.value[i].copy(d.dir); U.u0s.value[i] = d.u0 || 0; if (b.stamp) { const t = d.t ? d.t.clone() : new V3(1, 0, 0); if (!d.t && Math.abs(d.dir.x) > .9) t.set(0, 1, 0); t.sub(d.dir.clone().multiplyScalar(t.dot(d.dir))).normalize(); U.stT.value[i].copy(t); U.stB.value[i].crossVectors(d.dir, t); } });
      const rect = this.rectOf(part); this.scissor(target, rect);
      U.pass.value = 0; G.pass(fade, target);
      if (!(b.erase && !toMask)) { U.pass.value = 1; G.pass(add, target); }
      this.noScissor(target); this.grow(rect);
    }
    l.ver++; this.ver++; return true;
  }
  // which part of the texture can a set of dabs touch? (BVH: the UVs of every triangle inside the spheres)
  rectOf(dabs) {
    const uv = this.mesh.geometry.attributes.uv, idx = this.mesh.geometry.index, r = [1, 1, 0, 0], sph = new THREE.Sphere();
    for (const d of dabs) {
      sph.set(d.p, d.r);
      this.bvh.shapecast({
        intersectsBounds: box => box.intersectsSphere(sph),
        intersectsTriangle: (t, ti) => { if (!t.intersectsSphere(sph)) return false;
          for (let k = 0; k < 3; k++) { const vi = idx ? idx.getX(ti * 3 + k) : ti * 3 + k, u = uv.getX(vi), v = uv.getY(vi); if (u < r[0]) r[0] = u; if (v < r[1]) r[1] = v; if (u > r[2]) r[2] = u; if (v > r[3]) r[3] = v; }
          return false; },
      });
    }
    const p = 12 / this.res; return r[2] < r[0] ? null : [Math.max(0, r[0] - p), Math.max(0, r[1] - p), Math.min(1, r[2] + p), Math.min(1, r[3] + p)];
  }
  scissor(t, rect) { if (!rect) rect = [0, 0, 1, 1]; const R = this.res; t.scissor.set(Math.floor(rect[0] * R), Math.floor(rect[1] * R), Math.ceil((rect[2] - rect[0]) * R) + 1, Math.ceil((rect[3] - rect[1]) * R) + 1); t.scissorTest = true; }
  noScissor(t) { t.scissorTest = false; }
  grow(rect) { if (!rect) return; const d = this.dirty; this.dirty = d ? [Math.min(d[0], rect[0]), Math.min(d[1], rect[1]), Math.max(d[2], rect[2]), Math.max(d[3], rect[3])] : rect.slice(); }
  // ---------------------------------------------------------------- composite (only the dirty rect)
  update() {
    if (!this.dirty) return false;
    const G = this.G, rect = this.dirty; this.dirty = null;
    const [A, B] = this.comp; let src = A, dst = B;
    const sc = t => this.scissor(t, rect);
    // base: neutral clay grey (Painter starts grey too)
    sc(A); G.baseMat.uniforms.col.value.setRGB(.42, .42, .42); G.baseMat.uniforms.rmhe.value.set(.62, 0, 0, 0); G.pass(G.baseMat, A); this.noScissor(A);
    const U = G.layerMat.uniforms;
    U.tP.value = this.bake.textures[0]; U.tN.value = this.bake.textures[1]; U.tAO.value = this.ao.texture; U.tOcc.value = this.occ; U.occMin.value.copy(this.occMin); U.occSize.value.copy(this.occSize);
    for (const l of this.layers) {
      if (!l.visible || l.opacity <= 0) continue;
      U.tPrevC.value = src.textures[0]; U.tPrevR.value = src.textures[1];
      U.kind.value = l.kind === 'paint' ? 0 : 1; U.blend.value = l.blend; U.gen.value = l.gen; U.pat.value = l.pat; U.inv.value = l.inv; U.maskOn.value = l.maskOn && l.mask ? 1 : 0;
      U.opacity.value = l.opacity; U.level.value = l.level; U.soft.value = l.soft; U.breakup.value = l.breakup; U.bscale.value = l.bscale; U.width.value = l.width; U.scale.value = l.scale; U.seed.value = l.seed; U.contrast.value = l.contrast;
      U.colA.value.set(l.colA); U.colB.value.set(l.colB); U.rmA.value.fromArray(l.rmA); U.rmB.value.fromArray(l.rmB); U.chan.value.fromArray(l.chan); U.emitOn.value = l.emitOn;
      // sRGB → the shader decodes: pass raw sRGB numbers (THREE.Color.set converts hex to LINEAR, so convert back)
      U.colA.value.convertLinearToSRGB(); U.colB.value.convertLinearToSRGB();
      U.tAlpha.value = alphaTexture(l.alpha || 'dragon round');
      U.tLC.value = l.rt ? l.rt.textures[0] : null; U.tLP.value = l.rt ? l.rt.textures[1] : null; U.tLA.value = l.rt ? l.rt.textures[2] : null; U.tMask.value = l.mask ? l.mask.texture : null;
      sc(dst); G.pass(G.layerMat, dst); this.noScissor(dst); [src, dst] = [dst, src];
    }
    const F = G.finalMat.uniforms; F.tC.value = src.textures[0]; F.tR.value = src.textures[1]; F.tAO.value = this.ao.texture; F.tT.value = this.bake.textures[2]; F.tN.value = this.bake.textures[1];
    F.tBN.value = this.bnTex; F.bnOn.value = this.bnTex ? 1 : 0; F.px.value.set(1 / this.res, 1 / this.res); F.hScale.value = this.hScale;
    sc(this.out); G.pass(G.finalMat, this.out); this.noScissor(this.out);
    return true;
  }
  // ---------------------------------------------------------------- undo: copy of a layer before a stroke
  snapLayer(i = this.sel, mask = false) {
    const l = this.layers[i]; if (!l) return null;
    const G = this.G, src = mask ? l.mask : l.rt; if (!src) return null;
    const cp = mask ? this.rt({ type: THREE.UnsignedByteType }) : this.rt({ count: 3, type: THREE.UnsignedByteType });
    if (mask) { G.copyMat.uniforms.t.value = src.texture; G.pass(G.copyMat, cp); } else { const U = G.copy3Mat.uniforms; U.t0.value = src.textures[0]; U.t1.value = src.textures[1]; U.t2.value = src.textures[2]; G.pass(G.copy3Mat, cp); }
    return { l, mask, cp };
  }
  restore(s) {
    const G = this.G, dst = s.mask ? s.l.mask : s.l.rt; if (!dst) return;
    if (s.mask) { G.copyMat.uniforms.t.value = s.cp.texture; G.pass(G.copyMat, dst); } else { const U = G.copy3Mat.uniforms; U.t0.value = s.cp.textures[0]; U.t1.value = s.cp.textures[1]; U.t2.value = s.cp.textures[2]; G.pass(G.copy3Mat, dst); }
    s.l.ver++; this.full();
  }
  // ---------------------------------------------------------------- pixels out / in (exact bytes, deflated — PNG through a canvas would mangle premultiplied paint)
  read(target, k = 0) {
    const R = this.res, buf = new Uint8Array(R * R * 4), r = this.G.renderer;
    const prev = r.getRenderTarget(); r.setRenderTarget(target, 0); r.readRenderTargetPixels(target, 0, 0, R, R, buf, undefined, k); r.setRenderTarget(prev); return buf;
  }
  write(target, k, bytes) {
    const R = this.res, t = new THREE.DataTexture(bytes, R, R, THREE.RGBAFormat, THREE.UnsignedByteType); t.needsUpdate = true;
    const G = this.G;
    if (target.textures.length === 1) { G.copyMat.uniforms.t.value = t; G.pass(G.copyMat, target); }
    else {   // multi-target: rewrite all 3 at once, keep the others as they are
      const U = G.copy3Mat.uniforms, cp = this.snapLayerRT(target); U.t0.value = k === 0 ? t : cp.textures[0]; U.t1.value = k === 1 ? t : cp.textures[1]; U.t2.value = k === 2 ? t : cp.textures[2]; G.pass(G.copy3Mat, target); cp.dispose();
    }
    t.dispose();
  }
  snapLayerRT(target) { const cp = this.rt({ count: 3, type: THREE.UnsignedByteType }), U = this.G.copy3Mat.uniforms; U.t0.value = target.textures[0]; U.t1.value = target.textures[1]; U.t2.value = target.textures[2]; this.G.pass(this.G.copy3Mat, cp); return cp; }
  // a layer as JSON (+ deflated pixels)
  layerOut(l, withPixels = true) {
    const o = {}; for (const k of ['alpha', 'kind', 'name', 'visible', 'opacity', 'blend', 'pat', 'scale', 'seed', 'contrast', 'colA', 'colB', 'rmA', 'rmB', 'chan', 'emitOn', 'gen', 'level', 'soft', 'breakup', 'bscale', 'width', 'inv', 'maskOn', 'uid', 'group']) o[k] = l[k];
    if (withPixels) {
      if (l.rt) o.px = [0, 1, 2].map(k => zlibSync(this.read(l.rt, k), { level: 6 }));
      if (l.mask) o.mpx = zlibSync(this.read(l.mask, 0), { level: 6 });
    }
    return o;
  }
  layerIn(o, at) {
    const l = this.addLayer({ ...o, maskOn: 0 }, at ?? this.layers.length); l.uid = o.uid || l.uid; l.group = o.group;
    if (o.px && l.rt) o.px.forEach((z, k) => this.write(l.rt, k, unzlibSync(new Uint8Array(z))));
    if (o.mpx) { this.ensureMask(l, 1); this.write(l.mask, 0, unzlibSync(new Uint8Array(o.mpx))); }
    l.maskOn = o.maskOn; this.full(); return l;
  }
  // ---------------------------------------------------------------- export: real image files (sRGB colour, glTF ORM, OpenGL normal)
  mapCanvas(k) {
    this.update(); const R = this.res, px = this.read(this.out, k), cv = document.createElement('canvas'); cv.width = cv.height = R;
    const g = cv.getContext('2d'), img = g.createImageData(R, R); img.data.set(px); for (let i = 3; i < px.length; i += 4) img.data[i] = 255; g.putImageData(img, 0, 0); return cv;
  }
  maps() { return { baseColor: this.mapCanvas(0), orm: this.mapCanvas(1), normal: this.mapCanvas(2), emissive: this.mapCanvas(3) }; }
  // a standalone material with plain canvas textures (glTF export)
  exportMaterial() {
    const m = this.maps(), tx = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); t.flipY = false; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
    const orm = tx(m.orm);
    return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 1, map: tx(m.baseColor, true), roughnessMap: orm, metalnessMap: orm, aoMap: orm, normalMap: tx(m.normal), emissive: 0xffffff, emissiveMap: tx(m.emissive, true) });
  }
  dispose() { for (const t of [this.bake, this.bake2, this.ao, ...this.comp, this.out]) t.dispose(); for (const l of this.layers) { l.rt && l.rt.dispose(); l.mask && l.mask.dispose(); } this.occ && this.occ.dispose(); this.bnTex && this.bnTex.dispose(); }
}
