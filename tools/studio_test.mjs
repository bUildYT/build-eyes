// bUild sTudio · headless playtest in the Quest 3 emulator: draw, mirror, shape, clay, carve, paint, grab, world-scale, palette, undo/redo, save → reload.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (/\[studio\]/.test(m.text())) console.log('   page:', m.text()); });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const f of ['_work/studio/scene.json', 'public/share/studio_live.glb']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');

async function enter() {
  await page.goto('https://localhost:8897/studio.html?who=emu', { waitUntil: 'load' });
  await page.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('goMR').hidden, null, { timeout: 60000 });
  await page.evaluate(() => { IWER_DEVICE.primaryInputMode = 'controller'; });
  await page.click('#goMR');
  await page.waitForFunction(() => BE.world && BE.world.renderer.xr.isPresenting, null, { timeout: 30000 });
  await sleep(1200);
  await page.evaluate(() => {
    BE.input.sim = {};
    const r = BE.root; r.updateMatrixWorld();
    window.W = (x, y, z) => r.localToWorld(new THREE_V(x, y, z)).toArray();
    window.drag = (side, a, b, ms = 500, extra = {}) => new Promise(res => {
      const A = W(...a), B = W(...b), t0 = performance.now();
      const iv = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / ms); BE.input.sim[side] = { pos: A.map((v, i) => v + (B[i] - v) * k), trig: 1, ...extra };
        if (k >= 1) { clearInterval(iv); BE.input.sim[side] = { pos: B, trig: 0, ...extra }; setTimeout(res, 200); } }, 16);
    });
    window.hold = (side, st, ms = 300) => new Promise(res => { BE.input.sim[side] = st; setTimeout(res, ms); });
  });
}
await page.addInitScript(() => { window.THREE_V = null; });
await enter();
// THREE is not global: borrow Vector3 from the root
await page.evaluate(() => { window.THREE_V = BE.root.position.constructor; });
const st = () => page.evaluate(() => BE.devState());

console.log('1 · tube stroke');
await page.evaluate(() => { BE.setTool('tube'); BE.S.mirror = false; });
await page.evaluate(() => drag('R', [-.12, .1, 0], [.12, .16, .02], 700));
let s = await st(); ok(s.objs.length === 1 && /stroke:\d+/.test(s.objs[0]) && +s.objs[0].split(':')[1] > 8, 'tube drawn ' + s.objs);

console.log('2 · ribbon + mirror');
await page.evaluate(() => { BE.setTool('ribbon'); BE.S.mirror = true; });
await page.evaluate(() => drag('R', [.05, .05, -.05], [.15, .2, -.05], 600));
s = await st(); ok(s.objs.length === 3, 'mirror made 2 ribbons → ' + s.objs.length);
const mx = await page.evaluate(() => { const [a, b] = BE.objs.slice(-2).map(o => o.userData.rec.s[0]); return [a[0], b[0]]; });
ok(Math.abs(mx[0] + mx[1]) < .003, 'twin is mirrored across x: ' + mx.map(v => v.toFixed(3)));
await page.evaluate(() => { BE.S.mirror = false; });

console.log('3 · shape box');
await page.evaluate(() => { BE.setTool('shape'); BE.S.prim = 'box'; });
await page.evaluate(() => drag('R', [-.05, 0, .05], [.05, .1, .15], 400));
const box = await page.evaluate(() => { const o = BE.objs.at(-1); return { t: o.userData.rec.type, s: o.scale.toArray(), p: o.position.toArray() }; });
ok(box.t === 'shape' && box.s[0] > .08 && box.s[0] < .11 && box.s[1] > .08, 'box 10 cm ' + box.s.map(v => v.toFixed(3)));

console.log('4 · clay + carve');
await page.evaluate(() => { BE.setTool('clay'); });
await page.evaluate(() => drag('R', [-.2, .05, -.15], [-.1, .1, -.15], 600));
await page.evaluate(() => drag('R', [-.2, .08, -.12], [-.1, .06, -.18], 600));
s = await st(); const clay = s.objs.find(o => o.startsWith('sculpt')); ok(clay && +clay.split(':')[1] > 300, 'sculpt tris ' + clay);
const tris0 = await page.evaluate(() => (() => { const sc = BE.objs.find(o => o.userData.sculpt).userData.sculpt; sc.flush(); let n = 0; for (const ch of sc.chunks.values()) for (const d of ch.d) if (d > 0) n++; return n; })());
await page.evaluate(() => { BE.setTool('carve'); });
await page.evaluate(() => drag('R', [-.16, .08, -.12], [-.14, .08, -.17], 400));
await sleep(200);
const tris1 = await page.evaluate(() => (() => { const sc = BE.objs.find(o => o.userData.sculpt).userData.sculpt; sc.flush(); let n = 0; for (const ch of sc.chunks.values()) for (const d of ch.d) if (d > 0) n++; return n; })());
ok(tris0 > 300 && tris1 < tris0, `sculpt ${tris0} → carved ${tris1} voxels`);

