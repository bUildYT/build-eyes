// bUild sTudio · SHOWCASE FILM (Carnage-style): one feature = one shot + one small caption. Black stage, real app, real strokes.
//  node tools/showcase.mjs [onlyShot]  → _work/showcase/frames/*.jpg  → then tools/showcase_cut.mjs assembles the mp4
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const OUT = '_work/showcase/frames'; fs.mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
if (!only) for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
const W = 1920, H = 1080, FPS = 30;
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H } })).newPage();
p.on('pageerror', e => errs.push(e.message));
await p.goto('https://localhost:8897/studio.html?flat&who=showcase&room=S' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.pf && BE.bp, null, { timeout: 60000 });
// ---- the stage: no UI, no grid, black, a caption layer
await p.evaluate(() => {
  const u = document.getElementById('flatui'); if (u) u.style.visibility = 'hidden';
  const st = document.createElement('style'); st.textContent = `#cap{position:fixed;left:0;right:0;top:12%;text-align:center;font:600 30px/1.3 'Segoe UI',system-ui,sans-serif;letter-spacing:.42em;color:#f2efe8;text-transform:uppercase;pointer-events:none;z-index:99;text-shadow:0 2px 18px #000;transition:none}
  #cap small{display:block;font-size:17px;letter-spacing:.32em;opacity:.62;margin-top:10px}
  #end{position:fixed;inset:0;background:#000;display:none;align-items:center;justify-content:center;flex-direction:column;z-index:100;color:#f2efe8;font-family:'Segoe UI',system-ui,sans-serif}
  #end b{font-size:118px;letter-spacing:.04em;font-weight:800} #end b i{font-style:normal;color:#ffc23a} #end span{margin-top:18px;font-size:22px;letter-spacing:.45em;opacity:.8;text-transform:uppercase}
  body *{visibility:hidden} canvas,#cap,#cap *,#end,#end *{visibility:visible!important} #flatui{display:none!important}`;
  document.head.appendChild(st);
  const c = document.createElement('div'); c.id = 'cap'; document.body.appendChild(c);
  const e = document.createElement('div'); e.id = 'end'; e.innerHTML = '<b>b<i>U</i>ild s<i>T</i>udio</b><span>sculpt + paint in one stroke</span>'; document.body.appendChild(e);
  const env = BE.world.scene.getObjectByName('env'); if (env) env.visible = false;
  const bg = BE.world.scene.background; if (bg && bg.isColor) bg.setHex(0x050505); BE._home = { p: BE.world.camera.position.clone(), t: BE.flat.controls.target.clone() }; BE.world.scene.traverse(o => { if (o.isLight && !o.isAmbientLight) o.intensity *= 1.35; }); BE.world.renderer.toneMappingExposure = 1.15;
  BE.hideHelpers = () => { for (const c of BE.world.camera.children) c.visible = false; for (const c of BE.world.scene.children) if (!c.isLight && c !== BE.root) c.traverse(m => { if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.visible = false); }); for (const c of BE.root.children) if (!BE.objs.includes(c) && !c.isLight) c.traverse(m => { if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.visible = false); }); BE.world.scene.traverse(o => { if (o.material && o.material.color && o.material.opacity === .07) o.visible = false; if (o.isGroup && o.children.some(c => c.isLine)) o.visible = false; if (o.isLine || o.isLineSegments) o.visible = false; }); };
  BE.cap = (t, s, a = 1) => { const c = document.getElementById('cap'); c.innerHTML = t ? t + (s ? '<small>' + s + '</small>' : '') : ''; c.style.opacity = a; };
});
let n = 0;
const frame = async () => { await p.evaluate(() => BE.hideHelpers()); await p.screenshot({ path: `${OUT}/f_${String(++n).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 }); };
const cap = (t, s, a) => p.evaluate(([t, s, a]) => BE.cap(t, s, a), [t, s, a]);
const clean = () => p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { layersOpen: false, brushOpen: false, mirror: false, wild: false, tone: 'reptile' }); });
const set = o => p.evaluate(o => { Object.assign(BE.S, o); BE.setTool(o.tool || 'chaos'); }, o.size ? { ...o, size: o.size * Z } : o);
// a stroke, filmed: one frame every `per` mouse steps
async function stroke(pts, steps = 12, per = 1) {
  await p.mouse.move(...pts[0]); await p.mouse.down(); let k = 0;
  for (const q of pts.slice(1)) { const from = pts[pts.indexOf(q) - 1];
    for (let i = 1; i <= steps; i++) { await p.mouse.move(from[0] + (q[0] - from[0]) * i / steps, from[1] + (q[1] - from[1]) * i / steps); if (++k % per === 0) await frame(); } }
  await p.mouse.up(); await p.waitForTimeout(120); await frame();
}
// camera: orbit around the work (yaw/pitch in rad, distance × frame radius), eased over `sec`
async function orbit(sec, a0, a1, e0, e1, d0, d1, cb) {
  const N = Math.round(sec * FPS);
  for (let i = 0; i < N; i++) {
    const t = N > 1 ? i / (N - 1) : 1, k = t * t * (3 - 2 * t);
    await p.evaluate(([a, e, d]) => {
      const objs = BE.objs; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const o of objs) { o.updateMatrixWorld(true); o.traverse(m => { if (!m.geometry || !m.geometry.boundingBox) { if (m.geometry) m.geometry.computeBoundingBox(); else return; } const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); mn = [Math.min(mn[0], bb.min.x), Math.min(mn[1], bb.min.y), Math.min(mn[2], bb.min.z)]; mx = [Math.max(mx[0], bb.max.x), Math.max(mx[1], bb.max.y), Math.max(mx[2], bb.max.z)]; }); }
      if (!BE._c) BE._c = mn[0] < 1e8 ? { c: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], r: Math.max(.05, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * .5) } : { c: [0, 1, -.4], r: .2 };
      const { c, r } = BE._c, cam = BE.world.camera, R = r * d * 2.2;
      cam.position.set(c[0] + Math.sin(a) * Math.cos(e) * R, c[1] + Math.sin(e) * R, c[2] + Math.cos(a) * Math.cos(e) * R); cam.lookAt(c[0], c[1], c[2]);
      BE.flat.controls.target.set(c[0], c[1], c[2]);
    }, [BE_a(a0, a1, k), e0 + (e1 - e0) * k, d0 + (d1 - d0) * k]);
    if (cb) await cb(t);
    await frame();
  }
}
const BE_a = (a, b, k) => a + (b - a) * k;
const resetFrame = () => p.evaluate(() => { BE._c = null; });
const hold = async (sec, cb) => { for (let i = 0, N = Math.round(sec * FPS); i < N; i++) { if (cb) await cb(i / N); await frame(); } };
const fadeCap = async (t, s, sec = .4) => { for (let i = 0; i <= 6; i++) { await cap(t, s, i / 6); } };
// the drawing view (the one the strokes were designed for)
const Z = .5;   // drawing camera 2× closer + every size ×Z → same creature, fills the frame
const homeCam = () => p.evaluate(Z => { BE.world.camera.position.copy(BE._home.p).sub(BE._home.t).multiplyScalar(Z).add(BE._home.t); BE.flat.controls.target.copy(BE._home.t); BE.world.camera.lookAt(BE._home.t); BE.flat.controls.update(); BE._c = null; }, Z);
const S12 = (x, y) => [x * 1.2, y * 1.2];


// ---- drawing a real creature: views around the mirror plane, strokes given in metres on that view's plane
//  side = from +x (screen right = head = −z) · front = from −z (looking at the face) · c = [x? , y, z] plane centre (x = mirror plane)
const D = .45;
async function view(kind, y, z) {
  return p.evaluate(([kind, y, z, D]) => {
    const r = BE.root.getWorldPosition(BE.world.camera.position.clone()), cam = BE.world.camera, t = r.clone(); t.y += y; t.z += z;
    if (kind === 'side') cam.position.set(t.x + D, t.y, t.z); else cam.position.set(t.x, t.y + .0001, t.z - D);
    cam.lookAt(t); BE.flat.controls.target.copy(t); BE.flat.controls.update(); BE._c = null;
    return { ppm: innerHeight / (2 * D * Math.tan(cam.fov * Math.PI / 360)) };
  }, [kind, y, z, D]);
}
async function strokeM(v, pts, size, film = true, steps = 9, per = 1) {
  await p.evaluate(s => { BE.S.size = s; }, size);
  const px = pts.map(([a, b]) => [W / 2 + a * v.ppm, H / 2 - b * v.ppm]);
  if (film) return stroke(px, steps, per);
  await p.mouse.move(...px[0]); await p.mouse.down(); for (const q of px.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); await p.waitForTimeout(60);
}
async function buildDragon(film) {
  await clean(); await p.evaluate(() => { Object.assign(BE.S, { recipe: 'dragon', mirror: true, chaos: .3, wild: false }); BE.setTool('chaos'); });
  let v = await view('side', 0, 0);
  if (film) await hold(.4);
  await strokeM(v, [[-.06, 0], [-.01, .006], [.04, .004]], .011, film, 9);                 // body
  await strokeM(v, [[.04, .004], [.07, .035], [.085, .07]], .0068, film, 8);               // neck rises
  await strokeM(v, [[.085, .07], [.105, .074], [.128, .066]], .0058, film, 7);             // head
  await strokeM(v, [[-.06, 0], [-.1, -.018], [-.15, -.012], [-.19, .015], [-.205, .04]], .0062, film, 7, 2);   // tail curls up
  for (const [z, top] of [[-.032, 1], [.045, 0]]) {                                       // front legs at the shoulders, hind legs at the hips
    v = await view('front', 0, z);
    await strokeM(v, [[.018, -.004], [.042, -.022], [.048, -.052]], top ? .0048 : .0056, film, 7);
  }
}

const SHOTS = {
  // 1. HOOK: the dragon grows, scales + colour + dirt arrive in the same stroke
  async dragon() {
    await cap('one stroke', 'sculpt + paint + scales + dirt · at once');
    await buildDragon(true);
    await cap('');
    await resetFrame(); await orbit(3.2, -1.9, -.9, .3, .2, 1.1, .9);
  },
  // 2. macro: every scale its own
  async macro() {
    await cap('every scale its own', 'shade · wear · dirt · scars');
    await orbit(3, -.9, -.4, .2, .1, .62, .5);
  },
  // 3. AGE: one slider, clean hatchling → ancient beast
  async age() {
    await cap('age', 'clean → ancient');
    await orbit(4, -.4, -.05, .1, .2, .5, .58, async t => { await p.evaluate(g => { const o = BE.objs.find(o => o.userData.sculpt); o.userData.sculpt.setSkin({ ...o.userData.rec.skin, g }); }, t); });
    await hold(.5);
  },
  async snake() {
    await clean(); await homeCam(); await set({ recipe: 'snake', size: .013, chaos: .25, tool: 'chaos' }); await cap('snake');
    await stroke([S12(520, 330), S12(680, 260), S12(840, 360), S12(1000, 270), S12(1160, 340)], 8);
    await resetFrame(); await orbit(2.4, .2, -.25, .4, .3, .85, .7);
  },
  async croc() {
    await clean(); await homeCam(); await set({ recipe: 'croc', size: .02, chaos: .3, tool: 'chaos' }); await cap('croc');
    await stroke([S12(560, 470), S12(760, 450), S12(960, 480), S12(1160, 460)], 9);
    await resetFrame(); await orbit(2.4, -.3, .2, .5, .35, .8, .62);
  },
  async mountain() {
    await clean(); await homeCam(); await set({ recipe: 'mountain', size: .03, chaos: .7, tool: 'chaos' }); await cap('mountains', 'ridges · terraces · grass · snow');
    await stroke([S12(600, 520), S12(760, 440), S12(880, 470), S12(1040, 420), S12(1150, 500)], 8);
    await resetFrame(); await orbit(2.6, .4, -.1, .55, .4, .9, .75);
  },
  async coral() {
    await clean(); await homeCam(); await set({ recipe: 'coral', size: .02, chaos: .6, tool: 'chaos' }); await cap('branches');
    await stroke([S12(640, 560), S12(800, 470), S12(960, 500), S12(1100, 430)], 8);
    await resetFrame(); await orbit(2.4, -.2, .3, .35, .25, .9, .75);
  },
  async crystal() {
    await clean(); await homeCam(); await set({ recipe: 'crystal', size: .02, chaos: .5, tool: 'chaos', mat: 'clay' }); await cap('crystals');
    await stroke([S12(640, 520), S12(820, 470), S12(1000, 500), S12(1120, 460)], 8);
    await resetFrame(); await orbit(2.4, .3, -.2, .4, .3, .85, .7);
  },
  async cut() {
    await clean(); await homeCam(); await set({ recipe: 'lava', size: .03, chaos: .5, tool: 'chaos' });
    await stroke([S12(640, 480), S12(820, 450), S12(1000, 480), S12(1120, 450)], 6, 3);
    await resetFrame(); await cap('cuts reveal the inside');
    // chisel facets: planes swept through the lava rock, filmed as they cut
    await orbit(.6, .1, .15, .45, .45, .8, .8);
    for (let k = 0; k < 4; k++) {
      await p.evaluate(k => { const o = BE.objs.find(o => o.userData.sculpt), sc = o.userData.sculpt, V = o.position.constructor;
        let mn = new V(1e9, 1e9, 1e9), mx = new V(-1e9, -1e9, -1e9); for (const ch of sc.chunks.values()) if (ch.mesh) { const bb = ch.mesh.geometry.boundingBox; mn.min(bb.min); mx.max(bb.max); }
        const c = mn.clone().add(mx).multiplyScalar(.5), ang = k * 1.7 + .4, n = new V(Math.sin(ang), .55, Math.cos(ang)).normalize(), size = mx.clone().sub(mn).length();
        sc.begin(); sc.planeCut(c.clone().addScaledVector(n, size * .14), n, size * .55, .1); sc.end(); }, k);
      await orbit(.5, .15 + k * .12, .27 + k * .12, .45, .45, .8, .8);
    }
    await orbit(1.2, .63, .9, .45, .35, .8, .7);
  },
  async wild() {
    await clean(); await homeCam(); await set({ wild: true, size: .014, chaos: .7, tool: 'chaos' }); await cap('wild', 'every stroke a different creature');
    const L = [[[520, 300], [640, 260], [760, 310]], [[820, 300], [940, 240], [1060, 300]], [[540, 560], [680, 520], [800, 560]], [[860, 560], [1000, 520], [1140, 570]], [[700, 430], [850, 400], [980, 430]]];
    for (const s of L) await stroke(s.map(q => S12(...q)), 6, 2);
    await resetFrame(); await orbit(2.4, -.3, .3, .35, .25, .85, .75);
  },
  async end() {
    await cap('');
    await buildDragon(false);
    await p.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt); o.userData.sculpt.setSkin({ ...o.userData.rec.skin, g: .65 }); });
    await resetFrame(); await cap('vr · phone · pc · blender', 'one link · live in sync');
    await orbit(4, -1.2, .2, .28, .16, 1.05, .9);
    await cap(''); await p.evaluate(() => { document.getElementById('end').style.display = 'flex'; });
    await hold(2.6);
    await p.evaluate(() => { document.getElementById('end').style.display = 'none'; });
  },
};
const order = only ? only.split(',') : Object.keys(SHOTS);
for (const k of order) { const n0 = n; await SHOTS[k](); console.log(`  ${k}: ${n - n0} frames (${((n - n0) / FPS).toFixed(1)} s)`); }
console.log('total', n, 'frames =', (n / FPS).toFixed(1), 's · errors:', errs.length ? errs.slice(0, 4) : 'none');
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
