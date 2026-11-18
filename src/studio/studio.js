// bUild sTudio — draw, sculpt, shape and paint in your real room (Quest 3 passthrough), controllers OR bare hands.
//  everything lives under ONE root group (grab the air = move it, both grips = scale it) · saves to the PC · live GLB → Blender + phones.
import * as THREE from 'three';
import { World, SessionMode } from '@iwsdk/core';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import '../qr.js';
import { createInput } from './input.js';
import { createMenu, TOOLS, PRIMS } from './menu.js';
import { COLORS, MATS, MAT_KEYS, makeMaterial, dab, ensurePaint, paintSnapshot, paintRestore, paintStamp } from './materials.js';
import { buildObject, strokeGeometry, newId, mirrorMatrix, mirrorQuat } from './objects.js';
import { ensureEnv } from '../mechs.js';
import { createEnv, createFlat } from './flat.js';
import { createSync, newRoom } from './sync.js';
import { initPainter } from './paintable.js';
import { createPaintFlow } from './paintflow.js';
import { createBlenderLink } from './blender.js';
import { createBrushPanel } from './brushpanel.js';
import { createZFlow } from './zflow.js';
import { addCustomAlpha } from './zsculpt.js';
import { alphaData, alphaAt } from './alphas.js';
import { chaosStroke, evaluator, sprout, RECIPE_KEYS, recipeOf, skinFor } from './chaos.js';
import { vnoise as vnoise3, fbm as fbm3 } from './sculpt.js';
const vnoise = vnoise3, fbm = fbm3;
const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4;
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const UA = window.__UA || navigator.userAgent, isQuest = /OculusBrowser|Quest/i.test(UA);   // (the WebXR emulator fakes a Quest UA on desktop)
window.BE = { q, isQuest, version: __VERSION__ };
const DEV = import.meta.env.DEV;
if (DEV) import('../devlink.js');
$('ver').textContent = 'v' + __VERSION__;
const BASE = (/^(localhost|127.)/.test(location.hostname) && __LAN__ ? __LAN__ : location.origin) + location.pathname.replace(/[^/]*$/, '');
// ONE room per link: every device that opens studio.html?room=CODE edits the same scene, live
const ROOM = (q.get('room') || localStorage.getItem('bs:room') || newRoom()).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || newRoom();
localStorage.setItem('bs:room', ROOM);
if (q.get('room') !== ROOM) { q.set('room', ROOM); history.replaceState(null, '', location.pathname + '?' + q.toString()); }
const ROOM_LINK = BASE + 'studio.html?room=' + ROOM;
$('qr').appendChild(QR.canvas(ROOM_LINK, 3)); $('roomLink').textContent = ROOM_LINK.replace(/^https?:\/\//, '');

// ------------------------------------------------------------------ state
const S = window.BE.S = { tool: 'clay', prim: 'box', size: .008, detail: 3, pattern: 'rock', mask: 'all', color: COLORS[4], mat: 'clay', mirror: false, stamp: null, hint: '', status: '' };
const SAVED = JSON.parse(localStorage.getItem('bs:prefs') || 'null'); if (SAVED) Object.assign(S, SAVED, { stamp: null, hint: '', status: '' });
const savePrefs = () => localStorage.setItem('bs:prefs', JSON.stringify({ zb: S.zb, zStroke: S.zStroke, zAlpha: S.zAlpha, zInt: S.zInt, zFoc: S.zFoc, zLazy: S.zLazy, zTile: S.zTile, zSub: S.zSub, zLook: S.zLook, zSmA: S.zSmA, zSmB: S.zSmB, zDirt: S.zDirt, zWear: S.zWear, alpha: S.alpha, aStr: S.aStr, aScale: S.aScale, aCol: S.aCol, aDig: S.aDig, palpha: S.palpha, tone: S.tone, brushOpen: S.brushOpen, recipe: S.recipe, wild: S.wild, hard: S.hard, flow: S.flow, pmode: S.pmode, bh: S.bh, pemit: S.pemit, pres: S.pres, layersOpen: S.layersOpen, pattern: S.pattern, tool: S.tool, prim: S.prim, size: S.size, detail: S.detail, color: S.color, mat: S.mat, mirror: S.mirror }));

const world = await World.create($('app'), {
  xr: { sessionMode: SessionMode.ImmersiveAR, offer: 'none', referenceSpace: { type: 'local-floor', fallbackOrder: ['local'] }, features: { handTracking: { required: false } } },
  features: { grabbing: false, locomotion: false, spatialUI: false, physics: false },
  render: { near: .01, far: 60 },
});
window.BE.world = world;
const renderer = world.renderer, scene = world.scene;
ensureEnv(renderer, scene);
initPainter(renderer);
// studio lighting: soft fill + a warm key with soft shadows + a cool rim (follows your work)
scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x6a5a48, .55)); scene.environmentIntensity = .75;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const sun = new THREE.DirectionalLight(0xfff1de, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -.0005; sun.shadow.normalBias = .01;
Object.assign(sun.shadow.camera, { left: -.6, right: .6, top: .6, bottom: -.6, near: .1, far: 6 }); scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1); scene.add(rim, rim.target);
function lightsFollow() { const c = root.getWorldPosition(new V3()); sun.position.copy(c).add(new V3(-1.1, 2.2, 1.4)); sun.target.position.copy(c); rim.position.copy(c).add(new V3(1.2, .8, -1.6)); rim.target.position.copy(c); }
const root = new THREE.Group(); root.name = 'studio'; scene.add(root);
const env = createEnv(scene); env.visible = false;    // the VR / flat world (hidden in mixed reality = your real room)
const I = createInput(); BE.input = I;
const menu = createMenu(S); scene.add(menu.panel); BE.menu = menu;
const objs = []; BE.objs = objs;
const ui = new THREE.Group(); scene.add(ui);                 // cursors, lasers, mirror plane (never exported)

// ------------------------------------------------------------------ toast
const card = (() => {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 128; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(.42, .0525), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  m.renderOrder = 40; m.visible = false; scene.add(m);
  let until = 0;
  return { m, say(t, sec = 2.5) { g.clearRect(0, 0, 1024, 128); g.fillStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.roundRect(6, 14, 1012, 100, 50); g.fill(); g.fillStyle = '#fff'; g.font = '600 44px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 512, 66); tex.needsUpdate = true; m.visible = true; until = performance.now() + sec * 1000; console.log('[studio]', t); },
    step(head, fwd, dt) { if (!m.visible) return; if (performance.now() > until) { m.visible = false; return; } const want = head.clone().addScaledVector(fwd, .55); want.y -= .2; m.position.lerp(want, Math.min(1, dt * 5)); m.lookAt(head); } };
})();
const say = (t, s) => { if (BE.flat && BE.flat.on) BE.flat.toast(t, s); else card.say(t, s); };

// ------------------------------------------------------------------ cursors + mirror plane
function cursor() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .28, depthWrite: false }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .06, 6, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new V3(), new V3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffc23a }));
  laser.visible = false; g.add(ball, ring); ui.add(g, laser); return { g, ball, ring, laser };
}
const CUR = { L: cursor(), R: cursor() };
const mirrorPlane = new THREE.Mesh(new THREE.PlaneGeometry(.7, .7), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: .07, side: THREE.DoubleSide, depthWrite: false }));
mirrorPlane.rotation.y = Math.PI / 2; mirrorPlane.position.y = .1; root.add(mirrorPlane); mirrorPlane.userData.ui = true;
const mirrorEdge = new THREE.LineSegments(new THREE.EdgesGeometry(mirrorPlane.geometry), new THREE.LineBasicMaterial({ color: 0x66ccff, transparent: true, opacity: .5 })); mirrorPlane.add(mirrorEdge);

// ------------------------------------------------------------------ objects + undo
let dirty = false, dirtyT = 0;
const touch = () => { dirty = true; dirtyT = 0; };
function addObj(o) { if (!objs.includes(o)) { root.add(o); objs.push(o); } touch(); }
function removeObj(o) { root.remove(o); const i = objs.indexOf(o); if (i >= 0) objs.splice(i, 1); touch(); }
const U = [], RD = []; let frameNo = 0, lastPushFrame = -9;
function pushUndo(e) {
  if (lastPushFrame >= frameNo - 1 && U.length) { const prev = U[U.length - 1]; U[U.length - 1] = { undo() { e.undo(); prev.undo(); }, redo() { prev.redo(); e.redo(); }, dispose() { e.dispose && e.dispose(); prev.dispose && prev.dispose(); } }; }
  else U.push(e);
  lastPushFrame = frameNo; for (const r of RD) r.dispose && r.dispose(); RD.length = 0; if (U.length > 30) { const old = U.shift(); old.dispose && old.dispose(); }   /* sculpt undo keeps chunk copies: cap the memory on the headset */ touch();
}
function undo() { const e = U.pop(); if (!e) return say('nothing to undo', 1.2); e.undo(); RD.push(e); touch(); say('undo', .8); }
function clearUndo() { for (const e of [...U, ...RD]) e.dispose && e.dispose(); U.length = 0; RD.length = 0; }
function redo() { const e = RD.pop(); if (!e) return say('nothing to redo', 1.2); e.redo(); U.push(e); touch(); say('redo', .8); }
const recM = o => { o.updateMatrix(); o.userData.rec.m = o.matrix.toArray(); };

