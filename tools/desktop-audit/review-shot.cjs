// صور المراجعة للمالك: صفحة عمل حقيقية كاملة من أعلى لأسفل داخل تطبيق ويندوز (desktop-harness)، بعد تحميل كل
// الأقسام (تمرير حتى آخر الصفحة وانتظار «قد يعجبك»/«إذا عجبك هذا»)، والشريط الجانبي ممدود بطول الصفحة كما يراه
// المستخدم في أي موضع تمرير (في لقطة الصفحة الكاملة يبقى بارتفاع أول شاشة فقط).
// node review-shot.cjs anime|cinema|manga style[,style] OUTDIR [views=pc1366,pc1366-rail,pc1920,pc1920-rail]
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const [section, styles, outDir, viewsArg = 'pc1366,pc1366-rail,pc1920,pc1920-rail'] = process.argv.slice(2);
const VIEWS = { pc1366: [1366, 768, false], 'pc1366-rail': [1366, 768, true], pc1920: [1920, 1080, false], 'pc1920-rail': [1920, 1080, true], pc2560: [2560, 1440, false], 'pc2560-rail': [2560, 1440, true] };
const VIEW_AR = { pc1366: '1366-مفتوح', 'pc1366-rail': '1366-مقفل', pc1920: '1920-مفتوح', 'pc1920-rail': '1920-مقفل', pc2560: '2560-مفتوح', 'pc2560-rail': '2560-مقفل' };
const NAME_AR = { core: 'المحور', platform: 'المنصة', card: 'البطاقة-الطائرة', screen: 'شاشة-السينما', episode: 'الحلقة-أولا', page: 'كلاسيكي', gallery: 'المعرض', profile: 'الملف', resume: 'من-حيث-وقفت', webtoon: 'ويبتوني', current: 'الأساسي', premiere: 'العرض-الأول', poster: 'الملصق', marquee: 'الشريط-العريض', series: 'المسلسل-أولا', unified: 'الموحد' };
const SEC_AR = { anime: 'أنمي', cinema: 'سينما', manga: 'مانجا' };
const PICK = { anime: { want: /apothecary|frieren|jujutsu/i, card: '.an-card:not(.an-card--ranked)' }, cinema: { card: '.cn-poster', rail: /مسلسلات/ }, manga: { want: /one piece|solo leveling|berserk|jujutsu/i, card: '.page.active .work-card' } };
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  for (const style of styles.split(',')) for (const v of viewsArg.split(',')) {
    const [w, h, rail] = VIEWS[v];
    const unified = style === 'unified';
    const storage = { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 'تجربة' }, savedAt: Date.now() }, 'vantara.appearance.v1': { style: unified ? {} : { [section]: style }, accent: {}, pureBlack: false, unifiedLook: unified }, ...(rail ? { 'vantara.rail.collapsed': '1' } : {}) };
    const { ctx, page } = await openDesktop({ browser, storage, screen: { width: w, height: h } });
    try {
      await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4500);
      await page.evaluate((s) => [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
      await page.waitForTimeout(section === 'manga' ? 10000 : 6500);
      const p = PICK[section];
      await page.evaluate(([sel, want, railRe]) => { let cards = [...document.querySelectorAll(sel)].filter((x) => x.checkVisibility?.() && x.querySelector('img')); if (railRe) { const r = cards.filter((c) => new RegExp(railRe).test(c.closest('section')?.querySelector('h2,h3')?.textContent ?? '')); if (r.length) cards = r; } ((want && cards.find((x) => new RegExp(want, 'i').test(x.textContent))) ?? cards[0])?.click(); }, [p.card, p.want?.source ?? null, p.rail?.source ?? null]);
      await page.waitForTimeout(9000);
      // تمرير بطيء حتى آخر الصفحة مرتين (الأقسام تُحمّل عند الاقتراب) ثم الرجوع للأعلى
      for (let k = 0; k < 2; k++) await page.evaluate(async () => { const s = document.scrollingElement; for (let y = 0; y < s.scrollHeight; y += 500) { s.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } });
      await page.waitForTimeout(2500);
      await page.evaluate(() => document.scrollingElement.scrollTo(0, 0));
      await page.waitForTimeout(1500);
      await page.evaluate(() => { const H = document.documentElement.scrollHeight; for (const el of document.querySelectorAll('.drawer-backdrop, .drawer')) { if (el.getBoundingClientRect().height >= innerHeight - 2) { el.style.setProperty('height', `${H}px`, 'important'); el.style.setProperty('max-height', 'none', 'important'); } } });
      const png = path.join(outDir, `.tmp-${style}-${v}.png`);
      await page.screenshot({ path: png, fullPage: true });
      const out = path.join(outDir, `${SEC_AR[section]}-${NAME_AR[style]}-${VIEW_AR[v]}.jpg`);
      execFileSync('python3', ['-I', '-c', `from PIL import Image; im=Image.open(${JSON.stringify(png)}).convert('RGB'); im=im.resize((1366, round(im.height*1366/im.width)), Image.LANCZOS) if im.width>1366 else im; im.save(${JSON.stringify(out)}, quality=84)`]);
      fs.unlinkSync(png);
      console.log('ok', out);
    } catch (e) { console.log('ERR', style, v, e.message.slice(0, 120)); }
    await ctx.close();
  }
  await browser.close();
})();
