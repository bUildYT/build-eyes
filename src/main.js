// bUild eYes — start page: the headset hosts the world, phones join as EYEs, computers/tablets turn their cameras into EYEs.
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const isQuest = /OculusBrowser|Quest/i.test(navigator.userAgent);
const isPhone = !isQuest && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
window.BE = { q, isQuest, version: __VERSION__ };
import './qr.js';
// one address for every device: on this PC it is the LAN address (the phones + the headset reach it), online it is the page itself
window.BE.base = /^(localhost|127.)/.test(location.hostname) && __LAN__ ? __LAN__ : location.origin + location.pathname.replace(/index.html$/, '');
window.BE.qr = (url, px = 4) => { const c = QR.canvas(url, px); c.style.cssText = 'display:block;border-radius:8px'; return c; };
document.getElementById('ver').textContent = 'v' + __VERSION__;
const want = q.get('role') || (isQuest ? 'host' : '');
if (want === 'eye' || isPhone) $('hostBox').style.order = 2;
if (q.get('eye')) $('join').value = q.get('eye').toUpperCase();
$('join').oninput = () => { $('join').value = $('join').value.toUpperCase().replace(/[^A-Z]/g, ''); };
const arP = navigator.xr ? navigator.xr.isSessionSupported('immersive-ar').catch(() => false) : Promise.resolve(false);
const codeOk = () => { const c = $('join').value.trim(); if (c.length !== 4) { $('info').textContent = 'type the 4-letter code the headset shows'; return null; } return c; };
let host = null;

// buttons work at once (the headset part, Meta's IWSDK, loads in the background)
$('goEye').onclick = async () => {
  const code = codeOk(); if (!code) return;
  if (!await arP) { $('info').textContent = 'this browser has no AR camera mode (use Chrome on an Android phone)'; return; }
  if (host) host.stop();
  (await import('./eye.js')).start(code);
};
$('goCam').onclick = async () => {
  const code = codeOk(); if (!code) return;
  if (host) host.stop();
  (await import('./director.js')).start(code);
};

(async () => {
  const ar = await arP;
  if (want === 'pc' && q.get('eye')) { (await import('./director.js')).start(q.get('eye').toUpperCase()); return; }
  if (want === 'pc' && q.has('solo')) { (await import('./director.js')).start(null, { solo: true }); return; }
  if (want === 'pc') { $('hostBox').hidden = true; $('info').textContent = 'type the code your headset shows, then Camera EYEs'; return; }
  if (want === 'eye' || isPhone) { $('go').textContent = 'headset only'; $('go').disabled = true; return; }
  host = await import('./host.js');
  host.prepare({ ar });
})();
