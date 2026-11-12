// bUild mOnster — the shared world: hands, monsters, food, eggs, sparks, sound.
// Used by the camera app (app.js, table = the scene) and the Quest app (xr.js, table = a group placed on your real table).
// Everything here is in TABLE coordinates: metres, y up, table top = 0.
import * as THREE from 'three';
import { Monster, newName } from './monster.js';
import { Dragon } from './dragon.js';
const kindOf = n => (Monster.load(n) || {}).kind;
const V3 = THREE.Vector3;
export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20], [0, 9], [0, 13], [5, 17], [1, 5]];
const hole = new THREE.MeshBasicMaterial({ colorWrite: false });       // writes depth only: your real hand hides what is behind it
const dbgM = new THREE.MeshBasicMaterial({ color: 0x55ddff });

class SFX {
  constructor() { this.on = localStorage.getItem('bm:sound') !== '0'; }
  ctx() { if (!this.c) { this.c = new AudioContext(); this.out = this.c.createGain(); this.out.gain.value = .5; this.out.connect(this.c.destination); } if (this.c.state === 'suspended') this.c.resume(); return this.c; }
  tone(f0, f1, dur, type, vol, q = 6) {
    if (!this.on || !this.c) return; const c = this.ctx(), t = c.currentTime, o = c.createOscillator(), g = c.createGain(), bp = c.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    bp.type = 'bandpass'; bp.frequency.value = (f0 + f1) * .6; bp.Q.value = q;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .01); g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    o.connect(bp).connect(g).connect(this.out); o.start(t); o.stop(t + dur + .05);
  }
  noise(dur, freq, vol) {
    if (!this.on || !this.c) return; const c = this.ctx(), t = c.currentTime, n = c.sampleRate * dur | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2; g.gain.value = vol;
    s.connect(f).connect(g).connect(this.out); s.start(t);
  }
  // every call differs a little (pitch, length, shape): no sound twice the same
  chirp(mood, size) {
    const b = 1400 / Math.sqrt(size) * (.85 + Math.random() * .3), r = () => .8 + Math.random() * .4;
    if (mood === 'curious') { this.tone(b * .8, b * 1.4 * r(), .12 * r(), 'triangle', .12); setTimeout(() => this.tone(b * 1.1, b * 1.6 * r(), .08, 'triangle', .08), 90 * r()); }
    else if (mood === 'angry' || mood === 'attack') { this.tone(b * .35, b * .22 * r(), .18 * r(), 'sawtooth', .16, 3); this.noise(.08, b * .5, .08); }
    else if (mood === 'fear') for (let i = 0; i < 3; i++) setTimeout(() => this.tone(b * 1.6 * r(), b * 1.9, .05, 'square', .06, 8), i * 55 * r());
    else if (mood === 'hurt') { this.tone(b * 1.8, b * .6, .2 * r(), 'square', .13, 4); }
    else if (mood === 'happy') for (let i = 0; i < 2; i++) setTimeout(() => this.tone(b * (1 + i * .3) * r(), b * 1.5 * r(), .07, 'sine', .1), i * 80 * r());
    else this.tone(b * r(), b * .9 * r(), .06 * r(), 'triangle', .05);
  }
  bite(size) { this.noise(.05, 2500 / size, .3); this.tone(900 / size, 300, .06, 'square', .08, 3); }
  clack() { this.noise(.04, 3500, .25); }
  thud(size, v) { this.noise(.06, 400 / size, Math.min(.35, v * .4)); }
  crack() { this.noise(.03, 3000, .2); setTimeout(() => this.noise(.05, 2200, .25), 70 + Math.random() * 60); }
}

