// قياس الرئيسيات الثلاث على الكمبيوتر: البطل/البنر (الظاهر من الصورة، الإطار، سطر المعلومات وزر التشغيل
// في الشاشة الأولى)، الصفوف الأفقية، Top 10، التشكيلة، الفراغات؛ ثم التبديل بين الرئيسيات وفتح الشريط
// وإغلاقه (CLS ووميض: لقطات متتالية أثناء الانتقال تقاس بنسبة البكسلات شبه الفارغة).
// الاستعمال: node homes.cjs 1920 1080 tag   (RAIL=1 للشريط المقفل، MANGA_FIXTURE لمسار fixture المانجا)
const { chromium } = require('playwright');
const fs = require('fs');
const [w, h, tag] = process.argv.slice(2);
const RAIL = process.env.RAIL === '1';
const updates = fs.existsSync(process.env.MANGA_FIXTURE || 'shots/manga-updates.json') ? fs.readFileSync(process.env.MANGA_FIXTURE || 'shots/manga-updates.json', 'utf8') : '{}';

const measure = () => {
  const vis = el => el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true });
  const root = document.querySelector('.page.active') ?? document.querySelector('#root .v35');
  const rows = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150) rows.push(`${String(el.className).slice(0, 34)}(${el.children.length}:${el.clientWidth}→${el.scrollWidth})`);
  }
  const hero = [...root.querySelectorAll('.ah-art-img, .cn-bill-img, .mh-hero img, .hero img, .m-hero img')].filter(i => vis(i) && i.naturalWidth && i.getBoundingClientRect().width > 400).at(-1);
  let heroInfo = null;
  if (hero) {
    const r = hero.getBoundingClientRect(), cs = getComputedStyle(hero), ir = hero.naturalWidth / hero.naturalHeight, fr = r.width / r.height, k = Math.min(fr / ir, ir / fr);
    const frame = hero.parentElement.getBoundingClientRect();
    heroInfo = { cls: String(hero.className).slice(0, 30), natural: [hero.naturalWidth, hero.naturalHeight], box: [Math.round(r.width), Math.round(r.height)], widthPct: Math.round(r.width / root.getBoundingClientRect().width * 100), fit: cs.objectFit, pos: cs.objectPosition, visible: cs.objectFit === 'cover' ? Math.round(k * 100) : 100, filter: cs.filter, frameBottom: Math.round(frame.bottom) };
  }
  const play = [...root.querySelectorAll('button, a')].find(b => vis(b) && /شاهد|تابع|اقرأ/.test(b.textContent) && b.getBoundingClientRect().width > 30);
  const lineup = root.querySelector('.ah-lineup');
  const top = root.querySelector('.an-rail--top .an-strip');
  const topCols = top ? new Set([...top.children].filter(vis).map(c => Math.round(c.getBoundingClientRect().left))).size : null;
  const topRows = top ? new Set([...top.children].filter(vis).map(c => Math.round(c.getBoundingClientRect().top))).size : null;
  // أكبر فراغ عمودي بين كتل المحتوى الظاهرة
  const blocks = [...root.querySelectorAll('section, .an-rail, .cn-rail, .ah-hero, .cn-bill, h2, .card-strip, .an-strip, .cn-strip')].filter(vis).map(e => e.getBoundingClientRect()).filter(r => r.height > 10).map(r => [r.top + scrollY, r.bottom + scrollY]).sort((a, b) => a[0] - b[0]);
  let gap = 0, bottom = blocks[0]?.[1] ?? 0;
  for (const b of blocks) { gap = Math.max(gap, b[0] - bottom); bottom = Math.max(bottom, b[1]); }
  return {
    rows, hero: heroInfo, playInFirstScreen: play ? Math.round(play.getBoundingClientRect().bottom) <= innerHeight : null,
    lineup: lineup ? { children: lineup.children.length, overflow: lineup.scrollWidth > lineup.clientWidth + 2, rows: new Set([...lineup.children].filter(vis).map(c => Math.round(c.getBoundingClientRect().top))).size } : null,
    top10: top ? `${topCols}x${topRows}` : null,
    maxGap: Math.round(gap), overflowX: document.documentElement.scrollWidth > innerWidth + 1, height: document.documentElement.scrollHeight,
  };
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  await page.addInitScript(rail => {
    localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'fixture-token', user: { userId: 'fixture-user', name: 'تجربة' }, savedAt: Date.now() }));
    if (rail) localStorage.setItem('vantara.rail.collapsed', '1');
    window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  }, RAIL);
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => {
    const u = new URL(r.request().url());
    const body = u.pathname === '/v1/updates' && u.searchParams.get('section') === 'manga' ? updates : '{}';
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
  });
  // AniList الرائج للمانجا من fixture ثابت (الحد 90 طلبًا/دقيقة يُسقطه أحيانًا وسط قياس الأنمي)
  if (fs.existsSync('shots/anilist-manga.json')) {
    const media = JSON.parse(fs.readFileSync('shots/anilist-manga.json', 'utf8')).data.Page.media.map(m => ({ format: 'MANGA', synonyms: [], genres: ['Action'], popularity: 1000, averageScore: 80, status: 'RELEASING', chapters: null, isAdult: false, bannerImage: null, ...m, title: { ...m.title, native: null }, coverImage: { large: m.coverImage.extraLarge, ...m.coverImage } }));
    await page.route('https://graphql.anilist.co/**', async r => {
      const body = r.request().postData() ?? '';
      if (/type: MANGA, sort: POPULARITY_DESC/.test(body)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media } } }) });
      return r.continue();
    });
  }
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 140)));
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  fs.mkdirSync('shots/homes/frames', { recursive: true });
  const go = s => page.evaluate(s => [...document.querySelectorAll('.drawer button, button')].find(x => x.checkVisibility?.() && x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), s);
  const out = { size: `${w}x${h}`, rail: RAIL ? 'collapsed' : 'open', homes: {}, switches: [] };
  for (const s of ['anime', 'cinema', 'manga']) {
    await go(s);
    await page.waitForTimeout(6000);
    await page.evaluate(async () => { const e = document.scrollingElement; for (let y = 0; y < e.scrollHeight; y += 600) { e.scrollTo(0, y); await new Promise(r => setTimeout(r, 100)); } e.scrollTo(0, 0); });
    await page.waitForTimeout(1500);
    out.homes[s] = await page.evaluate(measure);
    await page.screenshot({ path: `shots/homes/${tag}-${s}.png` });
  }
  // التبديل بين الرئيسيات: CLS ولقطات كل ~60ms خلال 900ms
  for (const [a, b] of [['manga', 'anime'], ['anime', 'cinema'], ['cinema', 'manga'], ['manga', 'cinema'], ['cinema', 'anime']]) {
    await go(a); await page.waitForTimeout(3500);
    await page.evaluate(() => { window.__cls = 0; });
    await go(b);
    const dark = [];
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < 900) { const f = `shots/homes/frames/${tag}-${a}-${b}-${String(i++).padStart(2, '0')}.jpg`; await page.screenshot({ path: f, type: 'jpeg', quality: 50 }); dark.push(f); }
    await page.waitForTimeout(1500);
    out.switches.push({ from: a, to: b, cls: +(await page.evaluate(() => window.__cls)).toFixed(4), frames: dark.length });
  }
  // فتح الشريط الجانبي وإغلاقه على الرئيسية
  for (const s of ['anime', 'cinema']) {
    await go(s); await page.waitForTimeout(3000);
    await page.evaluate(() => { window.__cls = 0; });
    const railSel = () => page.evaluate(() => document.querySelector('.rail-collapsed') ? '.rail-logo' : '.rail-toggle');
    // نقرة فأرة حقيقية: إزاحات أول 500ms بعد الإدخال لا تُحسب في CLS (كما في المتصفح الحقيقي)، فما يبقى قفزة متأخرة فعلًا
    const toggled = await railSel(); await page.click(toggled);
    const railFrames = []; for (let i = 0, t0 = Date.now(); Date.now() - t0 < 700; i++) { const f = `shots/homes/frames/${tag}-rail-${s}-${String(i).padStart(2, '0')}.jpg`; await page.screenshot({ path: f, type: 'jpeg', quality: 50 }); railFrames.push(f); }
    await page.waitForTimeout(900);
    const after = await page.evaluate(measure);
    await page.click(await railSel());
    await page.waitForTimeout(900);
    out.switches.push({ railToggle: s, button: toggled, cls: +(await page.evaluate(() => window.__cls)).toFixed(4), rowsAfter: after.rows.length, heroAfter: after.hero && after.hero.visible });
  }
  out.errors = errors;
  fs.writeFileSync(`shots/homes/${tag}.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
