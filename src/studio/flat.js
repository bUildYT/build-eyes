// bUild sTudio · FLAT: the same studio on a PC (mouse / pen), tablet and phone (touch) — and the full VR world around you.
//  mouse: left = tool · right-drag = orbit · middle-drag = pan · wheel = zoom     touch: 1 finger = tool · 2 fingers = orbit + zoom (or tap ✋ = 1-finger orbit)
//  keys: Ctrl+Z / Ctrl+Y · 1–0 tools (1 clay 2 carve 3 smooth 4 flatten 5 grab 6 inflate 7 paint 8 fill 9 tube 0 move) · [ ] size · M mirror · F frame the work
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const V3 = THREE.Vector3;

// ---------------------------------------------------------------- the world you stand in (VR + flat): soft studio dome, floor, grid
export function createEnv(scene) {
  const g = new THREE.Group(); g.name = 'env';
  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = vP.y; vec3 top = vec3(.10,.105,.12), mid = vec3(.26,.25,.24), low = vec3(.07,.065,.06); vec3 c = h > 0. ? mix(mid, top, pow(h, .6)) : mix(mid, low, pow(-h, .4)); gl_FragColor = vec4(c, 1.); }',
  }));
  sky.renderOrder = -10; g.add(sky);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 64), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: .95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const grid = new THREE.GridHelper(16, 64, 0x55504a, 0x3a3734); grid.position.y = .002; grid.material.transparent = true; grid.material.opacity = .5; g.add(grid);
  const halo = new THREE.Mesh(new THREE.RingGeometry(.55, .6, 64), new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: .35 }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = .004; g.add(halo);
  scene.add(g); return g;
}

