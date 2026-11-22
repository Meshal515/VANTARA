// بوابة T0 لخطة Glass (docs/audits/GLASS_UI_PLACEMENT.md، القسم 9): المظهر الحالي لا يتغير بالبكسل.
// شغّلها مرتين: على نسخة قبل التغيير (git worktree) وعلى الحالية، ثم قارن المجلدين بأي أداة فروق صور.
// node tools/ui-qa/glass-t0.mjs <جذر المستودع> <مجلد اللقطات>
// ملاحظة مقاسة: الصفحة الرئيسية للسينما فيها حركة تختلف ببضع بكسلات بين تشغيلين للنسخة نفسها، فلا تُحسب فرقًا.
const root = process.argv[2], out = process.argv[3];
const { launch, sleep } = await import(root + '/tools/ui-qa/rig.mjs');
const shots = [];
for (const [section, size] of [['manga', [390, 844]], ['anime', [390, 844]], ['cinema', [390, 844]], ['anime', [1366, 768]], ['cinema', [1920, 1080]]]) {
  const h = await launch({ section, viewport: { width: size[0], height: size[1] }, mobile: size[0] < 1000, net: 'fixture', imageDelay: 0 });
  try {
    await sleep(2200);
    const tag = `${section}-${size[0]}`;
    await h.page.screenshot({ path: `${out}/${tag}-home.png` }); shots.push(`${tag}-home`);
    if (size[0] < 1000) {
      await h.page.evaluate(() => document.getElementById('sectionSwitch')?.click()); await sleep(900);
      await h.page.screenshot({ path: `${out}/${tag}-switch.png` }); shots.push(`${tag}-switch`);
      await h.page.evaluate(() => document.getElementById('dockScrim')?.click()); await sleep(800);
    }
    await h.page.evaluate((k) => window.__open(k), section === 'cinema' ? 'series' : section); await sleep(2600);
    await h.page.screenshot({ path: `${out}/${tag}-work.png` }); shots.push(`${tag}-work`);
    await h.page.evaluate(() => scrollTo({ top: 520, behavior: 'instant' })); await sleep(600);
    await h.page.screenshot({ path: `${out}/${tag}-work2.png` }); shots.push(`${tag}-work2`);
    if (h.log.errors.length) console.log('ERR', tag, h.log.errors[0]);
  } finally { await h.close(); }
}
console.log(shots.length, 'shots');
