// bUild eYes · CHALLENGES: a scenario on your real table → you bUild with clay → the game TESTS what you built → score.
//  palm menu: 🎯 = next challenge · ▶ = test it · ↺ = again
//  score = FUNCTION (does it work?) 60 % + LOOKS (symmetry, colours, detail) 30 % + EFFICIENCY 10 % → medal
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Mech } from './mechs.js';
const V3 = THREE.Vector3;

export const CHALLENGES = [
  { id: 'bridge', icon: '🌉', name: 'THE BRIDGE BROKE', goal: 'Build a bridge between the cliffs. 3 bots must walk across.', props: ['cliffs', 'broken'] },
  { id: 'glider', icon: '✈', name: 'FLY ACROSS', goal: 'The bridge is gone for good. Sculpt a glider (wide wings!) — a bot rides it from the left cliff.', props: ['cliffs'] },
  { id: 'dragon', icon: '🏰', name: 'DRAGON ATTACK', goal: 'The dragon wants the 3 villagers. Build a wall between them and the dragon.', props: ['village'] },
  { id: 'arena', icon: '⚔', name: 'ONE AGAINST THREE', goal: 'GOLD fights alone against 3 WHITE. Build cover so GOLD survives 25 s.', props: [] },
  { id: 'lava', icon: '🌋', name: 'THE FLOOR IS LAVA', goal: 'Lava is rising! Build a tower — the bot climbs to its top.', props: [] },
  { id: 'tame', icon: '🐉', name: 'TAME THE DRAGON', goal: 'Hold your palm up, still. Let the dragon hover on your hand for 5 s.', props: [] },
];
const BASE_Y = .22 - .004;   // where clay.js parks the marching-cubes box (L/2 - 4 mm)
const LAUNCH = .055;   // the glider leaves from a wooden tower on the left cliff
const CLIFF = { x0: .065, x1: .2, top: .08, w: .16 };   // two cliffs: x ∈ ±[x0, x1], z ∈ ±w/2

