// hAnd bUilder · sculpt + paint clay on your real table with bare hands (Quest, WebXR). Phones + PCs join with a code and watch live, from their own EYE.
//  right pinch = the tool · left pinch = its opposite · thumb + middle finger: on the clay = pull it, in the air = move / turn / scale the whole piece · left palm = tools
import * as THREE from 'three';
import { World, SessionMode } from '@iwsdk/core';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import '../qr.js';
import { createInput } from '../studio/input.js';
import { createSync, newRoom } from '../studio/sync.js';
import { solveCamera } from './camsolve.js';
import { HandClay, HMATS } from './clay.js';

const V3 = THREE.Vector3, $ = id => document.getElementById(id), q = new URLSearchParams(location.search);
const UA = window.__UA || navigator.userAgent, isQuest = /OculusBrowser|Quest/i.test(UA);
const KIND = isQuest ? 'quest' : /iPad|Tablet|SM-[TPX]\d/i.test(UA) || (/Android/i.test(UA) && !/Mobile/i.test(UA)) ? 'tablet' : /Android|iPhone|Mobile/i.test(UA) ? 'phone' : 'pc';
window.BE = { q, isQuest, version: __VERSION__ };
if (import.meta.env.DEV) import('../devlink.js');
$('ver').textContent = 'v' + __VERSION__;
const clean = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const GUEST = !!q.get('room'), ROOM = clean(q.get('room')) || clean(localStorage.getItem('hb:room')) || newRoom();
if (!GUEST) localStorage.setItem('hb:room', ROOM);
const BASE = (/^(localhost|127\.)/.test(location.hostname) && __LAN__ ? __LAN__ : location.origin) + location.pathname.replace(/[^/]*$/, '');
const LINK = BASE + 'hand.html?room=' + ROOM;

export const TOOLS = [['clay', 'ADD'], ['push', 'SCULPT + PAINT'], ['move', 'PULL'], ['smooth', 'SMOOTH'], ['flat', 'FLATTEN'], ['paint', 'PAINT'], ['select', 'GRAB STROKE'], ['area', 'SELECT AREA']];
export const COLORS = ['#f6f1e8', '#17171b', '#d8b08a', '#c44a35', '#ff7a1a', '#ffc23a', '#3fd17a', '#2fd0dc', '#3a7bff', '#a95cff', '#ff5ab4'];
const MKEYS = Object.keys(HMATS), RADIAL = [0, 3, 4, 6, 8];
const S = BE.S = { tool: 'clay', color: COLORS[0], mat: 'pearl', size: .016, mirror: false, radial: 0, room: '' };

// ------------------------------------------------------------------ world
const world = await World.create($('app'), {
  xr: { sessionMode: SessionMode.ImmersiveAR, offer: 'none', referenceSpace: { type: 'local-floor', fallbackOrder: ['local'] }, features: { handTracking: { required: false }, planeDetection: true, hitTest: true, anchors: true } },
  features: { grabbing: false, locomotion: false, spatialUI: false, physics: false }, render: { near: .01, far: 40 },
});
BE.world = world;
const renderer = world.renderer, scene = world.scene, camera = world.camera;
renderer.xr.setFramebufferScaleFactor(+(q.get('fb') || (isQuest ? 1.4 : 1))); renderer.xr.setFoveation(+(q.get('fov') || .5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = false; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
{ const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .8; pm.dispose(); }
scene.add(new THREE.HemisphereLight(0xe8ecff, 0x5c5048, .5));
const sun = new THREE.DirectionalLight(0xfff3e4, 2.3); sun.castShadow = false; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0006; sun.shadow.normalBias = .006;
Object.assign(sun.shadow.camera, { left: -.5, right: .5, top: .5, bottom: -.5, near: .1, far: 4 }); scene.add(sun, sun.target);
const rimL = new THREE.DirectionalLight(0xbdd4ff, 1); scene.add(rimL, rimL.target);
const root = new THREE.Group(); root.name = 'hand-root'; scene.add(root); BE.root = root;

// the box you work in + the shadow your piece throws onto the real table
const BOX = [.56, .42, .44];
const stage = new THREE.Group(); root.add(stage);
{ const [w, h, d] = BOX, pts = [], x = w / 2, z = d / 2, add = (a, b, c, e, f, g) => pts.push(a, b, c, e, f, g);
  for (const [a, b] of [[-x, -z], [x, -z], [x, z], [-x, z]]) add(a, 0, b, a, h, b);
  for (const y of [0, h]) { add(-x, y, -z, x, y, -z); add(x, y, -z, x, y, z); add(x, y, z, -x, y, z); add(-x, y, z, -x, y, -z); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const f = []; for (let a = -x; a <= x + 1e-6; a += .08) f.push(a, 0, -z, a, 0, z); for (let b = -z; b <= z + 1e-6; b += .08) f.push(-x, 0, b, x, 0, b);
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(f, 3)); const floorG = new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .07, depthWrite: false })); stage.userData.floor = floorG; }
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ opacity: .42, depthWrite: false })); catcher.rotation.x = -Math.PI / 2; catcher.position.y = .0008; catcher.receiveShadow = true;   // no ground, no shadows: the clay lives freely in the air
const symG = new THREE.BufferGeometry(); symG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3)); const symL = new THREE.LineSegments(symG, new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: .5, depthWrite: false })); symL.visible = false; root.add(symL);
function drawSym() { const P = symG.attributes.position, n = S.radial || (S.mirror ? 1 : 0); symL.visible = !!n; let k = 0; const put = (a, b, c) => P.setXYZ(k++, a, b, c); if (S.radial) for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; put(0, .002, 0); put(Math.sin(t) * .22, .002, Math.cos(t) * .22); } else if (S.mirror) { put(0, .002, -.22); put(0, .002, .22); put(0, .002, .22); put(0, .3, .22); put(0, .002, -.22); put(0, .3, -.22); } symG.setDrawRange(0, k); P.needsUpdate = true; }

// ------------------------------------------------------------------ the clay object (one per room, shared by sync)
const objs = []; let clay = null, sync = null;
function buildObject(rec) { const sc = new HandClay(rec), o = sc.group; o.userData.rec = rec; o.userData.sculpt = sc; if (rec.m) new THREE.Matrix4().fromArray(rec.m).decompose(o.position, o.quaternion, o.scale); return o; }
function addObj(o) { objs.push(o); root.add(o); clay = o.userData.sculpt; BE.clay = clay; }
function removeObj(o) { const i = objs.indexOf(o); if (i >= 0) objs.splice(i, 1); root.remove(o); o.userData.sculpt.dispose(); if (clay === o.userData.sculpt) clay = null; }
const newClay = () => addObj(buildObject({ id: 'clay', type: 'sculpt', vs: +(q.get('vs') || .0024), mat: 'pearl', tone: 'pearl' }));
const col = new THREE.Color();
function starter() { const p = new V3(0, .072, 0); clay.segment(p, p, .07, .07, false, col.set(COLORS[0]), 'pearl'); }

