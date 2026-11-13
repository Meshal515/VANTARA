const { chromium } = require('playwright');
const fs = require('fs');
const updates = fs.readFileSync((process.env.MANGA_FIXTURE || 'shots/manga-updates.json'), 'utf8');
(async () => {
  const [style, w, h, tag] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  await page.addInitScript(style => { localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() })); localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: { manga: style }, accent: {}, pureBlack: false, unifiedLook: false })); }, style);
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => {
    const u = new URL(r.request().url());
    const body = u.pathname === '/v1/updates' && u.searchParams.get('section') === 'manga' ? updates : '{}';
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(8000);
  const home = await page.evaluate(() => ({ covers: [...document.querySelectorAll('.page.active img')].filter(i => i.checkVisibility() && i.naturalWidth).length, headings: [...document.querySelectorAll('h2')].filter(h => h.checkVisibility()).map(h => h.textContent.trim()).slice(0, 8) }));
  console.log('home', JSON.stringify(home));
  await page.screenshot({ path: `shots/${tag}-home.png` });
  const opened = await page.evaluate(() => { const c = [...document.querySelectorAll('.page.active .work-card')].find(x => x.checkVisibility() && x.querySelector('img')?.naturalWidth); c?.click(); return c?.textContent.trim().slice(0, 40); });
  await page.waitForTimeout(7000);
  console.log('opened', opened, JSON.stringify(await page.evaluate(() => ({ page: document.querySelector('.page.active')?.id, look: document.querySelector('[data-look], [data-style]')?.dataset.look ?? null, h1: document.querySelector('.page.active h1')?.textContent?.trim().slice(0, 40) }))));
  await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < s.scrollHeight; y += 600) { s.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } s.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  console.log(style, JSON.stringify(await page.evaluate(() => {
    const rows = []; for (const el of document.querySelectorAll('#detail *')) { if (!el.checkVisibility()) continue; const cs = getComputedStyle(el); if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150) rows.push(String(el.className).slice(0, 30) + ':' + el.children.length); }
    const imgs = [...document.querySelectorAll('#detail img')].filter(i => i.checkVisibility() && i.naturalWidth && i.getBoundingClientRect().width > 150).map(i => { const r = i.getBoundingClientRect(), cs = getComputedStyle(i), ir = i.naturalWidth / i.naturalHeight, fr = r.width / r.height, k = Math.min(fr / ir, ir / fr); return `${String(i.className).slice(0, 18)} ${Math.round(r.width)}x${Math.round(r.height)} ${cs.objectFit} ${cs.objectFit === 'cover' ? Math.round(k * 100) + '%' : 'full'}`; });
    return { rows, imgs: imgs.slice(0, 4), overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
  })));
  await page.screenshot({ path: `shots/${tag}-view.png` });
  if (process.env.DOM) console.log(JSON.stringify(await page.evaluate(() => { const d = document.querySelector('#detail'); const walk = (e, depth) => depth > 2 ? [] : [...e.children].filter(c => c.checkVisibility()).flatMap(c => { const r = c.getBoundingClientRect(); return [`${'  '.repeat(depth)}${c.tagName.toLowerCase()}.${String(c.className).split(' ').slice(0, 3).join('.')}${c.id ? '#' + c.id : ''} [${Math.round(r.left)},${Math.round(r.top + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}]`, ...walk(c, depth + 1)]; }); return walk(d, 0); }), null, 1));
  await page.screenshot({ path: `shots/${tag}-work.png`, fullPage: true });
  await browser.close();
})();