// ------------------------------------------------------------------ helpers: pointer in root space, picking
const rootScale = () => root.scale.x;
function local(P, mirror) {
  const p = root.worldToLocal(P.pos.clone());
  const rq = root.getWorldQuaternion(new Q()).invert().multiply(P.quat);
  if (mirror) { p.x = -p.x; const a = mirrorQuat(rq.toArray()); rq.fromArray(a); }
  return { p, q: rq };
}
function topOf(o) { while (o && o.parent !== root) o = o.parent; return o; }
function pickAt(worldPos, pad = .015) {
  let best = null, bv = Infinity; const b = new THREE.Box3();
  for (const o of objs) {
    if (o.userData.sculpt) {           // sculpts: only where there IS material
      const sc = o.userData.sculpt, l = o.worldToLocal(worldPos.clone()), pd = pad / o.getWorldScale(new V3()).x;
      if ([[0, 0, 0], [pd, 0, 0], [-pd, 0, 0], [0, pd, 0], [0, -pd, 0], [0, 0, pd], [0, 0, -pd]].some(d => sc.solidAt(l.clone().add(new V3(...d))))) { const v = 1e-6; if (v < bv) { bv = v; best = o; } }
      continue;
    }
    if (o.userData.clay) {             // clay: only where there IS clay (a fat 50 cm box would steal every grab)
      const c = o.userData.clay, l = o.worldToLocal(worldPos.clone()).multiplyScalar(c.L / 2), ws = o.getWorldScale(new V3()).x / (c.L / 2), pd = pad / ws;
      if ([[0, 0, 0], [pd, 0, 0], [-pd, 0, 0], [0, pd, 0], [0, -pd, 0], [0, 0, pd], [0, 0, -pd]].some(d => c.solidAt(l.clone().add(new V3(...d))))) { const v = 1e-6; if (v < bv) { bv = v; best = o; } }
      continue;
    }
    b.setFromObject(o).expandByScalar(pad); if (b.isEmpty() || !b.containsPoint(worldPos)) continue;
    const s = b.getSize(new V3()), v = s.x * s.y * s.z; if (v < bv) { bv = v; best = o; }
  }
  return best;
}
const ray = new THREE.Raycaster();
function rayHit(origin, dir, far) {
  ray.set(origin, dir); ray.far = far; ray.near = 0;
  const hits = ray.intersectObjects(objs, true).filter(h => h.object.visible && !(h.object.userData.rec && h.object.userData.rec.type === 'photo'));
  return hits[0] || null;
}

