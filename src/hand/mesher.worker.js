import { meshBlock } from './mesher.js';
self.onmessage = e => {
  const j = e.data, g = meshBlock(j), tr = [j.d.buffer, j.col.buffer, j.rm.buffer];
  if (g) for (const k in g) tr.push(g[k].buffer);
  self.postMessage({ k: j.k, g, d: j.d, col: j.col, rm: j.rm }, tr);
};
