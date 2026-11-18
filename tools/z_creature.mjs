// bUild sTudio · CREATURE BUILD (the root-knot creature from his reference): everything with real mouse strokes in the Z tool —
//  Smear (SnakeHook) pulls roots out of a sphere in every direction (auto DynaMesh re-voxels each stretch), branches off the roots,
//  inflated fibrous core, a deep cleft (Dam), fibres + veins alphas, then fluid colours (abyss gold base + lagoon Paint).
//  → _work/creature_*.png.  Run: node tools/z_creature.mjs   (dev server on :8897)
import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { const t = m.text(); if (/dynamesh/.test(t)) console.log('  page:', t.slice(0, 200)); if (/ERROR|error X|Uncaught/i.test(t)) errs.push(t.slice(0, 400)); });
await p.goto('https://localhost:8897/studio.html?flat&who=creature&room=C' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.zf, null, { timeout: 60000 }); await p.waitForTimeout(2500);
const S = o => p.evaluate(o => Object.assign(BE.S, o), o);
await p.evaluate(() => {
  for (const o of [...BE.objs]) BE.removeObj(o);
  Object.assign(BE.S, { mirror: false, zStroke: 'free', zAlpha: 'none', zInt: .5, zFoc: 0, zLazy: .1, zSub: false, size: .012, brushOpen: false, layersOpen: false, zLook: 'smart', zSmA: 'abyss', zSmB: 'lagoon', zDirt: .55, zWear: .5, zLvl: 5 });
  BE.setTool('z'); if (!BE.objs.some(o => o.userData.z)) BE.zf.newSphere(null, true);
  document.querySelectorAll('#fPalBox').forEach(e => e.style.display = 'none');
});
await p.waitForTimeout(300);
await p.evaluate(() => { const Z = BE.zf.active().userData.z.constructor.prototype, sg = Z.setGeometry; window.__sg = 0; Z.setGeometry = function (...a) { const t = performance.now(); const r = sg.apply(this, a); window.__sg = Math.max(window.__sg, performance.now() - t); return r; }; });
const core = await p.evaluate(() => { const o = BE.zf.active(); o.updateMatrixWorld(true); const z = o.userData.z, c = o.position.clone(); o.parent.localToWorld(c); return { c: c.toArray(), R: Math.hypot(z.pos[0], z.pos[1], z.pos[2]) * o.getWorldScale(c.clone()).x }; });
// camera on the CORE (fixed centre + radius), far enough that roots fit; D = the core's screen disc
let D;
const view = async (yaw, pitch, k = 8) => { D = await p.evaluate(([yaw, pitch, k, core]) => {
  const c = new (BE.world.camera.position.constructor)(...core.c), R = core.R, cam = BE.world.camera, t = BE.flat.controls.target; t.copy(c);
  cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * R * k, c.y + Math.sin(pitch) * R * k, c.z + Math.cos(yaw) * Math.cos(pitch) * R * k); cam.lookAt(c); BE.flat.controls.update(); cam.updateMatrixWorld();
  const s = c.clone().project(cam), e = c.clone().add(cam.up.clone().multiplyScalar(R)).project(cam);
  return { x: (s.x + 1) / 2 * innerWidth, y: (1 - s.y) / 2 * innerHeight, r: Math.abs(e.y - s.y) / 2 * innerHeight };
}, [yaw, pitch, k, core]); await p.waitForTimeout(80); };
const P = (u, v) => [D.x + u * D.r, D.y - v * D.r];
let slow = 0; const drag = async (pts, steps = 16) => { await p.mouse.move(...P(...pts[0])); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...P(...q), { steps }); const u0 = Date.now(); await p.mouse.up(); slow = Math.max(slow, Date.now() - u0); await p.waitForTimeout(40); await p.waitForFunction(() => !BE.zf.active().userData.z.busy, null, { timeout: 60000 }); };
let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
const polys = () => p.evaluate(() => BE.zf.active().userData.z.F);
const t0 = Date.now(), roots = [];
// 1 · ROOTS: Smear out of the core, every direction, curving (each stroke = press on the core's rim, drag out along a bent path)
await S({ zb: 'snake', size: .011, zInt: .6 });
const views = [[0, 0], [1.25, .1], [2.5, -.1], [3.75, .15], [5, -.05], [.6, 1.15], [2.2, -1.1]];
for (const [yaw, pitch] of views) {
  for (let n = 0; n < 5; n++) {
    await view(yaw, pitch);
    const a = rnd() * Math.PI * 2, L = 2.4 + rnd() * 1.8, bend = (rnd() - .5) * 1.1, ph = rnd() * 6, wig = .1 + rnd() * .14;
    const pts = [[Math.cos(a) * .78, Math.sin(a) * .78]];
    for (let s = 1; s <= 9; s++) { const t = s / 9, rr = .78 + (L - .78) * t, aa = a + bend * Math.sin(t * 1.4) + wig * Math.sin(t * 7 + ph) / (1 + rr * .3); pts.push([Math.cos(aa) * rr, Math.sin(aa) * rr]); }
    await S({ size: .0065 + rnd() * .005 }); await drag(pts, 8);
    roots.push({ yaw, pitch, pts });
  }
}
console.log('roots', roots.length, 'polys', await polys(), 'main-thread swap max', Math.round(await p.evaluate(() => window.__sg)) + ' ms', 'slowest release ' + slow + ' ms', Math.round((Date.now() - t0) / 1000) + ' s');
// 2 · BRANCHES: thinner Smear pulls off the roots (from 45–70 % along a root, sideways)
for (let k = 0; k < 16; k++) {
  await S({ size: .0035 + rnd() * .002 });
  const R = roots[Math.floor(rnd() * roots.length)]; await view(R.yaw, R.pitch);
  const i = 2 + Math.floor(rnd() * 3), [u, v] = R.pts[i], [u2, v2] = R.pts[i + 1], dx = u2 - u, dy = v2 - v, l = Math.hypot(dx, dy) || 1, sgn = rnd() < .5 ? -1 : 1;
  const nx = -dy / l * sgn, ny = dx / l * sgn, L = .7 + rnd() * .9;
  await drag([[u, v], [u + nx * L * .4 + dx / l * L * .3, v + ny * L * .4 + dy / l * L * .3], [u + nx * L * .7 + dx / l * L * .7, v + ny * L * .7 + dy / l * L * .7]], 8);
}
// core tangle: short Smear loops across the core → fibrous knot
await view(0, .05);
for (const [yaw, pitch] of views.slice(0, 5)) { await view(yaw, pitch); for (let k = 0; k < 2; k++) { await S({ size: .0035 + rnd() * .0015 }); const a = rnd() * 6.28, r0 = .25 + rnd() * .5, b2 = a + 1.2 + rnd() * 1.5; await drag([[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos((a + b2) / 2) * (r0 + .25), Math.sin((a + b2) / 2) * (r0 + .25)], [Math.cos(b2) * (r0 + .1), Math.sin(b2) * (r0 + .1)]], 8); } }
console.log('branches done · polys', await polys(), Math.round((Date.now() - t0) / 1000) + ' s');
// 3 · higher-res DynaMesh for detail, then the CORE: inflate + clay buildup knots, the dark cleft (Dam), pits
await p.evaluate(() => BE.zf.dynamesh(null, false, null, true));
console.log('detail DynaMesh · polys', await polys());
await view(0, .05);
await S({ zb: 'buildup', size: .014, zInt: .5, zStroke: 'free' });
for (let k = 0; k < 4; k++) { const a = rnd() * 6.28, r0 = rnd() * .6; await drag([[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a + 1) * (r0 + .3), Math.sin(a + 1) * (r0 + .3)], [Math.cos(a + 2) * r0, Math.sin(a + 2) * r0]], 14); }
await S({ zb: 'dam', size: .006, zInt: .9 }); await drag([[.02, .75], [-.06, .3], [.04, -.2], [-.02, -.7]], 30); await drag([[.02, .7], [-.05, .3], [.03, -.2], [-.02, -.65]], 30);
await S({ zb: 'inflate', size: .016, zInt: .35 }); await drag([[-.6, .2], [-.3, .5], [.3, .5], [.6, .1]], 12);
// 4 · FIBRES all over the core (Spray + fibers alpha), VEINS along roots (Freehand + veins alpha), sinew grooves (Dam)
await S({ zb: 'standard', zStroke: 'spray', zAlpha: 'fibers', size: .007, zInt: .55, zSub: false });
for (const [yaw, pitch] of views.slice(0, 5)) { await view(yaw, pitch); for (let k = 0; k < 2; k++) { const a = rnd() * 6.28; await drag([[Math.cos(a) * .7, Math.sin(a) * .7], [0, 0], [Math.cos(a + 2.5) * .7, Math.sin(a + 2.5) * .7]], 26); } }
await S({ zStroke: 'free', zAlpha: 'veins', size: .0045, zInt: .6 });
for (const R of roots.slice(0, 22)) { await view(R.yaw, R.pitch); await drag(R.pts.slice(0, 5), 10); }
await S({ zb: 'dam', zAlpha: 'none', size: .0028, zInt: .7 });
for (const R of roots.slice(10, 30)) { await view(R.yaw, R.pitch); await drag(R.pts.slice(0, 4).map(([u, v]) => [u * 1.02 + .02, v * 1.02 - .02]), 12); }
// 5 · COLOUR: Paint (2nd material = lagoon) the root tips + a swirl on the core; abyss gold stays in the cavities / base
await S({ zb: 'paint', zStroke: 'free', zAlpha: 'none', size: .012, zInt: .55 });
for (const R of roots.filter((_, i) => i % 2 === 0)) { await view(R.yaw, R.pitch); await S({ size: .009 }); await drag(R.pts, 8); }
await view(0, .05); await drag([[-.6, -.5], [-.2, -.1], [.3, -.4], [.5, .2]], 14);
const ms = Date.now() - t0;
const info = await p.evaluate(() => { const z = BE.zf.active().userData.z; let w = 0; for (let i = 0; i < z.n; i++) if (z.paint[i] > .5) w++; return { F: z.F, look: z.look, painted: w }; });
console.log('creature', JSON.stringify(info), Math.round(ms / 1000) + ' s of strokes');
// 6 · shots
const shot = async (yaw, pitch, k, name) => { await view(yaw, pitch, k); await p.waitForTimeout(400); await p.screenshot({ path: `_work/creature_${name}.png` }); };
await p.evaluate(() => { const u = document.querySelector('#flatui'); if (u) u.style.display = 'none'; });
await shot(0, .05, 6.5, 'front'); await shot(.8, .3, 4.2, 'close'); await shot(2.6, -.25, 6.5, 'back');
await S({ zSmA: 'ember', zSmB: 'lagoon' }); await p.evaluate(() => BE.zf.smart()); await shot(.4, .1, 6.5, 'ember');
await S({ zSmA: 'ruby', zSmB: 'jade' }); await p.evaluate(() => BE.zf.smart()); await shot(.4, .1, 6.5, 'ruby');
await S({ zSmA: 'abyss', zSmB: 'lagoon' }); await p.evaluate(() => BE.zf.smart()); await p.evaluate(() => BE.zf.look('clay')); await shot(0, .05, 6.5, 'clay');
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
