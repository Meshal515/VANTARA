const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [w, h, tag, sidebar] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  await page.addInitScript(rail => { if (rail) localStorage.setItem('vantara.rail.collapsed', '1'); localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'fixture-token', user: { userId: 'fixture-user', name: 'تجربة' }, savedAt: Date.now() })); }, process.env.RAIL === '1');
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  if (sidebar === 'collapsed') { await page.click('.side-collapse, [aria-label*="طي"], [data-action="collapse-side"]').catch(() => {}); await page.waitForTimeout(600); }
  const report = {};
  for (const section of ['manga', 'anime', 'cinema']) {
    await page.evaluate(s => { const b = [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase())); b?.click(); }, section);
    await page.waitForTimeout(5000);
    // مرور تدريجي حتى تُحمّل الصور الكسولة كما عند المستخدم، ثم العودة للأعلى
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } scrollTo(0, 0); });
    await page.waitForTimeout(2500);
    report[section] = await page.evaluate(() => {
      const rows = [];
      for (const el of document.querySelectorAll('#root *')) {
        if (!el.checkVisibility?.()) continue;
        const cs = getComputedStyle(el);
        if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 200) {
          const r = el.getBoundingClientRect();
          rows.push({ cls: (el.className || el.tagName).toString().slice(0, 60), heading: (el.closest('section')?.querySelector('h2,h3')?.textContent ?? '').trim().slice(0, 40), visible: el.clientWidth, content: el.scrollWidth, children: el.children.length, top: Math.round(r.top + scrollY) });
        }
      }
      const cards = [...document.querySelectorAll('#root img')].filter(i => i.checkVisibility?.()).map(i => i.getBoundingClientRect()).filter(r => r.width > 60 && r.height > 80);
      const widths = cards.map(r => Math.round(r.width)).sort((a, b) => a - b);
      return { section: document.querySelector('#root .v35')?.dataset.section, horizontalRows: rows, docHeight: document.documentElement.scrollHeight, pageOverflowX: document.documentElement.scrollWidth > innerWidth, cardWidthMedian: widths[Math.floor(widths.length / 2)] ?? null, cardCount: widths.length };
    });
    await page.screenshot({ path: `shots/${tag}-${section}.png`, fullPage: true });
  }
  fs.writeFileSync(`shots/${tag}.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { rows: v.horizontalRows.length, cardMedian: v.cardWidthMedian, cards: v.cardCount, overflowX: v.pageOverflowX, list: v.horizontalRows.map(r => `${r.heading || r.cls}:${r.children}/${r.visible}→${r.content}`) }])), null, 1));
  await browser.close();
})();