// ------------------------------------------------------------------ tools (key = 'R', 'L', or 'R~' / 'L~' = the mirror twin)
const act = new Map();
const brushR = P => S.size * (P.kind === 'ctrl' ? .25 + .75 * P.trig : .75) / rootScale();
function toolDown(key, P, tool, mirror) {
  if (tool === 'z') { if (mirror) return; const st = zf.down(P, !!(BE.flat && BE.flat.on)); if (st) act.set(key, st); return; }   // Z SCULPT: symmetry lives inside the stroke
  const { p, q } = local(P, mirror), r = brushR(P);
  if (tool === 'tube' || tool === 'ribbon') {
    const rec = { id: newId(), type: 'stroke', shape: tool, s: [], color: S.color, mat: S.mat };
    const o = buildObject(rec); addObj(o); act.set(key, { tool, o, rec, last: null });
    addSample(act.get(key), p, q, tool === 'ribbon' ? r * 2.5 : r);
  } else if (tool === 'shape') {
    const rec = { id: newId(), type: 'shape', prim: S.prim, color: S.color, mat: S.mat };
    const o = buildObject(rec); addObj(o); o.position.copy(p); o.scale.setScalar(.001); act.set(key, { tool, o, rec, a: p.clone() });
  } else if (tool === 'alpha' && !sculptNear(worldOf(P, mirror), .03)) {   // texture-sculpt on a painted mesh / anything else = the Painter brush with the alpha
    act.set(key, { tool: 'paint', snaps: new Map(), clayStart: new Map(), last: null, stamp: null, alpha: true });
  } else if (SCULPT[tool]) {
    const w = worldOf(P, mirror);
    const twin = mirror && act.get(key.slice(0, -1));                 // the mirror twin works on the SAME sculpt
    let o = twin && twin.o ? twin.o : sculptNear(w, tool === 'clay' || tool === 'chaos' ? .06 : .02);
    let created = false;
    if (!o) {
      if (tool !== 'clay' && tool !== 'inflate' && tool !== 'chaos') return;
      const vsAuto = tool === 'chaos' ? Math.min(S.detail / 1000, Math.max(.0011, S.size * 2.2 / 9)) : S.detail / 1000;
      const rec = { id: newId(), type: 'sculpt', tone: S.tone || 'reptile', vs: vsAuto / rootScale(), mat: S.mat, m: new M4().makeTranslation(p.x, p.y, p.z).toArray() };
      o = buildObject(rec); addObj(o); created = true; o.updateMatrixWorld(true);
    }
    const sc = o.userData.sculpt; if (!sc.users) sc.begin(); sc.users = (sc.users || 0) + 1; pf.setActive(o);
    const l = o.worldToLocal(w.clone()), st = { tool, o, sc, created, last: null, p0: l.clone() };
    if (tool === 'flatten') { const n = sculptNormal(sc, l); st.n = n; }
    if (tool === 'chisel') st.n = P.kind === 'ctrl' ? (() => { const d = P.dir.clone().transformDirection(new M4().copy(o.matrixWorld).invert()).negate(); if (mirror) d.x = -d.x; return d.normalize(); })() : sculptNormal(sc, l);
    if (tool === 'chaos') {   // one stroke = one living material (the mirror twin shares its dice → symmetric creatures)
      const ws = o.getWorldScale(new V3()).x, R0 = S.size * 2.2 / ws, key = S.wild ? RECIPE_KEYS[Math.random() * RECIPE_KEYS.length | 0] : (S.recipe || 'python');
      st.X = twin && twin.X ? chaosStroke(twin.X.key, R0, { seed: twin.X.seed, hue: twin.X.hue, wild: twin.X.wild, top: twin.X.top, chaos: twin.X.chaos, vs: sc.vs }) : chaosStroke(key, R0, { wild: S.wild, chaos: S.chaos ?? .6, top: l.y / R0 + 1.2, vs: sc.vs });
      if (S.liveSkin !== false && !o.userData.rec.skin) { const sk = skinFor(st.X.key, R0); if (sk) sc.setSkin(sk); }
      if (o.userData.rec.skin) st.X.skin = true;   // the shader draws the scales → the voxels keep the big forms + colour zones
      st.E = evaluator(st.X); st.s = 0; o.userData.rec.recipe = st.X.key; if (!mirror) say('🌀 ' + st.X.rc.icon + ' ' + st.X.rc.label + (S.wild ? ' · WILD' : ''), 1);
    }
    act.set(key, st); sculptStep(st, P, mirror, 0);
  } else if (tool === 'fill') { act.set(key, { tool }); fillAt(P, mirror); }
  else if (tool === 'clay' || tool === 'carve') {
    let c = objs.find(o => o.userData.clay && o.userData.clay.inside(clayLocal(o, P, mirror)));
    if (!c && tool === 'carve') return;
    let created = false;
    if (!c) { const rec = { id: newId(), type: 'clay', L: .5 / rootScale(), balls: [], dabs: [], mat: S.mat, m: new M4().makeTranslation(p.x, p.y, p.z).toArray() }; c = buildObject(rec); addObj(c); created = true; }
    act.set(key, { tool, o: c, start: c.userData.rec.balls.length, created, last: null, still: 0 });
  } else if (tool === 'paint') act.set(key, { tool, snaps: new Map(), clayStart: new Map(), last: null, stamp: S.stamp });
  else if (tool === 'erase') act.set(key, { tool });
}
function clayLocal(o, P, mirror) {
  const w = mirror ? root.localToWorld((() => { const l = root.worldToLocal(P.pos.clone()); l.x = -l.x; return l; })()) : P.pos.clone();
  return o.worldToLocal(w).multiplyScalar(o.userData.clay.L / 2);
}
function clayR(o, P) { const c = o.userData.clay, ws = o.getWorldScale(new V3()).x / (c.L / 2); return Math.max(c.L / 56 * 1.6, S.size * 3 * (P.kind === 'ctrl' ? .4 + .6 * P.trig : 1) / ws); }
// ---- sculpt helpers
const SCULPT = { alpha: 1, clay: 1, carve: 1, smooth: 1, flatten: 1, grab: 1, inflate: 1, texture: 1, chaos: 1, chisel: 1, erode: 1, gouge: 1 };
function worldOf(P, mirror) { if (!mirror) return P.pos.clone(); const l = root.worldToLocal(P.pos.clone()); l.x = -l.x; return root.localToWorld(l); }
function sculptNear(w, pad) {
  let best = null, bd = Infinity; const b = new THREE.Box3();
  for (const o of objs) { if (!o.userData.sculpt) continue; b.setFromObject(o); if (b.isEmpty()) continue; b.expandByScalar(pad); if (!b.containsPoint(w)) continue; const d = b.getCenter(new V3()).distanceTo(w); if (d < bd) { bd = d; best = o; } }
  return best;
}
function sculptNormal(sc, l) {
  const v = sc.vs, g = (a, b, c) => sc.get(Math.round(l.x / v) + a, Math.round(l.y / v) + b, Math.round(l.z / v) + c);
  const n = new V3(g(-2, 0, 0) - g(2, 0, 0), g(0, -2, 0) - g(0, 2, 0), g(0, 0, -2) - g(0, 0, 2));
  return n.lengthSq() > 1e-6 ? n.normalize() : new V3(0, 1, 0);
}
function sculptStep(st, P, mirror, dt) {
  const { o, sc } = st, w = worldOf(P, mirror), l = o.worldToLocal(w.clone()), ws = o.getWorldScale(new V3()).x;
  const press = P.kind === 'ctrl' ? .3 + .7 * P.trig : .8, r = Math.max(sc.vs * 1.6, S.size * 2.2 * press / ws);
  if (st.tool === 'grab') { const d = l.clone().sub(st.p0); if (!st.last || d.distanceTo(st.last) > sc.vs * .3) { sc.grab(st.p0, d, r * 1.6); st.last = d; } return; }
  if (st.tool === 'smooth') { sc.smooth(l, r * 1.4, .55); return; }
  if (st.tool === 'flatten') { sc.flatten(l, r * 1.4, st.n, st.p0, .3); return; }
  if (st.tool === 'inflate') { sc.inflate(l, r * 1.2, .06 * press); return; }
  if (st.tool === 'texture') { if (!st.last || l.distanceTo(st.last) > r * .3) { sc.texture(l, r * 1.5, .22 * press, S.pattern); st.last = l; } return; }
  if (st.tool === 'chisel') { sc.planeCut(l, st.n, r * 1.7); return; }
  if (st.tool === 'alpha') {   // texture-sculpt: the alpha dragged along the surface, colour toned with it
    if (st.last && l.distanceTo(st.last) < Math.max(sc.vs * .7, r * .12)) return;
    if (!st.last) { st.last = l; st.s = 0; return; }
    const n = sculptNormal(sc, st.last.clone().add(l).multiplyScalar(.5)), tile = Math.max(r * 1.6 * (S.aScale || 1), sc.vs * 56), seg = st.last.distanceTo(l); st.best = st.best || new Map();
    sc.alphaSeg(st.last, l, n, r * 1.25, alphaData(S.alpha || 'snake keeled'), alphaAt, { best: st.best, tile, k: .55 * (S.aStr ?? 1) * press * (S.aDig ? -1 : 1), s0: st.s, color: (S.aCol ?? .55) > .01 ? S.color : null, colK: S.aCol ?? .55, rough: (MATS[S.mat] || MATS.clay).rough });
    st.s += seg; st.last = l; return;
  }
  if (st.tool === 'erode') { if (!st.last || l.distanceTo(st.last) > r * .25) { sc.erode(l, r * 1.6, .14 * press, sc.vs / (r * .45)); st.last = l; } return; }
  if (st.tool === 'gouge') { if (st.last && l.distanceTo(st.last) < sc.vs) return; sc.gouge(st.last || l, l, r * .55, .7 * press); st.last = l; return; }
  if (st.tool === 'chaos') {
    if (st.last && l.distanceTo(st.last) < Math.max(sc.vs, r * .2)) return;
    const X = st.X, seg = st.last ? st.last.distanceTo(l) : 0, sNext = st.s + seg, u = sNext / X.R0, sd = X.seed;
    const taper = X.rc.taper ? Math.exp(-sNext / (X.rc.taper * X.R0)) : 1, bulge = .55 + .9 * vnoise(u * .45 + sd, sd, 0) * (X.chaos ?? .6) + (1 - (X.chaos ?? .6)) * .45;
    const rr = Math.max(sc.vs * 1.2, r * taper * bulge);
    // snake: offset across the stroke by slow noise (world-ish axes so the mirror twin mirrors it)
    const wig = (X.chaos ?? .6) * X.R0 * 1.3, off = new V3((fbm(u * .35 + sd, 1.7, 0) - .5) * wig * (mirror ? -1 : 1), (fbm(u * .35 + sd, 5.3, 2) - .5) * wig, (fbm(u * .35 + sd, 9.1, 4) - .5) * wig);
    const lw = l.clone().add(off), from = st.lastW || lw;
    sc.chaosSeg(from, lw, st.lastR || rr, rr, st.E, st.s);
    st.s = sNext; st.last = l; st.lastW = lw; st.lastR = rr;
    if (st.s >= X.nextExtra && seg > 0) {   // spikes · branches · crystals · suction cups sprout along the stroke
      const dir = lw.clone().sub(from).normalize(), ev = {};
      sprout(X, lw, dir, rr, (a, b, ra, rb, ctx, cut) => { const k = JSON.stringify(ctx || {}); sc.chaosSeg(a, b, ra, rb, ev[k] || (ev[k] = evaluator(X, ctx)), st.s, !!cut); });
      const every = Object.values(X.extra || X.rc.extra)[0].every; X.nextExtra = st.s + every * X.R0 * (X.wild ? .5 + X.rnd() : .8 + X.rnd() * .4);
    }
    return;
  }
  if (st.last && l.distanceTo(st.last) < Math.max(sc.vs, r * .15)) return;
  const from = st.last || l, rf = st.lastR || r;
  sc.segment(from, l, rf, r, st.tool === 'carve', S.color, S.mat);
  st.last = l; st.lastR = r;
}
function fillAt(P, mirror) {
  const w = worldOf(P, mirror), o = pickAt(w, .02) || (() => { const h = rayHit(w.clone().addScaledVector(P.dir, -.03), P.dir, .5); return h && topOf(h.object); })();
  if (!o) return say('fill: touch an object', 1.5);
  if (o.userData.sculpt) { const sc = o.userData.sculpt; sc.begin(); sc.fill(S.color, S.mat); const e = sc.end(); if (e) pushUndo(e); }
  else if (o.isMesh && o.geometry.attributes.uv) {
    ensurePaint(o); const before = paintSnapshot(o), M = MATS[S.mat], P2 = o.userData.paint, c = new THREE.Color(M.base || S.color);
    P2.gc.fillStyle = '#' + c.getHexString(); P2.gc.fillRect(0, 0, P2.col.width, P2.col.height); P2.go.fillStyle = 'rgb(255,' + (M.rough * 255 | 0) + ',' + (M.metal * 255 | 0) + ')'; P2.go.fillRect(0, 0, P2.orm.width, P2.orm.height); P2.tc.needsUpdate = P2.to.needsUpdate = true;
    const after = paintSnapshot(o); markPainted(o); pushUndo({ undo() { paintRestore(o, before); }, redo() { paintRestore(o, after); } });
  } else return;
  P.buzz(.5, 30); say('filled · ' + MATS[S.mat].label, 1.2); touch();
}
function addSample(st, p, q, r) {
  const S2 = st.rec.s, n = S2.length;
  if (n && st.last && p.distanceTo(st.last) < Math.max(.0015, r * .35)) return false;
  const sm = n ? new V3(S2[n - 1][0], S2[n - 1][1], S2[n - 1][2]).lerp(p, .6) : p;     // a little smoothing
  S2.push([+sm.x.toFixed(5), +sm.y.toFixed(5), +sm.z.toFixed(5), ...q.toArray().map(v => +v.toFixed(4)), +r.toFixed(5)]); st.last = p.clone();
  st.o.geometry.dispose(); st.o.geometry = strokeGeometry(S2, st.rec.shape); return true;
}
let clayT = 0;
function toolHold(key, P, mirror, dt) {
  const st = act.get(key); if (!st) return;
  if (st.tool === 'z') { zf.hold(st, P); touch(); return; }
  const { p, q } = local(P, mirror);
  if (st.tool === 'tube' || st.tool === 'ribbon') { const r = brushR(P); addSample(st, p, q, st.tool === 'ribbon' ? r * 2.5 : r); }
  else if (st.tool === 'shape') {
    const a = st.a, o = st.o, d = p.clone().sub(a);
    if (st.rec.prim === 'sphere') { o.position.copy(a); o.scale.setScalar(Math.max(.004, d.length() * 2)); }
    else { o.position.copy(a).addScaledVector(d, .5); o.scale.set(Math.max(.004, Math.abs(d.x)), Math.max(.004, Math.abs(d.y)), Math.max(.004, Math.abs(d.z))); }
  } else if (st.sc) { sculptStep(st, P, mirror, dt); touch(); }
  else if (st.tool === 'clay' || st.tool === 'carve') {
    const c = st.o.userData.clay, cl = clayLocal(st.o, P, mirror), r = clayR(st.o, P); if (!c.inside(cl)) return;
    const B = st.o.userData.rec.balls;
    if (!st.last || cl.distanceTo(st.last) > r * .4) { B.push([+cl.x.toFixed(4), +cl.y.toFixed(4), +cl.z.toFixed(4), +r.toFixed(4), S.color, st.tool === 'carve' ? 1 : 0]); st.last = cl; st.still = 0; c.dirty = true; }
    else { st.still += dt; const b = B[B.length - 1]; if (st.still > .3 && b && b[3] < r * 3) { b[3] = +(b[3] + dt * .02 / rootScale()).toFixed(4); c.dirty = true; } }
  } else if (st.tool === 'paint') paintAt(st, P, mirror);
  else if (st.tool === 'erase') {
    const w = mirror ? root.localToWorld(p.clone()) : P.pos, o = pickAt(w, .005);
    if (o) { removeObj(o); pushUndo({ undo() { addObj(o); }, redo() { removeObj(o); } }); P.buzz(.6, 30); }
  }
}
function paintAt(st, P, mirror) {
  const { p } = local(P, mirror);
  if (st.last && st.last.distanceTo(p) < S.size * .3 / rootScale()) return;
  const wp = root.localToWorld(p.clone()), wd = P.dir.clone(); if (mirror) { const ld = wd.clone().transformDirection(new M4().copy(root.matrixWorld).invert()); ld.x = -ld.x; wd.copy(ld.transformDirection(root.matrixWorld)); }
  const origin = (P.kind === 'hand' && !mirror ? P.pts[8].clone() : wp).addScaledVector(wd, -.03);
  const h = rayHit(origin, wd, P.kind === 'hand' ? .07 : .4); if (!h) return;
  st.last = p.clone();
  const o = topOf(h.object), rW = S.size * 2.2;
  st.press = P.kind === 'ctrl' ? .35 + .65 * P.trig : 1;
  if (pf.paintHit(st, o, h.point, wd)) { P.buzz(.05, 5); return; }
  if (o.userData.sculpt) {
    const sc = o.userData.sculpt; if (!st.sculpts) st.sculpts = new Set(); if (!st.sculpts.has(sc)) { st.sculpts.add(sc); if (!sc.users) sc.begin(); sc.users = (sc.users || 0) + 1; }
    const l = o.worldToLocal(h.point.clone()), ws = o.getWorldScale(new V3()).x;
    sc.paint(l, rW / ws, S.color, S.mat, P.kind === 'ctrl' ? .25 + .6 * P.trig : .55, S.mask); touch();
  } else if (o.userData.clay) {
    const c = o.userData.clay, R = o.userData.rec; if (!st.clayStart.has(o)) st.clayStart.set(o, R.dabs.length);
    const cl = o.worldToLocal(h.point.clone()).multiplyScalar(c.L / 2), ws = o.getWorldScale(new V3()).x / (c.L / 2);
    R.dabs.push([+cl.x.toFixed(4), +cl.y.toFixed(4), +cl.z.toFixed(4), +(rW / ws).toFixed(4), S.color]); c.dirtyColor = true;
    if (S.mat !== R.mat) { R.mat = S.mat; o.material = makeMaterial(S.mat, '#ffffff', { vertexColors: true }); }
  } else {
    const mesh = h.object; if (!mesh.geometry.attributes.uv || !h.uv) { mesh.material.color.set(S.color); return; }
    if (!st.snaps.has(mesh)) { ensurePaint(mesh); st.snaps.set(mesh, paintSnapshot(mesh)); }
    if (st.stamp) { paintStamp(mesh, st.stamp); st.stamp = null; S.stamp = null; say('photo laid on as texture'); return; }
    // uv per metre at the hit triangle → the brush keeps its real size on any object
    const f = h.face, pa = mesh.geometry.attributes.position, ua = mesh.geometry.attributes.uv;
    const A = mesh.localToWorld(new V3().fromBufferAttribute(pa, f.a)), B = mesh.localToWorld(new V3().fromBufferAttribute(pa, f.b));
    const k = new THREE.Vector2().fromBufferAttribute(ua, f.a).distanceTo(new THREE.Vector2().fromBufferAttribute(ua, f.b)) / Math.max(1e-5, A.distanceTo(B));
    const uv = h.uv.clone(); uv.x -= Math.floor(uv.x); uv.y -= Math.floor(uv.y);
    dab(mesh, uv, Math.min(.2, rW * k), S.color, S.mat, P.kind === 'ctrl' ? .25 + .5 * P.trig : .5);
  }
  P.buzz(.08, 6);
}
function toolUp(key) {
  const st = act.get(key); act.delete(key); if (!st) return;
  if (st.tool === 'z') { zf.up(st); return; }
  if (st.tool === 'tube' || st.tool === 'ribbon') {
    if (st.rec.s.length < 2) { removeObj(st.o); return; }
    const o = st.o; recM(o); pushUndo({ undo() { removeObj(o); }, redo() { addObj(o); } });
  } else if (st.tool === 'shape') {
    const o = st.o; if (o.scale.length() < .02) o.scale.setScalar(.05 / rootScale());
    recM(o); pushUndo({ undo() { removeObj(o); }, redo() { addObj(o); } });
  } else if (st.sc) {
    const { sc, o } = st; sc.users--; if (sc.users > 0) return;
    const e = sc.end(); sc.flush();
    if (st.created && sc.empty()) { removeObj(o); return; }
    if (e) { const created = st.created; pushUndo({ undo() { e.undo(); if (created) removeObj(o); }, redo() { if (created) addObj(o); e.redo(); } }); }
  } else if (st.tool === 'clay' || st.tool === 'carve') {
    const o = st.o, R = o.userData.rec, added = R.balls.slice(st.start), c = o.userData.clay;
    if (!added.length) { if (st.created) removeObj(o); return; }
    pushUndo({ undo() { R.balls.splice(st.start, added.length); c.dirty = true; if (st.created) removeObj(o); }, redo() { if (st.created) addObj(o); R.balls.push(...added); c.dirty = true; } });
  } else if (st.tool === 'paint') {
    pf.strokeEnd(st);
    if (st.sculpts) for (const sc of st.sculpts) { sc.users--; if (sc.users <= 0) { const e = sc.end(); if (e) pushUndo(e); } }
    for (const [mesh, before] of st.snaps) { const after = paintSnapshot(mesh); markPainted(mesh); pushUndo({ undo() { paintRestore(mesh, before); }, redo() { paintRestore(mesh, after); } }); }
    for (const [o, start] of st.clayStart) { const R = o.userData.rec, added = R.dabs.slice(start), c = o.userData.clay; pushUndo({ undo() { R.dabs.splice(start, added.length); c.dirtyColor = true; }, redo() { R.dabs.push(...added); c.dirtyColor = true; } }); }
  }
}
function markPainted(mesh) { const o = topOf(mesh); if (o) o.userData.painted = true; touch(); }

