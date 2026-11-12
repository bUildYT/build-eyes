// bUild eYes · EYE = a phone (Chrome on Android, WebXR AR). Walk around the table and see the SAME creatures
// the headset player sees, from your angle — like the old Xperia AR Effect, but shared and alive.
//  1. aim the gold dot at corner 1 of the paper, tap · then corner 2, tap  (the corners marked "1" and "2")
//  2. tap anywhere on the table = drop food there (the creatures are fed on every EYE at once)
import * as THREE from 'three';
import { createWorld } from './world.js';
import { frameFromCorners, applyFrame } from './table.js';
import { joinRoom } from './net.js';
const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);

export async function start(code) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight);
  renderer.xr.enabled = true; const REF = BE.q.get('ref') || 'local'; renderer.xr.setReferenceSpaceType(REF);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  $('app').appendChild(renderer.domElement);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .01, 30);
  const table = new THREE.Group(); table.visible = false; scene.add(table);
  const W = createWorld({ root: table, camera });
  W.vw = 0; window.BE.W = W;

  const hud = (t, s = '') => { $('hud').innerHTML = t + (s ? `<small>${s}</small>` : ''); };
  let linked = false, last = 0;
  const net = joinRoom(code, {
    onState: s => { linked = s === 'linked'; if (s === 'linked') net.send({ t: 'hi', kind: 'phone' }); $('small').textContent = s === 'linked' ? `EYE · ${code}` : s === 'nohost' ? `no headset with code ${code} (yet)` : 'link lost · retrying'; },
    onMsg: m => { if (m.t === 's') { W.applySnap(m); last = performance.now(); } else W.event(m); },
  });

  // the dot = where the phone looks on a real surface (hit test from the screen centre)
  const reticle = new THREE.Mesh(new THREE.RingGeometry(.008, .012, 32), new THREE.MeshBasicMaterial({ color: 0xffc23a, side: THREE.DoubleSide, depthTest: false }));
  reticle.rotation.x = -Math.PI / 2; reticle.renderOrder = 11; reticle.visible = false; scene.add(reticle);
  const m1 = reticle.clone(); m1.material = reticle.material.clone(); m1.material.color.set(0xffffff); m1.visible = false; scene.add(m1);
  let hitSrc = null, hit = null, c1 = null, placed = false;
  const saved = JSON.parse(localStorage.getItem('be:eye:' + code) || 'null');

  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test', REF], optionalFeatures: ['dom-overlay', 'anchors', 'light-estimation'], domOverlay: { root: $('overlay') } });
  await renderer.xr.setSession(session);
  $('start').hidden = true; $('dot').hidden = false; $('realign').hidden = false;
  W.sfx.ctx();
  const viewer = await session.requestReferenceSpace('viewer');
  hitSrc = await session.requestHitTestSource({ space: viewer });
  hud('aim the dot at corner 1 of the paper · tap', 'the corner marked "1" on the headset player\'s side');
  $('realign').onclick = e => { e.stopPropagation(); placed = false; c1 = null; table.visible = false; m1.visible = false; hud('aim the dot at corner 1 · tap'); };

  session.addEventListener('select', () => {
    if (!hit) return;
    const p = hit.clone();
    if (!placed) {
      if (!c1) { c1 = p; m1.position.copy(p); m1.visible = true; hud('now corner 2 · tap'); W.sfx.chirp('curious', 1); return; }
      const d = Math.hypot(p.x - c1.x, p.z - c1.z);
      if (d < .2 || d > .4) { c1 = p; m1.position.copy(p); hud('that was ' + (d * 100).toFixed(0) + ' cm apart — the long edge is 29.7 cm', 'corner 1 set again · now corner 2'); return; }
      const f = frameFromCorners(c1, p, 0); applyFrame(table, f); placed = true; table.visible = true; m1.visible = false;
      W.sfx.chirp('happy', 1); hud(linked ? '' : 'waiting for the headset…', 'tap the table = food');
      return;
    }
    // tap = food at the dot, in table coordinates
    const loc = table.worldToLocal(p.clone()); loc.y = .12;
    net.send({ t: 'food', p: [loc.x, loc.y, loc.z] });
  });
  session.addEventListener('end', () => { net.close(); location.reload(); });

  let prev = 0;
  renderer.setAnimationLoop((t, frame) => {
    const dt = Math.min(.05, prev ? (t - prev) / 1000 : .016); prev = t;
    if (frame && hitSrc) {
      const r = frame.getHitTestResults(hitSrc), ref = renderer.xr.getReferenceSpace();
      const pose = r.length && r[0].getPose(ref);
      if (pose) { const p = pose.transform.position; hit = new V3(p.x, p.y, p.z); BE.hit = hit; reticle.position.copy(hit); reticle.visible = true; } else { hit = null; reticle.visible = false; }
    }
    if (placed) W.puppetStep(performance.now(), dt);
    if (placed && linked && performance.now() - last > 1500) hud('', 'no world from the headset for a moment…');
    renderer.render(scene, camera);
  });
}
