// الفحص الشامل لأنماط صفحة العمل ببيانات حقيقية داخل تطبيق ويندوز (desktop-harness.cjs):
// مانجا بفصول حقيقية من المصادر المدمجة، مسلسل سينما بمواسم، أنمي بمواسم وحلقات.
// لكل نمط × مقاس: لف أفقي، فيض، قص الأغلفة، فراغات كبيرة، زر التشغيل في الشاشة الأولى، عدد الفصول/الحلقات المرسومة.
// مرة لكل نمط (1366 مفتوح): تبديل الموسم (عناصر أعيد رسمها، صور طُلبت من جديد، لقطات متتالية)، والدخول
// والخروج (CLS، لقطات، رجوع موضع التمرير، عدد مستمعي التمرير/التغيير قبل وبعد 5 دورات).
// الاستعمال: node audit-full.cjs anime|cinema|manga [style,...]
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const fs = require('fs');
const [section, onlyArg] = process.argv.slice(2);
const STYLES = { anime: ['core', 'platform', 'card', 'screen', 'episode', 'unified'], cinema: ['current', 'premiere', 'poster', 'marquee', 'series', 'unified'], manga: ['page', 'gallery', 'profile', 'resume', 'webtoon', 'unified'] };
// شاشات فعلية؛ تطبيق ويندوز يكبّر ما فوق ~1480 (window-zoom.cjs) والحزمة تحاكيه (screen)
const VIEWS_ALL = [
  { id: 'pc1366', screen: { width: 1366, height: 768 }, rail: false, full: true, journey: true },
  { id: 'pc1366-rail', screen: { width: 1366, height: 768 }, rail: true },
  { id: 'pc1600', screen: { width: 1600, height: 900 }, rail: false },
  { id: 'pc1920', screen: { width: 1920, height: 1080 }, rail: false },
  { id: 'pc1920-rail', screen: { width: 1920, height: 1080 }, rail: true, full: true },
  { id: 'pc2560-rail', screen: { width: 2560, height: 1440 }, rail: true },
  { id: 'm412', viewport: { width: 412, height: 915 }, mobile: true, full: true },
  { id: 'm390', viewport: { width: 390, height: 844 }, mobile: true },
];
const VIEWS = process.env.VIEWS ? VIEWS_ALL.filter(v => process.env.VIEWS.split(',').includes(v.id)) : VIEWS_ALL;
const PICK = {
  anime: { want: /apothecary|frieren|jujutsu|demon slayer|one piece/i, card: '.an-card:not(.an-card--ranked)' },
  cinema: { want: null, card: '.cn-poster', rail: /مسلسلات/ },
  manga: { want: /one piece|solo leveling|berserk|jujutsu/i, card: '.page.active .work-card' },
};
const out = `shots/full/${section}`;
fs.mkdirSync(`${out}/frames`, { recursive: true });

const measure = () => {
  const vis = (e) => e.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true });
  const root = [...document.querySelectorAll('#detail, .aw, .cn-detail, .page.active')].find(vis) ?? document.querySelector('#root .v35');
  const rows = [], crops = [];
  for (const el of root.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 150) {
      const head = el.closest('section')?.querySelector('h2,h3')?.textContent?.trim().slice(0, 30) ?? '';
      rows.push(`${head || String(el.className).slice(0, 30)} (${el.children.length}: ${el.clientWidth}→${el.scrollWidth})`);
    }
    if (el.tagName === 'IMG' && el.naturalWidth && r.width > 110 && r.height > 80 && cs.objectFit === 'cover') {
      const ir = el.naturalWidth / el.naturalHeight, fr = r.width / r.height, k = Math.min(fr / ir, ir / fr);
      if (k < 0.8) crops.push(`${String(el.className || el.parentElement.className).slice(0, 28)} ${Math.round(r.width)}x${Math.round(r.height)} ${Math.round(k * 100)}%`);
    }
  }
  // فراغات: أكبر مسافة عمودية بين كتل محتوى ظاهرة (نص أو صورة أو زر) على عرض الصفحة
  const marks = [...root.querySelectorAll('img, h1, h2, h3, p, button, li, a, .ch-row, [data-chapter]')].filter(vis).map((e) => e.getBoundingClientRect()).filter((r) => r.height > 6 && r.width > 6).map((r) => [r.top + scrollY, r.bottom + scrollY]).sort((a, b) => a[0] - b[0]);
  let gap = 0, gapAt = 0, bottom = marks[0]?.[1] ?? 0;
  for (const m of marks) { if (m[0] - bottom > gap) { gap = m[0] - bottom; gapAt = bottom; } bottom = Math.max(bottom, m[1]); }
  // عرض المحتوى الفعلي مقابل عرض الصفحة (عمود ضيق وسط شاشة فارغة)
  const xs = [...root.querySelectorAll('h1, h2, p, button, img, li')].filter(vis).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 20 && r.top + scrollY < 2400);
  const left = Math.min(...xs.map((r) => r.left)), right = Math.max(...xs.map((r) => r.right)), rw = root.getBoundingClientRect().width;
  const play = [...root.querySelectorAll('button, a')].find((b) => vis(b) && /شاهد|تابع|اقرأ|ابدأ|شغّل/.test(b.textContent) && b.getBoundingClientRect().width > 30);
  const units = [...root.querySelectorAll('.ch-row, [data-chapter], .an-er-row, .an-er, .cn-ep, .aw-ep, .mw-ch')].filter(vis).length;
  return {
    look: root.dataset?.style ?? root.dataset?.look ?? null, unified: root.hasAttribute?.('data-unified') ?? false,
    title: (root.querySelector('h1, .mw-title, .an-mark-text, .cn-mark-text')?.textContent ?? '').trim().slice(0, 40),
    rows, crops: crops.slice(0, 6), maxGap: Math.round(gap), gapAt: Math.round(gapAt),
    contentPct: isFinite(left) ? Math.round((right - left) / rw * 100) : null,
    playFirstScreen: play ? play.getBoundingClientRect().bottom <= innerHeight && play.getBoundingClientRect().top >= 0 : null,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1, height: document.documentElement.scrollHeight, units,
  };
};

