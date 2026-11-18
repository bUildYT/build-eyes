// bUild sTudio · CREATURE pass 2 on the saved creature: the fibrous knot core — many short thin Smear fibres off the core,
//  fibres alpha sprayed over the knot, a deeper cleft. Real mouse strokes. → _work/creature2_*.png
import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { const t = m.text(); if (/dynamesh/.test(t)) console.log('  page:', t.slice(0, 200)); });
await p.goto('https://localhost:8897/studio.html?flat&who=creature2&room=K' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.zf && BE.objs.some(o => o.userData.z), null, { timeout: 90000 }); await p.waitForTimeout(2500);
const S = o => p.evaluate(o => Object.assign(BE.S, o), o);
await p.evaluate(() => { Object.assign(BE.S, { mirror: false, zStroke: 'free', zAlpha: 'none', zInt: .55, zFoc: 0, zLazy: .1, zSub: false, brushOpen: false, layersOpen: false }); BE.setTool('z'); document.querySelectorAll('#fPalBox').forEach(e => e.style.display = 'none'); });
const core = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.z); BE.setActive && BE.setActive(o); o.updateMatrixWorld(true); const c = o.getWorldPosition(o.position.clone()); return { c: c.toArray(), R: .08 * o.getWorldScale(c.clone()).x, F: o.userData.z.F }; });
console.log('loaded', JSON.stringify(core));
let D;
const view = async (yaw, pitch, k = 5) => { D = await p.evaluate(([yaw, pitch, k, core]) => {
  const c = new (BE.world.camera.position.constructor)(...core.c), R = core.R, cam = BE.world.camera; BE.flat.controls.target.copy(c);
  cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * R * k, c.y + Math.sin(pitch) * R * k, c.z + Math.cos(yaw) * Math.cos(pitch) * R * k); cam.lookAt(c); BE.flat.controls.update(); cam.updateMatrixWorld();
  const s = c.clone().project(cam), e = c.clone().add(cam.up.clone().multiplyScalar(R)).project(cam);
  return { x: (s.x + 1) / 2 * innerWidth, y: (1 - s.y) / 2 * innerHeight, r: Math.abs(e.y - s.y) / 2 * innerHeight };
}, [yaw, pitch, k, core]); await p.waitForTimeout(80); };
const P = (u, v) => [D.x + u * D.r, D.y - v * D.r];
const hits = (u, v) => p.evaluate(([x, y]) => { const r = BE.world.renderer.domElement.getBoundingClientRect(), cam = BE.world.camera, rc = new (BE.world.camera.constructor.prototype.constructor === undefined ? Object : Object)(); return true; }, P(u, v));
const drag = async (pts, steps = 10) => { await p.mouse.move(...P(...pts[0])); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...P(...q), { steps }); await p.mouse.up(); await p.waitForTimeout(40); await p.waitForFunction(() => !BE.zf.active().userData.z.busy, null, { timeout: 60000 }); };
let sd = 29; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
const t0 = Date.now();
// 1 · short, thin, curling fibres all over the core (Smear) → knotted, fibrous mass
await S({ zb: 'snake', zInt: .5 });
for (const [yaw, pitch] of [[0, .05], [.9, .3], [1.9, -.2], [2.9, .15], [3.9, -.1], [4.9, .25], [.4, 1.2], [2.4, -1.1]]) {
  await view(yaw, pitch);
  for (let k = 0; k < 6; k++) {
    await S({ size: .0028 + rnd() * .0025 });
    const a = rnd() * 6.28, r0 = .55 + rnd() * .3, L = .45 + rnd() * .55, cw = (rnd() < .5 ? -1 : 1) * (.5 + rnd() * .8), pts = [[Math.cos(a) * r0, Math.sin(a) * r0]];
    for (let s = 1; s <= 5; s++) { const t = s / 5, aa = a + cw * t * .9, rr = r0 + L * t; pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]); }
    await drag(pts, 6);
  }
}
console.log('fibres', Math.round((Date.now() - t0) / 1000) + ' s', await p.evaluate(() => BE.zf.active().userData.z.F));
// 2 · surface detail on the knot: fibres alpha (spray), veins, the deep cleft
await S({ zb: 'standard', zStroke: 'spray', zAlpha: 'fibers', size: .006, zInt: .7 });
for (const [yaw, pitch] of [[0, .05], [1.3, .2], [2.6, -.1], [3.9, .1], [5.1, -.2]]) { await view(yaw, pitch); for (let k = 0; k < 2; k++) { const a = rnd() * 6.28; await drag([[Math.cos(a) * .6, Math.sin(a) * .6], [Math.cos(a + 1.5) * .2, Math.sin(a + 1.5) * .2], [Math.cos(a + 3) * .6, Math.sin(a + 3) * .6]], 24); } }
await S({ zb: 'dam', zStroke: 'free', zAlpha: 'none', size: .005, zInt: .9 }); await view(0, .05); await drag([[.02, .7], [-.05, .3], [.03, -.2], [-.02, -.65]], 30);
// 3 · colour: lagoon paint on some new fibres (soft)
await S({ zb: 'paint', zStroke: 'spray', zAlpha: 'none', size: .008, zInt: .35 });
for (const [yaw, pitch] of [[.5, .1], [3, -.1]]) { await view(yaw, pitch); await drag([[-.8, .7], [.8, .5], [.7, -.6], [-.7, -.7]], 20); }
console.log('done', Math.round((Date.now() - t0) / 1000) + ' s', await p.evaluate(() => BE.zf.active().userData.z.F));
await p.evaluate(() => { const u = document.querySelector('#flatui'); if (u) u.style.display = 'none'; });
const shot = async (yaw, pitch, k, name) => { await view(yaw, pitch, k); await p.waitForTimeout(500); await p.screenshot({ path: `_work/creature2_${name}.png` }); };
await shot(0, .08, 7, 'front'); await shot(.7, .25, 3.2, 'close'); await shot(2.8, -.2, 7, 'back');
await p.waitForTimeout(6000);   // autosave → the PC scene (what opens next)
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none'); await b.close();
