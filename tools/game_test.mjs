// emulator: place the table, switch to BUILD, pinch-draw a ring of clay with the right hand, carve with the left, screenshot from the eye
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const browser = await chromium.launch({ executablePath: CH, headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
await page.goto('https://localhost:8897/?role=host&who=game', { waitUntil: 'load' });
await page.waitForFunction(() => window.IWER_DEVICE && !document.getElementById('go').disabled, null, { timeout: 60000 });
await page.evaluate(() => { IWER_DEVICE.primaryInputMode = 'hand'; localStorage.removeItem('be:clay'); });
await page.click('#go');
await page.waitForFunction(() => BE.world && BE.world.session && BE.hands, null, { timeout: 30000 });
await sleep(2500);
const tbl = (await page.evaluate(() => BE.planes || [])).filter(p => (p.o || '').toLowerCase() === 'horizontal' && p.y > .3 && p.y < 1.3)[0];
const [px, py, pz] = [tbl.x, tbl.y, tbl.z];
await page.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x, y: y + .5, z: z + .5 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y: y + .08, z } }); }, [px, py, pz]);
const hand = (dev, [x, y, z], anchor = 'index-tip') => page.evaluate(([dev, x, y, z, anchor]) => IWER_DEVICE.remote.dispatch('set_transform', { device: dev, position: { x, y, z }, anchor, orientation: 'auto' }), [dev, x, y, z, anchor]);
// park the left hand away, touch + wait = solo table
await hand('hand-left', [px - .4, py + .3, pz + .2]);
for (const cx of [px - .1485, px + .1485]) { await hand('hand-right', [cx, py + .08, pz + .05]); await sleep(500); await hand('hand-right', [cx, py + .007, pz + .05]); await sleep(1800); await hand('hand-right', [cx, py + .08, pz + .05]); await sleep(400); }
await page.waitForFunction(() => BE.placed, null, { timeout: 20000 }).catch(() => {});
ok(await page.evaluate(() => BE.placed), 'table placed');
await hand('hand-right', [px + .5, py + .1, pz + .4]); await hand('hand-left', [px - .5, py + .1, pz + .4]);
await page.evaluate(async ([x, y, z]) => { await IWER_DEVICE.remote.dispatch('set_transform', { device: 'headset', position: { x: x + .05, y: y + .3, z: z + .42 } }); await IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y: y + .07, z } }); }, [px, py, pz]);
// scripted builds: a stroke = [colour, [[x,y,z,r], ...]]
const line = (a, b, n, r, c) => ({ c, sub: false, b: Array.from({ length: n }, (_, i) => { const k = i / (n - 1); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, r]; }) });
const wall = (x, z0, z1, h, c) => Array.from({ length: Math.ceil(h / .016) }, (_, k) => line([x, .008 + k * .016, z0], [x, .008 + k * .016, z1], 14, .012, c));
const BUILDS = {
  bridge: [line([-.08, .072, -.035], [.08, .072, -.035], 18, .011, '#7a5232'), line([-.08, .072, 0], [.08, .072, 0], 18, .011, '#e8d6b8'), line([-.08, .072, .035], [.08, .072, .035], 18, .011, '#7a5232')],
  glider: [line([0, .1, -.1], [0, .1, .1], 22, .008, '#3a8bff'), line([-.035, .1, 0], [.035, .1, 0], 8, .009, '#f2f2f2'), line([-.03, .108, -.03], [-.03, .108, .03], 6, .006, '#ff5a3c')],
  dragon: wall(.06, -.11, .11, .09, '#75685a'),
  arena: wall(-.075, -.06, .06, .06, '#2a2a2e'),
  lava: Array.from({ length: 12 }, (_, k) => line([-.01, .008 + k * .014, 0], [.01, .008 + k * .014, 0], 3, .016, k % 2 ? '#ffc23a' : '#e8d6b8')),
};
const results = {};
for (const [i, id] of [[0, 'bridge'], [1, 'glider'], [2, 'dragon'], [3, 'arena'], [4, 'lava']]) {
  for (const built of [true, false]) {
    if (!built && (id === 'glider')) continue;
    await page.evaluate(i => BE.game.start(i), i);
    await page.evaluate(b => { if (b) { BE.clay.set(b); BE.clay.save(); } }, built ? BUILDS[id] : (id === 'arena' ? null : [line([.15, .005, .15], [.16, .005, .15], 2, .006, '#fff')]));
    await sleep(500);
    if (built && id === 'bridge') { await page.evaluate(() => BE.shot(1100)); await sleep(800); require_copy('build_bridge'); }
    await page.evaluate(() => BE.game.test());
    const t0 = Date.now();
    await page.waitForFunction(() => BE.game.phase === 'score', null, { timeout: 120000 }).catch(() => {});
    const sc = await page.evaluate(() => BE.game.score);
    results[id + (built ? '' : '_empty')] = sc;
    console.log('  ', id.padEnd(7), built ? 'BUILT' : 'empty', JSON.stringify(sc), ((Date.now() - t0) / 1000).toFixed(0) + 's');
    if (built) { await page.evaluate(() => BE.shot(1100)); await sleep(800); require_copy('score_' + id); }
  }
}
function require_copy(n) { try { fs.copyFileSync(path.resolve('_work/quest/shot_quest-game.png'), path.resolve('_work/game_' + n + '.png')); } catch {} }
for (const id of ['bridge', 'dragon', 'lava']) ok(results[id] && results[id + '_empty'] && results[id].total > results[id + '_empty'].total + 15, id + ': a real build scores clearly higher than nothing (' + (results[id] && results[id].total) + ' vs ' + (results[id + '_empty'] && results[id + '_empty'].total) + ')');
ok(results.arena && results.arena_empty && results.arena.total >= results.arena_empty.total, 'arena: cover helps gold (' + (results.arena && results.arena.total) + ' vs ' + (results.arena_empty && results.arena_empty.total) + ')');
ok(results.glider && results.glider.total > 0, 'glider flew and scored ' + (results.glider && results.glider.total));
ok(!errs.length, 'no page errors ' + errs.slice(0, 3).join(' | '));
await browser.close();