console.log('5 · paint the box (gold) + paint the clay (blue)');
await page.evaluate(() => { BE.setTool('paint'); BE.S.mat = 'gold'; BE.S.color = '#ffc23a'; BE.S.size = .01; });
// point straight at the box from 15 cm in front (+z towards the user = root +z) — the tip direction = -z of the pointer quat in world
await page.evaluate(async () => {
  const o = BE.objs.find(o => (o.userData.rec.type === 'shape' || o.userData.rec.from === 'shape')); o.updateMatrixWorld();
  const c = o.getWorldPosition(new THREE_V()), n = new THREE_V(0, 0, 1).applyQuaternion(BE.root.quaternion);
  const q = BE.root.quaternion.toArray();
  const from = c.clone().addScaledVector(n, .15);
  for (let i = 0; i < 20; i++) { BE.input.sim.R = { pos: from.clone().add(new THREE_V(-.03 + i * .003, 0, 0)).toArray(), quat: q, trig: 1 }; await new Promise(r => setTimeout(r, 30)); }
  BE.input.sim.R = { pos: from.toArray(), quat: q, trig: 0 }; await new Promise(r => setTimeout(r, 200));
});
const painted = await page.evaluate(() => { const o = BE.objs.find(o => (o.userData.rec.type === 'shape' || o.userData.rec.from === 'shape')); return !!o.userData.ts && o.userData.ts.layers.some(l => l.kind === 'paint' && l.ver > 0); });
ok(painted, 'box became a painted mesh with a paint stroke');
await page.evaluate(async () => {
  BE.S.color = '#3a8bff'; BE.S.mat = 'clay';
  const o = BE.objs.find(o => o.userData.sculpt); o.updateMatrixWorld(); const c = BE.root.localToWorld(new THREE_V(-.15, .3, -.15));
  const q = [-.7071, 0, 0, .7071];  // pointing down
  for (let i = 0; i < 15; i++) { BE.input.sim.R = { pos: c.clone().add(new THREE_V(i * .003, 0, 0)).toArray(), quat: q, trig: 1 }; await new Promise(r => setTimeout(r, 30)); }
  BE.input.sim.R = { pos: c.toArray(), quat: q, trig: 0 }; await new Promise(r => setTimeout(r, 200));
});
const dabs = await page.evaluate(() => { const sc = BE.objs.find(o => o.userData.sculpt).userData.sculpt; let n = 0; for (const ch of sc.chunks.values()) for (let i = 0; i < ch.d.length; i++) if (ch.d[i] > -.95 && ch.col[i * 3 + 2] > 200 && ch.col[i * 3] < 120) n++; return n; });
ok(dabs > 0, 'sculpt got blue paint on ' + dabs + ' voxels');

console.log('6 · grab the box, move it 10 cm');
const before = await page.evaluate(() => BE.objs.find(o => (o.userData.rec.type === 'shape' || o.userData.rec.from === 'shape')).position.toArray());
await page.evaluate(() => drag('R', [0, .05, .1], [0, .05, .2], 400, { grip: true }));
await page.evaluate(() => hold('R', { pos: W(0, .05, .2), trig: 0, grip: false }, 200));
const after = await page.evaluate(() => BE.objs.find(o => (o.userData.rec.type === 'shape' || o.userData.rec.from === 'shape')).position.toArray());
ok(Math.abs(after[2] - before[2] - .1) < .01, `box moved z ${before[2].toFixed(3)} → ${after[2].toFixed(3)}`);

console.log('7 · undo / redo');
await page.evaluate(() => BE.undo());
const u = await page.evaluate(() => BE.objs.find(o => (o.userData.rec.type === 'shape' || o.userData.rec.from === 'shape')).position.toArray());
ok(Math.abs(u[2] - before[2]) < .002, 'undo put the box back');
await page.evaluate(() => BE.redo());
const r2 = await page.evaluate(() => BE.objs.find(o => (o.userData.rec.type === 'shape' || o.userData.rec.from === 'shape')).position.toArray());
ok(Math.abs(r2[2] - after[2]) < .002, 'redo moved it again');

