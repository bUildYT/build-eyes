// bUild sTudio · LIVE SYNC: every device with the same link (studio.html?room=CODE) sees + edits ONE scene.
//  PC Chrome, phone, tablet, Quest (VR or your room) — peer-to-peer WebRTC, the free PeerJS broker only introduces them.
//  The first device in the room = the hub (relays + hands the whole scene to late joiners); if it leaves, the next one takes over.
//  What travels: object recipes (strokes, shapes, clay, photos, moves, deletes) · changed sculpt chunks (deflated bytes) ·
//  painted textures · everyone's head + brushes (ghosts). Undo / redo just changes things → those changes travel too.
import * as THREE from 'three';
import Peer from 'peerjs';
import { strokeGeometry } from './objects.js';
import { makeMaterial, ensurePaint } from './materials.js';
import { unzlibSync } from 'fflate';
import { bakedNormalOut } from './paintable.js';
import { ZMesh } from './zsculpt.js';
const PREFIX = 'build-studio-v1-';
const V3 = THREE.Vector3, Q = THREE.Quaternion, M4 = THREE.Matrix4;
export const newRoom = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');

// ---------------------------------------------------------------- bytes: deflate (a sculpt chunk is 83 KB raw, mostly empty or full → ~2-8 KB)
async function pipe(u8, stream) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer()); }
const pack = u8 => pipe(u8, new CompressionStream('deflate-raw'));
const unpack = buf => pipe(new Uint8Array(buf), new DecompressionStream('deflate-raw'));
const ab = u8 => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

