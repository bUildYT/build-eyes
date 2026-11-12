// bUild eYes — the POCKET DRAGON. Same mind as the table creatures (monster.js: hunger, fear, trust, memory of you),
// new body: four legs with planted feet, a neck that follows what it looks at, a swinging tail, wings that fold on the
// table and beat in the air (thrown = it catches itself and glides down), and FIRE: little bursts when it is angry,
// a happy puff when it rides your palm. Fire throws real light on the creatures + a warm glow on your real table.
import * as THREE from 'three';
import { Monster } from './monster.js';
const V3 = THREE.Vector3, UP = new V3(0, 1, 0), G = 9.8 * .75;
const rand = (a, b) => a + Math.random() * (b - a), clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DSKINS = [
  { body: 0x1d3a2a, belly: 0xc9b27a, wing: 0x3d6a4a, eye: 0xffc23a, horn: 0xe8dcc0 },   // forest green, gold eyes
  { body: 0x5a1410, belly: 0xe0a060, wing: 0x8a2a1c, eye: 0xffe36a, horn: 0x2a1a14 },   // ember red
  { body: 0x17202e, belly: 0x6f86a8, wing: 0x2a3f66, eye: 0x7ef9ff, horn: 0xd0d8e8 },   // night blue
  { body: 0x2a2626, belly: 0x8a7a68, wing: 0x4a3a34, eye: 0xff7a2a, horn: 0xc8b89a },   // ash black
  { body: 0xb08a2a, belly: 0xf4e2a8, wing: 0xd8a83a, eye: 0xff3a1a, horn: 0x5a3a14 },   // gold
];
const seg = (m, a, b) => { const d = new V3().subVectors(b, a), l = d.length(); m.position.copy(a); m.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / (l || 1))); m.scale.set(1, l || 1e-4, 1); };
const cyl = (r0, r1, mat, n = 9) => { const g = new THREE.CylinderGeometry(r1, r0, 1, n); g.translate(0, .5, 0); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; };

export class Dragon extends Monster {
  constructor(scene, opts = {}) {
    super(scene, Object.assign({}, opts, { kind: 'dragon' }));
    this.fireT = 0; this.burst = 0; this.puffT = rand(3, 8);
  }
  setSize() { const s = this.mem.size; this.L = .075 * s; this.hB = .5 * this.L; this.maxSpeed = .14 * Math.sqrt(Math.max(.6, s)); }