// saved between sessions, chunk by chunk (only what changed)
let db = null; const openDB = () => new Promise(res => { const r = indexedDB.open('handbuilder2', 1); r.onupgradeneeded = () => r.result.createObjectStore('c'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
const saving = new Set(); let saveAt = 0;
function noteChanged() { saveAt = performance.now() + 1500; }
function flushSave() { if (!db || !clay || !saving.size) return; const tx = db.transaction('c', 'readwrite'), st = tx.objectStore('c'); let n = 0; for (const k of saving) { saving.delete(k); if (clay.chunks.has(k)) st.put(clay.packChunk(k), k); else st.delete(k); if (++n >= 12) break; } if (saving.size) saveAt = performance.now() + 60; }
async function loadSaved() { if (!db) return 0; const all = await new Promise(res => { const r = db.transaction('c').objectStore('c').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); let n = 0; for (const [x, y, z, u] of all) { const C3 = u.length / 6; let solid = false; for (let i = 0; i < C3; i++) if (u[i] > 0) { solid = true; break; } if (solid) { clay.applyChunk(x, y, z, u); n++; } } if (n < all.length) { const st = db.transaction('c', 'readwrite').objectStore('c'); for (const [x, y, z, u] of all) { let solid = false; for (let i = 0; i < u.length / 6; i++) if (u[i] > 0) { solid = true; break; } if (!solid) st.delete(((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512)); } } return n; }
const wipeSaved = () => { if (db) db.transaction('c', 'readwrite').objectStore('c').clear(); };

// ------------------------------------------------------------------ symmetry, undo
function syms() { const out = [], n = S.radial || 1; for (const m of S.mirror ? [1, -1] : [1]) for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; out.push({ m, c: Math.cos(t), s: Math.sin(t) }); } return out; }
const sy = (o, v, out) => { const x = v.x * o.m; return out.set(x * o.c + v.z * o.s, v.y, -x * o.s + v.z * o.c); };
const undoS = [], redoS = [];
function pushUndo(h) { undoS.push(h); redoS.length = 0; let b = 0; for (const u of undoS) b += u.bytes || 0; while (undoS.length > 1 && (undoS.length > 24 || b > 160e6)) b -= undoS.shift().bytes || 0; }   // undo may never eat the headset's memory
const undo = () => { const h = undoS.pop(); if (h) { h.undo(); redoS.push(h); blip(330); } };
const redo = () => { const h = redoS.pop(); if (h) { h.redo(); undoS.push(h); blip(440); } };
function wipe() { if (!clay) return; if (clay.chunks.size > 500) { for (const ch of [...clay.chunks.values()]) { clay.changed.add(ch.k); (clay.unsaved ||= new Set()).add(ch.k); clay.dropChunk(ch); } clay.recs.length = 0; undoS.length = redoS.length = 0; noteChanged(); blip(180); return; } clay.begin(); for (const ch of clay.chunks.values()) { clay.snapshot(ch); ch.d.fill(-1); clay.markDirty(ch.cx, ch.cy, ch.cz); } const h = clay.end(); if (h) pushUndo(h); blip(180); }

// ------------------------------------------------------------------ strokes: one code path for hands, controllers, mouse + touch
const SZ0 = .003, SZ1 = .14, BRUSH_MIN = .7;                                       // shrink the piece and the brush shrinks with it: a stroke never costs more than ~3x
const strokes = new Map(); let active = 0;
const symQ = [], runSym = ms => { const t = performance.now(); while (symQ.length && performance.now() - t < ms) symQ.shift()(); };
const spread = (SY, fn) => { fn(SY[0]); for (let i = 1; i < SY.length; i++) { const o = SY[i]; symQ.push(() => fn(o)); } };
const A = new V3(), B = new V3(), D = new V3(), N0 = new V3(), P0 = new V3();
// grab a stroke: right pinch lifts it off, left pinch pulls a copy. It rides on the hand, moves and turns freely, and sets down where you let go
let carry = null; const cQ = new THREE.Quaternion(), cI = new THREE.Quaternion();
let sel = null, lastMove = null, areaS = [], shapeNow = null; const SHAPE_G = { box: new THREE.BoxGeometry(2, 2, 2), cyl: new THREE.CylinderGeometry(.8, .8, 2, 32), cone: new THREE.ConeGeometry(.8, 2, 32) };
const shapeFX = new THREE.Mesh(SHAPE_G.box, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .4, transparent: true, opacity: .55, depthWrite: false })); shapeFX.visible = false; root.add(shapeFX);
const areaFX = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: .16, depthWrite: false, toneMapped: false }), 64); areaFX.count = 0; areaFX.frustumCulled = false; root.add(areaFX);
const clearSel = () => { if (!sel) return; root.remove(sel.g.group); sel.g.dispose(); sel = null; };
function areaMove(p) { const r = Math.min(Math.max(S.size * 1.6, .03) / root.scale.x, clay.vs * 40), L = areaS[areaS.length - 1]; if (areaS.length >= 64 || (L && L[0].distanceTo(p) < r * .45)) return; areaS.push([p.clone(), r]); areaFX.setMatrixAt(areaS.length - 1, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new V3(r, r, r))); areaFX.count = areaS.length; areaFX.instanceMatrix.needsUpdate = true; }
function areaEnd() { areaFX.count = 0; const rec = areaS.length ? clay.areaRec(areaS) : null; areaS = []; clearSel(); if (!rec) { blip(200, .03); return; } const g = clay.lift(rec, false), m = g.mat; if (m.emissive) { m.emissive.set(0xffa21f); m.emissiveIntensity = .45; } m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; m.needsUpdate = true; root.add(g.group); sel = { rec, g }; S.tool = 'select'; blip(700, .05); if (panel.visible) drawPanel(); }
function doRepeat() { if (!lastMove || active) { blip(200, .03); return; } const L = lastMove, prev = L.cur.clone(); L.cur.premultiply(L.M); clay.begin(); clay.stamp(L.g, L.cur); const h = clay.end(); if (h) { const u = h.undo, r = h.redo, now = L.cur.clone(); h.undo = () => { u(); L.cur.copy(prev); }; h.redo = () => { r(); L.cur.copy(now); }; pushUndo(h); noteChanged(); } blip(760, .04); }
function shapeLook(s) { shapeFX.geometry = SHAPE_G[s]; shapeFX.material.color.set(HMATS[S.mat].base || S.color); shapeFX.visible = true; }
function shapeMove(s, p) { const hMax = clay.vs * 60, h = Math.min(hMax, Math.max(Math.max(S.size, .012) / root.scale.x, s.p0.distanceTo(p))); s.h = h; const R = I.R; shapeLook(s.kind); shapeFX.position.copy(s.p0); shapeFX.scale.setScalar(h); if (R.kind !== 'none') shapeFX.quaternion.copy(root.quaternion).invert().multiply(R.kind === 'hand' ? R.palm.quat : R.quat); else shapeFX.quaternion.identity(); s.q = shapeFX.quaternion.clone(); }
function shapeEnd(s) { shapeFX.visible = false; const M = HMATS[S.mat]; clay.stampShape(s.kind, s.p0, s.q || new THREE.Quaternion(), s.h, new THREE.Color(M.base || S.color), M.rough, M.metal); blip(600, .05); }
function shapeStep(L, R) {                                  // left hand: 1 finger = box, 2 = cylinder, 3 = cone. The right fingertip shows what you will place
  shapeNow = null; if (L.kind === 'hand' && S.tool === 'clay' && !L.on && !L.fist && !L.grip) { const c = L.curl, u = i => c[i] > 1.6, d = i => c[i] < 1.35; shapeNow = u(0) && d(1) && d(2) && d(3) ? 'box' : u(0) && u(1) && d(2) && d(3) ? 'cyl' : u(0) && u(1) && u(2) && d(3) ? 'cone' : null; }
  if ([...strokes.values()].some(s => s.tool === 'shape')) return; if (!shapeNow || R.kind === 'none') { shapeFX.visible = false; return; }
  shapeLook(shapeNow); root.worldToLocal(shapeFX.position.copy(R.pos)); shapeFX.scale.setScalar(Math.max(S.size, .012) / root.scale.x); shapeFX.quaternion.copy(root.quaternion).invert().multiply(R.kind === 'hand' ? R.palm.quat : R.quat);
}
let grabR = 0;
function carryStart(p, inv) { const r = grabR || Math.max(S.size, .014) / root.scale.x; let rec = null; if (sel && clay.recNear(sel.rec, p, r)) { rec = sel.rec; clearSel(); } else if (sel && !grabR) { clearSel(); blip(300, .03); return; } else rec = clay.pick(p, r) || (grabR ? clay.connected(p, r) : null); if (!rec) { blip(200, .03); return; } const g = clay.lift(rec, !inv); root.add(g.group); carry = { g, p0: p.clone(), q0: null, hand: null, q: new THREE.Quaternion() }; blip(inv ? 880 : 660, .05); }
function carryMove(p) {
  if (!carry) return; const c = carry, H = c.hand;
  if (H) { cQ.copy(root.quaternion).invert().multiply(H.kind === 'hand' ? H.palm.quat : H.quat); if (!c.q0) c.q0 = cQ.clone(); cI.copy(c.q0).invert(); c.q.slerp(cQ.multiply(cI), .5); }
  c.g.group.quaternion.copy(c.q); c.g.group.position.copy(p).sub(c.p0.clone().applyQuaternion(c.q));
}
function carryEnd() { if (!carry) return; const g = carry.g; g.group.updateMatrix(); clay.stamp(g, g.group.matrix); root.remove(g.group); if (lastMove) lastMove.g.dispose(); lastMove = { g, M: g.group.matrix.clone(), cur: g.group.matrix.clone() }; carry = null; blip(520, .05); }
function strokeBegin(id, tool, p, inv) {
  if (!clay || GUEST) return; if (!active++) clay.begin();
  const s = { tool, inv, f: p.clone(), last: p.clone(), len: 0, hold: 0, n: null, pp: null, rPrev: 0, first: true }; strokes.set(id, s); if (tool === 'area') areaS = []; if (tool === 'shape') { s.kind = shapeNow; s.p0 = p.clone(); s.h = 0; }
  if (tool === 'flat') { s.n = clay.normalAt(p); s.pp = p.clone(); }
  grain(tool, inv, true); if (tool === 'select') carryStart(p, inv); if (tool !== 'press') strokeMove(id, p, .016);
}
function strokeMove(id, p, dt) {
  const s = strokes.get(id); if (!s || !clay) return 0; if (s.tool === 'select') { carryMove(p); return 0; } if (s.tool === 'area') { areaMove(p); return 0; } if (s.tool === 'shape') { shapeMove(s, p); return 0; }
  const R = Math.max(S.size / Math.max(root.scale.x, BRUSH_MIN), clay.vs * 1.25), raw = s.f.distanceTo(p) / Math.max(dt, .004), k = 1 - Math.exp(-dt * (22 + raw * 90)); s.f.lerp(p, k);
  const step = s.f.distanceTo(s.last), M = HMATS[S.mat], SY = syms(), mat = S.mat, inv = s.inv; clay.focus.copy(s.f);
  if (!s.first && SY.length > 1 && symQ.length > (SY.length - 1) * 3) return raw;   // copies are behind: skip a stamp, the next one bridges the gap
  const c0 = col.set(M.base || S.color).clone();
  if (s.tool === 'clay') {
    if (step > R * .22 || s.first) {
      const maxL = R * 1.2, parts = Math.max(1, Math.min(16, Math.ceil(step / maxL))), adv = Math.min(1, parts * maxL / Math.max(step, 1e-9));   // a fast hand on a zoomed-out piece: short pieces only, the rest follows next frame
      s.len += step * adv; const r = R * (.42 + .58 * Math.min(1, s.len / (R * 2.4))) * (1 + s.hold * .5), r0 = s.rPrev || r * .9, la = s.last.clone(), lb = s.last.clone().lerp(s.f, adv);
      for (let i = 0; i < parts; i++) { const pa = la.clone().lerp(lb, i / parts), pb = la.clone().lerp(lb, (i + 1) / parts), ra = r0 + (r - r0) * i / parts, rb = r0 + (r - r0) * (i + 1) / parts; spread(SY, o => { sy(o, pa, A); sy(o, pb, B); clay.segment(A, B, ra, rb, inv, inv ? null : c0, mat); }); }
      s.rPrev = r; s.last.copy(lb); s.hold *= .8;
    } else {                                               // hold still = the blob swells
      s.hold = Math.min(4.5, s.hold + dt * 2.6); const r = R * (1 + s.hold * .62), pt = s.f.clone();
      if (r > s.rPrev + clay.vs * .1) { spread(SY, o => { sy(o, pt, A); clay.segment(A, A, r, r, inv, inv ? null : c0, mat); }); s.rPrev = r; }
    }
  } else if (s.tool === 'move') {
    if (step > clay.vs * .12) {
      D.subVectors(s.f, s.last); const L = D.length(), n = Math.ceil(L / (R * .7)); D.multiplyScalar(1 / n);
      for (let i = 0; i < Math.min(n, 16); i++) { const la = s.last.clone(), d = D.clone(); spread(SY, o => { sy(o, la, A); B.set(d.x * o.m, d.y, d.z); B.set(B.x * o.c + B.z * o.s, B.y, -B.x * o.s + B.z * o.c); clay.grabStep(A, B, R * 1.9); }); s.last.add(D); }
    }
  } else if (s.tool === 'press') {
    const pp = s.pp.clone(), nn = s.n.clone(), pr = Math.min(.05 / root.scale.x, clay.vs * 28), k = Math.min(.7, dt * 26);
    spread(SY, o => { sy(o, pp, A); sy(o, pp, P0); N0.set(nn.x * o.m, nn.y, nn.z); N0.set(N0.x * o.c + N0.z * o.s, N0.y, -N0.x * o.s + N0.z * o.c); clay.press(A, pr, N0, P0, k); });
  } else {
    const moved = step > R * .12 || s.first, tool = s.tool, pt = s.f.clone(), pp = s.pp && s.pp.clone(), nn = s.n && s.n.clone(), push = moved || s.hold < 1, pc = inv ? new THREE.Color(COLORS[0]) : c0; if (s.first || moved) s.last.copy(s.f);
    if ((tool !== 'push' || push) && (tool !== 'paint' || moved)) spread(SY, o => {
      sy(o, pt, A);
      if (tool === 'push') { clay.inflate(A, R * 1.25, (inv ? -1 : 1) * Math.min(.32, dt * 9)); if (!inv) clay.paintFast(A, R * 1.25, c0, M.rough, M.metal, Math.min(.6, dt * 16)); }
      else if (tool === 'smooth') clay.smooth(A, R * 1.3, .6);
      else if (tool === 'flat') { sy(o, pp, P0); N0.set(nn.x * o.m, nn.y, nn.z); N0.set(N0.x * o.c + N0.z * o.s, N0.y, -N0.x * o.s + N0.z * o.c); clay.flatten(A, R * 1.4, N0, P0, .5); }
      else if (tool === 'paint') clay.paintFast(A, R * 1.3, pc, M.rough, M.metal, .42);
    });
    s.hold += dt;
  }
  s.first = false; return raw;
}
function strokeEnd(id) { const st0 = strokes.get(id); if (!strokes.delete(id) || !clay) return; if (st0.tool === 'select') carryEnd(); if (st0.tool === 'area') areaEnd(); if (st0.tool === 'shape') shapeEnd(st0); if (!--active) { runSym(1e9); const h = clay.end(); if (h) pushUndo(h); noteChanged(); grain(null); } }

