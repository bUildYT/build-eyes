// hAnd bUilder · headless: flat page + emulator session, strokes through every tool, undo, viewer sync, screenshots → _work/hand_*.png
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const open = async (url, name) => { const p = await ctx.newPage(); p.on('pageerror', e => console.log(`  [${name} ERROR]`, e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon|404|ERR_/.test(m.text())) console.log(`  [${name} console]`, m.text().slice(0, 220)); }); await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.BE && BE.api, null, { timeout: 40000 }); return p; };
const settle = p => p.waitForFunction(() => BE.clay && !BE.clay.dirty.size && !BE.clay.flying && !BE.clay.rough.size && BE.clay._lodV === BE.clay.meshVer, null, { timeout: 30000 });
const tris = p => p.evaluate(() => BE.clay.tris());

const room = 'T' + Date.now().toString(36).slice(-4).toUpperCase();
const A = await open(`https://localhost:8897/hand.html?who=handA&flat&nohint`, 'host');
await A.evaluate(() => { indexedDB.deleteDatabase('handbuilder2'); });
await A.evaluate(r => localStorage.setItem('hb:room', r), room); await A.reload(); await A.waitForFunction(() => window.BE && BE.api, null, { timeout: 40000 });
await settle(A); const t0 = await tris(A); ok(t0 > 1500, `starter ball meshed in the workers: ${t0} tris`);
const R = await A.evaluate(() => BE.api.ROOM); ok(R === room, 'room ' + R);
const stroke = (p, tool, a, b, inv = false, n = 16) => p.evaluate(async ([tool, a, b, inv, n]) => { const V = BE.root.position.constructor, api = BE.api, P = t => new V(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); const t0 = performance.now(); api.strokeBegin('t', tool, P(0), inv); for (let i = 1; i <= n; i++) { api.strokeMove('t', P(i / n), .016); await new Promise(r => setTimeout(r, 4)); } api.strokeEnd('t'); return performance.now() - t0; }, [tool, a, b, inv, n]);
const sum = p => p.evaluate(() => { let s = 0, c = 0; for (const ch of BE.clay.chunks.values()) { for (let i = 0; i < ch.d.length; i += 3) { s += ch.d[i] > 0 ? 1 : 0; c += ch.col[i * 3]; } } return [s, c]; });
let s0 = await sum(A); await stroke(A, 'clay', [-.14, .08, .05], [.14, .16, .05]); await settle(A); let s1 = await sum(A); ok(s1[0] > s0[0], `add clay: solid ${s0[0]} → ${s1[0]}`);
await stroke(A, 'clay', [0, .07, .08], [0, .07, -.08], true); await settle(A); let s2 = await sum(A); ok(s2[0] < s1[0], `carve: → ${s2[0]}`);
await A.evaluate(() => BE.api.undo()); await settle(A); ok((await sum(A))[0] === s1[0], 'undo restores exactly'); await A.evaluate(() => BE.api.redo()); await settle(A); ok((await sum(A))[0] === s2[0], 'redo');
await stroke(A, 'move', [.06, .1, 0], [.06, .24, .02]); await settle(A); let s3 = await sum(A); ok(s3[0] > s2[0], `pull grows a form: → ${s3[0]}`);
await A.evaluate(() => { BE.api.S.color = '#ff7a1a'; }); await stroke(A, 'push', [-.06, .13, .06], [.04, .1, .07], false, 24); await settle(A); let s4 = await sum(A); ok(s4[1] !== s3[1] && s4[0] !== s3[0], 'sculpt + paint changes shape AND colour in one stroke');
await A.evaluate(() => { BE.api.S.color = '#3a7bff'; BE.api.S.mat = 'hgold'; BE.api.S.mirror = true; }); await stroke(A, 'clay', [.05, .05, .1], [.12, .12, .12]); await settle(A);
const sym = await A.evaluate(() => { const c = BE.clay, v = c.vs, g = (x, y, z) => c.get(Math.round(x / v), Math.round(y / v), Math.round(z / v)); return [g(.09, .09, .11) > 0, g(-.09, .09, .11) > 0]; }); ok(sym[0] && sym[1], 'mirror stroke on both sides');
await A.evaluate(() => { BE.api.S.mirror = false; BE.api.S.mat = 'pearl'; }); await stroke(A, 'smooth', [-.1, .1, .05], [.1, .14, .05]); await stroke(A, 'flat', [0, .14, .07], [.04, .14, .07]); await stroke(A, 'paint', [-.05, .05, .07], [.05, .05, .07]); await settle(A); ok(true, 'smooth / flatten / paint ran');
const t1 = await tris(A); await sleep(400); await A.screenshot({ path: '_work/hand_host.png' });
// a viewer joins with the code: same bytes, no edits of its own
const B = await open(`https://localhost:8897/hand.html?who=handB&room=${room}&nohint`, 'viewer'); await B.waitForFunction(() => BE.sync.role === 'client', null, { timeout: 30000 }); await B.waitForFunction(t => BE.clay && BE.clay.chunks.size > 3 && !BE.clay.dirty.size && !BE.clay.flying && BE.clay.tris() > t * .95, t1, { timeout: 40000 }); ok(true, 'viewer got the piece: ' + await tris(B) + ' tris (host ' + t1 + ')');
await stroke(A, 'clay', [-.1, .2, 0], [.1, .22, 0]); await sleep(1600); await settle(B); const eq = await Promise.all([A, B].map(tris)); ok(Math.abs(eq[0] - eq[1]) < eq[0] * .02, `live edit reaches the viewer: ${eq}`);
await B.waitForFunction(() => BE.api.peers.size > 0, null, { timeout: 8000 }); ok(true, 'viewer sees the host as an EYE'); await sleep(300); await B.screenshot({ path: '_work/hand_viewer.png' });
await B.close();
// persistence
await sleep(2600); await A.reload(); await A.waitForFunction(() => window.BE && BE.api, null, { timeout: 40000 }); await settle(A); const t2 = await tris(A); ok(Math.abs(t2 - eq[0]) < eq[0] * .03, `saved piece comes back after reload: ${t2}`);
// headset session in the emulator
await A.goto('https://localhost:8897/hand.html?who=handA&nohint', { waitUntil: 'load' }); await A.waitForFunction(() => window.BE && BE.api && window.IWER_DEVICE && !document.getElementById('goXR').hidden, null, { timeout: 40000 }); await A.evaluate(() => { IWER_DEVICE.primaryInputMode = 'controller'; }); await A.click('#goXR'); await A.waitForFunction(() => BE.world.renderer.xr.isPresenting, null, { timeout: 30000 }); await sleep(1800);
const r = await A.evaluate(async () => { const I = BE.input; I.sim = {}; const rp = BE.root.position.toArray(), W = (x, y, z) => BE.root.localToWorld(new (BE.root.position.constructor)(x, y, z)).toArray(), before = BE.clay.ver || 0, sl = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i <= 24; i++) { I.sim.R = { pos: W(-.1 + i * .008, .2, .08), trig: 1 }; await sl(16); } I.sim.R = { pos: W(.1, .2, .08), trig: 0 }; await sl(120); const after = BE.clay.ver; const p0 = BE.root.position.clone(); I.sim.R = { pos: W(.2, .35, .2), grip: true, trig: 0 }; await sl(60); for (let i = 0; i < 12; i++) { I.sim.R = { pos: W(.2 + i * .002, .35, .2), grip: true, trig: 0 }; await sl(16); } I.sim.R = { pos: W(0, .35, .2), trig: 0 }; await sl(60); I.sim.L = { pos: W(-.2, .2, .2), palmUp: true }; I.sim.R = { pos: W(.2, .2, .2), palmUp: true }; await sl(300); const menu = BE.devState().menu; return { rp, draws: after - before, moved: BE.root.position.distanceTo(p0), menu, st: BE.devState() }; });
ok(r.draws > 0, 'pinch sculpts in the headset session: ' + r.draws + ' edits'); ok(r.moved > .005, 'grip in the air moves the piece: ' + r.moved.toFixed(3)); ok(r.menu, 'left palm opens the tools'); console.log('  state', JSON.stringify(r.st));
await A.evaluate(() => BE.shot && BE.shot(1000)); await sleep(800);
await browser.close(); console.log(process.exitCode ? 'FAILED' : 'ALL GREEN');
