// emulator: place the table, switch to BUILD, pinch-draw a ring of clay with the right hand, carve with the left, screenshot from the eye
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
await page.goto('https://localhost:8897/?role=host&who=hero', { waitUntil: 'load' });
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
await sleep(6000);
const st = await page.evaluate(() => ({ mechs: BE.mechs.list.map(m => m.team + ':' + m.act + ':' + m.hp), bolts: BE.mechs.bolts.length, hero: BE.hero && { mode: BE.hero.mode, p: BE.hero.p.toArray().map(v => +v.toFixed(2)), vis: BE.hero.g.visible } }));
console.log('  ', JSON.stringify(st));
ok(st.mechs.length === 2, 'two mechs on the table');
ok(st.hero && st.hero.vis, 'hero dragon flying');
await page.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x: x + .05, y: y + .35, z: z + .45 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y: y + .1, z } }); }, [px, py, pz]);
await hand('hand-right', [px + .5, py + .1, pz + .4]); await hand('hand-left', [px - .5, py + .1, pz + .4]);
await sleep(3000);
const fps = await page.evaluate(async () => { const s = BE.world.renderer.xr.getSession(); const t0 = performance.now(); let f = 0; await new Promise(r => { s.requestAnimationFrame(function c() { f++; if (performance.now() - t0 < 2000) s.requestAnimationFrame(c); else r(); }); }); return f / 2; });
console.log('  emulator fps', fps);
await page.evaluate(() => BE.shot(1200)); await sleep(1500);
ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
await browser.close();
