import { launch, snap, sleep } from './harness.mjs';
const out = process.env.VANTARA_SHOTS ?? 'audit-shots';
const h = await launch({ section: 'anime' });
await sleep(2500);
await h.page.evaluate(() => window.__shell.openAnimeRef('anime:198188', { title: 'Tatsuki Fujimoto 17-26' }));
await sleep(5000);
await h.page.screenshot({ path: `${out}/movie-17-26.png` });
const info = await h.page.evaluate(() => {
  const p = document.querySelector('#anime');
  return {
    active: document.querySelector('.page.active')?.id,
    text: p?.innerText.replace(/\s+/g, ' ').slice(0, 900),
    episodeNodes: p?.querySelectorAll('[data-episode], .an-ep, .ep, .an-eps button').length,
  };
});
console.log(JSON.stringify(info, null, 1));
await h.page.evaluate(() => scrollTo(0, 700));
await sleep(800);
await h.page.screenshot({ path: `${out}/movie-17-26-b.png` });
console.log('errors', h.log.errors);
await h.close();
