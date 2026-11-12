// bUild mOnster — one creature: a body that walks on real legs (planted feet, tripod gait), and a small mind.
// The mind = drives (energy, hunger, curiosity, fear, anger, trust) + what it sees (your hands, food, the others)
// → it picks what to do every quarter second. Trust lives on in localStorage: it REMEMBERS you next time.
import * as THREE from 'three';
const V3 = THREE.Vector3, UP = new V3(0, 1, 0), G = 9.8 * 0.75;
const rand = (a, b) => a + Math.random() * (b - a), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const SYL = ['gr', 'zak', 'mo', 'rix', 'bu', 'lok', 'ki', 'tor', 'vu', 'nem', 'sha', 'drik', 'pa', 'ulm', 'ze', 'kro'];
export const newName = () => { const n = SYL[Math.random() * 16 | 0] + SYL[Math.random() * 16 | 0] + (Math.random() < .5 ? SYL[Math.random() * 16 | 0] : ''); return n[0].toUpperCase() + n.slice(1); };
const SKINS = [
  { body: 0x1b1d22, legs: 0x101114, eye: 0xffc23a },   // black beetle, gold eyes
  { body: 0x3d6b2c, legs: 0x1f3518, eye: 0xd8ff5a },   // toxic green
  { body: 0x7a1f1a, legs: 0x3a0e0b, eye: 0xffe0a0 },   // blood red
  { body: 0x4a2f6e, legs: 0x22163a, eye: 0x7ef9ff },   // violet
  { body: 0xd8cfc0, legs: 0x5a534a, eye: 0xff4a2a },   // bone white
  { body: 0x9a5a1e, legs: 0x3d2208, eye: 0x9cff7a },   // amber
];
const MOOD = { follow: '', nest: '…', wander: '', curious: '?', attack: '!', flee: '!!', sleep: 'zzz', eat: '♥', duel: '⚔', ride: '♥', cling: '!!!', held: '?!', dazed: '@', squashed: '#' };

const cyl = (r0, r1, mat) => { const g = new THREE.CylinderGeometry(r1, r0, 1, 7); g.translate(0, .5, 0); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; };
const seg = (m, a, b) => { const d = new V3().subVectors(b, a), l = d.length(); m.position.copy(a); m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / (l || 1))); m.scale.set(1, l || 1e-4, 1); };

