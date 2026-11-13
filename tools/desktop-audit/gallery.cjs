// لقطات معرض الأنماط: كل نمط لصفحة العمل على الكمبيوتر (1366×768 فأرة) والجوال (412×915 لمس)، أول شاشة.
// الاستعمال: node gallery.cjs anime|cinema|manga|unified [port]
const { chromium } = require('playwright');
const fs = require('fs');
const [section, port = '8765', only] = process.argv.slice(2);
const STYLES = { anime: ['core', 'platform', 'card', 'screen', 'episode'], manga: ['page', 'gallery', 'profile', 'resume', 'webtoon'], cinema: ['current', 'premiere', 'poster', 'marquee', 'series'] };
const updates = fs.readFileSync('shots/manga-updates.json', 'utf8');
const CARD = { anime: '.an-card:not(.an-card--ranked)', cinema: '.cn-poster', manga: '.page.active .work-card, .page.active .card-strip > *' };
(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync('shots/gallery', { recursive: true });
  const jobs = section === 'unified' ? ['anime', 'cinema', 'manga'].map(s => [s, null]) : STYLES[section].filter(st => !only || only.split(',').includes(st)).map(st => [section, st]);
  for (const [sec, style] of jobs) {
    for (const device of ['pc', 'mobile']) {
      const ctx = await browser.newContext(device === 'pc' ? { viewport: { width: 1366, height: 768 } } : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      await page.addInitScript(([sec, style]) => {
        localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() }));
        localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: style ? { [sec]: style } : {}, accent: {}, pureBlack: false, unifiedLook: !style }));
      }, [sec, style]);
      await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => { const u = new URL(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: u.pathname === '/v1/updates' && u.searchParams.get('section') === 'manga' ? updates : '{}' }); });
      await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(3500);
      // تبديل القسم: الشريط الجانبي على الكمبيوتر، ومبدّل الأقسام على الجوال
      await page.evaluate(s => {
        const pick = [...document.querySelectorAll('button, a, [role=radio]')].filter(x => x.checkVisibility?.());
        (pick.find(x => x.closest('.drawer') && x.textContent.trim().toUpperCase().startsWith(s.toUpperCase())) ?? pick.find(x => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase())) ?? pick.find(x => (x.dataset.section ?? x.dataset.value) === s))?.click();
      }, sec);
      await page.waitForTimeout(sec === 'manga' ? 10000 : 6000);
      const opened = await page.evaluate(sel => { const c = [...document.querySelectorAll(sel)].find(x => x.checkVisibility?.() && x.querySelector('img')?.naturalWidth); c?.click(); return c ? c.textContent.trim().slice(0, 30) : null; }, CARD[sec]);
      await page.waitForTimeout(8000);
      const name = `${sec}-${style ?? 'unified'}-${device}`;
      await page.screenshot({ path: `shots/gallery/${name}.png` });
      if (process.env.FULL) await page.screenshot({ path: `shots/gallery/${name}-full.png`, fullPage: true });
      console.log(name, opened ? 'ok' : 'NO-CARD', await page.evaluate(() => document.querySelector('[data-style], [data-look]')?.getAttribute('data-style') ?? document.querySelector('[data-look]')?.getAttribute('data-look')));
      await ctx.close();
    }
  }
  await browser.close();
})();
