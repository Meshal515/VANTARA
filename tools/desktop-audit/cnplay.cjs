const { chromium } = require('playwright');
(async () => {
  const [w, h] = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const style of ['current', 'premiere', 'poster', 'marquee', 'series']) {
    const page = await browser.newPage({ viewport: { width: +w, height: +h } });
    await page.addInitScript(style => { localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() })); localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { cinema: style }, accent: {}, pureBlack: false, unifiedLook: false })); }, style);
    await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
    await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(3500);
    await page.evaluate(() => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith('CINEMA'))?.click());
    await page.waitForTimeout(5000);
    await page.evaluate(() => [...document.querySelectorAll('.cn-poster')].find(x => x.checkVisibility?.())?.click());
    await page.waitForTimeout(6500);
    const r = await page.evaluate(() => {
      const play = [...document.querySelectorAll('.cn-btn--play')].find(b => b.checkVisibility());
      const art = [...document.querySelectorAll('.cn-detail-art .cn-img, .cn-detail img')].filter(i => i.checkVisibility() && i.naturalWidth && i.getBoundingClientRect().width > 300).map(i => { const r = i.getBoundingClientRect(), cs = getComputedStyle(i), ir = i.naturalWidth / i.naturalHeight, fr = r.width / r.height; return `${Math.round(r.width)}x${Math.round(r.height)} ${cs.objectFit} ${cs.objectFit === 'cover' ? Math.round(Math.min(fr / ir, ir / fr) * 100) + '%' : 'full'}`; });
      const body = document.querySelector('.cn-detail-body')?.getBoundingClientRect();
      return { playTop: play ? Math.round(play.getBoundingClientRect().top) : null, playInFirst: play ? play.getBoundingClientRect().bottom <= innerHeight : null, art: art.slice(0, 2), bodyWidth: body ? Math.round(body.width) : null };
    });
    console.log(style, `${w}x${h}`, JSON.stringify(r));
    await page.screenshot({ path: `shots/cnp-${style}-${w}.png` });
    await page.close();
  }
  await browser.close();
})();
