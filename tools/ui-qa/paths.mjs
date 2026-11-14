// المسارات الحقيقية كما يمشيها المستخدم: لمسة على بطاقة فعلية في كل مكان تظهر فيه الأعمال (صفوف الرئيسية،
// آخر التحديثات، الرائج، كل الأعمال، اكتشف، صفوف الموحد وطبقاته)، ثم الرجوع. كل انتقال يُسجَّل إطارًا
// بإطار ويُحلَّل بـ frames.analyze (تسرب، وميض، دخول/خروج بلا تلاشٍ أو اندفاع، انحراف بكسل، قص، محتوى يظهر دفعة).
// node tools/ui-qa/paths.mjs [sections=anime,cinema,manga,unified] [rounds=1]
import { launch, sleep } from './rig.mjs';
import { installRecorder, record, analyze, timeline } from './frames.mjs';

const sections = (process.argv[2] ?? 'anime,cinema,manga,unified').split(',');
const rounds = Number(process.argv[3] ?? 1);
const WORK = new Set(['detail', 'anime', 'cinema']);
let bad = 0, total = 0;
const report = (name, frames, issues) => {
  total++;
  if (issues.length) bad++;
  console.log(`${issues.length ? 'FAIL' : 'ok  '} ${name} (${frames.length} إطار)`);
  for (const i of issues) console.log(`       ${i.kind} ×${i.n ?? 1} ${i.first ?? ''}–${i.last ?? ''}ms: ${i.detail}`);
  if (issues.length && process.env.TIMELINE) console.log(timeline(frames));
};

/** يعلّم أول بطاقة عمل ظاهرة في الحاوية رقم `nth` من الحاويات المطابقة، ويعيد وصفها. */
const markCard = (page, scope, nth = 0) => page.evaluate(({ scope, nth }) => {
  document.querySelectorAll('[data-qa-target]').forEach((n) => n.removeAttribute('data-qa-target'));
  const root = scope === 'overlay' ? [...document.querySelectorAll('.uv-page')].at(-1) : document.querySelector('.page.active');
  if (!root) return null;
  const seen = (n) => { const r = n.getBoundingClientRect(); return r.width > 40 && r.height > 40 && getComputedStyle(n).visibility !== 'hidden'; };
  const cards = [...root.querySelectorAll('.an-card, .ag-card, .uv-po, .cn-card, .mg-card, .work-card, .card, .up-card, .uv-rc, [data-ref]')].filter(seen);
  // بطاقة من كل حاوية مختلفة (صف، شبكة): تنوّع المسارات بدل عشر بطاقات من الصف نفسه
  const byBox = new Map();
  for (const c of cards) { const box = c.parentElement; if (!byBox.has(box)) byBox.set(box, c); }
  const pick = [...byBox.values()][nth];
  if (!pick) return null;
  pick.scrollIntoView({ block: 'center', behavior: 'instant' });
  pick.setAttribute('data-qa-target', '');
  return `${pick.parentElement.className.toString().split(' ')[0]}>${pick.className.toString().split(' ')[0]}`;
}, { scope, nth });

const page_ = (page) => page.evaluate(() => document.querySelector('.page.active')?.id);
const overlayOpen = (page) => page.evaluate(() => [...document.querySelectorAll('.uv-page')].some((n) => getComputedStyle(n).visibility !== 'hidden'));

/** لمسة البطاقة المعلَّمة ← صفحة العمل ← رجوع: انتقالان مسجَّلان. */
async function openAndBack(page, label, from) {
  let f = await record(page, () => document.querySelector('[data-qa-target]')?.click(), null, 1100);
  const to = await page_(page);
  if (!WORK.has(to)) { console.log(`skip ${label}: اللمسة لم تفتح صفحة عمل (${to})`); return false; }
  report(`${label} فتح`, f, analyze(f, { from, to }));
  await sleep(700);
  f = await record(page, () => window.__shell.handleBack(), null, 1100);
  report(`${label} رجوع`, f, analyze(f, { from: to, to: from }));
  await sleep(500);
  return true;
}

for (let round = 0; round < rounds; round++) for (const s of sections) {
  const unified = s === 'unified';
  const h = await launch({ section: unified ? 'anime' : s, unified });
  const { page } = h;
  try {
    await sleep(2200);
    await installRecorder(page);
    // 1) صفوف الرئيسية: بطاقة من كل صف (حتى خمسة)
    for (let i = 0; i < 5; i++) {
      const at = await markCard(page, 'page', i);
      if (!at) break;
      await openAndBack(page, `${s}/الرئيسية ${at}`, 'home');
    }
    // 2) الأقسام الفرعية: كل رابط «عرض الكل»/مجموعة في الرئيسية، ثم بطاقة منها ثم رجوعان
    // مداخل الأقسام الفرعية: روابط المجموعات و«الكل» في الموحد، وبطاقة تصنيف، و«اكتشف» و«مكتبتي» من الشريط
    const SUB = '.page.active [data-act="openCollection"], .page.active .uv-all, .page.active .ag-card, #bottomNav [data-page="discover"], #bottomNav [data-page="library"]';
    const subs = await page.evaluate((SUB) => [...document.querySelectorAll(SUB)].map((n, i) => i), SUB);
    for (const i of subs.slice(0, 8)) {
      if ((await page_(page)) !== 'home') { await page.evaluate(() => window.__shell.showPage('home')); await sleep(700); }
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
      const label = await page.evaluate(({ i, SUB }) => { const n = [...document.querySelectorAll(SUB)][i]; n?.scrollIntoView?.({ block: 'center', behavior: 'instant' }); n?.setAttribute('data-qa-sub', ''); return (n?.dataset.page || n?.closest('section,.uv-rail,.uv-sec')?.querySelector('h2,h3')?.textContent || n?.textContent || '').trim().slice(0, 18); }, { i, SUB });
      const fromId = await page_(page);
      let f = await record(page, () => { const n = document.querySelector('[data-qa-sub]'); n?.removeAttribute('data-qa-sub'); n?.click(); }, null, 1100);
      const ov = await overlayOpen(page);
      const subId = ov ? 'overlay' : await page_(page);
      report(`${s}/«${label}» دخول القسم`, f, analyze(f, { from: fromId, to: subId }));
      await sleep(900);
      const at = await markCard(page, ov ? 'overlay' : 'page', 0);
      if (at) await openAndBack(page, `${s}/«${label}» ${at}`, subId);
      f = await record(page, () => { window.__shell.handleBack(); }, null, 1100);
      report(`${s}/«${label}» خروج القسم`, f, analyze(f, { from: subId, to: fromId }));
      await sleep(600);
    }
    if (h.log.errors.length) { bad++; console.log(`FAIL ${s} أخطاء JS: ${h.log.errors.join(' | ').slice(0, 400)}`); }
  } finally { await h.close(); }
}
console.log(`\n${total - bad}/${total} انتقال سليم`);
process.exit(bad ? 1 : 0);
