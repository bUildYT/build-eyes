// bUild sTudio · LIVE SYNC: 3 devices on one link. A (hub) sculpts → B sees the very same bytes · B paints → A · undo travels ·
//  late joiner C gets the whole scene · delete travels · ghosts · the hub leaves → another takes over and it keeps syncing.
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const b = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const ROOM = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
async function open(who, vp = { width: 1100, height: 760 }) {
  const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: vp })).newPage();
  p.on('pageerror', e => errs.push(who + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/peer|webrtc|ice|devlink|__q/i.test(m.text())) errs.push(who + ': ' + m.text()); });
  await p.goto(`https://localhost:8897/studio.html?flat&room=${ROOM}&who=${who}`);
  await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.sync, null, { timeout: 60000 });
  return p;
}
const role = p => p.evaluate(() => BE.sync.role);
const waitRole = (p, r, t = 25000) => p.waitForFunction(r => BE.sync.role === r, r, { timeout: t });
const drag = async (p, pts) => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(250); };
// a fingerprint of the whole scene: ids, types, matrices, stroke samples, sculpt voxels (8-bit, as they travel) + colours
const fp = p => p.evaluate(() => {
  const out = []; let h = 0;
  for (const o of [...BE.objs].sort((a, b) => a.userData.rec.id < b.userData.rec.id ? -1 : 1)) {
    const r = o.userData.rec; o.updateMatrix(); const m = Array.from(o.matrix.elements, v => v.toFixed(3)).join(',');
    let s = r.type + ':' + r.id + ':' + m + ':' + (r.s ? r.s.length : '') + ':' + (r.mat || '');
    const sc = o.userData.sculpt;
    if (sc) { let a = 0, solid = 0; for (const ch of sc.chunks.values()) for (let i = 0; i < ch.d.length; i++) { const q = Math.round((ch.d[i] + 1) * 127.5); if (q > 1) { a = (a * 31 + q + i + ch.col[i * 3] * 7 + ch.col[i * 3 + 2] * 13) % 1e9; if (q > 128) solid++; } } s += ':v' + a + ':n' + solid; }
    out.push(s);
  }
  return out.join('\n');
});
const settle = ms => new Promise(r => setTimeout(r, ms));

console.log('room', ROOM, '· A opens (becomes the hub), B joins');
const A = await open('a'); await waitRole(A, 'hub');
const B = await open('b', { width: 412, height: 860 }); await waitRole(B, 'client');
ok(await role(A) === 'hub' && await role(B) === 'client', 'A = hub, B = client');

console.log('A draws a tube + sculpts clay');
await A.evaluate(() => BE.setTool('tube')); await drag(A, [[400, 300], [520, 280], [640, 330]]);
await A.evaluate(() => BE.setTool('clay')); await drag(A, [[650, 450], [760, 460], [850, 470]]); await drag(A, [[680, 440], [800, 450]]);
await settle(1500);
let fa = await fp(A), fb = await fp(B);
ok(fa.split('\n').length === 2 && /sculpt.*n[1-9]/.test(fa), 'A has tube + sculpt · ' + fa.replace(/\n/g, ' | ').slice(0, 300));
ok(fa === fb, 'B = A exactly (ids, matrices, voxels)' + (fa === fb ? '' : '\nA:' + fa + '\nB:' + fb));
ok(await B.evaluate(() => BE.objs.find(o => o.userData.sculpt).userData.sculpt.tris()) > 300, 'B meshed the sculpt');

console.log('B paints the sculpt blue (phone) → A');
const blue = p => p.evaluate(() => { const sc = BE.objs.find(o => o.userData.sculpt).userData.sculpt; let n = 0; for (const ch of sc.chunks.values()) for (let i = 0; i < ch.d.length; i++) if (ch.d[i] > -.95 && ch.col[i * 3 + 2] > 160 && ch.col[i * 3] < 140) n++; return n; });
// paint through the API the tools use (screen aim on a narrow phone view is fiddly): same code path as the brush
await B.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt), sc = o.userData.sculpt; let p = null; for (const ch of sc.chunks.values()) { for (let i = 0; i < ch.d.length && !p; i++) if (ch.d[i] > -.5 && ch.d[i] < .5) { const C = 24, x = i % C, y = Math.floor(i / C) % C, z = Math.floor(i / (C * C)); p = new (BE.world.camera.position.constructor)((ch.cx * C + x) * sc.vs, (ch.cy * C + y) * sc.vs, (ch.cz * C + z) * sc.vs); } if (p) break; } sc.begin(); sc.paint(p, .03, '#3a8bff', 'clay', 1); sc.end(); });
await settle(1200);
const nb = await blue(B), na = await blue(A);
ok(nb > 0 && na === nb, `blue on B ${nb} = on A ${na}`);

console.log('A: Ctrl+Z (takes the last clay stroke back) → B');
const before = await fp(B);
await A.keyboard.press('Control+z'); await settle(1200);
fa = await fp(A); fb = await fp(B);
ok(fa !== before && fa === fb, 'undo arrived on B (scenes equal again)');

console.log('C joins late (tablet) → gets the whole scene');
const C = await open('c', { width: 900, height: 1200 }); await waitRole(C, 'client');
await C.waitForFunction(() => BE.sync.snapAt, null, { timeout: 20000 }); await settle(800);
const fc = await fp(C); fa = await fp(A);
ok(fc === fa, 'C = A after the snapshot');
ok(await blue(C) === await blue(A), 'C has the paint too');

console.log('ghosts');
await A.mouse.move(500, 400); await B.mouse.move(200, 400); await C.mouse.move(400, 500); await settle(800);
const ga = await A.evaluate(() => BE.sync.ghosts.size), gc = await C.evaluate(() => BE.sync.ghosts.size);
ok(ga === 2 && gc === 2, `A sees ${ga} ghosts, C sees ${gc}`);
ok((await A.evaluate(() => BE.S.room)).includes('3 devices'), 'A: ' + await A.evaluate(() => BE.S.room));

console.log('B deletes the tube → A + C');
await B.evaluate(() => BE.removeObj(BE.objs.find(o => o.userData.rec.type === 'stroke'))); await settle(800);
ok(!(await fp(A)).includes('stroke') && !(await fp(C)).includes('stroke'), 'tube gone everywhere');

console.log('the hub (A) leaves → B or C takes over, still live');
await A.context().close(); await settle(500);
const t0 = Date.now(); let roles0;
while (Date.now() - t0 < 45000) { roles0 = [await role(B), await role(C)].sort().join('+'); const lk = (await B.evaluate(() => BE.sync.links.size)) + (await C.evaluate(() => BE.sync.links.size)); if (roles0 === 'client+hub' && lk === 2) break; await settle(500); }
console.log('    handover took', ((Date.now() - t0) / 1000).toFixed(1), 's');
const roles = [await role(B), await role(C)].sort().join('+');
ok(roles === 'client+hub', 'new roles ' + roles);
await settle(1000);
await C.evaluate(() => BE.setTool('tube')); await drag(C, [[300, 150], [450, 170], [600, 130]]); await settle(1500);
const f2b = await fp(B), f2c = await fp(C);
ok(f2c.includes('stroke') && f2b === f2c, 'C draws after the handover → B has it');

console.log('errors:', errs.length ? errs : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
