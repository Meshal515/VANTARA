// صورة بحجم الشاشة الفعلي (لا fullPage) لأعلى صفحة العمل + قياس البنر: أبعاد الإطار مقابل أبعاد الصورة الطبيعية.
const { chromium } = require('playwright');
(async () => {
  const [section, style, w, h, tag] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  await page.addInitScript(([section, style, RAIL]) => {
    localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'fixture-token', user: { userId: 'fixture-user', name: 'تجربة' }, savedAt: Date.now() }));
    if (RAIL) localStorage.setItem('vantara.rail.collapsed', '1');
    localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { [section]: style }, accent: {}, pureBlack: false, unifiedLook: false }));
  }, [section, style, process.env.RAIL === '1']);
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.evaluate(s => [...document.querySelectorAll('button,a')].find(x => x.checkVisibility?.() && x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(6000);
  await page.evaluate(() => [...document.querySelectorAll('.an-card:not(.an-card--ranked), .cn-poster')].find(x => x.checkVisibility?.())?.click());
  await page.waitForTimeout(8000);
  await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < s.scrollHeight; y += 700) { s.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } s.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const img = [...document.querySelectorAll('.aw-hero .aw-bg-img')].filter(i => i.checkVisibility() && i.naturalWidth).at(-1);
    const hero = document.querySelector('.aw-hero');
    const out = { hero: hero ? [Math.round(hero.getBoundingClientRect().width), Math.round(hero.getBoundingClientRect().height)] : null };
    if (img) {
      const r = img.getBoundingClientRect(), fit = getComputedStyle(img).objectFit, ir = img.naturalWidth / img.naturalHeight, fr = r.width / r.height;
      const k = Math.min(fr / ir, ir / fr);
      // cover: جزء الصورة الظاهر؛ contain: جزء الإطار المملوء (الباقي أشرطة)
      Object.assign(out, { natural: [img.naturalWidth, img.naturalHeight], fit, imageVisible: fit === 'cover' ? +k.toFixed(2) : 1, frameFilled: fit === 'contain' ? +k.toFixed(2) : 1 });
    }
    const rows = [];
    for (const el of document.querySelectorAll('#root *')) {
      if (!el.checkVisibility?.()) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150) rows.push(String(el.className).slice(0, 30) + ':' + el.children.length);
    }
    out.horizontalRows = rows;
    const play = [...document.querySelectorAll('button, a')].find(b => b.checkVisibility() && /شاهد|تابع/.test(b.textContent) && b.getBoundingClientRect().width > 30);
    out.playInFirstScreen = play ? play.getBoundingClientRect().bottom <= innerHeight : null;
    return out;
  });
  console.log(`${style} ${w}x${h}`, JSON.stringify(info));
  await page.screenshot({ path: `shots/${tag}.png` });
  await browser.close();
})();
