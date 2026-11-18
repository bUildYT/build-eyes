// bUild sTudio · DRAGON LAB: nature recipes (dragon / snake / croc) as chaos strokes with smart tone, texture-sculpt with alphas,
//  the Painter brush with an alpha (height + tone at texture resolution). Close-up screenshots.
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })).newPage();
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404/i.test(m.text())) errs.push(m.text()); });
await p.goto('https://localhost:8897/studio.html?flat&who=dragon&room=D' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.pf && BE.bp, null, { timeout: 60000 });
const clean = () => p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { layersOpen: false, brushOpen: false, mirror: false, wild: false, tone: 'reptile' }); });
await clean();
const drag = async (pts, steps = 14) => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); await p.waitForTimeout(250); };
const frame = async () => { await p.keyboard.press('f'); await p.waitForTimeout(700); };
// ---- 1. a dragon from chaos strokes (mirror on): body, neck up, tail down
await p.evaluate(() => { Object.assign(BE.S, { recipe: 'dragon', size: .016, mirror: true, chaos: .35 }); BE.setTool('chaos'); });
await drag([[760, 470], [800, 430], [860, 420], [930, 440]]);                // body (one side; the mirror adds the other)
await p.evaluate(() => { BE.S.size = .009; });
await drag([[920, 430], [960, 360], [980, 300], [1010, 270]]);               // neck
await drag([[760, 470], [700, 520], [640, 540], [580, 520]]);                // tail
const dr = await p.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt); return o && { tris: o.userData.sculpt.tris(), tone: o.userData.rec.tone, hasTone: !![...o.userData.sculpt.chunks.values()].find(c => c.mesh && c.mesh.geometry.attributes.tone) }; });
ok(dr && dr.tris > 5000 && dr.tone === 'reptile' && dr.hasTone, 'dragon sculpt with smart tone: ' + JSON.stringify(dr));
await p.screenshot({ path: '_work/dragon_overview.png' });
await frame(); await p.screenshot({ path: '_work/dragon_close.png' });
// ---- 1b. bake into the Painter → the dragon skin arrives by itself (scales at texture resolution)
await p.evaluate(() => { BE.pf.setActive(BE.objs.find(o => o.userData.sculpt)); BE.pf.convertActive(); });
await p.waitForFunction(() => BE.objs.some(o => o.userData.ts), null, { timeout: 90000 });
const sk = await p.evaluate(() => BE.objs.find(o => o.userData.ts).userData.ts.layers.map(l => l.name));
ok(sk.includes('scales') && sk.includes('belly'), 'dragon skin auto-applied: ' + sk.join(', '));
await p.waitForTimeout(800); await frame(); await p.screenshot({ path: '_work/dragon_painted.png' });
await p.evaluate(() => { BE.flat.controls.dollyIn ? 0 : 0; const c = BE.world.camera, t = BE.flat.controls.target; c.position.lerp(t, .55); BE.flat.controls.update(); }); await p.waitForTimeout(500);
await p.screenshot({ path: '_work/dragon_painted_macro.png' });
console.log('   errs after dragon', errs.length);
// ---- 2. snake + croc strokes
await clean();
await p.evaluate(() => { Object.assign(BE.S, { recipe: 'snake', size: .014, mirror: false, chaos: .25 }); BE.setTool('chaos'); });
await drag([[560, 300], [700, 250], [850, 330], [1000, 260], [1150, 320]]);
await p.evaluate(() => { BE.S.recipe = 'croc'; BE.setTool('chaos'); BE.S.size = .018; });
await drag([[560, 560], [750, 540], [950, 580], [1150, 560]]);
await p.screenshot({ path: '_work/snake_croc.png' });
console.log('   errs after snake', errs.length);
// ---- 3. texture-sculpt: clay blob, then drag the 'dragon round' alpha over it
await clean();
await p.evaluate(() => { BE.S.size = .03; BE.S.color = '#8a9a50'; BE.setTool('clay'); });
for (let k = 0; k < 3; k++) await drag([[700, 380 + k * 40], [850, 385 + k * 40], [1000, 390 + k * 40]]);
const before = await p.evaluate(() => BE.objs.find(o => o.userData.sculpt).userData.sculpt.ver);
await p.evaluate(() => { Object.assign(BE.S, { alpha: 'dragon round', size: .02, color: '#3a6a2a', aStr: 1.2, aCol: .7 }); BE.setTool('alpha'); });
for (let k = 0; k < 3; k++) await drag([[690, 375 + k * 40], [1010, 380 + k * 40]], 30);
const after = await p.evaluate(() => BE.objs.find(o => o.userData.sculpt).userData.sculpt.ver);
ok(after > before, `alpha strokes changed the sculpt (ver ${before} → ${after})`);
await frame(); await p.screenshot({ path: '_work/alpha_sculpt.png' });
console.log('   errs after alpha sculpt', errs.length);
// ---- 4. the Painter brush with an alpha on a painted mesh
await p.evaluate(() => BE.pf.convertActive()); await p.waitForFunction(() => BE.objs.some(o => o.userData.ts), null, { timeout: 60000 });
await p.evaluate(() => { Object.assign(BE.S, { alpha: 'snake keeled', palpha: true, size: .015, color: '#c8a040', layersOpen: false }); BE.setTool('paint'); });
console.log('   pm', await p.evaluate(() => { const o = BE.objs.find(o => o.userData.ts); return JSON.stringify({ layers: o.userData.ts.layers.map(l => l.name + ':' + l.ver), sel: o.userData.ts.sel, tool: BE.S.tool, pal: BE.S.palpha }); }));
const h0 = await p.evaluate(() => { const t = BE.objs.find(o => o.userData.ts).userData.ts; t.update(); const px = t.read(t.out, 2); let n = 0; for (let i = 0; i < px.length; i += 4 * 53) n += Math.abs(px[i] - 128); return n; });
for (let k = 0; k < 3; k++) await drag([[700, 380 + k * 45], [1000, 390 + k * 45]], 30);
const h1 = await p.evaluate(() => { const t = BE.objs.find(o => o.userData.ts).userData.ts; t.update(); const px = t.read(t.out, 2); let n = 0; for (let i = 0; i < px.length; i += 4 * 53) n += Math.abs(px[i] - 128); return n; });
ok(h1 > h0 * 1.05, `painter alpha added surface detail (normal map energy ${h0} → ${h1})`);
await p.screenshot({ path: '_work/alpha_painter.png' });
// ---- the panel
await p.evaluate(() => { BE.S.brushOpen = true; BE.bp.draw(); }); await p.waitForTimeout(500); await p.screenshot({ path: '_work/alpha_panel.png' });
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