export class Monster {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.name = opts.name || newName();
    const mem = Monster.load(this.name);
    this.mem = mem || { trust: 0.2, hits: 0, bites: 0, fed: 0, born: Date.now(), size: rand(.75, 1.35), skin: Math.random() * SKINS.length | 0,
      aggression: rand(0, 1), timid: rand(0, 1), curious: rand(.3, 1) };
    if (!mem && opts.baby) Object.assign(this.mem, opts.baby, { trust: .5 });   // a child: parent's genes, starts small, trusts you a bit
    if (opts.kind) this.mem.kind = opts.kind;
    if (opts.net) { Object.assign(this.mem, opts.net); this.isPuppet = true; }
    this.met = !!mem;
    this.setSize();
    this.growT = rand(20, 35); this.nestT = 0;
    this.D = { energy: rand(.6, 1), hunger: rand(0, .4), fear: 0, anger: this.mem.aggression * .3, curiosity: this.mem.curious, boredom: 0 };
    this.p = new V3(); this.q = new THREE.Quaternion(); this.yaw = rand(0, 6.28);
    this.vel = new V3(); this.vel3 = new V3(); this.angVel = new V3();
    this.mode = 'walk'; this.act = 'wander'; this.modeT = 0; this.thinkT = 0; this.actT = 0;
    this.goal = new V3(); this.look = null; this.mand = 0; this.crouch = 0; this.squash = 1; this.blinkT = rand(1, 4);
    this.cool = 0; this.chirpT = rand(1, 4); this.held = null; this.lunge = null; this.t = rand(0, 100);
    this.build();
    this.label = document.createElement('div'); this.label.className = 'mlabel'; document.getElementById('labels').appendChild(this.label);
    this.say(this.met ? `${this.name} remembers you` : this.name, 2.5);
  }
  setSize() { const s = this.mem.size; this.L = 0.06 * s; this.hB = 0.24 * this.L; this.maxSpeed = 0.16 * Math.sqrt(Math.max(.6, s)); }
  get baby() { return this.mem.adult && this.mem.size < this.mem.adult - .01; }
  grow() {                                         // babies grow in steps: rebuild the body one size bigger
    this.disposeBody(); this.mem.size = Math.min(this.mem.adult, this.mem.size + .1); this.setSize(); this.build(); this.plantFeet();
    if (!this.baby) this.say(`${this.name} is grown up`, 3); this.save();
  }
  static load(n) { try { return JSON.parse(localStorage.getItem('bm:m:' + n)); } catch (e) { return null; } }
  static known() { const r = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('bm:m:')) r.push(k.slice(5)); } return r; }
  save() { if (this.isPuppet) return; try { localStorage.setItem('bm:m:' + this.name, JSON.stringify(this.mem)); } catch (e) { } }

  build() {
    const L = this.L, sk = SKINS[this.mem.skin % SKINS.length]; this.skinColor = sk.body;
    const skin = new THREE.MeshPhysicalMaterial({ color: sk.body, roughness: .42, metalness: .05, clearcoat: .9, clearcoatRoughness: .22 });
    const legM = new THREE.MeshPhysicalMaterial({ color: sk.legs, roughness: .5, clearcoat: .6, clearcoatRoughness: .3 });
    this.eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: sk.eye, emissiveIntensity: 2.2 });
    this.root = new THREE.Group(); this.scene.add(this.root);
    const bodyG = new THREE.SphereGeometry(1, 36, 24), pos = bodyG.attributes.position, sd = Math.random() * 10;
    for (let i = 0; i < pos.count; i++) {        // lumpy, ridged shell
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + .06 * Math.sin(z * 9 + sd) * (y > 0 ? 1 : .3) + .04 * Math.sin(x * 13 + y * 7 + sd);
      pos.setXYZ(i, x * k, y * k * (y < 0 ? .7 : 1), z * k);
    }
    bodyG.computeVertexNormals();
    const body = new THREE.Mesh(bodyG, skin); body.scale.set(.34 * L, .25 * L, .52 * L); body.position.set(0, .04 * L, -.12 * L); body.castShadow = true;
    this.bodyMesh = body; this.root.add(body);
    this.head = new THREE.Group(); this.head.position.set(0, .03 * L, .36 * L); this.root.add(this.head);
    const hm = new THREE.Mesh(new THREE.SphereGeometry(.21 * L, 24, 16), skin); hm.scale.set(1, .8, 1); hm.castShadow = true; this.head.add(hm);
    this.eyes = [];
    const nEyes = this.mem.skin % 2 ? 4 : 2;
    for (let i = 0; i < nEyes; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry((i < 2 ? .05 : .033) * L, 12, 8), this.eyeM);
      const sx = (i % 2 ? 1 : -1) * (i < 2 ? .09 : .14) * L; e.position.set(sx, (i < 2 ? .08 : .04) * L, (i < 2 ? .17 : .13) * L); this.head.add(e); this.eyes.push(e);
    }
    this.mands = [-1, 1].map(sd => {
      const g = new THREE.ConeGeometry(.035 * L, .2 * L, 6); g.rotateX(Math.PI / 2); g.translate(0, 0, .1 * L);
      const m = new THREE.Mesh(g, legM); m.position.set(sd * .07 * L, -.06 * L, .15 * L); m.castShadow = true; m.userData.sd = sd; this.head.add(m); return m;
    });
    this.antennae = [-1, 1].map(sd => {
      const parts = [0, 1, 2].map(() => { const c = cyl(.012 * L, .006 * L, legM); this.scene.add(c); return c; });
      return { sd, parts, ph: rand(0, 6) };
    });
    for (let i = 0; i < 5; i++) {                // spikes along the back
      const c = new THREE.Mesh(new THREE.ConeGeometry(.04 * L, (.16 - Math.abs(i - 2) * .03) * L, 6), legM);
      c.position.set(0, .26 * L - Math.abs(i - 2) * .02 * L, (.18 - i * .14) * L); c.rotation.x = -.5; c.castShadow = true; this.root.add(c);
    }
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1, row = [.22, -.02, -.26][i >> 1];
      const leg = { side, group: (i === 0 || i === 3 || i === 4) ? 0 : 1,
        hip: new V3(side * .22 * L, 0, row * L), rest: new V3(side * .78 * L, 0, row * 1.45 * L + .05 * L),
        a: cyl(.045 * L, .032 * L, legM), b: cyl(.032 * L, .012 * L, legM), foot: new V3(), from: new V3(), to: new V3(), st: -1, l1: .5 * L, l2: .62 * L, ph: rand(0, 6) };
      this.scene.add(leg.a, leg.b); this.legs.push(leg);
    }
    Monster.builds++;                              // new meshes: the headset re-applies depth occlusion
  }

  disposeBody() {
    this.scene.remove(this.root); for (const l of this.legs) this.scene.remove(l.a, l.b);
    for (const a of this.antennae) for (const c of a.parts) this.scene.remove(c);
  }
  dispose() { this.disposeBody(); this.label.remove(); this.save(); }

  say(txt, sec = 1.5) { this.labelTxt = txt; this.labelT = sec; }

  spawn(at, fromSky) {
    this.p.copy(at); this.p.y = fromSky ? 0.35 : this.hB;
    this.q.setFromAxisAngle(UP, this.yaw);
    if (fromSky) { this.mode = 'air'; this.vel3.set(0, 0, 0); this.angVel.set(rand(-4, 4), rand(-4, 4), rand(-4, 4)); }
    this.plantFeet();
  }
  plantFeet() { for (const l of this.legs) { l.foot.copy(l.rest).applyQuaternion(this.q).add(this.p); l.foot.y = 0; l.st = -1; } }

  // ---------------------------------------------------------------- the mind
  think(W) {
    const D = this.D, M = this.mem, h = W.nearestHand(this.p), food = W.nearestFood(this.p), other = W.nearestMonster(this);
    const near = h ? clamp(1 - h.d / 0.35, 0, 1) : 0, low = h ? h.pt.y < 0.09 : false, fast = h ? h.speed > 0.35 : false;
    const U = {
      wander: .25 + D.boredom * .3,
      curious: h ? D.curiosity * (1 - D.fear) * near * (fast ? .3 : 1) * (.6 + M.trust * .6) : 0,
      attack: h && low ? clamp(D.anger * .9 + M.aggression * .45 - D.fear * .7 - M.trust * .3, 0, 2) * (h.d < 0.3 ? 1 : 0) : 0,
      flee: h ? D.fear * (h.d < 0.16 ? 1.3 : .2) * (fast ? 1.4 : 1) : 0,
      sleep: D.energy < .15 ? 1.2 : 0,
      eat: food ? D.hunger * 1.4 * clamp(1 - food.d / 0.5, .3, 1) : 0,
      duel: other && !this.baby && !other.m.baby && other.m.mem.mom !== this.name && this.mem.mom !== other.m.name && other.d < 0.14 ? (D.anger + M.aggression * .5) * .8 * (other.m.mode === 'walk' ? 1 : 0) : 0,
      follow: this.baby && this.mom() ? clamp((this.mom().p.distanceTo(this.p) - .07) * 8, 0, .9) * (1 - D.fear * .5) : 0,
      nest: !this.baby && (M.eggFed || 0) >= 2 && M.trust > .45 && D.hunger < .35 && D.energy > .4 && !W.eggs.some(e => e.mom === this.name) ? 1.5 : 0,
      ride: h && h.hand.palmUp && h.hand.palm.y < 0.08 ? clamp(M.trust - .2, 0, 1) * 2.6 * (1 - D.fear) : 0,
    };
    // a hand near its egg makes a parent angry
    if (h && W.eggs.some(e => e.mom === this.name && Math.hypot(e.at.x - h.pt.x, e.at.z - h.pt.z) < .08 && h.pt.y < .06)) { D.anger = Math.min(1.5, D.anger + .12); U.attack += .4; }
    U[this.act] = (U[this.act] || 0) + .12;           // a bit stubborn: no flickering between plans
    let best = 'wander'; for (const k in U) if (U[k] > U[best]) best = k;
    if (best !== this.act) {
      this.act = best; this.actT = 0;
      if (best === 'attack') { this.chirp('angry'); this.say('!', 1); }
      else if (best === 'flee') this.chirp('fear');
      else if (best === 'curious') this.chirp('curious');
      else if (best === 'sleep') this.say('zzz', 3);
      else if (best === 'ride' || best === 'follow') this.chirp('happy');
      else if (best === 'nest') { this.nestT = 0; this.say('…', 2.5); }
      if (best === 'wander') this.pickGoal(W);
    }
    this.hand = h; this.food = food; this.other = other;
  }
  mom() { return this.mem.mom && this.W ? this.W.monsters.find(m => m.name === this.mem.mom) : null; }
  pickGoal(W) { const a = rand(0, 6.28), r = Math.sqrt(Math.random()) * W.area; this.goal.set(Math.cos(a) * r * 1.3, 0, Math.sin(a) * r); this.pause = Math.random() < .35 ? rand(.5, 2.5) : 0; }

  chirp(mood) { if (this.sfx) this.sfx.chirp(mood, this.mem.size); }

  // ---------------------------------------------------------------- one frame
  update(dt, W) {
    this.t += dt; this.modeT += dt; this.actT += dt; this.cool -= dt;
    const D = this.D;
    D.fear = Math.max(0, D.fear - dt * .08); D.anger = Math.max(this.mem.aggression * .15, D.anger - dt * .03);
    D.hunger = Math.min(1, D.hunger + dt * .006); D.boredom = Math.min(1, D.boredom + dt * .01);
    D.energy = clamp(D.energy + dt * (this.act === 'sleep' ? .08 : -.004 - this.vel.length() * .03), 0, 1);
    if ((this.thinkT -= dt) <= 0 && this.mode === 'walk') { this.thinkT = .25; this.think(W); }
    if (this.act === 'sleep' && D.energy > .9) { this.act = 'wander'; this.pickGoal(W); }
    // calm hands near me = trust grows; that is how it learns you are safe
    if (this.hand && this.hand.d < 0.2 && this.hand.speed < 0.15 && this.mode === 'walk') this.mem.trust = Math.min(1, this.mem.trust + dt * .012);

    this.W = W;
    if (this.baby && this.mode === 'walk' && (this.growT -= dt) <= 0) { this.growT = rand(25, 40); this.grow(); }
    this.handContacts(W);
    if (this.mode === 'walk') this.walk(dt, W);
    else if (this.mode === 'air') this.fly(dt, W);
    else if (this.mode === 'dazed' || this.mode === 'squashed') this.lie(dt, W);
    else if (this.mode === 'held' || this.mode === 'cling' || this.mode === 'ride') this.carried(dt, W);

    if ((this.chirpT -= dt) <= 0) { this.chirpT = rand(3, 9); if (this.act !== 'sleep' && Math.random() < .5) this.chirp(this.act === 'attack' ? 'angry' : this.act === 'flee' ? 'fear' : 'idle'); }
    this.pose(dt, W);
    this.labelT -= dt;
  }

  handContacts(W) {
    if (this.cool > 0) return;
    const r = .3 * this.L + .012;
    for (const H of W.hands) {
      if (H.stale) continue;
      // pinch = pick it up (thumb + index together near its back)
      if (H.pinch && !H.pinchOwner && this.mode !== 'held' && H.pinchPt.distanceTo(this.p) < r + .02) {
        this.mode = 'held'; this.held = H; H.pinchOwner = this; this.modeT = 0; this.chirp(this.mem.trust > .5 ? 'happy' : 'fear');
        this.D.fear += this.mem.timid * .3; return;
      }
      if (this.mode === 'held' || this.mode === 'cling' || this.mode === 'ride') continue;
      // a fast hand through it = a hit
      for (let i = 0; i < 21; i++) {
        if (H.spd[i] < .45 || H.pts[i].distanceTo(this.p) > r) continue;
        const v = H.vel[i];
        this.mode = 'air'; this.modeT = 0; this.lunge = null;
        this.vel3.copy(v).multiplyScalar(1.15); this.vel3.y = Math.max(this.vel3.y, 0) + .35 + H.spd[i] * .4;
        this.angVel.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(6 + H.spd[i] * 8);
        this.D.fear += this.mem.timid * .55; this.D.anger += this.mem.aggression * .6; this.mem.hits++; this.mem.trust = Math.max(0, this.mem.trust - .12);
        this.chirp('hurt'); W.fx.spark(this.p, 0xffffff, 10); this.cool = .3; this.say('!!', 1); return;
      }
      // a palm pressing down on it = squashed
      if (this.mode === 'walk' && Math.hypot(H.palm.x - this.p.x, H.palm.z - this.p.z) < .45 * this.L && H.palm.y < this.hB + .025 && H.palmVel.y < .05) {
        this.mode = 'squashed'; this.modeT = 0; this.D.anger += this.mem.aggression * .8; this.D.fear += this.mem.timid * .4; this.mem.trust = Math.max(0, this.mem.trust - .1);
        this.chirp('hurt'); this.cool = .5; this.say('#', 1.2); return;
      }
    }
  }

  steerTo(target, speed, stopAt = 0) {
    const d = new V3(target.x - this.p.x, 0, target.z - this.p.z), l = d.length();
    if (l < stopAt + .004) return new V3();
    return d.multiplyScalar(speed * Math.min(1, (l - stopAt) / .04) / l);
  }

  walk(dt, W) {
    const D = this.D, h = this.hand, sp = this.maxSpeed;
    let dv = new V3(); this.look = null; let mand = 0, crouch = 0;
    switch (this.act) {
      case 'wander':
        if (this.pause > 0) { this.pause -= dt; if (Math.random() < dt * .5) this.look = this.p.clone().add(new V3(rand(-1, 1), 0, rand(-1, 1))); }
        else { dv = this.steerTo(this.goal, sp * .45, .01); if (dv.lengthSq() < 1e-8) this.pickGoal(W); }
        break;
      case 'curious':
        if (h) { dv = this.steerTo(h.pt, sp * .5, .055); this.look = h.pt; mand = .2 + .2 * Math.sin(this.t * 9); D.curiosity = Math.max(0, D.curiosity - dt * .02); D.boredom = 0; }
        break;
      case 'attack':
        if (h) {
          this.look = h.pt; mand = .7;
          const hd = Math.hypot(h.pt.x - this.p.x, h.pt.z - this.p.z);
          if (hd < 0.075 + .3 * this.L && h.pt.y < 0.07) {
            crouch = 1;
            if ((this.windup = (this.windup || 0) + dt) > .28) { this.windup = 0; this.jumpAt(h.pt.clone(), 'bite'); return; }
          } else { this.windup = 0; dv = this.steerTo(h.pt, sp * 1.05, .05); }
        }
        break;
      case 'flee':
        if (h) { const a = new V3(this.p.x - h.pt.x, 0, this.p.z - h.pt.z).normalize(); dv = a.multiplyScalar(sp * 1.2); }
        break;
      case 'sleep': crouch = .8; break;
      case 'follow': { const m = this.mom(); if (m) { dv = this.steerTo(m.p, sp * .9, .05 + .4 * m.L); this.look = m.p; } break; }
      case 'nest':
        crouch = .6; this.nestT += dt; this.look = null;
        if (this.nestT > 2.5) { if (W.layEgg(this)) { this.mem.eggFed = 0; this.chirp('happy'); } this.act = 'wander'; this.pickGoal(W); }
        break;
      case 'eat':
        if (this.food) {
          dv = this.steerTo(this.food.f.p, sp * .7, .3 * this.L); this.look = this.food.f.p;
          if (this.food.d < .3 * this.L + .012 && this.food.f.p.y < .01) {
            mand = .5 + .5 * Math.sin(this.t * 22); this.food.f.eaten += dt;
            if (this.food.f.eaten > 1.6) { W.removeFood(this.food.f); D.hunger = 0; D.energy = Math.min(1, D.energy + .3); this.mem.fed++; this.mem.eggFed = (this.mem.eggFed || 0) + 1; this.mem.trust = Math.min(1, this.mem.trust + .12); this.chirp('happy'); this.say('♥', 1.5); this.act = 'wander'; }
          }
        }
        break;
      case 'duel': {
        const o = this.other; if (!o) break;
        this.look = o.m.p; mand = .8;
        if (o.d < .45 * (this.L + o.m.L)) { crouch = 1; if ((this.windup = (this.windup || 0) + dt) > .35) { this.windup = 0; this.jumpAt(o.m.p.clone(), 'duel', o.m); return; } }
        else { const tan = new V3(-(o.m.p.z - this.p.z), 0, o.m.p.x - this.p.x).normalize().multiplyScalar(sp * .3); dv = this.steerTo(o.m.p, sp * .5, .4 * (this.L + o.m.L)).add(tan); }
        break;
      }
      case 'ride':
        if (h && h.hand.palmUp) {
          const pc = h.hand.palm; this.look = pc; dv = this.steerTo(pc, sp * .6, .03);
          if (Math.hypot(pc.x - this.p.x, pc.z - this.p.z) < .05 && pc.y < .08) { this.jumpAt(pc.clone(), 'ride', h.hand); return; }
        }
        break;
    }
    // stay on the table, keep a little apart from the others
    const r = Math.hypot(this.p.x / 1.3, this.p.z);
    if (r > W.area) dv.add(new V3(-this.p.x, 0, -this.p.z).normalize().multiplyScalar(sp * .6 * (r - W.area) / .05));
    for (const o of W.monsters) if (o !== this && o.mode === 'walk') {
      const d = new V3(this.p.x - o.p.x, 0, this.p.z - o.p.z), l = d.length(), m = .4 * (this.L + o.L);
      if (l < m && l > 1e-5 && this.act !== 'duel') dv.add(d.multiplyScalar(sp * (m - l) / m / l));
    }
    this.vel.lerp(dv, Math.min(1, dt * 7));
    this.p.x += this.vel.x * dt; this.p.z += this.vel.z * dt;
    const spd = this.vel.length();
    let want = this.yaw;
    if (this.look) want = Math.atan2(this.look.x - this.p.x, this.look.z - this.p.z);
    else if (spd > .01) want = Math.atan2(this.vel.x, this.vel.z);
    if (this.act === 'flee' && spd > .01) want = Math.atan2(this.vel.x, this.vel.z);
    let dy = ((want - this.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.yawRate = clamp(dy * 8, -7, 7); this.yaw += this.yawRate * dt;
    this.crouch += (crouch - this.crouch) * Math.min(1, dt * 10); this.mand += (mand - this.mand) * Math.min(1, dt * 14);
    const breath = Math.sin(this.t * 2.2) * .01 * this.L, bob = Math.abs(Math.sin(this.t * 18)) * .025 * this.L * Math.min(1, spd / this.maxSpeed);
    this.p.y = this.hB * (1 - .45 * this.crouch) + breath + bob + (this.act === 'sleep' ? -.06 * this.L : 0);
    const pitch = this.crouch * .18 - (this.act === 'sleep' ? .08 : 0);
    this.q.setFromEuler(new THREE.Euler(pitch, this.yaw, -clamp(this.yawRate * spd * .8, -.2, .2), 'YXZ'));
    this.stepLegs(dt, spd);
  }

  jumpAt(target, kind, who) {
    const T = kind === 'ride' ? .35 : .26, d = new V3().subVectors(target, this.p);
    if (kind === 'bite') d.y += .006;
    this.vel3.copy(d).multiplyScalar(1 / T); this.vel3.y += .5 * G * T;
    this.angVel.set(0, 0, 0); this.mode = 'air'; this.modeT = 0; this.lunge = { kind, who, done: false };
    this.chirp(kind === 'ride' ? 'happy' : 'attack'); this.mand = 1;
  }

  fly(dt, W) {
    this.vel3.y -= G * dt; this.p.addScaledVector(this.vel3, dt);
    const w = this.angVel.length();
    if (w > 1e-4) { const dq = new THREE.Quaternion().setFromAxisAngle(this.angVel.clone().multiplyScalar(1 / w), w * dt); this.q.premultiply(dq); }
    this.angVel.multiplyScalar(Math.pow(.6, dt));
    const L = this.lunge;
    if (L && !L.done) {
      if (L.kind === 'bite') {
        for (const H of W.hands) if (!H.stale) for (let i = 0; i < 21; i++) if (H.pts[i].distanceTo(this.p) < .3 * this.L + .016) {
          L.done = true; this.bite(W, H, i);
          if (this.mode !== 'air') return;
          this.vel3.multiplyScalar(-.25); this.vel3.y = .4; break;
        }
      } else if (L.kind === 'duel' && L.who && L.who.p.distanceTo(this.p) < .4 * (this.L + L.who.L)) {
        L.done = true; const o = L.who, push = this.vel3.clone(); push.y = .5;
        if (o.mode === 'walk') { o.mode = 'air'; o.modeT = 0; o.vel3.copy(push.multiplyScalar(.8 * this.L / o.L)); o.angVel.set(rand(-8, 8), rand(-3, 3), rand(-8, 8)); o.D.fear += .3; o.D.anger += .25; o.chirp('hurt'); }
        W.fx.spark(o.p, 0xffeedd, 8); this.vel3.multiplyScalar(-.3); this.vel3.y = .3; this.D.anger = Math.max(0, this.D.anger - .3);
        if (W.sfx) W.sfx.clack(this.mem.size);
      } else if (L.kind === 'ride' && L.who && L.who.palm.distanceTo(this.p) < .035) { this.mode = 'ride'; this.held = L.who; this.modeT = 0; this.say('♥', 2); return; }
    }
    const onTable = Math.hypot(this.p.x / 1.3, this.p.z) < W.area * 1.9;
    const floor = .14 * this.L;
    if (onTable && this.p.y < floor && this.vel3.y < 0) {
      this.p.y = floor;
      if (this.vel3.y < -.45) { this.vel3.y *= -.32; this.vel3.x *= .55; this.vel3.z *= .55; this.angVel.multiplyScalar(.45); if (W.sfx) W.sfx.thud(this.mem.size, -this.vel3.y); }
      else {
        const lunged = this.lunge && this.lunge.kind !== 'hit';
        this.vel3.set(0, 0, 0); this.lunge = null;
        // landed on its feet after its own jump = keeps going; thrown = lies there a moment
        const up = new V3(0, 1, 0).applyQuaternion(this.q);
        if (lunged && up.y > .5) this.toWalk();
        else { this.mode = 'dazed'; this.modeT = 0; this.dazeFor = rand(.6, 1.6) * (1.3 - this.mem.size * .3); this.say('@', this.dazeFor); }
      }
    }
    if (this.p.y < -.7) { this.vel3.set(0, 0, 0); const a = rand(0, 6.28); this.spawn(new V3(Math.cos(a) * W.area * .5, 0, Math.sin(a) * W.area * .4), true); this.say('again!', 1.2); }
    this.stepLegs(dt, 0, true);
  }

  bite(W, H, i) {
    this.mem.bites++; W.fx.spark(H.pts[i], 0xff3020, 14); W.hurt(.35); if (W.sfx) W.sfx.bite(this.mem.size);
    this.D.anger = Math.max(0, this.D.anger - .25); this.say('!', .8);
    if (this.mem.aggression > .55 && Math.random() < .55) {         // holds on to the finger: shake it off!
      this.mode = 'cling'; this.held = H; this.clingIdx = i; this.modeT = 0; this.clingOff = new V3().subVectors(this.p, H.pts[i]).clampLength(0, .2 * this.L);
    }
  }

  toWalk() {
    const f = new V3(0, 0, 1).applyQuaternion(this.q); f.y = 0;
    if (f.lengthSq() > 1e-4) this.yaw = Math.atan2(f.x, f.z);
    this.mode = 'walk'; this.modeT = 0; this.vel.set(0, 0, 0); this.p.y = this.hB; this.q.setFromAxisAngle(UP, this.yaw); this.plantFeet(); this.thinkT = 0;
  }

  lie(dt, W) {
    if (this.mode === 'squashed') {
      this.squash = this.modeT < 1 ? .38 : Math.min(1, this.squash + dt * 3);
      this.p.y = this.hB * this.squash * .7;
      if (this.modeT > 1.3) { this.squash = 1; this.toWalk(); this.act = this.D.anger > this.D.fear ? 'attack' : 'flee'; this.chirp(this.act === 'attack' ? 'angry' : 'fear'); }
      this.stepLegs(dt, 0); return;
    }
    if (this.modeT > (this.dazeFor || 1)) {          // turn itself upright
      const f = new V3(0, 0, 1).applyQuaternion(this.q); f.y = 0; const yaw = f.lengthSq() > 1e-4 ? Math.atan2(f.x, f.z) : this.yaw;
      const target = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
      this.q.slerp(target, Math.min(1, dt * 7)); this.p.y += (this.hB - this.p.y) * Math.min(1, dt * 7);
      if (this.q.angleTo(target) < .08) this.toWalk();
    }
    this.stepLegs(dt, 0, true);
  }

  carried(dt, W) {
    const H = this.held;
    if (!H || H.gone) { this.drop(new V3()); return; }
    if (this.mode === 'held') {
      if (!H.pinch) { this.drop(H.pinchVel.clone()); H.pinchOwner = null; return; }
      this.p.copy(H.pinchPt).addScaledVector(UP, -.12 * this.L);
      const f = new V3(0, 0, 1).applyQuaternion(this.q); f.y = 0;
      const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.9 + Math.sin(this.t * 7) * .15, Math.atan2(f.x, f.z) + dt * .5, Math.sin(this.t * 9) * .2, 'YXZ'));
      this.q.slerp(want, Math.min(1, dt * 6));
      if (Math.random() < dt * .6) this.chirp(this.mem.trust > .5 ? 'happy' : 'fear');
    } else if (this.mode === 'cling') {
      const i = this.clingIdx;
      if (H.spd[i] > 1.0 || H.stale || this.modeT > 4) { this.drop(H.vel[i].clone().multiplyScalar(1.2)); this.angVel.set(rand(-12, 12), rand(-12, 12), rand(-12, 12)); this.chirp('hurt'); return; }
      this.p.copy(H.pts[i]).add(this.clingOff);
      const toF = new V3().subVectors(H.pts[i], this.p); if (toF.lengthSq() > 1e-8) this.q.setFromUnitVectors(new V3(0, 0, 1), toF.normalize());
      this.mand = .5 + .5 * Math.sin(this.t * 25);
      if ((this.gnaw = (this.gnaw || 0) + dt) > .55) { this.gnaw = 0; W.fx.spark(H.pts[i], 0xff3020, 5); W.hurt(.15); if (W.sfx) W.sfx.bite(this.mem.size * 1.3); }
    } else if (this.mode === 'ride') {
      if (!H.palmUp || H.stale) { this.drop(H.palmVel.clone()); return; }
      this.p.copy(H.palm).addScaledVector(H.palmN, this.hB * .9);
      const f = new V3(0, 0, 1).applyQuaternion(this.q), up = H.palmN.clone();
      f.addScaledVector(up, -f.dot(up)).normalize();
      const m = new THREE.Matrix4().makeBasis(new V3().crossVectors(up, f), up, f);
      this.q.slerp(new THREE.Quaternion().setFromRotationMatrix(m), Math.min(1, dt * 8));
      this.mem.trust = Math.min(1, this.mem.trust + dt * .01);
      if (Math.random() < dt * .3) this.chirp('happy');
    }
    this.stepLegs(dt, 0, this.mode !== 'ride');
  }
  drop(v) { this.mode = 'air'; this.modeT = 0; this.held = null; this.lunge = { kind: 'hit', done: true }; this.vel3.copy(v); this.angVel.set(rand(-3, 3), rand(-2, 2), rand(-3, 3)); }

  // ---------------------------------------------------------------- legs: feet stay where they stepped
  stepLegs(dt, spd, flail = false) {
    const busy = [false, false];
    for (const l of this.legs) if (l.st >= 0) busy[l.group] = true;
    const stepT = clamp(.13 * Math.sqrt(this.mem.size) * (this.maxSpeed / Math.max(spd, .04)) ** .35, .07, .18);
    const lead = this.vel.clone().multiplyScalar(stepT * 1.4);
    for (const l of this.legs) {
      if (flail) {                                  // in the air / held: legs wave in the body's own frame
        const w = this.mode === 'dazed' ? 4 : 14;
        const loc = l.rest.clone().add(new V3(0, -.1 * this.L + Math.sin(this.t * w + l.ph) * .2 * this.L, Math.cos(this.t * w * .8 + l.ph) * .18 * this.L));
        loc.x *= .8; l.foot.copy(loc.applyQuaternion(this.q).add(this.p)); l.st = -1; continue;
      }
      if (this.mode === 'ride') { l.foot.copy(l.rest).add(new V3(0, -this.hB * .95, 0)).applyQuaternion(this.q).add(this.p); continue; }
      const want = new V3().copy(l.rest).applyAxisAngle(UP, this.yaw).add(new V3(this.p.x, 0, this.p.z)).add(lead); want.y = 0;
      if (l.st >= 0) {
        l.st += dt / stepT;
        const k = Math.min(1, l.st), e = k * k * (3 - 2 * k);
        l.foot.lerpVectors(l.from, l.to, e); l.foot.y = Math.sin(Math.PI * k) * .22 * this.L;
        if (k >= 1) { l.st = -1; l.foot.y = 0; }
      } else {
        const far = l.foot.distanceTo(want), stride = spd > .02 ? .3 * this.L : .12 * this.L;
        if (far > stride && !busy[1 - l.group] && (spd > .02 || this.modeT > .2)) { l.st = 0; l.from.copy(l.foot); l.to.copy(want); busy[l.group] = true; }
        if (far > 1.5 * this.L) { l.foot.copy(want); }
      }
    }
  }

  pose(dt, W) {
    this.root.position.copy(this.p); this.root.quaternion.copy(this.q);
    this.root.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash));
    const L = this.L;
    for (const l of this.legs) {                     // two-bone IK, knee up and out
      const hip = l.hip.clone().applyQuaternion(this.q).add(this.p), d = new V3().subVectors(l.foot, hip);
      let dist = d.length(); const reach = (l.l1 + l.l2) * .999; if (dist > reach) { d.multiplyScalar(reach / dist); dist = reach; }
      const foot = hip.clone().add(d), dir = d.clone().normalize();
      const a = (l.l1 * l.l1 - l.l2 * l.l2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, l.l1 * l.l1 - a * a));
      const out = new V3(l.side, 0, 0).applyQuaternion(this.q).multiplyScalar(.3).add(new V3(0, 1, 0).applyQuaternion(this.q));
      out.addScaledVector(dir, -out.dot(dir)).normalize();
      const knee = hip.clone().addScaledVector(dir, a).addScaledVector(out, hh);
      seg(l.a, hip, knee); seg(l.b, knee, foot);
    }
    // head turns to what it looks at; mandibles; blinking; antennae with lag
    let hy = 0;
    if (this.look) { const inv = this.q.clone().invert(), lp = this.look.clone().sub(this.p).applyQuaternion(inv); hy = clamp(Math.atan2(lp.x, lp.z), -.6, .6); }
    this.head.rotation.y += (hy - this.head.rotation.y) * Math.min(1, dt * 8);
    for (const m of this.mands) m.rotation.y = m.userData.sd * (.15 + this.mand * .55);
    this.blinkT -= dt; const blink = this.blinkT < .1 ? .15 : 1; if (this.blinkT < 0) this.blinkT = rand(1.5, 5);
    const sleepy = this.act === 'sleep' && this.mode === 'walk' ? .1 : 1;
    for (const e of this.eyes) e.scale.y = blink * sleepy;
    this.eyeM.emissiveIntensity = 2.2 * (this.act === 'attack' || this.mode === 'cling' ? 1.6 : 1) * (sleepy < 1 ? .3 : 1);
    const hw = new THREE.Matrix4().multiplyMatrices(this.root.matrixWorld.compose(this.root.position, this.root.quaternion, this.root.scale), this.head.matrix.compose(this.head.position, this.head.quaternion, this.head.scale));
    const excited = this.act === 'curious' || this.act === 'attack' ? 1 : .35;
    for (const A of this.antennae) {
      let p0 = new V3(A.sd * .08 * L, .14 * L, .12 * L).applyMatrix4(hw);
      let dir = new V3(A.sd * .45, .7, .6).normalize();
      for (let k = 0; k < 3; k++) {
        const wob = Math.sin(this.t * (6 + excited * 10) + A.ph + k) * .35 * excited - (this.yawRate || 0) * .05 * A.sd;
        const dl = dir.clone().applyAxisAngle(new V3(0, 1, 0), wob).applyAxisAngle(new V3(1, 0, 0), .35 * k).applyQuaternion(this.head.quaternion).applyQuaternion(this.q);
        const p1 = p0.clone().addScaledVector(dl, .17 * L); seg(A.parts[k], p0, p1); p0 = p1;
      }
    }
    // the label floating over it (only when it has something to say)
    const show = this.labelT > 0 ? this.labelTxt : MOOD[this.mode === 'walk' ? this.act : this.mode] || '';
    if (show !== this._shown) { this.label.textContent = show; this._shown = show; }
    const sp = this.p.clone().add(new V3(0, .5 * L, 0)).project(W.camera);
    this.label.style.transform = `translate(${(sp.x * .5 + .5) * W.vw}px, ${(-sp.y * .5 + .5) * W.vh}px) translate(-50%, -100%)`;
    this.label.style.opacity = show && sp.z < 1 && W.vw > 1 ? 1 : 0;
  }
  // ---------------------------------------------------------------- bUild eYes: the same creature on another EYE (phone, tablet, laptop)
  // The host runs the mind; here only the body follows: position + turn glide to the host's, legs step by themselves.
  snap() {
    const r = x => Math.round(x * 1e4) / 1e4;
    return { n: this.name, p: this.p.toArray().map(r), q: this.q.toArray().map(r), y: r(this.yaw), m: this.mode, a: this.act,
      c: r(this.crouch), d: r(this.mand), s: r(this.squash), l: this.look ? this.look.toArray().map(r) : 0,
      g: { size: this.mem.size, skin: this.mem.skin, adult: this.mem.adult, mom: this.mem.mom, kind: this.mem.kind, dskin: this.mem.dskin } };
  }
  puppet(dt, W, s) {
    this.t += dt; this.modeT = s.m === this.mode ? this.modeT + dt : 0;
    this.mode = s.m; this.act = s.a;
    if (Math.abs(s.g.size - this.mem.size) > .005) { this.disposeBody(); this.mem.size = s.g.size; this.setSize(); this.build(); this.p.fromArray(s.p); this.plantFeet(); }
    const k = Math.min(1, dt * 14), old = this.p.clone(), tp = new V3().fromArray(s.p);
    if (old.distanceTo(tp) > .25 * this.L * 20) this.p.copy(tp); else this.p.lerp(tp, k);
    this.q.slerp(new THREE.Quaternion().fromArray(s.q), k);
    let dy = s.y - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); this.yawRate = dy / Math.max(dt, 1e-3) * k; this.yaw += dy * k;
    this.vel.subVectors(this.p, old).multiplyScalar(1 / Math.max(dt, 1e-3)); this.vel.y = 0;
    this.crouch = s.c; this.mand = s.d; this.squash = s.s; this.look = s.l ? new V3().fromArray(s.l) : null;
    const spd = this.vel.length(), flail = !(this.mode === 'walk' || this.mode === 'ride');
    this.stepLegs(dt, spd, flail);
    this.pose(dt, W);
  }
}
Monster.builds = 0;
