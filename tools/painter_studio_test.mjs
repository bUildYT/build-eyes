// bUild sTudio · PAINTER in the studio: sculpt → Painter (bake) · smart material via the panel · brush strokes · undo ·
//  a 2nd device gets the same pixels · export maps · save + reload · a shape becomes paintable by painting on it
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const ROOM = 'P' + Math.random().toString(36).slice(2, 7).toUpperCase();
async function open(who, vp = { width: 1400, height: 860 }) {
  const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: vp, acceptDownloads: true }), p = await ctx.newPage();
  p.on('pageerror', e => errs.push(who + ': ' + e.message)); p.on('console', m => { if ((m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404/i.test(m.text())) || /GL_INVALID/.test(m.text())) errs.push(who + ': ' + m.text()); });
  await p.goto(`https://localhost:8897/studio.html?flat&room=${ROOM}&who=${who}`);
  await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.sync && BE.pf, null, { timeout: 60000 });
  return p;
}
const drag = async (p, pts) => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(250); };
const panelClick = (p, id) => p.evaluate(id => { const P = BE.pf.panel; P.draw(); const it = P.items.find(i => i.id === id); if (!it) return false; P.down(it.x + it.w / 2, it.y + it.h / 2); P.up(); return true; }, id);
// a fingerprint of the composited base colour (what you see)
const outHash = p => p.evaluate(() => { const o = BE.objs.find(o => o.userData.ts); if (!o) return null; const ts = o.userData.ts; ts.update(); const px = ts.read(ts.out, 0); let h = 0, n = 0; for (let i = 0; i < px.length; i += 4 * 61) { h = (h * 31 + px[i] + px[i + 1] * 3 + px[i + 2] * 7) % 1e9; n += px[i]; } return h + ':' + n; });

const A = await open('a'); await A.waitForFunction(() => BE.sync.role === 'hub', null, { timeout: 30000 });
await A.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); BE.S.layersOpen = false; });
console.log('sculpt clay (mouse)');
await A.evaluate(() => { BE.setTool('clay'); BE.S.size = .02; BE.S.color = '#c8a070'; });
for (let k = 0; k < 4; k++) await drag(A, [[640, 380 + k * 22], [760, 384 + k * 22], [860, 392 + k * 22]]);
let sc = await A.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt); return o ? o.userData.sculpt.tris() : 0; });
ok(sc > 1000, 'sculpt has ' + sc + ' tris');

console.log('sculpt → Painter (decimate + unwrap + bake from voxels)');
const t0 = Date.now();
await A.evaluate(() => BE.pf.convertActive());
await A.waitForFunction(() => BE.objs.some(o => o.userData.ts), null, { timeout: 60000 });
const pm = await A.evaluate(() => { const o = BE.objs.find(o => o.userData.ts), ts = o.userData.ts; return { tris: o.geometry.index.count / 3, layers: ts.layers.map(l => l.name), bn: !!ts.bnTex, sculptGone: !BE.objs.some(o => o.userData.sculpt), active: BE.S.active === o }; });
console.log('   ', JSON.stringify(pm), (Date.now() - t0) + ' ms');
ok(pm.layers[0] === 'sculpt colours' && pm.bn && pm.sculptGone && pm.active, 'baked: colour layer + detail normal map, sculpt swapped out');
ok(pm.tris < sc, `decimated ${sc} → ${pm.tris} tris`);

console.log('panel: ✦ smart material (rusty iron) + a paint layer');
const h0 = await outHash(A);
await A.evaluate(() => { BE.S.layersOpen = true; BE.pf.panel.open = true; BE.pf.panel.smart = 1; BE.pf.panel.draw(); });
ok(await panelClick(A, 'smart:add'), 'clicked ✦ add');
await A.waitForTimeout(300);
const h1 = await outHash(A); ok(h1 !== h0, 'smart material changed the look');
ok(await panelClick(A, 'add:paint'), 'clicked + paint');
let nl = await A.evaluate(() => BE.pf.activeTs().layers.length); ok(nl >= 5, 'layers now ' + nl);

