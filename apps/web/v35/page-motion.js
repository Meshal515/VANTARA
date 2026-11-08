/**
 * انتقالات الصفحات الداخلية (لا انتقال الأقسام الرئيسية: ذاك في dock/طبقات الأقسام ولا يمرّ من هنا).
 *
 * بقرار المالك: لا غلاف يطير بين البطاقة والصفحة. الدخول تلاشٍ مع حركة للداخل، والخروج تلاشٍ مع حركة
 * للخارج، والصفحتان تتقاطعان (لا تختفي القديمة فجأة):
 *   - إلى الأعمق (فتح عمل، قسم فرعي): الجديدة تصعد 14px وتظهر، والقديمة تصغر إلى 0.97 وتتلاشى.
 *   - رجوع: العكس؛ السابقة تكبر من 0.97 وتظهر، والحالية تنزل 14px وتتلاشى.
 * بين تبويبات الشريط (الرئيسية، اكتشف، مكتبتي، الاجتماع) تلاشٍ متقاطع بلا حركة (still): هي مستوى واحد،
 * وتبديل القسم الرئيسي قد يأتي فورًا بعدها فلا إزاحة تُقطع. الخروج 160ms والدخول 260ms، transform وopacity فقط (Web Animations على خيط الرسم). الصفحة الخارجة تبقى
 * ظاهرة في مكانها المرئي (بموضع تمريرها) فوق الجديدة حتى تختفي، ثم تُعاد كما كانت. أي تنقل جديد أو تبديل
 * قسم رئيسي يُنهي الجاري فورًا. مع «تقليل الحركة»: تبديل مباشر.
 */

const IN_MS = 260;
const OUT_MS = 160;
const EASE_IN = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_OUT = 'cubic-bezier(0.4, 0, 1, 1)';

export function motionReduced(doc = globalThis.document) {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || doc?.documentElement?.dataset.motion === 'off';
}

const running = new Set();

/** يُنهي كل حركة صفحة جارية فورًا ويعيد الصفحات كما كانت (قبل تنقل جديد أو تبديل قسم رئيسي). */
export function finishPageMotion() {
  for (const stop of [...running]) stop();
}

/**
 * الصفحة الخارجة: تبقى ظاهرة بموضعها المرئي فوق الجديدة وتتلاشى. تُستدعى قبل إخفائها مباشرة.
 * `scrollTop` موضع التمرير الذي كانت عليه (تُثبَّت به فلا تقفز لأعلاها).
 */
export function pageOut(page, { back = false, still = false, scrollTop = 0, doc = globalThis.document } = {}) {
  if (!page?.animate || motionReduced(doc)) return;
  // مكانها المرئي الآن بالضبط (الشريط الجانبي على الشاشة العريضة، وموضع التمرير)، قبل أن تُثبَّت
  const r = page.getBoundingClientRect();
  page.classList.add('page-out');
  Object.assign(page.style, { top: `${Number.isFinite(r.top) ? r.top : -scrollTop}px`, left: `${r.left}px`, width: `${r.width}px` });
  const anim = page.animate(
    still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: back ? 'translateY(14px)' : 'scale(0.97)' }],
    { duration: OUT_MS, easing: EASE_OUT, fill: 'forwards' },
  );
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    running.delete(stop);
    anim.cancel();
    page.classList.remove('page-out');
    Object.assign(page.style, { top: '', left: '', width: '' });
  };
  running.add(stop);
  anim.finished.then(stop, stop);
  setTimeout(stop, OUT_MS + 200);
}

/** الصفحة الداخلة: تظهر مع حركة للداخل. */
export function pageIn(page, { back = false, still = false, doc = globalThis.document } = {}) {
  if (!page?.animate || motionReduced(doc)) return;
  const anim = page.animate(
    still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: back ? 'scale(0.97)' : 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
    { duration: IN_MS, easing: EASE_IN },
  );
  const stop = () => {
    running.delete(stop);
    anim.cancel();
  };
  running.add(stop);
  anim.finished.then(() => running.delete(stop), () => running.delete(stop));
}

/** للتوافق: دخول قسم ظهر لأول مرة داخل الصفحة (تلاشٍ فقط، لا حركة تحرك ما حوله). */
export function fadeIn(node, { doc = globalThis.document } = {}) {
  if (!node?.animate || motionReduced(doc)) return;
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_IN });
}

/**
 * التبويبات داخل الصفحة (مكتبتي، الاجتماع، الأصدقاء، المجلس، جدول البث…): نظام واحد لـVANTARA كلها. بعد أن
 * يرسم معالج التبويب محتواه الجديد، يدخل ما بعد شريط التبويبات بتلاشٍ قصير مع صعود 6px. الشريط نفسه لا
 * يتحرك. يُركَّب مرة على جذر التطبيق.
 */
export function bindTabMotion(root, { doc = globalThis.document } = {}) {
  root.addEventListener('click', (e) => {
    const tab = e.target?.closest?.('[role="tab"]');
    if (!tab || tab.closest('.dock, .bottom-nav, .rail, .drawer') || motionReduced(doc)) return;
    const bar = tab.closest('[role="tablist"]') ?? tab.parentElement;
    const host = bar?.parentElement;
    if (!host) return;
    const index = [...host.children].indexOf(bar);
    requestAnimationFrame(() => {
      // المعالج قد يعيد بناء الشريط: ما بعد موضعه في الحاوية نفسها هو المحتوى
      const nodes = host.isConnected ? [...host.children].slice(index + 1).filter((n) => !n.matches('[role="tablist"]') && !n.querySelector('[role="tablist"]')) : [];
      for (const n of nodes.slice(0, 4)) n.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_IN });
    });
  }, true);
}