// ------------------------------------------------------------------ grabbing: an object, the world, or scale with two hands
const grab = { L: null, R: null }; let two = null;
const pmat = P => new M4().compose(P.pos, P.quat, new V3(1, 1, 1));
function grabStart(side, P) {
  const o = pickAt(P.pos, .02);
  if (o) { o.updateMatrix(); grab[side] = { o, before: o.matrix.clone(), off: pmat(P).invert().multiply(o.matrixWorld.clone()) }; P.buzz(.4, 20); }
  else grab[side] = { world: true, p0: P.pos.clone(), yaw0: yawOf(P), root0: root.matrix.clone() };
  const other = grab[side === 'L' ? 'R' : 'L'];
  if (other) {   // two grips: both on air = scale the world · on the same object = scale it
    const O = I[side === 'L' ? 'R' : 'L'];
    if (other.world && grab[side].world) two = { world: true, d0: P.pos.distanceTo(O.pos), mid0: P.pos.clone().add(O.pos).multiplyScalar(.5), a0: Math.atan2(I.L.pos.x - I.R.pos.x, I.L.pos.z - I.R.pos.z), root0: root.matrix.clone(), sideA: side };
    else if (other.o && grab[side].o === other.o) two = { obj: other.o, d0: P.pos.distanceTo(O.pos), s0: other.o.scale.clone() };
  }
}
const yawOf = P => { const f = P.dir.clone(); f.y = 0; return Math.atan2(f.x, f.z); };
function grabHold(side, P) {
  const G = grab[side]; if (!G) return;
  if (two && two.world) {
    if (side !== two.sideA) return;
    const O = I[side === 'L' ? 'R' : 'L'], s = P.pos.distanceTo(O.pos) / Math.max(.02, two.d0), mid = P.pos.clone().add(O.pos).multiplyScalar(.5);
    const a = Math.atan2(I.L.pos.x - I.R.pos.x, I.L.pos.z - I.R.pos.z); let dy = a - two.a0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const m = new M4().makeTranslation(mid.x, mid.y, mid.z).multiply(new M4().makeRotationY(dy)).multiply(new M4().makeScale(s, s, s)).multiply(new M4().makeTranslation(-two.mid0.x, -two.mid0.y, -two.mid0.z)).multiply(two.root0);
    m.decompose(root.position, root.quaternion, root.scale); const sc = THREE.MathUtils.clamp(root.scale.x, .05, 20); root.scale.setScalar(sc);
    return;
  }
  if (two && two.obj) { if (G.o === two.obj && side === 'R') { const O = I.L; two.obj.scale.copy(two.s0).multiplyScalar(P.pos.distanceTo(O.pos) / Math.max(.02, two.d0)); } if (side === 'L') return; }
  if (G.o) {
    const w = pmat(P).multiply(G.off), parentInv = new M4().copy(root.matrixWorld).invert(), l = parentInv.multiply(w);
    const s = G.o.scale.clone(); l.decompose(G.o.position, G.o.quaternion, new V3()); if (!two) G.o.scale.copy(s); else G.o.scale.copy(s);
  } else if (G.world) {
    // move with the hand, turn around it (yaw only = no seasickness)
    const d = P.pos.clone().sub(G.p0); let dy = yawOf(P) - G.yaw0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const m = new M4().makeTranslation(P.pos.x, P.pos.y, P.pos.z).multiply(new M4().makeRotationY(dy)).multiply(new M4().makeTranslation(-P.pos.x, -P.pos.y, -P.pos.z))
      .multiply(new M4().makeTranslation(d.x, d.y, d.z)).multiply(G.root0);
    m.decompose(root.position, root.quaternion, root.scale);
  }
}
function grabEnd(side) {
  const G = grab[side]; grab[side] = null;
  if (two) { const wasWorld = two.world; two = null; const other = side === 'L' ? 'R' : 'L'; if (grab[other]) { const P = I[other]; grab[other] = null; grabStart(other, P); } if (wasWorld) { touch(); return; } }
  if (G && G.o) { const o = G.o, before = G.before.clone(); recM(o); const after = o.matrix.clone();
    if (!before.equals(after)) pushUndo({ undo() { before.decompose(o.position, o.quaternion, o.scale); recM(o); }, redo() { after.decompose(o.position, o.quaternion, o.scale); recM(o); } }); }
}

