// النمط الموحد لصفحة العمل على الكمبيوتر: الملصق (الظاهر منه)، الصفوف الأفقية، عرض المحتوى، زر التشغيل في الشاشة الأولى.
// الاستعمال: node unified.cjs 1366 768 tag   (RAIL=1 للشريط المقفل)
const { chromium } = require('playwright');
const fs = require('fs');
const [w, h, tag] = process.argv.slice(2);
const updates = fs.existsSync('shots/manga-updates.json') ? fs.readFileSync('shots/manga-updates.json', 'utf8') : '{}';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +w, height: +h } });
  await p.addInitScript(rail => {
    localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() }));
    localStorage.setItem('vantara.appearance.v1', JSON.stringify({ style: {}, accent: {}, pureBlack: false, unifiedLook: true }));
    if (rail) localStorage.setItem('vantara.rail.collapsed', '1');
  }, process.env.RAIL === '1');
  await p.route('https://vantara-sync.ngm-309.workers.dev/**', r => { const u = new URL(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: u.pathname === '/v1/updates' && u.searchParams.get('section') === 'manga' ? updates : '{}' }); });
  const errors = []; p.on('pageerror', e => errors.push(e.message.slice(0, 120)));
  await p.goto('http://127.0.0.1:8765/'); await p.waitForTimeout(3500);
  fs.mkdirSync('shots/unified', { recursive: true });
  const out = {};
  for (const [s, card] of [['ANIME', '.an-card:not(.an-card--ranked)'], ['CINEMA', '.cn-poster'], ['MANGA', '.work-card, .chart-row, .card-strip > *']]) {
    await p.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s))?.click(), s);
    await p.waitForTimeout(6000);
    const opened = await p.evaluate(sel => { const c = [...document.querySelectorAll(sel)].find(x => x.checkVisibility?.() && x.querySelector('img')); c?.click(); return !!c; }, card);
    await p.waitForTimeout(8000);
    await p.evaluate(async () => { const e = document.scrollingElement; for (let y = 0; y < e.scrollHeight; y += 700) { e.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } e.scrollTo(0, 0); });
    await p.waitForTimeout(1200);
    out[s] = { opened, ...(await p.evaluate(() => {
      const root = document.querySelector('.page.active') ?? [...document.querySelectorAll('#detail, #anime, #cinema, .page')].find(e => e.checkVisibility?.()) ?? document.querySelector('#root .v35');
      const vis = e => e.checkVisibility?.();
      const rows = []; for (const el of root.querySelectorAll('*')) { if (!vis(el)) continue; const cs = getComputedStyle(el); if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150) rows.push(String(el.className).slice(0, 30) + ':' + el.children.length); }
      const imgs = [...root.querySelectorAll('img')].filter(i => vis(i) && i.naturalWidth && i.getBoundingClientRect().width > 200).map(i => { const r = i.getBoundingClientRect(), cs = getComputedStyle(i), ir = i.naturalWidth / i.naturalHeight, fr = r.width / r.height, k = Math.min(fr / ir, ir / fr); return `${String(i.className).slice(0, 22)} ${Math.round(r.width)}x${Math.round(r.height)} ${cs.objectFit} ${cs.objectFit === 'cover' ? Math.round(k * 100) + '%' : 'full'}`; });
      const play = [...root.querySelectorAll('button, a')].find(x => vis(x) && /شاهد|تابع|اقرأ|شغّل/.test(x.textContent) && x.getBoundingClientRect().width > 30);
      const unified = !!root.querySelector('[data-unified]');
      return { unified, h1: root.querySelector('h1, h2')?.textContent?.trim().slice(0, 30), rows, imgs: imgs.slice(0, 3), play: play ? { inFirst: play.getBoundingClientRect().bottom <= innerHeight, w: Math.round(play.getBoundingClientRect().width) } : null, overflowX: document.documentElement.scrollWidth > innerWidth + 1, height: document.documentElement.scrollHeight };
    })) };
    await p.screenshot({ path: `shots/unified/${tag}-${s.toLowerCase()}.png` });
    await p.screenshot({ path: `shots/unified/${tag}-${s.toLowerCase()}-full.png`, fullPage: true });
    await p.goto('http://127.0.0.1:8765/'); await p.waitForTimeout(3500);
  }
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
