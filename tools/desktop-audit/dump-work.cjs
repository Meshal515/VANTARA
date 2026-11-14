// يطبع بنية صفحة عمل حقيقية (ثلاثة مستويات) لقسم ونمط، داخل تطبيق ويندوز (desktop-harness.cjs).
// الاستعمال: node dump-work.cjs anime|cinema|manga <style|unified> [selector]
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const [section, style, selector] = process.argv.slice(2);
const PICK = { anime: { want: /apothecary|frieren|jujutsu/i, card: '.an-card:not(.an-card--ranked)' }, cinema: { card: '.cn-poster', rail: /مسلسلات/ }, manga: { want: /one piece|solo leveling|berserk/i, card: '.page.active .work-card' } };
(async () => {
  const browser = await chromium.launch();
  const unified = style === 'unified';
  const storage = { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() }, 'vantara.appearance.v1': { style: unified ? {} : { [section]: style }, accent: {}, pureBlack: false, unifiedLook: unified } };
  const { page } = await openDesktop({ browser, storage, screen: { width: 1366, height: 768 } });
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(section === 'manga' ? 9000 : 6000);
  await page.evaluate(([sel, want, rail]) => { let cards = [...document.querySelectorAll(sel)].filter(x => x.checkVisibility?.() && x.querySelector('img')); if (rail) { const inRail = cards.filter(c => new RegExp(rail).test(c.closest('section')?.querySelector('h2,h3')?.textContent ?? '')); if (inRail.length) cards = inRail; } ((want && cards.find(x => new RegExp(want, 'i').test(x.textContent))) ?? cards[0])?.click(); }, [PICK[section].card, PICK[section].want?.source ?? null, PICK[section].rail?.source ?? null]);
  await page.waitForTimeout(8000);
  console.log(JSON.stringify(await page.evaluate(sel => {
    const root = sel?.startsWith('h2:') ? [...document.querySelectorAll('.page.active h2')].find(h => h.textContent.includes(sel.slice(3)))?.closest('section') : (document.querySelector(sel || '.page.active .aw, .page.active .cn-detail, #detail.page.active') ?? document.querySelector('.page.active'));
    const walk = (e, d) => d > 2 ? [] : [...e.children].filter(c => c.checkVisibility?.() || getComputedStyle(c).display === 'contents').flatMap(c => { const r = c.getBoundingClientRect(); return [`${'  '.repeat(d)}${c.tagName.toLowerCase()}.${String(c.className).split(' ').filter(Boolean).slice(0, 3).join('.')}${c.id ? '#' + c.id : ''} [${Math.round(r.left)},${Math.round(r.top + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}]`, ...walk(c, d + 1)]; });
    return [`ROOT ${root?.tagName}.${root?.className} data=${JSON.stringify(root?.dataset ?? {})}`, ...walk(root, 0)];
  }, selector ?? null), null, 1));
  await browser.close();
})();