function duplicate(o, P) {
  recM(o); const rec = o.userData.ts ? pf.recFull(o) : JSON.parse(JSON.stringify(o.userData.rec)); rec.id = newId(); delete rec.paint; delete rec.gid; if (o.userData.sculpt) rec.data = o.userData.sculpt.save(); if (o.userData.z) rec.zg = o.userData.z.packB64();
  const c = buildObject(rec); addObj(c);
  if (o.userData.painted && o.userData.paint) { const P2 = ensurePaint(c); P2.gc.drawImage(o.userData.paint.col, 0, 0); P2.go.drawImage(o.userData.paint.orm, 0, 0); P2.tc.needsUpdate = P2.to.needsUpdate = true; c.userData.painted = true; }
  pushUndo({ undo() { removeObj(c); }, redo() { addObj(c); } }); P.buzz(.6, 30); say('copy', .8);
}

// ------------------------------------------------------------------ palette + shortcuts
const cycle = (arr, cur, d) => arr[(arr.indexOf(cur) + d + arr.length) % arr.length];
function setTool(t) {
  S.tool = t; say(TOOLS.find(x => x[0] === t)[2], 1); savePrefs(); menu.draw();
  try { if (t === 'z' && !objs.some(o => o.userData.z)) zf.newSphere(null, !!(flat && flat.on)); if (bp.open) bp.draw(); } catch { }   // (before start-up finished: nothing yet)
}
// your own alpha: any image (white = up)
function pickAlpha() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files[0]; if (!f) return; const img = new Image(); img.onload = () => { const n = addCustomAlpha(f.name.replace(/\.[^.]+$/, '').slice(0, 14) || 'my alpha', img); S.zAlpha = n; bp.draw(); say('alpha: ' + n, 1.2); }; img.src = URL.createObjectURL(f); };
  inp.click();
}
menu.onPick = id => {
  const [k, v] = id.split(':');
  if (k === 'tool') setTool(v);
  else if (k === 'prim') { S.prim = v; S.tool = 'shape'; }
  else if (k === 'detail') { S.detail = THREE.MathUtils.clamp(S.detail * (v === '+' ? 1 / 1.3 : 1.3), 1, 10); say(`new sculpts: voxel ${S.detail.toFixed(1)} mm`, 1.5); }
  else if (k === 'size') S.size = THREE.MathUtils.clamp(S.size * (v === '+' ? 1.35 : 1 / 1.35), .0015, .06);
  else if (k === 'col') { S.color = COLORS[+v]; if (!['tube', 'ribbon', 'shape', 'clay', 'paint', 'fill'].includes(S.tool)) S.tool = 'paint'; }
  else if (k === 'mat') { S.mat = v; if (MATS[v].smart) say('✦ ' + MATS[v].label + ' · paint or 🪣 fill a sculpt: edges + cavities react', 2.5); }
  else if (id === 'mask') { S.mask = cycle(['all', 'edges', 'cavities'], S.mask, 1); S.tool = 'paint'; say('paint mask: ' + S.mask, 1.5); }
  else if (id === 'recipe') { S.recipe = cycle(RECIPE_KEYS, S.recipe || 'python', 1); S.tool = 'chaos'; S.wild = false; const rc = recipeOf(S.recipe); say('🌀 ' + rc.icon + ' ' + rc.label, 1.2); }
  else if (id === 'wild') { S.wild = !S.wild; S.tool = 'chaos'; say(S.wild ? '🎲 WILD: every stroke a different creature' : 'wild off', 1.5); }
  else if (id === 'pattern') { S.pattern = cycle(['rock', 'scales', 'wrinkle'], S.pattern, 1); S.tool = 'texture'; say('texture: ' + S.pattern, 1.2); }
  else if (id === 'undo') undo(); else if (id === 'redo') redo();
  else if (id === 'mirror') { S.mirror = !S.mirror; say(S.mirror ? 'mirror ON · draw on one side, both sides grow' : 'mirror off', 1.5); }
  else if (id === 'photo') takePhoto();
  else if (id === 'send') { if (BE.blender && BE.blender.on && S.active && objs.includes(S.active)) BE.blender.sendNow(S.active); else sendNow(true); }
  else if (id === 'brush') { S.brushOpen = !S.brushOpen; bp.open = S.brushOpen; bp.draw(); }
  else if (id === 'layers') { S.layersOpen = !S.layersOpen; pf.panel.open = S.layersOpen; pf.panel.draw(); say(S.layersOpen ? '🎨 Painter: paint any object · layers · smart materials' : 'Painter panel closed', 1.5); }
  else if (id === 'home') homeView();
  else if (id === 'clear') clearAll();
  savePrefs();
};
let clearArm = 0;
function clearAll() {
  if (performance.now() - clearArm > 2500) { clearArm = performance.now(); say('tap ✕ again to clear everything', 2.5); return; }
  const was = [...objs]; was.forEach(removeObj); pushUndo({ undo() { was.forEach(addObj); }, redo() { was.forEach(removeObj); } }); say('cleared · undo brings it back', 2);
}

