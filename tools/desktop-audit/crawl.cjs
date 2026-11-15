// زاحف شامل لتصميم الكمبيوتر: كل قسم (مانجا/أنمي/سينما) × كل بند في الشريط الجانبي × كل تبويب داخله.
// يقيس: تمرير أفقي، فيض أفقي للصفحة، صور مقصوصة، فراغات كبيرة، محاذاة العناوين، وإزاحة التخطيط عند التبديل.
const { chromium } = require('playwright');
const fs = require('fs');
const [w, h, tag] = process.argv.slice(2);
const RAIL = process.env.RAIL === '1';
const out = { size: `${w}x${h}`, rail: RAIL ? 'collapsed' : 'open', pages: [] };
const SKIP = /تبديل الحساب|خروج|حسابي|ملفّك|CINEMA|ANIME|MANGA/;

const measure = () => {
  const vis = el => el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true });
  const page = [...document.querySelectorAll('.sheet, .modal, [role=dialog]')].find(e => e.checkVisibility()) ?? document.querySelector('.page.active') ?? document.querySelector('#root .v35');
  const pr = page?.getBoundingClientRect();
  const rows = [], crops = [], heads = new Set(), blocks = [];
  for (const el of page?.querySelectorAll('*') ?? []) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150)
      rows.push(`${String(el.className).slice(0, 40)}(${el.children.length}:${el.clientWidth}→${el.scrollWidth})`);
    if (el.tagName === 'IMG' && el.naturalWidth && r.width > 110 && r.height > 80 && cs.objectFit === 'cover') {
      const ir = el.naturalWidth / el.naturalHeight, fr = r.width / r.height, k = Math.min(fr / ir, ir / fr);
      if (k < 0.85) crops.push(`${String(el.className || el.parentElement.className).slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)} ${(k * 100) | 0}%`);
    }
    if (/^H[12]$/.test(el.tagName) && r.width) heads.add(Math.round(r.right));
  }
  // كتل المستوى الأول داخل الصفحة: فراغات عمودية كبيرة وعرض المحتوى مقابل عرض الصفحة
  for (const el of page?.querySelectorAll(':scope > *, :scope > * > *') ?? []) {
    if (!vis(el)) continue; const r = el.getBoundingClientRect();
    if (r.height > 20 && r.width > 40) blocks.push([r.top + scrollY, r.bottom + scrollY, r.left, r.right]);
  }
  blocks.sort((a, b) => a[0] - b[0]);
  let maxGap = 0, bottom = blocks[0]?.[1] ?? 0;
  for (const b of blocks) { if (b[0] - bottom > maxGap) maxGap = b[0] - bottom; bottom = Math.max(bottom, b[1]); }
  const left = Math.min(...blocks.map(b => b[2])), right = Math.max(...blocks.map(b => b[3]));
  return {
    title: document.querySelector('.page.active h1, .page.active h2')?.textContent?.trim().slice(0, 40) ?? '',
    rows, crops: crops.slice(0, 6), headEdges: [...heads].sort((a, b) => b - a).slice(0, 6),
    contentWidthPct: pr && isFinite(left) ? Math.round((right - left) / pr.width * 100) : null,
    maxVerticalGap: Math.round(maxGap), pageOverflowX: document.documentElement.scrollWidth > innerWidth + 1,
    height: document.documentElement.scrollHeight,
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
  const page = await ctx.newPage();
  await page.addInitScript(rail => {
    localStorage.setItem('vantara.session.v1', JSON.stringify({ token: 'fixture-token', user: { userId: 'fixture-user', name: 'تجربة' }, savedAt: Date.now() }));
    if (rail) localStorage.setItem('vantara.rail.collapsed', '1');
    // إزاحة التخطيط التراكمية منذ آخر تصفير
    window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  }, RAIL);
  await page.route('https://vantara-sync.ngm-309.workers.dev/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }));
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)));
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const shot = async name => { await page.screenshot({ path: `shots/crawl/${tag}/${name}.png` }); };
  fs.mkdirSync(`shots/crawl/${tag}`, { recursive: true });
  const settle = async (ms = 2500) => { await page.waitForTimeout(ms); await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < Math.min(s.scrollHeight, 9000); y += 700) { s.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); } s.scrollTo(0, 0); }); await page.waitForTimeout(500); };
  const record = async (name, extra = {}) => { const m = await page.evaluate(measure); out.pages.push({ name, ...extra, ...m }); await shot(name.replace(/[\\/:*?"<>| ]+/g, '_')); console.log(`${name} | rows ${m.rows.length} | crops ${m.crops.length} | width ${m.contentWidthPct}% | gap ${m.maxVerticalGap} | overflowX ${m.pageOverflowX}${extra.cls != null ? ` | CLS ${extra.cls}` : ''}`); };

  for (const section of ['manga', 'anime', 'cinema']) {
    await page.evaluate(() => { window.__cls = 0; });
    await page.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.checkVisibility?.() && x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
    await page.waitForTimeout(1500);
    const cls = await page.evaluate(() => +window.__cls.toFixed(3));
    await settle(4500);
    await record(`${section}-home`, { cls });
    const items = await page.evaluate(skip => [...document.querySelectorAll('.drawer .drawer-item')].filter(b => b.checkVisibility()).map(b => b.textContent.trim().replace(/\s+/g, ' ')).filter(t => t && !new RegExp(skip).test(t)), SKIP.source);
    for (const item of items) {
      await page.evaluate(t => [...document.querySelectorAll('.drawer .drawer-item')].find(b => b.checkVisibility() && b.textContent.trim().replace(/\s+/g, ' ') === t)?.click(), item);
      await settle();
      await record(`${section}-${item}`);
      // التبويبات داخل الصفحة (role=tab أو أزرار شريط تبويب)
      const tabs = await page.evaluate(() => [...document.querySelectorAll('.page.active [role=tab], .page.active [class*=tabs] > button, .page.active [class*=seg] > button')].filter(b => b.checkVisibility()).map(b => b.textContent.trim().replace(/\s+/g, ' ')).filter(t => t && t.length < 24).slice(0, 8));
      for (const tab of tabs) {
        await page.evaluate(t => [...document.querySelectorAll('.page.active [role=tab], .page.active [class*=tabs] > button, .page.active [class*=seg] > button')].find(b => b.checkVisibility() && b.textContent.trim().replace(/\s+/g, ' ') === t)?.click(), tab);
        await settle(1800);
        await record(`${section}-${item}-${tab}`);
      }
      // إغلاق أي ورقة مفتوحة والرجوع للرئيسية
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    }
  }
  out.errors = errors;
  fs.writeFileSync(`shots/crawl/${tag}.json`, JSON.stringify(out, null, 1));
  await browser.close();
})();
