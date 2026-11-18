// bUild sTudio · PALETTE: one panel on your left hand. Poke it with the right tip, or point at it + trigger.
import * as THREE from 'three';
import { COLORS, MATS, MAT_KEYS } from './materials.js';
import { RECIPE_KEYS, recipeOf } from './chaos.js';
const RC = Object.fromEntries(RECIPE_KEYS.map(k => [k, recipeOf(k)]));
export const TOOLS = [
  ['tube', '✏', 'tube', 1], ['ribbon', '〰', 'ribbon', 1], ['shape', '⬛', 'shape', 1], ['move', '✋', 'move', 1], ['erase', '🧽', 'erase', 1], ['fill', '🪣', 'fill', 1],
  ['z', 'Z', 'Z SCULPT', 2], ['clay', '🧱', 'voxel clay', 2], ['carve', '⛏', 'carve', 2], ['smooth', '〜', 'smooth', 2], ['flatten', '▭', 'flatten', 2], ['grab', '🤏', 'grab', 2], ['inflate', '◉', 'inflate', 2], ['texture', '▦', 'texture', 2], ['paint', '🖌', 'paint', 2],
  ['chaos', '🌿', 'NATURE', 0], ['alpha', '🐉', 'scales', 0], ['chisel', '🔪', 'chisel', 0], ['erode', '🌊', 'erode', 0], ['gouge', '✒', 'gouge', 0],
];
export const PRIMS = [['box', '■'], ['sphere', '●'], ['cyl', '▮'], ['cone', '▲'], ['torus', '◯']];