export function createWorld({ root, camera, onHurt = () => { }, say = () => { } }) {
  const W = { scene: root, camera, monsters: [], hands: [], foods: [], eggs: [], area: .3, vw: 1, vh: 1, debug: false, palmFlip: localStorage.getItem('bm:palmflip') === '1' };
  const sfx = W.sfx = new SFX();
  // light + the shadow catcher live on the table too
  W.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a68, 1.4); root.add(W.hemi);
  W.sun = new THREE.DirectionalLight(0xffffff, 2.2); W.sun.position.set(.25, 1, .15); W.sun.castShadow = true;
  W.sun.shadow.mapSize.set(2048, 2048); Object.assign(W.sun.shadow.camera, { left: -.6, right: .6, top: .6, bottom: -.6, near: .1, far: 3 }); W.sun.shadow.bias = -.0004; W.sun.shadow.radius = 4;
  root.add(W.sun); W.sun.target.position.set(0, 0, 0); root.add(W.sun.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.ShadowMaterial({ opacity: .42 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);

  // ---------------------------------------------------------------- hands (21 points, MediaPipe order, table coords)
  class Hand {
    constructor() {
      this.pts = Array.from({ length: 21 }, () => new V3()); this.vel = this.pts.map(() => new V3()); this.spd = new Array(21).fill(0);
      this.palm = new V3(); this.palmN = new V3(0, 1, 0); this.palmVel = new V3(); this.pinchPt = new V3(); this.pinchVel = new V3();
      this.fresh = true; this.seen = 0; this.pinch = false; this.palmUp = false;
      this.occ = BONES.map(([a, b]) => { const r = a === 0 && (b === 9 || b === 13) || (a === 5 && b === 17) ? .02 : (a < 5 && b < 5 ? .011 : .009);
        const g = new THREE.CylinderGeometry(r, r, 1, 8); g.translate(0, .5, 0); const m = new THREE.Mesh(g, hole); m.renderOrder = -1; root.add(m); return m; });
      this.balls = this.pts.map((_, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry([4, 8, 12, 16, 20].includes(i) ? .009 : .008, 8, 6), hole); m.renderOrder = -1; root.add(m); return m; });
    }
    set(P, real, now, smooth = .62) {
      const dt = Math.max(.008, (now - this.seen) / 1000), a = this.fresh ? 1 : smooth;
      for (let i = 0; i < 21; i++) {
        const old = this.pts[i].clone(); this.pts[i].lerp(P[i], a);
        if (!this.fresh) { this.vel[i].lerp(new V3().subVectors(this.pts[i], old).multiplyScalar(1 / dt), .5); this.spd[i] = this.vel[i].length(); }
      }
      const p = this.pts, oldPalm = this.palm.clone(), oldPinch = this.pinchPt.clone();
      this.palm.set(0, 0, 0); for (const i of [0, 5, 9, 13, 17]) this.palm.add(p[i]); this.palm.multiplyScalar(.2);
      // right hand: (index base − wrist) × (pinky base − wrist) points OUT of the palm
      const n = new V3().crossVectors(new V3().subVectors(p[5], p[0]), new V3().subVectors(p[17], p[0])).normalize();
      if (real === 'L') n.negate(); if (W.palmFlip) n.negate();
      this.palmN.lerp(n, this.fresh ? 1 : .4).normalize();
      this.palmUp = this.palmN.y > .55; this.real = real;
      const pd = p[4].distanceTo(p[8]); this.pinch = this.pinch ? pd < .045 : pd < .026;
      this.pinchPt.addVectors(p[4], p[8]).multiplyScalar(.5);
      if (!this.fresh) { this.palmVel.lerp(new V3().subVectors(this.palm, oldPalm).multiplyScalar(1 / dt), .5); this.pinchVel.lerp(new V3().subVectors(this.pinchPt, oldPinch).multiplyScalar(1 / dt), .5); }
      this.fresh = false; this.seen = now; this.stale = false;
      BONES.forEach(([a, b], k) => { const m = this.occ[k], d = new V3().subVectors(p[b], p[a]), l = d.length(); m.position.copy(p[a]); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.multiplyScalar(1 / (l || 1))); m.scale.set(1, l || 1e-4, 1); });
      this.balls.forEach((m, i) => { m.position.copy(p[i]); m.material = W.debug ? dbgM : hole; });
    }
    dispose() { for (const m of [...this.occ, ...this.balls]) root.remove(m); this.gone = true; this.pinchOwner = null; }
  }
  // got = [{ P: 21 V3 in table coords, real: 'L'|'R', key? }]   key = a stable id (the Quest knows which hand is which)
  W.takeHands = (got, now, smooth) => {
    const free = new Set(W.hands);
    for (const g of got) {
      let best = null, bd = .16;
      if (g.key) best = W.hands.find(H => H.key === g.key) || null;
      else for (const H of free) { const d = H.pts[0].distanceTo(g.P[0]); if (d < bd) { bd = d; best = H; } }
      if (!best) { best = new Hand(); best.key = g.key; W.hands.push(best); }
      free.delete(best); best.set(g.P, g.real, now, smooth);
    }
  };
  W.ageHands = (now, staleMs = 140, goneMs = 450) => {
    for (const H of W.hands) { const age = now - H.seen; H.stale = age > staleMs; if (age > goneMs) H.dispose(); }
    W.hands = W.hands.filter(H => !H.gone);
  };
  W.nearestHand = p => {
    let best = null;
    for (const H of W.hands) { if (H.stale) continue; for (const i of [4, 8, 12, 16, 20, 0, 5, 9]) { const d = Math.hypot(H.pts[i].x - p.x, H.pts[i].z - p.z) + Math.max(0, H.pts[i].y - .03) * .7; if (!best || d < best.d) best = { d, pt: H.pts[i], speed: H.spd[i], hand: H }; } }
    return best;
  };
  W.nearestMonster = m => { let best = null; for (const o of W.monsters) if (o !== m) { const d = o.p.distanceTo(m.p); if (!best || d < best.d) best = { d, m: o }; } return best; };

  // ---------------------------------------------------------------- food, sparks, hurt
  const foodGeo = new THREE.IcosahedronGeometry(.007, 1), foodMat = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7010, emissiveIntensity: .8, roughness: .4 });
  W.nearestFood = p => { let best = null; for (const f of W.foods) { const d = Math.hypot(f.p.x - p.x, f.p.z - p.z); if (!best || d < best.d) best = { d, f }; } return best; };
  W.removeFood = f => { root.remove(f.mesh); W.foods = W.foods.filter(x => x !== f); };
  W.dropFood = (at) => {
    const H = W.hands.find(h => !h.stale);
    at = at || (H ? H.pts[8].clone() : new V3((Math.random() - .5) * .3, .25, (Math.random() - .5) * .2)); at.y = Math.max(at.y, .05);
    const mesh = new THREE.Mesh(foodGeo, foodMat); mesh.castShadow = true; root.add(mesh);
    W.foods.push({ p: at, v: new V3(), mesh, eaten: 0 });
  };
  const SP = 300, spPos = new Float32Array(SP * 3), spCol = new Float32Array(SP * 3), sparks = [];
  const spGeo = new THREE.BufferGeometry(); spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('color', new THREE.BufferAttribute(spCol, 3));
  const spPts = new THREE.Points(spGeo, new THREE.PointsMaterial({ size: .004, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); spPts.frustumCulled = false; root.add(spPts);
  W.fx = { spark(p, col, n) { const c = new THREE.Color(col); for (let i = 0; i < n; i++) { if (sparks.length >= SP) sparks.shift(); sparks.push({ p: p.clone(), v: new V3(Math.random() - .5, Math.random() * .8 + .2, Math.random() - .5).multiplyScalar(.6 + Math.random() * .6), life: .25 + Math.random() * .3, c }); } } };
  // fire: flames rise and cool from white-gold to red; smoke is faint; the fire lights the creatures + glows on the real table
  const FP = 600, fPos = new Float32Array(FP * 3), fCol = new Float32Array(FP * 3), flames = [];
  const fGeo = new THREE.BufferGeometry(); fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); fGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const fPts = new THREE.Points(fGeo, new THREE.PointsMaterial({ size: .012, map: dotTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); fPts.frustumCulled = false; root.add(fPts);
  const fireLight = new THREE.PointLight(0xff8a3a, 0, .45, 2); root.add(fireLight);
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,170,80,1)'); gr.addColorStop(.4, 'rgba(255,110,30,.45)'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(.3, .3), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); glow.rotation.x = -Math.PI / 2; glow.position.y = .0015; root.add(glow);
  let fireHeat = 0; const fireAt = new V3();
  W.fx.fire = (p, dir, n, L = .06, smoke = false) => {
    for (let i = 0; i < n; i++) {
      if (flames.length >= FP) flames.shift();
      const j = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(smoke ? .02 : .09);
      const life = smoke ? .9 + Math.random() * .6 : .28 + Math.random() * .22;
      flames.push({ p: p.clone(), v: dir.clone().multiplyScalar((smoke ? .04 : .42 + Math.random() * .2) * L / .06).add(j), life, max: life, smoke });
    }
    if (!smoke) { fireHeat = Math.min(1, fireHeat + n * .05); fireAt.copy(p).addScaledVector(dir, .04); }
  };
  function stepFx(dt) {
    for (let i = flames.length - 1; i >= 0; i--) { const f = flames[i]; f.life -= dt; if (f.life <= 0) { flames.splice(i, 1); continue; } f.v.y += (f.smoke ? .02 : .35) * dt; f.v.multiplyScalar(Math.pow(f.smoke ? .7 : .25, dt)); f.p.addScaledVector(f.v, dt); if (f.p.y < .002) { f.p.y = .002; f.v.y = Math.abs(f.v.y) * .2; } }
    for (let i = 0; i < FP; i++) {
      const f = flames[i]; if (!f) { fPos[i * 3 + 1] = -9; continue; }
      fPos[i * 3] = f.p.x; fPos[i * 3 + 1] = f.p.y; fPos[i * 3 + 2] = f.p.z;
      const k = f.life / f.max;
      if (f.smoke) { fCol[i * 3] = fCol[i * 3 + 1] = fCol[i * 3 + 2] = .12 * k; }
      else { fCol[i * 3] = 1.6 * k + .2; fCol[i * 3 + 1] = Math.max(0, 1.3 * k * k + .05); fCol[i * 3 + 2] = Math.max(0, .9 * k * k * k); }
    }
    fGeo.attributes.position.needsUpdate = fGeo.attributes.color.needsUpdate = true;
    fireHeat = Math.max(0, fireHeat - dt * 2.2);
    const flick = fireHeat * (.8 + .4 * Math.random());
    fireLight.intensity = flick * .9; fireLight.position.copy(fireAt);
    glow.material.opacity = flick * .55; glow.position.set(fireAt.x, .0015, fireAt.z); glow.scale.setScalar(.6 + fireAt.y * 4);
  }
  W.stepFx = stepFx;
  W.hurt = a => onHurt(a);

  // ---------------------------------------------------------------- monsters, eggs, babies
  W.addMonster = (fromSky = true, opts) => {
    if (W.monsters.length >= 10) return null;
    if (!opts) { const here = new Set(W.monsters.map(m => m.name)), known = Monster.known().filter(n => !here.has(n)); opts = known.length && Math.random() < .5 ? { name: known[Math.random() * known.length | 0] } : {}; }
    const K = (opts.kind || (opts.name && kindOf(opts.name)) || (opts.baby && opts.baby.kind)) === 'dragon' ? Dragon : Monster;
    const m = new K(root, opts); m.sfx = sfx;
    const a = Math.random() * 6.28;
    m.spawn(opts.at || new V3(Math.cos(a) * W.area * .5, 0, Math.sin(a) * W.area * .4), fromSky);
    W.monsters.push(m); return m;
  };
  W.clear = () => { W.monsters.forEach(m => m.dispose()); W.monsters = []; W.eggs.forEach(e => root.remove(e.mesh)); W.eggs = []; };
  W.layEgg = mom => {
    if (W.monsters.length + W.eggs.length >= 10) return false;
    const g = new THREE.SphereGeometry(1, 20, 14); g.scale(.011, .015, .011); g.translate(0, .014, 0);
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(mom.skinColor).lerp(new THREE.Color(0xf4ecd8), .55), roughness: .35, clearcoat: .7, sheen: 1 });
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; root.add(mesh);
    const back = new V3(0, 0, -.5 * mom.L).applyAxisAngle(new V3(0, 1, 0), mom.yaw);
    const at = new V3(mom.p.x + back.x, 0, mom.p.z + back.z); mesh.position.copy(at);
    W.eggs.push({ mesh, at, mom: mom.name, genes: mom.mem, t: 0, hatch: 25 + Math.random() * 15 });
    say(`${mom.name} laid an egg`, 3); return true;
  };
  W.removeEggNear = p => { const e = W.eggs.find(e => e.at.distanceTo(p) < .02); if (e) { root.remove(e.mesh); W.eggs = W.eggs.filter(x => x !== e); } };
  function hatch(e) {
    root.remove(e.mesh); W.eggs = W.eggs.filter(x => x !== e);
    sfx.crack(); W.fx.spark(e.at.clone().setY(.015), 0xfff2c0, 16);
    const mix = (a, b) => Math.max(0, Math.min(1, (a + b) / 2 + (Math.random() - .5) * .4));
    const g = e.genes, name = newName();
    const baby = W.addMonster(false, { name, at: e.at.clone(), kind: g.kind, baby: { mom: e.mom, kind: g.kind, dskin: g.dskin, size: .42, adult: Math.max(.7, Math.min(1.4, g.size * (.85 + Math.random() * .3))), skin: Math.random() < .8 ? g.skin : Math.random() * 6 | 0,
      aggression: mix(g.aggression, Math.random()), timid: mix(g.timid, Math.random()), curious: mix(g.curious, 1) } });
    if (baby) say(`${name} hatched · child of ${e.mom}`, 4);
  }

  // ---------------------------------------------------------------- one step of the world
  W.step = (now, dt) => {
    W.ageHands(now, W.staleMs, W.goneMs);
    for (const f of W.foods) { if (f.p.y > .007) { f.v.y -= 9.8 * .7 * dt; f.p.addScaledVector(f.v, dt); if (f.p.y < .007) { f.p.y = .007; f.v.set(0, 0, 0); } } f.mesh.position.copy(f.p); f.mesh.rotation.y += dt; }
    for (const e of [...W.eggs]) {
      e.t += dt; const k = e.t / e.hatch;
      const wob = k > .6 ? Math.sin(e.t * (8 + k * 20)) * .25 * (k - .6) / .4 : 0;
      e.mesh.rotation.set(wob, 0, wob * .6); if (k > .85 && Math.random() < dt * 2) sfx.crack();
      if (k >= 1) hatch(e);
    }
    for (const m of W.monsters) m.update(dt, W);
    stepFx(dt);
    for (const H of W.hands) if (!H.pinch) H.pinchOwner = null;
    for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.life -= dt; if (s.life <= 0) { sparks.splice(i, 1); continue; } s.v.y -= 3 * dt; s.p.addScaledVector(s.v, dt); }
    for (let i = 0; i < SP; i++) { const s = sparks[i]; if (s) { spPos.set([s.p.x, s.p.y, s.p.z], i * 3); spCol.set([s.c.r * s.life * 3, s.c.g * s.life * 3, s.c.b * s.life * 3], i * 3); } else spPos.set([0, -9, 0], i * 3); }
    spGeo.attributes.position.needsUpdate = spGeo.attributes.color.needsUpdate = true;
  };
  setInterval(() => W.monsters.forEach(m => m.save()), 5000);
  addEventListener('beforeunload', () => W.monsters.forEach(m => m.save()));
  // ---------------------------------------------------------------- bUild eYes: share the world with other EYEs
  // host: W.snap() ~20×/s → every EYE: W.applySnap(s) + W.puppetStep(dt). Sounds + sparks travel as events (W.onEvent).
  W.onEvent = null;
  const r3 = v => [Math.round(v.x * 1e4) / 1e4, Math.round(v.y * 1e4) / 1e4, Math.round(v.z * 1e4) / 1e4];
  W.snap = () => ({
    t: 's',
    m: W.monsters.map(m => m.snap()),
    f: W.foods.map(f => r3(f.p)),
    e: W.eggs.map(e => [...r3(e.at), Math.round(e.mesh.rotation.x * 100) / 100, Math.round(e.mesh.rotation.z * 100) / 100, e.mesh.material.color.getHex()]),
    h: W.hands.filter(H => !H.stale).map(H => [H.real, ...H.pts.flatMap(r3)]),
  });
  // wrap the sound + spark makers so the host also tells the EYEs
  for (const k of ['chirp', 'bite', 'clack', 'thud', 'crack']) { const f = sfx[k].bind(sfx); sfx[k] = (...a) => { f(...a); if (W.onEvent) W.onEvent({ t: 'snd', k, a }); }; }
  { const f = W.fx.spark; W.fx.spark = (p, col, n) => { f(p, col, n); if (W.onEvent) W.onEvent({ t: 'fx', p: r3(p), c: col, n }); }; }
  { const f = W.fx.fire; W.fx.fire = (p, d, n, L, s) => { f(p, d, n, L, s); if (W.onEvent) W.onEvent({ t: 'fire', p: r3(p), d: r3(d), n, L, s: s ? 1 : 0 }); }; }
  W.event = ev => {                     // an EYE plays what the host sent
    if (ev.t === 'snd' && sfx[ev.k]) sfx[ev.k](...ev.a);
    else if (ev.t === 'fx') W.fx.spark(new V3().fromArray(ev.p), ev.c, ev.n);
    else if (ev.t === 'fire') W.fx.fire(new V3().fromArray(ev.p), new V3().fromArray(ev.d), ev.n, ev.L, !!ev.s);
  };
  let netFood = [], netEggs = [];
  const eggGeo = new THREE.SphereGeometry(1, 20, 14); eggGeo.scale(.011, .015, .011); eggGeo.translate(0, .014, 0);
  W.applySnap = s => { W.last = s; W.lastT = performance.now(); };
  W.puppetStep = (now, dt) => {
    const s = W.last; if (!s) return;
    // creatures: make, follow, forget
    const want = new Map(s.m.map(x => [x.n, x]));
    for (const m of [...W.monsters]) if (!want.has(m.name)) { m.dispose(); W.monsters = W.monsters.filter(x => x !== m); }
    for (const x of s.m) {
      let m = W.monsters.find(o => o.name === x.n);
      if (!m) { m = new (x.g.kind === 'dragon' ? Dragon : Monster)(root, { name: x.n, net: x.g }); m.sfx = null; m.p.fromArray(x.p); m.q.fromArray(x.q); m.yaw = x.y; m.plantFeet(); W.monsters.push(m); }
      m.puppet(dt, W, x);
    }
    // food crumbs + eggs: plain meshes at the host's places
    while (netFood.length < s.f.length) { const mesh = new THREE.Mesh(foodGeo, foodMat); mesh.castShadow = true; root.add(mesh); netFood.push(mesh); }
    while (netFood.length > s.f.length) root.remove(netFood.pop());
    s.f.forEach((p, i) => { netFood[i].position.fromArray(p); netFood[i].rotation.y += dt; });
    while (netEggs.length < s.e.length) { const mesh = new THREE.Mesh(eggGeo, new THREE.MeshPhysicalMaterial({ roughness: .35, clearcoat: .7, sheen: 1 })); mesh.castShadow = true; root.add(mesh); netEggs.push(mesh); Monster.builds++; }
    while (netEggs.length > s.e.length) root.remove(netEggs.pop());
    s.e.forEach((e, i) => { netEggs[i].position.set(e[0], e[1], e[2]); netEggs[i].rotation.set(e[3], 0, e[4]); netEggs[i].material.color.setHex(e[5]); });
    // the player's real hands → invisible depth-only shapes, so they hide creatures on this EYE too
    W.takeHands(s.h.map(h => { const P = []; for (let i = 0; i < 21; i++) P.push(new V3(h[1 + i * 3], h[2 + i * 3], h[3 + i * 3])); return { P, real: h[0], key: h[0] }; }), now, .7);
    W.ageHands(now, 400, 900);
    stepFx(dt);
    for (let i = sparks.length - 1; i >= 0; i--) { const sp = sparks[i]; sp.life -= dt; if (sp.life <= 0) { sparks.splice(i, 1); continue; } sp.v.y -= 3 * dt; sp.p.addScaledVector(sp.v, dt); }
    for (let i = 0; i < SP; i++) { const sp = sparks[i]; if (sp) { spPos.set([sp.p.x, sp.p.y, sp.p.z], i * 3); spCol.set([sp.c.r * sp.life * 3, sp.c.g * sp.life * 3, sp.c.b * sp.life * 3], i * 3); } else spPos.set([0, -9, 0], i * 3); }
    spGeo.attributes.position.needsUpdate = spGeo.attributes.color.needsUpdate = true;
  };
  return W;
}