// ------------------------------------------------------------------ sound (soft clay, nothing recorded)
let ac = null, gN = null, fN = null;
function audio() { if (ac) { ac.resume(); return; } try { ac = new (window.AudioContext || window.webkitAudioContext)(); const n = ac.sampleRate * 2, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0); let l = 0; for (let i = 0; i < n; i++) { l = l * .86 + (Math.random() * 2 - 1) * .14; d[i] = l * 2.4; } const s = ac.createBufferSource(); s.buffer = b; s.loop = true; fN = ac.createBiquadFilter(); fN.type = 'bandpass'; fN.frequency.value = 420; fN.Q.value = .9; gN = ac.createGain(); gN.gain.value = 0; s.connect(fN).connect(gN).connect(ac.destination); s.start(); } catch { } }
function blip(f = 520, g = .05) { if (!ac) return; const o = ac.createOscillator(), a = ac.createGain(), t = ac.currentTime; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.5, t + .07); a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(.0001, t + .13); o.connect(a).connect(ac.destination); o.start(t); o.stop(t + .14); }
function grain(tool, inv, start) { if (!ac) return; if (!tool) { gN.gain.setTargetAtTime(0, ac.currentTime, .05); return; } fN.frequency.setTargetAtTime(tool === 'move' ? 240 : tool === 'paint' ? 1500 : inv ? 720 : 430, ac.currentTime, .02); if (start) blip(inv ? 300 : 210, .04); }
const voice = sp => { if (gN) gN.gain.setTargetAtTime(Math.min(.2, .012 + sp * .26), ac.currentTime, .03); };

// ------------------------------------------------------------------ pearl hands (yours in the headset, the sculptor's on every other screen)
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [0, 9], [9, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [15, 16], [0, 17], [17, 18], [18, 19], [19, 20], [5, 9], [9, 13], [13, 17]];
const RAD = i => i === 0 ? .021 : i === 1 ? .017 : [5, 9, 13, 17].includes(i) ? .0125 : [4, 8, 12, 16, 20].includes(i) ? (i === 4 ? .0088 : .0078) : .0098;
const handMask = new THREE.MeshBasicMaterial({ colorWrite: false }), handLine = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide, toneMapped: false });
const outlineHands = (parent, max) => { const a = handSet(parent, max, handMask, 0, -5), b = null; return { draw(l) { a.draw(l); } };   /* no drawn hands: only the real hand in front of the clay */ };
function handSet(parent, max, handMat, grow, order) {
  const sph = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), handMat, 21 * max), cyl = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), handMat, BONES.length * max);
  sph.frustumCulled = cyl.frustumCulled = false; sph.renderOrder = cyl.renderOrder = order; sph.count = cyl.count = 0; parent.add(sph, cyl);
  const m = new THREE.Matrix4(), s = new V3(), qt = new THREE.Quaternion(), up = new V3(0, 1, 0), c = new V3(), d = new V3();
  return { draw(list) {
    let a = 0, b = 0;
    for (const h of list) {
      for (let i = 0; i < 21; i++) { s.setScalar(RAD(i) + grow); m.compose(h[i], qt.identity(), s); sph.setMatrixAt(a++, m); }
      for (const [x, y] of BONES) { d.subVectors(h[y], h[x]); const L = d.length(); if (L < 1e-4) continue; c.addVectors(h[x], h[y]).multiplyScalar(.5); qt.setFromUnitVectors(up, d.multiplyScalar(1 / L)); const r = Math.min(RAD(x), RAD(y)) + grow; s.set(r, L, r); m.compose(c, qt, s); cyl.setMatrixAt(b++, m); }
    }
    sph.count = a; cyl.count = b; sph.instanceMatrix.needsUpdate = cyl.instanceMatrix.needsUpdate = true;
  } };
}
const myHands = outlineHands(scene, 2), theirHands = outlineHands(root, 4);

// the brush you can see at your fingertips
const curMat = () => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { c: { value: new THREE.Color(0xffffff) } },
  vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 m = modelViewMatrix * vec4(position,1.); n = normalMatrix * normal; v = -m.xyz; gl_Position = projectionMatrix * m; }',
  fragmentShader: 'uniform vec3 c; varying vec3 n; varying vec3 v; void main(){ float f = 1. - abs(dot(normalize(n), normalize(v))); gl_FragColor = vec4(c, .05 + pow(f, 2.6) * .85); }' });
const CUR = { L: new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), curMat()), R: new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), curMat()) }; scene.add(CUR.L, CUR.R); CUR.L.visible = CUR.R.visible = false;

// sparks of clay leaving your fingers: all motion happens in the vertex shader
const PN = 1400, pA = new Float32Array(PN * 4), pB = new Float32Array(PN * 3), pC = new Float32Array(PN * 3); let pI = 0, pDirty = false;
const pG = new THREE.BufferGeometry(); pG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3)); pG.setAttribute('a', new THREE.BufferAttribute(pA, 4)); pG.setAttribute('b', new THREE.BufferAttribute(pB, 3)); pG.setAttribute('c', new THREE.BufferAttribute(pC, 3)); pG.boundingSphere = new THREE.Sphere(new V3(), 1e3);
const pM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { T: { value: 0 }, H: { value: 1200 } },
  vertexShader: 'attribute vec4 a; attribute vec3 b; attribute vec3 c; uniform float T, H; varying vec3 C; varying float L; void main(){ float t = T - a.w; L = clamp(1. - t / .75, 0., 1.); vec3 p = a.xyz + b * t * (1. - t * .55) + vec3(0., -.05, 0.) * t * t; C = c; vec4 m = modelViewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * m; gl_PointSize = L <= 0. ? 0. : H * projectionMatrix[1][1] * .0016 * L / -m.z; }',
  fragmentShader: 'varying vec3 C; varying float L; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(C * (1. - d * 2.) * L * .9, 1.); }' });
const pts = new THREE.Points(pG, pM); pts.frustumCulled = false; scene.add(pts);
function spark(p, c, n = 2, sp = .09) { for (let i = 0; i < n; i++) { const j = pI++ % PN, a = Math.random() * 6.28, z = Math.random() * 2 - 1, r = Math.sqrt(1 - z * z); pA.set([p.x, p.y, p.z, pM.uniforms.T.value], j * 4); pB.set([Math.cos(a) * r * sp, z * sp, Math.sin(a) * r * sp], j * 3); pC.set([c.r, c.g, c.b], j * 3); } pDirty = true; }

