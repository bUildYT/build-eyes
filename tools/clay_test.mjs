// emulator: place the table, switch to BUILD, pinch-draw a ring of clay with the right hand, carve with the left, screenshot from the eye
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
await page.goto('https://localhost:8897/?role=host&who=clay', { waitUntil: 'load' });
await page.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('go').disabled, null, { timeout: 60000 });
await page.evaluate(() => { IWER_DEVICE.primaryInputMode = 'hand'; localStorage.removeItem('be:clay'); });
await page.click('#go');
await page.waitForFunction(() => BE.world && BE.world.session && BE.hands, null, { timeout: 30000 });
await sleep(2500);
const tbl = (await page.evaluate(() => BE.planes || [])).filter(p => (p.o || '').toLowerCase() === 'horizontal' && p.y > .3 && p.y < 1.3)[0];
const [px, py, pz] = [tbl.x, tbl.y, tbl.z];
await page.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x, y: y + .5, z: z + .5 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y: y + .08, z } }); }, [px, py, pz]);
const hand = (dev, [x, y, z], anchor = 'index-tip') => page.evaluate(([dev, x, y, z, anchor]) => IWER_DEVICE.remote.dispatch('set_transform', { device: dev, position: { x, y, z }, anchor, orientation: 'auto' }), [dev, x, y, z, anchor]);
// park the left hand away, touch + wait = solo table
await hand('hand-left', [px - .4, py + .3, pz + .2]);
for (const cx of [px - .1485, px + .1485]) { await hand('hand-right', [cx, py + .08, pz + .05]); await sleep(500); await hand('hand-right', [cx, py + .007, pz + .05]); await sleep(1800); await hand('hand-right', [cx, py + .08, pz + .05]); await sleep(400); }
await page.waitForFunction(() => BE.placed, null, { timeout: 20000 }).catch(() => {});
ok(await page.evaluate(() => BE.placed), 'table placed');
await page.evaluate(() => BE.clay.setMode('build'));
const pinch = (dev, v) => page.evaluate(([dev, v]) => IWER_DEVICE.remote.dispatch('set_select_value', { device: dev, value: v }), [dev, v]);
// does the emulated pinch close thumb + index?
await hand('hand-right', [px, py + .06, pz]); await pinch('hand-right', 1); await sleep(400);
const pd = await page.evaluate(() => { const h = BE.W.hands.find(h => h.real === 'R'); return h && { pinch: h.pinch, d: +h.pts[4].distanceTo(h.pts[8]).toFixed(3) }; });
console.log('  right hand pinch', JSON.stringify(pd));
ok(pd && pd.pinch, 'emulated pinch is seen as a pinch');
// a ring of clay
for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2; await hand('hand-right', [px + Math.cos(a) * .08, py + .05 + i * .001, pz + Math.sin(a) * .08], 'index-tip'); await sleep(120); }
await sleep(300); await pinch('hand-right', 0); await sleep(300);
const n1 = await page.evaluate(() => ({ strokes: BE.clay.strokes.length, balls: BE.clay.count(), tris: BE.clay.mc.count / 3 }));
console.log('  clay', JSON.stringify(n1));
ok(n1.strokes >= 1 && n1.balls > 20, 'a pinch stroke laid clay');
ok(n1.tris > 500, 'the clay has a surface');
// carve with the left hand through the ring
await hand('hand-left', [px + .08, py + .07, pz - .05]); await pinch('hand-left', 1); await sleep(300);
for (let i = 0; i <= 10; i++) { await hand('hand-left', [px + .08, py + .07, pz - .05 + i * .01]); await sleep(50); }
await pinch('hand-left', 0); await sleep(400);
const n2 = await page.evaluate(() => ({ strokes: BE.clay.strokes.map(s => s.sub ? 'carve' : 'add'), tris: BE.clay.mc.count / 3 }));
console.log('  after carve', JSON.stringify(n2));
ok(n2.strokes.includes('carve'), 'left pinch carves');
// fps while idle
const fps = await page.evaluate(async () => { const t0 = performance.now(); let f = 0; await new Promise(r => { const id = setInterval(() => {}, 1000); BE.world.renderer.xr.getSession().requestAnimationFrame(function c() { f++; if (performance.now() - t0 < 2000) BE.world.renderer.xr.getSession().requestAnimationFrame(c); else { clearInterval(id); r(); } }); }); return f / 2; });
console.log('  emulator fps', fps);
await page.evaluate(() => BE.shot());
await sleep(1200);
await page.screenshot({ path: path.resolve('_work/clay_emu.png') });
ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
await browser.close();
