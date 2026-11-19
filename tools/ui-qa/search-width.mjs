// AS1: بعد البحث في «اكتشف» لا عنصر أعرض من الشاشة (كانت الحاوية تتمدد بأصغر عرض للنتائج فيخرج الشريط من يسارها).
// الأنمي والسينما على 390 و1440، ونتائج بعناوين طويلة بلا مسافات (أسوأ حالة لأصغر عرض للمحتوى).
// node tools/ui-qa/search-width.mjs
import { launch, sleep, anilistFixture } from './rig.mjs';
// عناوين صورة المالك («Hunt»): تكفي لتكبير أصغر عرض للنتائج فوق عرض الحاوية
const LONG = 'Hunter x Hunter (2011) Greed Island Final';
let bad = 0;
for (const section of ['anime', 'cinema']) for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]]) {
  const r = await launch({ section, viewport: { width: w, height: h }, mobile });
  await r.page.route(/graphql\.anilist\.co/, (route) => {
    const out = anilistFixture(route.request().postData(), r.origin);
    for (const page of Object.values(out.data)) for (const m of page?.media ?? []) m.title = { romaji: `${LONG} ${m.id}`, english: `${LONG} ${m.id}`, native: 'ハンター×ハンター' };
    return route.fulfill({ json: out });
  });
  await sleep(600);
  await r.page.evaluate(() => { const b = document.querySelector('[data-act="openSearch"]'); if (b) b.click(); else window.__shell.showPage('discover'); });
  await sleep(800);
  const host = section === 'anime' ? '#animeDiscover' : '#cinemaDiscover';
  const input = await r.page.$(`${host} input`);
  if (!input) { console.log(`${section}/${w}: لا خانة بحث`); await r.close(); continue; }
  await input.fill('Hunt');
  await sleep(2500);
  // الحاوية المرجع: عمود «اكتشف» نفسه (.ad أو أول ابن للمضيف). شريط البحث والنتائج لا يخرجان عن حدوده
  const wide = await r.page.evaluate((host) => {
    const box = document.querySelector(`${host} > *`);
    if (!box) return ['لا حاوية'];
    const c = box.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    return [...box.children].flatMap((n) => [n, ...n.querySelectorAll('.ad-search, .ad-results, .an-grid')]).map((n) => ({ n, b: n.getBoundingClientRect() }))
      .filter(({ n, b }) => b.width > 0 && !n.hidden && getComputedStyle(n).display !== 'none' && (b.left < c.left - 1 || b.right > c.right + 1 || b.left < -1 || b.right > vw + 1))
      .slice(0, 5).map(({ n, b }) => `${n.tagName.toLowerCase()}.${String(n.className).split(' ')[0]} L=${Math.round(b.left)} W=${Math.round(b.width)} (الحاوية L=${Math.round(c.left)} W=${Math.round(c.width)})`);
  }, host);
  const scrollX = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (wide.length || scrollX > 1) bad++;
  console.log(`${wide.length || scrollX > 1 ? 'FAIL' : 'ok  '} ${section}/${w}: ${wide.join(' | ') || 'لا شيء خارج الشاشة'}${scrollX > 1 ? ` · تمرير أفقي ${scrollX}px` : ''}`);
  await r.close();
}
process.exit(bad ? 1 : 0);
