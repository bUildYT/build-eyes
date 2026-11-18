// bUild sTudio · SCULPT ENGINE test (flat mode, real mouse + direct brush calls): clay, carve, smooth, flatten, grab, inflate,
// paint + smart fill, undo/redo, save/reload, timings. Renders before/after shots into _work/.
import { chromium } from 'playwright';
import path from 'node:path'; import fs from 'node:fs';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const b = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const errs = [];
if (fs.existsSync('_work/studio/scene.json')) fs.renameSync('_work/studio/scene.json', '_work/studio/scene.json.bak');
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
const open = async () => { await p.goto('https://localhost:8897/studio.html?flat&who=sculpt'); await p.waitForFunction(() => window.BE && BE.flat && BE.flat.on, null, { timeout: 60000 }); await p.waitForTimeout(600); };
await open();
const drag = async (pts, btn = 'left') => { await p.mouse.move(...pts[0]); await p.mouse.down({ button: btn }); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 10 }); await p.mouse.up({ button: btn }); await p.waitForTimeout(300); };
const sc = () => p.evaluate(() => { const o = BE.objs.find(o => o.userData.sculpt); if (!o) return null; const s = o.userData.sculpt; s.flush(); let inside = 0; for (const ch of s.chunks.values()) for (const d of ch.d) if (d > 0) inside++; return { tris: s.tris(), chunks: s.chunks.size, inside, undo: BE.devState().undo }; });

console.log('clay with the mouse (empty space → a new sculpt)');
await p.evaluate(() => { BE.setTool('clay'); BE.S.size = .012; BE.S.color = '#e8d6b8'; BE.S.mat = 'clay'; });
const t0 = Date.now();
await drag([[480, 420], [560, 380], [640, 360], [720, 380], [800, 420]]);
let a = await sc(); ok(a && a.tris > 500, `sculpt mesh ${a && a.tris} tris, ${a && a.inside} voxels inside (${Date.now() - t0} ms stroke)`);
console.log('more clay ON the clay (surface building)');
await drag([[560, 380], [640, 362], [720, 378]]); await drag([[600, 372], [680, 368]]);
const b1 = await sc(); ok(b1.inside > a.inside, `grew ${a.inside} → ${b1.inside}`);
await p.evaluate(() => BE.flat.controls.target.set(...BE.objs.find(o => o.userData.sculpt).getWorldPosition(new BE.root.position.constructor()).toArray()));
await p.keyboard.press('f'); await p.waitForTimeout(300);
await p.screenshot({ path: '_work/sculpt_1_clay.png' });

