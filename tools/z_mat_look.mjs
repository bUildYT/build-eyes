// bUild sTudio · LIVE MATERIAL LOOK: a hard-surface helmet sculpted with real mouse strokes (hPolish facets, Layer panels / vents /
//  bolts / hex, Dam seams, gold Paint, chip damage) → screenshots in several live materials; then a creature (scales, belly, horn, bone).
//  Strokes are placed in the model's own screen disc (u, v in -1..1), front camera.
import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { const t = m.text(); if (/shader|WebGLProgram|ERROR/i.test(t) && !/deprecated/.test(t) && !(/warning X\d/.test(t) && !/error X\d|ERROR:/.test(t))) errs.push(t.slice(0, 600)); });
await p.goto('https://localhost:8897/studio.html?flat&who=mat&room=M' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.zf, null, { timeout: 60000 }); await p.waitForTimeout(2500);
const S = o => p.evaluate(o => Object.assign(BE.S, o), o);
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { mirror: true, zStroke: 'free', zAlpha: 'none', zInt: .5, zFoc: 0, zLazy: .1, zSub: false, size: .01, brushOpen: false, layersOpen: false, zLook: 'smart', zSmA: 'black', zSmB: 'gold', zDirt: .6, zWear: .6, zLvl: 6 }); BE.setTool('z'); });
await p.evaluate(() => { const b = document.querySelector('#fPalBox'); if (b) b.style.display = 'none'; });
// front camera on the active Z mesh; returns its screen disc
let D;
const front = async (yaw = 0, pitch = .12, k = 3.1) => { D = await p.evaluate(([yaw, pitch, k]) => {
  const o = BE.zf.active(), g = o.geometry; g.computeBoundingSphere(); const c = g.boundingSphere.center.clone().applyMatrix4(o.matrixWorld), R = g.boundingSphere.radius * o.getWorldScale(c.clone()).x;
  const cam = BE.world.camera, t = BE.flat.controls.target; t.copy(c); cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * R * k, c.y + Math.sin(pitch) * R * k, c.z + Math.cos(yaw) * Math.cos(pitch) * R * k); cam.lookAt(c); BE.flat.controls.update(); cam.updateMatrixWorld();
  const s = c.clone().project(cam), e = c.clone().add(cam.up.clone().multiplyScalar(R)).project(cam), W = innerWidth, H = innerHeight;
  return { x: (s.x + 1) / 2 * W, y: (1 - s.y) / 2 * H, r: Math.abs(e.y - s.y) / 2 * H };
}, [yaw, pitch, k]); await p.waitForTimeout(250); };
const P = (u, v) => [D.x + u * D.r, D.y - v * D.r];
const drag = async (pts, steps = 16) => { await p.mouse.move(...P(...pts[0])); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...P(...q), { steps }); await p.mouse.up(); await p.waitForTimeout(100); };
await p.evaluate(() => { BE.zf.subdivide(); BE.zf.subdivide(); });
await front();
console.log('disc', JSON.stringify(D), 'polys', await p.evaluate(() => BE.zf.active().userData.z.F));
const t0 = Date.now();
// block-out: helmet brow + cheek planes (hPolish), jaw
await S({ zb: 'buildup', size: .016, zInt: .5 }); for (let k = 0; k < 2; k++) await drag([[-.55, .25], [-.25, .32], [0, .33]]);
await S({ zb: 'planar', size: .02, zInt: .8 }); for (const u of [-.72, -.62]) await drag([[u, .15], [u + .02, -.2], [u + .08, -.5]]);
await drag([[-.3, -.72], [0, -.76]]);
// seams
await S({ zb: 'dam', size: .005, zInt: .7 }); await drag([[-.8, .05], [-.4, .12], [0, .13]], 30);
await drag([[-.25, .1], [-.27, -.3], [-.18, -.7]], 24);
// Layer plates / vents / bolts / hex / tech (DragRect: press = centre, drag = size + turn)
await S({ zb: 'layer', zStroke: 'rect', zAlpha: 'panel', zInt: .6 }); await drag([[0, .6], [.18, .6]], 10);
await S({ zAlpha: 'vent', zSub: true }); await drag([[-.45, -.3], [-.45, -.12]], 10); await S({ zSub: false });
await S({ zAlpha: 'bolts' }); await drag([[-.62, .45], [-.62, .56]], 10);
await S({ zAlpha: 'hex', zInt: .45 }); await drag([[0, -.45], [.16, -.45]], 10);
await S({ zAlpha: 'tech', zInt: .6 }); await drag([[-.4, .62], [-.4, .72]], 10);
// gold trim: Paint along the brow seam, filigree on the plate
await S({ zb: 'paint', zStroke: 'free', zAlpha: 'none', size: .006, zInt: 1 }); await drag([[-.8, .1], [-.4, .17], [0, .18]], 30);
await S({ zStroke: 'rect', zAlpha: 'filigree' }); await drag([[0, .6], [.12, .6]], 8);
// battle damage
await S({ zb: 'standard', zStroke: 'spray', zAlpha: 'chips', size: .006, zInt: .4, zSub: true }); await drag([[-.75, .3], [-.7, 0], [-.6, -.4]], 24); await S({ zSub: false, zStroke: 'free', zAlpha: 'none' });
const ms = Date.now() - t0;
const info = await p.evaluate(() => { const z = BE.zf.active().userData.z; let w = 0; for (let i = 0; i < z.n; i++) if (z.paint[i] > .5) w++; const pc = k => { const a = []; for (let i = 0; i < z.n; i += 7) a.push(z.cav[i * 2 + k]); a.sort((x, y) => x - y); return [.01, .05, .5, .95, .99].map(q => +a[Math.floor(q * (a.length - 1))].toFixed(4)); }; return { F: z.F, look: z.look, painted: w, fine: pc(0), broad: pc(1) }; });
console.log('helmet', JSON.stringify(info), ms + ' ms of strokes');
await front(.5); await p.screenshot({ path: '_work/zm_black_gold.png' });
for (const [a, bb, nm] of [['white', 'black', 'white_black'], ['gunmetal', 'red', 'gunmetal_red'], ['obsidian', 'gold', 'biomech_gold']]) {
  await S({ zSmA: a, zSmB: bb }); await p.evaluate(() => BE.zf.smart()); await p.waitForTimeout(250); await p.screenshot({ path: `_work/zm_${nm}.png` });
}
await S({ zLook: 'clay' }); await p.evaluate(() => BE.zf.look('clay')); await p.waitForTimeout(250); await p.screenshot({ path: '_work/zm_clay.png' });
await S({ zSmA: 'black', zSmB: 'gold' }); await p.evaluate(() => BE.zf.smart()); await front(.35, .1, 1.9); await p.screenshot({ path: '_work/zm_black_gold_close.png' });
// creature: fresh sphere → forms, scales sprayed, belly plates (Layer), horn rings, bone paint on the horn
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { zSmA: 'scales', zSmB: 'bone', mirror: true }); BE.zf.newSphere(null, true); BE.zf.subdivide(); BE.zf.subdivide(); });
await front();
await S({ zb: 'buildup', size: .018, zInt: .5, zStroke: 'free', zAlpha: 'none' }); for (let k = 0; k < 2; k++) await drag([[-.6, .5], [-.3, .1], [-.2, -.4]]);
await S({ zb: 'standard', zStroke: 'spray', zAlpha: 'scale', size: .006, zInt: .5 }); for (let k = 0; k < 3; k++) await drag([[-.75, .55], [-.45, .25], [-.65, -.1], [-.35, -.45]], 40);
await S({ zb: 'layer', zStroke: 'rect', zAlpha: 'belly', zInt: .5 }); await drag([[0, -.25], [0, -.6]], 10);
await S({ zb: 'standard', zStroke: 'rect', zAlpha: 'horn', zInt: .7 }); await drag([[-.35, .65], [-.35, .85]], 8);
await S({ zb: 'paint', zStroke: 'rect', zAlpha: 'round', zInt: 1 }); await drag([[-.35, .65], [-.35, .82]], 8);
await front(.45); await p.screenshot({ path: '_work/zm_dragon.png' });
console.log('errors:', errs.length ? errs.slice(0, 4) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
