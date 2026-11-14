// يفتح صفحة عمل حقيقية (مثل dump-work) ويقيّم تعبير JS ويطبع نتيجته. node eval-work.cjs anime screen "expr"
const { openDesktop, chromium } = require('./desktop-harness.cjs');
const [section, style, expr, w = '1366', h = '768'] = process.argv.slice(2);
const PICK = { anime: { want: /apothecary|frieren|jujutsu/i, card: '.an-card:not(.an-card--ranked)' }, cinema: { card: '.cn-poster' }, manga: { want: /one piece|solo leveling|berserk/i, card: '.page.active .work-card' } };
(async () => {
  const browser = await chromium.launch();
  const unified = style === 'unified';
  const storage = { 'vantara.session.v1': { token: 'x', user: { userId: 'u', name: 't' }, savedAt: Date.now() }, 'vantara.appearance.v1': { style: unified ? {} : { [section]: style }, accent: {}, pureBlack: false, unifiedLook: unified } };
  const { page } = await openDesktop({ browser, storage, screen: { width: +w, height: +h } });
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.evaluate(s => [...document.querySelectorAll('.drawer button')].find(x => x.textContent.trim().toUpperCase().startsWith(s.toUpperCase()))?.click(), section);
  await page.waitForTimeout(section === 'manga' ? 9000 : 6000);
  await page.evaluate(([sel, want]) => { const cards = [...document.querySelectorAll(sel)].filter(x => x.checkVisibility?.() && x.querySelector('img')); ((want && cards.find(x => new RegExp(want, 'i').test(x.textContent))) ?? cards[0])?.click(); }, [PICK[section].card, PICK[section].want?.source ?? null]);
  await page.waitForTimeout(8000);
  console.log(JSON.stringify(await page.evaluate(expr), null, 1));
  await browser.close();
})();
