// bUild sTudio · PAINT FLOW — glues the Painter into the studio: strokes on painted meshes, auto "make paintable",
//  sculpt → Painter (bake) and back, undo for strokes + layer edits, the layers panel (VR + flat), exports.
import * as THREE from 'three';
import { zipSync } from 'fflate';
import { toPmesh, sculptToPmesh, buildPmesh, bakeFromVoxels, geoOut, pxOut, b64, bakedNormalOut } from './paintable.js';
import { TexSet, SKIN_FOR } from './painter.js';
import { createLayers } from './layers.js';
import { MATS } from './materials.js';
import { alphaTexture } from './alphas.js';
const V3 = THREE.Vector3;

export function createPaintFlow(C) {
  const { S, objs, addObj, removeObj, pushUndo, say, touch, newId } = C;
  const tsOf = o => o && o.userData.ts;
  const activeTs = () => tsOf(S.active);
  // ---------------------------------------------------------------- layer edits → undo (params + order; pixels of removed layers stay alive for undo)
  let snapFor = null, snap = null;
  const params = t => ({ sel: t.sel, ls: t.layers.map(l => ({ l, p: { name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, pat: l.pat, scale: l.scale, seed: l.seed, contrast: l.contrast, colA: l.colA, colB: l.colB, rmA: l.rmA, rmB: l.rmB, chan: l.chan, emitOn: l.emitOn, gen: l.gen, level: l.level, soft: l.soft, breakup: l.breakup, bscale: l.bscale, width: l.width, inv: l.inv, maskOn: l.maskOn, mask: l.mask } })) });
  const restoreParams = (t, s) => { t.layers = s.ls.map(x => Object.assign(x.l, x.p)); t.sel = s.sel; t.full(); panel.draw(); touch(); };
  const keepSnap = () => { const t = activeTs(); snapFor = t; snap = t ? params(t) : null; };
  function edit(label, live, end) {
    const t = activeTs(); if (!t) return;
    if (snapFor !== t) keepSnap();
    touch(); panel.draw();
    if (live) return;                                   // slider still moving: one undo step when it is let go
    const before = snap, after = params(t); snap = after;
    if (before) pushUndo({ undo: () => restoreParams(t, before), redo: () => restoreParams(t, after) });
    if (label) say(label, 1);
  }
  // ---------------------------------------------------------------- the panel
  const panel = createLayers(S, {
    ts: activeTs, changed: () => C.menu.draw(), prefs: () => C.savePrefs(),
    edit, convert: () => convertActive(), brushRM: () => { const M = MATS[S.mat] || MATS.clay; return [M.rough, M.metal, 0, M.glow ? 2 : 0]; },
    removeLayer: i => { const t = activeTs(); t.layers.splice(i, 1); t.sel = Math.min(t.sel, t.layers.length - 1); t.full(); edit('layer removed'); },
    exportMaps, downloadGLB: () => C.downloadGLB(), setRes, rebake, canRebake: () => !!(S.active && S.active.userData.srcSculpt),
  });
  C.scene.add(panel.panel);
  function setActive(o) {
    if (o === S.active) return; S.active = o; keepSnap();
    if (tsOf(o) || (o && o.userData.sculpt)) panel.draw();
  }
  // ---------------------------------------------------------------- make paintable
  const converting = new Set();
  async function makePaintable(o, quiet) {
    if (!o || tsOf(o) || converting.has(o)) return null;
    converting.add(o);
    try {
      if (!quiet) say(o.userData.sculpt ? '🎨 baking the sculpt for the Painter …' : '🎨 making it paintable …', 2);
      await new Promise(r => setTimeout(r, 30));      // let the toast show
      let pm;
      if (o.userData.sculpt) {
        const r = await sculptToPmesh(o, { res: S.pres || 1024 }); if (!r) return null;
        pm = r.mesh; r.rec.id = newId(); pm.userData.rec = r.rec; new THREE.Matrix4().fromArray(r.rec.m).decompose(pm.position, pm.quaternion, pm.scale);
        pm.userData.srcSculpt = o;
        // procedural (fill) layers of the last bake survive a re-bake: they don't depend on UVs
        const old = o.userData.lastPm && tsOf(o.userData.lastPm);
        if (old) for (const l of old.layers) if (l.kind === 'fill') { const lo = old.layerOut(l, true); delete lo.mpx; lo.maskOn = 0; pm.userData.ts.layerIn(lo); }
        o.userData.lastPm = pm;
        const skin = !old && SKIN_FOR[o.userData.rec.recipe]; if (skin) { pm.userData.ts.addSmart(skin); pm.userData.ts.sel = 0; }
      } else {
        const rec = await toPmesh(o, { res: S.pres || 1024 }); if (!rec) return null;
        rec.id = newId(); pm = C.buildObject(rec);
      }
      if (o.userData.rec.bl) { pm.userData.rec.bl = o.userData.rec.bl; pm.userData.rec.name = o.userData.rec.name; }
      pm.name = 'pmesh_' + pm.userData.rec.id; pm.castShadow = pm.receiveShadow = true;
      const was = o;
      removeObj(was); addObj(pm); pm.userData.ts.update();
      pushUndo({ undo: () => { removeObj(pm); addObj(was); setActive(was); }, redo: () => { removeObj(was); addObj(pm); setActive(pm); } });
      setActive(pm); S.layersOpen = true; panel.open = true; panel.draw(); C.menu.draw();
      const ts = pm.userData.ts;
      if (!quiet) { const n = pm.geometry.index.count / 3; say(`🎨 paintable · ${ts.layers.length} layer${ts.layers.length === 1 ? '' : 's'} · ${n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n} tris`, 2.5); }
      return pm;
    } catch (e) { console.warn('[paint] make paintable failed', e); say('could not make it paintable: ' + e.message, 3); return null; }
    finally { converting.delete(o); }
  }
  function convertActive() {
    let o = S.active && S.active.userData.sculpt ? S.active : objs.find(x => x.userData.sculpt);
    if (!o) return say('sculpt something first', 1.5);
    makePaintable(o);
  }
  // back to the sculpt (more modelling), the painted version waits
  function backToSculpt() {
    const pm = S.active, sc = pm && pm.userData.srcSculpt; if (!sc) return;
    removeObj(pm); addObj(sc); setActive(sc); pushUndo({ undo: () => { removeObj(sc); addObj(pm); setActive(pm); }, redo: () => { removeObj(pm); addObj(sc); setActive(sc); } });
    say('back to the sculpt · 🎨 again = re-bake (fill layers come along)', 2.5);
  }
  function rebake() {
    const pm = S.active, src = pm && pm.userData.srcSculpt, t = tsOf(pm); if (!src || !t) return;
    const i = t.layers.findIndex(l => l.name === 'sculpt colours'); const before = params(t);
    if (i >= 0) t.layers.splice(i, 1);
    bakeFromVoxels(t, src.userData.sculpt); const after = params(t);
    pushUndo({ undo: () => restoreParams(t, before), redo: () => restoreParams(t, after) }); touch(); panel.draw(); say('↻ re-baked from the sculpt', 1.5);
  }
  // resolution: resample every layer into a new texture set
  function replaceGeometry(pm, geo) {
    const t = tsOf(pm); if (!geo.attributes.normal) geo.computeVertexNormals();
    pm.geometry = geo; pm.userData.rec.geo = geoOut(geo); rebuildTs(pm, t.res);
  }
  function rebuildTs(pm, R) {
    const t = tsOf(pm), n = new TexSet(t.G, pm, { res: R }), G = t.G;
    for (const l of t.layers) {
      const o = t.layerOut(l, false), nl = n.addLayer({ ...o, maskOn: 0 }, n.layers.length); nl.uid = l.uid; nl.group = l.group;
      if (l.rt) { const U = G.copy3Mat.uniforms; U.t0.value = l.rt.textures[0]; U.t1.value = l.rt.textures[1]; U.t2.value = l.rt.textures[2]; G.pass(G.copy3Mat, nl.rt); }
      if (l.mask) { n.ensureMask(nl, 1); G.copyMat.uniforms.t.value = l.mask.texture; G.pass(G.copyMat, nl.mask); }
      nl.maskOn = l.maskOn; nl.ver = l.ver + 1;
    }
    n.bnTex = t.bnTex; n.bnBytes = t.bnBytes; n.bnRes = t.bnRes; t.bnTex = null; n.sel = t.sel; n.full(); n.update();
    pm.userData.ts = n; pm.material = n.material; pm.userData.rec.res = R; t.dispose(); if (S.active === pm) keepSnap(); touch(); panel.draw();
  }
  function setRes(R) {
    const pm = S.active, t = tsOf(pm); if (!t || t.res === R) return;
    const n = new TexSet(t.G, pm, { res: R }), G = t.G;
    for (const l of t.layers) {
      const o = t.layerOut(l, false), nl = n.addLayer({ ...o, maskOn: 0 }, n.layers.length); nl.uid = l.uid; nl.group = l.group;
      if (l.rt) { const U = G.copy3Mat.uniforms; U.t0.value = l.rt.textures[0]; U.t1.value = l.rt.textures[1]; U.t2.value = l.rt.textures[2]; G.pass(G.copy3Mat, nl.rt); }
      if (l.mask) { n.ensureMask(nl, 1); G.copyMat.uniforms.t.value = l.mask.texture; G.pass(G.copyMat, nl.mask); }
      nl.maskOn = l.maskOn;
    }
    n.bnTex = t.bnTex; n.bnBytes = t.bnBytes; n.bnRes = t.bnRes; t.bnTex = null; n.sel = t.sel; n.full(); n.update();
    pm.userData.ts = n; pm.material = n.material; pm.userData.rec.res = R; S.pres = R; t.dispose(); keepSnap(); touch(); panel.draw();
    say(`texture resolution ${R >= 2048 ? '2K' : '1K'}`, 1.5);
  }
  // ---------------------------------------------------------------- a stroke on a painted mesh
  function paintHit(st, o, hitW, dirW) {
    if (!tsOf(o)) {                                    // not paintable yet: shapes, strokes, imports → make it so (sculpts keep voxel paint)
      if (o.userData.sculpt || o.userData.clay) { setActive(o); return false; }
      makePaintable(o); return true;
    }
    const t = tsOf(o); setActive(o);
    let l = t.layers[t.sel];
    // painting (not mask mode) needs a paint layer: on a fill layer, or with none → a fresh paint layer on top (like Painter's "new paint layer")
    if ((!l || (l.kind === 'fill' && S.pmode !== 'mask')) && !(st.pm && st.pm.has(t))) {
      const before = params(t); l = t.addLayer({ kind: 'paint', name: 'paint ' + (t.layers.length + 1) }); const after = params(t);
      pushUndo({ undo: () => restoreParams(t, before), redo: () => restoreParams(t, after) }); keepSnap(); panel.draw();
    }
    if (!l) return true;
    const toMask = S.pmode === 'mask' || l.kind === 'fill';
    if (!st.pm) st.pm = new Map();
    if (!st.pm.has(t)) st.pm.set(t, { before: t.snapLayer(t.sel, toMask), sel: t.sel, mask: toMask, last: null });
    const rec = st.pm.get(t), inv = new THREE.Matrix4().copy(o.matrixWorld).invert(), s = o.getWorldScale(new V3()).x;
    const p = hitW.clone().applyMatrix4(inv), d = dirW.clone().transformDirection(inv), r = S.size * 2.2 / s;
    const dabs = [], useA = st.alpha || S.palpha;
    const tdir = rec.last && rec.last.distanceTo(p) > 1e-7 ? p.clone().sub(rec.last).normalize() : (rec.tdir || new V3(1, 0, 0)); rec.tdir = tdir; rec.s = rec.s || 0;
    if (rec.last) { const L = rec.last.distanceTo(p), n = Math.min(15, Math.floor(L / (r * .3))); for (let k = 1; k <= n; k++) dabs.push({ p: rec.last.clone().lerp(p, k / (n + 1)), r, dir: d, t: tdir, u0: rec.s - L * (1 - k / (n + 1)) }); rec.s += L; }
    dabs.push({ p, r, dir: d, t: tdir, u0: rec.s }); rec.last = p.clone();
    const M = MATS[S.mat] || MATS.clay, col = new THREE.Color(M.base || S.color); if (M.tint && !M.base) col.lerp(new THREE.Color(M.tint), .35);
    const chan = (l.chan || [1, 1, 1, 0]).slice(); if (S.bh || useA) chan[3] = 1;
    t.paint(dabs, { target: toMask ? 'mask' : 'layer', color: '#' + col.getHexString(), rough: M.rough, metal: M.metal, height: S.bh || 0, emit: S.pemit ? 2.5 : 0,
      chan, hard: useA ? .75 : S.hard ?? .5, flow: (useA ? .9 : S.flow ?? .6) * (st.press ?? 1), erase: S.pmode === 'erase',
      ...(useA ? { stamp: alphaTexture(S.alpha || 'snake keeled'), stampMode: 1, tile: S.size * 2.2 * 1.6 * (S.aScale || 1) / s, height: S.aDig ? -1 : 1 } : {}) });
    touch(); return true;
  }
  function strokeEnd(st) {
    if (!st.pm) return;
    for (const [t, r] of st.pm) {
      if (!r.before) continue;
      const after = t.snapLayer(r.sel, r.mask), before = r.before;
      pushUndo({ undo: () => t.restore(before), redo: () => t.restore(after), dispose: () => { before.cp.dispose(); after && after.cp.dispose(); } });
    }
    st.pm = null;
  }
  // ---------------------------------------------------------------- every frame: recomposite what changed, the panel in VR
  function tick(R, dt, menuPanel, head) {
    for (const o of objs) { const t = tsOf(o); if (t && t.dirty) t.update(); }
    panel.open = !!S.layersOpen;
    panel.place(menuPanel, head);
    return panel.use(R, dt);
  }
  // ---------------------------------------------------------------- save / export
  function recFull(o) {    // a pmesh with its pixels (saves, duplicates, late joiners)
    const t = tsOf(o), r = { ...o.userData.rec }; o.updateMatrix(); r.m = o.matrix.toArray();
    r.layers = t.layers.map(l => pxOut(t.layerOut(l, true)));
    const bn = bakedNormalOut(t); if (bn) { r.bn = b64(bn); r.bnRes = t.bnRes || t.res; }
    r.res = t.res; return r;
  }
  function exportMesh(o) { const t = tsOf(o), m = new THREE.Mesh(o.geometry, t.exportMaterial()); o.updateMatrix(); m.applyMatrix4(o.matrix); m.name = o.name; return m; }
  async function exportMaps() {
    const pm = S.active, t = tsOf(pm); if (!t) return;
    say('⬇ exporting PBR maps …', 1.5);
    const m = t.maps(), files = {}, name = (pm.userData.rec.name || 'bUild_sTudio') + '_' + pm.userData.rec.id.slice(-5);
    for (const [k, cv] of Object.entries(m)) { const blob = await new Promise(r => cv.toBlob(r, 'image/png')); files[`${name}_${k}.png`] = new Uint8Array(await blob.arrayBuffer()); }
    const zip = zipSync(files, { level: 0 }), a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = name + '_maps.zip'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    if (C.onMaps) C.onMaps(pm, files);
    say('⬇ maps: base colour · ORM (AO/rough/metal) · normal (OpenGL) · emissive', 3);
  }
  return { replaceGeometry, rebuildTs, panel, paintHit, strokeEnd, tick, setActive, makePaintable, convertActive, backToSculpt, recFull, exportMesh, exportMaps, keepSnap, activeTs };
}
