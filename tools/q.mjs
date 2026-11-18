// Claude's remote control for the headset page (needs `npm run dev` + the Quest on https://<pc-ip>:8897).
//  node tools/q.mjs who                 → which pages are connected
//  node tools/q.mjs state [who]         → latest heartbeat
//  node tools/q.mjs log [n]             → last n log lines
//  node tools/q.mjs shot [who]          → saves _work/quest/shot_<who>.png (virtual layer from the eye)
//  node tools/q.mjs eval "return BE.W.monsters.length" [who]
//  node tools/q.mjs reload [who]
import fs from 'node:fs';
import path from 'node:path';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const DIR = path.resolve('_work/quest'), BASE = 'https://localhost:8897/__q/';
const [cmd = 'who', a1, a2] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const send = async (to, c) => (await fetch(BASE + 'send?to=' + (to || '*'), { method: 'POST', body: JSON.stringify(c) })).json();
async function result(id, ms = 15000) {
  const f = path.join(DIR, `res_${id}.json`);
  for (let t = 0; t < ms; t += 150) { if (fs.existsSync(f)) { const r = fs.readFileSync(f, 'utf8'); fs.unlinkSync(f); return JSON.parse(r); } await sleep(150); }
  return { err: 'no answer (page asleep? headset off?)' };
}
const id = Date.now().toString(36);
if (cmd === 'who') console.log(await (await fetch(BASE + 'who')).json());
else if (cmd === 'state') { for (const f of fs.readdirSync(DIR).filter(f => f.startsWith('state_') && (!a1 || f === `state_${a1}.json`))) console.log(f, fs.readFileSync(path.join(DIR, f), 'utf8')); }
else if (cmd === 'log') { const L = fs.existsSync(path.join(DIR, 'log.txt')) ? fs.readFileSync(path.join(DIR, 'log.txt'), 'utf8').trim().split('\n') : []; console.log(L.slice(-(+a1 || 40)).join('\n')); }
else if (cmd === 'shot') { const who = a1 || 'quest', f = path.join(DIR, `shot_${who}.png`), t0 = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0; console.log(await send(who, { id, js: 'return BE.shot()' }), (await result(id))); for (let t = 0; t < 8000 && (!fs.existsSync(f) || fs.statSync(f).mtimeMs === t0); t += 200) await sleep(200); console.log(fs.existsSync(f) && fs.statSync(f).mtimeMs !== t0 ? 'saved ' + f : 'no new shot'); }
else if (cmd === 'eval') { console.log(await send(a2, { id, js: a1 })); console.log(JSON.stringify(await result(id), null, 1)); }
else if (cmd === 'reload') console.log(await send(a1, { id, reload: 1 }));
else console.log('commands: who | state [who] | log [n] | shot [who] | eval "js" [who] | reload [who]');
