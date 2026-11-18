// bUild sTudio · what you see in the headset: VR world, sculpt in front of you, palette on the left controller → _work/vr_look.png
import { chromium } from 'playwright'; import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
if (fs.existsSync('_work/studio/scene.json')) fs.renameSync('_work/studio/scene.json', '_work/studio/scene.json.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://localhost:8897/studio.html?who=vrlook'); await p.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('goVR').hidden, null, { timeout: 60000 });
await p.evaluate(() => { IWER_DEVICE.primaryInputMode = 'controller'; }); await p.click('#goVR');
await p.waitForFunction(() => BE.world.renderer.xr.isPresenting, null, { timeout: 30000 }); await p.waitForTimeout(1500);
const t = await p.evaluate(async () => {
  const w = ms => new Promise(r => setTimeout(r, ms)), V = BE.root.position.constructor, W = (x, y, z) => BE.root.localToWorld(new V(x, y, z)).toArray();
  for (const o of [...BE.objs]) BE.removeObj(o);
  BE.input.sim = { L: { pos: W(-.22, .05, .18), quat: [-.3, .2, 0, .93] } };
  BE.setTool('clay'); BE.S.size = .01; BE.S.color = '#e8d6b8'; BE.S.mat = 'clay'; BE.S.mirror = true;
  const stroke = async pts => { for (let i = 0; i < pts.length; i++) { BE.input.sim.R = { pos: W(...pts[i]), trig: 1 }; await w(25); } BE.input.sim.R = { pos: W(...pts.at(-1)), trig: 0 }; await w(120); };
  const arc = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1)));
  const t0 = performance.now();
  await stroke(arc(30, k => [.0, .02 + k * .12, 0]));                                   // spine
  await stroke(arc(25, k => [.03 + k * .05, .1 + Math.sin(k * 3) * .02, -.01]));         // wing / arm (mirrored)
  await stroke(arc(20, k => [.015, .02 - k * .02, .01 + k * .03]));                       // leg (mirrored)
  BE.setTool('texture'); BE.S.pattern = 'scales'; await stroke(arc(30, k => [.01 * Math.sin(k * 9), .03 + k * .08, .02]));
  BE.S.mat = 'worn'; BE.setTool('fill'); await stroke([[0, .07, .0]]);
  BE.input.sim.R = { pos: W(.08, .12, .1), quat: [0, 0, 0, 1], trig: 0 }; await w(500);
  return { ms: Math.round(performance.now() - t0), objs: BE.devState().objs };
});
console.log(JSON.stringify(t));
console.log(JSON.stringify(await p.evaluate(() => { const V = BE.root.position.constructor, B = new (BE.world.scene.constructor)(); const cam = BE.world.renderer.xr.getCamera(); const box = []; for (const o of BE.objs) { o.updateMatrixWorld(true); const ch = o.children[0]; box.push({ kids: o.children.length, wp: o.getWorldPosition(new V()).toArray().map(v => +v.toFixed(2)), vis: o.visible, inScene: !!o.parent, child0: ch ? { vis: ch.visible, n: ch.geometry.index.count, bs: ch.geometry.boundingSphere && ch.geometry.boundingSphere.center.toArray().map(v => +v.toFixed(3)) } : null }); } return { root: BE.root.getWorldPosition(new V()).toArray().map(v => +v.toFixed(2)), cam: new V().setFromMatrixPosition(cam.matrixWorld).toArray().map(v => +v.toFixed(2)), panel: BE.menu.panel.visible, objs: box }; })));
await p.screenshot({ path: '_work/vr_look.png' });
console.log('errors', errs); await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