export function createChallenges({ root, clay, mechs, getHero, W, say = () => {}, sfx, host = true }) {
  const G = { i: -1, phase: 'off', t: 0, score: null, walkers: [], lava: null, onEvent: null };
  const props = new THREE.Group(); root.add(props);
  const rock = new THREE.MeshStandardMaterial({ color: 0x75685a, roughness: .92 }), grass = new THREE.MeshStandardMaterial({ color: 0x4f8a3a, roughness: .85 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: .8 });
  const lavaMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff4a10, emissiveIntensity: 1.6, roughness: .4, transparent: true, opacity: .92 });

  // ---------------------------------------------------------------- scoreboard (floats behind the table, faces you)
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 640; const g2 = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(.32, .2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  board.position.set(0, .3, -.16); board.renderOrder = 12; board.visible = false; root.add(board);
  function drawBoard(lines) {
    g2.clearRect(0, 0, 1024, 640); g2.fillStyle = 'rgba(8,8,10,.78)'; g2.beginPath(); g2.roundRect(4, 4, 1016, 632, 40); g2.fill();
    g2.strokeStyle = '#ffc23a88'; g2.lineWidth = 4; g2.stroke(); g2.textAlign = 'center';
    let y = 92;
    for (const l of lines) { g2.fillStyle = l.c || '#fff'; g2.font = `${l.w || 600} ${l.s || 44}px system-ui`; g2.fillText(l.t, 512, y); y += (l.s || 44) * 1.35; }
    tex.needsUpdate = true; board.visible = true;
  }
  const stars = k => '★★★★★'.slice(0, Math.round(k * 5)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(k * 5));

  // ---------------------------------------------------------------- props
  function build(c) {
    props.clear(); G.lava = null;
    if (c.props.includes('cliffs')) for (const s of [-1, 1]) {
      const w = CLIFF.x1 - CLIFF.x0, m = new THREE.Mesh(new RoundedBoxGeometry(w, CLIFF.top, CLIFF.w, 3, .008), rock); m.position.set(s * (CLIFF.x0 + w / 2), CLIFF.top / 2, 0); m.castShadow = m.receiveShadow = true; props.add(m);
      const t = new THREE.Mesh(new RoundedBoxGeometry(w + .004, .008, CLIFF.w + .004, 2, .003), grass); t.position.set(s * (CLIFF.x0 + w / 2), CLIFF.top, 0); t.receiveShadow = true; props.add(t);
    }
    if (c.id === 'glider') { const t = new THREE.Mesh(new THREE.BoxGeometry(.03, LAUNCH, .03), wood); t.position.set(-.15, CLIFF.top + LAUNCH / 2, 0); t.castShadow = true; props.add(t); }
    if (c.props.includes('broken')) for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {   // snapped planks hanging off the edges
      const p = new THREE.Mesh(new THREE.BoxGeometry(.022, .004, .05), wood); p.position.set(s * (CLIFF.x0 - .008 - k * .004), CLIFF.top - .012 - k * .018, (k - 1) * .012); p.rotation.set((k - 1) * .2, 0, s * (1.1 + k * .15)); p.castShadow = true; props.add(p);
    }
    if (c.props.includes('village')) for (const s of [-1, 0, 1]) {   // three little huts behind the villagers
      const h = new THREE.Mesh(new RoundedBoxGeometry(.03, .025, .03, 2, .003), new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: .9 })); h.position.set(.17, .0125, s * .05); h.castShadow = true; props.add(h);
      const r = new THREE.Mesh(new THREE.ConeGeometry(.025, .02, 4), new THREE.MeshStandardMaterial({ color: 0x8a3020, roughness: .8 })); r.position.set(.17, .035, s * .05); r.rotation.y = Math.PI / 4; r.castShadow = true; props.add(r);
    }
    if (c.id === 'lava') { G.lava = new THREE.Mesh(new THREE.PlaneGeometry(.42, .42, 24, 24), lavaMat); G.lava.rotation.x = -Math.PI / 2; G.lava.position.y = .001; props.add(G.lava); }
  }
  const clearWalkers = () => { G.walkers.forEach(w => w.dispose()); G.walkers = []; };
  function walker(team, x, y, z, yaw) { const m = new Mech(root, team, 900 + G.walkers.length); m.p.set(x, y, z); m.yaw = yaw; m.act = 'idle'; G.walkers.push(m); return m; }

  // ---------------------------------------------------------------- flow
  G.start = (i = (G.i + 1) % CHALLENGES.length) => {
    G.i = i; const c = CHALLENGES[i]; G.phase = 'build'; G.t = 0; G.score = null; G.res = {};
    clay.clear(); clay.mc.position.set(0, clay.mc.position.y, 0); clay.mc.rotation.set(0, 0, 0); clearWalkers(); build(c);
    mechs.clear(); mechs.paused = true; mechs.blocker = clay.solid;
    const hero = getHero(); if (hero) { hero.blocker = clay.solid; hero.onFireAt = null; hero.mode = 'fly'; hero.g.visible = c.id === 'dragon' || c.id === 'tame'; }
    // the cast for each scenario
    if (c.id === 'bridge') for (let k = 0; k < 3; k++) walker('gold', -.17 + k * .018, CLIFF.top + .004, (k - 1) * .035, Math.PI / 2);
    if (c.id === 'glider') walker('gold', -.15, CLIFF.top + LAUNCH, 0, Math.PI / 2);
    if (c.id === 'dragon') for (let k = 0; k < 3; k++) walker('white', .13, 0, (k - 1) * .05, -Math.PI / 2);
    if (c.id === 'arena') { const gm = mechs.add('gold', new V3(-.12, 0, 0)); gm.hp = 140; gm.hold = true; for (let k = 0; k < 3; k++) mechs.add('white', new V3(.13, 0, (k - 1) * .06)); mechs.list.forEach(m => { m.act = 'idle'; m.actT = 0; }); }
    if (c.id === 'lava') walker('gold', 0, 0, .1, Math.PI);
    if (c.id === 'tame') { G.phase = 'test'; G.res.perch = 0; }
    else clay.setMode('build');
    drawBoard([{ t: `${c.icon}  ${c.name}`, s: 58, c: '#ffc23a' }, ...wrap(c.goal, 34).map(t => ({ t, s: 36, w: 400 })), { t: c.id === 'tame' ? 'go!' : 'build with clay · then ▶ on your palm = TEST', s: 30, c: '#9a9', w: 400 }]);
    say(`${c.icon} ${c.name}`, 3); sfx && sfx.chirp && sfx.chirp('curious', 1);
    emit();
  };
  G.retry = () => G.start(G.i);
  G.test = () => {
    if (G.phase !== 'build') return;
    const c = CHALLENGES[G.i]; G.phase = 'test'; G.t = 0; clay.setMode('play'); G.stats = clay.stats();
    if (!G.stats.balls && c.id !== 'arena') { say('build something first!', 2); G.phase = 'build'; clay.setMode('build'); return; }
    if (c.id === 'glider') launchGlider();
    if (c.id === 'dragon') { const hero = getHero(); if (hero) { hero.g.visible = true; hero.mode = 'script'; hero.goal = new V3(-.07, .1, 0); hero.face = new V3(.13, .02, 0); G.res.burn = [0, 0, 0]; hero.onFireAt = p => G.walkers.forEach((w, k) => { if (w.act !== 'down' && p.distanceTo(new V3(w.p.x, .025, w.p.z)) < .022) { G.res.burn[k] += 1; if (G.res.burn[k] > 10) { w.act = 'down'; w.actT = 0; sfx && sfx.crack && sfx.crack(); } } }); } }
    if (c.id === 'arena') mechs.paused = false;
    if (c.id === 'lava') { G.res.top = highest(); }
    drawBoard([{ t: `${c.icon}  TESTING…`, s: 58, c: '#ffc23a' }]);
    emit();
  };
  function highest() { let best = { y: -1, x: 0, z: 0 }; for (let x = -.18; x <= .18; x += .01) for (let z = -.18; z <= .18; z += .01) { const y = clay.topY(x, z, .4); if (y > best.y) best = { y, x, z }; } return best; }
  let glide = null;
  function launchGlider() {
    const s = G.stats, ctr = s.min.clone().add(s.max).multiplyScalar(.5);
    const span = s.size.z, len = Math.max(.02, s.size.x), thick = s.size.y;
    const aspect = span / len, sym = s.symZ;
    const ratio = THREE.MathUtils.clamp((.6 + aspect * 1.5 - thick / len * .7) * (.35 + .65 * sym) * Math.min(1, span / .08), .3, 5);
    glide = { v: .42, sink: .42 / ratio, wob: (1 - sym) * .9, ratio, x: -.15, y: CLIFF.top + LAUNCH, ctrX: ctr.x, ctrZ: ctr.z, minY: s.min.y, cY: (s.min.y + s.max.y) / 2, done: false, ride: G.walkers[0], rideY: s.max.y - s.min.y };
    G.res.ratio = ratio;
  }

  // ---------------------------------------------------------------- every frame
  G.step = (hands, dt) => {
    if (G.phase === 'off') return;
    G.t += dt; const c = CHALLENGES[G.i];
    if (G.lava) { G.lava.material.emissiveIntensity = 1.4 + Math.sin(G.t * 3) * .25; const pos = G.lava.geometry.attributes.position; for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 60 + G.t * 2) * Math.cos(pos.getY(i) * 50 - G.t * 1.6) * .0015); pos.needsUpdate = true; }
    for (const w of G.walkers) { w.actT += dt; w.pose(dt); }
    if (G.phase !== 'test') return;
    if (c.id === 'bridge') stepBridge(dt);
    if (c.id === 'glider') stepGlider(dt);
    if (c.id === 'dragon') stepDragon(dt);
    if (c.id === 'arena') { const gold = mechs.list.find(m => m.team === 'gold'); if (!gold || gold.act === 'down') finish(G.t / 25 * .6, `GOLD fell after ${G.t.toFixed(1)} s`); else if (G.t > 25) finish(.6 + .4 * gold.hp / 140, `GOLD survived with ${Math.round(gold.hp)} HP`); }
    if (c.id === 'lava') stepLava(dt);
    if (c.id === 'tame') { const hero = getHero(); if (hero && hero.mode === 'perch') G.res.perch += dt; if (G.res.perch >= 5) finish(1, 'it trusts you now', true); else if (G.t > 60) finish(G.res.perch / 5, `${G.res.perch.toFixed(1)} s on your hand`, true); }
  };
  function stepBridge(dt) {
    let done = true, crossed = 0;
    for (const w of G.walkers) {
      if (w.res) { if (w.res === 'over') crossed++; continue; }
      done = false;
      if (w.act === 'fall') { w.vy -= 9.8 * dt; w.p.y += w.vy * dt; if (w.p.y <= 0) { w.p.y = 0; w.act = 'down'; w.actT = 0; w.res = 'fell'; sfx && sfx.crack && sfx.crack(); } continue; }
      const nx = w.p.x + .035 * dt;
      const onCliff = Math.abs(nx) >= CLIFF.x0 ? CLIFF.top : -1;
      const ty = clay.topY(nx, w.p.z, w.p.y + .028);
      const sup = Math.max(onCliff, ty >= 0 ? ty : -1);
      if (sup < w.p.y - .035) { w.act = 'fall'; w.vy = 0; w.p.x = nx; continue; }                // nothing under its feet
      if (sup > w.p.y + .022) { w.stuck = (w.stuck || 0) + dt; w.walkAmt = .2; if (w.stuck > 4) { w.res = 'stuck'; w.act = 'idle'; } continue; }   // a wall
      w.p.x = nx; w.p.y += (Math.max(sup, 0) - w.p.y) * Math.min(1, dt * 12); w.walkAmt = 1; w.phase += dt * 11;
      if (w.p.x > CLIFF.x0 + .03) { w.res = 'over'; w.walkAmt = 0; sfx && sfx.chirp && sfx.chirp('happy', .6); }
    }
    if (done) { const s = G.stats; finish(crossed / 3, `${crossed}/3 bots made it across`, false, THREE.MathUtils.clamp(1 - (s.balls - 30) / 220, 0, 1)); }
  }
  function stepGlider(dt) {
    const gl = glide; if (!gl || gl.done) return;
    gl.x += gl.v * dt; gl.y -= gl.sink * dt;
    const roll = Math.sin(G.t * 5) * gl.wob * .5, pitch = -Math.atan2(gl.sink, gl.v);
    // rotate about the glider's own centre, then put that centre on the flight path
    const B = new V3(0, BASE_Y, 0), c = new V3(gl.ctrX, gl.cY, gl.ctrZ), T = new V3(gl.x, gl.y + (gl.cY - gl.minY), 0);
    clay.mc.rotation.set(roll, 0, pitch); const q = new THREE.Quaternion().setFromEuler(clay.mc.rotation);
    clay.mc.position.copy(T).sub(c.sub(B).applyQuaternion(q));
    if (gl.ride) { gl.ride.p.set(gl.x, gl.y + gl.rideY, 0); gl.ride.walkAmt = 0; }
    const ground = gl.x > CLIFF.x0 && gl.x < CLIFF.x1 ? CLIFF.top : 0;
    if (gl.y <= ground + .002 || gl.x > .25) {
      gl.done = true; const made = ground === CLIFF.top && gl.y > CLIFF.top - .01;
      const dist = gl.x + .15;
      if (gl.ride) { gl.ride.p.y = ground; if (!made) { gl.ride.act = 'down'; gl.ride.actT = 0; } }
      finish(made ? 1 : Math.min(.7, dist / .3), made ? `landed on the far cliff! glide ratio ${gl.ratio.toFixed(1)}` : `crashed after ${(dist * 100).toFixed(0)} cm · glide ratio ${gl.ratio.toFixed(1)}`, false, THREE.MathUtils.clamp(1 - (G.stats.balls - 40) / 250, 0, 1));
    }
  }
  function stepDragon(dt) {
    const hero = getHero(); if (!hero) return finish(0, 'no dragon loaded');
    if ([3, 5.5, 8, 10.5].some(t => G.t > t && G.t - dt <= t)) { const m = hero.mouth(); hero.breathe(new V3(.13, .02, (Math.random() - .5) * .08).sub(m), 1.6); }
    if (G.t > 13.5) { hero.mode = 'fly'; hero.onFireAt = null; const alive = G.walkers.filter(w => w.act !== 'down').length; finish(alive / 3, `${alive}/3 villagers safe`, false, THREE.MathUtils.clamp(1 - (G.stats.balls - 40) / 250, 0, 1)); }
  }
  function stepLava(dt) {
    const lv = Math.min(.12, Math.max(0, G.t - 4) * .007); G.lava.position.y = lv + .001;
    const w = G.walkers[0], top = G.res.top;
    if (w.act !== 'down') {   // climb to the tower's top
      const to = new V3(top.x, top.y >= 0 ? top.y : 0, top.z), d = Math.hypot(to.x - w.p.x, to.z - w.p.z);
      if (d > .01) { w.yaw = Math.atan2(to.x - w.p.x, to.z - w.p.z); w.p.x += Math.sin(w.yaw) * .04 * dt; w.p.z += Math.cos(w.yaw) * .04 * dt; w.walkAmt = 1; w.phase += dt * 11; }
      else w.walkAmt = 0;
      const ty = clay.topY(w.p.x, w.p.z, w.p.y + .03); w.p.y += ((ty >= 0 ? ty : 0) - w.p.y) * Math.min(1, dt * 8);
      if (w.p.y < lv - .005) { w.act = 'down'; w.actT = 0; W && W.fx && W.fx.spark(w.p.clone().setY(lv), 0xff5a10, 30); sfx && sfx.crack && sfx.crack(); }
    }
    if (w.act === 'down') finish(Math.min(.6, Math.max(0, G.t - 4) / 18 * .6), `the lava got it after ${G.t.toFixed(0)} s`, false, .5);
    else if (G.t > 23) finish(1, `dry at ${(w.p.y * 100).toFixed(0)} cm — lava stopped at 12 cm`, false, THREE.MathUtils.clamp(1 - (G.stats.balls - 40) / 250, 0, 1));
  }
  function looks() {
    const s = G.stats; if (!s || !s.balls) return 0;
    const sym = Math.max(s.symZ, s.symX), col = s.colors >= 3 ? 1 : s.colors === 2 ? .8 : .35, det = Math.min(1, s.strokes / 6), carve = s.carves ? 1 : 0;
    return (sym * .45 + col * .25 + det * .2 + carve * .1) * Math.min(1, s.balls / 25);
  }
  function finish(fn, why, noLooks = false, eff = .7) {
    if (G.phase !== 'test') return;
    G.phase = 'score'; const lk = noLooks ? fn : looks(); const total = Math.round((fn * .6 + lk * .3 + eff * .1) * 100);
    const medal = total >= 80 ? ['GOLD', '#ffc23a'] : total >= 60 ? ['SILVER', '#d8dde3'] : total >= 40 ? ['BRONZE', '#d08a4a'] : ['TRY AGAIN', '#e66'];
    G.score = { fn, lk, eff, total, medal: medal[0], why };
    const c = CHALLENGES[G.i], s = G.stats || {};
    drawBoard([
      { t: `${c.icon}  ${medal[0]}  ·  ${total}`, s: 64, c: medal[1], w: 800 }, { t: why, s: 34, w: 400 },
      { t: `function ${stars(fn)}`, s: 40 }, ...(noLooks ? [] : [{ t: `looks ${stars(lk)}`, s: 40 }, { t: `${s.colors || 0} colours · symmetry ${Math.round(Math.max(s.symZ || 0, s.symX || 0) * 100)}% · ${s.strokes || 0} strokes`, s: 28, c: '#aaa', w: 400 }]),
      { t: '🎯 next · ↺ again', s: 30, c: '#9a9', w: 400 },
    ]);
    say(`${medal[0]} · ${total} points`, 4); sfx && sfx.chirp && sfx.chirp(total >= 60 ? 'happy' : 'sad', 1.2);
    if (glide) setTimeout(() => { if (G.phase === 'score') { clay.mc.position.set(0, BASE_Y, 0); clay.mc.rotation.set(0, 0, 0); } }, 2500);
    emit();
  }
  G.face = headLocal => { board.lookAt(root.localToWorld(headLocal.clone())); };
  G.stop = () => { G.phase = 'off'; props.clear(); clearWalkers(); board.visible = false; mechs.paused = false; clay.mc.position.set(0, BASE_Y, 0); clay.mc.rotation.set(0, 0, 0); };
  // ---------------------------------------------------------------- EYEs: same props + walkers + board state
  const emit = () => { if (G.onEvent) G.onEvent({ t: 'ch', i: G.i, phase: G.phase, score: G.score }); };
  G.snap = () => ({ t: 'chS', w: G.walkers.map(w => [+w.p.x.toFixed(4), +w.p.y.toFixed(4), +w.p.z.toFixed(4), +w.yaw.toFixed(2), w.act, +w.walkAmt.toFixed(2), +w.phase.toFixed(2), w.team]), m: [clay.mc.position.toArray(), clay.mc.rotation.x, clay.mc.rotation.z], l: G.lava ? G.lava.position.y : 0 });
  G.apply = m => {
    if (m.t === 'ch') { if (m.i !== G.i) { G.i = m.i; build(CHALLENGES[m.i]); clearWalkers(); } G.phase = m.phase === 'off' ? 'off' : 'view'; const c = CHALLENGES[m.i]; drawBoard(m.score ? [{ t: `${c.icon}  ${m.score.medal} · ${m.score.total}`, s: 64, c: '#ffc23a' }, { t: m.score.why, s: 34, w: 400 }] : [{ t: `${c.icon}  ${c.name}`, s: 58, c: '#ffc23a' }, ...wrap(c.goal, 34).map(t => ({ t, s: 36, w: 400 }))]); }
    if (m.t === 'chS') {
      while (G.walkers.length < m.w.length) walker(m.w[G.walkers.length][7], 0, 0, 0, 0);
      while (G.walkers.length > m.w.length) G.walkers.pop().dispose();
      m.w.forEach((r, k) => { const w = G.walkers[k]; w.p.set(r[0], r[1], r[2]); w.yaw = r[3]; if (w.act !== r[4]) w.actT = 0; w.act = r[4]; w.walkAmt = r[5]; w.phase = r[6]; });
      clay.mc.position.fromArray(m.m[0]); clay.mc.rotation.set(m.m[1], 0, m.m[2]); if (G.lava) G.lava.position.y = m.l;
    }
  };
  G.viewStep = dt => { for (const w of G.walkers) { w.actT += dt; w.pose(dt); } };
  return G;
}
function wrap(s, n) { const out = []; let line = ''; for (const w of s.split(' ')) { if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; } else line += ' ' + w; } if (line.trim()) out.push(line.trim()); return out; }