// ------------------------------------------------------------------ the palm menu
const PW = 1100, PH = 760, pcv = document.createElement('canvas'); pcv.width = PW; pcv.height = PH; const g2 = pcv.getContext('2d');
const pTex = new THREE.CanvasTexture(pcv); pTex.colorSpace = THREE.SRGBColorSpace; pTex.anisotropy = 4;
const panel = new THREE.Mesh(new THREE.PlaneGeometry(.31, .31 * PH / PW), new THREE.MeshBasicMaterial({ map: pTex, transparent: true, toneMapped: false, depthWrite: false, side: THREE.DoubleSide })); panel.visible = false; panel.renderOrder = 20; panel.material.depthTest = false; scene.add(panel);
let hot = [], hover = null;
const act = {
  tool: v => { S.tool = v; }, color: v => { S.color = v; }, mat: v => { S.mat = v; }, mirror: () => { S.mirror = !S.mirror; drawSym(); }, radial: () => { S.radial = RADIAL[(RADIAL.indexOf(S.radial) + 1) % RADIAL.length]; drawSym(); },
  undo, redo, wipe: () => { wipe(); }, size: v => { S.size = v; }, level: () => { levelRoot(); land(); }, close: () => { menuOpen = false; }, setcam: () => { camStep = 1; camArm = false; menuOpen = false; }, repeat: () => doRepeat(),
};
function pill(x, y, w, h, label, on, id, val) {
  const hv = hover && hover.id === id && hover.val === val; g2.beginPath(); g2.roundRect(x, y, w, h, h / 2); g2.fillStyle = on ? '#fff' : hv ? '#ffffff30' : '#ffffff10'; g2.fill(); g2.strokeStyle = on ? '#fff' : '#ffffff40'; g2.lineWidth = 2; g2.stroke();
  g2.fillStyle = on ? '#000' : '#fff'; g2.font = `${w < 150 ? 500 : 400} ${h * .36}px system-ui, sans-serif`; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(label, x + w / 2, y + h / 2 + 1); hot.push({ x, y, w, h, id, val });
}
function drawPanel() {
  hot = []; g2.clearRect(0, 0, PW, PH); g2.beginPath(); g2.roundRect(4, 4, PW - 8, PH - 8, 44); g2.fillStyle = '#08080bee'; g2.fill(); g2.strokeStyle = '#ffffff30'; g2.lineWidth = 2; g2.stroke();
  const M = 36, W = PW - M * 2; let y = 28; const cw = (W - 20) / 3;
  g2.fillStyle = '#fff'; g2.font = '300 42px system-ui'; g2.textAlign = 'left'; g2.textBaseline = 'middle'; g2.fillText('\u22EE\u22EE  TOOLS', M + 6, y + 34); hot.push({ x: M, y, w: W - 530, h: 68, id: 'drag' }); pill(PW - M - 250, y, 250, 68, '\u2715  CLOSE', false, 'close'); y += 86;
  TOOLS.forEach(([k, l], i) => pill(M + (i % 3) * (cw + 10), y + (i / 3 | 0) * 84, cw, 72, l, S.tool === k, 'tool', k)); { const i = TOOLS.length; pill(M + (i % 3) * (cw + 10), y + (i / 3 | 0) * 84, cw, 72, 'REPEAT', false, 'repeat'); } y += Math.ceil((TOOLS.length + 1) / 3) * 84 + 18;
  COLORS.forEach((c, i) => { const r = 33, x = M + r + i * ((W - 2 * r) / (COLORS.length - 1)); g2.beginPath(); g2.arc(x, y + r, r, 0, 7); g2.fillStyle = c; g2.fill(); g2.strokeStyle = S.color === c ? '#fff' : '#ffffff30'; g2.lineWidth = S.color === c ? 7 : 2; g2.stroke(); hot.push({ x: x - r, y, w: r * 2, h: r * 2, id: 'color', val: c }); }); y += 88;
  const mw = (W - 50) / 6; MKEYS.forEach((k, i) => pill(M + i * (mw + 10), y, mw, 62, HMATS[k].label, S.mat === k, 'mat', k)); y += 84;
  const x0 = M + 120, sw = W - 120; g2.fillStyle = '#fff'; g2.font = '400 26px system-ui'; g2.textAlign = 'left'; g2.textBaseline = 'middle'; g2.fillText('SIZE', M, y + 26); g2.fillStyle = '#ffffff30'; g2.fillRect(x0, y + 23, sw, 6); const t = Math.log(S.size / SZ0) / Math.log(SZ1 / SZ0), kx = x0 + t * sw; g2.fillStyle = '#fff'; g2.fillRect(x0, y + 23, t * sw, 6); g2.beginPath(); g2.arc(kx, y + 26, 10 + t * 16, 0, 7); g2.fill(); hot.push({ x: x0 - 16, y: y - 10, w: sw + 32, h: 72, id: 'size', slide: [x0, sw] }); y += 76;
  const bw = (W - 50) / 6; [['MIRROR', 'mirror', S.mirror], [S.radial ? 'RADIAL ' + S.radial : 'RADIAL', 'radial', !!S.radial], ['UNDO', 'undo'], ['REDO', 'redo'], ['LEVEL', 'level'], ['NEW', 'wipe']].forEach(([l, id, on], i) => pill(M + i * (bw + 10), y, bw, 68, l, !!on, id)); y += 84;
  g2.fillStyle = '#9a9aa2'; g2.font = '400 25px system-ui'; g2.textAlign = 'center'; g2.fillText(`point + pinch, or touch  ·  code ${ROOM}  ·  ${watchers()} watching`, PW / 2, y + 16);
  pTex.needsUpdate = true;
}
const watchers = () => peers.size;
let camStep = 0, camArm = false, camT = 0, camSet = (() => { try { return JSON.parse(localStorage.getItem('hb:campose')); } catch { return null; } })();
let panelK = 0, wasIn = false, slide = null, palmT = 0, palmReady = true, panelLaid = false, panelSet = false, dragPad = null, armed = false, aimX = -1, aimY = -1, tagOpen = null;
const tagC = document.createElement('canvas'); tagC.width = 360; tagC.height = 110; const tagG = tagC.getContext('2d'), tagT = new THREE.CanvasTexture(tagC); tagT.colorSpace = THREE.SRGBColorSpace;
const wristTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagT, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); wristTag.scale.set(.09, .0275, 1); wristTag.renderOrder = 22; wristTag.visible = false; scene.add(wristTag);
function drawTag() { const g = tagG; g.clearRect(0, 0, 360, 110); g.beginPath(); g.roundRect(4, 4, 352, 102, 51); g.fillStyle = tagOpen ? '#08080bee' : '#fff'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 4; g.stroke(); g.fillStyle = tagOpen ? '#fff' : '#000'; g.font = '500 50px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tagOpen ? '\u2715 CLOSE' : 'TOOLS', 180, 57); tagT.needsUpdate = true; }
const lp = new V3(), toHead = new V3(), rayO = new V3(), rayD = new V3(), menuR = new V3();
const aimDot = new THREE.Mesh(new THREE.RingGeometry(.0035, .0062, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); aimDot.renderOrder = 21; aimDot.visible = false; panel.add(aimDot);
function layPad() {                                         // let go just above a real surface: the pad lies down on it
  const p = panel.position; for (const t of tops) { if (Math.abs(p.y - t.y) > .16) continue; const l = p.clone().applyMatrix4(t.M.clone().invert()); if (!inPoly(t.P, l.x, l.z)) continue; p.y = t.y + .006; panel.rotation.set(-Math.PI / 2, 0, Math.atan2(I_head.x - p.x, I_head.z - p.z)); panelLaid = true; blip(520, .05); return; }
}
const I_head = new V3();
function menuStep(L, R, head, dt) {
  I_head.copy(head);
  const facing = 0, palm = L.kind === 'hand' ? L.pinky && !active : L.palmUp && R.palmUp; palmT = palm ? palmT + dt : 0; if (!palm) palmReady = true;
  const wasOpen = menuOpen; if (L.kind === 'ctrl' && L.aDown) menuOpen = !menuOpen; if (palmReady && palmT > .22) { palmReady = false; menuOpen = !menuOpen; blip(menuOpen ? 620 : 420, .04); }
  const tagA = 0; wristTag.visible = tagA > .02;
  if (wristTag.visible) { if (tagOpen !== menuOpen) { tagOpen = menuOpen; drawTag(); } wristTag.material.opacity = tagA; wristTag.position.copy(L.pts[0]).lerp(L.pts[9], .5); wristTag.position.y += .075; }
  if (menuOpen && !wasOpen && panelSet && panel.position.distanceTo(head) < 1.4) { armed = false; aimX = -1; }
  else if (menuOpen && !wasOpen) { panelSet = false; panelLaid = false;                               // opens once, beside the hand and stays: the right hand never has to cross the left one
    lp.copy(L.pts ? L.pts[9] : L.pos); lp.y += .1; toHead.subVectors(head, lp); toHead.y = 0; if (toHead.lengthSq() < 1e-4) toHead.set(0, 0, 1); toHead.normalize(); menuR.crossVectors(THREE.Object3D.DEFAULT_UP, toHead);
    lp.addScaledVector(menuR, .17).addScaledVector(toHead, .08); panel.position.copy(lp); armed = false; aimX = -1; drawHint(5);
  }
  panelK += ((menuOpen ? 1 : 0) - panelK) * Math.min(1, dt * 14); panel.visible = panelK > .03; if (!panel.visible) { wasIn = false; slide = null; aimDot.visible = false; return false; }
  if (!panelLaid) panel.lookAt(head); panel.scale.setScalar(.6 + .4 * panelK); panel.material.opacity = panelK; panel.updateMatrixWorld();
  if (!menuOpen) { aimDot.visible = false; return true; }
  const tip = R.kind === 'none' ? null : R.pts ? R.pts[8] : R.pos; if (!tip) { aimDot.visible = false; return true; }
  if (!R.on) armed = true;
  lp.copy(tip); panel.worldToLocal(lp); const w = .31, h = .31 * PH / PW, toX = x => (x / w + .5) * PW, toY = y => (.5 - y / h) * PH, onP = (x, y) => x > 0 && x < PW && y > 0 && y < PH;
  const close = onP(toX(lp.x), toY(lp.y)) && Math.abs(lp.z) < .05; let px = -1, py = -1;
  if (close) { px = toX(lp.x); py = toY(lp.y); }
  else { rayO.copy(lp); rayD.copy(tip).add(R.dir); panel.worldToLocal(rayD).sub(rayO); if (rayD.z < -1e-4 && rayO.z > 0) { const t = -rayO.z / rayD.z; if (t < 1.6) { px = toX(rayO.x + rayD.x * t); py = toY(rayO.y + rayD.y * t); } } }
  if (panelLaid && lp.length() > .35) { px = py = -1; aimX = -1; }          // a pad lying on the table only reacts when your hand is there
  if (R.trig < .35 && !R.on) { aimX = px; aimY = py; }      // closing the fingers bends the index: the aim freezes just before the pinch lands
  const inside = onP(aimX, aimY), find = (x, y) => hot.find(b => x >= b.x - 8 && x <= b.x + b.w + 8 && y >= b.y - 8 && y <= b.y + b.h + 8), hit = inside ? find(aimX, aimY) : null;
  aimDot.visible = inside; if (inside) aimDot.position.set((aimX / PW - .5) * w, (.5 - aimY / PH) * h, .002);
  if ((hit && hit.id) !== (hover && hover.id) || (hit && hit.val) !== (hover && hover.val)) { hover = hit; drawPanel(); }
  const poke = close && R.kind === 'hand' && lp.z < .014, pinch = armed && R.onDown;
  if (hit && ((poke && !wasIn) || (pinch && inside))) { if (hit.slide) slide = hit; else if (hit.id === 'drag') { dragPad = new V3().subVectors(panel.position, R.pos); panelLaid = false; panelSet = true; } else { act[hit.id](hit.val); blip(760, .035); drawPanel(); } }
  else if (pinch && !inside && !panelLaid) { menuOpen = false; blip(420, .03); }
  if (dragPad) { if (R.on) panel.position.addVectors(R.pos, dragPad); else { dragPad = null; layPad(); } }
  if (slide && (R.on || poke) && onP(px, py)) { S.size = SZ0 * (SZ1 / SZ0) ** THREE.MathUtils.clamp((px - slide.slide[0]) / slide.slide[1], 0, 1); drawPanel(); } else if (!R.on && !poke) slide = null;
  if (poke) wasIn = true; else if (R.kind !== 'hand' || lp.z > .022 || !close) wasIn = false;
  return panelLaid ? inside || close : true;
}
let menuOpen = false;

// one line at a time, only until you have done it
const HINTS = ['Pinch with your right hand to add clay', 'Hold the pinch still: it swells', 'Pinch with your left hand to carve', 'Thumb + middle finger on the clay: pull it', 'Make a fist: grab and turn the piece. Two fists: resize', 'Show your left palm: tools. Show it again: close'];
let hintI = q.has('nohint') ? 9 : 0; const hcv = document.createElement('canvas'); hcv.width = 1024; hcv.height = 96; const hTex = new THREE.CanvasTexture(hcv); hTex.colorSpace = THREE.SRGBColorSpace;
const hintM = new THREE.Mesh(new THREE.PlaneGeometry(.36, .36 * 96 / 1024), new THREE.MeshBasicMaterial({ map: hTex, transparent: true, depthTest: false, toneMapped: false })); hintM.renderOrder = 19; hintM.visible = false; scene.add(hintM);
function drawHint(done) { if (done !== undefined) { if (done !== hintI && !(done === 5 && hintI >= 3)) return; hintI = done === 5 ? 9 : done + 1; if (done === 4) hintI = 5; blip(880, .02); } const g = hcv.getContext('2d'); g.clearRect(0, 0, 1024, 96); const t = HINTS[hintI]; if (!t) return; g.font = '300 44px system-ui, sans-serif'; const w = g.measureText(t).width + 60; g.beginPath(); g.roundRect(512 - w / 2, 8, w, 78, 39); g.fillStyle = '#000000b8'; g.fill(); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 512, 48); hTex.needsUpdate = true; }
drawHint();

// ------------------------------------------------------------------ the others: EYEs + live hands
const peers = new Map(); let eyeNo = 0;
const eyeTex = n => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d'); g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 4; g.shadowColor = '#fff'; g.shadowBlur = 12; g.beginPath(); g.arc(128, 84, 20, 0, 7); g.stroke(); g.beginPath(); g.arc(128, 84, 7, 0, 7); g.fill(); g.font = '500 26px system-ui'; g.textAlign = 'center'; g.fillText('EYE ' + n, 128, 34); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const lineG = new THREE.BufferGeometry(); lineG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 2 * 2 * 3), 3)); const lines = new THREE.LineSegments(lineG, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .32, depthWrite: false })); lines.frustumCulled = false; lines.visible = false; root.add(lines);
function peerOf(id, k) { let p = peers.get(id); if (!p) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTex(++eyeNo), transparent: true, depthWrite: false, depthTest: false })); s.scale.set(.1, .05, 1); s.visible = false; root.add(s); p = { s, k, t: 0, h: new V3(), want: new V3(), hands: [], raw: null }; peers.set(id, p); if (panel.visible) drawPanel(); uiRoom(); } return p; }
const mk21 = () => Array.from({ length: 21 }, () => new V3());
function onX(m) {
  if (m.r) poseIn(m); if (!m.h) return; const p = peerOf(m.pid, m.k); p.t = performance.now(); p.want.fromArray(m.h); if (!p.seen) { p.seen = 1; p.h.copy(p.want); }
  const f = m.j ? new Float32Array(m.j) : null, n = f ? f.length / 63 : 0; while (p.hands.length < n) p.hands.push({ now: mk21(), to: mk21(), fresh: true }); p.hands.length = n;
  for (let a = 0; a < n; a++) { const H = p.hands[a]; for (let i = 0; i < 21; i++) { H.to[i].fromArray(f, a * 63 + i * 3); if (H.fresh) H.now[i].copy(H.to[i]); } H.fresh = false; }
}
const toL = new V3();
// SET WEBCAM: touch the lens with the right index finger and pinch, then sit back: your head 2.5 s later is what the camera looks at
function camSetStep(R, dt) {
  if (!camStep) return; if (camStep === 1) { if (!R.on) camArm = true; if (camArm && R.onDown && R.kind !== 'none') { const t = R.pts ? R.pts[8] : R.pos; camSet = [t.x, t.y, t.z, 0, 0, 0]; camStep = 2; camT = 2.5; blip(900, .08); } return; }
  camT -= dt; if (camT <= 0) { camSet[3] = head.x; camSet[4] = head.y; camSet[5] = head.z; camStep = 0; localStorage.setItem('hb:campose', JSON.stringify(camSet)); blip(1200, .1); if (panel.visible) drawPanel(); }
}
let qR = null, camLink = null; const phBase = new V3(), phR0 = new V3(), mC = new THREE.Matrix4(), UPV = new V3(0, 1, 0);
let camW = null, realH = null;
function poseIn(m) {
  const r = m.r; qR = { x: r[0], y: r[1], z: r[2], q: new THREE.Quaternion(r[3], r[4], r[5], r[6]), s: r[7] }; if (!camOn) return; const T = new V3(r[0], r[1], r[2]);
  if (m.j && m.sd) { const f = new Float32Array(m.j), H = {}, was = realH; [...m.sd].forEach((sd, a) => { const L = []; for (let i = 0; i < 21; i++) { const v = new V3(f[a * 63 + i * 3], f[a * 63 + i * 3 + 1], f[a * 63 + i * 3 + 2]).multiplyScalar(r[7]).applyQuaternion(qR.q).add(T); L.push([v.x, v.y, v.z]); } H[sd] = L; }); let still = true; if (was) for (const k in H) if (was.H[k]) { const A = H[k][9], B = was.H[k][9]; if (Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) > .03) still = false; } realH = { H, t: performance.now(), still }; }
  if (camW) { const inv = qR.q.clone().invert(); camLink = { p: new V3(...camW.p).sub(T).applyQuaternion(inv).multiplyScalar(1 / r[7]), q: inv.multiply(new THREE.Quaternion(...camW.q)) }; controls.enabled = false; }
}
async function camFinder(v, say) {
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14'; let LM; try { const V = await import(/* @vite-ignore */ MP + '/vision_bundle.mjs'), fs = await V.FilesetResolver.forVisionTasks(MP + '/wasm'); LM = await V.HandLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: new URL('./hand_landmarker.task', location.href).href, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2 }); } catch (e) { say('Hand finder failed: ' + e.message); return; }
  const IDS = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20], S = [[], []]; let lastT = 0, lastS = 0, sol = null; say('Show both hands to the webcam and move them slowly');
  const loop = () => { requestAnimationFrame(loop); const now = performance.now(), vw = v.videoWidth, vh = v.videoHeight; if (!vw || now - lastT < 90 || document.hidden) return; lastT = now; const res = LM.detectForVideo(v, now), Q = realH;
    if (Q && now - Q.t < 220 && Q.still) (res.landmarks || []).forEach((lm, k) => { const lab = res.handednesses[k][0].categoryName, side = lab === 'Left' ? 'R' : 'L', oth = side === 'L' ? 'R' : 'L', asp = vw / vh; for (const i of IDS) { const u = (lm[i].x - .5) * 2 * asp, w = (.5 - lm[i].y) * 2; if (Q.H[side]) S[0].push({ X: Q.H[side][i], u, v: w }); if (Q.H[oth]) S[1].push({ X: Q.H[oth][i], u, v: w }); } }); for (const s of S) if (s.length > 1400) s.splice(0, s.length - 1400);
    if (now - lastS > 800 && Math.max(S[0].length, S[1].length) >= 120) { lastS = now; let b = null; for (const s of S) if (s.length >= 120) { const r = solveCamera(s.filter((_, i) => i % Math.max(1, Math.floor(s.length / 260)) === 0), sol); if (r && (!b || r.rms < b.rms)) b = r; } if (b && b.rms < .07 && (!sol || b.rms < sol.rms * 1.25)) { sol = b; const c = new THREE.Quaternion(...b.q); camW = { p: b.p, q: c.toArray() }; say(''); $('camUI').hidden = true; $('top').hidden = true; } BE.cam.sol = b; } };
  loop();
}
function phoneFollow() { if (!placedPhone || !qR) return; root.position.set(phBase.x + qR.x - phR0.x, phBase.y + qR.y, phBase.z + qR.z - phR0.z); root.quaternion.copy(qR.q); root.scale.setScalar(qR.s); }
function presenceSend() {
  if (!sync || !sync.links.size) return; root.updateMatrixWorld();
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera; toL.setFromMatrixPosition(cam.matrixWorld); root.worldToLocal(toL);
  const sd = renderer.xr.isPresenting ? ['L', 'R'].filter(s => I[s].pts && I[s].kind === 'hand') : [], hs = sd.map(s => I[s].pts), j = hs.length ? new Float32Array(hs.length * 63) : null;
  hs.forEach((h, a) => h.forEach((v, i) => { D.copy(v); root.worldToLocal(D); j.set([D.x, D.y, D.z], a * 63 + i * 3); }));
  const live = renderer.xr.isPresenting && hands && !GUEST, rp = root.position, rq = root.quaternion;
  sync.sendX({ k: KIND, h: [+toL.x.toFixed(3), +toL.y.toFixed(3), +toL.z.toFixed(3)], j: j ? j.buffer : undefined, r: live ? [rp.x, rp.y, rp.z, rq.x, rq.y, rq.z, rq.w, root.scale.x] : undefined, sd: live ? sd.join('') : undefined });
}
function peersStep(dt) {
  const now = performance.now(), k = Math.min(1, dt * 16), out = [], P = lineG.attributes.position; let n = 0;
  for (const [id, p] of peers) { if (now - p.t > 4000) { root.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); peers.delete(id); uiRoom(); continue; } p.h.lerp(p.want, k); p.s.position.copy(p.h); p.s.scale.set(.1, .05, 1).multiplyScalar(1 / root.scale.x); for (const H of p.hands) { for (let i = 0; i < 21; i++) H.now[i].lerp(H.to[i], k); if (out.length < 4) out.push(H.now); } }
  theirHands.draw([]);
  for (const p of peers.values()) for (const h of out) { if (p.hands.some(H => H.now === h) || n >= 32) continue; P.setXYZ(n++, p.h.x, p.h.y, p.h.z); P.setXYZ(n++, h[9].x, h[9].y, h[9].z); }
  lineG.setDrawRange(0, n); if (n) P.needsUpdate = true;
}

