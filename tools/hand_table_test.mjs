// hAnd bUilder · the clay finds the real table: fake Quest planes (same layout as a real room scan) → placement + landing
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
p.on('pageerror', e => console.log('  [ERROR]', e.message));
await p.goto('https://localhost:8897/hand.html?who=handT&flat&nohint', { waitUntil: 'load' }); await p.waitForFunction(() => window.BE && BE.api, null, { timeout: 40000 });
const r = await p.evaluate(() => {
  const A = BE.api, rect = (x0, x1, z0, z1) => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  // plane poses are translations; polygons are relative to them
  const plane = (label, x, y, z, P) => ({ orientation: 'horizontal', semanticLabel: label, polygon: P, planeSpace: { x, y, z } });
  const frame = L => ({ detectedPlanes: new Set(L), getPose: s => ({ transform: { position: { x: s.x, y: s.y, z: s.z }, matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, s.x, s.y, s.z, 1]) } }) });
  const out = {}, pos = () => BE.root.position.toArray().map(v => +v.toFixed(3));
  A.head.set(0, 1.25, 0); A.fwd.set(0, 0, -1);
  const room = [plane('floor', 0, 0, 0, rect(-3, 3, -3, 3)), plane('ceiling', 0, 2.35, 0, rect(-3, 3, -3, 3)), plane('shelf', 0, 1.05, -.4, rect(-.5, .5, -.2, .2)), plane('bed', 0, .49, -.45, rect(-.4, .4, -.3, .3)), plane('table', 0, .7, -.85, rect(-.4, .4, -.25, .25)), plane('table', 3, .5, 0, rect(-.3, .3, -.3, .3))];
  A.findTable(frame(room)); out.placed = pos(); out.table = BE.devState().table;
  BE.root.position.set(.1, .75, -.8); out.landed = A.land(); out.afterLand = pos();
  BE.root.position.set(.1, .95, -.8); out.high = A.land(); out.afterHigh = pos();
  return out;
});
console.log(JSON.stringify(r));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
ok(r.table === null, 'the clay never snaps to a table');
ok(!r.landed && r.afterLand[1] === .75, 'letting go near a table leaves it where it is');
ok(!r.high && r.afterHigh[1] === .95, 'let go high in the air: stays where you put it');
const l = await p.evaluate(async () => {
  const c = BE.clay, wait = async () => { for (let i = 0; i < 600; i++) { await new Promise(r => setTimeout(r, 30)); if (!c.dirty.size && !c.flying && c._lodV === c.meshVer) return; } }, solid = () => { let n = 0; for (const h of c.chunks.values()) for (let i = 0; i < h.d.length; i++) if (h.d[i] > 0) n++; return n; };
  await wait(); const t1 = c.tris(), s1 = solid(); c.triBudget = t1 * .6; c.relod(); await wait(); const t2 = c.tris(), lod = c.lod, s2 = solid(); c.triBudget = 1e9; c.relod(); await wait(); await wait(); return { t1, t2, lod, same: s1 === s2, back: c.lod, t3: c.tris() };
});
console.log(JSON.stringify(l));
ok(l.lod === 2 && l.t2 < l.t1 * .4 && l.t2 > 200, `heavy piece is drawn lighter: ${l.t1} → ${l.t2} tris`); ok(l.same, 'the sculpted data is untouched'); ok(l.back === 1 && l.t3 === l.t1, 'full detail returns when there is room');
const dc = await p.evaluate(async () => {
  const c = BE.clay, A = BE.api, V = BE.root.position.constructor, sl = ms => new Promise(r => setTimeout(r, ms)), vis = () => c.group.children.filter(m => m.isMesh && m.visible), idx = () => vis().reduce((n, m) => n + m.geometry.index.count / 3, 0), rest = async () => { for (let i = 0; i < 300; i++) { await sl(30); if (!c.dirty.size && !c.flying && !c.rough.size && [...c.clusters.values()].every(x => x.ok)) return; } };
  A.strokeBegin('d', 'clay', new V(-.12, .08, .04), false); for (let i = 1; i <= 40; i++) { A.strokeMove('d', new V(-.12 + i * .006, .08 + Math.sin(i * .3) * .05, .04), .016); await sl(4); } A.strokeEnd('d'); await rest();
  const a = { meshes: [...c.chunks.values()].filter(h => h.mesh).length, draws: vis().length, drawn: idx(), tris: c.tris() };
  A.strokeBegin('d', 'clay', new V(.05, .12, .05), false); A.strokeMove('d', new V(.06, .12, .05), .016); A.strokeEnd('d'); for (let i = 0; i < 40 && !c.meshVer; i++) await sl(10); await sl(120); const during = idx(), tD = c.tris(); await rest();
  return { ...a, during, tD, after: idx(), tA: c.tris(), drawsAfter: vis().length };
});
console.log(JSON.stringify(dc));
ok(dc.draws < dc.meshes && dc.drawn === dc.tris, `blocks at rest merge: ${dc.meshes} blocks → ${dc.draws} draws, all ${dc.tris} tris shown`); ok(dc.during === dc.tD, 'while editing nothing is missing or doubled'); ok(dc.after === dc.tA && dc.drawsAfter <= dc.draws + 2, 'merged again afterwards');
const gs = await p.evaluate(async () => {
  const c = BE.clay, A = BE.api, V = BE.root.position.constructor, sl = ms => new Promise(r => setTimeout(r, ms)), on = (x, y, z) => c.get(Math.round(x / c.vs), Math.round(y / c.vs), Math.round(z / c.vs)) > 0, o = {}; A.S.size = .016; A.S.mirror = false; A.S.radial = 0;
  const go = async (id, tool, a, b, inv) => { A.strokeBegin(id, tool, a, inv); for (let i = 1; i <= 12; i++) { A.strokeMove(id, a.clone().lerp(b, i / 12), .016); await sl(5); } A.strokeEnd(id); await sl(40); };
  const P0 = new V(.22, .12, 0), P1 = new V(.22, .12, .16), P2 = new V(.22, .24, .16); await go('a', 'clay', P0.clone().add(new V(-.02, 0, 0)), P0.clone().add(new V(.02, 0, 0)), false);
  o.made = on(.22, .12, 0); await go('s', 'select', P0, P1, false); o.left = !on(.22, .12, 0); o.arrived = on(.22, .12, .16); A.undo(); await sl(40); o.undone = on(.22, .12, 0) && !on(.22, .12, .16); A.redo(); await sl(40); o.redone = on(.22, .12, .16) && !on(.22, .12, 0);
  await go('s', 'select', P1, P2, true); o.copyKeeps = on(.22, .12, .16); o.copyLands = on(.22, .24, .16); return o;
});
console.log(JSON.stringify(gs));
ok(gs.made && gs.left && gs.arrived, 'grab a stroke and move it'); ok(gs.undone && gs.redone, 'undo and redo bring it back and forth'); ok(gs.copyKeeps && gs.copyLands, 'left pinch makes a copy and leaves the original');
const sh = await p.evaluate(async () => {
  const c = BE.clay, A = BE.api, V = BE.root.position.constructor, sl = ms => new Promise(r => setTimeout(r, ms)), on = v => c.get(Math.round(v.x / c.vs), Math.round(v.y / c.vs), Math.round(v.z / c.vs)) > 0, o = {};
  const go = async (id, tool, a, b, inv) => { A.strokeBegin(id, tool, a, inv); for (let i = 1; i <= 8; i++) { A.strokeMove(id, a.clone().lerp(b, i / 8), .016); await sl(5); } A.strokeEnd(id); await sl(30); };
  const C0 = new V(-.3, .1, .2), d = new V(.03, 0, 0), k = new V(.025, .025, .025); A.setShape('box'); await go('b', 'shape', C0, C0.clone().add(d), false); o.boxCorner = on(C0.clone().add(k)); A.undo(); await sl(30); o.boxUndo = !on(C0); A.redo(); await sl(30); A.setShape('cone'); const C1 = C0.clone().add(new V(0, 0, .12)); await go('c', 'shape', C1, C1.clone().add(d), false); o.coneBase = on(C1.clone().add(new V(.018, -.025, 0))); o.coneTipEmpty = !on(C1.clone().add(new V(.018, .025, 0))); A.setShape(null);
  await go('r', 'area', C0, C0.clone().add(new V(.001, 0, 0)), false); o.selected = A.hasSel() && A.S.tool === 'select'; const step = new V(0, 0, -.1), C2 = C0.clone().add(step), C3 = C2.clone().add(step), C4 = C3.clone().add(step); await go('s', 'select', C0, C2, true); o.keeps = on(C0); o.copy = on(C2); A.act.repeat(); await sl(30); A.act.repeat(); await sl(30); o.array = on(C3) && on(C4); A.undo(); await sl(30); o.undoOne = on(C3) && !on(C4); A.act.repeat(); await sl(30); o.again = on(C4); A.S.tool = 'clay'; return o;
});
console.log(JSON.stringify(sh)); ok(sh.boxCorner && sh.boxUndo, 'hand-placed box has real corners and undoes'); ok(sh.coneBase && sh.coneTipEmpty, 'cone is wide below, narrow above'); ok(sh.selected && sh.keeps && sh.copy, 'select an area and copy it'); ok(sh.array && sh.undoOne && sh.again, 'REPEAT builds an array, undo steps back one');
const cc = await p.evaluate(() => { const c = BE.clay, V = BE.root.position.constructor, col = new (BE.root.position.constructor === V ? Object : Object)(), A = new V(.4, .1, -.3), B = new V(.5, .1, -.3), C0 = { r: 1, g: 1, b: 1 }; c.segment(A, A, .02, .02, false, '#ffffff', 'pearl'); c.segment(B, B, .02, .02, false, '#ffffff', 'pearl'); const r = c.connected(A, .01), hit = P => c.recNear(r, P, .006); return { a: hit(A), b: hit(B) }; });
console.log(JSON.stringify(cc)); ok(cc.a && !cc.b, 'a fist takes one separate lump, not its neighbour');
const fl = await p.evaluate(async () => { const c = BE.clay, A = BE.api, V = BE.root.position.constructor, P = new V(-.2, -.15, .3); A.S.tool = 'clay'; A.strokeBegin('u', 'clay', P, false); A.strokeMove('u', P.clone().add(new V(.03, 0, 0)), .016); A.strokeEnd('u'); for (let i = 0; i < 300 && (c.dirty.size || c.flying); i++) await new Promise(r => setTimeout(r, 20)); const b = c.chunks.get([...c.chunks.keys()].find(k => { const h = c.chunks.get(k); return h.mesh && h.cy < 0; })); return { solid: c.get(Math.round(P.x / c.vs), Math.round(P.y / c.vs), Math.round(P.z / c.vs)) > 0, meshBelow: !!b }; });
console.log(JSON.stringify(fl)); ok(fl.solid && fl.meshBelow, 'clay can be added below the old ground level');
const zo = await p.evaluate(async () => {
  const c = BE.clay, A = BE.api, V = BE.root.position.constructor, n0 = c.chunks.size; BE.root.scale.setScalar(.1); let worst = 0; A.strokeBegin('z', 'clay', new V(-.5, .1, 0), false); for (let i = 1; i <= 10; i++) { const t = performance.now(); A.strokeMove('z', new V(-.5 + i * .1, .1 + i * .02, 0), .016); worst = Math.max(worst, performance.now() - t); await new Promise(r => setTimeout(r, 16)); } const during = c.chunks.size - n0; A.strokeEnd('z'); BE.root.scale.setScalar(1); return { during, worst: +worst.toFixed(1) };
});
console.log(JSON.stringify(zo)); ok(zo.during < 700 && zo.worst < 120, `fast stroke while zoomed out stays small: +${zo.during} blocks, worst step ${zo.worst} ms`);
const f = await p.evaluate(() => {
  const V = BE.root.position.constructor, F = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'], X = { 'index-finger': .03, 'middle-finger': .01, 'ring-finger': -.01, 'pinky-finger': -.03 };
  // right hand, fingers along -z, palm down. c = how far each fingertip reaches, 1 = straight
  const pose = (cur, pinch) => { const J = { wrist: [0, 1, 0], 'thumb-metacarpal': [.03, 1, -.03], 'thumb-phalanx-proximal': [.05, 1, -.05], 'thumb-phalanx-distal': [.055, 1, -.08], 'thumb-tip': [.05, 1, -.1] };
    for (const f of F) { const x = X[f], k = -.09, c = f === 'index-finger' && pinch ? 1 : cur, end = k * (1 + .9 * c); J[f + '-phalanx-proximal'] = [x, 1, k]; J[f + '-phalanx-intermediate'] = [x, 1 - .01, k + (end - k) * .4]; J[f + '-phalanx-distal'] = [x, 1 - .015, k + (end - k) * .7]; J[f + '-tip'] = f === 'index-finger' && pinch ? [.05, 1, -.104] : [x, 1 - .02, end]; }
    return J; };
  const read = J => { const src = { handedness: 'right', hand: { get: n => n } }; BE.input.read({ session: { inputSources: [src] }, getJointPose: n => ({ transform: { position: { x: J[n][0], y: J[n][1], z: J[n][2] } } }) }, null, .016); const R = BE.input.R; return { fist: R.fist, on: R.on, curl: R.curl.map(v => +v.toFixed(2)) }; };
  return { open: read(pose(1)), fist: read(pose(-.3)), reopen: read(pose(1)), relaxedPinch: read(pose(.7, true)) };
});
console.log(JSON.stringify(f));
ok(!f.open.fist && f.fist.fist && !f.fist.on, 'a closed hand is a fist and never fires a pinch'); ok(!f.reopen.fist, 'opening the hand lets go'); ok(f.relaxedPinch.on && !f.relaxedPinch.fist, 'a normal pinch stays a pinch');
await browser.close(); console.log(process.exitCode ? 'FAILED' : 'ALL GREEN');
