// بوابة الدخول والخروج للأنماط الخمسة عشر (#323): تقيس ما يراه المستخدم إطارًا بإطار، وتبدأ قبل الضغطة بإطارين
// (المسجّل السابق كان يبدأ مع الضغطة فيفوته الإطار الذي تحدث فيه القفزة).
//
// الظروف: صور وبيانات فورية أو متأخرة (تصل قبل الحركة، في منتصفها، أو بعدها)، ورجوع بعد الاستقرار أو في منتصف الدخول.
// المخالفات:
//   pre-jump   عنصر رئيسي تحرك بين الإطار السابق للضغطة وأول إطار بعدها (قبل أن تبدأ الحركة)
//   drift      الغلاف تحرك في الدخول أو الخروج أكثر مما يفسّره الاندفاع (4% نحو نقطة واحدة)
//   late-shift الغلاف أو البطل تحرك بعد انتهاء الدخول (صورة أو بيانات وصلت فغيّرت التخطيط)
//   rebuild    أُعيد بناء الصفحة (تغير عدد عناصرها كثيرًا) أثناء حركتها
//   blank      إطار لا صفحة فيه ظاهرة
//   duration   الجزء المرئي من الحركة أقصر من 60% من مدة العقد (400ms) أو أطول منها
//   stall      الضغطة حجبت الخيط الرئيسي أكثر من الحد قبل أول إطار
// node tools/ui-qa/motion-gate.mjs [sections=manga,anime,cinema] [looks=a,b] · RATE=4 لمعالج مبطّأ · VERBOSE=1
import { launch, sleep } from './rig.mjs';

const sections = (process.argv[2] ?? 'manga,anime,cinema').split(',');
const lookFilter = process.argv[3]?.split(',') ?? null;
const RATE = Number(process.env.RATE ?? 1);
const STALL_MS = Number(process.env.STALL_MS ?? 60) * RATE;
const { MANGA_WORK_STYLES, WORK_STYLES, CINEMA_WORK_STYLES } = await import('../../apps/web/v35/appearance.js');
const { MOTION } = await import('../../apps/web/v35/page-motion.js');
const SETS = { manga: [MANGA_WORK_STYLES, 'manga', 'detail'], anime: [WORK_STYLES, 'anime', 'anime'], cinema: [CINEMA_WORK_STYLES, 'series', 'cinema'] };
const CONDITIONS = [
  { name: 'فوري', image: 0, data: 0 },
  { name: 'صورة متأخرة', image: 700, data: 0 },
  { name: 'بيانات متأخرة', image: 0, data: 700 },
];

/** يسجّل إطارات حول فعل داخل الصفحة: إطاران قبله ثم `ms`. */
async function trace(page, pid, action, ms) {
  return page.evaluate(async ({ pid, action, ms }) => {
    const p = document.getElementById(pid);
    const heroSel = '.aw-cover,.wl-stage3d > .wl-card,.wl-plate .wl-cover,.wl-top .wl-cover,.wl-series > img,.cn-poster,.cn-detail-art,#detailCover';
    const rows = [];
    const snap = (phase) => {
      const c = p.querySelector(heroSel);
      const r = c?.getBoundingClientRect();
      const visible = getComputedStyle(p).display !== 'none' && (p.classList.contains('active') || p.classList.contains('page-out'));
      const pages = [...document.querySelectorAll('.page')].filter((x) => getComputedStyle(x).display !== 'none').map((x) => +getComputedStyle(x).opacity);
      rows.push({ phase, t: performance.now(), o: visible ? +getComputedStyle(p).opacity : 0, cov: r && r.width ? [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height] : null, n: p.querySelectorAll('*').length, sum: pages.reduce((a, b) => a + b, 0), moving: p.classList.contains('page-in') || p.classList.contains('page-out') });
    };
    snap('before'); await new Promise((r) => requestAnimationFrame(r)); snap('before');
    const t0 = performance.now();
    if (action.open) window.__open(action.open); else window.__shell.handleBack();
    const sync = performance.now() - t0;
    while (performance.now() - t0 < ms) { await new Promise((r) => requestAnimationFrame(r)); snap('after'); }
    return { rows, sync, t0 };
  }, { pid, action, ms });
}