// ------------------------------------------------------------------ the headset loop
const I = createInput(); BE.input = I;
const grab = { on: false, a: new V3(), b: new V3(), q: new THREE.Quaternion(), dist: 0 };
let started = false, wait = 0, tableY = null, userMoved = false, planeT = 0, phoneHit = null, placedPhone = false;
const head = new V3(), fwd = new V3(), tmp = new V3(), tmp2 = new V3();
function camPose() { const c = renderer.xr.getCamera(); head.setFromMatrixPosition(c.matrixWorld); fwd.set(0, 0, -1).transformDirection(c.matrixWorld); fwd.y = 0; if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize(); }
function place() { root.position.copy(head).addScaledVector(fwd, .44); root.position.y = tableY ?? head.y - .4; root.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0); root.scale.setScalar(1); }
let tops = [];                                              // every real horizontal surface the Quest knows (room setup)
const inPoly = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].z > z) !== (P[j].z > z) && x < (P[j].x - P[i].x) * (z - P[i].z) / (P[j].z - P[i].z) + P[i].x) c = !c; return c; };
function findTable(frame) {                                 // the clay walks to the nearest real table in front of you and stands on it
  const planes = frame.detectedPlanes; if (!planes || !planes.size) return; tops = [];
  for (const pl of planes) {
    const lab = (pl.semanticLabel || '').toLowerCase(); if (!/horiz/i.test(pl.orientation || '') || /floor|ceiling/.test(lab)) continue;
    const po = frame.getPose(pl.planeSpace, world.xrReferenceSpace); if (po) tops.push({ y: po.transform.position.y, lab, M: new THREE.Matrix4().fromArray(po.transform.matrix), P: pl.polygon });
  }
  return;                                                   // surfaces are only remembered for laying the pad down: the clay never snaps
  const want = head.clone().addScaledVector(fwd, .44); let best = null;
  for (const t of tops) {
    if (t.y < .25 || t.y > head.y - .12 || /shelf/.test(t.lab)) continue;
    const l = new V3(want.x, t.y, want.z).applyMatrix4(t.M.clone().invert()); let cx = 0, cz = 0; for (const p of t.P) { cx += p.x; cz += p.z; } cx /= t.P.length; cz /= t.P.length;
    const span = Math.hypot(l.x - cx, l.z - cz) || 1; let s = -1; for (let k = 0; k <= 20; k++) if (inPoly(t.P, l.x + (cx - l.x) * k / 20, l.z + (cz - l.z) * k / 20)) { s = k / 20; break; } if (s < 0) continue;
    if (s > 0) s = Math.min(1, s + .08 / span);             // a little in from the edge
    const w = new V3(l.x + (cx - l.x) * s, 0, l.z + (cz - l.z) * s).applyMatrix4(t.M); if (Math.hypot(w.x - head.x, w.z - head.z) > 1.15) continue;
    const score = Math.hypot(w.x - want.x, w.z - want.z) + (/table|desk/.test(t.lab) ? 0 : .35); if (!best || score < best.score) best = { score, w, y: t.y };
  }
  if (best) { tableY = best.y; root.position.set(best.w.x, best.y + .001, best.w.z); root.rotation.y = Math.atan2(head.x - best.w.x, head.z - best.w.z); renderer.shadowMap.needsUpdate = true; }
}
function land() {                                           // let go just above a real surface → it settles on it, upright (switched off: no ground snapping)
  return false;
  for (const t of tops) { if (Math.abs(root.position.y - t.y) > .09) continue; const l = root.position.clone().applyMatrix4(t.M.clone().invert()); if (inPoly(t.P, l.x, l.z)) { tableY = t.y; root.position.y = t.y + .001; levelRoot(); return true; } }
  return false;
}
function handsMenuless(side, P, blocked, dt) {
  const id = side, m = id + 'm'; tmp.copy(P.pos); root.worldToLocal(tmp); const near = clay && clay.near(tmp, S.size / root.scale.x * 1.2);
  // tool stroke
  if (P.onDown && !blocked && !strokes.has(id)) { audio(); const inv = side === 'L'; strokeBegin(id, side === 'R' && shapeNow ? 'shape' : S.tool, tmp, inv); if (carry && !carry.hand) carry.hand = P; if (side === 'R' && S.tool === 'clay') drawHint(0); if (inv) drawHint(2); }
  if (strokes.has(id)) { if (P.on) { const sp = strokeMove(id, tmp, dt); voice(sp); const st = strokes.get(id); if (st.tool === 'clay' && st.hold > 1.2) drawHint(1); if (Math.random() < .4) { col.set(HMATS[S.mat].base || S.color); spark(P.pos, side === 'L' ? col.set(0xffffff) : col, 1, .05 + sp * .12); } if (P.buzz) P.buzz(.08, 8); } else strokeEnd(id); }
  // thumb + middle: on the clay = pull
  if (P.gripDown && near) { audio(); strokeBegin(m, 'move', tmp, false); drawHint(3); }
  if (strokes.has(m)) { if (P.grip) voice(strokeMove(m, tmp, dt)); else strokeEnd(m); }
  if (P.kind !== 'hand' || !P.pts) return;
  // thumb + ring = smooth, thumb + pinky = paint
  for (const [flag, down, sid, tool] of [['ring', 'ringDown', id + 'r', 'smooth'], ['pinky', 'pinkyDown', id + 'p', 'paint']]) {
    if (flag === 'pinky' && side === 'L') continue; const tp = root.worldToLocal(P.pts[4].clone());
    if (P[down] && !blocked && clay && clay.near(tp, S.size / root.scale.x * 1.2)) { audio(); strokeBegin(sid, tool, tp, false); }
    if (strokes.has(sid)) { if (P[flag]) voice(strokeMove(sid, tp, dt)); else strokeEnd(sid); }
  }
  // the open flat hand presses the clay like a real palm
  const fid = id + 'f', flat = P.curl.every(c => c > 1.55) && !P.on && !P.grip && !P.ring && !P.pinky && !P.fist;
  const pl = root.worldToLocal(P.palm.pos.clone().lerp(P.pts[9], .5)), pr = Math.min(.05 / root.scale.x, clay.vs * 28), nl = P.up.clone().applyQuaternion(root.quaternion.clone().invert()).normalize();
  if (!strokes.has(fid) && flat && !blocked && -P.vel.dot(P.up) > .04 && clay.near(pl, pr * .6)) { audio(); strokeBegin(fid, 'press', pl, false); const st = strokes.get(fid); st.n = nl.clone(); st.pp = pl.clone(); }
  if (strokes.has(fid)) { if (flat && clay.near(pl, pr * 1.1)) { const st = strokes.get(fid); st.n.copy(nl); st.pp.copy(pl); voice(strokeMove(fid, pl, dt)); } else strokeEnd(fid); }
}
const qT = new THREE.Quaternion(), qP = new THREE.Quaternion(), mB = new THREE.Matrix4(), eX = new V3(), eY = new V3(), eZ = new V3(), upV = new V3();
function turnTo(target, pivot, dt) {                        // follows the hands' full 3D rotation, lightly filtered against tracking jitter
  qP.copy(grab.q); grab.q.slerp(target, 1 - Math.exp(-dt * 30)); qP.invert().premultiply(grab.q);
  root.position.sub(pivot).applyQuaternion(qP).add(pivot); root.quaternion.premultiply(qP); userMoved = true;
}
function twoHandFrame(L, R) {
  eX.subVectors(R.pos, L.pos).normalize(); eY.addVectors(L.dir, R.dir); eY.addScaledVector(eX, -eY.dot(eX));
  if (eY.lengthSq() < .05) { eY.set(0, 1, 0).addScaledVector(eX, -eX.y); if (eY.lengthSq() < .05) eY.set(0, 0, 1).addScaledVector(eX, -eX.z); }
  eY.normalize(); eZ.crossVectors(eX, eY); return qT.setFromRotationMatrix(mB.makeBasis(eX, eY, eZ));
}
const tilt = () => upV.set(0, 1, 0).applyQuaternion(root.quaternion).y;
function levelRoot() { eZ.set(0, 0, 1).applyQuaternion(root.quaternion); root.rotation.set(0, Math.abs(eZ.y) > .98 ? root.rotation.y : Math.atan2(eZ.x, eZ.z), 0); catcher.visible = true; renderer.shadowMap.needsUpdate = true; }
function worldGrab(L, R, dt, blocked) {
  // right fist = only what is at the hand: the nearest stroke or lump rides on it. Left pinch meanwhile leaves copies. Left fist = the whole piece
  if (R.kind === 'hand') { const lp = root.worldToLocal(R.palm.pos.clone()); if (R.fist && !grab.rf && !L.fist && !blocked && !strokes.has('Rg')) { grabR = Math.min(.045 / root.scale.x, clay.vs * 40); audio(); strokeBegin('Rg', 'select', lp, false); grabR = 0; if (carry && !carry.hand) carry.hand = R; } if (strokes.has('Rg')) { if (R.fist) strokeMove('Rg', lp, dt); else strokeEnd('Rg'); } grab.rf = R.fist; } else { if (strokes.has('Rg')) strokeEnd('Rg'); grab.rf = false; }
  if (carry && carry.hand && carry.hand !== L && L.kind !== 'none' && L.onDown) { carry.g.group.updateMatrix(); clay.stamp(carry.g, carry.g.group.matrix); blip(880, .04); }
  const hold = P => P.kind === 'hand' ? P.fist : P.kind !== 'none' && P.grip, G = P => P.kind === 'hand' ? P.palm : P, riding = carry && carry.hand === R, a = hold(L) && !strokes.has('Lm'), b0 = hold(R) && !strokes.has('Rm') && !riding, b = R.kind === 'hand' ? b0 && a : b0, GL = G(L), GR = G(R); const was = grab.n || 0, n = (a ? 1 : 0) + (b ? 1 : 0);
  if (n === 2) {
    const mid = tmp.addVectors(GL.pos, GR.pos).multiplyScalar(.5), dist = GL.pos.distanceTo(GR.pos), target = twoHandFrame(GL, GR);
    if (was === 2) { const ds = THREE.MathUtils.clamp(dist / Math.max(.02, grab.dist), .75, 1.33), s = THREE.MathUtils.clamp(root.scale.x * ds, .02, 80), k = s / root.scale.x; root.position.sub(grab.a).multiplyScalar(k).add(mid); root.scale.setScalar(s); turnTo(target, mid, dt); } else grab.q.copy(target);
    grab.a.copy(mid); grab.dist = dist;
  } else if (n === 1) {
    const H = a ? L : R, P = G(H);
    if (was === 1 && grab.side === H.side) { root.position.add(tmp2.subVectors(P.pos, grab.a)); turnTo(P.quat, P.pos, dt); drawHint(4); } else grab.q.copy(P.quat);
    grab.a.copy(P.pos); grab.side = H.side;
  }
  if (n) catcher.visible = tilt() > .985;
  if (!n && was) { land(); if (clay) clay.relod(); }
  grab.n = n;
}
let hitSrc = null;
function phoneAR(frame) {
  if (!hitSrc) return; const r = frame.getHitTestResults(hitSrc)[0]; if (!r) return; const p = r.getPose(world.xrReferenceSpace); if (!p) return; const t = p.transform.position; phoneHit = phoneHit || new V3(); phoneHit.set(t.x, t.y, t.z);
  if (!placedPhone) { root.visible = true; root.position.copy(phoneHit); if (qR) { root.position.y += qR.y; root.quaternion.copy(qR.q); root.scale.setScalar(qR.s); } }
}
function xrStep(frame, dt) {
  camPose();
  if (!started && (head.y > .25 || ++wait > 45)) { started = true; wait = 0; if (hands) { place(); const s = renderer.xr.getSession(); if (s && s.updateTargetFrameRate) s.updateTargetFrameRate(+q.get('hz') || 72).catch(() => {}); } root.visible = true; }   // steady 72 beats a stuttering 90 (measured on Quest 3: 62 fps at 90 Hz, 71 at 72)
  if (!started) return;
  I.read(frame, world.xrReferenceSpace, dt); BE.hands = ['L', 'R'].filter(s => I[s].pts).map(s => ({ key: s === 'L' ? 'left' : 'right', P: I[s].pts }));
  if (!hands) { phoneAR(frame); phoneFollow(); return; }
  if ((planeT -= dt) <= 0) { planeT = .7; findTable(frame); }
  const { L, R } = I, onMenu = menuStep(L, R, head, dt); shapeStep(L, R); camSetStep(R, dt);
  if (R.aDown && R.kind === 'ctrl') undo(); if (R.bDown && R.kind === 'ctrl') redo();
  root.updateMatrixWorld();
  handsMenuless('R', R, onMenu || camStep > 0, dt); handsMenuless('L', L, (menuOpen && !panelLaid) || !!(carry && carry.hand && carry.hand !== L), dt); worldGrab(L, R, dt, onMenu);
  myHands.draw(['L', 'R'].filter(s => I[s].pts && I[s].kind === 'hand' && !q.has('nohands')).map(s => I[s].pts));
  for (const s of ['L', 'R']) { const P = I[s], C = CUR[s], show = P.kind !== 'none' && !P.fist && !(menuOpen && !panelLaid && s === 'L') && !onMenu; C.visible = show; if (show) { C.position.copy(P.pos); const inv = s === 'L'; C.scale.setScalar(S.size * Math.min(1, root.scale.x / BRUSH_MIN) * (P.on ? .9 : 1)); C.material.uniforms.c.value.set(inv ? 0xff9a7a : (HMATS[S.mat].base || S.color)); } }
  const showH = false; hintM.visible = showH; if (showH) { tmp.copy(head).addScaledVector(fwd, .5); tmp.y = head.y - .2; hintM.position.lerp(tmp, Math.min(1, dt * 3)); if (hintM.position.lengthSq() < .01) hintM.position.copy(tmp); hintM.lookAt(head); }
}

