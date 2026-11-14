// خط أساس الحركة: لكل مسار، عدد الإطارات وأطول توقف خلال 1.2 ثانية بعد بدء الانتقال.
import { launch, sleep } from '../harness.mjs';
const frames = (page, act) => page.evaluate((act) => new Promise((done) => {
  const ts = []; const t0 = performance.now();
  (0, eval)(act);
  const tick = (t) => { ts.push(t); if (t - t0 < 1200) requestAnimationFrame(tick); else { const gaps = ts.slice(1).map((x, i) => x - ts[i]); done({ frames: ts.length, maxGap: Math.round(Math.max(...gaps)), over50: gaps.filter((g) => g > 50).length }); } };
  requestAnimationFrame(tick);
}), act);
const open = { anime: "window.__shell.openAnimeRef('anime:154587',{title:'Frieren'})", cinema: "window.__shell.openCinemaRef('cinema:tt0903747',{title:'Breaking Bad',type:'series'})" };
const out = [];
for (const unified of [false, true]) for (const section of ['anime', 'cinema']) {
  const h = await launch({ section, unified });
  await sleep(4000);
  const o = await frames(h.page, open[section]); await sleep(5000);
  const b = await frames(h.page, 'window.__shell.handleBack()'); await sleep(2500);
  const d = await frames(h.page, "window.__shell.showPage('discover')"); await sleep(2500);
  const hm = await frames(h.page, "window.__shell.showPage('home')");
  out.push({ path: `${unified ? 'موحد' : 'قسم'}·${section}`, open: o, back: b, toDiscover: d, toHome: hm });
  await h.close();
}
for (const r of out) console.log(r.path.padEnd(12), ['open', 'back', 'toDiscover', 'toHome'].map((k) => `${k}: ${r[k].frames}f max ${r[k].maxGap}ms jank ${r[k].over50}`).join(' | '));