export function createMenu(S) {
  const W = 1024, H = 880, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const PW = .2, PH = PW * H / W;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide }));
  panel.renderOrder = 30; panel.visible = false;
  const M = { panel, btns: [], hover: null, open: true, hit: null };
  // ---- layout (canvas px)
  function layout() {
    const B = [];
    const row = (y, h, items) => { const w = (W - 40) / items.length; items.forEach((it, i) => B.push({ ...it, x: 20 + i * w + 4, y, w: w - 8, h })); };
    row(62, 96, TOOLS.filter(t => t[3] === 1).map(([id, ic, lb]) => ({ id: 'tool:' + id, ic, lb })));
    row(166, 96, TOOLS.filter(t => t[3] === 2).map(([id, ic, lb]) => ({ id: 'tool:' + id, ic, lb, sculpt: 1 })));
    row(272, 70, [...PRIMS.map(([id, ic]) => ({ id: 'prim:' + id, ic, lb: id })), { id: 'size:-', ic: '−', lb: 'size' }, { id: 'size:+', ic: '+', lb: 'size' }, { id: 'detail:-', ic: '◌', lb: 'detail −' }, { id: 'detail:+', ic: '◍', lb: 'detail +' }, { id: 'pattern', ic: '▦', lb: S.pattern || 'rock' }]);
    row(352, 70, COLORS.map((c, i) => ({ id: 'col:' + i, col: c })));
    row(432, 78, MAT_KEYS.filter(k => !MATS[k].smart).map(k => ({ id: 'mat:' + k, mat: k, lb: MATS[k].label })));
    row(518, 78, [...MAT_KEYS.filter(k => MATS[k].smart).map(k => ({ id: 'mat:' + k, mat: k, lb: '✦ ' + MATS[k].label })), { id: 'mask', ic: '◐', lb: 'mask' }]);
    row(608, 96, [{ id: 'undo', ic: '↶', lb: 'undo' }, { id: 'redo', ic: '↷', lb: 'redo' }, { id: 'mirror', ic: '⇋', lb: 'mirror' }, { id: 'photo', ic: '📷', lb: 'photo' },
      { id: 'brush', ic: 'Z', lb: 'Z brushes' }, { id: 'layers', ic: '🎨', lb: 'painter' }, { id: 'send', ic: '⇪', lb: 'blender' }, { id: 'home', ic: '⌂', lb: 'reset view' }, { id: 'clear', ic: '✕', lb: 'clear all' }]);
    return B;
  }
  M.btns = layout();
  const matSwatch = { clay: '#c9b08e', plastic: '#e04848', gold: '#e6b23a', chrome: '#d8dde4', car: '#2a5bd8', stone: '#7b7770', wood: '#9a6a3c', glass: '#9fe3ff', neon: '#ff3bd4', worn: '#9a7428', rust: '#7a3d1c', moss: '#5d6b45', chipped: '#55606e', bronze: '#6b5a3a' };
  M.draw = () => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,12,14,.86)'; g.beginPath(); g.roundRect(0, 0, W, H, 38); g.fill();
    g.strokeStyle = 'rgba(255,194,58,.5)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffc23a'; g.font = '700 34px system-ui'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('bUild sTudio', 28, 34);
    g.fillStyle = '#aaa'; g.font = '500 26px system-ui'; g.textAlign = 'right';
    g.fillText(`${S.tool}${S.tool === 'shape' ? ' · ' + S.prim : ''} · ${(S.size * 1000).toFixed(0)} mm · detail ${S.detail.toFixed(1)} mm · ${MATS[S.mat].label}${S.mirror ? ' · MIRROR' : ''}`, W - 28, 34);
    for (const b of M.btns) {
      if (b.id === 'pattern') b.lb = S.pattern; if (b.id === 'recipe') { b.lb = S.recipe || 'python'; b.ic = (RC[S.recipe] || {}).icon || '🌀'; } if (b.id === 'mask') b.lb = 'mask: ' + (S.mask || 'all');
      const on = (b.id === 'brush' && S.brushOpen) || (b.id === 'wild' && S.wild) || (b.id === 'layers' && S.layersOpen) || b.id === 'tool:' + S.tool || b.id === 'prim:' + S.prim || b.id === 'col:' + COLORS.indexOf(S.color) || b.id === 'mat:' + S.mat || (b.id === 'mirror' && S.mirror);
      const hov = M.hover === b;
      g.fillStyle = b.col || (b.mat ? matSwatch[b.mat] : on ? 'rgba(255,194,58,.35)' : hov ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.07)');
      g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 18); g.fill();
      if (on || hov) { g.strokeStyle = on ? '#ffc23a' : '#fff'; g.lineWidth = on ? 6 : 3; g.stroke(); }
      g.textAlign = 'center'; g.fillStyle = b.mat && ['chrome', 'glass'].includes(b.mat) ? '#111' : '#fff';
      if (b.ic) { g.font = `600 ${b.lb ? 44 : 50}px system-ui`; g.fillText(b.ic, b.x + b.w / 2, b.y + b.h / 2 - (b.lb ? 14 : 0)); }
      if (b.lb) { g.font = `600 ${b.ic ? 20 : 24}px system-ui`; g.fillText(b.lb, b.x + b.w / 2, b.y + (b.ic ? b.h - 22 : b.h / 2)); }
    }
    g.fillStyle = '#888'; g.font = '500 22px system-ui'; g.textAlign = 'left';
    g.fillText(S.hint || 'grip = grab · grip air = move world · both grips = scale · A/B undo/redo · sticks: tool, size, colour, material', 28, 752);
    g.fillStyle = '#666'; g.fillText(S.status || '', 28, 800);
    if (S.room) { g.fillStyle = '#66ccff'; g.textAlign = 'right'; g.fillText(S.room, W - 28, 800); g.textAlign = 'left'; }

    tex.needsUpdate = true;
  };
  const at = (u, v) => { const x = u * W, y = (1 - v) * H; return M.btns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null; };
  // place the panel on the left pointer, facing the head
  M.place = (L, head, dt) => {
    const show = M.open && (L.kind === 'ctrl' || (L.kind === 'hand' && L.palmUp));
    panel.visible = show; if (!show) { M.hover = null; return; }
    const want = L.kind === 'ctrl' ? L.pos.clone().addScaledVector(L.up, .1).addScaledVector(L.dir, -.02) : L.pos.clone().add(new THREE.Vector3(0, .1, 0));
    if (panel.userData.fresh) panel.position.copy(want); else panel.position.lerp(want, Math.min(1, dt * 18));
    panel.userData.fresh = false;
    panel.lookAt(head); panel.updateMatrixWorld();
  };
  // pointer R: returns true when it is busy with the panel (tools must not act)
  const ray = new THREE.Raycaster(); let cool = 0;
  M.use = (R, dt) => {
    cool -= dt; M.hit = null;
    if (!panel.visible || R.kind === 'none') { if (M.hover) { M.hover = null; M.draw(); } return false; }
    let hit = null, poke = false;
    const local = panel.worldToLocal(R.pos.clone());
    if (Math.abs(local.z) < .02 && Math.abs(local.x) < PW / 2 && Math.abs(local.y) < PH / 2) { hit = { u: local.x / PW + .5, v: local.y / PH + .5 }; poke = local.z < .006; }
    else if (R.kind === 'ctrl') { ray.set(R.pos, R.dir); ray.far = 1.2; const h = ray.intersectObject(panel)[0]; if (h) { hit = h.uv; M.hit = h.point; } }
    const b = hit ? at(hit.u, hit.v) : null;
    if (b !== M.hover) { M.hover = b; M.draw(); if (b) R.buzz(.1, 8); }
    if (!poke && (!hit || local.z > .012)) M.armed = true;
    if (b && cool <= 0 && ((poke && M.armed) || R.onDown)) { cool = .3; M.armed = false; R.buzz(.5, 25); M.onPick(b.id); M.draw(); }
    return !!hit;
  };
  M.onPick = () => { };
  M.canvas = cv;                                     // the same palette as an HTML overlay on PC / phone / tablet
  M.pickPx = (x, y) => { const b = M.btns.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h); if (b) { M.onPick(b.id); M.draw(); } return b; };
  M.draw();
  return M;
}