// ------------------------------------------------------------------ on a screen: orbit + mouse / touch sculpting
const controls = new OrbitControls(camera, renderer.domElement); controls.enabled = false; controls.enableDamping = true; controls.target.set(0, .11, 0); controls.minDistance = .12; controls.maxDistance = 3;
let flatOn = false; const ray = new THREE.Raycaster(), nd = new THREE.Vector2(), rO = new V3(), rD = new V3(), rA = new V3();
function flatHit(e) { nd.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(nd, camera); root.updateMatrixWorld(); rO.copy(ray.ray.origin); root.worldToLocal(rO); rA.copy(ray.ray.origin).add(ray.ray.direction); root.worldToLocal(rA); rD.subVectors(rA, rO).normalize(); return clay ? clay.rayHit(rO, rD) : null; }
const dom = renderer.domElement;
dom.addEventListener('pointerdown', e => { if (!flatOn || e.button > 0) return; const h = flatHit(e); audio(); if (h) { controls.enabled = false; dom.setPointerCapture(e.pointerId); strokeBegin('p', S.tool, h, e.shiftKey || e.ctrlKey); } }, true);
dom.addEventListener('pointermove', e => { if (flatOn && strokes.has('p')) { const h = flatHit(e); if (h) voice(strokeMove('p', h, .016)); } }, true);
const pUp = () => { if (strokes.has('p')) { strokeEnd('p'); controls.enabled = true; } }; dom.addEventListener('pointerup', pUp, true); dom.addEventListener('pointercancel', pUp, true);
addEventListener('keydown', e => { if (!flatOn) return; if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); } if (e.key === '[') { S.size = Math.max(.005, S.size * .85); buildBar(); } if (e.key === ']') { S.size = Math.min(.045, S.size * 1.18); buildBar(); } });
function buildBar() {
  const b = $('bar'); b.innerHTML = ''; const btn = (l, on, f) => { const x = document.createElement('button'); x.textContent = l; if (on) x.className = 'on'; x.onclick = () => { f(); buildBar(); }; b.append(x); };
  TOOLS.forEach(([k, l]) => btn(l[0] + l.slice(1).toLowerCase(), S.tool === k, () => act.tool(k)));
  COLORS.forEach(c => { const i = document.createElement('i'); i.style.background = c; if (S.color === c) i.className = 'on'; i.onclick = () => { S.color = c; buildBar(); }; b.append(i); });
  MKEYS.forEach(k => btn(HMATS[k].label, S.mat === k, () => act.mat(k)));
  const r = document.createElement('input'); r.type = 'range'; r.min = .005; r.max = .045; r.step = .001; r.value = S.size; r.oninput = () => { S.size = +r.value; }; b.append(r);
  btn('Mirror', S.mirror, act.mirror); btn(S.radial ? 'Radial ' + S.radial : 'Radial', !!S.radial, act.radial); btn('Undo', false, undo); btn('Redo', false, redo); btn('New', false, wipe);
}
function uiRoom() { const n = peers.size, el = $('room'); if (!el) return; const lnk = sync && sync.role === 'client' ? 'live' : sync && sync.role === 'hub' ? 'room open' : 'waiting for the sculptor…'; el.innerHTML = `<div>code <b>${ROOM}</b> · ${lnk}${n ? ' · ' + n + ' EYE' + (n > 1 ? 's' : '') : ''}</div>`; const q2 = document.createElement('div'); q2.id = 'qrb'; q2.appendChild(QR.canvas(LINK, 3)); el.appendChild(q2); if (panel.visible) drawPanel(); }
function startFlat() {
  flatOn = true; $('start').hidden = true; $('ui').hidden = false; scene.background = new THREE.Color(0x030304); root.visible = true; root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.setScalar(1);
  camera.position.set(.34, .3, .62); controls.enabled = true; controls.update(); buildBar(); uiRoom(); if (GUEST) $('bar').hidden = true; if (q.has('clean')) $('bar').hidden = $('room').hidden = true; if (q.has('cam')) startCam();
}
// webcam view: the live sculpt over the real camera picture. The picture is shown untouched: no exposure, gain or colour changes
let camOn = false, fitT = 0, fitR = .15; const fitC = new V3(0, .1, 0), fitQ = new THREE.Quaternion();
async function startCam() {
  if (camOn) return; camOn = true; scene.background = null; renderer.setClearColor(0, 0); stage.userData.floor.visible = false; $('bar').hidden = true; document.documentElement.style.background = document.body.style.background = 'transparent';
  const K = 'hb:cam', st = Object.assign({ mirror: true, zoom: 1, dev: '', p: null, t: null, fov: 42, ox: 0, oy: 0 }, JSON.parse(localStorage.getItem(K) || '{}')), save = () => { st.p = camera.position.toArray(); st.t = controls.target.toArray(); localStorage.setItem(K, JSON.stringify(st)); };
  const v = document.createElement('video'); v.id = 'cam'; v.autoplay = v.playsInline = v.muted = true; v.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;background:#000'; document.body.prepend(v);
  const box = document.createElement('div'); box.id = 'camUI'; box.style.cssText = 'position:fixed;left:16px;top:52px;z-index:4;display:flex;gap:6px;flex-wrap:wrap;align-items:center;max-width:70vw;font-size:13px'; box.innerHTML = '<select id="camSel" style="font:13px system-ui;color:#fff;background:#0c0c0fd9;border:1px solid #ffffff42;border-radius:16px;padding:7px 10px;max-width:260px"></select><button id="camFlip">Mirror</button><button id="camOut">−</button><button id="camIn">+</button><button id="camFovA">Wider</button><button id="camFovB">Narrower</button><button id="camHome">Reset view</button><button id="camStop">Camera off</button><span id="camMsg" style="flex-basis:100%;text-shadow:0 1px 3px #000">Starting hand finder</span>'; document.body.append(box); box.querySelectorAll('button').forEach(b => { b.style.cssText = 'font-size:13px;padding:7px 13px;background:#0c0c0fd9'; });
  const look = () => { const t = 'scaleX(' + (st.mirror ? -1 : 1) + ') scale(' + st.zoom + ')'; v.style.transform = t; renderer.domElement.style.transform = 'translate(' + st.ox + 'px,' + st.oy + 'px) ' + t; $('camFlip').textContent = st.mirror ? 'Mirror: on' : 'Mirror: off'; }; look();
  fitQ.copy(camera.quaternion); controls.enabled = false; camera.fov = st.fov = 42; camera.updateProjectionMatrix(); if (st.p) { camera.position.fromArray(st.p); controls.target.fromArray(st.t); controls.update(); } controls.addEventListener('end', save);
  let stream = null; const stop = () => { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; };
  const open = async id => { stop(); try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(id ? { deviceId: { exact: id } } : {}), width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } }); v.srcObject = stream; await v.play().catch(() => {}); const sel = $('camSel'), L = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'), cur = stream.getVideoTracks()[0].getSettings().deviceId; sel.innerHTML = ''; for (const d of L) { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || 'Camera'; o.selected = d.deviceId === cur; sel.append(o); } } catch (e) { $('camMsg').textContent = 'Camera not available: ' + e.name; if (id) { st.dev = ''; save(); } } };
  { const el = renderer.domElement; let d = null; el.addEventListener('pointerdown', e => { if (camLink) d = [e.clientX - st.ox, e.clientY - st.oy]; }); addEventListener('pointermove', e => { if (d) { st.ox = e.clientX - d[0]; st.oy = e.clientY - d[1]; look(); } }); addEventListener('pointerup', () => { if (d) { d = null; save(); } }); }
  const fov = k => { st.fov = THREE.MathUtils.clamp(st.fov * k, 15, 110); camera.fov = st.fov; camera.updateProjectionMatrix(); save(); }; $('camFovA').onclick = () => fov(1.05); $('camFovB').onclick = () => fov(1 / 1.05);
  ['camFlip', 'camOut', 'camIn', 'camFovA', 'camFovB', 'camHome', 'camStop'].forEach(id => { $(id).hidden = true; });
  $('camSel').onchange = e => { st.dev = e.target.value; save(); open(st.dev); }; $('camFlip').onclick = () => { st.mirror = !st.mirror; look(); save(); }; $('camIn').onclick = () => { st.zoom = Math.min(4, st.zoom * 1.1); look(); save(); }; $('camOut').onclick = () => { st.zoom = Math.max(1, st.zoom / 1.1); look(); save(); };
  $('camHome').onclick = () => { st.ox = st.oy = 0; look(); camera.position.set(.34, .3, .62); controls.target.set(0, .11, 0); controls.update(); save(); }; $('camStop').onclick = () => { stop(); const u = new URL(location.href); u.searchParams.delete('cam'); location.href = u; }; addEventListener('pagehide', stop);
  BE.cam = { v, st }; await open(st.dev); camFinder(v, t => { $('camMsg').textContent = t; });
}

