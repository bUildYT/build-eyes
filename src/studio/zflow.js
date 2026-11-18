// bUild sTudio · Z FLOW — the Z SCULPT tool in the studio: strokes (Freehand + lazy mouse · DragRect · Spray), symmetry,
//  undo, new sphere, subdivide, voxel clay → Z mesh, masks. Works the same with mouse, pen (pressure), touch and VR controllers.
import * as THREE from 'three';
import { ZMesh, ZBRUSHES, zAlpha, zAlphaTiles, geometryFromMeshes, parseLook, smartLook } from './zsculpt.js';
const V3 = THREE.Vector3, M4 = THREE.Matrix4;

export function createZFlow(C) {
  const { S, objs, root, addObj, removeObj, pushUndo, say, touch, newId, buildObject, setActive } = C;
  const zObjs = () => objs.filter(o => o.userData.z && o.visible);
  // the Z mesh under / nearest to a world point
  function near(w, pad) {
    let best = null, bd = Infinity;
    for (const o of zObjs()) { const ws = o.getWorldScale(new V3()).x, l = o.worldToLocal(w.clone()), h = o.userData.z.nearest(l, pad / ws); if (h && h.d * ws < bd) { bd = h.d * ws; best = o; } }
    return best;
  }
  const brushNow = () => S.zCtrl ? 'mask' : S.zShift ? 'smooth' : (S.zb || 'standard');
  const radius = o => S.size * 2 / o.getWorldScale(new V3()).x;
  // local → local mirror across the object's own x = 0 (ZBrush local symmetry)
  const MIR = new M4().makeScale(-1, 1, 1);
  const mirP = p => p.clone().applyMatrix4(MIR);
  function opts(st, press) {
    const br = st.brush, inv = !!S.zSub !== !!S.zAlt, a = ZBRUSHES[br].alpha ? zAlpha(S.zAlpha) : null;
    let k = (S.zInt ?? .45) * press * (inv ? -1 : 1); if (br === 'smooth') k = Math.abs(k) * 1.6 + .15;
    return { brush: br, k, alpha: a, tiles: zAlphaTiles(S.zAlpha), tile: S.zTile || 1, focal: S.zFoc || 0 };
  }
  function both(st, c, r, o) {   // one dab + its symmetric twin
    st.z.dab(c, r, S.mirror ? { ...o, sym: true } : o);
  }

  function twinGrab(z, g, c, r) { const own = new Set(g.ids), t = z.grab(c, r, S.zFoc || 0), keep = []; for (let q = 0; q < t.ids.length; q++) if (!own.has(t.ids[q])) keep.push(q); return { ids: Int32Array.from(keep, q => t.ids[q]), w: Float32Array.from(keep, q => t.w[q]), o: Float32Array.from(keep.flatMap(q => [t.o[q * 3], t.o[q * 3 + 1], t.o[q * 3 + 2]])) }; }
  function down(P, flat) {
    const w = P.pos.clone(), o = near(w, flat ? S.size * 1.2 + .004 : S.size * 1.5 + .01); if (!o) return null;
    const z = o.userData.z, l = o.worldToLocal(w.clone()), r = radius(o), brush = brushNow();
    if (z.busy) { say('DynaMesh is voxeling … one moment', .8); return null; }
    const ver0 = z.ver;
    const st = { ver0, tool: 'z', o, z, brush, stroke: brush === 'move' || brush === 'snake' ? 'move' : (S.zStroke || 'free'), last: null, lazy: null, t: 0 };
    z.begin(); setActive && setActive(o);
    if (st.stroke === 'move') { st.p0 = l.clone(); st.g = z.grab(l, r * 1.3, S.zFoc || 0); if (S.mirror) st.gm = twinGrab(z, st.g, mirP(l), r * 1.3); }
    if (brush === 'snake') { const h = z.nearest(l, r); st.path = h ? [h.p.clone().addScaledVector(h.n, -r * .6), h.p.clone().addScaledVector(h.n, r * .3)] : [l.clone()]; st.r = r; }
    else if (st.stroke === 'rect') { const ar = z.area(l, r); if (!ar) { z.end(); return null; } st.c0 = l.clone(); st.pl = { n: ar.n, p: l.clone() }; st.prev = null; }
    if (brush === 'planar' && st.stroke !== 'rect') { const ar = z.area(l, r); if (ar) st.pl = { n: ar.n, p: ar.p }; }
    if (brush === 'paint' && !parseLook(z.look)) look('smart');
    return st;
  }
  function hold(st, P) {
    const o = st.o, z = st.z, l = o.worldToLocal(P.pos.clone()), r = radius(o), press = Math.max(.05, P.kind === 'ctrl' ? P.trig : (P.trig ?? 1));
    if (st.stroke === 'move') {
      const d = l.clone().sub(st.p0); z.drag(st.g, d); if (st.gm) z.drag(st.gm, mirP(d));
      if (st.path) { const dl = l.distanceTo(st.path[st.path.length - 1]); if (dl > r * .25 && dl < r * 40) st.path.push(l.clone()); }   // (a jump = a glitch, not a root)
      if (st.brush === 'snake' && d.length() > r * .3) { st.p0 = l.clone(); st.g = z.grab(l, r * 1.1, S.zFoc || 0); if (st.gm) st.gm = twinGrab(z, st.g, mirP(l), r * 1.1); }
      return;
    }
    if (st.stroke === 'rect') {   // DragRect: the alpha grows from where you pressed, turns with your drag — re-stamped live
      const n0 = st.pl.n, v = l.clone().sub(st.c0); v.addScaledVector(n0, -v.dot(n0)); const rr = Math.max(z.edge * 3, v.length());
      if (st.prev) { z.restore(st.prev); const a = [...st.prev]; z.refreshNormals(a, a.length); }
      const set = new Set(), grab = c => { const m = z.query(c.x, c.y, c.z, rr * 1.42); for (let q = 0; q < m; q++) set.add(z.ids[q]); };
      grab(st.c0); if (S.mirror) grab(mirP(st.c0));
      both(st, st.c0, rr, { ...opts(st, press), k: opts(st, press).k * 2.2, dir: v.lengthSq() > 1e-12 ? v : null, plane: st.pl });
      st.prev = set; return;
    }
    // Freehand / Spray with lazy mouse: dabs every few % of the radius along the (lazy) path
    if (!st.lazy) st.lazy = l.clone();
    const lz = (S.zLazy ?? .25) * r * 2.5, dl = st.lazy.distanceTo(l);
    if (dl > lz) st.lazy.lerp(l, (dl - lz) / dl);
    const tgt = st.lazy, sp = Math.max(r * (st.stroke === 'spray' ? .35 : .1), z.edge * .5), o2 = opts(st, press); if (st.brush === 'planar' && st.pl) o2.plane = st.pl;
    const dabAt = (c, dir) => {
      if (st.stroke === 'spray') {
        const ar = z.area(c, r); if (!ar) return; const j = new V3(Math.random() - .5, Math.random() - .5, Math.random() - .5); j.addScaledVector(ar.n, -j.dot(ar.n)).multiplyScalar(r * 1.1);
        both(st, c.clone().add(j), r * (.45 + Math.random() * .6), { ...o2, k: o2.k * (.9 + Math.random() * .9), dir, rot: Math.random() * Math.PI * 2 });
      } else both(st, c, r, { ...o2, dir });
    };
    if (!st.last) { st.last = tgt.clone(); dabAt(tgt, null); return; }
    // frame budget: on a dense mesh with a big brush, dabs get wider apart instead of the frame stalling (the stroke stays smooth)
    let d = st.last.distanceTo(tgt), n = 0, step = sp; const t0 = performance.now(), budget = C.isQuest ? 14 : 26;
    while (d >= step && n++ < 64) { const c = st.last.clone().lerp(tgt, step / d), dir = c.clone().sub(st.last); dabAt(c, dir); st.last = c; d = st.last.distanceTo(tgt); if (performance.now() - t0 > budget) step = Math.max(step, d * .5, r * .35); }
  }
  function up(st) {
    const e = st.z.end(); if (e) pushUndo(e); touch();
    // Smear / SnakeHook pulled the triangles long → re-voxel right away (3D-Coat style), so the next pull has fresh, even topology
    if (st.brush !== 'snake' || !st.g || S.zAutoDyna === false) return;
    // the drag path becomes a tapered tube (thick at the root, thin at the tip), voxel-unioned into the mesh → real tentacles, roots, horns
    const r0 = st.r * (.32 + .3 * Math.min(1, S.zInt ?? .5)), moved = new Set(e ? e.ids : []), z = st.z;
    const pa = (st.path || []).filter((q, i) => {   // points inside / skimming the body (as it was before the pull) are dropped → the root leaves the surface cleanly
      if (i < 2) return true; const m = z.query(q.x, q.y, q.z, st.r * 4); let b = -1, bd = Infinity; for (let k = 0; k < m; k++) if (!moved.has(z.ids[k]) && z.wts[k] < bd) { bd = z.wts[k]; b = z.ids[k]; }
      if (b < 0) return true; const P = z.pos, N = z.nrm; return (q.x - P[b * 3]) * N[b * 3] + (q.y - P[b * 3 + 1]) * N[b * 3 + 1] + (q.z - P[b * 3 + 2]) * N[b * 3 + 2] > r0 * .9;
    });   // points inside / skimming the body are dropped → the root leaves the surface cleanly
    let L = 0; for (let i = 1; i < pa.length; i++) L += pa[i].distanceTo(pa[i - 1]);
    if (pa.length > 2 && L > st.r * .8) {
      const caps = [], r1 = Math.max(st.z.edge * 1.2, (st.z.rec.zvs || 0) * 1.7, st.r * .07); let acc = 0;
      for (let i = 1; i < pa.length; i++) { const l = pa[i].distanceTo(pa[i - 1]), ra = r0 + (r1 - r0) * Math.pow(acc / L, .8); acc += l; const rb = r0 + (r1 - r0) * Math.pow(acc / L, .8); caps.push({ a: pa[i - 1], b: pa[i], ra, rb }); if (S.mirror) caps.push({ a: mirP(pa[i - 1]), b: mirP(pa[i]), ra, rb }); }
      dynamesh(st.o, true, caps, false, { ids: [], orig: [], ...(e || {}), ver0: st.ver0 });   // the live SnakeHook spike was only the preview: voxelise the mesh as it was + the clean tube
    } else if (st.z.stretch(st.g.ids) > 2.6) dynamesh(st.o, true, null, false, e);
  }
  // once a frame: upload what changed
  function tick() { for (const o of objs) if (o.userData.z) o.userData.z.flush(); }

  // ---------------------------------------------------------------- actions
  // whole-mesh undo (subdivide · DynaMesh): only the last 4 keep their copies (a 900k mesh is ~20 MB a copy)
  const geoU = [];
  function geoUndo(z, before, after) {
    const e = { b: before, a: after, undo() { if (e.b) z.setGeometry(e.b.clone()); else say('that step is too old to undo', 1.5); }, redo() { if (e.a) z.setGeometry(e.a.clone()); } };
    geoU.push(e); while (geoU.length > 4) { const o = geoU.shift(); o.b = o.a = null; } pushUndo(e);
  }
  function snapshotGeo(z) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(z.pos.slice(), 3)); g.setIndex(new THREE.BufferAttribute(z.idx.slice(), 1));
    if (z.col) g.setAttribute('color', new THREE.BufferAttribute(z.col.slice(), 3)); g.setAttribute('zmask', new THREE.BufferAttribute(z.mask.slice(), 1)); g.setAttribute('zpaint', new THREE.BufferAttribute(z.paint.slice(), 1)); return g;
  }
  function newSphere(at, flat) {
    const rs = root.getWorldScale(new V3()).x, lvl = S.zLvl ?? (C.isQuest ? 6 : 7);
    let p; if (at) p = root.worldToLocal(at.clone()); else if (flat) p = new V3(0, .12 / rs, 0); else { const h = C.headPos(), f = C.headFwd(); p = root.worldToLocal(h.clone().addScaledVector(f, .38)); }
    const rec = { id: newId(), type: 'zmesh', lvl, r: .08 / rs * (S.zNewR || 1), look: (S.zLook || 'smart') === 'smart' ? smartNow() : S.zLook, m: new M4().makeTranslation(p.x, p.y, p.z).toArray() };
    const o = buildObject(rec); addObj(o); setActive && setActive(o); pushUndo({ undo() { removeObj(o); }, redo() { addObj(o); } });
    say(`Z sphere · ${(o.userData.z.F / 1000).toFixed(0)}k polys — sculpt!`, 1.6); return o;
  }
  function active() { const a = S.active; return a && a.userData.z && objs.includes(a) ? a : zObjs()[0] || null; }
  function subdivide() {
    const o = active(); if (!o) return say('no Z mesh yet: tap "new sphere" or convert voxel clay', 2);
    const z = o.userData.z, cap = C.isQuest ? 700e3 : 2.2e6; if (z.F * 4 > cap) return say(`max ${(cap / 1e6).toFixed(1)}M polys on this device`, 2);
    if (window.BE && BE.syncBusy) BE.syncBusy(z.F > 150e3 ? 10000 : 3000);   // the others wait instead of dropping us
    const t0 = performance.now(), before = snapshotGeo(z); z.subdivide(); z.rec.zvs = 0; const after = snapshotGeo(z);
    geoUndo(z, before, after);
    say(`subdivided · ${(z.F / 1000).toFixed(0)}k polys (${Math.round(performance.now() - t0)} ms)`, 1.8); touch();
  }
  // DynaMesh: re-voxel the whole Z mesh (even triangles again after Smear pulls); auto = after a stretched Smear stroke
  // the voxel work runs in a Web Worker → no frame drops (VR stays smooth); strokes on that mesh wait until it is back
  let worker = null, jobN = 0; const jobs = new Map();
  function runJob(job) {
    const reset = why => { console.warn('[dynamesh] worker reset:', why); try { worker && worker.terminate(); } catch { } worker = null; for (const j of jobs.values()) j(null); jobs.clear(); };   // a crashed / stuck worker must never lock the sculpt
    if (!worker) try { worker = new Worker(new URL('./zremesh.worker.js', import.meta.url), { type: 'module' }); worker.onmessage = e => { const j = jobs.get(e.data.id); jobs.delete(e.data.id); if (e.data.err) console.warn('[dynamesh]', e.data.err); j && j(e.data.r); }; worker.onerror = e => reset(e.message || 'error'); } catch { worker = false; }
    if (!worker) return import('./zremesh.js').then(m => m.remeshCore(job));
    const id = ++jobN; return new Promise(res => { jobs.set(id, res); setTimeout(() => { if (jobs.has(id)) reset('timeout'); }, 25000); const tr = [job.pos.buffer, job.idx.buffer, job.nrm.buffer, job.paint.buffer, job.mask.buffer]; if (job.col) tr.push(job.col.buffer); worker.postMessage({ id, job }, tr); });
  }
  async function dynamesh(o0, auto, caps, finer, stroke) {
    const o = o0 || active(); if (!o) return say('no Z mesh yet: tap "new sphere"', 2);
    const z = o.userData.z; if (z.busy) return; const target = Math.min(Math.max(z.F, C.isQuest ? 80e3 : 200e3), C.isQuest ? 250e3 : 700e3);
    const t0 = performance.now(), ver0 = z.ver; z.busy = true; if (!auto) say('DynaMesh …', 4);
    let r, key = null; try { const job = z.remeshJob(target, caps || [], (z.rec.zvs || 0) * (finer ? .7 : 1), C.isQuest ? 250e3 : 700e3);
      job.reuse = z._fieldKey && (stroke ? stroke.ver0 : z.ver) === z._fieldVer ? z._fieldKey : null; job.newKey = Math.random().toString(36).slice(2);   // nothing sculpted since the last voxeling → the worker just adds the tube to its field
      if (stroke && stroke.ids) for (let q = 0; q < stroke.ids.length; q++) { const i = stroke.ids[q] * 3; job.pos[i] = stroke.orig[q * 3]; job.pos[i + 1] = stroke.orig[q * 3 + 1]; job.pos[i + 2] = stroke.orig[q * 3 + 2]; }
      if (window.__keepJob) window.__lastJob = { pos: job.pos.slice(), idx: job.idx.slice(), caps: job.caps, vsLock: job.vsLock, target: job.target, maxF: job.maxF };
      key = job.newKey; r = await runJob(job); } finally { z.busy = false; }
    const g = ZMesh.geoFromRemesh(r); if (!g) return say('DynaMesh: nothing closed to re-voxel', 1.5);
    if (window.BE && BE.syncBusy) BE.syncBusy(3000);
    const before = snapshotGeo(z); z.rec.zvs = g.userData.vs; z.setGeometry(g); z._fieldKey = key; z._fieldVer = z.ver;
    const after = snapshotGeo(z);
    geoUndo(z, before, after);
    say(`${auto ? 'Smear → ' : ''}DynaMesh · ${(z.F / 1000).toFixed(0)}k polys · voxel ${(z.rec.zvs * 1000).toFixed(1)} mm (${Math.round(performance.now() - t0)} ms)`, 1.4); touch(); return o;
  }
  // voxel clay (block-out, like DynaMesh) → a Z mesh for detail; its symmetry plane = the studio mirror plane
  function fromVoxel() {
    const src = S.active && S.active.userData.sculpt && objs.includes(S.active) ? S.active : objs.find(o => o.userData.sculpt);
    if (!src) return say('no voxel clay to convert', 1.5);
    const sc = src.userData.sculpt; sc.flush && sc.flush(); src.updateMatrix();
    const rp = src.position.clone(), M = new M4().compose(new V3(0, rp.y, rp.z), new THREE.Quaternion(), src.scale.clone()), toNew = new M4().copy(M).invert().multiply(src.matrix);
    const meshes = []; for (const ch of sc.chunks.values()) if (ch.mesh) { ch.mesh.updateMatrix(); meshes.push(ch.mesh); }
    if (!meshes.length) return say('that clay is empty', 1.5);
    const geo = geometryFromMeshes(meshes, me => new M4().copy(toNew).multiply(me.matrix));
    const rec = { id: newId(), type: 'zmesh', look: (S.zLook || 'smart') === 'smart' ? smartNow() : S.zLook, m: M.toArray(), _geo: geo };
    const o = buildObject(rec); removeObj(src); addObj(o); setActive && setActive(o);
    pushUndo({ undo() { removeObj(o); addObj(src); }, redo() { removeObj(src); addObj(o); } });
    say(`voxel clay → Z mesh · ${(o.userData.z.F / 1000).toFixed(0)}k polys · subdivide for detail`, 2.2); touch(); return o;
  }
  function mask(op) { const o = active(); if (!o) return; const z = o.userData.z, e = op === 'blur' ? z.maskBlur() : z.maskAll(op === 'clear' ? 0 : 'invert'); if (e) pushUndo(e); touch(); }
  const smartNow = () => smartLook(S.zSmA || 'white', S.zSmB || 'gold', S.zDirt ?? .6, S.zWear ?? .6);
  function look(k) { const o = active(); S.zLook = k; const L = k === 'smart' ? smartNow() : k; if (o) { o.userData.z.setLook(L); touch(); } }
  function smart() { const o = active(); S.zLook = 'smart'; if (o) { o.userData.z.setLook(smartNow()); touch(); } }
  return { near, down, hold, up, tick, newSphere, subdivide, dynamesh, fromVoxel, mask, look, smart, active };
}
