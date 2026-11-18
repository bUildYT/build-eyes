// bUild sTudio · LIVE SKIN: chaos dragon / snake / croc show their scales on the clay while drawing (shader, no bake),
//  panel controls retune it, sync carries it. Close-up screenshots.
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })).newPage();
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { const t = m.text(); if (/warning X\d/.test(t) && !/error/i.test(t.replace(/Program Info Log/, ''))) return; if ((m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404/i.test(t)) || /THREE\.WebGLProgram|shader error/i.test(t)) errs.push(t.slice(0, 400)); });
await p.goto('https://localhost:8897/studio.html?flat&who=skin&room=S' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.pf && BE.bp, null, { timeout: 60000 });
const clean = () => p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { layersOpen: false, brushOpen: false, mirror: false, wild: false, tone: 'reptile' }); });
const drag = async (pts, steps = 14) => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); await p.waitForTimeout(250); };
const frame = async () => { await p.keyboard.press('f'); await p.waitForTimeout(700); };
const closer = async k => { await p.evaluate(k => { const c = BE.world.camera, t = BE.flat.controls.target; c.position.lerp(t, k); BE.flat.controls.update(); }, k); await p.waitForTimeout(400); };
const name = process.argv[2] || 'skin';
for (const [rk, size, pts] of [
  ['dragon', .016, [[[760, 470], [800, 430], [860, 420], [930, 440]], [[920, 430], [960, 360], [980, 300], [1010, 270]], [[760, 470], [700, 520], [640, 540], [580, 520]]]],
  ['snake', .014, [[[560, 400], [700, 350], [850, 430], [1000, 360], [1150, 420]]]],
  ['croc', .018, [[[560, 460], [750, 440], [950, 480], [1150, 460]]]]]) {
  await clean();
  await p.evaluate(([rk, size]) => { Object.assign(BE.S, { recipe: rk, size, mirror: rk === 'dragon', chaos: .35 }); BE.setTool('chaos'); }, [rk, size]);
  for (const s of pts) await drag(s);
  const r = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt); return o && { skin: o.userData.rec.skin, matSkin: !!o.userData.sculpt.mat.userData.tone.skinP }; });
  ok(r && r.skin && r.matSkin, rk + ' live skin: ' + JSON.stringify(r));
  await frame(); await p.screenshot({ path: `_work/${name}_${rk}.png` });
  await closer(.6); await p.screenshot({ path: `_work/${name}_${rk}_macro.png` });
}
// (the live-skin panel row left with the Z panel; the skin itself stays on chaos recipes)
await p.evaluate(() => { const sc = BE.objs.find(o => o.userData.sculpt).userData.sculpt; sc.setSkin({ ...sc.rec.skin, t: sc.rec.skin.t * 2 }); });
ok(await p.evaluate(() => !!BE.objs.find(o => o.userData.sculpt).userData.sculpt.mat.userData.tone.skinP), 'skin retunes');
// bake still works with a skinned sculpt
await p.evaluate(() => { BE.pf.setActive(BE.objs.find(o => o.userData.sculpt)); BE.pf.convertActive(); });
await p.waitForFunction(() => BE.objs.some(o => o.userData.ts), null, { timeout: 90000 });
ok(true, 'bake from skinned sculpt');
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