console.log('direct brushes (same code the controllers + hands use)');
const R = await p.evaluate(() => {
  const o = BE.objs.find(o => o.userData.sculpt), s = o.userData.sculpt, V = BE.root.position.constructor;
  const count = () => { let n = 0; for (const ch of s.chunks.values()) for (const d of ch.d) if (d > 0) n++; return n; };
  const box = new (BE.root.position.constructor === V ? Object : Object)(); void box;
  // centre of the material
  let cx = 0, cy = 0, cz = 0, n = 0; for (const ch of s.chunks.values()) for (let z = 0; z < 24; z++) for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if (ch.d[x + 24 * (y + 24 * z)] > 0) { cx += ch.cx * 24 + x; cy += ch.cy * 24 + y; cz += ch.cz * 24 + z; n++; }
  const c = new V(cx / n * s.vs, cy / n * s.vs, cz / n * s.vs), out = {}, T = f => { const t = performance.now(); f(); s.flush(); return +(performance.now() - t).toFixed(1); };
  out.n0 = count();
  s.begin(); out.tCarve = T(() => s.carve(c, .015)); const e1 = s.end(); out.n1 = count();
  e1.undo(); s.flush(); out.nUndo = count(); e1.redo(); s.flush(); out.nRedo = count();
  s.begin(); out.tSmooth = T(() => { for (let i = 0; i < 4; i++) s.smooth(c.clone().add(new V(.02, 0, 0)), .02, .6); }); s.end();
  s.begin(); out.tInfl = T(() => s.inflate(c.clone().add(new V(-.03, 0, 0)), .02, .3)); s.end(); out.n2 = count();
  s.begin(); const top = c.clone().add(new V(0, .02, 0)); out.tFlat = T(() => { for (let i = 0; i < 5; i++) s.flatten(top, .03, new V(0, 1, 0), top, .4); }); s.end();
  // grab: pull a lump 3 cm up
  const before = count();
  s.begin(); out.tGrab = T(() => { for (let k = 1; k <= 6; k++) s.grab(c.clone().add(new V(.03, .01, 0)), new V(0, .005 * k, 0), .02); }); s.end(); out.nGrab = count() - before;
  // remesh speed of one full chunk
  const ch = [...s.chunks.values()].find(ch => ch.mesh); const t = performance.now(); for (let i = 0; i < 5; i++) s.remesh(ch); out.remeshMs = +((performance.now() - t) / 5).toFixed(2);
  out.chunks = s.chunks.size; out.tris = s.tris();
  return out;
});
console.log('  ', JSON.stringify(R));
ok(R.n1 < R.n0, 'carve removed material'); ok(R.nUndo === R.n0, 'undo restored it exactly'); ok(R.nRedo === R.n1, 'redo carved again');
ok(R.n2 > R.n1, 'inflate grew'); ok(R.remeshMs < 25, `one chunk remesh ${R.remeshMs} ms`);
await p.waitForTimeout(300); await p.screenshot({ path: '_work/sculpt_2_brushes.png' });

console.log('smart material fill (worn gold) + rust paint stroke');
await p.evaluate(() => { BE.S.mat = 'worn'; BE.setTool('fill'); });
await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = BE.objs.find(o => o.userData.sculpt), s = o.userData.sculpt; s.flush();
  const m = [...s.chunks.values()].filter(ch => ch.mesh).sort((a, b) => b.mesh.geometry.index.count - a.mesh.geometry.index.count)[0].mesh, pa = m.geometry.attributes.position;
  const c = m.localToWorld(new BE.root.position.constructor().fromBufferAttribute(pa, 0));
  BE.input.sim.R = { pos: c.toArray(), trig: 1 }; await w(120); BE.input.sim.R = { pos: c.toArray(), trig: 0 }; await w(150); });
await p.waitForTimeout(400);
const rm = await p.evaluate(() => { const s = BE.objs.find(o => o.userData.sculpt).userData.sculpt; s.flush(); let met = 0, n = 0, cav = 0; for (const ch of s.chunks.values()) { if (!ch.mesh) continue; const a = ch.mesh.geometry.attributes.rm, c = ch.mesh.geometry.attributes.color; for (let i = 0; i < a.count; i++) { met += a.getY(i); n++; if (c.getX(i) < .3) cav++; } } return { metal: met / n, n, cav }; });
ok(rm.metal > .6, `worn gold: mean metal ${rm.metal.toFixed(2)} over ${rm.n} verts, ${rm.cav} dark cavity verts`);
await p.screenshot({ path: '_work/sculpt_3_worngold.png' });
await p.evaluate(() => { BE.S.mat = 'rust'; BE.setTool('paint'); BE.S.size = .015; });
await drag([[560, 380], [640, 365], [720, 380]]);
await p.screenshot({ path: '_work/sculpt_4_rust.png' });
console.log('save → reload → same sculpt');
const before = await sc();
await p.evaluate(() => BE.sendNow(false)); await p.waitForTimeout(1500);
await open(); const after = await sc();
ok(after && Math.abs(after.inside - before.inside) <= before.inside * .01, `reload: ${before.inside} → ${after && after.inside} voxels`);
ok(fs.existsSync('public/share/studio_live.glb'), 'live GLB exported');
await p.screenshot({ path: '_work/sculpt_5_reloaded.png' });
console.log('errors:', errs.length ? errs : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
if (fs.existsSync('_work/studio/scene.json.bak')) fs.renameSync('_work/studio/scene.json.bak', '_work/studio/scene.json');
