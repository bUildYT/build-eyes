// bUild eYes · DEV HUB (vite plugin, dev server only): the headset/phone page reports to this PC, Claude reads + drives it.
//  page → POST /__q/log  /__q/state  /__q/shot  /__q/res       Claude → node tools/q.mjs  (state | log | shot | eval "js" | reload)
//  everything lands in _work/quest/ (log.txt, state_<who>.json, shot_<who>.png, res_<id>.json)
import fs from 'node:fs';
import path from 'node:path';

export function devHub() {
  const DIR = path.resolve('_work/quest'); fs.mkdirSync(DIR, { recursive: true });
  const queue = new Map();           // who → [cmd]
  const waiters = new Map();         // who → res (long poll)
  const seen = new Map();            // who → last contact ms
  const body = req => new Promise(r => { let b = ''; req.setEncoding('utf8'); req.on('data', c => b += c); req.on('end', () => r(b)); });
  const json = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const push = (who, cmd) => {
    const targets = who === '*' ? [...seen.keys()] : [who];
    for (const w of targets) {
      const wt = waiters.get(w);
      if (wt) { waiters.delete(w); json(wt, [cmd]); } else { if (!queue.has(w)) queue.set(w, []); queue.get(w).push(cmd); }
    }
    return targets;
  };
  // ---------------------------------------------------------------- BLENDER BRIDGE: two event lanes (to 'web' = the studio, to 'bl' = Blender)
  //  POST /__q/bl/push?to=web|bl&kind=K[&file=name]   body = JSON event, or the raw bytes of a file (saved in public/share/bl/)
  //  GET  /__q/bl/pull?to=web|bl&since=N              long poll (15 s) → { n, events: [...] }   · GET /__q/bl/status
  //  transforms ('xf') are coalesced: only the newest per object id waits in the lane
  const BL = { web: [], bl: [], n: 0, waiting: { web: new Set(), bl: new Set() }, seen: { web: 0, bl: 0 } };
  const BLDIR = path.resolve('public/share/bl'); fs.mkdirSync(BLDIR, { recursive: true });
  const blAdd = (to, ev) => {
    ev.n = ++BL.n; ev.t = Date.now();
    const lane = BL[to];
    if (ev.kind === 'xf' || ev.kind === 'cam') { const i = lane.findIndex(e => e.kind === ev.kind && e.id === ev.id); if (i >= 0) lane.splice(i, 1); }
    lane.push(ev); if (lane.length > 400) lane.splice(0, lane.length - 400);
    for (const w of BL.waiting[to]) { w(); } BL.waiting[to].clear();
  };
  const blPull = (to, since, res) => {
    BL.seen[to] = Date.now();
    const out = () => json(res, { n: BL.n, events: BL[to].filter(e => e.n > since) });
    if (BL[to].some(e => e.n > since)) return out();
    let done = false; const fin = () => { if (done) return; done = true; BL.waiting[to].delete(fin); out(); };
    BL.waiting[to].add(fin); setTimeout(fin, 15000); res.on('close', () => { done = true; BL.waiting[to].delete(fin); });
  };
  return {
    name: 'be-devhub',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__q/')) return next();
        if (req.url.startsWith('/__q/bl/')) {
          const u = new URL(req.url, 'https://x'), kind = u.pathname.slice(8), to = u.searchParams.get('to') === 'bl' ? 'bl' : 'web';
          try {
            if (kind === 'status') return json(res, { blender: BL.seen.bl ? Math.round((Date.now() - BL.seen.bl) / 1000) : null, web: BL.seen.web ? Math.round((Date.now() - BL.seen.web) / 1000) : null, n: BL.n });
            if (kind === 'pull') return blPull(to, +(u.searchParams.get('since') || 0), res);
            if (kind === 'push') {
              const file = (u.searchParams.get('file') || '').replace(/[^a-z0-9_.-]/gi, '_').slice(0, 90);
              if (file) {   // raw bytes → a file both sides can fetch
                const f = path.join(BLDIR, file), out = fs.createWriteStream(f); req.pipe(out);
                out.on('finish', () => json(res, { ok: 1, url: './share/bl/' + file, file })); return;
              }
              const ev = JSON.parse(await body(req)); blAdd(to, ev); return json(res, { ok: 1, n: ev.n });
            }
          } catch (e) { res.statusCode = 500; return json(res, { err: String(e) }); }
          return next();
        }
        const u = new URL(req.url, 'https://x'), who = (u.searchParams.get('who') || 'page').replace(/[^a-z0-9_-]/gi, '');
        const kind = u.pathname.slice(5);
        if (kind !== 'send' && kind !== 'who') seen.set(who, Date.now());
        try {
          if (kind === 'log') { const lines = JSON.parse(await body(req)); fs.appendFileSync(path.join(DIR, 'log.txt'), lines.map(l => `${new Date(l.t).toISOString().slice(11, 23)} ${who} ${l.lvl.padEnd(5)} ${l.msg}\n`).join('')); return json(res, { ok: 1 }); }
          if (kind === 'state') { fs.writeFileSync(path.join(DIR, `state_${who}.json`), await body(req)); return json(res, { ok: 1 }); }
          if (kind === 'shot') { const d = await body(req); fs.writeFileSync(path.join(DIR, `shot_${who}.png`), Buffer.from(d.replace(/^data:image\/\w+;base64,/, ''), 'base64')); return json(res, { ok: 1 }); }
          if (kind === 'video') {   // the PC recorder page streams its takes straight into Videos/bUild eYes
            const VD = path.join(process.env.USERPROFILE || '.', 'Videos', 'bUild eYes'); fs.mkdirSync(VD, { recursive: true });
            const f = path.join(VD, (u.searchParams.get('name') || 'take.mp4').replace(/[^a-z0-9_.-]/gi, '_'));
            const out = fs.createWriteStream(f, { flags: u.searchParams.get('append') ? 'a' : 'w' }); req.pipe(out); out.on('finish', () => json(res, { ok: 1, file: f })); return;
          }
          if (kind === 'model') {   // share page: a sculpt (as .glb) lands in public/share → phones load it by QR
            const SD = path.resolve('public/share'); fs.mkdirSync(SD, { recursive: true });
            const name = (u.searchParams.get('name') || 'model').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60) + '.glb';
            const out = fs.createWriteStream(path.join(SD, name)); req.pipe(out); out.on('finish', () => json(res, { ok: 1, name })); return;
          }
          if (kind === 'studio-save') {   // bUild sTudio: the whole scene (recipes + paint) → _work/studio/scene.json (+ a rolling backup)
            const SD = path.resolve('_work/studio'); fs.mkdirSync(SD, { recursive: true });
            const f = path.join(SD, 'scene.json'); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(SD, `backup_${new Date().getHours()}.json`));
            const out = fs.createWriteStream(f); req.pipe(out); out.on('finish', () => json(res, { ok: 1 })); return;
          }
          if (kind === 'studio-load') {
            const f = path.resolve('_work/studio/scene.json'); if (!fs.existsSync(f)) return json(res, null);
            res.setHeader('content-type', 'application/json'); return fs.createReadStream(f).pipe(res);
          }
          if (kind === 'models') {
            const SD = path.resolve('public/share'); fs.mkdirSync(SD, { recursive: true });
            return json(res, fs.readdirSync(SD).filter(f => f.endsWith('.glb')).map(f => ({ name: f, t: fs.statSync(path.join(SD, f)).mtimeMs, mb: +(fs.statSync(path.join(SD, f)).size / 1e6).toFixed(1) })).sort((a, b) => b.t - a.t));
          }
          if (kind === 'res') { const r = JSON.parse(await body(req)); fs.writeFileSync(path.join(DIR, `res_${r.id}.json`), JSON.stringify(r, null, 1)); return json(res, { ok: 1 }); }
          if (kind === 'cmd') {   // long poll: the page waits here for Claude's next command
            const q = queue.get(who); if (q && q.length) { queue.set(who, []); return json(res, q); }
            const old = waiters.get(who); if (old) json(old, []);
            waiters.set(who, res); const t = setTimeout(() => { if (waiters.get(who) === res) { waiters.delete(who); json(res, []); } }, 20000);
            res.on('close', () => { clearTimeout(t); if (waiters.get(who) === res) waiters.delete(who); });
            return;
          }
          if (kind === 'send') { const cmd = JSON.parse(await body(req)); return json(res, { sent: push(u.searchParams.get('to') || '*', cmd) }); }
          if (kind === 'who') return json(res, Object.fromEntries([...seen].map(([k, v]) => [k, Math.round((Date.now() - v) / 1000) + ' s ago'])));
        } catch (e) { res.statusCode = 500; return json(res, { err: String(e) }); }
        next();
      });
    },
  };
}
