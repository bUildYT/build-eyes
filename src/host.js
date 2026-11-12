// bUild eYes · HOST = the headset (Quest 3 / Meta VR Glasses), built on Meta's Immersive Web SDK.
//  passthrough + hand tracking + plane/mesh detection + depth occlusion (real things hide the creatures).
//  1. touch corner 1 of your paper and hold still → then corner 2 (shared with phones) — or just wait = play right here
//  2. bare hands only: poke, flick, pinch to pick up, palm up = ride, press flat · CLAP = one more creature · pinch in the air + let go = food
//  3. LEFT pinch held 2 s = place the table again
import * as THREE from 'three';
import { World, SessionMode, DepthOccludable, OcclusionShadersMode } from '@iwsdk/core';
import { createWorld } from './world.js';
import { Monster } from './monster.js';
import { frameFromCorners, frameAt, applyFrame, A4 } from './table.js';
import { hostRoom, newCode } from './net.js';
const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);
const log = (...a) => { console.log('[eyes]', ...a); };

let world, table, W, room, tableEnt;
const code = localStorage.getItem('be:code') || newCode(); localStorage.setItem('be:code', code);

export async function prepare({ ar }) {
  $('code').textContent = code;
  { const p = document.createElement('div'); p.style.cssText = 'margin-top:10px;display:inline-block;background:#fff;padding:6px;border-radius:10px'; p.appendChild(BE.qr(BE.base + '?role=eye&eye=' + code, 3)); $('hostBox').appendChild(p); }
  const phone = !BE.isQuest && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (phone && BE.q.get('role') !== 'host') { $('go').textContent = 'headset only'; $('info').textContent = 'This phone is an EYE: type the code your headset shows.'; return; }
  world = await World.create($('app'), {
    xr: {
      sessionMode: SessionMode.ImmersiveAR, offer: 'none',
      referenceSpace: { type: 'local-floor', fallbackOrder: ['local'] },
      features: { handTracking: { required: false }, planeDetection: true, meshDetection: true, hitTest: true, anchors: true, depthSensing: { usage: 'gpu-optimized', format: 'float32' } },
    },
    features: { sceneUnderstanding: { showWireFrame: false }, grabbing: false, locomotion: false, spatialUI: false, physics: false },
    render: { near: .01, far: 30 },
  });
  window.BE.world = world;
  world.renderer.shadowMap.enabled = true; world.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  build();
  $('go').disabled = !ar; $('go').textContent = ar ? 'ENTER' : 'needs a headset';
  $('info').innerHTML = ar ? 'Hands free (put the controllers down).<br>Paper on the table? Touch corner 1, then corner 2. No paper? Touch the table and wait.' : `Open <b>${location.origin}</b> in the Quest browser.`;
  $('go').onclick = () => { W.sfx.ctx(); world.launchXR(); };
  world.renderer.xr.addEventListener('sessionstart', onStart);
  world.renderer.xr.addEventListener('sessionend', () => { $('start').hidden = false; W.monsters.forEach(m => m.save()); });
  world.onXRFrame(tick);
  // the room: phones join with the code; they get the world 20× a second
  room = hostRoom(code, {
    onCount: n => { $('small').textContent = `${n} EYE${n === 1 ? '' : 's'} linked`; if (n) xrSay(`${n} EYE${n === 1 ? '' : 's'} watching`, 2.5); },
    onMsg: (m) => {
      if (m.t === 'food' && placed) W.dropFood(new V3().fromArray(m.p));
      if (m.t === 'hi') xrSay(`a new EYE joined`, 2.5);
    },
    onError: e => log('net', e.type),
  });
  W.onEvent = ev => room && room.send(ev);
  setInterval(() => { if (placed && room && room.count) room.send(W.snap()); }, 50);
}

export function stop() { if (room) room.close(); room = null; if (world) { world.renderer.setAnimationLoop(null); world.renderer.domElement.remove(); } }