  build() {
    if (this.mem.dskin === undefined) this.mem.dskin = Math.random() * DSKINS.length | 0;
    const L = this.L, sk = DSKINS[this.mem.dskin % DSKINS.length]; this.skinColor = sk.body;
    const scale = new THREE.MeshPhysicalMaterial({ color: sk.body, roughness: .38, metalness: .1, clearcoat: 1, clearcoatRoughness: .25, iridescence: .35, iridescenceIOR: 1.6, sheen: .4, sheenColor: new THREE.Color(sk.wing) });
    const belly = new THREE.MeshPhysicalMaterial({ color: sk.belly, roughness: .55, clearcoat: .4 });
    const horn = new THREE.MeshPhysicalMaterial({ color: sk.horn, roughness: .3, clearcoat: .8 });
    const wingM = new THREE.MeshPhysicalMaterial({ color: sk.wing, roughness: .6, side: THREE.DoubleSide, transparent: true, opacity: .9, sheen: .6, sheenColor: new THREE.Color(sk.belly) });
    this.eyeM = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: sk.eye, emissiveIntensity: 2.4 });
    this.root = new THREE.Group(); this.scene.add(this.root);
    // body: a long egg, belly plates underneath
    const bg = new THREE.SphereGeometry(1, 40, 26), pos = bg.attributes.position, col = [];
    const cTop = new THREE.Color(sk.body), cBel = new THREE.Color(sk.belly);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ridge = 1 + .05 * Math.max(0, y) * Math.cos(z * 18);          // scale rows along the back
      pos.setXYZ(i, x * .26 * L * ridge, y * .24 * L * (y < 0 ? .85 : 1), z * .48 * L * (1 + .1 * z));
      const k = clamp((-y - .15) * 2.5, 0, 1); const c = cTop.clone().lerp(cBel, k); col.push(c.r, c.g, c.b);
    }
    bg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); bg.computeVertexNormals();
    const bodyM = scale.clone(); bodyM.vertexColors = true; bodyM.color.set(0xffffff);
    const body = new THREE.Mesh(bg, bodyM); body.castShadow = true; this.root.add(body);
    for (let i = 0; i < 7; i++) {                                         // back spikes
      const c = new THREE.Mesh(new THREE.ConeGeometry(.035 * L, (.13 - Math.abs(i - 2) * .015) * L, 5), horn);
      c.position.set(0, .22 * L - Math.abs(i - 2) * .01 * L, (.32 - i * .11) * L); c.rotation.x = -.5; c.castShadow = true; this.root.add(c);
    }
    // neck = 4 tapering pieces (re-aimed every frame), head on top
    this.neck = [0, 1, 2, 3].map(i => { const m = cyl((.13 - i * .018) * L, (.115 - i * .018) * L, scale); this.scene.add(m); return m; });
    this.head = new THREE.Group(); this.root.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(.15 * L, 24, 16), scale); skull.scale.set(1, .85, 1.15); skull.castShadow = true; this.head.add(skull);
    const snoutG = new THREE.CylinderGeometry(.06 * L, .11 * L, .24 * L, 12); snoutG.rotateX(Math.PI / 2); snoutG.translate(0, -.01 * L, .2 * L);
    const snout = new THREE.Mesh(snoutG, scale); snout.castShadow = true; this.head.add(snout);
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -.05 * L, .06 * L); this.head.add(this.jaw);
    const jg = new THREE.CylinderGeometry(.045 * L, .08 * L, .22 * L, 10); jg.rotateX(Math.PI / 2); jg.translate(0, -.02 * L, .12 * L);
    const jm = new THREE.Mesh(jg, belly); jm.castShadow = true; this.jaw.add(jm);
    this.mouth = new V3(0, -.04 * L, .34 * L);
    for (const sd of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(.03 * L, .22 * L, 7), horn); h.position.set(sd * .08 * L, .1 * L, -.08 * L); h.rotation.set(-1.1, 0, sd * -.35); h.castShadow = true; this.head.add(h);
      const h2 = new THREE.Mesh(new THREE.ConeGeometry(.018 * L, .1 * L, 6), horn); h2.position.set(sd * .12 * L, .02 * L, -.04 * L); h2.rotation.set(-1.3, 0, sd * -.9); this.head.add(h2);
    }
    this.eyes = [-1, 1].map(sd => { const e = new THREE.Mesh(new THREE.SphereGeometry(.04 * L, 12, 8), this.eyeM); e.position.set(sd * .1 * L, .05 * L, .1 * L); this.head.add(e); return e; });
    this.mands = []; this.antennae = [];
    // tail: 11 pieces, thick → thin, spade at the end
    this.tail = Array.from({ length: 11 }, (_, i) => { const m = cyl((.1 - i * .008) * L, (.092 - i * .008) * L, scale, 7); this.scene.add(m); return m; });
    const sp = new THREE.Mesh(new THREE.ConeGeometry(.06 * L, .12 * L, 3), horn); sp.scale.set(1, 1, .3); this.scene.add(sp); this.spade = sp;
    // wings: an arm with three long fingers, skin stretched between them
    this.wings = [-1, 1].map(sd => {
      const g = new THREE.Group(); g.position.set(sd * .17 * L, .17 * L, .14 * L); this.root.add(g);
      const P = [[0, 0, 0], [sd * .5, .12, -.02], [sd * 1.15, .06, -.12], [sd * 1.0, 0, -.5], [sd * .62, 0, -.72], [sd * .12, 0, -.5]].map(p => new V3(...p).multiplyScalar(L));
      const v = [], idx = [];
      P.forEach(p => v.push(p.x, p.y, p.z)); for (let i = 1; i < P.length - 1; i++) idx.push(0, i, i + 1);
      // sag the skin a little between fingers
      const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); mg.setIndex(idx); mg.computeVertexNormals();
      const mem = new THREE.Mesh(mg, wingM); mem.castShadow = true; g.add(mem);
      for (const k of [2, 3, 4]) { const b = cyl(.012 * L, .006 * L, horn, 5); seg(b, P[1], P[k]); g.add(b); }
      const arm = cyl(.022 * L, .016 * L, scale, 6); seg(arm, P[0], P[1]); g.add(arm);
      return { g, sd, flap: 0 };
    });
    // four legs (diagonal pairs step together), short and strong
    this.legs = [];
    const legM = scale;
    [[-1, .2], [1, .2], [-1, -.24], [1, -.24]].forEach(([side, row], i) => {
      const leg = { side, group: (i === 0 || i === 3) ? 0 : 1, hip: new V3(side * .18 * L, -.05 * L, row * L), rest: new V3(side * .36 * L, 0, row * 1.15 * L),
        a: cyl(.06 * L, .045 * L, legM), b: cyl(.045 * L, .025 * L, legM), foot: new V3(), from: new V3(), to: new V3(), st: -1, l1: .3 * L, l2: .34 * L, ph: rand(0, 6) };
      this.scene.add(leg.a, leg.b); this.legs.push(leg);
    });
    Monster.builds++;
  }
  disposeBody() {
    super.disposeBody();
    for (const m of [...(this.neck || []), ...(this.tail || [])]) this.scene.remove(m);
    if (this.spade) this.scene.remove(this.spade);
  }

  // ---------------------------------------------------------------- behaviour on top of the shared mind
  update(dt, W) {
    super.update(dt, W);
    this.fireT -= dt; this.puffT -= dt;
    const h = this.hand;
    // angry + your hand close = it breathes fire at it (bursts, then it must breathe in again)
    if (this.mode === 'walk' && this.act === 'attack' && h && h.d < .22 && this.fireT <= 0) { this.burst = .9; this.fireT = rand(2.2, 3.5); this.chirp('angry'); }
    if (this.mode === 'ride' && this.puffT <= 0) { this.puffT = rand(4, 9); this.burst = .35; }
    if (this.burst > 0) {
      this.burst -= dt; this.mand = 1;
      const at = this.mouthAt(), dir = this.faceDir();
      if (this.mode === 'ride') dir.lerp(UP, .6).normalize();
      W.fx.fire(at, dir, this.mode === 'ride' ? 2 : 5, this.L);
      // the flame stings a hand it reaches
      if (h && this.mode === 'walk') for (const H of W.hands) if (!H.stale) for (const i of [8, 12, 4, 0, 9]) {
        const d = H.pts[i].clone().sub(at); const along = d.dot(dir);
        if (along > 0 && along < .12 && d.addScaledVector(dir, -along).length() < .02 + along * .25) { if (Math.random() < dt * 4) { W.hurt(.08); this.D.anger = Math.max(0, this.D.anger - dt * .3); } break; }
      }
    } else if (Math.random() < dt * .05 && this.act !== 'sleep') W.fx.fire(this.mouthAt(), this.faceDir().lerp(UP, .7).normalize(), 1, this.L * .5, true);   // smoke from the nose
  }
  // thrown: it catches itself, spreads the wings and glides down instead of tumbling
  fly(dt, W) {
    if (this.lunge && this.lunge.kind === 'hit' && this.modeT > .22) {
      this.angVel.multiplyScalar(Math.pow(.02, dt));
      const f = new V3(0, 0, 1).applyQuaternion(this.q); f.y = 0; const yaw = f.lengthSq() > 1e-4 ? Math.atan2(f.x, f.z) : this.yaw;
      this.q.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.15, yaw, 0, 'YXZ')), Math.min(1, dt * 5));
      if (this.vel3.y < 0) this.vel3.y += G * .82 * dt;                      // wings carry it
      this.vel3.x *= Math.pow(.5, dt); this.vel3.z *= Math.pow(.5, dt);
      // steer home towards the table
      const r = Math.hypot(this.p.x, this.p.z); if (r > W.area * .8) { this.vel3.x -= this.p.x / r * dt * .25; this.vel3.z -= this.p.z / r * dt * .25; }
      if (new V3(0, 1, 0).applyQuaternion(this.q).y > .9) this.lunge = { kind: 'glide', done: true };
    }
    super.fly(dt, W);
  }

  mouthAt() { return this.mouth.clone().applyEuler(this.head.rotation).add(this.head.position).applyQuaternion(this.q).add(this.p); }
  faceDir() { return new V3(0, -.12, 1).applyEuler(this.head.rotation).applyQuaternion(this.q).normalize(); }

  pose(dt, W) {
    const L = this.L;
    // head sits at the end of the neck: raised when curious/angry, low when sleeping, a little breathing
    const alert = this.act === 'attack' || this.act === 'curious' ? 1 : this.act === 'sleep' ? -1 : 0;
    const hy = (.34 + alert * .07) * L + Math.sin(this.t * 2.1) * .01 * L, hz = (.46 + alert * .04) * L;
    this.head.position.set(0, hy, hz);
    this.head.rotation.x = -.1 + (this.act === 'sleep' ? .5 : 0) + (this.burst > 0 ? .15 : 0);
    super.pose(dt, W);
    this.jaw.rotation.x = .08 + this.mand * .55;
    const M = new THREE.Matrix4().compose(this.p, this.q, new V3(1, 1, 1)), toW = v => v.clone().applyMatrix4(M);
    // neck: a soft curve from the chest to the back of the head
    const a = new V3(0, .08 * L, .3 * L), b = this.head.position.clone().add(new V3(0, -.03 * L, -.08 * L));
    let prev = toW(a);
    for (let i = 0; i < 4; i++) { const k = (i + 1) / 4, p = a.clone().lerp(b, k); p.y += Math.sin(k * Math.PI) * .05 * L; const w = toW(p); seg(this.neck[i], prev, w); prev = w; }
    // tail: lags behind turns, sways while walking, curls when sleeping
    const spd = this.vel.length(), sway = Math.min(1, spd / this.maxSpeed) * .35 + .12;
    let tp = new V3(0, .02 * L, -.42 * L), dir = new V3(0, -.15, -1).normalize(), prevW = toW(tp);
    for (let i = 0; i < this.tail.length; i++) {
      const k = i / this.tail.length;
      const ang = Math.sin(this.t * 3.2 - i * .55) * sway * k - (this.yawRate || 0) * .06 * k + (this.act === 'sleep' ? .32 : 0);
      dir.applyAxisAngle(UP, ang * .35); dir.y = Math.max(-.3, dir.y + (tp.y < .02 * L ? .08 : -.02)); dir.normalize();
      tp = tp.clone().addScaledVector(dir, .1 * L); const w = toW(tp);
      seg(this.tail[i], prevW, w); prevW = w;
    }
    this.spade.position.copy(prevW); this.spade.quaternion.setFromUnitVectors(UP, dir.clone().applyQuaternion(this.q));
    // wings: folded on the table, beating in the air / when held, spread wide to glide
    const flying = this.mode === 'air' || this.mode === 'held';
    const gliding = this.lunge && this.lunge.kind === 'glide';
    for (const wg of this.wings) {
      const target = flying ? 1 : this.act === 'attack' ? .45 : 0; wg.flap += (target - wg.flap) * Math.min(1, dt * 6);
      const beat = flying && !gliding ? Math.sin(this.t * 22) * .9 : gliding ? Math.sin(this.t * 3) * .1 : 0;
      const fold = 1 - wg.flap;
      wg.g.rotation.set(fold * .1, wg.sd * fold * 1.35, wg.sd * (fold * -.55 + wg.flap * (.15 + beat)));
      wg.g.scale.set(1 - fold * .55, 1, 1 - fold * .3);
    }
  }
}
