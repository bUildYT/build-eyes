// bUild eYes · two pages: an emulated headset (host) + a camera EYE (director, fake camera) linked by the room code.
// node tools/link_test.mjs → checks: link over PeerJS, creatures mirrored with the same names, positions within mm, food wish travels back.
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const OUT = path.resolve('_work');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) process.exitCode = 1; };
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const errs = [];
const mk = async (name) => { const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } }); await ctx.grantPermissions(['camera'], { origin: 'https://localhost:8897' }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${name} PAGEERROR ${e.message}`)); p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') errs.push(`${name} ${m.type()}: ${m.text()}`); }); p.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push(`${name}: ${m.text()}`); }); return p; };

// host
const H = await mk('host');
await H.goto('https://localhost:8897/?role=host');
await H.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('go').disabled, null, { timeout: 60000 });
const code = await H.evaluate(() => document.getElementById('code').textContent);
await H.evaluate(() => { IWER_DEVICE.primaryInputMode = 'hand'; localStorage.removeItem('be:table'); });
await H.click('#go');
await H.waitForFunction(() => BE.hands && BE.planes && BE.planes.length, null, { timeout: 30000 });
const tbl = await H.evaluate(() => BE.planes.find(p => p.l === 'table') || BE.planes.find(p => /desk/.test(p.l)));
const tip = async (x, y, z, ms) => { await H.evaluate(([x, y, z]) => IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: { x, y, z }, anchor: 'index-tip', orientation: 'auto' }), [x, y, z]); await sleep(ms); };
await H.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x, y: y + .55, z: z + .55 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y, z } }); }, [tbl.x, tbl.y, tbl.z]);
for (const sx of [-1, 1]) { await tip(tbl.x + sx * .1485, tbl.y + .09, tbl.z + .05, 500); await tip(tbl.x + sx * .1485, tbl.y + .007, tbl.z + .05, 1700); await tip(tbl.x + sx * .1485, tbl.y + .09, tbl.z + .05, 300); }
await tip(tbl.x + .3, tbl.y + .3, tbl.z + .3, 200);
ok(await H.evaluate(() => BE.placed), `host placed the table (code ${code})`);

// phone EYE (AR + hit test) in a second emulated device: aim at corner 1, tap, aim at corner 2, tap
const P = await mk('phone');
await P.goto(`https://localhost:8897/?role=eye&ref=local-floor&eye=${code}`);
await P.waitForFunction(() => window.IWER_DEVICE, null, { timeout: 60000 });
await P.evaluate(() => { IWER_DEVICE.primaryInputMode = 'controller'; });
await P.click('#goEye');
await sleep(1500);
console.log('  phone info', await P.evaluate(() => document.getElementById('info').textContent + ' | join=' + document.getElementById('join').value));
console.log('  phone session state', JSON.stringify(await P.evaluate(async () => { const r = {}; try { r.status = await IWER_DEVICE.remote.dispatch('get_session_status'); } catch (e) { r.err = e.message; } try { r.acc = await IWER_DEVICE.remote.acceptSession(); } catch (e) { r.accErr = e.message; } return r; })));
await P.waitForFunction(() => BE.W && document.getElementById('start').hidden, null, { timeout: 30000 }).catch(e => { console.log(errs.join(' | ')); throw e; });
// the phone stands somewhere else: the other side of the table, its own tracking origin
const aim = async (x, y, z) => { await P.evaluate(async ([x, y, z, tx, ty, tz]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x, y, z } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x: tx, y: ty, z: tz } }); }, [x + .03, y + .4, z - .12, x, y, z]); await sleep(400); };
const tap = async () => { await P.evaluate(async () => { await IWER_DEVICE.remote.dispatch('set_select_value', { device: 'controller-right', value: 1 }); }); await sleep(150); await P.evaluate(async () => { await IWER_DEVICE.remote.dispatch('set_select_value', { device: 'controller-right', value: 0 }); }); await sleep(300); };
await aim(tbl.x - .1485, tbl.y, tbl.z + .05); console.log('  aim1 want', [tbl.x - .1485, tbl.y, tbl.z + .05].map(v=>v.toFixed(3)).join(' '), 'hit', await P.evaluate(() => BE.hit && BE.hit.toArray().map(v=>v.toFixed(3)).join(' ')), 'viewer', await P.evaluate(() => [IWER_DEVICE.position.x, IWER_DEVICE.position.y, IWER_DEVICE.position.z].map(v=>v.toFixed(2)).join(' '))); await tap();
await aim(tbl.x + .1485, tbl.y, tbl.z + .05); await tap();
await sleep(2500);
const ph = await P.evaluate(() => ({ n: BE.W.monsters.length, hud: document.getElementById('hud').textContent, tv: BE.W.scene.visible }));
console.log('  phone', JSON.stringify(ph));
ok(ph.n >= 3, 'phone EYE shows the creatures after two corner taps');
// world places: host table-local vs phone table-local must match; and in WORLD space the phone's table must sit on the same spot
const hp = await H.evaluate(() => BE.W.monsters.map(m => ({ n: m.name, w: BE.table.localToWorld(m.p.clone()).toArray() })));
const pp = await P.evaluate(() => BE.W.monsters.map(m => ({ n: m.name, w: BE.W.scene.localToWorld(m.p.clone()).toArray() })));
const worst = Math.max(...hp.map(a => { const b = pp.find(x => x.n === a.n); return b ? Math.hypot(a.w[0] - b.w[0], a.w[1] - b.w[1], a.w[2] - b.w[2]) : 9; }));
ok(worst < .03, `creatures stand on the same real spot for headset + phone (worst ${(worst * 1000).toFixed(0)} mm)`);
await P.screenshot({ path: path.join(OUT, 'eye_phone.png') });
console.log(errs.length ? '  console:\n   ' + [...new Set(errs)].slice(0, 20).join('\n   ') : '  no console errors');
await browser.close();
