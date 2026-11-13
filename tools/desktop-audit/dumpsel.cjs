const { chromium } = require('playwright');
(async () => {
  const [section, style, sel, w, h] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +(w || 1366), height: +(h || 768) } });
  await page.addInitScript(([section, style]) => { localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() })); localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { [section]: style }, accent: {}, pureBlack: false, unifiedLook: false })); }, [section, style]);
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(3500);
  await page.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(5000);
  await page.evaluate(() => [...document.querySelectorAll('.an-card:not(.an-card--ranked), .cn-poster')].find(x => x.checkVisibility?.())?.click());
  await page.waitForTimeout(6500);
  console.log(JSON.stringify(await page.evaluate(sel => [...(document.querySelector(sel)?.children ?? [])].map(c => { const r = c.getBoundingClientRect(); return `${c.tagName.toLowerCase()}.${String(c.className).split(' ').slice(0, 3).join('.')} [${Math.round(r.left)},${Math.round(r.top + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}] vis=${c.checkVisibility()}`; }), sel), null, 1));
  await browser.close();
})();