// ------------------------------------------------------------------ camera photo (Quest passthrough camera if the browser allows it)
async function takePhoto() {
  try {
    say('📷 camera…', 2);
    const st = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: 'environment' } });
    const v = document.createElement('video'); v.srcObject = st; v.muted = true; v.playsInline = true; await v.play(); await new Promise(r => setTimeout(r, 400));
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0); st.getTracks().forEach(t => t.stop());
    const src = cv.toDataURL('image/jpeg', .85), head = headPos(), fwd = headFwd();
    const w = head.clone().addScaledVector(fwd, .4); w.y -= .05; const l = root.worldToLocal(w);
    const rec = { id: newId(), type: 'photo', src, aspect: cv.height / cv.width };
    const o = buildObject(rec); o.position.copy(l); o.scale.setScalar(.22 / rootScale()); o.lookAt(head); recM(o); addObj(o); pushUndo({ undo() { removeObj(o); }, redo() { addObj(o); } });
    const img = new Image(); img.src = src; S.stamp = img; S.tool = 'paint';
    say('photo! paint tool: touch an object = it gets this texture', 4);
  } catch (e) { say('camera not available here: ' + (e.name || e.message), 3); console.warn(e); }
}

// ------------------------------------------------------------------ save · export · Blender · phones
const exporter = new GLTFExporter();
// the public link (no PC): the whole scene lives in this browser (IndexedDB holds the big sculpt data)
function idb(op, val) {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('bUild-sTudio', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('scene');
    rq.onerror = () => rej(rq.error);
    rq.onsuccess = () => { const tx = rq.result.transaction('scene', op === 'put' ? 'readwrite' : 'readonly'), st = tx.objectStore('scene'), r = op === 'put' ? st.put(val, 'current') : st.get('current'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); };
  });
}
async function downloadGLB() {
  say('exporting .glb …', 1.5);
  const glb = await exportGLB(), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  a.download = 'bUild_sTudio_' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '') + '.glb'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  say('⬇ .glb saved (Blender, Unity, Sketchfab, 3D print)', 2.5);
}
function serialize() {
  return { v: 1, objs: objs.map(o => { recM(o); if (o.userData.ts) return pf.recFull(o); const r = { ...o.userData.rec }; if (o.userData.sculpt) r.data = o.userData.sculpt.save(); if (o.userData.z) r.zg = o.userData.z.packB64(); if (o.userData.painted) { const P = (o.isMesh ? o : null)?.userData.paint; if (P) r.paint = { col: P.col.toDataURL('image/webp', .92), orm: P.orm.toDataURL('image/png') }; } return r; }) };
}
async function exportGLB() {
  const g = new THREE.Group();
  for (const o of objs) {
    let c;
    if (o.userData.ts) c = pf.exportMesh(o);
    else if (o.userData.sculpt) { c = o.userData.sculpt.bake(); o.updateMatrix(); c.applyMatrix4(o.matrix); }
    else if (o.userData.clay) { c = o.userData.clay.bake(); o.updateMatrix(); c.applyMatrix4(o.matrix); c.scale.multiplyScalar(1); }
    else if (o.userData.z) { c = o.userData.z.exportMesh(); o.updateMatrix(); c.applyMatrix4(o.matrix); }
    else { c = skClone(o); }   // skinned imports keep their bones
    c.name = o.name; g.add(c);
  }
  return exporter.parseAsync(g, { binary: true, onlyVisible: true });
}
let sending = false;
async function sendNow(loud) {
  if (sending) return; sending = true;
  try {
    const zp = objs.reduce((a, o) => a + (o.userData.z ? o.userData.z.F : 0), 0); if (zp > 250e3 && BE.syncBusy) BE.syncBusy(Math.min(15000, 3000 + zp / 150));   // big Z meshes: packing takes seconds — the others wait
    const data = serialize();
    if (DEV) {
      await fetch('/__q/studio-save', { method: 'POST', body: JSON.stringify(data) });
      const glb = await exportGLB(); await fetch('/__q/model?name=studio_live', { method: 'POST', body: glb });
      S.status = `saved ${new Date().toLocaleTimeString()} · Blender + phones updated`;
    } else { await idb('put', JSON.stringify(data)); S.status = 'saved on this device · ' + new Date().toLocaleTimeString(); }
    if (loud) say(DEV ? '⇪ sent to Blender + phones' : 'saved', 2);
    dirty = false; menu.draw();
  } catch (e) { console.warn('save failed', e); if (loud) say('save failed: ' + e.message, 3); }
  sending = false;
}
async function load() {
  let data = null;
  try { if (DEV) { const r = await fetch('/__q/studio-load'); if (r.ok) data = await r.json(); } } catch { }
  if (!data) try { data = JSON.parse(await idb('get') || 'null'); } catch { }
  if (!data || !data.objs) return;
  for (const rec of data.objs) {
    const o = buildObject(rec); const paint = rec.paint; delete rec.paint; addObj(o);
    if (paint && o.isMesh) { const P = ensurePaint(o); for (const [k, g] of [['col', P.gc], ['orm', P.go]]) { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0); P.tc.needsUpdate = P.to.needsUpdate = true; }; im.src = paint[k]; } o.userData.painted = true; }
  }
  dirty = false; console.log('[studio] loaded', objs.length, 'objects');
}
// Blender → here: a new from_blender*.glb in the share folder appears in front of you
const seenInbox = new Map(); let inboxReady = false;
async function inbox() {
  if (!DEV) return;
  try {
    const ms = await (await fetch('/__q/models')).json();
    for (const m of ms) {
      if (!m.name.startsWith('from_blender')) continue;
      const old = seenInbox.get(m.name); seenInbox.set(m.name, m.t);
      if (!inboxReady || old === m.t) continue;
      const prev = objs.find(o => o.userData.rec.type === 'import' && o.userData.rec.src === m.name);
      const head = headPos(), w = head.clone().addScaledVector(headFwd(), .45); w.y -= .1;
      const rec = { id: newId(), type: 'import', src: m.name, url: `./share/${m.name}?t=${m.t}` };
      const o = buildObject(rec);
      if (prev) { prev.updateMatrix(); prev.matrix.decompose(o.position, o.quaternion, o.scale); removeObj(prev); } else { o.position.copy(root.worldToLocal(w)); o.scale.setScalar(1 / rootScale()); }
      recM(o); addObj(o); say('from Blender: ' + m.name.replace(/\.glb$/, ''), 2.5);
    }
    inboxReady = true;
  } catch { }
}
setInterval(inbox, 2500); inbox();

// ------------------------------------------------------------------ view
const xrCam = () => renderer.xr.isPresenting ? renderer.xr.getCamera() : world.camera;
const headPos = () => new V3().setFromMatrixPosition(xrCam().matrixWorld);
const headFwd = () => { const f = new V3(0, 0, -1).applyQuaternion(new Q().setFromRotationMatrix(xrCam().matrixWorld)); f.y = 0; return f.normalize(); };
function homeView() {
  const h = headPos(), f = headFwd();
  root.position.copy(h).addScaledVector(f, .42); root.position.y = h.y - .32;
  root.rotation.set(0, Math.atan2(-f.x, -f.z), 0); root.scale.setScalar(1);
  menu.panel.userData.fresh = true;
}

