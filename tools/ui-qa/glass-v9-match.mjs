// مسار عدسة Glass: نموذج v9 المعتمد مقابل التطبيق، بنفس الهندسة والمدخلات، مقارنة بالزمن بعد محاذاة بدء الحركة.
// الخطة 0.1: الفرق لا يتجاوز 1px حين لا تسقط إطارات. MW=438 يجعل شريط النموذج 366px كالتطبيق عند 390.
// MW=438 node tools/ui-qa/glass-v9-match.mjs
const { chromium } = await import(process.env.VANTARA_PLAYWRIGHT_MODULE);
const { launch, sleep } = await import('./rig.mjs');
const record = (sel) => `(() => { window.__s = []; window.__t0 = 0; document.addEventListener('pointerdown', () => { window.__t0 = performance.now(); }, { capture: true, once: true }); const d = document.querySelector('${sel}'); const t = (ts) => { const cs = d.style; window.__s.push([ts, ...['--lx','--lw','--lh'].map((k) => +parseFloat(cs.getPropertyValue(k)).toFixed(2))]); if (window.__s.length < 90) requestAnimationFrame(t); }; requestAnimationFrame(t); })()`;
async function run(p, sel, navSel) {
  const c = async (pg) => { const b = await p.locator(navSel(pg)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const [hx, hy] = await c('home'), [mx] = await c('majlis');
  await p.evaluate(record(sel)); await p.mouse.move(mx, hy); await p.mouse.down(); await new Promise((r) => setTimeout(r, 70)); await p.mouse.up(); await new Promise((r) => setTimeout(r, 1400));
  const tap = await p.evaluate(() => window.__s.filter((r) => r[0] >= window.__t0).map(([t, x, w, h]) => [t - window.__t0, x, w, h]));
  return { tap };
}
// النموذج
const b = await chromium.launch({ executablePath: process.env.VANTARA_CHROMIUM });
const p = await b.newPage({ viewport: { width: Number(process.env.MW || 422), height: 900 }, deviceScaleFactor: 1, hasTouch: false });
await p.goto('file://' + new URL('../../docs/audits/glass/vantara-dock-glass.html', import.meta.url).pathname); await p.waitForTimeout(900);
const model = await run(p, '.lens', (pg) => `.nav[data-page=${pg}]`);
await b.close();
// التطبيق
const h = await launch({ section: 'cinema', viewport: { width: 390, height: 844 }, mobile: false, net: 'fixture', appearance: { material: 'glass' } });
await sleep(1800);
const app = await run(h.page, '#bottomNav .g-lens', (pg) => `#bottomNav .nav[data-page=${pg}]`);
await h.close();
// مقارنة بالزمن بعد محاذاة لحظة بدء الحركة: أول إطار تتحرك فيه العدسة (توقيت الإدخال لا يُحتسب)
const onset = (ser) => ser.find((r) => Math.abs(r[1] - ser[0][1]) > 0.5 || Math.abs(r[2] - ser[0][2]) > 0.5)?.[0] ?? 0;
const shift = onset(model.tap) - onset(app.tap);
const appS = app.tap.map(([t, ...r]) => [t + shift, ...r]);
const at = (ser, t, i) => { for (let k = 1; k < ser.length; k++) if (ser[k][0] >= t) { const [t0, ...a0] = ser[k - 1], [t1, ...a1] = ser[k]; const f = (t - t0) / (t1 - t0 || 1); return a0[i] + (a1[i] - a0[i]) * f; } return ser.at(-1)[i + 1]; };
let dx = 0, dw = 0, dh = 0;
for (const [t, x, w, h] of appS) { if (t < model.tap[0][0] || t > model.tap.at(-1)[0]) continue; dx = Math.max(dx, Math.abs(x - at(model.tap, t, 0))); dw = Math.max(dw, Math.abs(w - at(model.tap, t, 1))); dh = Math.max(dh, Math.abs(h - at(model.tap, t, 2))); }
const gaps = (q) => Math.max(...q.slice(1).map((r, i) => r[0] - q[i][0])).toFixed(1);
console.log(`aligned (shift ${shift.toFixed(1)}ms): max |Δx| = ${dx.toFixed(2)}px | max |Δw| = ${dw.toFixed(2)}px | max |Δh| = ${dh.toFixed(2)}px | longest frame gap app ${gaps(app.tap)}ms`);
