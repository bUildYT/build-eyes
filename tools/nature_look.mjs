// bUild sTudio · NATURE look: one dragon (mirror strokes), then the same creature at age 0 / .5 / 1 — overview + macro shots.
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })).newPage();
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404/i.test(m.text())) errs.push(m.text()); });
await p.goto('https://localhost:8897/studio.html?flat&who=nature&room=N' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.pf && BE.bp, null, { timeout: 60000 });
await p.evaluate(rc => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { layersOpen: false, brushOpen: false, mirror: true, wild: false, tone: 'reptile', recipe: rc, size: .016, chaos: .35 }); BE.setTool('chaos'); }, process.argv[2] || 'dragon');
const drag = async (pts, steps = 14) => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); await p.waitForTimeout(250); };
await drag([[760, 470], [800, 430], [860, 420], [930, 440]]);
await p.evaluate(() => { BE.S.size = .009; });
await drag([[920, 430], [960, 360], [980, 300], [1010, 270]]);
await drag([[760, 470], [700, 520], [640, 540], [580, 520]]);
await p.evaluate(() => { const u = document.getElementById('flatui'); if (u) u.style.visibility = 'hidden'; for (const e of document.querySelectorAll('.say, #say, #ver')) e.style.visibility = 'hidden'; });
const sk = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt); return o && o.userData.rec.skin; });
ok(sk && sk.g != null, 'nature skin on the dragon: ' + JSON.stringify(sk));
await p.keyboard.press('f'); await p.waitForTimeout(700);
const tag = process.argv[2] || 'dragon';
for (const g of [0, .5, 1]) {
  await p.evaluate(g => { const o = BE.objs.find(o => o.userData.sculpt); const s = { ...o.userData.rec.skin, g }; o.userData.sculpt.setSkin(s); }, g);
  await p.waitForTimeout(300); await p.screenshot({ path: `_work/nature_${tag}_age${g}.png` });
}
await p.evaluate(() => { const c = BE.world.camera, t = BE.flat.controls.target; c.position.lerp(t, .6); BE.flat.controls.update(); }); await p.waitForTimeout(400);
for (const g of [0, 1]) {
  await p.evaluate(g => { const o = BE.objs.find(o => o.userData.sculpt); o.userData.sculpt.setSkin({ ...o.userData.rec.skin, g }); }, g);
  await p.waitForTimeout(300); await p.screenshot({ path: `_work/nature_${tag}_macro_age${g}.png` });
}
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
