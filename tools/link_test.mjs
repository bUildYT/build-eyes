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
const mk = async (name) => { const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } }); await ctx.grantPermissions(['camera'], { origin: 'https://localhost:8897' }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(`${name} PAGEERROR ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push(`${name}: ${m.text()}`); }); return p; };

// host
const H = await mk('host');
await H.goto('https://localhost:8897/?role=host');
await H.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('go').disabled, null, { timeout: 60000 });
const code = await H.evaluate(() => document.getElementById('code').textContent);
await H.evaluate(() => { IWER_DEVICE.primaryInputMode = 'hand'; localStorage.removeItem('be:table'); });
await H.click('#go');
await H.waitForFunction(() => BE.hands && BE.planes && BE.planes.length, null, { timeout: 30000 });
const tbl = await H.evaluate(() => BE.planes.find(p => /table|desk/.test(p.l)));
const tip = async (x, y, z, ms) => { await H.evaluate(([x, y, z]) => IWER_DEVICE.remote.dispatch('set_transform', { device: 'hand-right', position: { x, y, z }, anchor: 'index-tip', orientation: 'auto' }), [x, y, z]); await sleep(ms); };
await H.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x, y: y + .55, z: z + .55 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y, z } }); }, [tbl.x, tbl.y, tbl.z]);
for (const sx of [-1, 1]) { await tip(tbl.x + sx * .1485, tbl.y + .09, tbl.z + .05, 500); await tip(tbl.x + sx * .1485, tbl.y + .007, tbl.z + .05, 1700); await tip(tbl.x + sx * .1485, tbl.y + .09, tbl.z + .05, 300); }
await tip(tbl.x + .3, tbl.y + .3, tbl.z + .3, 200);
ok(await H.evaluate(() => BE.placed), `host placed the table (code ${code})`);

// director (camera EYE) joins with the code
const D = await mk('director');
await D.goto(`https://localhost:8897/?role=pc&eye=${code}`);
await D.waitForFunction(() => BE.W && BE.W.monsters.length >= 3, null, { timeout: 45000 }).catch(() => { });
await sleep(1500);
const cmp = async () => {
  const h = await H.evaluate(() => BE.W.monsters.map(m => ({ n: m.name, p: m.p.toArray() })));
  const d = await D.evaluate(() => BE.W.monsters.map(m => ({ n: m.name, p: m.p.toArray() })));
  const pairs = h.map(a => { const b = d.find(x => x.n === a.n); return b ? Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]) : null; });
  return { h: h.length, d: d.length, worst: Math.max(...pairs.map(x => x ?? 9)) };
};
const c = await cmp();
ok(c.d === c.h && c.h >= 3, `director mirrors ${c.d}/${c.h} creatures by name`);
ok(c.worst < .03, `same places on both EYEs (worst ${(c.worst * 1000).toFixed(1)} mm — includes ~1 network tick of motion)`);
// a wish from the EYE: food
const f0 = await H.evaluate(() => BE.W.foods.length);
await D.evaluate(() => { /* same message the phone sends on a tap */ });
const P2 = await mk('phone-sim');
await P2.goto(`https://localhost:8897/?role=pc&eye=${code}`);
await P2.waitForFunction(() => BE.W && BE.W.monsters.length, null, { timeout: 45000 }).catch(() => { });
await P2.evaluate(async (code) => { const { joinRoom } = await import('/src/net.js'); await new Promise(r => { const n = joinRoom(code, { onState: s => { if (s === 'linked') { n.send({ t: 'food', p: [0.02, 0.12, 0.01] }); setTimeout(r, 600); } } }); }); }, code);
await sleep(800);
ok(await H.evaluate(() => BE.W.foods.length) > f0, 'a food tap from an EYE lands in the host world');
ok(await D.evaluate(() => BE.W.last && BE.W.last.f.length) > 0, 'and shows up on the camera EYE');
await sleep(1500);
await D.screenshot({ path: path.join(OUT, 'link_director.png') });
await D.keyboard.press('0'); await sleep(400);
await D.screenshot({ path: path.join(OUT, 'link_god.png') });
console.log(errs.length ? '  console:\n   ' + [...new Set(errs)].slice(0, 20).join('\n   ') : '  no console errors');
await browser.close();
