// bUild eYes · MECHS: 9 cm battle robots (original bUild designs) fighting on your real table.
//  two teams: GOLD (blade + blaster) vs WHITE (twin blasters). They walk, aim, shoot bolts, slash, get knocked down, reboot.
//  your hands: pinch one = pick it up (legs kick) · let go = it drops · fast finger flick = knock it over
//              palm held up between them = a shield (bolts spark off it) · a finger near = it looks at you
//  host runs the fight (M.step); EYEs get M.snap() 20×/s and mirror it with M.apply().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const V3 = THREE.Vector3;

// reflections for metal: a soft studio room baked once (passthrough gives no environment of its own)
export function ensureEnv(renderer, scene) {
  if (scene.environment) return;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .9;
  pm.dispose();
}

const TEAMS = {
  gold: { armor: 0xc9a14a, trim: 0x1d1f24, glow: 0xffb21a, bolt: 0xffc23a },
  white: { armor: 0xe9ecef, trim: 0x2a2f38, glow: 0x35d4ff, bolt: 0x48dcff },
};
const mats = {};
function mat(team) {
  if (mats[team]) return mats[team];
  const T = TEAMS[team];
  return mats[team] = {
    armor: new THREE.MeshPhysicalMaterial({ color: T.armor, metalness: .85, roughness: .28, clearcoat: .6, clearcoatRoughness: .2 }),
    trim: new THREE.MeshStandardMaterial({ color: T.trim, metalness: .7, roughness: .45 }),
    joint: new THREE.MeshStandardMaterial({ color: 0x5a5f68, metalness: 1, roughness: .35 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: T.glow, emissiveIntensity: 2.2 }),
  };
}
const RB = (w, h, d, r = .25) => new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * r);
const CY = (r1, r2, h, s = 12) => new THREE.CylinderGeometry(r1, r2, h, s);