export function createFlat({ world, I, menu, root, objs, S, api }) {
  const cam = world.camera, dom = world.renderer.domElement;
  const F = { on: false, orbit1: false };
  const controls = new OrbitControls(cam, dom);
  controls.enableDamping = true; controls.dampingFactor = .12; controls.minDistance = .08; controls.maxDistance = 6;
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.enabled = false;
  F.controls = controls;

  // ---- HTML: palette (the very same canvas as in VR) + top bar + toast
  const ui = document.createElement('div'); ui.id = 'flatui'; ui.hidden = true;
  ui.innerHTML = `<style>
    #flatui { position: fixed; inset: 0; pointer-events: none; z-index: 4; font: 600 14px system-ui; color: #fff; }
    #flatui .pal { position: absolute; left: 10px; bottom: 10px; width: min(470px, 96vw); pointer-events: auto; touch-action: none; }
    #flatui .pal canvas { width: 100%; display: block; border-radius: 14px; box-shadow: 0 6px 30px #000a; }
    #flatui .pal.min canvas { display: none; }
    #flatui .bar { position: absolute; top: 10px; right: 10px; display: flex; gap: 8px; pointer-events: auto; flex-wrap: wrap; justify-content: flex-end; }
    #flatui button { appearance: none; border: 1px solid #ffffff40; background: #000a; color: #fff; font: 600 14px system-ui; padding: 9px 14px; border-radius: 20px; cursor: pointer; }
    #flatui button.on { border-color: #ffc23a; color: #ffc23a; }
    #flatui .tip { position: absolute; top: 12px; left: 12px; color: #fff9; font: 500 12px system-ui; max-width: 50vw; }
    @media (max-width: 760px) { #flatui .tip { display: none; } #flatui .bar { left: 6px; right: 6px; top: 6px; gap: 5px; justify-content: center; } #flatui button { padding: 7px 10px; font-size: 12px; } #flatui .pal { left: 4px; right: 4px; bottom: 4px; width: auto; } #flatui .pal canvas { width: min(100%, calc(44vh * 1.1636)); margin: 0 auto; } }
  </style>
  <div class="tip">left = ${'tool'} · right-drag = orbit · middle = pan · wheel = zoom · Ctrl+Z/Y · 1 clay 2 carve 3 smooth 4 flatten 5 grab 6 inflate 7 paint 8 fill 9 tube 0 move · [ ] size · M mirror · F frame<br>touch: 1 finger = tool · 2 fingers = orbit + zoom</div>
  <div class="bar"><button id="fPortal" hidden>📱 portal</button><button id="fOrbit">✋ 1-finger orbit</button><button id="fPal">palette</button><button id="fFrame">frame</button><button id="fGlb">⬇ .glb</button><button id="fReel">🎬 reel</button><button id="fVR">VR</button><button id="fMR">MR</button></div>
  <div class="pal" id="fPalBox"></div><div id="fToast" style="position:absolute;left:50%;top:14px;transform:translateX(-50%);background:#000b;padding:8px 16px;border-radius:18px;font:600 15px system-ui;opacity:0;transition:opacity .2s"></div>`;
  document.body.appendChild(ui);
  const palBox = ui.querySelector('#fPalBox');
  const pickPal = e => { const r = menu.canvas.getBoundingClientRect(); menu.pickPx((e.clientX - r.left) / r.width * menu.canvas.width, (e.clientY - r.top) / r.height * menu.canvas.height); e.preventDefault(); e.stopPropagation(); };
  ui.querySelector('#fPal').onclick = () => palBox.classList.toggle('min');
  ui.querySelector('#fOrbit').onclick = e => { F.orbit1 = !F.orbit1; e.target.classList.toggle('on', F.orbit1); controls.touches.ONE = F.orbit1 ? THREE.TOUCH.ROTATE : null; };
  ui.querySelector('#fFrame').onclick = () => { if (F.portal) portal(false); frame(); };
  // 📱 PORTAL: the phone is a window into the shared world — turn it and you look around (gyro); drag on empty space = walk.
  //  Everything the Quest / PC sculpts shows up live (same room link). iOS asks for motion permission on the first tap.
  const PT = { e: null, off: new THREE.Quaternion(), set: false }, euler = new THREE.Euler(), qa = new THREE.Quaternion(), q1 = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5)), zee = new V3(0, 0, 1);
  const onOri = e => { if (e.alpha != null) PT.e = e; };
  const devQ = (q, e) => { const o = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) || window.orientation || 0); euler.set(THREE.MathUtils.degToRad(e.beta), THREE.MathUtils.degToRad(e.alpha), -THREE.MathUtils.degToRad(e.gamma), 'YXZ'); q.setFromEuler(euler).multiply(q1).multiply(qa.setFromAxisAngle(zee, -o)); return q; };
  const yawOf = q => { const f = new V3(0, 0, -1).applyQuaternion(q); return Math.atan2(-f.x, -f.z); };
  async function portal(on) {
    if (on && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') { try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') { F.toast('portal needs motion access', 2); return; } } catch { return; } }
    F.portal = on; PT.set = false; ui.querySelector('#fPortal').classList.toggle('on', on); controls.enabled = !on;
    if (on) { addEventListener('deviceorientation', onOri); F.toast('portal: turn the phone to look around · drag empty space = walk', 2.5); }
    else { removeEventListener('deviceorientation', onOri); const f = new V3(0, 0, -1).applyQuaternion(cam.quaternion); controls.target.copy(cam.position).addScaledVector(f, Math.max(.2, cam.position.distanceTo(controls.target))); controls.update(); }
  }
  F.portalStep = () => {
    if (!F.portal || !PT.e) return; const q = devQ(new THREE.Quaternion(), PT.e);
    if (!PT.set) { PT.off.setFromAxisAngle(new V3(0, 1, 0), yawOf(cam.quaternion) - yawOf(q)); PT.set = true; }
    cam.quaternion.copy(PT.off).multiply(q); cam.updateMatrixWorld();
  };
  { const pb = ui.querySelector('#fPortal'); pb.hidden = !(matchMedia('(pointer: coarse)').matches && 'DeviceOrientationEvent' in window); pb.onclick = () => portal(!F.portal); }
  ui.querySelector('#fGlb').onclick = () => BE.downloadGLB();
  ui.querySelector('#fReel').onclick = () => F.reel();
  // 🎬 one click = a 360° turntable clip of your work (vertical 9:16 for reels), saved as a video
  F.reel = async (sec = 8) => {
    if (F.recording) return; F.recording = true;
    const dom2 = world.renderer.domElement, keep = { w: dom2.style.width, h: dom2.style.height, ui: ui.style.display };
    ui.style.display = 'none'; for (const c of CURS()) c.visible = false;
    const env = world.scene.getObjectByName('env'), envWas = env && env.visible; if (env) env.visible = false;   // black stage: the work glows on its own
    const bg = world.scene.background; world.scene.background = new THREE.Color(0x000000);
    const box = new THREE.Box3(); for (const o of objs) box.expandByObject(o);
    const c = box.isEmpty() ? controls.target.clone() : box.getCenter(new V3()), r = box.isEmpty() ? .3 : Math.max(.08, box.getSize(new V3()).length() * .62);
    const W0 = innerWidth, H0 = innerHeight, RW = 720, RH = 1280;
    world.renderer.setSize(RW, RH, false); cam.aspect = RW / RH; cam.updateProjectionMatrix();
    const mime = ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const stream = dom2.captureStream(60), rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 }), parts = [];
    rec.ondataavailable = e => e.data.size && parts.push(e.data);
    const done = new Promise(res => rec.onstop = res);
    controls.enabled = false; rec.start(250);
    const t0 = performance.now(), a0 = Math.atan2(cam.position.x - c.x, cam.position.z - c.z), el = .32;
    await new Promise(res => { (function spin() { const k = Math.min(1, (performance.now() - t0) / (sec * 1000)), a = a0 + k * Math.PI * 2, e = el + Math.sin(k * Math.PI * 2) * .08;
      cam.position.set(c.x + Math.sin(a) * Math.cos(e) * r * 2.1, c.y + Math.sin(e) * r * 2.1, c.z + Math.cos(a) * Math.cos(e) * r * 2.1); cam.lookAt(c);
      if (k < 1) requestAnimationFrame(spin); else res(); })(); });
    rec.stop(); await done;
    world.renderer.setSize(W0, H0, true); cam.aspect = W0 / H0; cam.updateProjectionMatrix(); controls.target.copy(c); controls.enabled = true; controls.update();
    ui.style.display = keep.ui; for (const cc of CURS()) cc.visible = true; F.recording = false; if (env) env.visible = envWas; world.scene.background = bg;
    const blob = new Blob(parts, { type: mime.split(';')[0] }), ext = mime.includes('mp4') ? 'mp4' : 'webm', name = 'bUild_reel_' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.' + ext;
    let saved = false; if (import.meta.env.DEV) { try { await fetch('/__q/video?name=' + name, { method: 'POST', body: blob }); F.toast('🎬 saved to Videos › bUild eYes › ' + name, 4); saved = true; } catch { } }
    if (!saved) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); F.toast('🎬 ' + name, 3); }
    F.lastReel = { name, bytes: blob.size, mime }; return F.lastReel;
  };
  const CURS = () => world.scene.children.filter(o => o.isGroup && o.children.some(c => c.isLine));
  ui.querySelector('#fVR').onclick = () => api.enter('vr');
  ui.querySelector('#fMR').onclick = () => api.enter('ar');

  // ---- start / stop
  F.start = () => {
    F.on = true; ui.hidden = false; controls.enabled = true;
    if (!palBox.contains(menu.canvas)) { palBox.appendChild(menu.canvas); menu.canvas.onpointerdown = pickPal; }
    root.position.set(0, 1, 0); root.quaternion.identity(); root.scale.setScalar(1);
    frame(); I.sim = { R: { pos: [0, -5, 0], trig: 0 } };
    menu.draw();
  };
  F.stop = () => { F.on = false; ui.hidden = true; controls.enabled = false; I.sim = null; };
  function frame() {
    const b = new THREE.Box3(); for (const o of objs) b.expandByObject(o);
    const c = b.isEmpty() ? root.localToWorld(new V3(0, .12, 0)) : b.getCenter(new V3()), r = b.isEmpty() ? .25 : Math.max(.12, b.getSize(new V3()).length() * .6);
    controls.target.copy(c); cam.position.copy(c).add(new V3(0, r * .45, r * 2.1)); cam.near = .005; cam.far = 80; cam.updateProjectionMatrix(); controls.update();
  }

  // ---- pointer → the R pointer of the studio (same tools as in VR)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane();
  let down = false, touches = new Map(), anchor = null;
  const SURF = { z: 1, texture: 1, clay: 1, carve: 1, paint: 1, erase: 1, move: 1, smooth: 1, flatten: 1, grab: 1, inflate: 1, fill: 1 };
  function aim(e) {
    const r = dom.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, cam);
    const dir = ray.ray.direction.clone(), quat = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, -1), dir);
    const hits = ray.intersectObjects(objs, true).filter(h => h.object.visible);
    let pos;
    const build = S.tool === 'clay' || S.tool === 'inflate';
    if (down && build && F.depth != null) {
      // building on a surface: follow the surface, but never climb onto the clay this stroke just laid
      const hd = hits[0] ? hits[0].distance : Infinity, lim = F.depth - S.size * 1.2;
      pos = ray.ray.at(hd < Infinity && hd >= lim ? hd : Math.min(hd, F.depth), new V3());
      if (hd < lim) pos = ray.ray.at(F.depth, new V3());
    } else if (SURF[S.tool] && hits[0] && !((S.tool === 'move' || S.tool === 'grab' || (S.tool === 'z' && (S.zb === 'move' || S.zb === 'snake'))) && down && anchor)) {   // Z Move / Smear: after the grab, slide on the view plane (never jump onto other parts)   // move: grab on the surface, then slide on a plane
      pos = hits[0].point.clone();
      if (S.tool === 'paint') pos.addScaledVector(dir, -.01);           // paint shoots a short ray from just above the surface
      anchor = pos.clone();
      if (down && build && F.depth == null) F.depth = hits[0].distance;
    } else {
      if (!down || !anchor) anchor = hits[0] ? hits[0].point.clone() : (() => { const t = root.localToWorld(new V3(0, .1, 0)); const p = new V3(); plane.setFromNormalAndCoplanarPoint(cam.getWorldDirection(new V3()), t); return ray.ray.intersectPlane(plane, p) || t; })();
      // mirror on + looking from the side: the stroke plane IS the mirror plane → spine, neck, tail stay on the centre line (no twin)
      if ((!down || !F.snapped) && S.mirror && anchor) { const ax = new V3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())), cd = cam.getWorldDirection(new V3());
        if (Math.abs(cd.dot(ax)) > .8) { const l = root.worldToLocal(anchor.clone()); l.x = 0; anchor = root.localToWorld(l); F.snapped = true; } }
      plane.setFromNormalAndCoplanarPoint(cam.getWorldDirection(new V3()).negate(), anchor);
      pos = ray.ray.intersectPlane(plane, new V3()) || anchor.clone();
      if (down && build && F.depth == null) F.depth = pos.distanceTo(ray.ray.origin);
    }
    return { pos, quat, hit: hits[0] || null };
  }
  const pressure = e => e.pointerType === 'pen' ? Math.max(.08, e.pressure || .5) : 1;
  dom.addEventListener('pointerdown', e => {
    if (!F.on) return; F.touched = true;
    touches.set(e.pointerId, e);
    if (e.pointerType === 'touch' && (touches.size > 1 || F.orbit1)) { down = false; I.sim.R = { ...I.sim.R, trig: 0 }; return; }
    if (e.button !== 0) return;
    if (S.tool === 'z') {   // ZBrush: press on the model = sculpt · press on empty space = turn around it · Alt = ZSub · Shift = smooth · Ctrl = mask
      S.zAlt = e.altKey; S.zShift = e.shiftKey; S.zCtrl = e.ctrlKey || e.metaKey;
      const a = aim(e); if (!(a.hit && a.hit.object.userData.z)) { orbiting = { x: e.clientX, y: e.clientY }; dom.setPointerCapture(e.pointerId); return; }
    }
    down = true; anchor = null; F.depth = null; F.snapped = false; dom.setPointerCapture(e.pointerId);
    const a = aim(e); I.sim.R = { pos: a.pos.toArray(), quat: a.quat.toArray(), trig: pressure(e) };
  });
  let orbiting = null; const sph = new THREE.Spherical();
  dom.addEventListener('pointermove', e => {
    if (!F.on) return; if (touches.has(e.pointerId)) touches.set(e.pointerId, e);
    if (orbiting && touches.size <= 1) {
      const dx = e.clientX - orbiting.x, dy = e.clientY - orbiting.y; orbiting.x = e.clientX; orbiting.y = e.clientY;
      if (F.portal) {   // portal: walk through the world (drag up = forward, sideways = step)
        const f = new V3(0, 0, -1).applyQuaternion(cam.quaternion), r = new V3(1, 0, 0).applyQuaternion(cam.quaternion), k = Math.max(.15, cam.position.distanceTo(controls.target)) * .004;
        cam.position.addScaledVector(f, -dy * k).addScaledVector(r, -dx * k); controls.target.addScaledVector(f, -dy * k).addScaledVector(r, -dx * k); return;
      }
      const off = cam.position.clone().sub(controls.target); sph.setFromVector3(off); sph.theta -= dx * .008; sph.phi = THREE.MathUtils.clamp(sph.phi - dy * .008, .05, Math.PI - .05);
      off.setFromSpherical(sph); cam.position.copy(controls.target).add(off); cam.lookAt(controls.target); return;
    }
    if (touches.size > 1) return;
    const a = aim(e); I.sim.R = { pos: a.pos.toArray(), quat: a.quat.toArray(), trig: down ? pressure(e) : 0 };
  });
  const up = e => { touches.delete(e.pointerId); orbiting = null; S.zAlt = S.zShift = S.zCtrl = false; if (!F.on || !down) return; down = false; F.depth = null; I.sim.R = { ...I.sim.R, trig: 0 }; };
  dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
  dom.addEventListener('contextmenu', e => e.preventDefault());
  dom.style.touchAction = 'none';

  // ---- keys
  const TOOLK = ['clay', 'carve', 'smooth', 'flatten', 'grab', 'inflate', 'paint', 'fill', 'tube', 'move'];
  addEventListener('keydown', e => {
    if (!F.on) return; const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? api.redo() : api.undo(); }
    else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); api.redo(); }
    else if (k >= '0' && k <= '9') api.setTool(TOOLK[(+k + 9) % 10]);
    else if (k === '[' || k === ']') { S.size = THREE.MathUtils.clamp(S.size * (k === ']' ? 1.35 : 1 / 1.35), .0015, .06); menu.draw(); }
    else if (k === 'm' || k === 'x') { S.mirror = !S.mirror; menu.draw(); F.toast && F.toast(S.mirror ? 'symmetry X on' : 'symmetry off', 1); }
    else if (k === 'f') frame();
  });
  let toastT = 0; F.toast = (t, sec = 2) => { const el = ui.querySelector('#fToast'); el.textContent = t; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => el.style.opacity = 0, sec * 1000); };
  F.step = () => {
    if (!F.on) return;
    if (!F.framed && objs.length) { F.framed = true; if (!F.touched) setTimeout(() => { if (!F.touched) frame(); }, 400); }   // a phone / PC that joins a room: centre on the sculpt once it arrives
    if (F.portal) F.portalStep(); else controls.update();
  };
  return F;
}
