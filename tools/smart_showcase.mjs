// bUild sTudio · a little sculpted creature, then every smart material on it → _work/smart_<mat>.png (look check + reel stills)
import { chromium } from 'playwright'; import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
if (fs.existsSync('_work/studio/scene.json')) fs.renameSync('_work/studio/scene.json', '_work/studio/scene.json.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://localhost:8897/studio.html?flat&who=show'); await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on, null, { timeout: 60000 }); await p.waitForTimeout(400);
const t = await p.evaluate(() => {
  const V = BE.root.position.constructor, t0 = performance.now();
  for (const o of [...BE.objs]) BE.removeObj(o);
  const o = BE.buildObject({ id: BE.newId(), type: 'sculpt', vs: .0025, mat: 'clay', m: new BE.M4().makeTranslation(0, .12, 0).toArray() }); BE.addObj(o);
  const s = o.userData.sculpt, v = (x, y, z) => new V(x, y, z), seg = (a, c, ra, rb, sub) => s.segment(a, c, ra, rb, sub, '#c9b08e', 'clay');
  // a chunky little guardian: body, head, snout, horns, arms, legs, a belly plate, carved eyes + grooves
  seg(v(0, -.02, 0), v(0, .03, 0), .045, .04);                 // body
  seg(v(0, .07, .01), v(0, .075, .012), .032, .03);            // head
  seg(v(0, .065, .03), v(0, .06, .055), .018, .014);           // snout
  seg(v(-.02, .095, 0), v(-.04, .13, -.02), .009, .003);       // horns
  seg(v(.02, .095, 0), v(.04, .13, -.02), .009, .003);
  seg(v(-.045, .03, 0), v(-.07, -.01, .02), .014, .011);       // arms
  seg(v(.045, .03, 0), v(.07, -.01, .02), .014, .011);
  seg(v(-.022, -.05, 0), v(-.026, -.085, .005), .017, .015);   // legs
  seg(v(.022, -.05, 0), v(.026, -.085, .005), .017, .015);
  seg(v(0, -.01, .038), v(0, .025, .036), .022, .02);          // belly plate
  s.carve(v(-.012, .08, .036), .007); s.carve(v(.012, .08, .036), .007);   // eye sockets
  seg(v(-.012, .08, .03), v(-.012, .08, .03), .0045, .0045);   // eyeballs
  seg(v(.012, .08, .03), v(.012, .08, .03), .0045, .0045);
  for (let i = 0; i < 4; i++) seg(v(-.03, -.01 + i * .012, .045), v(.03, -.01 + i * .012, .045), .0022, .0022, true);   // belly grooves
  seg(v(-.008, .062, .066), v(.008, .062, .066), .0025, .0025, true);   // mouth
  for (let i = 0; i < 3; i++) s.smooth(v(0, .02, 0), .06, .35);
  s.flush();
  return { ms: Math.round(performance.now() - t0), tris: s.tris() };
});
console.log('sculpted', JSON.stringify(t));
console.log('k dist', JSON.stringify(await p.evaluate(() => { const s = BE.objs[0].userData.sculpt, ks = []; for (const ch of s.chunks.values()) for (let z = 0; z < 24; z++) for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { const d = ch.d[x + 24 * (y + 24 * z)]; if (Math.abs(d) < .25) ks.push(s.curvature(ch.cx * 24 + x, ch.cy * 24 + y, ch.cz * 24 + z)); } ks.sort((a, b) => a - b); const q = f => +ks[Math.floor(f * (ks.length - 1))].toFixed(3); return [q(.02), q(.1), q(.25), q(.5), q(.75), q(.9), q(.98)]; })));
await p.evaluate(() => { const o = BE.objs[0]; const c = o.localToWorld(new BE.root.position.constructor(0, .02, 0)); BE.flat.controls.target.copy(c); BE.world.camera.position.copy(c).add(new BE.root.position.constructor(.11, .06, .24)); BE.flat.controls.update(); document.getElementById('fPalBox').style.display = 'none'; document.querySelector('#flatui .tip').style.display = 'none'; });
for (const mat of ['clay', 'worn', 'rust', 'moss', 'chipped', 'bronze']) {
  const ms = await p.evaluate(m => { const s = BE.objs[0].userData.sculpt, t = performance.now(); s.fill(m === 'chipped' ? '#c8322a' : '#c9b08e', m); s.flush(); return Math.round(performance.now() - t); }, mat);
  await p.waitForTimeout(500); await p.screenshot({ path: `_work/smart_${mat}.png` }); console.log(mat, ms, 'ms');
}
// texture brush: dragon scales on the body + rock on the horns, then bronze, then a reel
const tx = await p.evaluate(() => { const s = BE.objs[0].userData.sculpt, V = BE.root.position.constructor, t = performance.now();
  s.begin(); for (let y = -.06; y <= .05; y += .008) for (let a = 0; a < 6.28; a += .5) s.texture(new V(Math.sin(a) * .045, y, Math.cos(a) * .045), .02, .25, 'scales');
  for (const sx of [-1, 1]) for (let k = 0; k < 1; k += .15) s.texture(new V(sx * (.02 + .02 * k), .095 + .035 * k, -.02 * k), .01, .3, 'rock');
  const e = s.end(); s.fill('#c9b08e', 'bronze'); s.flush(); return Math.round(performance.now() - t); });
await p.waitForTimeout(400); await p.screenshot({ path: '_work/smart_textured.png' }); console.log('texture + bronze', tx, 'ms');
const mk = await p.evaluate(() => { const s = BE.objs[0].userData.sculpt, V = BE.root.position.constructor; s.fill('#c9b08e', 'clay'); s.flush();
  const red = () => { let e = 0, c = 0, n = 0; for (const ch of s.chunks.values()) for (let z = 0; z < 24; z++) for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) { const i = x + 24 * (y + 24 * z); if (Math.abs(ch.d[i]) > .3 || ch.col[i * 3] < 200 || ch.col[i * 3 + 1] > 120) continue; n++; const k = s.curvature(ch.cx * 24 + x, ch.cy * 24 + y, ch.cz * 24 + z); if (k > .03) e++; if (k < -.01) c++; } return { n, edges: e, cav: c }; };
  s.paint(new V(0, 0, .03), .07, '#ff2020', 'plastic', 1, 'cavities'); const cav = red();
  s.fill('#c9b08e', 'clay'); s.paint(new V(0, 0, .03), .07, '#ff2020', 'plastic', 1, 'edges'); const edg = red(); s.flush(); return { cav, edg }; });
console.log('mask', JSON.stringify(mk), mk.cav.cav > mk.cav.edges && mk.edg.edges > mk.edg.cav ? 'OK' : 'FAIL');
await p.screenshot({ path: '_work/smart_mask_edges.png' });
const reel = { skipped: true };
console.log('errors', errs); await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