function check({ rows, sync, t0 }, { kind, expectEnd }) {
  const out = [];
  const add = (k, d) => out.push(`${k}: ${d}`);
  const before = rows.filter((r) => r.phase === 'before').at(-1);
  const after = rows.filter((r) => r.phase === 'after');
  if (sync > STALL_MS) add('stall', `${Math.round(sync)}ms`);
  // قبل الحركة: أول إطار بعد الضغطة يجب أن يُظهر الغلاف حيث كان (الخروج) — لا قفزة تسبق الحركة
  if (kind === 'exit' && before?.cov && after[0]?.cov && after[0].o > 0.5) {
    const d = Math.hypot(after[0].cov[0] - before.cov[0], after[0].cov[1] - before.cov[1]);
    if (d > 3) add('pre-jump', `${d.toFixed(1)}px`);
  }
  // أثناء الحركة: الغلاف يتحرك بقدر الاندفاع فقط (مركزه نقطة الاندفاع غالبًا: الحد 4% من المسافة لأبعد حافة + 6px)
  const moving = after.filter((r) => r.cov && r.o > 0.08 && r.o < 0.98);
  if (moving.length > 1) {
    const ys = moving.map((r) => r.cov[1]);
    const travel = Math.max(...ys) - Math.min(...ys);
    const allow = (1 - MOTION.push) * 844 + 6;
    if (travel > allow) add('drift', `الغلاف تحرك ${travel.toFixed(0)}px (المسموح ${allow.toFixed(0)})`);
  }
  // بعد الحركة (الدخول): لا شيء يتحرك
  if (kind === 'enter') {
    const still = after.filter((r) => r.cov && r.o >= 0.99 && !r.moving);
    const ys = still.map((r) => r.cov[1]), hs = still.map((r) => r.cov[3]);
    if (still.length > 1 && (Math.max(...ys) - Math.min(...ys) > 2 || Math.max(...hs) - Math.min(...hs) > 2)) add('late-shift', `بعد الاستقرار: y ${Math.min(...ys).toFixed(0)}–${Math.max(...ys).toFixed(0)} h ${Math.min(...hs).toFixed(0)}–${Math.max(...hs).toFixed(0)}`);
  }
  // إعادة بناء أثناء الحركة
  const live = after.filter((r) => r.moving && r.o > 0.05);
  for (let i = 1; i < live.length; i++) if (Math.abs(live[i].n - live[i - 1].n) > Math.max(30, live[i - 1].n * 0.2)) { add('rebuild', `${live[i - 1].n}→${live[i].n} عند ${Math.round(live[i].t - t0)}ms`); break; }
  // إطار فارغ
  const blank = after.filter((r) => r.sum < 0.5);
  if (blank.length) add('blank', `${blank.length} إطار`);
  // المدة: من أول إطار تتحرك فيه الشفافية إلى آخره
  const span = after.filter((r) => r.o > 0.02 && r.o < 0.98);
  if (span.length > 2) {
    const d = span.at(-1).t - span[0].t;
    // الجزء المرئي من التلاشي (2%–98%) لا يقل عن 60% من مدة العقد (منحنى الدخول والخروج واحد): حركة «سريعة» تبلغ نهايتها في نصفها
    if (d < MOTION.ms * 0.6 || d > MOTION.ms + 60 + 20 * RATE) add('duration', `${Math.round(d)}ms`);
  }
  if (expectEnd != null && after.at(-1) && Math.abs(after.at(-1).o - expectEnd) > 0.02) add('end', `الشفافية النهائية ${after.at(-1).o}`);
  return out;
}

let bad = 0, total = 0;
for (const sec of sections) {
  const [styles, kind, pid] = SETS[sec];
  // «النمط الموحد» إعداد منفصل عن أنماط القسم (appearance.unifiedLook): حالة إضافية لكل قسم بالمعايير نفسها
  for (const { id: look } of [...styles, { id: 'unified' }]) {
    if (lookFilter && !lookFilter.includes(look)) continue;
    for (const c of CONDITIONS) {
      const appearance = look === 'unified' ? { unifiedLook: true } : { style: { [sec]: look } };
      const h = await launch({ section: sec, appearance, imageDelay: c.image, mangaDelay: c.data || 200 });
      if (c.data) await h.page.route(/anilist|cinemeta|strem\.io/, async (route) => { await sleep(c.data); return route.fallback(); });
      const cdp = RATE > 1 ? await h.context.newCDPSession(h.page) : null;
      await sleep(1000);
      if (cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
      const results = [];
      // 1) فتح ثم استقرار ثم رجوع
      results.push(['دخول', check(await trace(h.page, pid, { open: kind }, 1800), { kind: 'enter', expectEnd: 1 })]);
      results.push(['خروج', check(await trace(h.page, pid, { back: true }, 700), { kind: 'exit', expectEnd: 0 })]);
      await sleep(400);
      // 2) رجوع في منتصف الدخول
      await h.page.evaluate((k) => window.__open(k), kind);
      await sleep(180 * RATE);
      results.push(['رجوع مبكر', check(await trace(h.page, pid, { back: true }, 700), { kind: 'exit', expectEnd: 0 }).filter((x) => !x.startsWith('duration'))]);
      await sleep(400);
      // 3) خروج بعد تمرير
      await h.page.evaluate((k) => window.__open(k), kind);
      await sleep(1800);
      await h.page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
      await sleep(300);
      results.push(['خروج بعد تمرير', check(await trace(h.page, pid, { back: true }, 700), { kind: 'exit', expectEnd: 0 })]);
      for (const [name, issues] of results) {
        total++;
        if (issues.length) bad++;
        if (issues.length || process.env.VERBOSE) console.log(`${issues.length ? 'FAIL' : 'ok  '} ${sec}/${look} [${c.name}] ${name}${issues.length ? ': ' + issues.join(' · ') : ''}`);
      }
      if (h.log.errors.length) { bad++; console.log(`FAIL ${sec}/${look} [${c.name}] أخطاء: ${h.log.errors[0].slice(0, 200)}`); }
      await h.close();
    }
  }
}
console.log(`\n${total - bad}/${total} سليم`);
process.exit(bad ? 1 : 0);
