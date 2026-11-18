import { chromium } from 'playwright'; import path from 'node:path';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/404/.test(m.text()) && errs.push(m.text()));
await p.goto('https://localhost:8897/tools/painter_board.html'); await p.waitForFunction(() => window.BOARD, null, { timeout: 120000 }).catch(() => console.log('TIMEOUT', errs));
await p.waitForTimeout(800); await p.screenshot({ path: '_work/painter_board.png' }); console.log('errors', errs.length ? errs : 'none'); await b.close();
