// bUild sTudio · LAYERS PANEL — the Painter's layer stack + properties. ONE canvas: floats next to the palette in VR,
//  sits as an overlay on PC / phone / tablet. Buttons tap, sliders drag (trigger held / finger down).
import * as THREE from 'three';
import { PATTERN_NAMES, GEN_NAMES, BLEND_NAMES, SMART_KEYS } from './painter.js';
const W = 1024, H = 1320;

export function createLayers(S, api) {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const PW = .2, PH = PW * H / W;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, side: THREE.DoubleSide }));
  panel.renderOrder = 31; panel.visible = false;
  const P = { panel, canvas: cv, W, H, open: false, hit: null, items: [], hover: null, drag: null, smart: 0, scroll: 0 };
  const ts = () => api.ts();           // the active texture set (or null)
  const lay = () => { const t = ts(); return t && t.layers[t.sel]; };
  // ---------------------------------------------------------------- drawing helpers (they also register the hit boxes)
  let items = [];
  const btn = (id, x, y, w, h, label, { on = false, col = null, small = false, dim = false } = {}) => {
    items.push({ id, x, y, w, h });
    const hov = P.hover && P.hover.id === id;
    g.fillStyle = col || (on ? 'rgba(255,194,58,.32)' : hov ? 'rgba(255,255,255,.17)' : 'rgba(255,255,255,.07)');
    g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill();
    if (on || hov) { g.strokeStyle = on ? '#ffc23a' : '#fff'; g.lineWidth = on ? 4 : 2; g.stroke(); }
    g.fillStyle = dim ? '#777' : '#fff'; g.font = `600 ${small ? 22 : 26}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x + w / 2, y + h / 2 + 1);
  };
  const bar = (id, x, y, w, h, label, v, min = 0, max = 1, fmt = null) => {
    items.push({ id, x, y, w, h, bar: { min, max } });
    const hov = P.hover && P.hover.id === id, k = Math.max(0, Math.min(1, (v - min) / (max - min)));
    g.fillStyle = hov ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill();
    g.fillStyle = 'rgba(102,204,255,.45)'; g.beginPath(); g.roundRect(x, y, Math.max(12, w * k), h, 12); g.fill();
    g.fillStyle = '#fff'; g.font = '600 22px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x + 14, y + h / 2 + 1);
    g.textAlign = 'right'; g.fillStyle = '#cde'; g.fillText(fmt ? fmt(v) : (Math.abs(max) > 5 ? v.toFixed(0) : v.toFixed(2)), x + w - 12, y + h / 2 + 1);
  };
  const swatch = (id, x, y, w, h, c, label) => { items.push({ id, x, y, w, h }); g.fillStyle = c; g.beginPath(); g.roundRect(x, y, w, h, 12); g.fill(); g.strokeStyle = P.hover && P.hover.id === id ? '#fff' : '#0008'; g.lineWidth = 3; g.stroke(); if (label) { g.fillStyle = '#000a'; g.fillRect(x, y + h - 26, w, 26); g.fillStyle = '#fff'; g.font = '600 18px system-ui'; g.textAlign = 'center'; g.fillText(label, x + w / 2, y + h - 12); } };
  const text = (t, x, y, { size = 24, col = '#aaa', align = 'left', weight = 500 } = {}) => { g.fillStyle = col; g.font = `${weight} ${size}px system-ui`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t, x, y); };

  P.draw = () => {
    items = []; g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,12,14,.9)'; g.beginPath(); g.roundRect(0, 0, W, H, 34); g.fill(); g.strokeStyle = 'rgba(102,204,255,.55)'; g.lineWidth = 3; g.stroke();
    const t = ts();
    text('🎨 PAINTER', 28, 38, { size: 32, col: '#66ccff', weight: 700 });
    btn('close', W - 90, 12, 70, 52, '✕');
    if (!t) {
      text(S.active && S.active.userData.sculpt ? 'a sculpt: bake it into a paintable mesh' : 'paint any object = it becomes paintable', 28, 100, { size: 24 });
      if (S.active && S.active.userData.sculpt) btn('convert', 28, 140, 460, 80, '🎨 sculpt → Painter (bake)', { on: true });
      text('then: layers, masks, smart materials, PBR export', 28, 250, { size: 22, col: '#777' });
      P.items = items; tex.needsUpdate = true; return;
    }
    text(`${t.res >= 2048 ? '2K' : '1K'} · ${t.layers.length} layers`, W - 110, 38, { size: 22, align: 'right' });
    // ---- stack actions
    let y = 76;
    btn('add:paint', 20, y, 150, 64, '+ paint'); btn('add:fill', 178, y, 140, 64, '+ fill');
    btn('smart:prev', 326, y, 50, 64, '◂'); btn('smart:add', 380, y, 300, 64, '✦ ' + SMART_KEYS[P.smart], { col: 'rgba(255,194,58,.2)' }); btn('smart:next', 684, y, 50, 64, '▸');
    btn('dup', 742, y, 64, 64, '⧉'); btn('del', 812, y, 64, 64, '🗑'); btn('up', 882, y, 56, 64, '▲'); btn('down', 944, y, 60, 64, '▼');
    // ---- the stack (top layer first, like Painter)
    y = 152; const rows = 7, list = [...t.layers.keys()].reverse(), first = Math.max(0, Math.min(P.scroll, list.length - rows));
    if (list.length > rows) { btn('scroll:-', W - 74, y, 54, 40, '⌃', { small: true }); btn('scroll:+', W - 74, y + rows * 58 - 40, 54, 40, '⌄', { small: true }); }
    list.slice(first, first + rows).forEach((i, k) => {
      const l = t.layers[i], yy = y + k * 58, sel = i === t.sel, rw = list.length > rows ? W - 104 : W - 40;
      btn('vis:' + i, 20, yy, 56, 50, l.visible ? '👁' : '—', { small: true, dim: !l.visible });
      items.push({ id: 'sel:' + i, x: 82, y: yy, w: rw - 400, h: 50 });
      g.fillStyle = sel ? 'rgba(102,204,255,.28)' : P.hover && P.hover.id === 'sel:' + i ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)'; g.beginPath(); g.roundRect(82, yy, rw - 400, 50, 12); g.fill();
      if (sel) { g.strokeStyle = '#66ccff'; g.lineWidth = 3; g.stroke(); }
      g.fillStyle = l.kind === 'fill' ? l.colA : '#ddd'; g.beginPath(); g.arc(108, yy + 25, 13, 0, 7); g.fill();
      text((l.kind === 'fill' ? '▤ ' : '🖌 ') + l.name + (l.maskOn ? ' ◐' : '') + (l.gen ? ' · ' + GEN_NAMES[l.gen] : ''), 132, yy + 26, { size: 22, col: l.visible ? '#fff' : '#777' });
      bar('op:' + i, rw - 310, yy, 200, 50, 'opacity', l.opacity);
      btn('blend:' + i, rw - 104, yy, 124, 50, BLEND_NAMES[l.blend], { small: true });
    });
    // ---- the selected layer
    const l = lay(); y = 152 + rows * 58 + 14;
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(20, y - 8, W - 40, 2);
    if (l) {
      if (l.kind === 'paint') {
        text('brush paints into this layer:', 28, y + 22, { size: 22 });
        const ch = l.chan; ['colour', 'rough', 'metal', 'height'].forEach((n, k) => btn('chan:' + k, 330 + k * 140, y, 132, 48, n, { on: !!ch[k], small: true }));
        y += 58;
        btn('emit', 330, y, 132, 48, 'glow', { on: !!S.pemit, small: true });
        ['flat', 'raise', 'dig'].forEach((n, k) => btn('bh:' + (k === 0 ? 0 : k === 1 ? 1 : -1), 470 + k * 120, y, 112, 48, n, { on: (S.bh || 0) === (k === 0 ? 0 : k === 1 ? 1 : -1), small: true }));
        text('height:', 28, y + 24, { size: 22 }); y += 60;
      } else {
        btn('pat:-', 20, y, 50, 52, '◂'); btn('pat:+', 290, y, 50, 52, '▸'); text(PATTERN_NAMES[l.pat], 180, y + 26, { size: 24, col: '#fff', align: 'center', weight: 600 });
        swatch('colA', 352, y, 150, 52, l.colA, 'A ← brush'); swatch('colB', 510, y, 150, 52, l.colB, 'B ← brush');
        bar('scale', 670, y, 334, 52, 'scale', l.scale, 1, 150); y += 62;
        bar('rA', 20, y, 240, 48, 'rough A', l.rmA[0]); bar('rB', 268, y, 240, 48, 'rough B', l.rmB[0]); bar('mA', 516, y, 240, 48, 'metal', l.rmA[1]); bar('contrast', 764, y, 240, 48, 'contrast', l.contrast, 0, 3); y += 56;
        bar('hA', 20, y, 240, 48, 'height', l.rmA[2], -1, 1); bar('eA', 268, y, 240, 48, 'glow', l.rmA[3], 0, 6); bar('seed', 516, y, 240, 48, 'seed', l.seed, 0, 10);
        ['colour', 'rough', 'metal', 'height'].forEach((n, k) => btn('fchan:' + k, 764 + k * 61, y, 56, 48, n[0].toUpperCase(), { on: !!l.chan[k], small: true })); y += 62;
      }
      // ---- mask
      text('mask', 28, y + 26, { size: 24, col: '#66ccff', weight: 700 });
      btn('gen:-', 110, y, 50, 52, '◂'); text(GEN_NAMES[l.gen], 260, y + 26, { size: 24, col: '#fff', align: 'center', weight: 600 }); btn('gen:+', 360, y, 50, 52, '▸');
      btn('inv', 420, y, 120, 52, 'invert', { on: !!l.inv, small: true });
      btn('maskOn', 548, y, 160, 52, l.maskOn ? 'paint mask ✓' : 'paint mask', { on: !!l.maskOn, small: true });
      btn('mask:1', 716, y, 140, 52, 'mask white', { small: true }); btn('mask:0', 864, y, 140, 52, 'mask black', { small: true }); y += 62;
      if (l.gen) { bar('level', 20, y, 240, 48, 'level', l.level); bar('soft', 268, y, 240, 48, 'soft', l.soft); bar('breakup', 516, y, 240, 48, 'breakup', l.breakup); bar('bscale', 764, y, 240, 48, 'noise size', l.bscale, 2, 120); y += 56;
        bar('width', 20, y, 240, 48, 'edge width', l.width); y += 58; }
    }
    // ---- the brush
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(20, y, W - 40, 2); y += 12;
    text('brush', 28, y + 26, { size: 24, col: '#ffc23a', weight: 700 });
    ['paint', 'erase', 'mask'].forEach((n, k) => btn('pm:' + n, 110 + k * 132, y, 124, 52, n, { on: (S.pmode || 'paint') === n, small: true }));
    bar('hard', 510, y, 240, 52, 'hardness', S.hard ?? .5); bar('flow', 758, y, 246, 52, 'flow', S.flow ?? .6); y += 62;
    swatch('brushcol', 20, y, 90, 52, S.color, ''); text('= palette colour + material (rough / metal)', 124, y + 26, { size: 21, col: '#888' });
    // ---- output
    btn('maps', 20, H - 82, 300, 64, '⬇ PBR maps (PNG)'); btn('glb', 330, H - 82, 220, 64, '⬇ .glb'); btn('res', 560, H - 82, 200, 64, t.res >= 2048 ? 'res 2K' : 'res 1K', { small: true });
    if (t.from === 'sculpt' || api.canRebake()) btn('rebake', 770, H - 82, 234, 64, '↻ re-bake sculpt', { small: true });
    P.items = items; tex.needsUpdate = true;
  };
  // ---------------------------------------------------------------- picking
  const at = (x, y) => P.items.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  function act(b, x, first) {
    const t = ts(), l = lay(), id = b.id;
    if (b.bar) { const v = b.bar.min + Math.max(0, Math.min(1, (x - b.x) / b.w)) * (b.bar.max - b.bar.min); setBar(id, v); return; }
    if (!first) return;
    const [k, a] = id.split(':');
    if (id === 'close') { P.open = false; S.layersOpen = false; api.changed(); }
    else if (id === 'convert') api.convert();
    else if (!t) return;
    else if (k === 'add') { t.addLayer(a === 'paint' ? { kind: 'paint', name: 'paint ' + (t.layers.length + 1) } : { kind: 'fill', name: 'fill', colA: S.color, colB: S.color, rmA: api.brushRM(), rmB: api.brushRM(), maskOn: 1, maskStart: 0 }); api.edit('add layer'); }
    else if (id === 'smart:prev') P.smart = (P.smart + SMART_KEYS.length - 1) % SMART_KEYS.length;
    else if (id === 'smart:next') P.smart = (P.smart + 1) % SMART_KEYS.length;
    else if (id === 'smart:add') { t.addSmart(SMART_KEYS[P.smart]); api.edit('✦ ' + SMART_KEYS[P.smart]); }
    else if (id === 'dup' && l) { const o = t.layerOut(l, true); o.uid = undefined; o.name = l.name + ' copy'; t.layerIn(o, t.sel + 1); t.sel++; api.edit('copy layer'); }
    else if (id === 'del' && l) { api.removeLayer(t.sel); }
    else if (id === 'up') { t.moveLayer(t.sel, 1); api.edit(); } else if (id === 'down') { t.moveLayer(t.sel, -1); api.edit(); }
    else if (k === 'scroll') P.scroll = Math.max(0, P.scroll + (a === '+' ? 2 : -2));
    else if (k === 'vis') { const L = t.layers[+a]; L.visible = !L.visible; t.full(); api.edit(); }
    else if (k === 'sel') { t.sel = +a; }
    else if (k === 'blend') { const L = t.layers[+a]; L.blend = (L.blend + 1) % BLEND_NAMES.length; t.full(); api.edit(); }
    else if (!l) return;
    else if (k === 'chan') { l.chan = l.chan.slice(); l.chan[+a] = l.chan[+a] ? 0 : 1; api.edit(); }
    else if (k === 'fchan') { l.chan = l.chan.slice(); l.chan[+a] = l.chan[+a] ? 0 : 1; t.full(); api.edit(); }
    else if (id === 'emit') S.pemit = !S.pemit;
    else if (k === 'bh') S.bh = +a;
    else if (k === 'pat') { l.pat = (l.pat + (a === '+' ? 1 : PATTERN_NAMES.length - 1)) % PATTERN_NAMES.length; t.full(); api.edit(); }
    else if (id === 'colA' || id === 'colB') { l[id] = S.color; t.full(); api.edit(); }
    else if (k === 'gen') { l.gen = (l.gen + (a === '+' ? 1 : GEN_NAMES.length - 1)) % GEN_NAMES.length; t.full(); api.edit(); }
    else if (id === 'inv') { l.inv = l.inv ? 0 : 1; t.full(); api.edit(); }
    else if (id === 'maskOn') { if (l.maskOn) l.maskOn = 0; else t.ensureMask(l, 1); t.full(); api.edit(); }
    else if (k === 'mask') { const before = t.snapLayer(t.sel, true); t.layers[t.sel].mask = null; t.ensureMask(l, +a); t.full(); api.edit('mask ' + (+a ? 'white' : 'black')); if (before) before.cp.dispose(); }
    else if (k === 'pm') { S.pmode = a; if (a === 'mask' && !l.maskOn) { t.ensureMask(l, l.kind === 'fill' ? 0 : 1); t.full(); } }
    else if (id === 'maps') api.exportMaps();
    else if (id === 'glb') api.downloadGLB();
    else if (id === 'res') api.setRes(t.res >= 2048 ? 1024 : 2048);
    else if (id === 'rebake') api.rebake();
    api.prefs();
  }
  function setBar(id, v) {
    const t = ts(), [k, a] = id.split(':'); if (k === 'hard') { S.hard = v; api.prefs(); return; } if (k === 'flow') { S.flow = v; api.prefs(); return; }
    if (!t) return;
    if (k === 'op') { t.layers[+a].opacity = v; t.full(); api.edit(null, true); return; }
    const l = lay(); if (!l) return;
    const set4 = (arr, i) => { l[arr] = l[arr].slice(); l[arr][i] = v; };
    if (k === 'scale') l.scale = v; else if (k === 'contrast') l.contrast = v; else if (k === 'seed') l.seed = v;
    else if (k === 'rA') set4('rmA', 0); else if (k === 'rB') set4('rmB', 0);
    else if (k === 'mA') { set4('rmA', 1); set4('rmB', 1); }
    else if (k === 'hA') { set4('rmA', 2); l.rmB = l.rmB.slice(); l.rmB[2] = -v * .3; if (v) { l.chan = l.chan.slice(); l.chan[3] = 1; } }
    else if (k === 'eA') { set4('rmA', 3); set4('rmB', 3); l.emitOn = v > .01 ? 1 : 0; }
    else if (['level', 'soft', 'breakup', 'bscale', 'width'].includes(k)) l[k] = v;
    t.full(); api.edit(null, true);
  }
  // px pointer API (flat overlay): down / move / up in canvas pixels
  P.down = (x, y) => { const b = at(x, y); if (!b) return false; P.drag = b; act(b, x, true); P.draw(); return true; };
  P.move = (x, y) => { const b = at(x, y); if (b !== P.hover) { P.hover = b; P.draw(); } if (P.drag && P.drag.bar) { act(P.drag, x, false); P.draw(); } };
  P.up = () => { if (P.drag && P.drag.bar) api.edit('', false, true); P.drag = null; };
  // ---------------------------------------------------------------- VR: next to the palette, poke or laser + trigger, drag sliders
  const ray = new THREE.Raycaster(); let cool = 0;
  P.place = (menuPanel, head) => {
    panel.visible = P.open && menuPanel.visible; if (!panel.visible) return;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(menuPanel.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(menuPanel.quaternion);
    panel.quaternion.copy(menuPanel.quaternion);
    panel.position.copy(menuPanel.position).addScaledVector(right, .2 / 2 + PW / 2 + .012).addScaledVector(up, (PH - .2 * 880 / 1024) / 2);
    panel.updateMatrixWorld();
  };
  P.use = (R, dt) => {
    cool -= dt; P.hit = null;
    if (!panel.visible || R.kind === 'none') { if (P.hover) { P.hover = null; P.draw(); } P.drag = null; return false; }
    let hit = null, poke = false;
    const local = panel.worldToLocal(R.pos.clone());
    if (Math.abs(local.z) < .02 && Math.abs(local.x) < PW / 2 && Math.abs(local.y) < PH / 2) { hit = { u: local.x / PW + .5, v: local.y / PH + .5 }; poke = local.z < .006; }
    else if (R.kind === 'ctrl') { ray.set(R.pos, R.dir); ray.far = 1.2; const h = ray.intersectObject(panel)[0]; if (h) { hit = h.uv; P.hit = h.point; } }
    if (!hit) { if (P.hover) { P.hover = null; P.draw(); } if (!R.on) P.drag = null; return !!P.drag; }
    const x = hit.u * W, y = (1 - hit.v) * H, b = at(x, y);
    if (b !== P.hover) { P.hover = b; P.draw(); if (b) R.buzz(.1, 8); }
    const press = poke || R.on;
    if (press && P.drag && P.drag.bar) { act(P.drag, x, false); P.draw(); }
    else if (b && cool <= 0 && ((poke && P.armed) || R.onDown)) { cool = .25; P.armed = false; P.drag = b; R.buzz(.5, 25); act(b, x, true); P.draw(); }
    if (!poke && local.z > .012) P.armed = true;
    if (!press && P.drag) { if (P.drag.bar) api.edit('', false, true); P.drag = null; }
    return true;
  };
  P.draw();
  return P;
}