// ------------------------------------------------------------------ every frame
let hands = true, tMs = 4, lastMV = -1, shadowT = 0, last = performance.now();
function tick(frame, dt) {
  if (camOn && clay) {                                       // the sculpt always fills the picture, seen from the webcam's direction
    if ((fitT -= dt) <= 0) { fitT = .4; const S = clay.vs * 24; let n = 0; const A = [1e9, 1e9, 1e9], B = [-1e9, -1e9, -1e9]; for (const h of clay.chunks.values()) if (h.mesh) { n++; [h.cx, h.cy, h.cz].forEach((c, i) => { A[i] = Math.min(A[i], c * S); B[i] = Math.max(B[i], (c + 1) * S); }); } if (n) { fitC.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2); fitR = Math.max(.05, Math.max(B[0] - A[0], B[1] - A[1], B[2] - A[2]) * .55); } }
    const k = Math.min(1, dt * 6); fitQ.slerp(camLink ? camLink.q : fitQ, k); const d = fitR / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / .8; camera.quaternion.copy(fitQ); camera.position.lerp(tmp.set(0, 0, d).applyQuaternion(fitQ).add(fitC), k); camera.updateMatrixWorld();
  }
  dt = Math.min(.05, dt || .016); const t0 = performance.now(); if (BE.xrFrame) BE.xrFrame();
  pM.uniforms.T.value += dt; if (pDirty) { pDirty = false; for (const a of ['a', 'b', 'c']) pG.attributes[a].needsUpdate = true; }
  if (renderer.xr.isPresenting && frame) xrStep(frame, dt); else if (flatOn && !camOn) controls.update();
  if (carry) carry.g.update(3); if (sel) sel.g.update(3); if (clay) { clay.busy = active > 0; clay.viewScale = renderer.xr.isPresenting ? root.scale.x : 1; runSym(renderer.xr.isPresenting ? 3 : 6); clay.update(renderer.xr.isPresenting ? (active ? 2.5 : 4.5) : 6); if (clay.meshVer !== lastMV && !active && !clay.dirty.size && (shadowT -= dt) <= 0) { lastMV = clay.meshVer; shadowT = .12; renderer.shadowMap.needsUpdate = true; } }
  const c = root.getWorldPosition(tmp); sun.position.copy(c).add(tmp2.set(-.7, 1.5, .8)); sun.target.position.copy(c); rimL.position.copy(c).add(tmp2.set(.9, .5, -1.1)); rimL.target.position.copy(c);
  peersStep(dt); if (sync) sync.step(dt);
  if (!GUEST && saveAt && performance.now() > saveAt && !active) { for (const k of clay ? clay.unsavedTake() : []) saving.add(k); flushSave(); if (!saving.size) saveAt = 0; }
  tMs += (performance.now() - t0 - tMs) * .05;
}
world.onXRFrame(tick);
(function loop() { requestAnimationFrame(loop); const n = performance.now(), dt = (n - last) / 1000; last = n; if (!renderer.xr.isPresenting) tick(null, dt); })();

