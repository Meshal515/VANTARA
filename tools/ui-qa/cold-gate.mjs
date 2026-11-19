// بوابة «قبل الجلب»: صفحة عمل المانجا في أنماطها الخمسة والفصول لم تصل بعد (تتأخر 8 ث)، ثم بعد وصولها.
// البوابات الأخرى (motion-gate وclip-check) تقيس بعد الجلب فلا ترى حالة التحميل. هذه تفشل على:
//  VI1  هيكل تحميل (.skeleton) خارج حاويته (كان يلتصق بأعلى الصفحة ويتمدد بطولها)
//  VI2  نص زر القراءة غير متوسط عموديًا، أو تغيّر ارتفاع الزر بين التحميل والوصول
//  VI3  «من حيث وقفت» يعلن استئنافًا أو رقمًا قبل معرفة التقدم
//  VI5  الكلاسيكي: الغلاف لا يملأ إطاره
//  VD1  ويبتوني على الكمبيوتر: زر القراءة تحت الطية
//  VD2  الملف على الكمبيوتر بلا بنر عريض: الغلاف مقصوص في البنر
//  VD3  الكلاسيكي على الكمبيوتر: عداد الفصول ملاصق للشريط العلوي
// node tools/ui-qa/cold-gate.mjs [out-dir للصور]
import { mkdir } from 'node:fs/promises';
import { launch, sleep } from './rig.mjs';

const out = process.argv[2] ?? null;
if (out) await mkdir(out, { recursive: true });
const LOOKS = ['page', 'gallery', 'profile', 'resume', 'webtoon'];
const SIZES = { phone: { width: 390, height: 844, mobile: true }, pc: { width: 1440, height: 900, mobile: false } };
const fails = [];
const fail = (where, msg) => { fails.push(`${where}: ${msg}`); };

/** القياس في الصفحة: الهياكل، والزر، ونصوص «من حيث وقفت»، والغلاف. */
const measure = (page) => page.evaluate(() => {
  const d = document.getElementById('detail');
  const vis = (n) => { const c = getComputedStyle(n); const r = n.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const box = (r) => ({ x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) });
  // هيكل «يهرب» إن خرج عن مستطيل أبيه (هياكل الغلاف تغطي إطارها فتساويه، فتمر)
  const escaped = [...d.querySelectorAll('.skeleton, .skeleton-inline')].filter(vis).map((n) => {
    const r = n.getBoundingClientRect(); const p = n.parentElement.getBoundingClientRect();
    const out = r.left < p.left - 2 || r.right > p.right + 2 || r.top < p.top - 2 || r.bottom > p.bottom + 2;
    return out ? `${n.className} ${JSON.stringify(box(r))} داخل ${n.parentElement.id || n.parentElement.className} ${JSON.stringify(box(p))}` : null;
  }).filter(Boolean);
  const btn = document.getElementById('readCta');
  const label = document.getElementById('readCtaLabel');
  const sub = document.getElementById('readCtaSub');
  const br = btn?.getBoundingClientRect();
  // مركز المحتوى المرئي فعلًا: الاسم وحده إن كان السطر الثاني فارغًا
  const lines = [label, sub].filter((n) => n && vis(n) && (n.textContent.trim() || n.children.length));
  const top = Math.min(...lines.map((n) => n.getBoundingClientRect().top));
  const bottom = Math.max(...lines.map((n) => n.getBoundingClientRect().bottom));
  const cta = btn && {
    h: Math.round(br.height), bottom: Math.round(br.bottom), label: label?.textContent ?? '',
    off: lines.length ? Math.round(((top + bottom) / 2 - (br.top + br.height / 2)) * 10) / 10 : 0,
  };
  const t = (id) => document.getElementById(id);
  // النص الشفاف (هيكل بمقاس النص) لا يُعلن شيئًا: يُقرأ فارغًا
  const said = (n) => (/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(getComputedStyle(n).color) ? '' : n.textContent);
  const resume = t('resumeKick') && { kick: said(t('resumeKick')), num: said(t('resumeNum')), label: said(t('resumeLabel')) };
  // الغلاف: الصورة تملأ إطارها (لا شريط على حافته)
  const frame = t('detailCover');
  const img = frame?.querySelector('img');
  // object-fit: contain يرسم الصورة أصغر من صندوقها: الفجوة الحقيقية من النسبة الطبيعية، وتُقبل إن ملأها الفن مموّهًا
  const cover = frame && img && img.complete && img.naturalWidth ? (() => {
    const f = frame.getBoundingClientRect(); const i = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    let w = i.width; let h = i.height;
    if (fit === 'contain') { const s = Math.min(i.width / img.naturalWidth, i.height / img.naturalHeight); w = img.naturalWidth * s; h = img.naturalHeight * s; }
    const fill = getComputedStyle(frame, '::before').backgroundImage;
    return { frame: box(f), fit, gapX: Math.round((f.width - w) * 10) / 10, gapY: Math.round((f.height - h) * 10) / 10, filled: Boolean(fill && fill !== 'none') };
  })() : null;
  // البنر في «الملف»: الغلاف المكبّر يُقص (object-fit: cover بنسبة غير نسبته)
  const ban = t('detailBanner');
  const banner = ban && vis(ban) && ban.naturalWidth ? (() => {
    const r = ban.getBoundingClientRect(); const fit = getComputedStyle(ban).objectFit;
    const shown = r.width / r.height; const nat = ban.naturalWidth / ban.naturalHeight;
    return { fit, cropped: fit === 'cover' && Math.abs(shown / nat - 1) > 0.15, cls: ban.closest('.mw-ban')?.className };
  })() : null;
  // «201 فصلًا» أعلى الكلاسيكي (detailFolio) والشريط العلوي: المسافة بين أسفل الشريط وأعلاه (سالبة = تحته)
  const bar = t('detailTop')?.getBoundingClientRect();
  const folio = t('detailFolio');
  const gap = bar && folio && vis(folio) ? Math.round(folio.getBoundingClientRect().top - bar.bottom) : null;
  return { escaped, cta, resume, cover, banner, gap, chapters: d.querySelectorAll('.mw-ch, .mw-cell:not(.skeleton), .chapter-row, [data-chapter]').length };
});

