// bUild sTudio · BLENDER BRIDGE (dev server): Blender and the headset share objects, live.
//  Blender → VR: objects in Blender's "bUild VR" collection arrive as .glb (materials and all), moves arrive at 10 Hz
//  VR → Blender: moves · painted textures (Principled material on the ORIGINAL mesh, modifiers stay) · sculpts + VR-made objects as meshes
//  · your head = Blender's "VR Eye" camera.   Only the room's hub talks to Blender (no double imports).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { uvsUsable } from './unwrap.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
const M4 = THREE.Matrix4;
// Blender (Z up) ↔ studio (Y up): (x, y, z)_blender → (x, z, −y)
const C = new M4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1), CT = C.clone().transpose();
export const fromBlender = rows => C.clone().multiply(new M4().set(...rows)).multiply(CT);          // rows: Blender matrix_world, row-major
export const toBlender = m => { const b = CT.clone().multiply(m).multiply(C); return Array.from(b.clone().transpose().elements, v => +v.toFixed(6)); };

export function createBlenderLink(X) {
  const { S, objs, addObj, removeObj, buildObject, say, pf } = X;
  const B = { on: false, seen: null, since: 0, sentM: new Map(), gotM: new Map(), geoSig: new Map(), texVer: new Map(), last: 0 };
  const byBl = id => objs.find(o => o.userData.rec.bl === id);
  const post = (kind, ev) => fetch('/__q/bl/push?to=bl', { method: 'POST', body: JSON.stringify({ kind, ...ev }) }).catch(() => { });
  const upload = async (file, bytes) => { const r = await fetch('/__q/bl/push?file=' + encodeURIComponent(file), { method: 'POST', body: bytes }); return (await r.json()).file; };
  const gltf = new GLTFLoader();
  // ---------------------------------------------------------------- Blender → here
  async function onEvent(e) {
    if (e.kind === 'hello') { say('🔗 Blender linked · objects in its "bUild VR" collection appear here', 3); return; }
    if (e.kind === 'xf') { const o = byBl(e.id); if (!o || X.isGrabbed(o)) return; const m = fromBlender(e.m); m.decompose(o.position, o.quaternion, o.scale); B.gotM.set(e.id, key(o)); B.sentM.set(e.id, key(o)); return; }
    if (e.kind === 'del') { const o = byBl(e.id); if (o) removeObj(o); return; }
    if (e.kind === 'obj') {
      const url = './share/bl/' + e.file + '?t=' + e.t, old = byBl(e.id), m = fromBlender(e.m);
      if (old && old.userData.ts) {   // painted here already: keep every layer if the new mesh still has clean UVs
        const g = await loadGeo(url);
        if (g && uvsUsable(g)) { pf.replaceGeometry(old, g); m.decompose(old.position, old.quaternion, old.scale); say('Blender: ' + e.name + ' updated · paint kept', 2); B.sentM.set(e.id, key(old)); return; }
        say('Blender: ' + e.name + ' has new UVs → repaint needed', 3);
      }
      const rec = { id: X.newId(), type: 'import', src: e.name + '.glb', url, bl: e.id, name: e.name, local: true }, o = buildObject(rec);
      m.decompose(o.position, o.quaternion, o.scale); o.updateMatrix(); rec.m = o.matrix.toArray();
      if (old) removeObj(old); addObj(o); B.sentM.set(e.id, key(o)); B.geoSig.set(rec.id, 'from-blender');
      if (!old) say('from Blender: ' + e.name, 2);
    }
  }
  function loadGeo(url) {
    return new Promise(res => gltf.load(url, g => {
      const parts = []; g.scene.updateMatrixWorld(true);
      g.scene.traverse(c => { if (c.isMesh) { const x = c.geometry.clone(); for (const k of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(k)) x.deleteAttribute(k); parts.push(x.index ? x : mergeVertices(x)); } });
      res(parts.length ? (parts.length === 1 ? parts[0] : mergeGeometries(parts)) : null);
    }, undefined, () => res(null)));
  }
  const key = o => { o.updateMatrix(); return Array.from(o.matrix.elements, v => v.toFixed(5)).join(','); };
  // ---------------------------------------------------------------- the loops (only on the room's hub)
  async function pull() {
    // start from NOW (no replay of old events) and ask Blender for its current objects
    while (B.since === 0) { try { B.since = (await (await fetch('/__q/bl/status')).json()).n || 1; post('resync', {}); } catch { await new Promise(r => setTimeout(r, 3000)); } }
    while (true) {
      if (!X.isHub()) { await new Promise(r => setTimeout(r, 2000)); continue; }
      try {
        const r = await (await fetch('/__q/bl/pull?to=web&since=' + B.since)).json();
        for (const e of r.events) { B.since = Math.max(B.since, e.n); try { await onEvent(e); } catch (err) { console.warn('[blender] event', e.kind, err); } }
        if (!r.events.length) B.since = Math.max(B.since, r.n);
      } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
  }
  async function status() { try { const s = await (await fetch('/__q/bl/status')).json(); const on = s.blender != null && s.blender < 20; if (on !== B.on) { B.on = on; S.blender = on; X.changed(); } } catch { } }
  let pushing = false;
  async function push() {
    if (!B.on || !X.isHub() || pushing) return; pushing = true;
    try {
      const now = performance.now();
      for (const o of objs) {
        const r = o.userData.rec, id = r.bl || r.id;
        // moves (any linked object) → Blender
        if (r.bl || B.geoSig.has(r.id)) { const k = key(o); if (B.sentM.get(id) !== k && !X.busy()) { B.sentM.set(id, k); post('xf', { id, m: toBlender(o.matrix) }); } }
        // painted Blender meshes (their own UVs) → textures onto the original mesh
        const ts = o.userData.ts;
        if (ts && r.bl && r.keptUVs) {
          const tv = B.texVer.get(r.id);
          if (tv === undefined) B.texVer.set(r.id, { v: ts.ver, t: now, sent: -1 });
          else if (ts.ver !== tv.v) { tv.v = ts.ver; tv.t = now; }
          else if (tv.sent !== ts.ver && now - tv.t > 1200 && !X.busy()) { tv.sent = ts.ver; await sendTex(o); }
          continue;
        }
        // everything made / changed in VR → a mesh in Blender (2 s after you stop)
        if (r.type === 'import' && r.bl && !ts) continue;           // plain Blender object: nothing to send back
        const sg = X.geoSig(o), g = B.geoSig.get(r.id);
        if (g === undefined) { B.geoSig.set(r.id, { s: sg, t: now, sent: null }); continue; }
        if (g === 'from-blender') { B.geoSig.set(r.id, { s: sg, t: now, sent: sg }); continue; }
        if (g.s !== sg) { g.s = sg; g.t = now; }
        else if (g.sent !== sg && now - g.t > 2000 && !X.busy()) { g.sent = sg; await sendObj(o); }
      }
      // gone in VR → gone in Blender (only what VR made)
      for (const [rid, g] of B.geoSig) if (g && g.sent && !objs.some(o => o.userData.rec.id === rid)) { B.geoSig.delete(rid); post('del', { id: rid }); }
    } catch (e) { console.warn('[blender] push', e); }
    pushing = false;
  }
  async function sendObj(o) {
    const r = o.userData.rec, glb = await X.exportLocalGLB(o), name = (r.name || r.type) + '_' + (r.bl || r.id).slice(-6);
    const file = await upload('vr_' + (r.bl || r.id) + '.glb', glb); o.updateMatrix();
    post('obj', { id: r.bl || r.id, name, file, m: toBlender(o.matrix), replace: !!r.bl });
    console.log('[blender] sent', name, (glb.byteLength / 1e6).toFixed(2) + ' MB');
  }
  async function sendTex(o) {
    const r = o.userData.rec, m = o.userData.ts.maps(), files = {};
    for (const [k, cv] of Object.entries(m)) { const blob = await new Promise(res => cv.toBlob(res, 'image/png')); files[k] = await upload(`tex_${r.bl}_${k}.png`, await blob.arrayBuffer()); }
    post('tex', { id: r.bl, files, name: r.name || r.bl });
    console.log('[blender] textures →', r.name || r.bl);
  }
  function cam() { if (!B.on || !X.isHub()) return; const H = X.headRootMatrix(); if (H) post('cam', { id: 'eye', m: toBlender(H) }); }
  setInterval(status, 2500); status();
  setInterval(push, 150); setInterval(cam, 250);
  pull();
  B.sendNow = async o => { if (o) { await sendObj(o); say('⇪ sent to Blender', 1.5); } };
  return B;
}
