// هل يصل بنر العمل وشعاره إلى شاشة تحميل مشغل ويندوز؟ يفتح عملًا حقيقيًا داخل التطبيق (desktop-harness)، يضغط
// التشغيل، ويسجّل كل ما يُرسل إلى طبقة المشغل (VantaraDesktop.playerOverlay) وإلى startPlayback، ثم يطبع حقل art
// (backdrop/logo) وحالة التحميل. node play-art.cjs anime|cinema
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const [section = 'anime'] = process.argv.slice(2);
const PICK = { anime: { want: /apothecary|frieren|jujutsu/i, card: '.an-card:not(.an-card--ranked)' }, cinema: { card: '.cn-poster', rail: /مسلسلات/ } };
(async () => {
  const browser = await chromium.launch();
  const { page } = await openDesktop({ browser, storage: { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() } } });
  // تجسس على الجسر قبل أن يقرأه التطبيق: نفس الأسماء، والنتائج كما في الحزمة (التشغيل نفسه خارج المتصفح)
  await page.addInitScript(() => {
    window.__calls = [];
    const wrap = () => {
      const b = window.VantaraDesktop; if (!b || b.__spied) return;
      const spy = { ...b, __spied: true };
      for (const k of ['playerOverlay', 'startPlayback', 'showPlayer', 'prewarmTorrent']) spy[k] = async (a) => { window.__calls.push({ k, a: JSON.parse(JSON.stringify(a ?? null)) }); return k === 'playerOverlay' ? true : k === 'startPlayback' ? { session: 's1', ok: true } : true; };
      window.VantaraDesktop = Object.freeze(spy);
    };
    wrap(); document.addEventListener('readystatechange', wrap);
  });
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate((s) => [...document.querySelectorAll('.drawer button')].find((x) => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(6500);
  const p = PICK[section];
  await page.evaluate(([sel, want, railRe]) => { let c = [...document.querySelectorAll(sel)].filter((x) => x.checkVisibility?.() && x.querySelector('img')); if (railRe) { const r = c.filter((x) => new RegExp(railRe).test(x.closest('section')?.querySelector('h2,h3')?.textContent ?? '')); if (r.length) c = r; } ((want && c.find((x) => new RegExp(want, 'i').test(x.textContent))) ?? c[0])?.click(); }, [p.card, p.want?.source ?? null, p.rail?.source ?? null]);
  await page.waitForTimeout(9000);
  // زر التشغيل الأساسي في صفحة العمل
  const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('.page.active .aw-still-play, .page.active #cinemaPlay, .page.active .wl-cta')].find((x) => x.checkVisibility()) ?? [...document.querySelectorAll('.page.active button')].find((x) => x.checkVisibility() && /^(شاهد|تابع الحلقة|ابدأ|تشغيل)/.test(x.textContent.trim())); b?.click(); return b?.textContent?.trim().slice(0, 30) ?? null; });
  await page.waitForTimeout(20000);
  const out = await page.evaluate(() => ({ calls: window.__calls.map((c) => ({ k: c.k, keys: Object.keys(c.a ?? {}).slice(0, 30), art: c.a?.art ?? null, backdrop: c.a?.backdrop ?? c.a?.media?.banner ?? null, logo: c.a?.logo ?? c.a?.media?.logo ?? null, title: c.a?.title ?? null, ready: c.a?.ready, loadProgress: c.a?.loadProgress })), sheet: !!document.querySelector('.sheet, [role=dialog]')?.checkVisibility(), sheetText: document.querySelector('.sheet, [role=dialog]')?.textContent?.trim().slice(0, 160) ?? null }));
  console.log(JSON.stringify({ clicked, ...out }, null, 1).slice(0, 4000));
  await browser.close();
})();
