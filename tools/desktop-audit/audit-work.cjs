// قياس أنماط صفحة العمل على الكمبيوتر: لكل قسم/نمط تُفتح صفحة عمل حقيقية ويُعدّ كل شريط أفقي ظاهر.
const { chromium } = require('playwright');
const fs = require('fs');
const STYLES = { anime: ['core', 'platform', 'card', 'screen', 'episode'], cinema: ['current', 'premiere', 'poster', 'marquee', 'series'] };
const [w, h, tag, only] = process.argv.slice(2);
const visibleRows = () => {
  const rows = [];
  for (const el of document.querySelectorAll('#root *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden' || !el.checkVisibility?.()) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150)
      rows.push({ cls: String(el.className).slice(0, 50), heading: (el.closest('section,[class*=rail],[class*=block]')?.querySelector('h2,h3')?.textContent ?? '').trim().slice(0, 30), items: el.children.length, visible: el.clientWidth, content: el.scrollWidth });
  }
  const imgs = [...document.querySelectorAll('#root img')].filter(i => i.checkVisibility?.()).map(i => i.getBoundingClientRect()).filter(r => r.width > 60 && r.height > 80 && r.height > r.width);
  const ws = imgs.map(r => Math.round(r.width)).sort((a, b) => a - b);
  return { rows, posterMedian: ws[Math.floor(ws.length / 2)] ?? null, posters: ws.length, pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1 };
};
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [section, styles] of Object.entries(STYLES)) {
    if (only && only !== section) continue;
    for (const style of styles) {
      const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
      const page = await ctx.newPage();
      await page.addInitScript(([section, style]) => {
        localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'fixture-token', user: { userId: 'fixture-user', name: 'تجربة' }, savedAt: Date.now() }));
        localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { [section]: style }, accent: {}, pureBlack: false, unifiedLook: false }));
      }, [section, style]);
      await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
      await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      await page.evaluate(s => [...document.querySelectorAll('button,a')].find(x => x.checkVisibility?.() && x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
      await page.waitForTimeout(6000);
      const home = await page.evaluate(visibleRows);
      // أول بطاقة عمل ظاهرة في الرئيسية (لا الجدول): صفحة عمل حقيقية
      const opened = await page.evaluate(() => { const c = [...document.querySelectorAll('.an-card:not(.an-card--ranked), .cn-poster')].find(x => x.checkVisibility?.()); c?.click(); return c?.textContent?.trim().slice(0, 40) ?? null; });
      await page.waitForTimeout(7000);
      await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < s.scrollHeight; y += 600) { s.scrollTo(0, y); await new Promise(r => setTimeout(r, 150)); } s.scrollTo(0, 0); });
      await page.waitForTimeout(1500);
      const work = await page.evaluate(visibleRows);
      await page.screenshot({ path: `shots/${tag}-${section}-${style}.png`, fullPage: true });
      out[`${section}/${style}`] = { opened, homeRows: home.rows.length, homePoster: home.posterMedian, workRows: work.rows, workPoster: work.posterMedian, overflowX: work.pageOverflowX };
      console.log(`${section}/${style} [${opened}] home:${home.rows.length} rows, poster ${home.posterMedian}px | work: ${work.rows.length} rows ${work.rows.map(r => `${r.heading || r.cls}(${r.items}:${r.visible}→${r.content})`).join(', ')} | overflowX ${work.pageOverflowX}`);
      await ctx.close();
    }
  }
  fs.writeFileSync(`shots/${tag}-work.json`, JSON.stringify(out, null, 1));
  await browser.close();
})();
