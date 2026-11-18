// bUild eYes · DEV LINK (dev server only, never in the public build): this page reports to the PC hub and obeys Claude.
//  logs + errors, a state heartbeat every 2 s, screenshots of the virtual layer (from the headset's eye), remote eval + reload.
import * as THREE from 'three';
const who = (BE.isQuest ? 'quest' : /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'phone' : 'pc') + (BE.q.get('who') ? '-' + BE.q.get('who') : '');
BE.who = who;
const post = (k, b) => fetch(`/__q/${k}?who=${who}`, { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }).catch(() => {});
const fmt = a => a.map(x => { if (typeof x === 'string') return x; if (x instanceof Error) return x.stack || x.message; try { return JSON.stringify(x); } catch { return String(x); } }).join(' ').slice(0, 2000);

// ---------------------------------------------------------------- logs (batched)
let buf = [];
for (const lvl of ['log', 'info', 'warn', 'error']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => { orig(...a); buf.push({ t: Date.now(), lvl, msg: fmt(a) }); };
}
addEventListener('error', e => buf.push({ t: Date.now(), lvl: 'ERROR', msg: `${e.message} @ ${e.filename}:${e.lineno}` }));
addEventListener('unhandledrejection', e => buf.push({ t: Date.now(), lvl: 'ERROR', msg: 'promise: ' + fmt([e.reason]) }));
setInterval(() => { if (buf.length) { post('log', buf); buf = []; } }, 700);
buf.push({ t: Date.now(), lvl: 'info', msg: `hello · v${BE.version} · ${navigator.userAgent}` });

// ---------------------------------------------------------------- state heartbeat
let frames = 0, fps = 0, lastF = performance.now();
(function count() { frames++; const n = performance.now(); if (n - lastF > 1000) { fps = Math.round(frames * 1000 / (n - lastF)); frames = 0; lastF = n; } requestAnimationFrame(count); })();
BE.xrFrame = () => { frames++; };   // the XR loop calls this (window rAF stops inside a headset session)
function state() {
  const r = BE.world && BE.world.renderer, cam = r && r.xr.isPresenting ? r.xr.getCamera() : BE.world && BE.world.camera;
  const head = cam ? new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld).toArray().map(v => +v.toFixed(3)) : null;
  const W = BE.W;
  return {
    t: new Date().toISOString(), v: BE.version, who, url: location.href, fps, xr: !!(r && r.xr.isPresenting), head,
    hands: (BE.hands || []).map(h => ({ side: h.key, tip: h.P[8].toArray().map(v => +v.toFixed(3)) })),
    inputs: BE.world && BE.world.session ? [...BE.world.session.inputSources].map(s => (s.handedness || '?') + ':' + (s.hand ? 'hand' : s.gamepad ? 'controller' : 'other')) : [],
    placed: !!BE.placed, monsters: W ? W.monsters.map(m => ({ n: m.name, k: m.mem && m.mem.kind, act: m.act, p: m.p.toArray().map(v => +v.toFixed(3)) })) : [],
    extra: BE.devState ? BE.devState() : undefined,
  };
}
setInterval(() => post('state', state()), 2000);

// ---------------------------------------------------------------- screenshot of the virtual layer from the current eye (passthrough is not readable)
BE.shot = (w = 960) => {
  const r = BE.world && BE.world.renderer; if (!r) return 'no renderer';
  const xr = r.xr.isPresenting, src = xr ? r.xr.getCamera().cameras[0] || r.xr.getCamera() : BE.world.camera;
  const h = Math.round(w * 0.9), rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
  const cam = new THREE.PerspectiveCamera(); cam.matrixWorld.copy(src.matrixWorld); cam.matrixWorldInverse.copy(src.matrixWorld).invert();
  cam.projectionMatrix.copy(src.projectionMatrix); cam.projectionMatrixInverse.copy(src.projectionMatrix).invert(); cam.matrixAutoUpdate = false;
  const bg = BE.world.scene.background; BE.world.scene.background = new THREE.Color(0x202024);
  const was = r.xr.enabled; r.xr.enabled = false; const prevRT = r.getRenderTarget();
  const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(); r.setClearColor(0x202024, 1);
  r.setRenderTarget(rt); r.clear(); r.render(BE.world.scene, cam); r.setRenderTarget(prevRT); r.setClearColor(cc, ca); r.xr.enabled = was; BE.world.scene.background = bg;
  const px = new Uint8Array(w * h * 4); r.readRenderTargetPixels(rt, 0, 0, w, h, px); rt.dispose();
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  g.putImageData(img, 0, 0);
  // the hands (not part of the scene): joints projected as dots
  const v = new THREE.Vector3();
  for (const hd of BE.hands || []) for (let i = 0; i < hd.P.length; i++) {
    v.copy(hd.P[i]).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); if (v.z > 1) continue;
    g.fillStyle = i === 8 || i === 4 ? '#ffc23a' : hd.key === 'left' ? '#6cf' : '#f6c'; g.beginPath(); g.arc((v.x + 1) / 2 * w, (1 - v.y) / 2 * h, 4, 0, 7); g.fill();
  }
  g.fillStyle = '#fff'; g.font = '14px monospace'; g.fillText(`${who} v${BE.version} ${new Date().toLocaleTimeString()} ${xr ? 'XR' : '2D'} · virtual layer only`, 8, h - 8);
  post('shot', cv.toDataURL('image/png'));
  return `shot ${w}x${h}`;
};

// ---------------------------------------------------------------- commands from Claude
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
async function loop() {
  for (;;) {
    let cmds = [];
    try { cmds = await (await fetch(`/__q/cmd?who=${who}`)).json(); } catch { await new Promise(r => setTimeout(r, 3000)); continue; }
    for (const c of cmds) {
      if (c.reload) { post('res', { id: c.id, ok: 'reloading' }); setTimeout(() => location.reload(), 200); continue; }
      let out;
      try { const v = await new AsyncFn('THREE', c.js)(THREE); out = { id: c.id, ok: v === undefined ? 'done' : v }; }
      catch (e) { out = { id: c.id, err: String(e && e.stack || e) }; }
      try { JSON.stringify(out); } catch { out = { id: c.id, ok: String(out.ok) }; }
      post('res', out);
    }
  }
}
loop();