console.log('brush strokes with the mouse (paint tool)');
await A.evaluate(() => { BE.setTool('paint'); BE.S.color = '#ffd24a'; BE.S.mat = 'gold'; BE.S.size = .006; BE.S.pmode = 'paint'; BE.S.layersOpen = false; });
await A.waitForTimeout(300);
const h2 = await outHash(A);
await drag(A, [[600, 420], [700, 430], [820, 440], [900, 450]]);
await A.waitForTimeout(400);
const h3 = await outHash(A), lv = await A.evaluate(() => { const t = BE.pf.activeTs(); return t.layers[t.sel].ver; });
ok(h3 !== h2 && lv > 0, 'stroke painted into the layer (ver ' + lv + ')');

console.log('Ctrl+Z / Ctrl+Y');
await A.keyboard.press('Control+z'); await A.waitForTimeout(300); const h4 = await outHash(A);
ok(h4 === h2, 'undo took the stroke back');
await A.keyboard.press('Control+y'); await A.waitForTimeout(300); const h5 = await outHash(A);
ok(h5 === h3, 'redo brought it back');

console.log('a 2nd device joins → same painted result');
const B = await open('b', { width: 900, height: 900 });
await B.waitForFunction(() => BE.sync.snapAt, null, { timeout: 30000 });
await B.waitForFunction(() => BE.objs.some(o => o.userData.ts), null, { timeout: 30000 }); await B.waitForTimeout(1500);
const hb = await outHash(B), ha = await outHash(A);
ok(hb === ha, 'B pixels = A pixels' + (hb === ha ? '' : ` (${ha} vs ${hb})`));
console.log('A paints again → B gets it live');
await drag(A, [[620, 470], [760, 470], [880, 470]]); await A.waitForTimeout(2500);
const ha2 = await outHash(A), hb2 = await outHash(B);
ok(ha2 !== ha && hb2 === ha2, 'live stroke arrived on B');
console.log('B changes a layer (opacity) → A');
await B.evaluate(() => { const t = BE.pf.activeTs() || BE.objs.find(o => o.userData.ts).userData.ts; BE.pf.setActive(BE.objs.find(o => o.userData.ts)); t.layers[1].opacity = .3; t.full(); }); await B.waitForTimeout(1200);
ok(await A.evaluate(() => BE.objs.find(o => o.userData.ts).userData.ts.layers[1].opacity) === .3, 'opacity .3 arrived on A');

console.log('export PBR maps');
const dl = A.waitForEvent('download', { timeout: 30000 });
await A.evaluate(() => { BE.pf.setActive(BE.objs.find(o => o.userData.ts)); return BE.pf.exportMaps(); });
const d = await dl; const f = '_work/painter_maps.zip'; await d.saveAs(f);
ok(fs.statSync(f).size > 50000, 'maps zip ' + (fs.statSync(f).size / 1e6).toFixed(2) + ' MB');

console.log('save + reload (A)');
await A.evaluate(() => BE.sendNow(true)); await A.waitForTimeout(1500);
const before = await outHash(A);
await B.context().close();
await A.reload(); await A.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.objs.some(o => o.userData.ts), null, { timeout: 60000 }); await A.waitForTimeout(800);
const after = await outHash(A);
ok(after === before, 'reloaded painted mesh = same pixels' + (after === before ? '' : ` (${before} vs ${after})`));

console.log('a shape: paint on it → it becomes paintable');
await A.evaluate(() => { const rec = { id: BE.newId(), type: 'shape', prim: 'box', color: '#3a8bff', mat: 'plastic' }, o = BE.buildObject(rec); o.position.set(-.18, 0, 0); o.scale.setScalar(.12); BE.addObj(o); });
const n0 = await A.evaluate(() => BE.objs.filter(o => o.userData.ts).length);
await A.evaluate(() => { BE.flat.controls.target.set(...BE.objs.find(o => o.userData.rec.type === 'shape').getWorldPosition(new BE.world.camera.position.constructor()).toArray()); BE.flat.controls.update(); BE.setTool('paint'); });
await A.waitForTimeout(500);
await drag(A, [[690, 420], [710, 430]]);
await A.waitForFunction(n0 => BE.objs.filter(o => o.userData.ts).length > n0, n0, { timeout: 30000 }).catch(() => { });
ok(await A.evaluate(n0 => BE.objs.filter(o => o.userData.ts).length > n0, n0), 'box became a painted mesh');
await A.evaluate(() => { BE.S.layersOpen = true; BE.pf.panel.open = true; BE.pf.panel.draw(); }); await A.waitForTimeout(600);
await A.screenshot({ path: '_work/painter_studio.png' });

console.log('errors:', errs.length ? errs.slice(0, 8) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
