// NV1: الرجوع لتبويب رئيسي بضغطة التبويب يرجعك لموضعك فيه، لا لأعلى الصفحة. الأقسام الثلاثة على الجوال.
// node tools/ui-qa/tab-scroll.mjs
import { launch, sleep } from './rig.mjs';
let bad = 0;
for (const section of ['manga', 'anime', 'cinema']) {
  const r = await launch({ section });
  await sleep(2500);
  const target = await r.page.evaluate(() => Math.min(700, document.documentElement.scrollHeight - innerHeight - 10));
  if (target < 100) { console.log(`${section}: الرئيسية قصيرة (${target})، تخطٍّ`); await r.close(); continue; }
  await r.page.evaluate((y) => scrollTo(0, y), target);
  await sleep(400);
  const tab = (arg) => r.page.evaluate((arg) => { const b = document.querySelector(`#bottomNav [data-arg="${arg}"]`) ?? document.querySelector(`[data-act="navTo"][data-arg="${arg}"]`); b?.click(); return Boolean(b); }, arg);
  if (!(await tab('library'))) { console.log(`${section}: لا تبويب مكتبة`); await r.close(); continue; }
  await sleep(900);
  await tab('home');
  await sleep(1600);
  const y = await r.page.evaluate(() => Math.round(scrollY));
  const ok = Math.abs(y - target) <= 4;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${section}: نزلت ${target} ← رجعت ${y}`);
  await r.close();
}
process.exit(bad ? 1 : 0);
