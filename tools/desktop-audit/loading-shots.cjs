// شاشة تحميل مشغل ويندوز (overlay.js) بفن حقيقي: بنر العمل وشعاره الذي يمتلئ بقدر التحميل، كما في الـAPK.
// node loading-shots.cjs OUTDIR BG_URL LOGO_URL TITLE
const { chromium } = require('playwright');
const { fitZoom } = require('../../apps/desktop/window-zoom.cjs');
const path = require('path'), fs = require('fs');
const [out, bg, logo, title] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const f = fitZoom(w);
    const ctx = await browser.newContext({ viewport: { width: Math.round(w / f), height: Math.round(h / f) }, deviceScaleFactor: f });
    const page = await ctx.newPage();
    await page.addInitScript(() => { let l = null; window.VantaraOverlay = { send: () => {}, onState: (fn) => { l = fn; } }; window.__push = (s) => l?.(s); });
    await page.goto('http://127.0.0.1:8765/desktop/overlay.html'); await page.waitForTimeout(600);
    const base = { title, subtitle: 'الموسم 1 · الحلقة 1', tone: 'cinema', ready: false, loadEpoch: 1, art: { backdrop: bg, logo }, duration: 0, position: 0 };
    for (const p of [0.15, 0.6]) {
      await page.evaluate((s) => window.__push(s), { ...base, loadProgress: p });
      await page.waitForTimeout(p === 0.15 ? 4000 : 1500);
      const st = await page.evaluate(() => ({ stage: !document.querySelector('.pp-stage')?.hidden, bg: document.querySelector('.pp-stage')?.classList.contains('pp-stage--bg'), mark: !document.querySelector('.pp-stage__mark')?.hidden, fill: document.querySelector('.pp-stage__fill')?.style.clipPath }));
      console.log(w, p, JSON.stringify(st));
      await page.screenshot({ path: path.join(out, `مشغل-شاشة-التحميل-${Math.round(p * 100)}-${w}.jpg`), quality: 85 });
    }
    await ctx.close();
  }
  await browser.close();
})();