// ------------------------------------------------------------------ boot: saved piece (or a first ball of clay), the room, the ways in
if (!GUEST) { db = await openDB(); newClay(); clay.lod = 4; const n = await loadSaved().catch(() => 0); if (n < 40) clay.lod = 1; if (!n && !q.has('empty')) starter(); saveAt = performance.now() + 2000; } else { newClay(); clay.lod = 4; }
drawSym(); drawPanel();
sync = BE.sync = createSync({ room: ROOM, root, objs, S, buildObject, addObj, removeObj, clearUndo: () => { undoS.length = redoS.length = 0; }, say: t => console.log('[room]', t), kind: KIND, guest: GUEST, busy: () => active > 0, headMatrix: () => null, pointers: () => [] });
sync.onX = onX; sync.onStatus = () => { uiRoom(); }; setInterval(presenceSend, 66);
BE.api = { S, act, undo, redo, strokeBegin, strokeMove, strokeEnd, tick, peers, ROOM, LINK, GUEST, startFlat, findTable, land, head, fwd, panel, padLaid: () => panelLaid, onX, camPose: () => camSet, setShape: k => { shapeNow = k; }, hasSel: () => !!sel, hotZones: () => hot, PW, PH };
BE.devState = () => ({ fist: [I.L.fist, I.R.fist], curlR: I.R.curl.map(v => +v.toFixed(2)), room: ROOM, role: sync.role, tris: clay ? clay.tris() : 0, chunks: clay ? clay.chunks.size : 0, dirty: clay ? clay.dirty.size : 0, fly: clay ? clay.flying : 0, tickMs: +tMs.toFixed(2), table: tableY, scale: root.scale.x, menu: menuOpen, tool: S.tool });

const xrOK = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
renderer.xr.addEventListener('sessionstart', async () => {
  audio(); $('start').hidden = true; $('ui').hidden = true; flatOn = false; controls.enabled = false; scene.background = null; stage.userData.floor.visible = false; started = false; userMoved = false; tableY = null; tops = []; menuOpen = false; hands = isQuest || !!window.IWER_DEVICE || q.has('hands');
  root.visible = hands; catcher.visible = true;
  if (!hands) { const s = renderer.xr.getSession(), v = await s.requestReferenceSpace('viewer'); hitSrc = await s.requestHitTestSource({ space: v }).catch(() => null); placedPhone = false; s.addEventListener('select', () => { if (phoneHit) { phBase.copy(phoneHit); if (qR) phR0.set(qR.x, 0, qR.z); placedPhone = true; } }); }
});
renderer.xr.addEventListener('sessionend', () => { hitSrc = null; hintM.visible = panel.visible = CUR.L.visible = CUR.R.visible = false; myHands.draw([]); stage.userData.floor.visible = true; if (GUEST || flatWas) startFlat(); else $('start').hidden = false; });
let flatWas = false;
const launch = () => { audio(); flatWas = flatOn; world.launchXR({ sessionMode: SessionMode.ImmersiveAR }); };
$('goXR').hidden = !(xrOK && (isQuest || !GUEST)); $('goXR').onclick = launch;
$('arBtn').hidden = !(xrOK && KIND === 'phone'); $('arBtn').onclick = launch;
$('goHere').onclick = () => { audio(); startFlat(); }; $('goHere').hidden = !q.has('flat');
const join = () => { const c = clean($('code').value); if (c) location.href = location.pathname + '?room=' + c; };
$('goJoin').onclick = join; $('code').onkeydown = e => { if (e.key === 'Enter') join(); };
if (GUEST && !(isQuest && xrOK)) startFlat(); else if (q.has('flat')) startFlat();
$('info').textContent = xrOK ? `Code for phones and PCs: ${ROOM}` : `Headset: open this page in the Quest browser. Your code: ${ROOM}`;
console.log('[hand] ready', ROOM, GUEST ? 'guest' : 'host');
