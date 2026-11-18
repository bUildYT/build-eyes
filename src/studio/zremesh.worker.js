// bUild sTudio · DynaMesh in a Web Worker: the headset / PC keeps rendering at full fps while the voxels are rebuilt
import { remeshCore } from './zremesh.js';
self.onmessage = e => {
  const { id, job } = e.data; let r = null, err = null;
  try { r = remeshCore(job); } catch (x) { err = String(x && x.stack || x); }
  if (!r) return self.postMessage({ id, r: null, err });
  const tr = [r.pos.buffer, r.idx.buffer, r.paint.buffer, r.mask.buffer]; if (r.col) tr.push(r.col.buffer);
  self.postMessage({ id, r }, tr);
};
