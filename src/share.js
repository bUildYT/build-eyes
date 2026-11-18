// bUild eYes · SHARE: drop any sculpt export → it becomes a .glb in public/share → a QR per model → phones view it (orbit + AR on their table).
import './qr.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const BASE = (/^(localhost|127.)/.test(location.hostname) && __LAN__ ? __LAN__ : location.origin) + location.pathname.replace(/[^/]*$/, '');

if (q.get('m')) {                                    // ---------------- phone / viewer
  $('pc').style.display = 'none'; $('view').style.display = 'block';
  $('mv').src = './share/' + q.get('m').replace(/[^a-z0-9_.-]/gi, '');
  $('vt').textContent = 'bUild eYes · ' + q.get('m').replace(/\.glb$/, '');
  let lastT = 0;                                     // live: when the headset re-sends, the phone reloads the model
  setInterval(async () => { try { const m = (await (await fetch('/__q/models')).json()).find(x => x.name === q.get('m')); if (m && lastT && m.t !== lastT) $('mv').src = './share/' + m.name + '?t=' + m.t; if (m) lastT = m.t; } catch { } }, 3000);
} else {                                             // ---------------- PC / Quest: drop + list
  const msg = t => $('msg').textContent = t;
  const pickIn = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: '.glb,.gltf,.obj,.stl,.fbx,.ply' });
  $('drop').onclick = () => pickIn.click();
  pickIn.onchange = () => [...pickIn.files].forEach(send);
  addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('on'); });
  addEventListener('dragleave', () => $('drop').classList.remove('on'));
  addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('on'); [...e.dataTransfer.files].forEach(send); });

  async function toGLB(file) {
    const ext = file.name.split('.').pop().toLowerCase(), buf = await file.arrayBuffer();
    if (ext === 'glb') return buf;
    let obj;
    if (ext === 'gltf') obj = (await new GLTFLoader().parseAsync(new TextDecoder().decode(buf), '')).scene;
    else if (ext === 'obj') obj = new OBJLoader().parse(new TextDecoder().decode(buf));
    else if (ext === 'fbx') obj = new FBXLoader().parse(buf, '');
    else if (ext === 'stl' || ext === 'ply') {
      const g = ext === 'stl' ? new STLLoader().parse(buf) : new PLYLoader().parse(buf); g.computeVertexNormals();
      obj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: g.attributes.color ? 0xffffff : 0xd8c4a4, vertexColors: !!g.attributes.color, roughness: .6 }));
    } else throw new Error('unknown format .' + ext);
    obj.traverse(o => { if (o.isMesh && !o.material) o.material = new THREE.MeshStandardMaterial({ color: 0xd8c4a4 }); });
    // sit it on the floor at real-world-ish size: biggest side ≥ 5 cm, ≤ 1.5 m (exports come in mm, cm or m)
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), big = Math.max(size.x, size.y, size.z) || 1;
    let s = 1; if (big > 1.5) s = big > 150 ? .001 : .01; if (big * s > 1.5) s = .6 / big; if (big * s < .05) s = .3 / big;
    const g = new THREE.Group(); g.add(obj); obj.scale.multiplyScalar(s);
    const b2 = new THREE.Box3().setFromObject(g), c = b2.getCenter(new THREE.Vector3()); obj.position.sub(new THREE.Vector3(c.x, b2.min.y, c.z));
    return await new GLTFExporter().parseAsync(g, { binary: true });
  }
  async function send(file) {
    try {
      msg('converting ' + file.name + ' …');
      const glb = await toGLB(file);
      const name = file.name.replace(/\.[^.]+$/, '');
      msg('uploading …');
      await fetch('/__q/model?name=' + encodeURIComponent(name), { method: 'POST', body: glb });
      msg('✓ ' + name + ' shared'); list();
    } catch (e) { msg('✗ ' + file.name + ': ' + e.message); console.error(e); }
  }
  async function list() {
    const ms = await (await fetch('/__q/models')).json(), key = JSON.stringify(ms); if (key === list.k) return; list.k = key;
    $('list').innerHTML = ms.length ? '' : '<small style="padding:0 4px">no models yet</small>';
    for (const m of ms) {
      const link = BASE + 'share.html?m=' + encodeURIComponent(m.name);
      const d = document.createElement('div'); d.className = 'card';
      d.innerHTML = `<model-viewer src="./share/${m.name}?t=${m.t}" camera-controls auto-rotate shadow-intensity="1" environment-image="neutral"></model-viewer><div class="row"><div><div class="n">${m.name.replace(/\.glb$/, '')}</div><small>${m.mb} MB · click QR = big</small></div></div>`;
      const c = QR.canvas(link, 3); c.style.cssText = 'border-radius:6px;cursor:zoom-in;margin-left:auto'; c.title = link;
      c.onclick = () => { $('big').innerHTML = ''; const b = QR.canvas(link, 10); b.style.borderRadius = '12px'; const w = document.createElement('div'); w.append(b); w.insertAdjacentHTML('beforeend', `<div>📱 scan = see <b>${m.name.replace(/\.glb$/, '')}</b> · tap anywhere to close</div>`); $('big').append(w); $('big').classList.add('on'); };
      d.querySelector('.row').append(c); $('list').append(d);
    }
  }
  $('big').onclick = () => $('big').classList.remove('on');
  list(); setInterval(list, 8000);
}
