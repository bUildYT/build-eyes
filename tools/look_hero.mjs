// node tools/look_hero.mjs "mechs&dragon" 1,5,9  → _work/look_<t>.png  (no XR: a desk + the actors)
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const [what = 'mechs&dragon', times = '1,4,8', camPos = '0,.35,.55'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1100, height: 700 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`https://localhost:8897/tools/look.html?${what}&cam=${camPos}&ly=${process.argv[5] || .06}${process.argv[6] ? "&follow=" + process.argv[6] : ""}`); await p.waitForFunction(() => window.L && L.ready, null, { timeout: 60000 });
let last = 0;
for (const t of times.split(',').map(Number)) { await p.evaluate(s => L.adv(s), t - last); last = t; const info = await p.evaluate(() => ({ mechs: L.M.list.map(m => `${m.team}:${m.act}:${m.hp}`), dragon: L.D && L.D.mode, bolts: L.M.bolts.length })); console.log(t, JSON.stringify(info)); await p.screenshot({ path: path.resolve(`_work/look_${t}.png`) }); }
console.log(errs.length ? 'ERRORS ' + errs.slice(0, 5).join(' | ') : 'no errors');
await b.close();
