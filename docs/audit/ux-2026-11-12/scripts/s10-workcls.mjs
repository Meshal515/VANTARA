// Layout stability of work pages while data/images arrive, and of Back.
import { launch, sleep, instrument, snap } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const h = await launch({ section: 'anime' });
const { page } = h;
await sleep(5000);
await instrument(page);
const take = async (label) => {
  const r = await page.evaluate(() => { const c = window.__cls.splice(0); return { total: +c.filter((x) => !x.recent).reduce((a, b) => a + b.v, 0).toFixed(3), top: c.filter((x) => x.v > 0.005).map((x) => `${x.t}:${x.v}:${x.src.join('/')}`) }; });
  console.log(label, JSON.stringify(r));
};
for (const [ref, kind, opt] of [['anime:21', 'anime', {}], ['anime:198188', 'anime', {}], ['cinema:tt0903747', 'cinema', { type: 'series' }], ['cinema:tt0816692', 'cinema', { type: 'movie' }]]) {
  await take('pre');
  await page.evaluate(({ ref, kind, opt }) => kind === 'anime' ? window.__shell.openAnimeRef(ref, { title: 'QA' }) : window.__shell.openCinemaRef(ref, { title: 'QA', ...opt }), { ref, kind, opt });
  const shots = [];
  for (const t of [150, 600, 1500, 4000]) { await sleep(t - (shots.at(-1) ?? 0)); shots.push(t); await page.screenshot({ path: `${out}/work-${ref.replace(':', '_')}-${t}.png` }); }
  await take(`open ${ref}`);
  await page.evaluate(() => scrollTo(0, 900)); await sleep(800);
  await take(`scroll ${ref}`);
  await page.evaluate(() => window.__shell.handleBack()); await sleep(1500);
  await take(`back ${ref}`);
}
await h.close();
