// PAINTER engine: unwrap + bake + smart materials + brush + composite → screenshot + pixel checks
import { chromium } from 'playwright'; import path from 'node:path';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) process.exitCode = 1; };
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1200, height: 700 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if ((m.type() === 'error' && !/404/.test(m.text())) || /GL_INVALID|WebGL:/.test(m.text())) errs.push(m.text()); });
await p.goto('https://localhost:8897/tools/painter_lab.html?still' + (process.argv[2] ? '&' + process.argv[2] : ''));
await p.waitForFunction(() => window.LAB && LAB.res, null, { timeout: 90000 }).catch(e => { console.log('TIMEOUT', errs.slice(0, 8)); process.exit(1); });
const res = await p.evaluate(() => LAB.res); console.log(JSON.stringify(res));
ok(res.A.usable && res.B.usable, 'unwrapped UVs have no overlaps');
ok(res.gl === 0, 'no GL errors');
// pixels: the exported maps must contain real variation
const st = await p.evaluate(() => { const out = {}; for (const [k, ts] of [['A', LAB.A.ts], ['B', LAB.B.ts]]) { const m = ts.maps(); const s = {}; for (const [n, cv] of Object.entries(m)) { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let mn = [255, 255, 255], mx = [0, 0, 0]; for (let i = 0; i < d.length; i += 4 * 97) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], d[i + c]); mx[c] = Math.max(mx[c], d[i + c]); } s[n] = { mn, mx }; } out[k] = s; } return out; });
console.log(JSON.stringify(st));
ok(st.A.baseColor.mx[0] - st.A.baseColor.mn[0] > 60, 'knot colour varies (rust + iron + gold)');
ok(st.A.orm.mx[2] > 200 && st.A.orm.mn[2] < 80, 'knot metal map has metal and non-metal');
ok(st.B.normal.mn[0] < 110 || st.B.normal.mx[0] > 145, 'box normal map got the carved line');
ok(st.A.orm.mn[0] < 200, 'AO darkens the knot crossings');
await p.waitForTimeout(500); await p.screenshot({ path: '_work/painter_lab.png' });
console.log('errors:', errs.length ? errs.slice(0, 6) : 'none'); if (errs.length) process.exitCode = 1;
await b.close();
