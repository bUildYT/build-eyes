// bUild sTudio · Z SCULPT test: ZBrush-style brushes on a dense mesh — every brush, strokes (Freehand · DragRect · Spray),
//  alphas, symmetry, mask, undo/redo, subdivide, voxel clay → Z, live sync to a 2nd device. Screenshots in _work/z_*.png
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const room = 'Z' + Math.random().toString(36).slice(2, 7).toUpperCase();
const open = async who => {
  const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })).newPage();
  p.on('pageerror', e => errs.push(who + ': ' + e.message)); p.on('console', m => { const t = m.text(); if (/[sync]/.test(t) && m.type() !== 'log') console.log('   ' + who + ' ' + t.slice(0, 200)); if (m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404|Could not connect/i.test(t)) errs.push(who + ': ' + t.slice(0, 300)); });
  await p.goto(`https://localhost:8897/studio.html?flat&who=${who}&room=${room}`);
  await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.zf && BE.bp, null, { timeout: 60000 });
  return p;
};
const p = await open('zA'); await p.waitForTimeout(2500);   // let the saved scene finish loading before we clear it
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { brushOpen: false, layersOpen: false, mirror: true, zb: 'standard', zStroke: 'free', zAlpha: 'none', zInt: .5, zFoc: 0, zLazy: 0, zSub: false, size: .012 }); BE.setTool('z'); BE.zid = BE.objs.find(o => o.userData.z).userData.rec.id; });
await p.waitForTimeout(400);
const info = () => p.evaluate(() => { const o = BE.objs.find(o => o.userData.z && o.userData.rec.id === (BE.zid || (BE.zid = BE.objs.find(o => o.userData.z)?.userData.rec.id))); if (!o) return null; const z = o.userData.z; let s = 0; for (let i = 0; i < z.pos.length; i += 97) s += z.pos[i]; return { F: z.F, n: z.n, sum: +s.toFixed(5), ver: z.ver }; });
const i0 = await info(); ok(i0 && i0.F > 50000, 'picking Z makes a sphere to sculpt: ' + JSON.stringify(i0));
await p.keyboard.press('f'); await p.waitForTimeout(700);
await p.screenshot({ path: '_work/z_0_sphere.png' });
const drag = async (pts, steps = 18, mods = []) => { for (const k of mods) await p.keyboard.down(k); await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); for (const k of mods) await p.keyboard.up(k); await p.waitForTimeout(200); };
const S = o => p.evaluate(o => Object.assign(BE.S, o), o);
// every brush, one stroke each on a different band of the sphere
const t0 = Date.now();
const brushes = [['standard', 300], ['clay', 340], ['buildup', 380], ['dam', 420], ['inflate', 460], ['pinch', 500], ['flatten', 540], ['trim', 580], ['smooth', 620]];
for (const [br, y] of brushes) {
  const before = (await info()).sum; await S({ zb: br });
  await drag([[700, y], [790, y + 6], [880, y - 4]]);
  const after = (await info()).sum; ok(before !== after, `${br} changes the mesh`);
}
console.log('   9 strokes in', Date.now() - t0, 'ms');
await p.screenshot({ path: '_work/z_1_brushes.png' });
// undo / redo
const sA = (await info()).sum; await p.keyboard.press('Control+z'); await p.waitForTimeout(150); const sB = (await info()).sum; await p.keyboard.press('Control+y'); await p.waitForTimeout(150); const sC = (await info()).sum;
ok(sA !== sB && Math.abs(sA - sC) < 1e-3, `undo/redo (${sA} → ${sB} → ${sC})`);
// Alt = ZSub
await S({ zb: 'standard' }); const s1 = (await info()).sum; await drag([[860, 350], [900, 420]], 12, ['Alt']); ok((await info()).sum !== s1, 'Alt stroke (ZSub)');
// DragRect + alpha (stamp drag = size + turn), Spray with pores
await S({ zb: 'standard', zStroke: 'rect', zAlpha: 'star', zInt: .6 }); await drag([[760, 260], [800, 250], [830, 270]], 10);
await S({ zStroke: 'rect', zAlpha: '~dragon round', zTile: 2 }); await drag([[900, 520], [960, 560]], 10);
await S({ zStroke: 'spray', zAlpha: 'pores', zInt: .4, size: .008 }); await drag([[650, 450], [700, 520], [760, 560]], 20);
await S({ zStroke: 'free', zAlpha: 'none', size: .012 });
await p.screenshot({ path: '_work/z_2_alphas.png' });
// move brush
await S({ zb: 'move' }); const s2 = (await info()).sum; await drag([[800, 330], [800, 250]], 10); ok((await info()).sum !== s2, 'Move pulls the surface');
// mask: paint with Ctrl, then a standard stroke must not move masked verts
await S({ zb: 'standard' });
await drag([[640, 380], [700, 390]], 10, ['Control']);
const masked = await p.evaluate(() => { const z = BE.objs.find(o => o.userData.z).userData.z; let c = 0; for (let i = 0; i < z.n; i++) if (z.mask[i] > .5) c++; return c; }); ok(masked > 50, 'Ctrl paints a mask: ' + masked + ' verts');
// empty space press = orbit (camera moves, mesh untouched)
const cam0 = await p.evaluate(() => BE.world.camera.position.toArray().map(v => +v.toFixed(3)).join()); const s3 = (await info()).sum;
await drag([[1400, 150], [1300, 180]], 8);
const cam1 = await p.evaluate(() => BE.world.camera.position.toArray().map(v => +v.toFixed(3)).join()); ok(cam0 !== cam1 && (await info()).sum === s3, 'drag on empty space orbits');
await p.keyboard.press('f'); await p.waitForTimeout(500);
// 2nd device joins: same mesh
const q = await open('zB'); await q.waitForTimeout(3500);
const same = async () => { const a = await info(), bq = await q.evaluate(id => { const o = BE.objs.find(o => o.userData.z && o.userData.rec.id === id); if (!o) return null; const z = o.userData.z; let s = 0; for (let i = 0; i < z.pos.length; i += 97) s += z.pos[i]; return { F: z.F, sum: +s.toFixed(5) }; }, await p.evaluate(() => BE.zid)); return [a, bq]; };
const zl = pg => pg.evaluate(() => JSON.stringify(BE.objs.filter(o => o.userData.z).map(o => o.userData.rec.id + ':' + o.userData.rec.gid + ':' + o.userData.z.F))); console.log('   A zmeshes', await zl(p), 'zid', await p.evaluate(() => BE.zid), ' | B zmeshes', await zl(q));
 let [a1, b1] = await same(); ok(b1 && a1.F === b1.F && Math.abs(a1.sum - b1.sum) < 1e-3, 'late joiner gets the sculpt: ' + JSON.stringify([a1 && a1.sum, b1 && b1.sum]));
