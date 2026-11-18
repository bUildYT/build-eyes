// bUild sTudio · Z LOOK: a quick real sculpt (face block-out across the symmetry seam) → screenshots from 3 sides
import { chromium } from 'playwright';
import path from 'node:path';
const b = await chromium.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--ignore-certificate-errors', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('https://localhost:8897/studio.html?flat&who=look&room=L' + Math.random().toString(36).slice(2, 7).toUpperCase());
await p.waitForFunction(() => window.BE && BE.zf, null, { timeout: 60000 }); await p.waitForTimeout(2500);
await p.evaluate(() => { for (const o of [...BE.objs]) BE.removeObj(o); Object.assign(BE.S, { mirror: true, zStroke: 'free', zAlpha: 'none', zInt: .45, zFoc: 0, zLazy: .2, zSub: false, size: .01, brushOpen: false, layersOpen: false }); BE.setTool('z'); });
await p.keyboard.press('f'); await p.waitForTimeout(600);
await p.evaluate(() => { document.querySelector('#fPalBox').style.display = 'none'; });
const S = o => p.evaluate(o => Object.assign(BE.S, o), o);
const drag = async (pts, steps = 16, mods = []) => { for (const k of mods) await p.keyboard.down(k); await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps }); await p.mouse.up(); for (const k of mods) await p.keyboard.up(k); await p.waitForTimeout(120); };
const cx = 700, cy = 500;
// brow ridge across the seam (ClayBuildup), nose (Standard down the middle), eye sockets (Clay ZSub), mouth (DamStandard across), cheeks (Inflate), chin (Move), smooth pass
await S({ zb: 'buildup', size: .012 }); for (let k = 0; k < 2; k++) await drag([[cx - 150, cy - 70], [cx - 60, cy - 95], [cx, cy - 90], [cx + 60, cy - 95], [cx + 150, cy - 70]]);
await S({ zb: 'standard', size: .011 }); for (let k = 0; k < 3; k++) await drag([[cx, cy - 80], [cx, cy - 20], [cx, cy + 30]]);
await S({ zb: 'clay', size: .013, zSub: true }); for (let k = 0; k < 2; k++) await drag([[cx - 110, cy - 40], [cx - 70, cy - 30], [cx - 40, cy - 45]]); await S({ zSub: false });
await S({ zb: 'dam', size: .009 }); await drag([[cx - 90, cy + 90], [cx - 30, cy + 100], [cx, cy + 102], [cx + 30, cy + 100], [cx + 90, cy + 90]]);
await S({ zb: 'inflate', size: .016 }); await drag([[cx - 130, cy + 30], [cx - 100, cy + 60]]);
await S({ zb: 'move', size: .02 }); await drag([[cx, cy + 160], [cx, cy + 185]], 8);
await S({ zb: 'standard', zStroke: 'rect', zAlpha: 'wrinkles', size: .01, zInt: .3 }); await drag([[cx - 80, cy - 140], [cx - 20, cy - 140]], 8);
await S({ zb: 'standard', zStroke: 'spray', zAlpha: 'pores', size: .006, zInt: .25 }); await drag([[cx - 140, cy + 10], [cx - 160, cy + 60], [cx - 120, cy + 120]], 24);
await S({ zStroke: 'free', zAlpha: 'none' });
await p.screenshot({ path: '_work/z_look_front.png' });
for (const [nm, a] of [['side', 1.0], ['three', -0.6]]) {
  await p.evaluate(a => { const c = BE.world.camera, t = BE.flat.controls.target, off = c.position.clone().sub(t); off.applyAxisAngle(new BE.world.camera.up.constructor(0, 1, 0), a); c.position.copy(t).add(off); c.lookAt(t); BE.flat.controls.update(); }, a);
  await p.waitForTimeout(300); await p.screenshot({ path: `_work/z_look_${nm}.png` });
}
console.log('errors:', errs.length ? errs : 'none');
await b.close();
