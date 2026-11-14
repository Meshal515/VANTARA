// بنر رئيسية السينما والأنمي: قبل (منفذ 8766) وبعد (8765)، 1366 و1920 والشريط مفتوح ومقفل
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [port, tag] of [['8766', 'before'], ['8765', 'after']]) for (const [w, h] of [[1366, 768], [1920, 1080]]) for (const rail of [false, true]) for (const sec of ['CINEMA', 'ANIME']) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.addInitScript(rail => { localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() })); if (rail) localStorage.setItem('vantara.rail.collapsed', '1'); }, rail);
    await p.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
    await p.goto(`http://127.0.0.1:${port}/`); await p.waitForTimeout(3000);
    await p.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s))?.click(), sec);
    await p.waitForTimeout(7000);
    await p.screenshot({ path: `shots/gallery/banner-${sec.toLowerCase()}-${tag}-${w}${rail ? '-rail' : ''}.png` });
    await p.close();
  }
  await b.close();
})();
