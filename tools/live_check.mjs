// the public link: does the start page load, show a code + version, and can a camera EYE start (PC host mode)?
import { chromium } from 'playwright';
import path from 'node:path';
const CH = path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe');
const URL = process.argv[2] || 'https://buildyt.github.io/build-eyes/';
const b = await chromium.launch({ executablePath: CH, headless: true, args: ['--use-angle=d3d11', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(URL); await p.waitForTimeout(6000);
console.log('start page:', JSON.stringify(await p.evaluate(() => ({ ver: document.getElementById('ver').textContent, code: document.getElementById('code').textContent, go: document.getElementById('go').textContent }))));
await p.goto(URL + '?role=pc&solo'); await p.waitForFunction(() => window.BE && BE.W && BE.W.monsters.length >= 3, null, { timeout: 30000 }).catch(() => {});
console.log('PC host mode:', await p.evaluate(() => window.BE && BE.W ? BE.W.monsters.map(m => m.mem.kind || 'beetle').join(', ') : 'none'));
await p.keyboard.press('0'); await p.waitForTimeout(800); await p.screenshot({ path: '_work/live.png' });
console.log(errs.length ? 'errors: ' + errs.slice(0, 5).join(' | ') : 'no errors');
await b.close();