export function createSync({ room, root, objs, S, buildObject, addObj, removeObj, clearUndo, say, headMatrix, pointers, kind, busy = () => false, guest = false }) {
  const Y = { room, peers: 0, role: 'connecting', pid: null, sent: 0, got: 0 };
  // ---------------------------------------------------------------- network: claim the hub id, else join it
  let peer = null, hubConn = null, dead = false, retry = null;
  const links = new Set();              // hub: every client · client: just the hub
  const send = (m, except) => { for (const c of links) if (c !== except && c.open) try { c.send(m); Y.sent++; } catch (e) { console.warn('[sync] send', e); } };
  const count = () => { Y.peers = links.size; status(); };
  function status() { S.room = `🔗 ${room} · ${Y.role === 'hub' ? 'hub' : Y.role === 'client' ? 'linked' : Y.role} · ${Y.role === 'hub' ? links.size + 1 : Y.role === 'client' ? Y.others + 1 : 1} device${(Y.role === 'hub' ? links.size : Y.others || 0) ? 's' : ''}`; Y.onStatus && Y.onStatus(); }
  Y.others = 0;
  function again(ms = 800 + Math.random() * 1700) { if (dead || retry) return; retry = setTimeout(() => { retry = null; start(); }, ms); }
  function start() {
    if (guest) { links.clear(); hubConn = null; Y.role = 'connecting'; status(); join(); return; }   // a viewer never claims the room: it waits for the one who sculpts
    try { peer && peer.destroy(); } catch { }
    links.clear(); hubConn = null; Y.role = 'connecting'; status();
    const p = peer = new Peer(PREFIX + room, { debug: 0 });
    p.on('open', id => { if (p !== peer) return; Y.pid = id; Y.role = 'hub'; status(); console.log('[sync] hub of room', room); });
    p.on('connection', c => {
      c.on('open', () => { c._seen = performance.now(); links.add(c); count(); sendSnapshot(c); });
      c.on('data', d => onMsg(d, c));
      const gone = c._lost = () => { if (links.delete(c)) { count(); dropGhost(c.peer); send({ t: 'bye', pid: c.peer }); send({ t: 'n', others: links.size }); } };
      c.on('close', gone); c.on('error', gone);
    });
    p.on('error', e => {
      if (p !== peer) return;
      if (e.type === 'unavailable-id') { join(); return; }              // someone is the hub already → join them
      console.warn('[sync]', e.type, e.message); Y.role = 'offline'; status(); again(3000);
    });
    p.on('disconnected', () => { if (p === peer && !dead && Y.role === 'hub') try { p.reconnect(); } catch { } });
  }
  function join() {
    try { peer && peer.destroy(); } catch { }
    const p = peer = new Peer(undefined, { debug: 0 });
    p.on('open', id => {
      if (p !== peer) return; Y.pid = id;
      const c = hubConn = p.connect(PREFIX + room, { reliable: true, serialization: 'binary' });
      c.on('open', () => { c._seen = performance.now(); links.add(c); Y.role = 'client'; status(); console.log('[sync] joined room', room); });
      c.on('data', d => onMsg(d, c));
      const lost = () => { if (p !== peer) return; links.delete(c); Y.role = 'connecting'; Y.others = 0; status(); for (const k of [...ghosts.keys()]) dropGhost(k); again(); };   // hub gone → someone takes over
      c.on('close', lost); c.on('error', lost); c._lost = lost;
    });
    p.on('error', e => { if (p !== peer) return; console.warn('[sync] join', e.type); Y.role = 'connecting'; status(); again(); });
  }

  // ---------------------------------------------------------------- what changed since last time
  const known = new Map();              // id → signature we already shared (or received)
  const paintSent = new Map();          // id → { v, t }
  const byId = id => objs.find(o => o.userData.rec.id === id);
  const mtx = o => { o.updateMatrix(); return Array.from(o.matrix.elements, v => +v.toFixed(5)); };
  function sig(o) {
    const r = o.userData.rec; let s = r.type + '|' + mtx(o).join(',') + '|' + (r.color || '') + '|' + (r.mat || '') + '|' + (r.prim || '') + '|' + (r.tone || '') + '|' + (r.skin ? JSON.stringify(r.skin) : '') + '|' + (r.gid || '') + (r.look || '');
    if (r.s) s += '|s' + r.s.length;
    if (r.balls) { const b = r.balls[r.balls.length - 1]; s += '|b' + r.balls.length + ':' + (b ? b[3] : '') + '|d' + (r.dabs ? r.dabs.length : 0); }
    const ts = o.userData.ts; if (ts) s += '|L' + ts.res + JSON.stringify(ts.layers.map(l => ts.layerOut(l, false)));
    return s;
  }
  const paintVer = o => { const P = o.userData.paint; return o.userData.painted && P ? P.tc.version + ':' + P.to.version : null; };
  function recOut(o, full, to = null) {
    const r = { ...o.userData.rec, m: mtx(o) }; delete r.data; delete r.paint;
    const z = o.userData.z; if (z && (full || z.sentGid !== r.gid)) { const blob = z.packBlob(), n = Math.ceil(blob.length / ZPART); r.zgN = n; for (let k = 0; k < n; k++) zq.push({ to, m: { t: 'zgp', id: r.id, g: r.gid, k, n, b: ab(blob.subarray(k * ZPART, (k + 1) * ZPART)) } }); if (!to) z.sentGid = r.gid; }
    const ts = o.userData.ts;
    if (ts) { r.layers = ts.layers.map(l => ts.layerOut(l, false)); r.res = ts.res; if (!full) delete r.geo; else { const bn = bakedNormalOut(ts); if (bn) { r.bn = ab(bn); r.bnRes = ts.bnRes || ts.res; } } }
    return r;
  }
  const pxSent = new Map();   // id|uid → { v, t }
  function layerPx(o, l) { const ts = o.userData.ts, x = ts.layerOut(l, true), m = { t: 'lp', id: o.userData.rec.id, uid: l.uid }; if (x.px) m.px = x.px.map(ab); if (x.mpx) m.mpx = ab(x.mpx); return m; }
  async function chunksOut(sc, keys) {
    const cs = [];
    for (const k of keys) { const c = sc.packChunk(k); if (c) cs.push([c[0], c[1], c[2], ab(await pack(c[3]))]); }
    return cs;
  }
  async function paintOut(o) { const P = o.userData.paint; return { t: 'pt', id: o.userData.rec.id, col: P.col.toDataURL('image/webp', .9), orm: P.orm.toDataURL('image/png') }; }

  // paced queue for big things (Z mesh geometry): only while the channel buffer is low
  const ZPART = 64 * 1024, zq = [];
  setInterval(() => {
    let budget = 6;
    while (zq.length && budget-- > 0) {
      const it = zq[0], cs = it.to ? [it.to] : [...links]; if (it.to && !it.to._snapOK) break;   // a newcomer's parts wait for its snapshot
      if (cs.some(c => c.open && c.dataChannel && c.dataChannel.bufferedAmount > 256 * 1024)) break;
      zq.shift(); for (const c of cs) if (c.open) try { c.send(it.m); Y.sent++; } catch (e) { console.warn('[sync] part', e); }
    }
  }, 25);
  // receiver: parts → one geometry; strokes that arrive meanwhile wait for it
  const zPend = new Map();   // id → { g, n, parts, zv: [] }
  function zPart(m) {
    const P = zPend.get(m.id); if (!P || P.g !== m.g) return;
    P.parts[m.k] = new Uint8Array(m.b); if (P.parts.filter(Boolean).length < P.n) return;
    zPend.delete(m.id); const o = byId(m.id); if (!o || !o.userData.z) return;
    const tot = P.parts.reduce((a, x) => a + x.length, 0), u8 = new Uint8Array(tot); let at = 0; for (const x of P.parts) { u8.set(x, at); at += x.length; }
    const z = o.userData.z; o.userData.rec.gid = m.g; z.setGeometry(ZMesh.geoFromBlob(u8), true); z.sentGid = m.g; o.visible = true;
    for (const e of P.zv) z.applyEdits(e);
    known.set(m.id, sig(o));
  }
  function zEdits(m) {
    const P = zPend.get(m.id); if (P && P.g === m.g) { P.zv.push(m); return; }
    const o = byId(m.id); if (o && o.userData.z && o.userData.rec.gid === m.g) o.userData.z.applyEdits(m);
  }
  let ticking = false, lastSculptSend = 0;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const live = links.size > 0, now = performance.now(), ids = new Set(), sculptOK = now - lastSculptSend > 150; let sentSculpt = false;
      for (const o of objs) {
        const r = o.userData.rec; ids.add(r.id);
        const s = sig(o);
        if (known.get(r.id) !== s) { const first = !known.has(r.id); known.set(r.id, s); if (live) send({ t: 'o', rec: recOut(o, first) }); }
        const ts = o.userData.ts;
        if (ts) for (const l of ts.layers) {
          const k = r.id + '|' + l.uid, ps = pxSent.get(k);
          if (ps && ps.v === l.ver) continue;
          if (!l.rt && !l.mask) { pxSent.set(k, { v: l.ver, t: now }); continue; }
          if (!live) { pxSent.set(k, { v: l.ver, t: now }); continue; }
          if (busy() && ps && now - ps.t < 1500) continue;               // mid-stroke: at most every 1.5 s, the rest when you let go
          pxSent.set(k, { v: l.ver, t: now }); send(layerPx(o, l));
        }
        const zm = o.userData.z;
        if (zm && zm.sync.size && (!live || now - (zm.sentT || 0) > 180)) { zm.sentT = now; const e = zm.takeEdits(); if (live && e) send({ t: 'zv', id: r.id, g: e.g, i: ab(e.i), p: ab(e.p), m: ab(e.m), w: ab(e.w) }); }
        const sc = o.userData.sculpt;
        if (sc && sc.changed.size && (!live || sculptOK)) {      // ≤ ~7 Hz while you sculpt: the ghost brush shows the motion in between
          const keys = [...sc.changed]; sc.changed.clear();
          if (live) { const cs = await chunksOut(sc, keys); if (cs.length) { send({ t: 'ch', id: r.id, cs }); sentSculpt = true; } }
        }
        const pv = paintVer(o);
        if (pv) { const ps = paintSent.get(r.id); if (!ps || ps.v !== pv) { if (!live) paintSent.set(r.id, { v: pv, t: now }); else if (!ps || now - ps.t > 700) { paintSent.set(r.id, { v: pv, t: now }); send(await paintOut(o)); } } }
      }
      if (sentSculpt) lastSculptSend = now;
      for (const id of [...known.keys()]) if (!ids.has(id)) { known.delete(id); paintSent.delete(id); if (live) send({ t: 'del', id }); }
    } catch (e) { console.warn('[sync] tick', e); }
    ticking = false;
  }

  // ---------------------------------------------------------------- the whole scene for someone who just came in
  async function sendSnapshot(c) {
    const out = [];
    for (const o of objs) {
      const e = { rec: recOut(o, true, c) }, sc = o.userData.sculpt;
      if (o.userData.ts) e.lps = o.userData.ts.layers.filter(l => l.rt || l.mask).map(l => layerPx(o, l));
      if (sc) e.cs = await chunksOut(sc, [...sc.chunks.keys()]);
      if (paintVer(o)) e.paint = await paintOut(o);
      out.push(e);
    }
    try { c.send({ t: 'snap', objs: out, others: links.size }); Y.sent++; } catch (e) { console.warn('[sync] snapshot', e); }
    c._snapOK = true;
    send({ t: 'n', others: links.size });
  }

  // ---------------------------------------------------------------- applying what others did (never echoes back)
  async function applyRec(rec) {
    let o = byId(rec.id);
    if (rec.zgN) zPend.set(rec.id, { g: rec.gid, n: rec.zgN, parts: [], zv: [] });
    if (!o && rec.zgN) { o = buildObject({ ...rec, lvl: 1, zgN: undefined }); o.visible = false; o.userData.rec.gid = 'pending'; addObj(o); }
    else if (!o) { o = buildObject({ ...rec }); addObj(o); if (o.userData.ts) for (const l of o.userData.ts.layers) pxSent.set(rec.id + '|' + l.uid, { v: l.ver, t: performance.now() }); }
    else {
      const r = o.userData.rec; new M4().fromArray(rec.m).decompose(o.position, o.quaternion, o.scale); r.m = rec.m;
      const look = rec.color !== r.color || rec.mat !== r.mat;
      if (r.type === 'stroke') {
        if (rec.s.length !== r.s.length || look) { r.s = rec.s; o.geometry.dispose(); o.geometry = strokeGeometry(r.s, r.shape); }
        if (look) { r.color = rec.color; r.mat = rec.mat; if (!o.userData.painted) o.material = makeMaterial(r.mat, r.color); }
      } else if (r.type === 'shape') { if (look) { r.color = rec.color; r.mat = rec.mat; if (!o.userData.painted) o.material = makeMaterial(r.mat, r.color); } }
      else if (r.type === 'clay') { r.balls = rec.balls; r.dabs = rec.dabs || []; if (rec.mat !== r.mat) { r.mat = rec.mat; o.material = makeMaterial(r.mat, '#ffffff', { vertexColors: true }); } o.userData.clay.dirty = true; }
      else if (r.type === 'sculpt') { o.userData.sculpt.setMat(rec.mat); o.userData.sculpt.setTone(rec.tone || 'reptile'); o.userData.sculpt.setSkin(rec.skin || null); }
      else if (r.type === 'pmesh' && o.userData.ts) reconcile(o, rec.layers || []);
      else if (r.type === 'zmesh') { const z = o.userData.z; if (rec.look && rec.look !== z.look) z.setLook(rec.look); }
    }
    known.set(rec.id, sig(o));
    return o;
  }
  const PARAMS = ['alpha', 'kind', 'name', 'visible', 'opacity', 'blend', 'pat', 'scale', 'seed', 'contrast', 'colA', 'colB', 'rmA', 'rmB', 'chan', 'emitOn', 'gen', 'level', 'soft', 'breakup', 'bscale', 'width', 'inv', 'group'];
  function reconcile(o, incoming) {
    const ts = o.userData.ts, keepSel = ts.layers[ts.sel] && ts.layers[ts.sel].uid, byUid = new Map(ts.layers.map(l => [l.uid, l])), next = [];
    for (const x of incoming) {
      let l = byUid.get(x.uid);
      if (!l) { l = ts.layerIn({ ...x }, ts.layers.length); ts.layers.splice(ts.layers.indexOf(l), 1); pxSent.set(o.userData.rec.id + '|' + l.uid, { v: l.ver, t: performance.now() }); }
      for (const k of PARAMS) if (x[k] !== undefined) l[k] = x[k];
      if (x.maskOn && !l.mask) ts.ensureMask(l, 1); l.maskOn = x.maskOn;
      next.push(l);
    }
    ts.layers = next; const si = next.findIndex(l => l.uid === keepSel); ts.sel = si >= 0 ? si : Math.max(0, Math.min(ts.sel, next.length - 1)); ts.full();
  }
  function applyLayerPx(m) {
    const o = byId(m.id), ts = o && o.userData.ts; if (!ts) return;
    const l = ts.layers.find(x => x.uid === m.uid); if (!l) return;
    if (m.px && l.rt) m.px.forEach((z, k) => ts.write(l.rt, k, unzlibSync(new Uint8Array(z))));
    if (m.mpx) { if (!l.mask) ts.ensureMask(l, 1); ts.write(l.mask, 0, unzlibSync(new Uint8Array(m.mpx))); }
    pxSent.set(m.id + '|' + m.uid, { v: l.ver, t: performance.now() }); ts.full();
  }
  async function applyChunks(id, cs) {
    const o = byId(id), sc = o && o.userData.sculpt; if (!sc) return;
    for (const [cx, cy, cz, buf] of cs) sc.applyChunk(cx, cy, cz, await unpack(buf));
  }
  function applyPaint(m) {
    const o = byId(m.id); if (!o || !o.isMesh) return;
    const P = ensurePaint(o); o.userData.painted = true; let n = 0;
    for (const [k, g] of [['col', P.gc], ['orm', P.go]]) { const im = new Image(); im.onload = () => { g.clearRect(0, 0, 9999, 9999); g.drawImage(im, 0, 0); P.tc.needsUpdate = P.to.needsUpdate = true; if (++n === 2) paintSent.set(m.id, { v: paintVer(o), t: performance.now() }); }; im.src = m[k]; }
  }
  function removeById(id) { const o = byId(id); known.delete(id); paintSent.delete(id); if (o) removeObj(o); }

  let queue = Promise.resolve();           // messages apply strictly in arrival order (chunks unpack async)
  function onMsg(m, from) {
    if (!m || !m.t) return; Y.got++; if (from) from._seen = performance.now();
    if (Y.role === 'hub' && m.t !== 'snap' && m.t !== 'hb') send(m, from);   // the hub relays everything to everyone else
    if (m.t === 'hb') { if (m.busy && from) from._seen = performance.now() + Math.min(15000, m.busy); return; }   // 'busy': they are about to build something big
    if (m.t === 'x') { Y.onX && Y.onX(m, from); return; }             // app messages (live hands, EYEs): relayed by the hub, never queued
    if (m.t === 'me') { ghost(m); return; }
    if (m.t === 'bye') { dropGhost(m.pid); return; }
    if (m.t === 'n') { Y.others = m.others; status(); return; }
    queue = queue.then(() => handle(m)).catch(e => console.warn('[sync] apply', m.t, e));
  }
  async function handle(m) {
    if (m.t === 'o') await applyRec(m.rec);
    else if (m.t === 'ch') await applyChunks(m.id, m.cs);
    else if (m.t === 'zv') zEdits(m);
    else if (m.t === 'zgp') zPart(m);
    else if (m.t === 'del') removeById(m.id);
    else if (m.t === 'pt') applyPaint(m);
    else if (m.t === 'lp') applyLayerPx(m);
    else if (m.t === 'snap') {
      // the room's scene replaces what this device had (the hub is the truth)
      for (const o of [...objs]) removeObj(o); known.clear(); paintSent.clear(); clearUndo();
      for (const e of m.objs) { await applyRec(e.rec); if (e.cs) await applyChunks(e.rec.id, e.cs); if (e.paint) applyPaint(e.paint); if (e.lps) for (const lp of e.lps) applyLayerPx(lp); }
      for (const o of objs) if (o.userData.sculpt) { o.userData.sculpt.changed.clear(); o.userData.sculpt.flush(); }
      Y.others = m.others; status(); Y.snapAt = Date.now();
      say(`🔗 room ${room}: ${m.objs.length} object${m.objs.length === 1 ? '' : 's'} · live with ${m.others} other device${m.others === 1 ? '' : 's'}`, 3);
    }
  }

  // ---------------------------------------------------------------- ghosts: where the others look + brush (in studio space)
  const ghosts = new Map(), gRoot = new THREE.Group(); gRoot.name = 'ghosts'; root.add(gRoot);
  const KIND_COL = { quest: 0xffc23a, phone: 0x66ccff, tablet: 0x9b7bff, pc: 0x7dffa0 };
  function makeGhost(m) {
    const g = new THREE.Group(), col = KIND_COL[m.k] || 0xffffff;
    const head = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.045, 20, 14), new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: .25, metalness: .6 }));
    const visor = new THREE.Mesh(new THREE.BoxGeometry(.07, .022, .012), new THREE.MeshBasicMaterial({ color: col })); visor.position.set(0, .006, -.042);
    const lab = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const x = cv.getContext('2d'); x.fillStyle = '#000a'; x.beginPath(); x.roundRect(0, 6, 256, 52, 26); x.fill(); x.fillStyle = '#' + col.toString(16).padStart(6, '0'); x.font = '600 30px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText({ quest: '🥽 Quest', phone: '📱 phone', tablet: '📱 tablet', pc: '🖥 PC' }[m.k] || m.k, 128, 33);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true })); s.scale.set(.12, .03, 1); s.position.y = .085; s.renderOrder = 30; return s; })();
    head.add(ball, visor, lab);
    const curs = [0, 1].map(() => { const c = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .45, depthWrite: false })); c.visible = false; g.add(c); return c; });
    g.add(head); gRoot.add(g);
    return { g, head, curs, t: 0 };
  }
  function ghost(m) {
    let G = ghosts.get(m.pid); if (!G) { G = makeGhost(m); ghosts.set(m.pid, G); }
    G.t = performance.now();
    if (m.h) { G.head.visible = true; G.want = m.h; } else G.head.visible = false;
    m.c.forEach((c, i) => { const C = G.curs[i]; C.visible = !!c; if (c) { C.position.set(c[0], c[1], c[2]); C.scale.setScalar(Math.max(.002, c[3])); C.material.color.set(c[4] || 0xffffff); } });
  }
  function dropGhost(pid) { const G = ghosts.get(pid); if (!G) return; gRoot.remove(G.g); ghosts.delete(pid); }
  const inv = new M4(), hm = new M4(), hp = new V3(), hq = new Q(), hs = new V3();
  function sendMe() {
    if (!links.size) return;
    root.updateMatrixWorld(); inv.copy(root.matrixWorld).invert();
    const H = headMatrix(); let h = null;
    if (H) { hm.multiplyMatrices(inv, H).decompose(hp, hq, hs); h = [...hp.toArray(), ...hq.toArray()].map(v => +v.toFixed(4)); }
    const rs = root.scale.x, c = pointers().map(P => P ? (hp.copy(P.pos).applyMatrix4(inv), [+hp.x.toFixed(4), +hp.y.toFixed(4), +hp.z.toFixed(4), +(P.r / rs).toFixed(4), P.col]) : null);
    send({ t: 'me', pid: Y.pid, k: kind, h, c });
  }
  Y.step = dt => {   // every frame: ghosts glide, keep a readable size, vanish when silent
    const now = performance.now(), k = Math.min(1, dt * 14), s = 1 / root.scale.x;
    for (const [pid, G] of ghosts) {
      if (now - G.t > 4000) { dropGhost(pid); continue; }
      if (G.want) { const w = G.want; G.head.position.lerp(hp.set(w[0], w[1], w[2]), k); G.head.quaternion.slerp(hq.set(w[3], w[4], w[5], w[6]), k); G.head.scale.setScalar(s); }
    }
  };

  // heartbeat: everyone talks ≥ 1×/s ('me' or 'hb'); 4.5 s of silence = gone (a closed tab / dead Wi-Fi can take WebRTC 30 s to notice)
  let hbT = performance.now();
  BE.syncBusy = ms => { if (links.size) send({ t: 'hb', busy: ms }); };
  setInterval(() => { if (links.size) send({ t: 'hb' }); const now = performance.now(); if (now - hbT > 2500) for (const c of links) c._seen = now;   // WE were busy (building a big mesh): not their silence
    const hbT0 = hbT; hbT = now; for (const c of [...links]) if (now - (c._seen || now) > 4500) { console.warn('[sync] silent → dropped', c.peer, 'quiet', Math.round(now - c._seen), 'ms · my gap', Math.round(now - hbT0)); try { c.close(); } catch { } c._lost && c._lost(); } }, 1000);
  setInterval(tick, 100);
  setInterval(sendMe, 66);
  Y.baseline = () => { for (const o of objs) { known.set(o.userData.rec.id, sig(o)); if (o.userData.ts) for (const l of o.userData.ts.layers) pxSent.set(o.userData.rec.id + '|' + l.uid, { v: l.ver, t: 0 }); if (o.userData.sculpt) o.userData.sculpt.changed.clear(); const pv = paintVer(o); if (pv) paintSent.set(o.userData.rec.id, { v: pv, t: 0 }); } };
  Y.close = () => { dead = true; clearTimeout(retry); try { peer.destroy(); } catch { } };
  Y.ghosts = ghosts; Y.links = links; Y.sendX = m => { if (links.size) send({ ...m, t: 'x', pid: Y.pid }); };
  Y.baseline(); start();
  return Y;
}