// ---------------------------------------------------------------- one mech (pure visuals + pose; the brain lives in Mechs.step)
export class Mech {
  constructor(root, team, id) {
    this.team = team; this.id = id; const m = mat(team);
    const g = this.g = new THREE.Group(); root.add(g);
    const part = (geo, mt, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, mt); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
    const pivot = (parent, x, y, z) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };
    // hips + legs (digitigrade: thigh forward, shin back, foot)
    this.hip = pivot(g, 0, .046, 0);
    part(RB(.026, .01, .016), m.trim, this.hip);
    this.legs = [-1, 1].map(s => {
      const h = pivot(this.hip, s * .0105, -.002, 0);
      part(CY(.0045, .0045, .006, 10).rotateZ(Math.PI / 2), m.joint, h);
      part(RB(.009, .022, .011), m.armor, h, 0, -.011, .002);
      const k = pivot(h, 0, -.022, .004);
      part(CY(.0035, .0035, .008, 10).rotateZ(Math.PI / 2), m.joint, k);
      part(RB(.007, .022, .008), m.trim, k, 0, -.011, -.002);
      const a = pivot(k, 0, -.022, -.003);
      part(RB(.011, .004, .019, .3), m.armor, a, 0, -.001, .004);
      return { h, k, a };
    });
    // torso (twists), chest core, backpack thrusters
    this.waist = pivot(this.hip, 0, .006, 0);
    this.torso = pivot(this.waist, 0, .004, 0);
    part(RB(.032, .028, .02), m.armor, this.torso, 0, .016, 0);
    part(RB(.02, .012, .006), m.trim, this.torso, 0, .02, .009);
    this.core = part(new THREE.SphereGeometry(.0035, 12, 8), m.glow, this.torso, 0, .02, .0125);
    part(RB(.022, .02, .01), m.trim, this.torso, 0, .016, -.013);
    for (const s of [-1, 1]) part(CY(.003, .004, .01), m.glow, this.torso, s * .006, .006, -.018).rotation.x = .3;
    // head + visor
    this.neck = pivot(this.torso, 0, .032, .001);
    part(RB(.013, .011, .013), m.armor, this.neck, 0, .005, 0);
    this.visor = part(RB(.011, .003, .004, .4), m.glow, this.neck, 0, .006, .0065);
    part(RB(.002, .008, .002), m.trim, this.neck, .005, .013, -.002).rotation.z = -.3;   // antenna
    // arms: right = blaster, left = blade (gold) / blaster (white)
    this.arms = [-1, 1].map(s => {
      const sh = pivot(this.torso, s * .021, .026, 0);
      part(RB(.014, .01, .016), m.armor, sh, s * .002, .002, 0);            // shoulder pad
      part(RB(.007, .016, .007), m.trim, sh, 0, -.009, 0);
      const el = pivot(sh, 0, -.018, 0);
      part(new THREE.SphereGeometry(.0038, 10, 8), m.joint, el);
      const fore = part(RB(.009, .018, .009), m.armor, el, 0, -.009, 0);
      const weapon = s > 0 || team === 'white' ? 'gun' : 'blade';
      let tip;
      if (weapon === 'gun') { part(CY(.0028, .0032, .014).rotateX(Math.PI / 2), m.trim, el, 0, -.017, .006); tip = pivot(el, 0, -.017, .014); part(new THREE.SphereGeometry(.0018, 8, 6), m.glow, tip); }
      else { const b = part(new THREE.BoxGeometry(.0015, .004, .03), m.glow, el, 0, -.017, .016); tip = pivot(el, 0, -.017, .03); b.material = mat(team).glow; }
      return { sh, el, fore, weapon, tip, s };
    });
    this.g.traverse(o => { if (o.isMesh) o.userData.mech = this; });
    // state (shared with EYEs through snap)
    this.p = new V3(); this.yaw = 0; this.phase = 0; this.act = 'idle'; this.actT = 0; this.hp = 100; this.look = null; this.vy = 0; this.y = 0; this.tilt = 0;
    this.aim = 0; this.walkAmt = 0; this.lean = 0;
  }
  // procedural animation from (act, actT, phase, walkAmt)
  pose(dt) {
    const L = this.legs, A = this.arms, w = this.walkAmt, ph = this.phase, t = this.actT;
    this.g.position.set(this.p.x, this.p.y + this.y, this.p.z); this.g.rotation.set(0, this.yaw, 0);
    let bob = Math.abs(Math.sin(ph)) * .002 * w;
    // legs: walk cycle
    for (let i = 0; i < 2; i++) {
      const s = Math.sin(ph + i * Math.PI);
      L[i].h.rotation.x = -.25 + s * .55 * w; L[i].k.rotation.x = .55 + Math.max(0, -Math.cos(ph + i * Math.PI)) * .6 * w; L[i].a.rotation.x = -.3 - s * .2 * w;
    }
    this.hip.position.y = .046 - .004 + bob; this.hip.rotation.set(this.lean, 0, 0);
    this.torso.rotation.set(.08, 0, Math.sin(ph) * .05 * w);
    // arms default: guard
    for (const a of A) { a.sh.rotation.set(-.2 + Math.sin(ph + (a.s > 0 ? 0 : Math.PI)) * .3 * w, 0, a.s * .12); a.el.rotation.set(-.9, 0, 0); }
    const gun = A.find(a => a.weapon === 'gun' && a.s > 0) || A[1];
    if (this.act === 'shoot') { const k = Math.min(1, t / .18); gun.sh.rotation.set(-1.45 * k + this.aim * k, 0, gun.s * .05); gun.el.rotation.x = -.15 * k; if (t > .25 && t < .35) gun.sh.rotation.x += .25; }
    if (this.act === 'slash') { const blade = A[0], k = t / .45; blade.sh.rotation.set(-2.2 + Math.min(1, k * 1.6) * 2.6, 0, -.5 + k * .9); blade.el.rotation.x = -.3; this.torso.rotation.y = -.6 + k * 1.2; }
    if (this.act === 'hit') { this.hip.rotation.x = -.5 * Math.max(0, 1 - t / .4); }
    if (this.act === 'held') { const k = performance.now() / 90; L[0].h.rotation.x = Math.sin(k) * .9; L[1].h.rotation.x = -Math.sin(k) * .9; L[0].k.rotation.x = L[1].k.rotation.x = .4; for (const a of A) a.sh.rotation.set(Math.sin(k * 1.3 + a.s) * 1.2, 0, a.s * .6); }
    if (this.act === 'down') { const k = Math.min(1, t / .5); this.g.rotation.x = -k * 1.45; this.g.position.y = this.p.y + .006 * k; for (const a of A) a.sh.rotation.z = a.s * (.12 + .9 * k); }
    if (this.act === 'reboot') { const k = 1 - Math.min(1, t / 1.2); this.g.rotation.x = -k * 1.45; }
    this.g.rotation.z = this.tilt;
    // head looks at the finger (or the enemy)
    if (this.look) { const loc = this.g.worldToLocal(this.look.clone()); this.neck.rotation.y = THREE.MathUtils.clamp(Math.atan2(loc.x, loc.z), -1, 1); this.neck.rotation.x = THREE.MathUtils.clamp(-Math.atan2(loc.y - .05, Math.hypot(loc.x, loc.z)), -.6, .6); }
    else { this.neck.rotation.y *= .9; this.neck.rotation.x *= .9; }
    const pulse = this.act === 'down' ? .2 + Math.random() * .3 * (Math.random() < .1) : 2.2 * (.6 + .4 * this.hp / 100);
    mat(this.team).glow.emissiveIntensity = Math.max(mat(this.team).glow.emissiveIntensity * .9, 0) * 0 + pulse;
  }
  muzzle() { const a = this.arms.find(a => a.weapon === 'gun' && a.s > 0) || this.arms[1]; this.g.updateMatrixWorld(true); return a.tip.getWorldPosition(new V3()); }
  dispose() { this.g.removeFromParent(); }
}

