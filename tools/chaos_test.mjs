// bUild sTudio · CHAOS brushes: every recipe as a mouse stroke (geometry + material at once), wild + mirror, then smart cuts.
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
for (const f of ['_work/studio/scene.json']) if (fs.existsSync(f)) fs.renameSync(f, f + '.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 900 } })).newPage();
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/peer|webrtc|ice|devlink|__q|404/i.test(m.text())) errs.push(m.text()); });
await p.goto('https://localhost:8897/studio.html?flat&who=chaos&room=C' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on && BE.pf, null, { timeout: 60000 });
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); BE.S.layersOpen = false; BE.S.mirror = false; BE.S.wild = false; BE.S.size = .011; BE.setTool('chaos'); });
await p.waitForTimeout(400);
const drag = async (pts, steps = 12) => { await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); await p.waitForTimeout(200); };
const recipes = ['python', 'lizard', 'gecko', 'rhino', 'mountain', 'tiger', 'leopard', 'giraffe', 'vulture', 'coral', 'crystal', 'tentacle'];
const t0 = Date.now();
for (let i = 0; i < recipes.length; i++) {
  const cx = 560 + (i % 4) * 250, cy = 120 + Math.floor(i / 4) * 230;
  await p.evaluate(k => { BE.S.recipe = k; BE.setTool('chaos'); }, recipes[i]);
  await drag([[cx - 90, cy + 20], [cx - 30, cy - 25], [cx + 30, cy + 25], [cx + 90, cy - 15]]);
}
console.log('    12 strokes in', Date.now() - t0, 'ms');
const st = await p.evaluate(() => { const ss = BE.objs.filter(o => o.userData.sculpt); let cols = new Set(), tris = 0; for (const o of ss) { const sc = o.userData.sculpt; tris += sc.tris(); for (const ch of sc.chunks.values()) for (let i = 0; i < ch.d.length; i += 7) if (ch.d[i] > 0 && ch.d[i] < .9) cols.add((ch.col[i * 3] >> 4) + ',' + (ch.col[i * 3 + 1] >> 4) + ',' + (ch.col[i * 3 + 2] >> 4)); } return { n: ss.length, tris, colours: cols.size }; });
console.log('   ', JSON.stringify(st));
ok(st.n >= 3, 'sculpts: ' + st.n + ' · objs: ' + JSON.stringify(await p.evaluate(() => BE.objs.map(o => o.userData.rec.type))));
ok(st.colours > 60, 'rich colour variety on the surfaces (' + st.colours + ' colour buckets)');
await p.screenshot({ path: '_work/chaos_recipes.png' });
// wild + mirror
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); BE.S.wild = true; BE.S.mirror = true; BE.S.size = .016; BE.setTool('chaos'); BE.root.position.set(0, 0, 0); });
for (let k = 0; k < 5; k++) await drag([[700 + k * 30, 300 + k * 60], [820, 260 + k * 60], [940 - k * 20, 330 + k * 50]], 14);
const w = await p.evaluate(() => BE.objs.filter(o => o.userData.sculpt).reduce((s, o) => s + o.userData.sculpt.tris(), 0));
ok(w > 5000, 'wild mirrored creature: ' + w + ' tris');
await p.screenshot({ path: '_work/chaos_wild.png' });
// smart cuts on it
const tris0 = w;
await p.evaluate(() => { BE.S.mirror = false; BE.S.size = .02; BE.setTool('chisel'); });
await drag([[820, 300], [830, 340], [840, 380]]);
await p.evaluate(() => BE.setTool('erode')); await drag([[760, 420], [880, 440], [900, 470]]);
await p.evaluate(() => { BE.S.size = .01; BE.setTool('gouge'); }); await drag([[700, 360], [900, 380]]);
const after = await p.evaluate(() => BE.objs.filter(o => o.userData.sculpt).reduce((s, o) => s + o.userData.sculpt.tris(), 0));
ok(after !== tris0, `cuts changed the shape (${tris0} → ${after} tris)`);
await p.keyboard.press('Control+z'); await p.waitForTimeout(300);
await p.screenshot({ path: '_work/chaos_cut.png' });
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