// ------------------------------------------------------------------ every frame
let started = false, homeWait = 0;
function tick(frame, dt) {
  dt = Math.min(.05, dt || .016); frameNo++;
  if (BE.xrFrame) BE.xrFrame();
  if (!started && ((BE.flat && BE.flat.on) || headPos().y > .25 || ++homeWait > 45)) { started = true; homeWait = 0; homeView(); say(`bUild sTudio v${__VERSION__} · trigger/pinch = ${S.tool}`, 3); }   // wait for a real head pose
  I.read(frame, world.xrReferenceSpace, dt);
  BE.hands = ['L', 'R'].filter(s => I[s].pts).map(s => ({ key: s === 'L' ? 'left' : 'right', P: I[s].pts }));
  const head = headPos(), fwd = headFwd(), R = I.R, L = I.L;
  menu.place(L, head, dt);
  bp.open = !!S.brushOpen; bp.place(menu.panel);
  if (bp.open && bp.seen !== S.active) { bp.seen = S.active; bp.draw(); }   // live-skin row follows the active sculpt
  const onMenu = menu.use(R, dt) || pf.tick(R, dt, menu.panel, head) || bp.use(R, dt);
  // controller shortcuts
  if (R.sxEdge) { const ids = TOOLS.map(t => t[0]); setTool(cycle(ids, S.tool, R.sxEdge)); }
  if (R.syEdge) { S.size = THREE.MathUtils.clamp(S.size * (R.syEdge > 0 ? 1.35 : 1 / 1.35), .0015, .06); say(`size ${(S.size * 1000).toFixed(0)} mm`, .8); menu.draw(); savePrefs(); }
  if (L.sxEdge) { S.color = cycle(COLORS, S.color, L.sxEdge); menu.draw(); savePrefs(); }
  if (L.syEdge) { S.mat = cycle(MAT_KEYS, S.mat, -L.syEdge); say(MATS[S.mat].label, .8); menu.draw(); savePrefs(); }
  if (R.aDown) undo(); if (R.bDown) redo();
  if (R.stickDown) setTool(S.tool === 'clay' ? 'carve' : 'clay');
  if (L.aDown) { menu.open = !menu.open; menu.panel.userData.fresh = true; }
  if (L.bDown) { S.mirror = !S.mirror; say(S.mirror ? 'mirror ON' : 'mirror off', 1); menu.draw(); savePrefs(); }
  // grabbing (grip · or trigger with the move tool)
  for (const side of ['L', 'R']) {
    const P = I[side], moveTrig = S.tool === 'move' && !(side === 'R' && onMenu);
    const want = P.grip || (moveTrig && P.on), was = !!grab[side];
    if (want && !was) grabStart(side, P); else if (!want && was) grabEnd(side); else if (want) grabHold(side, P);
    if (grab[side] && grab[side].o && P.grip && P.onDown) duplicate(grab[side].o, P);   // holding a thing + trigger = leave a copy here
  }
  // tools
  for (const side of ['L', 'R']) {
    const P = I[side];
    const blocked = (side === 'R' && onMenu) || grab[side] || S.tool === 'move' || (side === 'L' && L.kind === 'hand' && L.palmUp && menu.open);
    let tool = S.tool; if (side === 'L' && tool === 'clay' && P.kind === 'hand') tool = 'carve';   // bare hands: left pinch carves
    const keys = S.mirror ? [[side, false], [side + '~', true]] : [[side, false]];
    if (blocked || P.kind === 'none') { for (const [k] of [[side], [side + '~']]) if (act.has(k)) toolUp(k); continue; }
    if (P.onDown) for (const [k, mir] of keys) toolDown(k, P, tool, mir);
    else if (P.on) for (const [k, mir] of keys) toolHold(k, P, mir, dt);
    else if (P.onUp) for (const k of [side, side + '~']) toolUp(k);
  }
  // sculpts: remesh what changed, within a frame budget
  zf.tick();
  { let budget = 7; for (const o of objs) { const sc = o.userData.sculpt; if (!sc || !sc.dirty.size) continue; const t0 = performance.now(); sc.update(budget); budget -= performance.now() - t0; if (budget <= 0) break; } }
  // clay rebuilds (≤ 20 Hz while you sculpt)
  clayT += dt;
  if (clayT > .05) { clayT = 0; for (const o of objs) { const c = o.userData.clay; if (!c) continue; if (c.dirty) c.rebuild(); else if (c.dirtyColor) { c.recolor(); } c.dirtyColor = false; } }
  // cursors
  for (const side of ['L', 'R']) {
    const P = I[side], C = CUR[side];
    C.g.visible = P.kind !== 'none' && !(side === 'R' && onMenu) && !(side === 'L' && menu.panel.visible && P.kind === 'hand');
    const r = SCULPT[S.tool] ? S.size * 2.2 * (['smooth', 'flatten', 'grab'].includes(S.tool) ? 1.4 : 1) : S.tool === 'paint' ? S.size * 2.2 : S.tool === 'ribbon' ? S.size * 2.5 : S.size;
    C.g.position.copy(P.pos); C.g.quaternion.copy(P.quat); C.ball.scale.setScalar(Math.max(.002, r * (P.kind === 'ctrl' && P.on ? .25 + .75 * P.trig : 1)));
    C.ring.scale.setScalar(C.ball.scale.x * 1.05); C.ring.visible = S.tool !== 'move';
    C.ball.material.color.set(S.tool === 'erase' ? '#ff3b30' : S.tool === 'carve' ? '#ffffff' : S.tool === 'move' ? '#66ccff' : S.color);
    C.ball.material.opacity = grab[side] ? .55 : .28;
    const lh = menu.hit || pf.panel.hit || bp.hit; C.laser.visible = side === 'R' && onMenu && P.kind === 'ctrl' && !!lh;
    if (C.laser.visible) { C.laser.position.copy(P.pos); C.laser.lookAt(lh); C.laser.scale.set(1, 1, P.pos.distanceTo(lh)); }
  }
  mirrorPlane.visible = S.mirror; lightsFollow();
  if (BE.sync) BE.sync.step(dt);
  card.step(head, fwd, dt);
  // autosave: a few seconds after you stop
  if (dirty && !I.L.on && !I.R.on && !grab.L && !grab.R) { dirtyT += dt; if (dirtyT > 4) { dirtyT = -999; sendNow(false); } }
}
const pf = createPaintFlow({ S, objs, scene, menu, addObj, removeObj, pushUndo, say, touch, newId, buildObject, downloadGLB, savePrefs }); BE.pf = pf;
const zf = createZFlow({ S, objs, root, addObj, removeObj, pushUndo, say, touch, newId, buildObject, setActive: o => pf.setActive(o), isQuest, headPos, headFwd }); BE.zf = zf;
const bp = createBrushPanel(S, { z: zf, isFlat: () => !!(flat && flat.on), zInfo: () => { const o = zf.active(); return o ? { F: o.userData.z.F, look: o.userData.z.look } : null; }, pickAlpha: () => pickAlpha(), alphaToLayer: a => { const t = pf.activeTs(), l = t && t.layers[t.sel]; if (!l || l.kind !== 'fill' || l.pat !== 11 || !S.layersOpen) return false; l.alpha = a; t.full(); touch(); return true; }, prefs: () => savePrefs(), changed: () => menu.draw(), say, setTool: t => setTool(t),
  skinGet: () => { const o = S.active && S.active.userData.sculpt ? S.active : null; return o ? o.userData.rec.skin || null : null; },
  skinSet: (cmd, v) => {
    const o = S.active && S.active.userData.sculpt ? S.active : null; if (!o) { say('draw or pick a sculpt first', 1.2); return; }
    const sc = o.userData.sculpt, cur = sc.rec.skin, s = cur ? { ...cur } : { a: S.alpha || 'dragon round', b: null, t: +(sc.vs * 30).toFixed(5), k: 1, c: .7 };
    if (cmd === 'off') { sc.setSkin(null); say('live skin off', 1); }
    else if (cmd === 'on') { if (cur) return; sc.setSkin(s); say('🐉 live skin: ' + s.a, 1.2); }
    else if (cmd === 'alpha') { s.a = S.alpha || 'dragon round'; s.b = null; sc.setSkin(s); say('🐉 live skin: ' + s.a, 1.2); }
    else if (cmd === 'skT') { s.t = Math.max(.005, v / 100); sc.setSkin(s); }
    else if (cmd === 'skK') { s.k = v; sc.setSkin(s); }
    else if (cmd === 'skC') { s.c = v; sc.setSkin(s); }
    else if (cmd === 'skG' || cmd === 'skW' || cmd === 'skS' || cmd === 'skD') { s[cmd[2].toLowerCase()] = +v.toFixed(3); sc.setSkin(s); }
    touch(); bp.draw();
  },
  setTone: t => { const o = S.active && S.active.userData.sculpt ? S.active : null; if (o) { o.userData.sculpt.setTone(t); touch(); } say('smart tone: ' + t + (o ? '' : ' (new sculpts)'), 1.2); menu.draw(); } });
scene.add(bp.panel); BE.bp = bp;
world.onXRFrame(tick);