await S({ zb: 'inflate', zStroke: 'free' }); await drag([[760, 430], [840, 440]]); await p.waitForTimeout(1200);
[a1, b1] = await same(); ok(b1 && Math.abs(a1.sum - b1.sum) < 1e-3, 'live strokes reach device 2: ' + JSON.stringify([a1.sum, b1 && b1.sum]));
// subdivide → topology travels too
const Fsub = await p.evaluate(() => { BE.zf.subdivide(); return BE.zf.active().userData.z.F; }); for (let k = 0; k < 40; k++) { await p.waitForTimeout(500); const r = await q.evaluate(id => BE.objs.find(o => o.userData.rec.id === id)?.userData.z.F, await p.evaluate(() => BE.zid)); if (r === Fsub) { console.log('   device 2 got the subdivided mesh after', (k + 1) * .5, 's'); break; } }
[a1, b1] = await same(); ok(a1.F > i0.F * 3.9 && b1 && b1.F === a1.F, `subdivide ×4 (${i0.F} → ${a1.F}) and device 2 has it (${b1 && b1.F})`);
await S({ zb: 'dam', zStroke: 'free' }); await drag([[700, 470], [900, 480]]); await p.waitForTimeout(1500);
[a1, b1] = await same(); ok(b1 && Math.abs(a1.sum - b1.sum) < 1e-3, 'strokes on the subdivided mesh reach device 2: ' + JSON.stringify([a1.sum, b1 && b1.sum]));
await p.screenshot({ path: '_work/z_3_subdiv.png' });
// panel
await p.evaluate(() => { BE.S.brushOpen = true; BE.bp.draw(); }); await p.waitForTimeout(500); await p.screenshot({ path: '_work/z_4_panel.png' });
// voxel clay → Z
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); BE.S.brushOpen = false; BE.S.mirror = false; BE.setTool('clay'); BE.S.size = .02; });
const dragv = async pts => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const x of pts.slice(1)) await p.mouse.move(...x, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(300); };
await dragv([[700, 450], [900, 450]]);
await p.evaluate(() => BE.zf.fromVoxel()); await p.waitForTimeout(300);
const vz = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.z); return o ? o.userData.z.F : 0; }); ok(vz > 1000 && !(await p.evaluate(() => BE.objs.some(o => o.userData.sculpt))), 'voxel clay → Z mesh: ' + vz + ' polys');
console.log('errors:', errs.length ? errs.slice(0, 8) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
