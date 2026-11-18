// bUild eYes · CLAY: sculpt on your real table with bare hands (or controllers).
//  BUILD mode: RIGHT pinch + move = lay clay (hold still = it swells) · LEFT pinch + move = carve it away
//  turn your LEFT palm up = the palm menu: colours, play/build, undo, clear → poke a button with your right index tip
//  everything lives in table coords, so phones (EYEs) see the same clay from their side.
import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
const V3 = THREE.Vector3;
export const COLORS = ['#e8d6b8', '#ffc23a', '#ff5a3c', '#3fd17a', '#3a8bff', '#b45cff', '#f2f2f2', '#2a2a2e'];

export function createClay({ root, say = () => {}, sfx }) {
  const L = .44, RES = 52;                       // a 44 cm cube of clay space standing on the table
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .05 });
  const mc = new MarchingCubes(RES, mat, false, true, 90000);
  mc.isolation = 80; mc.scale.setScalar(L / 2); mc.position.set(0, L / 2 - .004, 0);
  mc.castShadow = mc.receiveShadow = true; mc.frustumCulled = false; root.add(mc);
  const C = { mc, strokes: [], mode: 'play', color: COLORS[1], dirty: true, onChange: null };
  try { const s = JSON.parse(localStorage.getItem('be:clay') || 'null'); if (s && s.strokes) C.strokes = s.strokes; } catch {}

  // local table point → marching-cubes 0..1 space
  const toN = p => [(p.x + L / 2) / L, (p.y - (-.004)) / L, (p.z + L / 2) / L];
  const inside = p => Math.abs(p.x) < L / 2 * .94 && p.y > -.002 && p.y < L * .94 && Math.abs(p.z) < L / 2 * .94;
  function rebuild() {
    mc.reset();
    for (const s of C.strokes) {
      const col = new THREE.Color(s.c);
      for (const b of s.b) { const rn = b[3] / L, str = 92 * rn * rn; mc.addBall((b[0] + L / 2) / L, (b[1] + .004) / L, (b[2] + L / 2) / L, s.sub ? -str * 1.25 : str, 12, col); }
    }
    mc.update(); C.dirty = false;
  }
  C.save = () => { localStorage.setItem('be:clay', JSON.stringify({ strokes: C.strokes })); if (C.onChange) C.onChange(C.strokes); };
  C.set = strokes => { C.strokes = strokes; C.dirty = true; };
  C.undo = () => { if (C.strokes.pop()) { C.dirty = true; C.save(); say('undo', 1.2); } };
  C.clear = () => { C.strokes = []; C.dirty = true; C.save(); say('clay cleared', 1.5); };
  C.count = () => C.strokes.reduce((n, s) => n + s.b.length, 0);
  // ---------------------------------------------------------------- queries for the game: is there clay here? how high is it? what did you build?
  C.solid = p => {
    if (C.dirty) rebuild();
    if (!C.strokes.length) return false;
    const n = mc.size, x = Math.round((p.x + L / 2) / L * n), y = Math.round((p.y + .004) / L * n), z = Math.round((p.z + L / 2) / L * n);
    if (x < 1 || y < 1 || z < 1 || x >= n - 1 || y >= n - 1 || z >= n - 1) return false;
    return mc.field[mc.size2 * z + n * y + x] > mc.isolation;
  };
  C.topY = (x, z, from = .3) => { const p = new V3(x, from, z); for (let y = from; y > 0; y -= L / mc.size * .5) { p.y = y; if (C.solid(p)) return y; } return -1; };
  C.stats = () => {
    const add = C.strokes.filter(s => !s.sub), balls = add.flatMap(s => s.b);
    if (!balls.length) return { balls: 0 };
    const min = new V3(9, 9, 9), max = new V3(-9, -9, -9);
    for (const b of balls) { min.min(new V3(b[0] - b[3], b[1] - b[3], b[2] - b[3])); max.max(new V3(b[0] + b[3], b[1] + b[3], b[2] + b[3])); }
    const cz = (min.z + max.z) / 2, cx = (min.x + max.x) / 2;
    // mirror symmetry: each ball should have a twin on the other side (across z, or across x — the better one counts)
    const sym = axis => { let s = 0; for (const b of balls) { const m = axis === 'z' ? [b[0], b[1], 2 * cz - b[2]] : [2 * cx - b[0], b[1], b[2]]; let best = 9; for (const o of balls) best = Math.min(best, Math.hypot(o[0] - m[0], o[1] - m[1], o[2] - m[2])); s += Math.max(0, 1 - best / .025); } return s / balls.length; };
    const colors = new Set(add.map(s => s.c)).size;
    const vol = balls.reduce((v, b) => v + b[3] ** 3 * 4.19, 0);
    return { balls: balls.length, strokes: add.length, carves: C.strokes.length - add.length, min, max, size: max.clone().sub(min), symZ: sym('z'), symX: sym('x'), colors, vol };
  };

  // ---------------------------------------------------------------- strokes from pinches
  const live = new Map();     // hand key → { stroke, last: V3, still }
  let rebuildT = 0;
  function tool(key, on, p, sub, dt) {
    let s = live.get(key);
    if (!on || !inside(p)) { if (s) { live.delete(key); C.save(); } return; }
    if (!s) {
      s = { stroke: { c: C.color, sub, b: [] }, last: null, still: 0 };
      C.strokes.push(s.stroke); live.set(key, s); if (sfx) sfx.chirp(sub ? 'angry' : 'curious', .25);
    }
    const r0 = sub ? .016 : .011;
    if (!s.last || p.distanceTo(s.last) > r0 * .45) { s.stroke.b.push([+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4), r0]); s.last = p.clone(); s.still = 0; C.dirty = true; }
    else { s.still += dt; const b = s.stroke.b[s.stroke.b.length - 1]; if (s.still > .25 && b[3] < .045) { b[3] += dt * .03; C.dirty = true; } }   // hold still = swell
  }

  // ---------------------------------------------------------------- the palm menu (left palm up), poke with the right index tip
  const menu = new THREE.Group(); menu.visible = false; root.add(menu);
  const btns = [];
  function label(txt, bg) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
    g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke();
    if (txt) { g.fillStyle = '#fff'; g.font = '600 34px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 64, 66); }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function addBtn(id, txt, bg, x, y) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(.026, .026), new THREE.MeshBasicMaterial({ map: label(txt, bg), transparent: true, depthTest: false }));
    m.renderOrder = 20; m.position.set(x, y, 0); m.userData.id = id; menu.add(m); btns.push(m); return m;
  }
  COLORS.forEach((c, i) => { const a = Math.PI * (.15 + .7 * i / (COLORS.length - 1)); addBtn('c' + i, '', c, Math.cos(a) * -.075, .045 + Math.sin(a) * .05); });
  const modeBtn = addBtn('mode', 'play', '#333', -.034, -.004);
  addBtn('undo', '↶', '#333', 0, -.004);
  addBtn('clear', '✕', '#622', .034, -.004);
  const pick = new THREE.Mesh(new THREE.RingGeometry(.0145, .018, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, side: THREE.DoubleSide })); pick.renderOrder = 21; menu.add(pick);
  function setMode(m) {
    C.mode = m; modeBtn.material.map.dispose(); modeBtn.material.map = label(m === 'build' ? 'build' : 'play', m === 'build' ? '#a06a00' : '#333'); modeBtn.material.needsUpdate = true;
    say(m === 'build' ? 'BUILD · right pinch = clay · left pinch = carve' : 'PLAY · the creatures are back in charge', 2.5);
  }
  C.setMode = setMode;
  const extraFn = {};
  C.extra = (id, txt, bg, x, y, fn) => { addBtn(id, txt, bg, x, y); extraFn[id] = fn; };
  let pokeCool = 0;
  function palmMenu(hands, head, dt) {
    pokeCool -= dt;
    const Lh = hands.find(h => h.real === 'L' && !h.stale), Rh = hands.find(h => h.real === 'R' && !h.stale);
    const show = Lh && Lh.palmN.y > .6;
    menu.visible = !!show; if (!show) return false;
    menu.position.copy(Lh.palm).addScaledVector(Lh.palmN, .035);
    menu.lookAt(head); menu.updateMatrixWorld();
    const ci = COLORS.indexOf(C.color); pick.position.copy(btns[ci].position);
    if (!Rh || pokeCool > 0) return true;
    const tip = Rh.pts[8];
    for (const b of btns) {
      if (b.getWorldPosition(new V3()).distanceTo(root.localToWorld(tip.clone())) < .016) {
        pokeCool = .6; const id = b.userData.id; if (sfx) sfx.chirp('happy', .5);
        if (id[0] === 'c') { C.color = COLORS[+id.slice(1)]; if (C.mode !== 'build') setMode('build'); }
        else if (id === 'mode') setMode(C.mode === 'build' ? 'play' : 'build');
        else if (id === 'undo') C.undo();
        else if (id === 'clear') C.clear();
        else if (extraFn[id]) extraFn[id]();
        break;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- every frame (hands = W.hands, in table coords; head in table coords)
  C.step = (hands, head, dt) => {
    const menuOpen = palmMenu(hands, root.localToWorld(head.clone()), dt);
    if (C.mode === 'build') for (const h of hands) {
      if (h.stale) { tool(h.real, false); continue; }
      if (menuOpen && h.real === 'L') { tool('L', false); continue; }
      tool(h.real, h.pinch, h.pinchPt, h.real === 'L', dt);
    }
    else { for (const k of [...live.keys()]) tool(k, false); }
    rebuildT += dt;
    if (C.dirty && rebuildT > (live.size ? 1 / 20 : 0)) { rebuildT = 0; rebuild(); }
  };
  C.busy = () => C.mode === 'build';
  return C;
}