// ------------------------------------------------------------------ dev endpoint + start page
if (DEV) BE.devState = () => ({ tool: S.tool, size: S.size, color: S.color, mat: S.mat, mirror: S.mirror, objs: objs.map(o => o.userData.rec.type + (o.userData.rec.s ? ':' + o.userData.rec.s.length : o.userData.rec.balls ? ':' + o.userData.rec.balls.length : o.userData.sculpt ? ':' + o.userData.sculpt.tris() : o.userData.ts ? ':' + o.userData.ts.layers.length : '')), L: I.L.kind, R: I.R.kind, undo: U.length, scale: +root.scale.x.toFixed(3) });
Object.assign(BE, { clearUndo, ROOM, ROOM_LINK, downloadGLB, idb, undo, redo, sendNow, serialize, exportGLB, homeView, root, takePhoto, setTool, buildObject, addObj, removeObj, newId, M4 });
await load();
// ---- Blender bridge (dev server: Blender add-on "bUild sTudio lInk" ≥ 0.2)
async function exportLocalGLB(o) {   // one object at its own origin (Blender gets the transform separately)
  let c; o.updateMatrix();
  if (o.userData.ts) c = new THREE.Mesh(o.geometry, o.userData.ts.exportMaterial());
  else if (o.userData.sculpt) c = o.userData.sculpt.bake();
  else if (o.userData.clay) c = o.userData.clay.bake();
  else { c = skClone(o); c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.set(1, 1, 1); }
  c.name = (o.userData.rec.name || o.userData.rec.type);
  const g = new THREE.Group(); g.add(c); return exporter.parseAsync(g, { binary: true, onlyVisible: true });
}
const geoSig = o => { const r = o.userData.rec; return o.userData.ts ? 'p' + o.userData.ts.ver : o.userData.sculpt ? 's' + (o.userData.sculpt.ver || 0) : r.s ? 't' + r.s.length + r.color + r.mat : r.balls ? 'c' + r.balls.length + ':' + (r.dabs || []).length : r.type + (r.prim || '') + (r.color || '') + (r.mat || '') + (r.url || ''); };
if (DEV) BE.blender = createBlenderLink({ S, objs, addObj, removeObj, buildObject, say, pf, newId, exportLocalGLB, geoSig,
  isHub: () => !BE.sync || BE.sync.role !== 'client', busy: () => I.L.on || I.R.on || !!grab.L || !!grab.R,
  isGrabbed: o => (grab.L && grab.L.o === o) || (grab.R && grab.R.o === o), changed: () => menu.draw(),
  headRootMatrix: () => { if (!started) return null; root.updateMatrixWorld(); return new M4().copy(root.matrixWorld).invert().multiply(xrCam().matrixWorld); } });
// ---- live sync (same link = same scene on every device)
const KIND = isQuest ? 'quest' : /iPad|Tablet|SM-[TPX]\d/i.test(UA) || (/Android/i.test(UA) && !/Mobile/i.test(UA)) ? 'tablet' : /Android|iPhone|Mobile/i.test(UA) ? 'phone' : 'pc';
const sync = BE.sync = createSync({ room: ROOM, root, objs, S, buildObject, addObj, removeObj, clearUndo, say, kind: KIND, busy: () => I.L.on || I.R.on,
  headMatrix: () => started ? xrCam().matrixWorld : null,
  pointers: () => ['L', 'R'].map(s => CUR[s].g.visible && started ? { pos: CUR[s].g.position, r: CUR[s].ball.scale.x, col: S.color } : null) });
sync.onStatus = () => { menu.draw(); const el = document.getElementById('fRoom'); if (el) el.textContent = S.room; const st = document.getElementById('roomState'); if (st) st.textContent = S.room; };
// ---- three ways in: full VR world · mixed reality (your room) · right here (PC mouse/pen, phone, tablet touch)
let mode = 'start';
const flat = createFlat({ world, I, menu, root, objs, S, api: { undo, redo, setTool, enter: m => enter(m) } }); BE.flat = flat;
function enter(m) {
  if (m === 'flat') { mode = 'flat'; $('start').hidden = true; env.visible = true; scene.background = null; started = true; flat.start(); return; }
  if (renderer.xr.isPresenting) return;
  world.launchXR({ sessionMode: m === 'vr' ? SessionMode.ImmersiveVR : SessionMode.ImmersiveAR }); pendingXR = m;
}
{ // 🔗 room button in the flat bar: QR + link for the next device
  const bar = document.querySelector('#flatui .bar'), b = document.createElement('button'); b.id = 'fRoom'; b.textContent = S.room || '🔗 ' + ROOM; b.className = 'on'; bar.prepend(b);
  const pop = document.createElement('div'); pop.hidden = true; pop.style.cssText = 'position:absolute;top:56px;right:10px;background:#000d;border:1px solid #66ccff;border-radius:16px;padding:14px;pointer-events:auto;text-align:center;max-width:300px;font:500 13px system-ui;color:#ddd';
  pop.innerHTML = '<div style="background:#fff;padding:6px;border-radius:10px;display:inline-block"></div><p style="margin:8px 0 6px;word-break:break-all;color:#66ccff"></p><p style="margin:0 0 8px">open this on any phone, tablet, PC or the Quest browser = the SAME scene, live</p><button>copy link</button>';
  pop.firstChild.appendChild(QR.canvas(ROOM_LINK, 4)); pop.children[1].textContent = ROOM_LINK;
  pop.lastChild.onclick = () => navigator.clipboard.writeText(ROOM_LINK).then(() => flat.toast('link copied', 1.5));
  document.getElementById('flatui').appendChild(pop); b.onclick = () => { pop.hidden = !pop.hidden; };
}
{ // 🐉 alphas panel in the flat bar
  const bar = document.querySelector('#flatui .bar'), b = document.createElement('button'); b.textContent = 'Z brushes'; bar.prepend(b);
  const box = document.createElement('div'); box.style.cssText = 'position:absolute;left:10px;top:62px;width:min(440px,94vw);max-height:max(300px,calc(100vh - 480px));overflow-y:auto;pointer-events:auto;touch-action:none';
  const cv = bp.canvas; cv.style.cssText = 'width:100%;display:block;border-radius:14px;box-shadow:0 6px 30px #000a'; box.appendChild(cv); document.getElementById('flatui').appendChild(box);
  const px = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * bp.W, (e.clientY - r.top) / r.height * bp.H]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); bp.down(...px(e)); e.preventDefault(); e.stopPropagation(); });
  cv.addEventListener('pointermove', e => { bp.move(...px(e)); e.stopPropagation(); });
  cv.addEventListener('pointerup', e => { bp.up(); e.stopPropagation(); });
  const show = () => { box.hidden = !S.brushOpen; b.classList.toggle('on', !!S.brushOpen); };
  b.onclick = () => { S.brushOpen = !S.brushOpen; bp.draw(); savePrefs(); show(); };
  setInterval(() => { show(); { const za = zf.active(), zk = za ? za.userData.z.F + za.userData.z.look : ''; if (S.brushOpen && (bp.seen !== S.active || bp.seenK !== zk)) { bp.seen = S.active; bp.seenK = zk; bp.draw(); } } }, 300); show();
}
{ // 🎨 painter panel in the flat bar
  const bar = document.querySelector('#flatui .bar'), b = document.createElement('button'); b.id = 'fLayers'; b.textContent = '🎨 painter'; bar.prepend(b);
  const box = document.createElement('div'); box.id = 'fLayerBox'; box.style.cssText = 'position:absolute;right:10px;top:58px;width:min(440px,94vw);pointer-events:auto;touch-action:none';
  const cv = pf.panel.canvas; cv.style.cssText = 'width:100%;display:block;border-radius:14px;box-shadow:0 6px 30px #000a'; box.appendChild(cv); document.getElementById('flatui').appendChild(box);
  const px = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * pf.panel.W, (e.clientY - r.top) / r.height * pf.panel.H]; };
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pf.panel.down(...px(e)); e.preventDefault(); e.stopPropagation(); });
  cv.addEventListener('pointermove', e => { pf.panel.move(...px(e)); e.stopPropagation(); });
  cv.addEventListener('pointerup', e => { pf.panel.up(); e.stopPropagation(); });
  cv.addEventListener('wheel', e => { pf.panel.scroll = Math.max(0, pf.panel.scroll + Math.sign(e.deltaY)); pf.panel.draw(); e.preventDefault(); e.stopPropagation(); }, { passive: false });
  const show = () => { box.hidden = !S.layersOpen; b.classList.toggle('on', !!S.layersOpen); };
  b.onclick = () => { S.layersOpen = !S.layersOpen; pf.panel.open = S.layersOpen; pf.panel.draw(); savePrefs(); show(); };
  setInterval(show, 300); show();
}
let pendingXR = null, wasFlat = false;
renderer.xr.addEventListener('sessionstart', () => { wasFlat = flat.on; flat.stop(); mode = pendingXR || 'ar'; env.visible = mode === 'vr'; $('start').hidden = true; started = false; I.sim = null; });
renderer.xr.addEventListener('sessionend', () => { if (dirty) sendNow(false); if (wasFlat) enter('flat'); else { $('start').hidden = false; env.visible = false; mode = 'start'; } });
let lastT = performance.now();
(function flatLoop() { requestAnimationFrame(flatLoop); const n = performance.now(), dt = (n - lastT) / 1000; lastT = n; if (flat.on && !renderer.xr.isPresenting) { tick(null, dt); flat.step(); } })();
const vr = navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
const ar = navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
$('goVR').hidden = !vr; $('goMR').hidden = !ar;
$('goVR').onclick = () => enter('vr'); $('goMR').onclick = () => enter('ar'); $('goFlat').onclick = () => enter('flat');
$('info').innerHTML = vr || ar ? '' : `headset: open <b>${BASE}studio.html</b> in the Quest browser`;
if (q.has('flat')) enter('flat');
