// لمس حقيقي (CDP) على الشريط في Glass: سحب العدسة إلى قسم آخر يحوّل القسم، وسحبها بين الوجهات يحوّل الصفحة،
// والضغطة التالية بعد السحب تستجيب. بلاغ المالك 22 نوفمبر: «احط التحديد على المانجا يقعد عليها لكن ما يحوّل».
// node tools/ui-qa/glass-touch.mjs   (صفر = سليم)
import { launch, sleep } from './rig.mjs';
const fails = [];
const center = (h, sel) => h.page.evaluate((sel) => { const r = document.querySelector(sel)?.getBoundingClientRect(); return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
const drag = async (cdp, a, b, steps = 14) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const tap = async (cdp, p) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
const sectionOf = (h) => h.page.evaluate(() => document.querySelector('.dock')?.dataset.section);
const pageOf = (h) => h.page.evaluate(() => document.querySelector('.dock .nav.active')?.dataset.page);
for (const material of ['glass', 'current']) {
  const h = await launch({ section: 'anime', viewport: { width: 390, height: 844 }, mobile: true, net: 'fixture', appearance: { material } });
  const cdp = await h.context.newCDPSession(h.page);
  try {
    await sleep(1800);
    // 1) فتح المبدّل ثم سحب من الأنمي إلى المانجا وترك الإصبع
    await tap(cdp, await center(h, '.dock-switch')); await sleep(700);
    const from = await center(h, '#secOpt-anime');
    const to = await center(h, '#secOpt-manga');
    await drag(cdp, from, to); await sleep(1500);
    const sec = await sectionOf(h);
    // سحب الاختيار داخل المبدّل المفتوح ميزة العدسة (Glass) وحدها؛ في الحالي الاختيار بالضغط
    if (material === 'glass' && sec !== 'manga') fails.push(`${material}: سحب المبدّل إلى المانجا لم يحوّل (القسم ${sec})`);
    console.log(material, 'سحب القسم →', sec);
    if (material !== 'glass') { await tap(cdp, await center(h, '#secOpt-anime')); await sleep(900); }
    // 2) سحب العدسة بين الوجهات (الرئيسية ← اكتشف)
    const home = await center(h, '.dock .nav[data-page="home"]'), disc = await center(h, '.dock .nav[data-page="discover"]');
    await drag(cdp, home, disc); await sleep(1200);
    const p1 = await pageOf(h);
    console.log(material, 'سحب الوجهة →', p1);
    if (material === 'glass' && p1 !== 'discover') fails.push(`${material}: سحب العدسة إلى اكتشف لم يحوّل (${p1})`);
    // 3) أول ضغطة بعد السحب تستجيب
    await tap(cdp, await center(h, '.dock .nav[data-page="library"]')); await sleep(1200);
    const p2 = await pageOf(h);
    console.log(material, 'ضغطة بعد السحب →', p2);
    if (p2 !== 'library') fails.push(`${material}: أول ضغطة بعد السحب لم تستجب (${p2})`);
    // 4) الشريط مصغّر بعد التمرير: ضغطة واحدة على وجهة تنقل إليها (كانت تكبّر الشريط فقط، بلاغ المالك)
    await h.page.evaluate(() => window.__shell.showPage('home')); await sleep(900);
    for (const y of [120, 300, 520, 760]) { await h.page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y); await sleep(90); }
    await sleep(700);
    const compact = await h.page.evaluate(() => /(^| )(d|g)-compact( |$)/.test(document.querySelector('.dock').className));
    await tap(cdp, await center(h, '.dock .nav[data-page="majlis"]')); await sleep(1300);
    const p3 = await pageOf(h);
    console.log(material, 'ضغطة على شريط مصغّر', compact ? '(مصغّر)' : '(لم يصغر!)', '→', p3);
    if (!compact) fails.push(`${material}: الشريط لم يصغر بالتمرير`);
    if (p3 !== 'majlis') fails.push(`${material}: ضغطة على الشريط المصغّر لم تنقل (${p3})`);
  } catch (e) { fails.push(`${material}: ${String(e).slice(0, 120)}`); } finally { await h.close(); }
}
console.log(fails.length ? `FAIL\n${fails.join('\n')}` : 'كل اللمسات سليمة');
process.exit(fails.length ? 1 : 0);
