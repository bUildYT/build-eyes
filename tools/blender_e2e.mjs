// END TO END: a real Blender (add-on link on) + a real studio page. Blender's cube appears in the studio → painted there
//  (Painter, keeps Blender's UVs) → moved there → Blender gets the move + a Principled material with the 4 maps.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path'; import fs from 'node:fs';
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const ADDON = path.resolve('../../claude blender addons/bUild sTudio lInk'), RES = path.resolve('_work/e2e_blender.json');
if (fs.existsSync(RES)) fs.unlinkSync(RES);
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 860 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404/i.test(m.text())) errs.push(m.text()); if (/\[blender\]/.test(m.text())) console.log('   page:', m.text()); });
await p.goto('https://localhost:8897/studio.html?flat&who=e2e&room=E' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.blender, null, { timeout: 60000 });
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); BE.S.layersOpen = false; });
console.log('start Blender (link on, cube in "bUild VR")');
const bl = spawn('C:/Program Files/Blender Foundation/Blender 5.2/blender.exe', ['-b', '--factory-startup', '--python', path.join(ADDON, 'tests/e2e_blender.py'), '--', ADDON, RES]);
let blOut = ''; bl.stdout.on('data', d => blOut += d); bl.stderr.on('data', d => blOut += d);
await p.waitForFunction(() => BE.objs.some(o => o.userData.rec.bl), null, { timeout: 60000 }).catch(() => { });
const got = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.rec.bl); return o && { name: o.userData.rec.name, pos: o.position.toArray().map(v => +v.toFixed(3)) }; });
ok(got && got.name === 'E2E_Cube', 'Blender cube arrived in the studio: ' + JSON.stringify(got));
ok(got && Math.abs(got.pos[1] - .9) < .01 && Math.abs(got.pos[2] + .5) < .01, 'at Blender (0, .5, .9) → studio (0, .9, −.5)');
await p.waitForFunction(() => BE.objs.find(o => o.userData.rec.bl).children.length > 0, null, { timeout: 15000 }).catch(() => { });
console.log('paint it in the studio (Painter keeps Blender UVs)');
await p.evaluate(async () => {
  const o = BE.objs.find(o => o.userData.rec.bl); BE.pf.setActive(o);
  const pm = await BE.pf.makePaintable(o, true); BE.pf.setActive(pm);
  const t = pm.userData.ts; t.addSmart('rusty iron'); t.full();
});
const pmInfo = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.ts); return o && { bl: o.userData.rec.bl, kept: o.userData.rec.keptUVs, layers: o.userData.ts.layers.length }; });
ok(pmInfo && pmInfo.bl && pmInfo.kept, 'painted mesh keeps the Blender link + UVs: ' + JSON.stringify(pmInfo));
await p.waitForTimeout(1500);
console.log('move it in the studio');
await p.evaluate(() => { const o = BE.objs.find(o => o.userData.ts); o.position.x += .3; });
// wait for Blender to report
const t0 = Date.now(); let r = {};
while (Date.now() - t0 < 80000) { if (fs.existsSync(RES)) { try { r = JSON.parse(fs.readFileSync(RES, 'utf8')); } catch { } if (r.moved && r.maps >= 4) break; } await new Promise(res => setTimeout(res, 500)); }
console.log('   blender:', JSON.stringify(r));
ok(r.moved && Math.abs(r.moved[0] - .3) < .02, 'Blender cube moved to x = .3');
ok(r.material && r.maps >= 4, 'Blender got the painted material with ' + r.maps + ' maps');
bl.kill();
await p.screenshot({ path: '_work/blender_e2e.png' });
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
if (process.exitCode) console.log(blOut.split('\n').filter(l => /bUild VR|Error|failed|E2E/.test(l)).slice(-15).join('\n'));
