// bUild sTudio · Z BRUSH PANEL — ZBrush-style: pick a brush, a stroke, an alpha; size · intensity · focal shift · lazy mouse;
//  new sphere · subdivide · voxel clay → Z · masks · look. VR: floats left of the palette · flat: overlay top-left.
import * as THREE from 'three';
import { ZBRUSHES, ZBRUSH_KEYS, ZSTROKES, ZALPHA_KEYS, zAlphaThumb, ZLOOKS, ZSMART, ZSMART_KEYS, parseLook } from './zsculpt.js';
const W = 1024, H = 1720;

export function createBrushPanel(S, api) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const PW = .23, PH = PW * H / W;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide }));
  panel.renderOrder = 31; panel.visible = false;
  const thumbs = new Map(); const thumb = k => { let t = thumbs.get(k); if (!t) thumbs.set(k, t = zAlphaThumb(k, 112)); return t; };
  const P = { panel, canvas: cv, W, H, open: false, items: [], hover: null, drag: null, hit: null };
  let items = [];
  const btn = (id, x, y, w, h, label, on = false, small = false, ic = null) => {
    items.push({ id, x, y, w, h }); const hov = P.hover && P.hover.id === id;
    g.fillStyle = on ? 'rgba(255,194,58,.32)' : hov ? 'rgba(255,255,255,.17)' : 'rgba(255,255,255,.07)'; g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill();
    if (on || hov) { g.strokeStyle = on ? '#ffc23a' : '#fff'; g.lineWidth = on ? 4 : 2; g.stroke(); }
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (ic) { g.font = '600 34px system-ui'; g.fillText(ic, x + w / 2, y + h * .38); g.font = '600 20px system-ui'; g.fillText(label, x + w / 2, y + h * .78); }
    else { g.font = `600 ${small ? 22 : 26}px system-ui`; g.fillText(label, x + w / 2, y + h / 2 + 1); }
  };
  const bar = (id, x, y, w, h, label, v, min, max, show) => {
    items.push({ id, x, y, w, h, bar: { min, max } }); const k = Math.max(0, Math.min(1, (v - min) / (max - min)));
    g.fillStyle = P.hover && P.hover.id === id ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
    g.fillStyle = 'rgba(255,194,58,.45)'; g.beginPath(); g.roundRect(x, y, Math.max(12, w * k), h, 12); g.fill();
    g.fillStyle = '#fff'; g.font = '600 22px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x + 14, y + h / 2 + 1); g.textAlign = 'right'; g.fillText(show ?? v.toFixed(2), x + w - 12, y + h / 2 + 1);
  };
  const swatch = (id, x, y, w, h, key, on) => {
    items.push({ id, x, y, w, h }); const M = ZSMART[key], hov = P.hover && P.hover.id === id, cx = x + w / 2, cy = y + h * .4, rr = Math.min(w, h) * .3;
    g.fillStyle = on ? 'rgba(255,194,58,.3)' : hov ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.05)'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
    if (on) { g.strokeStyle = '#ffc23a'; g.lineWidth = 4; g.stroke(); }
    const gr = g.createRadialGradient(cx - rr * .35, cy - rr * .4, rr * .05, cx, cy, rr); if (M.ramp) { gr.addColorStop(0, M.ramp[3]); gr.addColorStop(.3, M.ramp[2]); gr.addColorStop(.65, M.ramp[1]); gr.addColorStop(1, M.ramp[0]); }
    else { gr.addColorStop(0, M.m > .5 || M.r < .2 ? '#ffffff' : M.edge); gr.addColorStop(.35, M.col); gr.addColorStop(.85, M.col); gr.addColorStop(1, M.cav); }
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill(); g.strokeStyle = M.edge; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, rr - 1, -2.6, -1.2); g.stroke();
    g.fillStyle = '#fff'; g.font = '600 16px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(M.l, cx, y + h - 13);
  };
  const head = (t, y) => { g.fillStyle = '#ffc23a'; g.font = '700 22px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, 26, y); };
  P.draw = () => {
    items = []; g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,12,14,.92)'; g.beginPath(); g.roundRect(0, 0, W, H, 34); g.fill(); g.strokeStyle = 'rgba(255,194,58,.55)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#ffc23a'; g.font = '700 32px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('Z SCULPT', 28, 38);
    const zo = api.zInfo ? api.zInfo() : null;
    if (zo && zo.look !== P.lastLook) { P.lastLook = zo.look; const L = parseLook(zo.look); if (L) Object.assign(S, { zSmA: L.a, zSmB: L.b, zDirt: L.dirt, zWear: L.wear }); }   // the swatches show the mesh you have g.fillStyle = '#aaa'; g.font = '500 21px system-ui'; g.fillText(zo ? `${(zo.F / 1000).toFixed(0)}k polys` : 'no Z mesh yet → new sphere', 200, 40);
    btn('close', W - 90, 12, 70, 52, '✕');
    // brushes 6 × 2
    const bw = (W - 40) / 8;
    ZBRUSH_KEYS.forEach((k, i) => btn('b:' + k, 20 + (i % 8) * bw + 3, 72 + Math.floor(i / 8) * 92, bw - 6, 86, ZBRUSHES[k].label, S.tool === 'z' && (S.zb || 'standard') === k, true, ZBRUSHES[k].icon));
    let y = 264;
    // strokes + modifiers
    Object.entries(ZSTROKES).forEach(([k, l], i) => btn('s:' + k, 20 + i * 160, y, 152, 58, l, (S.zStroke || 'free') === k, true));
    btn('zsub', 508, y, 160, 58, S.zSub ? 'ZSub ✓' : 'ZAdd', !!S.zSub, true);
    btn('mirror', 676, y, 160, 58, S.mirror ? 'sym X ✓' : 'sym X', !!S.mirror, true);
    btn('look', 844, y, 160, 58, ZLOOKS[S.zLook || 'smart'], (S.zLook || 'smart') === 'smart', true); y += 70;
    bar('size', 20, y, 320, 54, 'size', S.size, .0015, .06, (S.size * 2000).toFixed(0) + ' mm'); bar('zInt', 348, y, 320, 54, 'intensity', S.zInt ?? .45, 0, 1); bar('zFoc', 676, y, 328, 54, 'focal shift', S.zFoc ?? 0, -1, 1); y += 62;
    bar('zLazy', 20, y, 320, 54, 'lazy mouse', S.zLazy ?? .25, 0, 1); bar('zTile', 348, y, 320, 54, 'tile (~ alphas)', S.zTile ?? 1, .25, 4);
    btn('myalpha', 676, y, 328, 54, '＋ my own alpha (image)', false, true); y += 70;
    // LIVE MATERIAL: base + paint (the Paint brush), dirt in cavities, worn rims — updates while you sculpt
    head('live material', y + 4); g.fillStyle = '#888'; g.font = '500 19px system-ui'; g.fillText('cavities get dirt, rims wear — live while you sculpt · Paint brush = 2nd material', 200, y + 4); y += 24;
    bar('zDirt', 20, y, 490, 50, 'cavity dirt', S.zDirt ?? .6, 0, 1); bar('zWear', 516, y, 488, 50, 'edge wear', S.zWear ?? .6, 0, 1); y += 58;
    const per = Math.ceil(ZSMART_KEYS.length / 2), sw = (W - 130) / per, sh = 64;
    g.fillStyle = '#ccc'; g.font = '700 19px system-ui'; g.textAlign = 'left'; g.fillText('base', 24, y + sh);
    ZSMART_KEYS.forEach((k, i) => swatch('ma:' + k, 110 + (i % per) * sw + 2, y + Math.floor(i / per) * (sh + 4), sw - 4, sh, k, (S.zSmA || 'white') === k)); y += 2 * (sh + 4) + 6;
    g.fillStyle = '#ccc'; g.font = '700 19px system-ui'; g.textAlign = 'left'; g.fillText('paint', 24, y + sh);
    ZSMART_KEYS.forEach((k, i) => swatch('mb:' + k, 110 + (i % per) * sw + 2, y + Math.floor(i / per) * (sh + 4), sw - 4, sh, k, (S.zSmB || 'gold') === k)); y += 2 * (sh + 4) + 12;
    // alphas 9 per row
    head('alpha', y + 4); g.fillStyle = '#888'; g.font = '500 19px system-ui'; g.fillText('stamps · ~ = nature tiles · DragRect = drag to size + turn', 110, y + 4); y += 22;
    const cw = (W - 40) / 9, chh = 100;
    ZALPHA_KEYS.slice(0, 63).forEach((k, i) => {
      const x = 20 + (i % 9) * cw + 3, yy = y + Math.floor(i / 9) * (chh + 4), on = (S.zAlpha || 'none') === k, hov = P.hover && P.hover.id === 'a:' + k;
      items.push({ id: 'a:' + k, x, y: yy, w: cw - 6, h: chh });
      g.drawImage(thumb(k), x, yy, cw - 6, chh - 26);
      g.fillStyle = on ? 'rgba(255,194,58,.9)' : hov ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.65)'; g.fillRect(x, yy + chh - 26, cw - 6, 26);
      g.fillStyle = on ? '#000' : '#fff'; g.font = '600 15px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k.length > 12 ? k.slice(0, 11) + '…' : k, x + (cw - 6) / 2, yy + chh - 12);
      if (on) { g.strokeStyle = '#ffc23a'; g.lineWidth = 5; g.strokeRect(x + 2, yy + 2, cw - 10, chh - 4); }
    });
    y += 7 * (chh + 4) + 6;
    // mesh actions
    const aw = (W - 40) / 8;
    [['new', '● new sphere'], ['subdiv', '▦ subdivide'], ['dyna', '⟳ DynaMesh'], ['dynaf', '⟳ finer'], ['voxel', '🧱 clay → Z'], ['minv', '◐ mask invert'], ['mclear', '○ mask clear'], ['mblur', '◌ mask blur']].forEach(([id, l], i) => btn('act:' + id, 20 + i * aw + 3, y, aw - 6, 62, l, false, true));
    y += 74; g.fillStyle = '#888'; g.font = '500 19px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('mouse: press model = sculpt · empty = orbit · Alt = ZSub · Shift = smooth · Ctrl = mask · [ ] size · X sym', 26, y);
    g.fillText('Smear = grab + drag out tentacles · auto DynaMesh re-voxels the stretch · fluid materials follow bumps + cavities', 26, y + 78);
    g.fillText('hard surface: Layer + panel/vent/hex alpha + DragRect = plates · hPolish = flat facets · Alt+Layer = inset', 26, y + 52);
    g.fillText('VR: trigger = sculpt (pressure) · tip touches the model · the palette Z = this tool', 26, y + 26);
    P.items = items; tex.needsUpdate = true;
  };
  const at = (x, y) => P.items.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  function act(b, x, first) {
    if (b.bar) { const v = b.bar.min + Math.max(0, Math.min(1, (x - b.x) / b.w)) * (b.bar.max - b.bar.min); S[b.id] = v; if (b.id === 'zDirt' || b.id === 'zWear') api.z.smart(); api.prefs(); api.changed(); return; }
    if (!first) return;
    const [k, a] = b.id.split(':');
    if (b.id === 'close') { S.brushOpen = false; P.open = false; api.changed(); }
    else if (k === 'b') { S.zb = a; api.setTool('z'); api.say(ZBRUSHES[a].label, .8); }
    else if (k === 's') { S.zStroke = a; if (S.tool !== 'z') api.setTool('z'); }
    else if (k === 'a') { S.zAlpha = a; if (S.tool !== 'z') api.setTool('z'); if (!ZBRUSHES[S.zb || 'standard'].alpha) { S.zb = 'standard'; } }
    else if (k === 'ma') { S.zSmA = a; api.z.smart(); api.say('base: ' + ZSMART[a].l, .8); }
    else if (k === 'mb') { S.zSmB = a; api.z.smart(); S.zb = 'paint'; api.setTool('z'); api.say('Paint: ' + ZSMART[a].l + ' (Alt = erase)', 1.2); }
    else if (b.id === 'zsub') S.zSub = !S.zSub;
    else if (b.id === 'mirror') { S.mirror = !S.mirror; api.changed(); }
    else if (b.id === 'look') { const L = Object.keys(ZLOOKS); api.z.look(L[(L.indexOf(S.zLook || 'smart') + 1) % L.length]); }
    else if (b.id === 'myalpha') api.pickAlpha && api.pickAlpha();
    else if (k === 'act') {
      if (a === 'new') { api.z.newSphere(null, api.isFlat()); api.setTool('z'); }
      else if (a === 'subdiv') api.z.subdivide(); else if (a === 'dyna') api.z.dynamesh(); else if (a === 'dynaf') api.z.dynamesh(null, false, null, true); else if (a === 'voxel') { api.z.fromVoxel(); api.setTool('z'); }
      else if (a === 'minv') api.z.mask('invert'); else if (a === 'mclear') api.z.mask('clear'); else if (a === 'mblur') api.z.mask('blur');
    }
    api.prefs();
  }
  P.down = (x, y) => { const b = at(x, y); if (!b) return false; P.drag = b; act(b, x, true); P.draw(); return true; };
  P.move = (x, y) => { const b = at(x, y); if (b !== P.hover) { P.hover = b; P.draw(); } if (P.drag && P.drag.bar) { act(P.drag, x, false); P.draw(); } };
  P.up = () => { P.drag = null; };
  // VR: LEFT of the palette
  const ray = new THREE.Raycaster(); let cool = 0;
  P.place = menuPanel => {
    panel.visible = P.open && menuPanel.visible; if (!panel.visible) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(menuPanel.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(menuPanel.quaternion);
    panel.quaternion.copy(menuPanel.quaternion); panel.position.copy(menuPanel.position).addScaledVector(right, -(.2 / 2 + PW / 2 + .012)).addScaledVector(up, (PH - .2 * 880 / 1024) / 2); panel.updateMatrixWorld();
  };
  P.use = (R, dt) => {
    cool -= dt; P.hit = null;
    if (!panel.visible || R.kind === 'none') { if (P.hover) { P.hover = null; P.draw(); } P.drag = null; return false; }
    let hit = null, poke = false; const local = panel.worldToLocal(R.pos.clone());
    if (Math.abs(local.z) < .02 && Math.abs(local.x) < PW / 2 && Math.abs(local.y) < PH / 2) { hit = { u: local.x / PW + .5, v: local.y / PH + .5 }; poke = local.z < .006; }
    else if (R.kind === 'ctrl') { ray.set(R.pos, R.dir); ray.far = 1.2; const h = ray.intersectObject(panel)[0]; if (h) { hit = h.uv; P.hit = h.point; } }
    if (!hit) { if (P.hover) { P.hover = null; P.draw(); } if (!R.on) P.drag = null; return !!P.drag; }
    const x = hit.u * W, y = (1 - hit.v) * H, b = at(x, y); if (b !== P.hover) { P.hover = b; P.draw(); if (b) R.buzz(.1, 8); }
    const press = poke || R.on;
    if (press && P.drag && P.drag.bar) { act(P.drag, x, false); P.draw(); }
    else if (b && cool <= 0 && ((poke && P.armed) || R.onDown)) { cool = .25; P.armed = false; P.drag = b; R.buzz(.5, 25); act(b, x, true); P.draw(); }
    if (!poke && local.z > .012) P.armed = true;
    if (!press && P.drag) P.drag = null;
    return true;
  };
  P.draw();
  return P;
}