console.log('8 · both grips on air = scale the world');
await page.evaluate(async () => {
  const L0 = W(-.35, .4, .3), R0 = W(.35, .4, .3);
  BE.input.sim.L = { pos: L0, grip: true }; BE.input.sim.R = { pos: R0, grip: true }; await new Promise(r => setTimeout(r, 150));
  for (let i = 1; i <= 15; i++) { BE.input.sim.L = { pos: [L0[0] - i * .01, L0[1], L0[2]], grip: true }; BE.input.sim.R = { pos: [R0[0] + i * .01, R0[1], R0[2]], grip: true }; await new Promise(r => setTimeout(r, 25)); }
  BE.input.sim.L = { pos: L0, grip: false }; BE.input.sim.R = { pos: R0, grip: false }; await new Promise(r => setTimeout(r, 150));
});
s = await st(); ok(s.scale > 1.1 && s.scale < 1.5, 'world scaled ×' + s.scale);
await page.evaluate(() => BE.homeView());

console.log('9 · palette: poke "clay +"');
await page.evaluate(async () => {
  BE.input.sim.L = { pos: W(-.25, .1, .2), quat: [0, 0, 0, 1], trig: 0 }; await new Promise(r => setTimeout(r, 300));
  const M = BE.menu, b = M.btns.find(b => b.id === 'tool:clay'), P = M.panel; P.updateMatrixWorld();
  const u = (b.x + b.w / 2) / 1024, v = 1 - (b.y + b.h / 2) / 880;
  const w = P.localToWorld(new THREE_V((u - .5) * .2, (v - .5) * .2 * 880 / 1024, .03)), w2 = P.localToWorld(new THREE_V((u - .5) * .2, (v - .5) * .2 * 880 / 1024, .002));
  BE.input.sim.R = { pos: w.toArray(), trig: 0 }; await new Promise(r => setTimeout(r, 150));
  BE.input.sim.R = { pos: w2.toArray(), trig: 0 }; await new Promise(r => setTimeout(r, 150));
  BE.input.sim.R = { pos: w.toArray(), trig: 0 }; await new Promise(r => setTimeout(r, 150));
});
s = await st(); ok(s.tool === 'clay', 'poke picked tool → ' + s.tool);
await page.screenshot({ path: '_work/studio_shot.png' });

console.log('10 · send → Blender/phones file + saved scene');
await page.evaluate(() => BE.sendNow(true)); await sleep(1500);
ok(fs.existsSync('public/share/studio_live.glb') && fs.statSync('public/share/studio_live.glb').size > 5000, 'studio_live.glb ' + (fs.existsSync('public/share/studio_live.glb') ? fs.statSync('public/share/studio_live.glb').size : 0) + ' B');
ok(fs.existsSync('_work/studio/scene.json'), 'scene.json saved');
const n0 = (await st()).objs.length;

console.log('11 · Blender → VR inbox');
fs.copyFileSync('public/models/dragon_fly.glb', 'public/share/from_blender.glb'); await sleep(3500);
s = await st(); ok(s.objs.some(o => o.startsWith('import')), 'from_blender.glb appeared: ' + s.objs.filter(o => o.startsWith('import')));
fs.unlinkSync('public/share/from_blender.glb');
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) BE.world.renderer.xr.getSession().requestAnimationFrame(f); else r(n); }; BE.world.renderer.xr.getSession().requestAnimationFrame(f); }));
console.log('   emulator xr fps ~', fps);

console.log('12 · reload = everything comes back');
await page.evaluate(() => BE.sendNow(false)); await sleep(1200);
await enter(); await page.evaluate(() => { window.THREE_V = BE.root.position.constructor; }); await sleep(800);
s = await st(); ok(s.objs.length === n0 + 1, `reloaded ${s.objs.length} objects (had ${n0} + import)`);
const repaint = await page.evaluate(() => BE.objs.some(o => o.userData.ts && o.userData.ts.layers.some(l => l.kind === 'paint')));
ok(repaint, 'paint layer restored');
await page.screenshot({ path: '_work/studio_shot2.png' });
console.log('errors:', errs.length ? errs : 'none'); if (errs.length) process.exitCode = 1;
await browser.close();
