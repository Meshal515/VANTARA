// لقطات لكل أنماط صفحة العمل في الأقسام الثلاثة (أعلى الصفحة وبعد التمرير).
// node tools/ui-qa/shots.mjs [out] [net=fixture|live] [only=manga,anime,series,movie]
import { mkdir } from 'node:fs/promises';
import { launch, sleep, PAGE_OF } from './rig.mjs';

const out = process.argv[2] ?? 'ui-qa-out/shots';
const net = process.argv[3] ?? 'fixture';
const only = (process.argv[4] ?? 'manga,anime,series,movie').split(',');
const sizes = (process.env.SIZES ?? 'phone').split(',');
const VIEW = { phone: { width: 390, height: 844 }, ipad: { width: 820, height: 1180 }, pc: { width: 1440, height: 900 } };
await mkdir(out, { recursive: true });
const { MANGA_WORK_STYLES, WORK_STYLES, CINEMA_WORK_STYLES } = await import('../../apps/web/v35/appearance.js');
const LOOKS = { manga: MANGA_WORK_STYLES, anime: WORK_STYLES, series: CINEMA_WORK_STYLES, movie: CINEMA_WORK_STYLES };
const KEY = { manga: 'manga', anime: 'anime', series: 'cinema', movie: 'cinema' };
const LIVE = { anime: 'anime:16498', series: 'cinema:tt0903747', movie: 'cinema:tt0468569' };

for (const size of sizes) for (const kind of only) for (const look of LOOKS[kind].map((s) => s.id)) {
  const h = await launch({ section: KEY[kind], viewport: VIEW[size], mobile: size !== 'pc', net, appearance: { style: { [KEY[kind]]: look } } });
  try {
    if (net === 'live' && kind !== 'manga') {
      await h.page.evaluate(([kind, ref]) => kind === 'anime' ? window.__shell.openAnimeRef(ref, { title: 'x' }) : window.__shell.openCinemaRef(ref, { title: 'x', type: kind }), [kind, LIVE[kind]]);
      await sleep(6000);
    } else {
      await h.page.evaluate((kind) => window.__open(kind), kind);
      await sleep(2200);
    }
    await h.page.screenshot({ path: `${out}/${kind}-${look}-${size}-0.png` });
    const max = await h.page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    for (const [i, y] of [[1, 300], [2, 900]]) {
      if (y > max + 50) break;
      await h.page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
      await sleep(350);
      await h.page.screenshot({ path: `${out}/${kind}-${look}-${size}-${i}.png` });
    }
    const info = await h.page.evaluate((id) => ({ h: document.documentElement.scrollHeight, look: document.getElementById(id)?.dataset.look ?? document.querySelector(`#${id} [data-style]`)?.dataset.style ?? document.getElementById(id)?.dataset.style ?? null }), PAGE_OF[kind]);
    console.log(kind, look, size, JSON.stringify(info), h.log.errors.length ? `ERRORS ${h.log.errors[0]}` : '');
  } finally { await h.close(); }
}
