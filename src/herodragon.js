// bUild eYes · HERO DRAGON: a realistic animated dragon living above your real desk.
//  model: "Animated Dragon Three Motion Loops" + "Runs Slow Motion Loop" by LasquetiSpice (sketchfab.com/LasquetiSpice), CC BY 4.0
//  it circles your desk · LEFT or RIGHT palm up and still = it flies to you and hovers over your hand
//  a finger darting at its head = FIRE at your finger · now and then it lands and runs across the table
//  host runs it (D.step); EYEs mirror D.snap() with D.apply().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const V3 = THREE.Vector3;
export const DRAGON_CREDIT = 'Dragon: "Animated Dragon Three Motion Loops" by LasquetiSpice, CC BY 4.0';

export async function createHeroDragon({ root, fx, sfx, size = .34, base = './' }) {
  const loader = new GLTFLoader();
  const [fly, run] = await Promise.all([loader.loadAsync(base + 'models/dragon_fly.glb'), loader.loadAsync(base + 'models/dragon_run.glb')]);
  const model = fly.scene;
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; if (o.material) { o.material.envMapIntensity = 1.1; } } });
  // normalise: longest side = size, feet on y = 0, centred
  const holder = new THREE.Group(); holder.add(model);
  const box = new THREE.Box3().setFromObject(model), sz = box.getSize(new V3()), k = size / Math.max(sz.x, sz.z);
  model.scale.multiplyScalar(k); const box2 = new THREE.Box3().setFromObject(model), c = box2.getCenter(new V3());
  model.position.sub(new V3(c.x, box2.min.y, c.z));
  const g = new THREE.Group(); g.add(holder); root.add(g); g.visible = false;
  const mixer = new THREE.AnimationMixer(model);
  const aFly = mixer.clipAction(fly.animations[0]), aRun = mixer.clipAction(run.animations[0]);
  aFly.play(); aRun.play(); aRun.weight = 0;
  let bone = n => { let b = null; model.traverse(o => { if (!b && o.name && o.name.startsWith(n)) b = o; }); return b; };
  const head = bone('head'), breath = bone('fireBreath'), jaw = bone('jaw_01'), rootJ = bone('root'), pelvis = bone('pelvis');
  // the clips carry root motion (the dragon drifts metres away): pin root + pelvis, the brain moves the whole group instead
  const pin = [rootJ, pelvis].filter(Boolean).map(b => ({ b, p: b.position.clone() }));

  const D = { g, model, mode: 'fly', t: 0, p: new V3(0, .22, 0), yaw: 0, bank: 0, wFly: 1, fireT: 0, fireDir: new V3(), say: null, target: null, credit: DRAGON_CREDIT };
  D.forwardFix = 0;   // model faces +Z after load (checked in tools/look_hero.mjs)
  g.visible = true;
  const tmp = new V3(), tmp2 = new V3();
  let palmT = 0, nextLand = 20 + Math.random() * 10, runGoal = null, roarCool = 0;

  const roar = () => { const c = sfx && sfx.c; if (!c) return; const t = c.currentTime, n = c.sampleRate * 1.1 | 0, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(Math.sin(Math.PI * i / n), .6);
    const s = c.createBufferSource(); s.buffer = b; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(260, t + 1.1);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(60, t + 1); const og = c.createGain(); og.gain.setValueAtTime(.08, t); og.gain.exponentialRampToValueAtTime(.001, t + 1.05);
    const gg = c.createGain(); gg.gain.value = .55; s.connect(lp).connect(gg).connect(sfx.out); o.connect(og).connect(sfx.out); s.start(t); o.start(t); o.stop(t + 1.1); };
  D.mouth = () => root.worldToLocal((breath || head).getWorldPosition(new V3()));
  D.breathe = (dirLocal, sec = 1.2) => { D.fireT = sec; D.fireDir.copy(dirLocal).normalize(); roar(); if (D.onEvent) D.onEvent({ t: 'hd', k: 'fire', d: D.fireDir.toArray(), s: sec }); };
  D.event = ev => { if (ev.t === 'hd' && ev.k === 'fire') { D.fireT = ev.s; D.fireDir.fromArray(ev.d); roar(); } };

  function steerTo(goal, dt, speed = .35, turn = 3) {
    tmp.subVectors(goal, D.p); const d = tmp.length();
    const want = Math.atan2(tmp.x, tmp.z); let dy = want - D.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    const dyaw = dy * Math.min(1, dt * turn); D.yaw += dyaw; D.bank += (THREE.MathUtils.clamp(-dyaw / dt * .25, -.6, .6) - D.bank) * Math.min(1, dt * 3);
    const v = Math.min(speed, d * 2.2); D.p.addScaledVector(tmp.normalize(), v * dt); return d;
  }
  // its own fire jet: thin + fast at the mouth, swelling + cooling white → gold → red → smoke
  const FN = 700, fPos = new Float32Array(FN * 3), fCol = new Float32Array(FN * 3), fSize = new Float32Array(FN), fAlpha = new Float32Array(FN);
  const parts = Array.from({ length: FN }, () => ({ p: new V3(), v: new V3(), life: 0, max: 1 }));
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); fGeo.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
  fGeo.setAttribute('size', new THREE.BufferAttribute(fSize, 1)); fGeo.setAttribute('alpha', new THREE.BufferAttribute(fAlpha, 1));
  const fMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA;
      void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = size * 900. / -mv.z; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main() { float d = length(gl_PointCoord - .5) * 2.; float a = smoothstep(1., 0., d); a *= a; gl_FragColor = vec4(vC * a * vA, a * vA); }`,
  });
  const fPts = new THREE.Points(fGeo, fMat); fPts.frustumCulled = false; root.add(fPts);
  const fireLight = new THREE.PointLight(0xff7a2a, 0, .5, 2); root.add(fireLight);
  let fNext = 0; const cHot = new THREE.Color(0xfff4d0), cMid = new THREE.Color(0xffa020), cRed = new THREE.Color(0xc02808), cSmoke = new THREE.Color(0x1a1410), cTmp = new THREE.Color();
  const lastP = new V3(); let headVel = new V3();
  function fireFx(dt) {
    g.updateMatrixWorld(true);
    const mouth = root.worldToLocal((breath || head).getWorldPosition(new V3()));
    headVel.subVectors(mouth, lastP).multiplyScalar(1 / Math.max(dt, 1e-3)); lastP.copy(mouth);
    if (D.fireT > 0) {
      D.fireT -= dt; if (jaw) jaw.rotation.z += .35;   // mouth open while breathing (added on top of the clip pose)
      const n = Math.round(dt * 1000);
      for (let i = 0; i < n; i++) {
        const q = parts[fNext = (fNext + 1) % FN];
        q.p.copy(mouth).addScaledVector(headVel, -dt * Math.random());
        const spread = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(.28);
        q.v.copy(D.fireDir).add(spread).normalize().multiplyScalar(.75 + Math.random() * .45).addScaledVector(headVel, .6);
        q.life = 0; q.max = .38 + Math.random() * .3;
      }
    }
    let heat = 0;
    for (let i = 0; i < FN; i++) {
      const q = parts[i]; if (q.life >= q.max) { fAlpha[i] = 0; fSize[i] = 0; continue; }
      q.life += dt; const k = q.life / q.max;
      q.v.multiplyScalar(1 - dt * 2.6); q.v.y += dt * .35 * k;          // drag, then the hot gas rises
      q.p.addScaledVector(q.v, dt);
      if (k < .7 && D.blocker && D.blocker(q.p)) { q.v.multiplyScalar(-.12); q.v.y += .15; q.life = Math.max(q.life, q.max * .62); }   // your clay stops the fire
      else if (k < .55 && D.onFireAt) D.onFireAt(q.p);
      if (q.p.y < .002) { q.p.y = .002; q.v.y = Math.abs(q.v.y) * .2; q.v.x *= 1.05; q.v.z *= 1.05; }   // splashes across the real table
      fPos[i * 3] = q.p.x; fPos[i * 3 + 1] = q.p.y; fPos[i * 3 + 2] = q.p.z;
      if (k < .25) cTmp.copy(cHot).lerp(cMid, k / .25); else if (k < .6) cTmp.copy(cMid).lerp(cRed, (k - .25) / .35); else cTmp.copy(cRed).lerp(cSmoke, (k - .6) / .4);
      fCol[i * 3] = cTmp.r; fCol[i * 3 + 1] = cTmp.g; fCol[i * 3 + 2] = cTmp.b;
      fSize[i] = .005 + k * .04; fAlpha[i] = k < .6 ? 1 - k * .5 : (1 - k) * 1.2;
      if (k < .5) heat++;
    }
    fGeo.attributes.position.needsUpdate = fGeo.attributes.color.needsUpdate = fGeo.attributes.size.needsUpdate = fGeo.attributes.alpha.needsUpdate = true;
    fireLight.intensity = Math.min(1, heat / 120) * (.5 + Math.random() * .25); fireLight.position.copy(mouth).addScaledVector(D.fireDir, .08);
  }
  function pose(dt) {
    mixer.update(dt);
    for (const q of pin) { const y = q.b.position.y; q.b.position.copy(q.p); q.b.position.y += (y - q.p.y) * .15; }
    fireFx(dt);
    g.position.copy(D.p); g.rotation.set(0, D.yaw + D.forwardFix, 0); holder.rotation.set(0, 0, D.bank);
    aFly.weight += ((D.mode === 'run' ? 0 : 1) - aFly.weight) * Math.min(1, dt * 4); aRun.weight = 1 - aFly.weight;
    aFly.timeScale = D.mode === 'perch' ? .7 : 1;
  }

  // ---------------------------------------------------------------- the brain (host)
  D.step = (hands, headLocal, dt, foes = []) => {
    D.t += dt; roarCool -= dt;
    const live = hands.filter(h => !h.stale);
    const palm = live.find(h => h.palmN.y > .75 && h.palmVel.length() < .15 && h.palm.y > .05);
    palmT = palm ? palmT + dt : 0;
    // a finger darting at the head = fire at it
    if (head && D.fireT <= 0 && roarCool <= 0) {
      const hp = root.worldToLocal(head.getWorldPosition(tmp2));
      for (const h of live) if (h.spd[8] > .5 && h.pts[8].distanceTo(hp) < .09) { D.breathe(new V3().subVectors(h.pts[8], hp)); roarCool = 2.5; break; }
    }
    if (D.mode === 'script') {   // the game drives it: fly to D.goal, look at D.face
      const d = steerTo(D.goal, dt, .3, 3);
      if (d < .03 && D.face) { const want = Math.atan2(D.face.x - D.p.x, D.face.z - D.p.z); let dy = want - D.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; D.yaw += dy * Math.min(1, dt * 3); D.p.y = D.goal.y + Math.sin(D.t * 3) * .005; }
      pose(dt); return;
    }
    if (D.mode !== 'perch' && palmT > .6 && D.mode !== 'run') { D.mode = 'come'; D.target = palm; }
    if (D.mode === 'come' || D.mode === 'perch') {
      const h = D.target; if (!h || h.stale || h.gone || h.palmN.y < .45) { D.mode = 'fly'; }
      else {
        const goal = tmp2.copy(h.palm).add(new V3(0, .07, 0));
        const d = steerTo(goal, dt, .45, 4);
        if (d < .03) { D.mode = 'perch';
          // face the player while hovering over the hand
          const want = Math.atan2(headLocal.x - D.p.x, headLocal.z - D.p.z); let dy = want - D.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; D.yaw += dy * Math.min(1, dt * 2);
          D.p.y = goal.y + Math.sin(D.t * 3) * .006;
        }
      }
    }
    else if (D.mode === 'fly') {
      const a = D.t * .45, r = .2;
      const goal = new V3(Math.sin(a) * r, .2 + Math.sin(D.t * .7) * .04, Math.cos(a) * r);
      // hunting: burn a mech now and then
      const foe = foes.find(f => f.act !== 'down');
      if (foe && roarCool <= 0 && Math.random() < dt * .15) { const hp = root.worldToLocal(head.getWorldPosition(new V3())); D.breathe(new V3().subVectors(foe.p.clone().setY(.03), hp)); roarCool = 6; if (D.onBurn) setTimeout(() => D.onBurn(foe), 500); }
      steerTo(goal, dt, .28, 2.5);
      if ((nextLand -= dt) < 0) { D.mode = 'land'; runGoal = new V3((Math.random() - .5) * .25, 0, (Math.random() - .5) * .2); }
    }
    else if (D.mode === 'land') { const d = steerTo(runGoal, dt, .25, 3); if (D.p.y < .01 || d < .02) { D.p.y = 0; D.mode = 'run'; D.runT = 0; runGoal = new V3(-runGoal.x, 0, -runGoal.z); } }
    else if (D.mode === 'run') { D.runT += dt; steerTo(runGoal, dt, .07, 2); D.p.y = 0; if (D.runT > 5 || D.p.distanceTo(runGoal) < .03) { D.mode = 'fly'; nextLand = 25 + Math.random() * 15; } }
    D.p.y = Math.max(0, D.p.y);
    pose(dt);
  };
  D.snap = () => ({ t: 'hdS', p: D.p.toArray().map(v => +v.toFixed(4)), y: +D.yaw.toFixed(3), b: +D.bank.toFixed(3), m: D.mode });
  D.apply = s => { D.tp = new V3().fromArray(s.p); D.ty = s.y; D.bank = s.b; D.mode = s.m; };
  D.puppetStep = dt => { if (D.tp) { D.p.lerp(D.tp, Math.min(1, dt * 12)); let dy = D.ty - D.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; D.yaw += dy * Math.min(1, dt * 12); } pose(dt); };
  D.dispose = () => g.removeFromParent();
  return D;
}
