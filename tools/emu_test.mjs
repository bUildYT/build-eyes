// bUild eYes · headless test in Meta's Quest 3 emulator (IWER, injected by @iwsdk/vite-plugin-dev on localhost).
// node tools/emu_test.mjs  → enters AR in the synthetic room, puts a fake right hand's index tip on a table plane,
// touches corner 1, then corner 2 (29.7 cm along x), checks the table is placed + creatures came, saves screenshots.
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const OUT = path.resolve('_work');
const URL = process.argv[2] || 'https://localhost:8897/?role=host';
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /\[eyes\]/.test(t)) { errs.push(`${m.type()}: ${t}`); } });
page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) process.exitCode = 1; };

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('go').disabled, null, { timeout: 60000 });
ok(true, 'page + emulator ready');
await page.evaluate(() => { IWER_DEVICE.primaryInputMode = 'hand'; });
await page.click('#go');
await page.waitForFunction(() => BE.world && BE.world.session && BE.hands, null, { timeout: 30000 });
ok(true, 'AR session running');
await sleep(2500);   // let the synthetic room publish planes
const planes = await page.evaluate(() => BE.planes || []);
console.log('  planes:', JSON.stringify(planes));
const tbl = planes.filter(p => (p.o || '').toLowerCase() === 'horizontal' && p.y > .3 && p.y < 1.3).sort((a, b) => (/desk|table/.test(b.l) ? 1 : 0) - (/desk|table/.test(a.l) ? 1 : 0) || a.y - b.y)[0];
ok(!!tbl, 'a table-height plane exists: ' + JSON.stringify(tbl));
const head = await page.evaluate(() => IWER_DEVICE.position.toArray ? IWER_DEVICE.position.toArray() : [IWER_DEVICE.position.x, IWER_DEVICE.position.y, IWER_DEVICE.position.z]);
console.log('  head', head.map(v => v.toFixed(2)).join(' '));

// move the right hand so its index tip sits at `target` (world), by correcting the wrist position each frame
async function tipTo(target, ms) {
  await page.evaluate(([x, y, z]) => IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: { x, y, z }, anchor: 'index-tip', orientation: 'auto' }), target);
  await sleep(ms);
}
const px = tbl ? tbl.x : 0, pz = tbl ? tbl.z : -.6, py = tbl ? tbl.y : .75;
// look at the table
await page.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x, y: y + .55, z: z + .55 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y, z } }); }, [px, py, pz]);
await sleep(300);
const c1 = [px - .1485, py + .007, pz + .05], c2 = [px + .1485, py + .007, pz + .05];
await tipTo([c1[0], c1[1] + .08, c1[2]], 600);
console.log('  hand', await page.evaluate(() => JSON.stringify({ n: BE.hands.length, tip: BE.hands[0] && BE.hands[0].P[8].toArray().map(v => +v.toFixed(3)), wrist: [IWER_DEVICE.hands.right.position.x, IWER_DEVICE.hands.right.position.y, IWER_DEVICE.hands.right.position.z].map(v => +v.toFixed(3)), conn: IWER_DEVICE.hands.right.connected, mode: IWER_DEVICE.primaryInputMode, srcs: BE.world.session.inputSources.length })));
await tipTo(c1, 1700);
await tipTo([c1[0], c1[1] + .08, c1[2]], 400);
await tipTo([c2[0], c2[1] + .08, c2[2]], 600);
await tipTo(c2, 1700);
await tipTo([c2[0], c2[1] + .15, c2[2] + .1], 400);
const st = await page.evaluate(() => ({ placed: BE.placed, pos: BE.table.position.toArray().map(v => +v.toFixed(3)), yaw: +BE.table.rotation.y.toFixed(3), n: BE.W.monsters.length }));
console.log('  table', JSON.stringify(st));
ok(st.placed, 'table placed by two corner touches');
ok(Math.abs(st.yaw) < .05, 'table x axis = corner1→corner2 (yaw ≈ 0)');
ok(Math.abs(st.pos[1] - py) < .01, 'table height snapped to the detected plane');
await sleep(4000);
const n = await page.evaluate(() => BE.W.monsters.length);
ok(n >= 3, `creatures arrived (${n})`);
await page.screenshot({ path: path.join(OUT, 'emu_host.png') });
// a snapshot for the EYEs is small enough
const snapLen = await page.evaluate(() => JSON.stringify(BE.W.snap()).length);
ok(snapLen < 12000, `world snapshot ${snapLen} bytes`);
const fps = await page.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const s = BE.world.session; const f = () => { n++; if (performance.now() - t0 < 2000) s.requestAnimationFrame(f); else r(n / 2); }; s.requestAnimationFrame(f); }));
console.log('  emulator fps', fps);
console.log(errs.length ? '  console:\n   ' + errs.slice(0, 25).join('\n   ') : '  no console errors');
await browser.close();