// ------------------------------------------------------------------ scene pieces (plain three.js under IWSDK)
let card, ring, ouch, sayUntil = 0;
function build() {
  table = new THREE.Group(); table.visible = false; world.scene.add(table);
  tableEnt = world.createTransformEntity(table, { persistent: true });
  tableEnt.addComponent(DepthOccludable, { mode: OcclusionShadersMode.SoftOcclusion });
  W = createWorld({ root: table, camera: world.camera, onHurt: a => { hurtA = Math.min(.6, hurtA + a); }, say: t => xrSay(t, 3) });
  W.vw = 0; W.staleMs = 200; W.goneMs = 600;
  window.BE.W = W;
  card = (() => {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160; const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(.5, .078), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
    m.renderOrder = 10; world.scene.add(m);
    return { m, set(t) { g.clearRect(0, 0, 1024, 160); if (t) { g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect(8, 20, 1008, 120, 60); g.fill(); g.fillStyle = '#fff'; g.font = '600 46px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 512, 82); } tex.needsUpdate = true; m.visible = !!t; } };
  })();
  ouch = new THREE.Mesh(new THREE.SphereGeometry(.3, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff1a0a, side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false }));
  ouch.renderOrder = 9; world.scene.add(ouch);
  ring = new THREE.Mesh(new THREE.RingGeometry(.012, .016, 32, 1, 0, .01), new THREE.MeshBasicMaterial({ color: 0xffc23a, side: THREE.DoubleSide, depthTest: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 11; ring.visible = false; world.scene.add(ring);
  // corner 1 marker (stays while waiting for corner 2)
  mark1 = new THREE.Mesh(new THREE.RingGeometry(.006, .012, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false }));
  mark1.rotation.x = -Math.PI / 2; mark1.renderOrder = 11; mark1.visible = false; world.scene.add(mark1);
}
let hurtA = 0, mark1;
function xrSay(t, sec = 0) { sayUntil = sec ? performance.now() + sec * 1000 : Infinity; card.set(t); }

// ------------------------------------------------------------------ WebXR hand joints → the 21 points the creatures know (MediaPipe order)
const F = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...F.slice(1).flatMap(f => [`${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])];
function readHands(frame, ref) {
  const out = [];
  for (const src of frame.session.inputSources) {
    if (!src.hand) continue;
    const P = [];
    for (const n of JOINTS) { const j = src.hand.get(n), pose = j && frame.getJointPose(j, ref); if (!pose) break; const p = pose.transform.position; P.push(new V3(p.x, p.y, p.z)); }
    if (P.length === 21) out.push({ P, real: src.handedness === 'left' ? 'L' : 'R', key: src.handedness });
  }
  return out;
}

// ------------------------------------------------------------------ the real room: Meta's scene model gives us the table's height
function tableHeightNear(frame, ref, p) {
  const planes = frame.detectedPlanes; if (!planes) return null;
  let best = null;
  for (const pl of planes) {
    const pose = frame.getPose(pl.planeSpace, ref); if (!pose) continue;
    const y = pose.transform.position.y, o = pl.orientation;
    if (o && o !== 'horizontal' && o !== 'Horizontal') continue;
    if (y < .3 || y > 1.3) continue;                                   // floor + ceiling are not tables
    const d = Math.abs(y - p.y); if (d < .06 && (!best || d < best.d)) best = { d, y, label: pl.semanticLabel || '' };
  }
  return best;
}

// ------------------------------------------------------------------ placing: corner 1 → corner 2 (shared frame) or one touch + wait (solo)
let placed = false, still = null, stillT = 0, c1 = null, c1T = 0, replaceT = 0, frameNow = null;
function touchHold(hands, dt) {
  let tip = null; for (const h of hands) { const t = h.P[8]; if (!tip || t.y < tip.y) tip = t; }
  if (!tip) { ring.visible = false; still = null; stillT = 0; return null; }
  if (still && tip.distanceTo(still) < .006 && tip.y > .3 && tip.y < 1.4) stillT += dt; else { still = tip.clone(); stillT = 0; }
  ring.visible = stillT > .15; ring.position.copy(tip); ring.position.y += .002;
  const k = Math.min(1, stillT / .9);
  ring.geometry.dispose(); ring.geometry = new THREE.RingGeometry(.012, .016, 32, 1, 0, Math.max(.01, k * Math.PI * 2));
  if (k >= 1) { const p = tip.clone(); still = null; stillT = -1.2; ring.visible = false; return p; }
  return null;
}
function placing(frame, ref, hands, dt) {
  const got = touchHold(hands, dt);
  const head = new V3().setFromMatrixPosition(world.renderer.xr.getCamera().matrixWorld);
  const snapY = p => { const t = tableHeightNear(frame, ref, p); if (t) p.y = t.y + .007; return p; };   // fingertip joint sits ~7 mm above the surface
  if (got && !c1) { c1 = snapY(got); c1T = 0; mark1.position.copy(c1); mark1.visible = true; W.sfx.chirp('curious', 1); xrSay('now corner 2 · or wait to play right here'); return; }
  if (got && c1) {
    const c2 = snapY(got), d = Math.hypot(c2.x - c1.x, c2.z - c1.z);
    if (d > .2 && d < .4) { finishPlace(frameFromCorners(c1, c2, .007), true); return; }
    c1 = c2; c1T = 0; mark1.position.copy(c1); xrSay('corner 1 moved · now corner 2'); return;
  }
  if (c1 && (c1T += dt) > 4.5) { const f = frameAt(new V3(c1.x, c1.y - .007, c1.z), head); f.pos.addScaledVector(new V3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), -.12); finishPlace(f, false); }
}
function finishPlace(f, paper) {
  applyFrame(table, f); frameNow = f;
  const first = !placed; placed = true; table.visible = true; ring.visible = false; mark1.visible = false; c1 = null;
  localStorage.setItem('be:table', JSON.stringify({ p: f.pos.toArray(), r: f.yaw, paper }));
  xrSay(paper ? `v${BE.version} · paper found (${(f.measured * 100).toFixed(1)} cm) · EYE code ${code}` : `here they come · EYE code ${code}`, 5);
  W.sfx.chirp('happy', 1);
  if (first && !W.monsters.length) for (let i = 0; i < 3; i++) setTimeout(() => W.addMonster(true, i === 0 ? { kind: 'dragon' } : undefined), 600 + i * 700);
  log('placed', paper ? 'paper' : 'solo', f.measured.toFixed(3), f.err.toFixed(3));
}

// ------------------------------------------------------------------ gestures inside the game
let clapCool = 0; const airPinch = new Map();
function gestures(dt) {
  clapCool -= dt;
  const hs = W.hands.filter(h => !h.stale);
  if (hs.length === 2 && clapCool <= 0 && hs[0].palm.distanceTo(hs[1].palm) < .06 && hs[0].palmN.dot(hs[1].palmN) < -.5) {
    clapCool = 2.5; const m = W.addMonster(true); if (m) W.sfx.chirp('curious', 1);
  }
  for (const h of hs) {
    const near = W.monsters.some(m => m.p.distanceTo(h.pinchPt) < .05) || W.monsters.some(m => m.held === h);
    if (h.pinch && !airPinch.has(h) && !near && h.pinchPt.y > .06) airPinch.set(h, true);
    if (!h.pinch && airPinch.has(h)) { airPinch.delete(h); if (!near) W.dropFood(h.pinchPt.clone()); }
    if (near) airPinch.delete(h);
    if (h.real === 'L' && h.pinch && !h.pinchOwner && !near) { replaceT += dt; if (replaceT > 2) { replaceT = 0; placed = false; table.visible = false; xrSay('touch corner 1 of your paper (or the table) and hold'); } }
    else if (h.real === 'L') replaceT = 0;
  }
}

// ------------------------------------------------------------------ every headset frame
let builds = -1, rebuildT = 0;
function tick(frame, dt) {
  dt = Math.min(.05, dt || .016);
  const now = performance.now();
  const ref = world.xrReferenceSpace, hands = readHands(frame, ref);
  BE.hands = hands; BE.placed = placed; BE.table = table;
  if (BE.q.has('debug') || window.IWER_DEVICE) { BE.planes = []; for (const pl of frame.detectedPlanes || []) { const p = frame.getPose(pl.planeSpace, ref); if (p) BE.planes.push({ y: +p.transform.position.y.toFixed(3), x: +p.transform.position.x.toFixed(2), z: +p.transform.position.z.toFixed(2), o: pl.orientation, l: pl.semanticLabel, n: pl.polygon.length }); } }
  if (!placed) placing(frame, ref, hands, dt);
  else {
    W.takeHands(hands.map(h => ({ ...h, P: h.P.map(p => table.worldToLocal(p.clone())) })), now, .85);
    W.step(now, dt);
    gestures(dt);
  }
  // new creature meshes → let IWSDK's depth occlusion patch them too (re-qualify the table entity)
  if (Monster.builds !== builds && (rebuildT += dt) > .15) {
    builds = Monster.builds; rebuildT = 0;
    tableEnt.removeComponent(DepthOccludable); tableEnt.addComponent(DepthOccludable, { mode: OcclusionShadersMode.SoftOcclusion });
  }
  const xcam = world.renderer.xr.getCamera();
  if (card.m.visible) {
    if (now > sayUntil) card.set('');
    const head = new V3().setFromMatrixPosition(xcam.matrixWorld), fwd = new V3(0, 0, -1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(xcam.matrixWorld)); fwd.y = 0; fwd.normalize();
    const want = head.clone().addScaledVector(fwd, .6); want.y -= .14;
    card.m.position.lerp(want, Math.min(1, dt * 4)); card.m.lookAt(head);
  }
  hurtA = Math.max(0, hurtA - dt * 1.5); ouch.material.opacity = hurtA * .35; ouch.position.setFromMatrixPosition(xcam.matrixWorld);
}

function onStart() {
  $('start').hidden = true;
  const saved = JSON.parse(localStorage.getItem('be:table') || 'null');
  xrSay('touch corner 1 of your paper (or the table) and hold');
  // local-floor stays steady between visits: offer last time's table at once; touching again moves it
  if (saved) {
    finishPlace({ pos: new V3().fromArray(saved.p), yaw: saved.r, measured: 0, err: 0 }, false);
    xrSay(`your table from last time · left pinch 2 s = move it · EYE code ${code}`, 5);
  }
}