// ---------------------------------------------------------------- the arena
export function createMechs({ root, sfx, fx, say = () => {} }) {
  const M = { list: [], bolts: [], on: true, area: .17, onEvent: null };
  let nid = 1;
  const boltGeo = CY(.0011, .0011, .016, 6).rotateX(Math.PI / 2);
  const boltMat = { gold: new THREE.MeshBasicMaterial({ color: TEAMS.gold.bolt, toneMapped: false }), white: new THREE.MeshBasicMaterial({ color: TEAMS.white.bolt, toneMapped: false }) };
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.3, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

  // sounds: pew, clang, power-down (tiny synths on the shared audio context)
  const snd = {
    pew(team) { const c = sfx && sfx.c; if (!c) return; const t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(team === 'gold' ? 1500 : 1900, t); o.frequency.exponentialRampToValueAtTime(220, t + .14); g.gain.setValueAtTime(.12, t); g.gain.exponentialRampToValueAtTime(.001, t + .16); o.connect(g).connect(sfx.out); o.start(t); o.stop(t + .17); },
    clang(v = 1) { const c = sfx && sfx.c; if (!c) return; const t = c.currentTime, n = c.sampleRate * .18 | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); const s = c.createBufferSource(); s.buffer = b; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400 + Math.random() * 1500; bp.Q.value = 6; const g = c.createGain(); g.gain.value = .5 * v; s.connect(bp).connect(g).connect(sfx.out); s.start(t); },
    down() { const c = sfx && sfx.c; if (!c) return; const t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.setValueAtTime(600, t); o.frequency.exponentialRampToValueAtTime(40, t + .7); g.gain.setValueAtTime(.08, t); g.gain.exponentialRampToValueAtTime(.001, t + .75); o.connect(g).connect(sfx.out); o.start(t); o.stop(t + .8); },
    boot() { const c = sfx && sfx.c; if (!c) return; const t = c.currentTime, o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(1200, t + .4); g.gain.setValueAtTime(.06, t); g.gain.exponentialRampToValueAtTime(.001, t + .45); o.connect(g).connect(sfx.out); o.start(t); o.stop(t + .5); },
  };
  const emit = ev => { if (M.onEvent) M.onEvent(ev); };
  M.event = ev => {   // EYEs replay sounds + sparks
    if (ev.t !== 'mx') return;
    if (ev.k === 'pew') { snd.pew(ev.team); spawnBolt(new V3().fromArray(ev.p), new V3().fromArray(ev.v), ev.team, false); }
    if (ev.k === 'hit') { snd.clang(); fx && fx.spark(new V3().fromArray(ev.p), ev.c, 14); }
    if (ev.k === 'down') snd.down();
    if (ev.k === 'boot') snd.boot();
  };

  M.add = (team, at) => {
    const m = new Mech(root, team, nid++);
    m.p.copy(at || new V3((team === 'gold' ? -1 : 1) * .1 + (Math.random() - .5) * .04, 0, (Math.random() - .5) * .1));
    m.yaw = team === 'gold' ? Math.PI / 2 : -Math.PI / 2; m.phase = Math.random() * 6; m.cool = 1 + Math.random(); m.act = 'reboot'; m.actT = 0;
    M.list.push(m); snd.boot(); return m;
  };
  M.spawnPair = () => { if (M.list.length >= 6) M.clear(); M.add('gold'); M.add('white'); say('⚔ GOLD vs WHITE · pinch one to pick it up · palm up = shield', 3); };
  M.clear = () => { M.list.forEach(m => m.dispose()); M.list = []; M.bolts.forEach(b => b.mesh.removeFromParent()); M.bolts = []; };

  function spawnBolt(p, v, team, live = true) {
    const mesh = new THREE.Mesh(boltGeo, boltMat[team]); mesh.position.copy(p); mesh.lookAt(p.clone().add(v)); root.add(mesh);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: TEAMS[team].bolt, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); glow.scale.setScalar(.014); mesh.add(glow);
    M.bolts.push({ mesh, v, team, life: .9, live });
  }
  const damage = (m, n, from, at) => {
    if (m.act === 'down' || m.act === 'reboot') return;
    m.hp -= n; snd.clang(n / 12); fx && fx.spark(at, TEAMS[m.team === 'gold' ? 'white' : 'gold'].bolt, 12); emit({ t: 'mx', k: 'hit', p: at.toArray(), c: TEAMS[from].bolt });
    if (from) { const push = new V3().subVectors(m.p, at).setY(0).normalize().multiplyScalar(.012); m.p.add(push); }
    if (m.hp <= 0) { m.act = 'down'; m.actT = 0; m.hp = 0; snd.down(); emit({ t: 'mx', k: 'down' }); fx && fx.spark(m.p.clone().setY(.03), 0xffffff, 24); }
    else { m.act = 'hit'; m.actT = 0; }
  };

  // ---------------------------------------------------------------- the fight brain (host only)
  const tmp = new V3();
  M.step = (hands, dt) => {
    const live = hands.filter(h => !h.stale);
    for (const m of M.list) {
      m.actT += dt;
      // a finger near = it looks at you
      let near = null, nd = .14;
      for (const h of live) { const d = h.pts[8].distanceTo(m.p); if (d < nd) { nd = d; near = h; } }
      // pick up / hold / drop
      const grab = live.find(h => h.pinch && h.pinchPt.distanceTo(tmp.copy(m.p).setY(m.p.y + m.y + .05)) < .035 && !M.list.some(o => o.heldBy === h));
      if (!m.heldBy && grab && m.act !== 'held') { m.heldBy = grab; m.act = 'held'; m.actT = 0; snd.boot(); }
      if (m.heldBy) {
        const h = m.heldBy;
        if (!h.pinch || h.stale || h.gone) { m.heldBy = null; m.act = 'fall'; m.actT = 0; m.vy = h.pinchVel ? h.pinchVel.y : 0; m.vel = h.pinchVel ? h.pinchVel.clone().setY(0) : new V3(); }
        else { m.p.set(h.pinchPt.x, 0, h.pinchPt.z); m.y = Math.max(0, h.pinchPt.y - .05); m.tilt = Math.sin(performance.now() / 160) * .15; m.pose(dt); continue; }
      }
      if (m.act === 'fall') {
        m.vy -= 9.8 * dt; m.y += m.vy * dt; if (m.vel) m.p.addScaledVector(m.vel, dt);
        if (m.y <= 0) { const hard = m.vy < -1.2; m.y = 0; m.vy = 0; m.tilt = 0; m.vel = null; if (hard) damage(m, 25, null, m.p.clone().setY(.01)); else { m.act = 'idle'; m.actT = 0; } snd.clang(.6); }
        m.pose(dt); continue;
      }
      // flick: a fast fingertip through it knocks it over
      for (const h of live) for (const i of [8, 12]) if (h.spd[i] > .9 && h.pts[i].distanceTo(tmp.copy(m.p).setY(.03)) < .03 && m.act !== 'down') {
        damage(m, 18, null, h.pts[i].clone()); m.p.addScaledVector(h.vel[i].clone().setY(0).normalize(), .03); m.act = 'down'; m.actT = 0; m.hp = Math.max(m.hp, 1); m.flicked = true;
      }
      if (m.act === 'down') { m.walkAmt = 0; if (m.actT > (m.flicked ? 1.6 : 5)) { m.act = 'reboot'; m.actT = 0; if (!m.flicked) m.hp = 70; m.flicked = false; snd.boot(); emit({ t: 'mx', k: 'boot' }); } m.pose(dt); continue; }
      if (m.act === 'reboot') { m.walkAmt = 0; if (m.actT > 1.2) { m.act = 'idle'; m.actT = 0; } m.pose(dt); continue; }
      if (m.act === 'hit' && m.actT < .4) { m.pose(dt); continue; }
      m.look = near ? near.pts[8] : null;
      // the enemy
      const foes = M.list.filter(o => o.team !== m.team && o.act !== 'down' && o.act !== 'reboot' && o.act !== 'held');
      let foe = null, fd = 9; for (const o of foes) { const d = o.p.distanceTo(m.p); if (d < fd) { fd = d; foe = o; } }
      m.cool -= dt;
      let want = 0, face = m.yaw;
      if (foe) {
        face = Math.atan2(foe.p.x - m.p.x, foe.p.z - m.p.z);
        if (!m.look) m.look = foe.p.clone().setY(.05);
        if (m.act === 'slash') { if (m.actT > .22 && !m.dealt && fd < .065) { m.dealt = true; damage(foe, 22, m.team, foe.p.clone().setY(.035)); } if (m.actT > .45) { m.act = 'idle'; m.actT = 0; } }
        else if (m.act === 'shoot') {
          if (m.actT > .25 && !m.fired) { m.fired = true; const p = m.muzzle(), tgt = root.worldToLocal(p.clone()), aimAt = foe.p.clone().setY(.035 + Math.random() * .01); const v = aimAt.sub(tgt).normalize().multiplyScalar(.55); const pl = tgt; spawnBolt(pl, v, m.team); snd.pew(m.team); emit({ t: 'mx', k: 'pew', p: pl.toArray(), v: v.toArray(), team: m.team }); }
          if (m.actT > .5) { m.act = 'idle'; m.actT = 0; }
        }
        else {
          const hasBlade = m.arms.some(a => a.weapon === 'blade');
          if (hasBlade && fd < .055 && m.cool <= 0) { m.act = 'slash'; m.actT = 0; m.dealt = false; m.cool = 1.1 + Math.random() * .6; }
          else if (fd < .3 && fd > .07 && m.cool <= 0 && Math.abs(angDiff(face, m.yaw)) < .3) { m.act = 'shoot'; m.actT = 0; m.fired = false; m.cool = .9 + Math.random() * .9; }
          else want = hasBlade ? (fd > .045 ? 1 : 0) : (fd > .16 ? 1 : fd < .09 ? -.6 : 0);
        }
      } else { m.act = 'idle'; }
      if (m.hold) want = 0;
      // walk + turn + stay on the table
      m.yaw += angDiff(face, m.yaw) * Math.min(1, dt * 5);
      m.walkAmt += (Math.abs(want) - m.walkAmt) * Math.min(1, dt * 6);
      const sp = .045 * want;
      m.p.x += Math.sin(m.yaw) * sp * dt; m.p.z += Math.cos(m.yaw) * sp * dt;
      m.phase += dt * 11 * m.walkAmt * Math.sign(want || 1);
      const r = Math.hypot(m.p.x, m.p.z); if (r > M.area) { m.p.x *= M.area / r; m.p.z *= M.area / r; }
      // keep apart
      for (const o of M.list) if (o !== m) { const d = Math.hypot(o.p.x - m.p.x, o.p.z - m.p.z); if (d < .03 && d > 1e-4) { m.p.x -= (o.p.x - m.p.x) / d * (.03 - d) * .5; m.p.z -= (o.p.z - m.p.z) / d * (.03 - d) * .5; } }
      m.pose(dt);
    }
    stepBolts(live, dt);
  };
  function stepBolts(live, dt) {
    for (const b of [...M.bolts]) {
      b.life -= dt; b.mesh.position.addScaledVector(b.v, dt);
      const p = b.mesh.position; let dead = b.life <= 0 || p.y < 0;
      if (!dead && M.blocker && M.blocker(p)) { dead = true; snd.clang(.4); fx && fx.spark(p.clone(), 0xd8c8a8, 8); }
      if (b.live && !dead) {
        // palm shield
        for (const h of live) if (p.distanceTo(h.palm) < .045) { dead = true; snd.clang(.7); fx && fx.spark(p.clone(), 0xffffff, 10); emit({ t: 'mx', k: 'hit', p: p.toArray(), c: 0xffffff }); }
        if (!dead) for (const m of M.list) if (m.team !== b.team && m.act !== 'held' && p.distanceTo(tmp.copy(m.p).setY(m.y + .035)) < .022) { dead = true; damage(m, 9, b.team, p.clone()); break; }
      }
      if (!b.live && !dead) for (const m of M.list) if (m.team !== b.team && p.distanceTo(tmp.copy(m.p).setY(m.y + .035)) < .022) dead = true;
      if (p.y < .002 && b.live) fx && fx.spark(p.clone().setY(.002), TEAMS[b.team].bolt, 5);
      if (dead) { b.mesh.removeFromParent(); M.bolts.splice(M.bolts.indexOf(b), 1); }
    }
  }
  // ---------------------------------------------------------------- sync to EYEs
  M.snap = () => ({ t: 'mech', l: M.list.map(m => [m.id, m.team, +m.p.x.toFixed(4), +m.p.z.toFixed(4), +m.yaw.toFixed(3), +m.phase.toFixed(2), m.act, +m.actT.toFixed(2), Math.round(m.hp), +m.walkAmt.toFixed(2), +m.y.toFixed(3), +m.tilt.toFixed(2)]) });
  M.apply = s => {
    const ids = new Set(s.l.map(r => r[0]));
    for (const m of [...M.list]) if (!ids.has(m.id)) { m.dispose(); M.list.splice(M.list.indexOf(m), 1); }
    for (const r of s.l) {
      let m = M.list.find(x => x.id === r[0]); if (!m) { m = new Mech(root, r[1], r[0]); M.list.push(m); }
      [, , m.p.x, m.p.z, m.yaw, m.phase, m.act, m.actT, m.hp, m.walkAmt, m.y, m.tilt] = r;
    }
  };
  M.poseAll = dt => { for (const m of M.list) m.pose(dt); };
  M.puppetStep = dt => { for (const m of M.list) { m.actT += dt; m.pose(dt); } stepBolts([], dt); };
  return M;
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
