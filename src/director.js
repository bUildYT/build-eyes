// bUild eYes · DIRECTOR = laptop / PC / tablet with ordinary cameras. Every camera that sees the A4 paper becomes an EYE:
// the creatures from the headset are drawn INTO that camera's picture (same table, same moment).
//  · the paper is found by itself; the two thick DOTS at corner 1 and corner 2 tell which edge faces the player
//  · 1–9 = cut to that EYE · A = auto-cut (a new EYE every few seconds) · R = record (9:16 for Insta/TikTok, with sound) · F = 16:9 / 9:16
//  · EYE 0 = the god view (free 3D camera, drag to turn) — works even with no camera at all
import * as THREE from 'three';
import { createWorld } from './world.js';
import { A4 } from './calib.js';
import { paperPose } from './paperpose.js';
import { joinRoom, hostRoom, newCode } from './net.js';
const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);

export async function start(code, { solo = false } = {}) {
  // solo = no headset yet: THIS computer runs the creatures' minds and is the host; phones + cameras join with its code
  if (solo) code = localStorage.getItem('be:solo') || newCode(), localStorage.setItem('be:solo', code);
  $('start').hidden = true;
  document.body.insertAdjacentHTML('beforeend', `
  <style>
    #stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: #050505; }
    #out { max-width: 100vw; max-height: calc(100vh - 110px); box-shadow: 0 0 0 1px #222; }
    #strip { position: fixed; left: 0; right: 0; bottom: 0; height: 104px; display: flex; gap: 8px; padding: 8px; background: rgba(0,0,0,.7); overflow-x: auto; }
    .th { position: relative; height: 88px; aspect-ratio: 16/9; border: 2px solid #333; border-radius: 6px; overflow: hidden; cursor: pointer; flex: none; background: #111; }
    .th.on { border-color: var(--gold); } .th video { width: 100%; height: 100%; object-fit: cover; }
    .th b { position: absolute; left: 6px; top: 4px; font: 700 15px system-ui; color: #fff; text-shadow: 0 1px 3px #000; }
    .th i { position: absolute; left: 6px; bottom: 3px; font: 11px system-ui; color: #ddd; text-shadow: 0 1px 3px #000; font-style: normal; }
    #keys { position: fixed; right: 12px; top: 10px; font: 13px system-ui; color: #aaa; text-align: right; }
    #rec { color: #f33; font-weight: 700; }
  </style>
  <div id="stage"><canvas id="out"></canvas></div><div id="strip"></div><div id="keys"></div>`);
  const out = $('out'), og = out.getContext('2d');
  { const link = BE.base + '?role=eye&eye=' + code, box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:12px;bottom:118px;background:#fff;padding:6px;border-radius:10px;text-align:center;font:600 12px system-ui;color:#000;z-index:3';
    box.appendChild(BE.qr(link, 3)); box.insertAdjacentHTML('beforeend', '<div>phone: scan = EYE</div>'); box.title = link; document.body.appendChild(box);
    box.onclick = () => box.remove(); }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const table = new THREE.Group(); scene.add(table);                 // director: world = table frame
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, .01, 30);
  const W = createWorld({ root: table, camera }); W.vw = 0; window.BE.W = W;
  // the paper, drawn faintly in the god view only
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(A4[0], A4[1]), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .25 }));
  paper.rotation.x = -Math.PI / 2; paper.position.y = .0005; table.add(paper);
  const dots = [-1, 1].map(s => { const m = new THREE.Mesh(new THREE.CircleGeometry(.008, 20), new THREE.MeshBasicMaterial({ color: 0x111111 })); m.rotation.x = -Math.PI / 2; m.position.set(s * (A4[0] / 2 - .02), .001, A4[1] / 2 - .02); table.add(m); return m; });

  // ---------------------------------------------------------------- the link to the headset
  let linked = false, lastSnap = 0, eyes = 0;
  const net = solo
    ? hostRoom(code, { onCount: n => eyes = n, onMsg: m => { if (m.t === 'food') W.dropFood(new V3().fromArray(m.p)); } })
    : joinRoom(code, {
      onState: s => { linked = s === 'linked'; if (linked) net.send({ t: 'hi', kind: 'director' }); },
      onMsg: m => { if (m.t === 's') { W.applySnap(m); lastSnap = performance.now(); } else W.event(m); },
    });
  if (solo) {
    W.onEvent = ev => net.send(ev);
    setInterval(() => { if (net.count) net.send(W.snap()); }, 50);
    W.area = .14;                                           // stay on the paper
    for (let i = 0; i < 3; i++) setTimeout(() => W.addMonster(true, i === 0 ? { kind: 'dragon' } : undefined), 500 + i * 700);
    window.BE.solo = true;
  }

  // ---------------------------------------------------------------- EYEs: every camera + the god view
  const EYES = [{ id: 'god', name: 'god view', god: true, cal: null }];
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  let cams = devs.filter(d => d.kind === 'videoinput');
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach(t => t.stop()); cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { }
  for (const d of cams.slice(0, 4)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; await v.play();
      EYES.push({ id: d.deviceId, name: (d.label || 'camera').replace(/\(.*?\)/g, '').trim().slice(0, 22), video: v, PW: v.videoWidth, PH: v.videoHeight, cal: JSON.parse(localStorage.getItem('be:cal:' + d.deviceId) || 'null'), fLock: 0, fSeen: [], smooth: null });
    } catch (e) { console.warn('camera', d.label, e.name); }
  }
  let cur = EYES.length > 1 ? 1 : 0, auto = false, autoT = 0, vertical = false;
  const strip = $('strip');
  EYES.forEach((E, i) => {
    const el = document.createElement('div'); el.className = 'th'; el.innerHTML = `<b>${i}</b><i>${E.name}</i>`;
    if (E.video) { const v = document.createElement('video'); v.muted = true; v.srcObject = E.video.srcObject; v.play(); el.prepend(v); }
    el.onclick = () => { cur = i; auto = false; }; strip.appendChild(el); E.el = el;
  });

  // ---------------------------------------------------------------- the paper → where this camera stands (+ which edge has the dots)
  const SW = 960, sc = document.createElement('canvas'), sx = sc.getContext('2d', { willReadFrequently: true });
  function look(E) {
    if (!E.video || E.video.readyState < 2) return;
    const sh = Math.round(SW * E.PH / E.PW); sc.width = SW; sc.height = sh; sx.drawImage(E.video, 0, 0, SW, sh);
    if (paperPose(sx.getImageData(0, 0, SW, sh), E)) localStorage.setItem('be:cal:' + E.id, JSON.stringify(E.cal));
  }
  let li = 0; setInterval(() => { const cams = EYES.filter(E => E.video); if (!cams.length) return; look(cams[li++ % cams.length]); }, 110);

  function useCal(E) {
    const { R, t, f } = E.cal;
    camera.fov = 2 * Math.atan(E.PH / 2 / f) * 180 / Math.PI; camera.aspect = E.PW / E.PH; camera.updateProjectionMatrix();
    const C = [0, 1, 2].map(j => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2]));
    const x = new V3(R[0][0], R[0][1], R[0][2]), y = new V3(-R[1][0], -R[1][1], -R[1][2]), z = new V3(-R[2][0], -R[2][1], -R[2][2]);
    camera.position.set(...C); camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)); camera.updateMatrixWorld();
  }
  // god view: drag = orbit, wheel = zoom
  let gy = .6, gp = .55, gd = .7, drag = null;
  out.addEventListener('pointerdown', e => { W.sfx.ctx(); drag = [e.clientX, e.clientY]; if (solo && !EYES[cur].god) W.dropFood(new V3((Math.random() - .5) * .15, .12, (Math.random() - .5) * .1)); });
  addEventListener('pointerup', () => drag = null);
  addEventListener('pointermove', e => { if (!drag || !EYES[cur].god) return; gy -= (e.clientX - drag[0]) * .006; gp = Math.max(.08, Math.min(1.45, gp + (e.clientY - drag[1]) * .005)); drag = [e.clientX, e.clientY]; });
  out.addEventListener('wheel', e => { gd = Math.max(.12, Math.min(3, gd * Math.exp(e.deltaY * .001))); });
  window.BE.god = (y, p, d, at) => { gy = y; gp = p; gd = d; if (at) godAt.fromArray(at); };
  const godAt = new V3(0, .02, 0);

  // ---------------------------------------------------------------- recording: the composed picture + the creatures' sounds
  let rec = null, chunks = [], recT = 0;
  function toggleRec() {
    W.sfx.ctx();
    if (rec) { rec.stop(); return; }
    const vs = out.captureStream(30), dest = W.sfx.c.createMediaStreamDestination(); W.sfx.out.connect(dest);
    const ms = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    rec = new MediaRecorder(ms, { mimeType: type, videoBitsPerSecond: 16e6 }); chunks = []; recT = performance.now();
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => { const blob = new Blob(chunks, { type }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `bUild eYes ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${type.includes('mp4') ? 'mp4' : 'webm'}`; a.click(); rec = null; W.sfx.out.disconnect(dest); };
    rec.start(500);
  }
  addEventListener('keydown', e => {
    if (e.key >= '0' && e.key <= '9' && +e.key < EYES.length) { cur = +e.key; auto = false; }
    else if (e.key === 'a' || e.key === 'A') auto = !auto;
    else if (e.key === 'r' || e.key === 'R') toggleRec();
    else if (e.key === 'f' || e.key === 'F') vertical = !vertical;
  });

  // ---------------------------------------------------------------- every frame: cut, compose, draw
  let prev = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min(.05, (now - prev) / 1000); prev = now;
    if (solo) W.step(now, dt); else W.puppetStep(now, dt);
    if (auto && (autoT -= dt) <= 0) { const ok = EYES.map((E, i) => i).filter(i => i !== cur && (EYES[i].god || EYES[i].seen)); if (ok.length) cur = ok[Math.random() * ok.length | 0]; autoT = 2.5 + Math.random() * 2.5; }
    const E = EYES[cur];
    const OW = vertical ? 1080 : 1920, OH = vertical ? 1920 : 1080; if (out.width !== OW) { out.width = OW; out.height = OH; }
    og.fillStyle = '#000'; og.fillRect(0, 0, OW, OH);
    let sw = OW, sh = OH, ox = 0, oy = 0;                       // "cover": crop the camera picture to the output shape
    if (E.video) {
      const s = Math.max(OW / E.PW, OH / E.PH); sw = E.PW * s; sh = E.PH * s; ox = (OW - sw) / 2; oy = (OH - sh) / 2;
      og.drawImage(E.video, ox, oy, sw, sh);
      if (E.cal) useCal(E);
      paper.visible = false; dots.forEach(d => d.visible = false);
    } else {
      camera.fov = 50; camera.aspect = OW / OH; camera.updateProjectionMatrix();
      camera.position.set(Math.sin(gy) * Math.cos(gp) * gd, Math.sin(gp) * gd, Math.cos(gy) * Math.cos(gp) * gd); camera.position.add(godAt); camera.lookAt(godAt);
      og.fillStyle = '#0b0b0d'; og.fillRect(0, 0, OW, OH); paper.visible = true; dots.forEach(d => d.visible = true);
    }
    if (E.god || E.cal) {
      renderer.setSize(Math.round(sw), Math.round(sh), false);
      renderer.render(scene, camera);
      og.drawImage(renderer.domElement, ox, oy, sw, sh);
    }
    EYES.forEach((x, i) => x.el.classList.toggle('on', i === cur));
    const age = (now - lastSnap) / 1000;
    $('keys').innerHTML = solo ? `HOST (no headset) · code <b style="color:#ffc23a;font-size:20px">${code}</b> · ${eyes} EYE${eyes === 1 ? '' : 's'} linked<br>EYE ${cur}: ${E.name}${E.video ? (E.seen ? ' · paper ✓' : ' · paper not seen') : ''}<br>1–9 cut · A auto-cut ${auto ? 'ON' : 'off'} · F ${vertical ? '9:16' : '16:9'} · R record ${rec ? `<span id="rec">● ${((now - recT) / 1000).toFixed(0)} s</span>` : ''} · click = food` : `${linked ? (age < 1 ? `linked to headset <b style="color:#ffc23a">${code}</b>` : 'linked · waiting for the world') : 'looking for headset ' + code}<br>EYE ${cur}: ${E.name}${E.video ? (E.seen ? ' · paper ✓' : ' · paper not seen') : ''}<br>1–9 cut · A auto-cut ${auto ? 'ON' : 'off'} · F ${vertical ? '9:16' : '16:9'} · R record ${rec ? `<span id="rec">● ${((now - recT) / 1000).toFixed(0)} s</span>` : ''}`;
  }
  frame();
}
