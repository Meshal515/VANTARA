// تحليل إطارات انتقالات صفحة العمل لكل الأنماط: فتح من الرئيسية (في أعلاها وبعد تمرير)، رجوع (من أعلى العمل وبعد
// تمرير)، والتحقق من استعادة الموضع. يفشل بقائمة مخالفات لكل مسار.
// node tools/ui-qa/transitions.mjs [only=manga,anime,series,movie] [looks=a,b]   · VERBOSE=1 يطبع الخط الزمني
import { launch, sleep, snap, PAGE_OF } from './rig.mjs';
import { installRecorder, record, analyze, timeline } from './frames.mjs';

const only = (process.argv[2] ?? 'manga,anime,series,movie').split(',');
const lookFilter = process.argv[3]?.split(',') ?? null;
const { MANGA_WORK_STYLES, WORK_STYLES, CINEMA_WORK_STYLES } = await import('../../apps/web/v35/appearance.js');
const LOOKS = { manga: MANGA_WORK_STYLES, anime: WORK_STYLES, series: CINEMA_WORK_STYLES, movie: CINEMA_WORK_STYLES };
const KEY = { manga: 'manga', anime: 'anime', series: 'cinema', movie: 'cinema' };
const verbose = Boolean(process.env.VERBOSE);
let bad = 0;
const report = (name, frames, issues, extra = []) => {
  const all = [...issues, ...extra];
  if (all.length) bad++;
  console.log(`${all.length ? 'FAIL' : 'ok  '} ${name} (${frames.length} إطار)`);
  for (const i of all) console.log(`       ${i.kind} ×${i.n ?? 1} ${i.first ?? ''}–${i.last ?? ''}ms: ${i.detail}`);
  if (verbose || (all.length && process.env.TIMELINE)) console.log(timeline(frames));
};

for (const kind of only) for (const look of LOOKS[kind].map((s) => s.id)) {
  if (lookFilter && !lookFilter.includes(look)) continue;
  const h = await launch({ section: KEY[kind], appearance: { style: { [KEY[kind]]: look } } });
  const { page } = h;
  const id = PAGE_OF[kind];
  try {
    await sleep(1200);
    await installRecorder(page);
    for (const homeY of [0, 600]) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), homeY);
      await sleep(150);
      const startY = await page.evaluate(() => Math.round(scrollY));
      let f = await record(page, (kind) => { window.__open(kind); }, kind, 900);
      report(`${kind}/${look} فتح من الرئيسية y=${startY}`, f, analyze(f, { from: 'home', to: id }));
      await sleep(900);
      // رجوع من أعلى صفحة العمل
      f = await record(page, () => { window.__shell.handleBack(); }, null, 900);
      const s1 = await snap(page);
      report(`${kind}/${look} رجوع من الأعلى`, f, analyze(f, { from: id, to: 'home' }), Math.abs(s1.y - startY) > 2 ? [{ kind: 'scroll-lost', detail: `الرئيسية عادت إلى ${s1.y} بدل ${startY}` }] : []);
      // فتح ثم تمرير عميق ثم رجوع
      await page.evaluate((kind) => window.__open(kind), kind);
      await sleep(1500);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const deep = Math.min(700, Math.max(0, max));
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), deep);
      await sleep(250);
      f = await record(page, () => { window.__shell.handleBack(); }, null, 900);
      const s2 = await snap(page);
      report(`${kind}/${look} رجوع بعد تمرير ${deep}`, f, analyze(f, { from: id, to: 'home' }), Math.abs(s2.y - startY) > 2 ? [{ kind: 'scroll-lost', detail: `الرئيسية عادت إلى ${s2.y} بدل ${startY}` }] : []);
      await sleep(300);
    }
    if (h.log.errors.length) { bad++; console.log(`FAIL ${kind}/${look} أخطاء JS: ${h.log.errors.join(' | ').slice(0, 400)}`); }
  } finally { await h.close(); }
}
console.log(bad ? `\n${bad} مسارًا فيه مخالفات` : '\nكل المسارات سليمة');
process.exit(bad ? 1 : 0);
