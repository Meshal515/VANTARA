// Compound journeys: double-tap open, back during load, rapid section switching, search race.
import { launch, snap, sleep, instrument } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const h = await launch({ section: 'anime' });
const { page, log } = h;
await sleep(5000);
await instrument(page);
const stack = () => page.evaluate(() => window.__shell && document.querySelector('.page.active')?.id);

// 1) double tap on the same anime card: how many Back presses to get home?
await page.evaluate(() => { const b = document.querySelector('#animeHome button.an-card, #animeHome .an-rail button, #animeHome button[class*="card"], #animeHome button[class*="po"]'); b?.setAttribute('data-qa', 'x'); });
const hasCard = await page.locator('[data-qa="x"]').count();
if (hasCard) {
  await page.evaluate(() => { const b = document.querySelector('[data-qa="x"]'); b.click(); b.click(); });
  await sleep(2500);
  const s1 = await snap(page);
  let presses = 0;
  while ((await snap(page)).active !== 'home' && presses < 5) { await page.evaluate(() => window.__shell.handleBack()); presses++; await sleep(900); }
  console.log('double-tap open -> active', s1.active, 'back presses to home', presses);
} else console.log('no card found for double tap');

// 2) back during load, repeated 6 times, for anime and cinema refs
for (const ref of ['anime:21', 'cinema:tt0903747']) {
  for (const d of [0, 30, 120, 400, 900, 1600]) {
    await page.evaluate((ref) => ref.startsWith('anime') ? window.__shell.openAnimeRef(ref, { title: 'x' }) : window.__shell.openCinemaRef(ref, { title: 'x', type: 'series' }), ref);
    await sleep(d);
    await page.evaluate(() => window.__shell.handleBack());
    await sleep(1200);
    const s = await snap(page);
    if (s.active !== 'home' || s.transient) console.log('  BAD back-during-load', ref, d, JSON.stringify(s));
  }
}
console.log('back-during-load done', JSON.stringify(await snap(page)));
await page.screenshot({ path: `${out}/stress-after-backload.png` });

// 3) rapid section switching x12 with dock taps while previous animation is running
const pick = async (id) => { await page.locator('[data-act="toggleSections"]:visible').first().click(); await sleep(120); await page.locator(`[data-act="pickSection"][data-arg="${id}"]:visible`).first().click(); };
const order = ['cinema', 'manga', 'anime', 'cinema', 'anime', 'manga', 'cinema', 'anime', 'manga', 'anime', 'cinema', 'anime'];
for (const id of order) { try { await pick(id); } catch (e) { console.log('pick fail', id, String(e).slice(0, 80)); } await sleep(150); }
await sleep(2000);
const sw = await page.evaluate(() => {
  const vis = ['mangaHome', 'animeHome', 'cinemaHome'].map((id) => { const n = document.getElementById(id); const cs = n && getComputedStyle(n); return `${id}:${n?.hidden ? 'hidden' : 'shown'}/op${cs?.opacity}/vis${cs?.visibility}/tr${cs?.transform === 'none' ? 0 : 1}`; });
  return { section: document.querySelector('.v35').dataset.section, label: document.getElementById('brandSectionName')?.textContent, vis, layerClasses: [...document.querySelectorAll('#home [class*="layer"], #home [style*="transform"]')].length };
});
console.log('after rapid switching (expect anime)', JSON.stringify(sw));
await page.screenshot({ path: `${out}/stress-after-switch.png` });

// 4) search race: type progressively; final results must match final term
await page.locator('.nav[data-page="discover"]').first().click(); await sleep(1500);
const input = page.locator('input:visible').first();
if (await input.count()) {
  await input.click();
  for (const term of ['n', 'na', 'nar', 'naru', 'narut', 'naruto']) { await input.fill(term); await sleep(90); }
  await sleep(5000);
  const res = await page.evaluate(() => [...document.querySelectorAll('.page.active button')].map((b) => b.innerText.split('\n')[0]).filter(Boolean).slice(0, 12));
  console.log('search naruto results', JSON.stringify(res));
  await input.fill('one piece'); await sleep(200); await input.fill(''); await sleep(4000);
  const res2 = await page.evaluate(() => ({ txt: document.querySelector('.page.active')?.innerText.replace(/\s+/g, ' ').slice(0, 200) }));
  console.log('after clearing quickly', JSON.stringify(res2));
} else console.log('no search input');
const perf = await page.evaluate(() => ({ long: window.__long.length, longMax: Math.max(0, ...window.__long.map((x) => x.d)), cls: window.__cls.filter((x) => !x.recent).reduce((a, b) => a + b.v, 0).toFixed(3) }));
console.log('perf', JSON.stringify(perf), 'errors', JSON.stringify(log.errors.slice(0, 5)), 'console', JSON.stringify(log.console.filter((c) => !c.includes('404') && !c.includes('GL Driver')).slice(0, 5)));
await h.close();
