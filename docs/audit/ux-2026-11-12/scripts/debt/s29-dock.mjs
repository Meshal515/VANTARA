// الشريط السفلي أثناء الرجوع من العمل: حالته كل إطار رسم لمدة 1.4 ثانية بعد Back.
import { launch, sleep } from '../harness.mjs';
const cases = [['anime', false], ['cinema', false], ['anime', true], ['cinema', true]];
for (const [section, unified] of cases) {
  const h = await launch({ section, unified });
  await sleep(3500);
  await h.page.evaluate((s) => s === 'anime' ? window.__shell.openAnimeRef('anime:154587', { title: 'Frieren' }) : window.__shell.openCinemaRef('cinema:tt0903747', { title: 'Breaking Bad', type: 'series' }), section);
  await sleep(6000);
  const tl = await h.page.evaluate(() => new Promise((done) => {
    const dock = document.querySelector('.dock'); const out = []; const t0 = performance.now();
    window.__shell.handleBack();
    const tick = () => {
      const c = getComputedStyle(dock), r = dock.getBoundingClientRect();
      const out1 = document.querySelector('.page.page-out');
      out.push({ t: Math.round(performance.now() - t0), vis: c.visibility, op: +(+c.opacity).toFixed(2), y: Math.round(r.top), pageOut: Boolean(out1) });
      if (performance.now() - t0 < 1400) requestAnimationFrame(tick); else done(out);
    };
    requestAnimationFrame(tick);
  }));
  // ملخص: متى صار مرئيًا، وهل كانت عودته قفزة (من مخفي إلى شفافية 1 في إطار واحد)
  const firstVisible = tl.find((x) => x.vis === 'visible' && x.op > 0.05);
  let jump = null;
  for (let i = 1; i < tl.length; i++) if (tl[i - 1].vis === 'hidden' && tl[i].vis === 'visible' && tl[i].op >= 0.95) { jump = tl[i].t; break; }
  const hiddenFrames = tl.filter((x) => x.vis === 'hidden').length;
  console.log(JSON.stringify({ section, unified, frames: tl.length, hiddenFrames, firstVisibleAt: firstVisible?.t ?? null, popAt: jump, start: tl[0], mid: tl[Math.floor(tl.length / 3)], end: tl.at(-1) }));
  await h.close();
}