const VARIANTS = (look, size) => [['banner', ''], ...(look === 'profile' && size === 'pc' ? [['nobanner', '/بلا-بنر']] : []), ...(size === 'phone' ? [['late', '/غلاف-متأخر'], ['late23', '/غلاف-متأخر-2:3']] : [])];
for (const [size, v] of Object.entries(SIZES)) for (const look of LOOKS) for (const [variant, tag] of VARIANTS(look, size)) {
  const where = `${look}/${size}${tag}`;
  // «غلاف متأخر»: الصور تصل بعد ظهور الصفحة، فيُعرض الغلاف داخل الإطار المحجوز (mw-fit)
  const h = await launch({ viewport: { width: v.width, height: v.height }, mobile: v.mobile, mangaDelay: 8000, imageDelay: variant.startsWith('late') ? 2000 : 0, appearance: { style: { manga: look } } });
  try {
    await sleep(700);
    // void: لا ننتظر openWork (ينتظر الجلب كله) فنقيس أثناء التحميل
    // «غلاف متأخر» بنسبة 0.7 (أغلب الأغلفة الحقيقية ليست 2:3 تمامًا)، و2:3 (إطار الكلاسيكي يحجز 0.7)
    await h.page.evaluate((variant) => {
      const o = location.origin; const c = `${o}/__art/cover-07.svg`;
      const extra = variant === 'nobanner' ? { bannerImage: null, wideBanner: null } : variant === 'late' ? { coverImage: { large: c, extraLarge: c }, bannerImage: c } : {};
      const w = window.__manga(1, extra);
      if (variant === 'late') w._work.thumbnailUrl = c;
      void window.__shell.openWork(w);
    }, variant);
    await sleep(2500);
    const file = `${look}-${size}${variant === 'banner' ? '' : `-${variant}`}`;
    if (out) await h.page.screenshot({ path: `${out}/${file}-cold.png` });
    const cold = await measure(h.page);
    await sleep(7500);
    if (out) await h.page.screenshot({ path: `${out}/${file}-warm.png` });
    const warm = await measure(h.page);
    if (h.log.errors.length) fail(where, `أخطاء: ${h.log.errors[0]}`);
    // VI1
    for (const e of cold.escaped) fail(where, `VI1 هيكل خارج حاويته قبل الجلب: ${e}`);
    // VI2
    if (cold.cta) {
      if (Math.abs(cold.cta.off) > 2) fail(where, `VI2 نص الزر أثناء التحميل مزاح عن الوسط ${cold.cta.off}px («${cold.cta.label}»)`);
      if (Math.abs(warm.cta.off) > 2) fail(where, `VI2 نص الزر بعد الجلب مزاح عن الوسط ${warm.cta.off}px`);
      if (Math.abs(cold.cta.h - warm.cta.h) > 1) fail(where, `VI2 ارتفاع الزر تغيّر ${cold.cta.h} ← ${warm.cta.h}`);
    }
    // VI3: عمل لم يُبدأ (لا تقدم في الحزام)
    if (cold.resume) {
      if (/تابع/.test(cold.resume.kick) || /التالي/.test(cold.resume.label)) fail(where, `VI3 يعلن استئنافًا قبل معرفة التقدم: «${cold.resume.kick}» / «${cold.resume.label}»`);
      if (cold.resume.num.trim() && cold.resume.num.trim() !== ' ') fail(where, `VI3 رقم قبل الجلب: «${cold.resume.num}»`);
      if (/تابع/.test(warm.resume.kick)) fail(where, `VI3 عمل لم يُبدأ يقول «${warm.resume.kick}» بعد الجلب`);
    }
    // VI5
    if (warm.cover && (warm.cover.gapX > 1 || warm.cover.gapY > 1) && !warm.cover.filled) fail(where, `VI5 الغلاف أصغر من إطاره ويظهر شريط داكن ${JSON.stringify(warm.cover)}`);
    // VD1
    if (size === 'pc' && warm.cta && warm.cta.bottom > v.height) fail(where, `VD1 زر القراءة تحت الطية (أسفله ${warm.cta.bottom} > ${v.height})`);
    // VD2
    if (size === 'pc' && look === 'profile' && warm.banner?.cropped) fail(where, `VD2 غلاف مقصوص في البنر ${JSON.stringify(warm.banner)}`);
    // VD3
    if (size === 'pc' && look === 'page' && warm.gap != null && warm.gap < 8) fail(where, `VD3 «فصلًا» ملاصق للشريط العلوي أو تحته (${warm.gap}px)`);
    console.log(`${where}: قبل ${JSON.stringify({ esc: cold.escaped.length, cta: cold.cta, resume: cold.resume })}\n   بعد ${JSON.stringify({ cta: warm.cta, resume: warm.resume, cover: warm.cover && { gapX: warm.cover.gapX, gapY: warm.cover.gapY }, banner: warm.banner, gap: warm.gap })}`);
  } finally { await h.close(); }
}
console.log(fails.length ? `\nFAIL ${fails.length}:\n${fails.map((f) => ` - ${f}`).join('\n')}` : '\nok: كل الحالات سليمة');
process.exit(fails.length ? 1 : 0);