async function openSection(page, mobile) {
  await page.evaluate(([s, mobile]) => {
    const pick = [...document.querySelectorAll('button, a, [role=radio]')].filter((x) => x.checkVisibility?.());
    const hit = (x) => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase());
    (pick.find((x) => !mobile && x.closest('.drawer') && hit(x)) ?? pick.find(hit))?.click();
  }, [section, mobile]);
  await page.waitForTimeout(section === 'manga' ? 9000 : 6000);
}
async function openWork(page) {
  const p = PICK[section];
  return page.evaluate(([sel, want, rail]) => {
    let cards = [...document.querySelectorAll(sel)].filter((x) => x.checkVisibility?.() && x.querySelector('img'));
    if (rail) { const r = new RegExp(rail); const inRail = cards.filter((c) => r.test(c.closest('section')?.querySelector('h2,h3')?.textContent ?? '')); if (inRail.length) cards = inRail; }
    const c = (want && cards.find((x) => new RegExp(want, 'i').test(x.textContent))) ?? cards[0];
    c?.scrollIntoView({ block: 'center' });
    // موضع الرئيسية الحقيقي لحظة الفتح (بعد توسيط البطاقة)، لا قبله
    window.__homeScrollAtOpen = Math.round(scrollY);
    c?.click();
    return c?.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) ?? null;
  }, [p.card, p.want?.source ?? null, p.rail?.source ?? null]);
}
async function settleWork(page) {
  await page.waitForTimeout(7000);
  if (section === 'manga') for (let i = 0; i < 10; i++) { const n = await page.evaluate(() => document.querySelectorAll('#detail .ch-row, #detail [data-chapter], #detail li').length); if (n > 30) break; await page.waitForTimeout(3000); }
  await page.evaluate(async () => { const e = document.scrollingElement; for (let y = 0; y < Math.min(e.scrollHeight, 14000); y += 700) { e.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } e.scrollTo(0, 0); });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch();
  const styles = onlyArg ? onlyArg.split(',') : STYLES[section];
  const report = { section, at: new Date().toISOString(), styles: {} };
  for (const style of styles) {
    const r = report.styles[style] = {};
    for (const view of VIEWS) {
      const storage = {
        'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() },
        'vantara.appearance.v1': { style: style === 'unified' ? {} : { [section]: style }, accent: {}, pureBlack: false, unifiedLook: style === 'unified' },
        ...(view.rail ? { 'vantara.rail.collapsed': '1' } : {}),
      };
      const { ctx, page } = await openDesktop({ browser, viewport: view.viewport, screen: view.screen, storage, mobile: view.mobile });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message.slice(0, 140)));
      try {
        await page.goto('http://127.0.0.1:8765/'); await page.waitForTimeout(4000);
        await openSection(page, view.mobile);
        let homeScroll = null;
        if (view.journey) { await page.evaluate(() => scrollTo(0, 900)); await page.waitForTimeout(600); homeScroll = await page.evaluate(() => scrollY); await page.evaluate(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false }); }); }
        const work = await openWork(page);
        const homeScrollAtOpen = await page.evaluate(() => window.__homeScrollAtOpen ?? null).catch(() => null);
        // الدخول: لقطات متتالية أول 900ms
        if (view.journey) { for (let i = 0, t = Date.now(); Date.now() - t < 900; i++) await page.screenshot({ path: `${out}/frames/${style}-enter-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 45 }); }
        await settleWork(page);
        const m = await page.evaluate(measure);
        m.work = work; m.errors = errors.slice(0, 3);
        const slug = `${style}-${view.id}`;
        await page.screenshot({ path: `${out}/${slug}.png` });
        if (view.full || process.env.FULLALL) await page.screenshot({ path: `${out}/${slug}-full.png`, fullPage: true });
        if (view.journey) {
          m.enterCls = +(await page.evaluate(() => window.__cls ?? 0)).toFixed(4);
          // تبديل الموسم: كم عنصرًا أُزيل/أضيف، وكم صورة طُلبت، ولقطات
          const seasons = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')].filter((b) => b.checkVisibility() && /^(الموسم\s*\d+|م\s?\d+)/.test(b.textContent.trim())).map((b) => b.textContent.trim().replace(/\s+/g, ' ')));
          m.seasonTabs = seasons.length;
          if (seasons.length > 1) {
            const target = seasons.find((s, i) => i > 0) ;
            const imgs = []; const onReq = (q) => { if (q.resourceType() === 'image') imgs.push(q.url()); }; page.on('request', onReq);
            await page.evaluate(() => { window.__mut = { added: 0, removed: 0 }; window.__mo = new MutationObserver((l) => { for (const x of l) { window.__mut.added += x.addedNodes.length; window.__mut.removed += x.removedNodes.length; } }); window.__mo.observe(document.body, { childList: true, subtree: true }); window.__scrollBefore = scrollY; });
            const t0 = Date.now();
            await page.evaluate((t) => [...document.querySelectorAll('button, [role=tab]')].find((b) => b.checkVisibility() && b.textContent.trim().replace(/\s+/g, ' ') === t)?.click(), target);
            for (let i = 0; Date.now() - t0 < 1200; i++) await page.screenshot({ path: `${out}/frames/${style}-season-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 45 });
            await page.waitForTimeout(1500);
            m.seasonSwitch = { to: target, ...(await page.evaluate(() => { window.__mo.disconnect(); return { ...window.__mut, scrollJump: Math.round(scrollY - window.__scrollBefore) }; })), imageRequests: imgs.length };
            // الرجوع للموسم الأول: هل تُطلب صوره من جديد؟
            imgs.length = 0;
            await page.evaluate((t) => [...document.querySelectorAll('button, [role=tab]')].find((b) => b.checkVisibility() && b.textContent.trim().replace(/\s+/g, ' ') === t)?.click(), seasons[0]);
            await page.waitForTimeout(1500);
            m.seasonSwitch.backImageRequests = imgs.length;
            page.off('request', onReq);
          }
          // الخروج: الرجوع للرئيسية، لقطات، وموضع التمرير
          await page.evaluate(() => scrollTo(0, 0));
          const back = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.checkVisibility() && /رجوع|عودة|back/i.test(x.getAttribute('aria-label') ?? '')); b?.click(); return !!b; });
          if (!back) await page.goBack().catch(() => {});
          for (let i = 0, t = Date.now(); Date.now() - t < 900; i++) await page.screenshot({ path: `${out}/frames/${style}-exit-${String(i).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 45 });
          await page.waitForTimeout(800);
          m.exit = { viaButton: back, homeScrollBefore: homeScrollAtOpen, homeScrollAfter: await page.evaluate(() => Math.round(scrollY)) };
        }
        r[view.id] = m;
        console.log(`${style} ${view.id} | rows ${m.rows.length} | crops ${m.crops.length} | gap ${m.maxGap} | content ${m.contentPct}% | play1st ${m.playFirstScreen} | units ${m.units} | ovx ${m.overflowX}${m.seasonSwitch ? ` | season +${m.seasonSwitch.added}/-${m.seasonSwitch.removed} img ${m.seasonSwitch.imageRequests}/${m.seasonSwitch.backImageRequests} jump ${m.seasonSwitch.scrollJump}` : ''}${m.exit ? ` | exit scroll ${m.exit.homeScrollBefore}→${m.exit.homeScrollAfter}` : ''} | ${m.work}`);
      } catch (e) { r[view.id] = { error: e.message.slice(0, 200) }; console.log(style, view.id, 'ERROR', e.message.slice(0, 120)); }
      await ctx.close();
      fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
    }
  }
  await browser.close();
})();
