/**
 * انتقالات الصفحات الداخلية (لا انتقال الأقسام الرئيسية: ذاك في dock/طبقات الأقسام ولا يمرّ من هنا).
 *
 * بقرار المالك بعد التجربة: لا شيء يتحرك. لا صعود ولا نزول ولا تصغير، ولا غلاف يطير. الصفحة بأزرارها
 * وأغلفتها في مكانها، والذي يتغير هو الشفافية وحدها:
 *   - الداخلة تظهر (fade in) في 400ms فوق.
 *   - الخارجة تبقى في مكانها المرئي (بموضع تمريرها) خلف الداخلة وتتلاشى (fade out) في 400ms.
 * الدخول والرجوع وتبويبات الشريط بالقاعدة نفسها. أي تنقل جديد أو تبديل قسم رئيسي يُنهي الجاري فورًا.
 * opacity وحدها على خيط الرسم (Web Animations). مع «تقليل الحركة»: تبديل مباشر.
 */

const MS = 400;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const IN_MS = MS;
const OUT_MS = MS;
const EASE_IN = EASE;
const EASE_OUT = EASE;

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
    [{ opacity: 1 }, { opacity: 0 }],
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
  // الداخلة فوق الخارجة: الخارجة تنسحب للخلف تحتها
  page.classList.add('page-in');
  const anim = page.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: IN_MS, easing: EASE_IN },
  );
  const stop = () => {
    running.delete(stop);
    anim.cancel();
    page.classList.remove('page-in');
  };
  running.add(stop);
  anim.finished.then(() => { running.delete(stop); page.classList.remove('page-in'); }, stop);
}

/** للتوافق: دخول قسم ظهر لأول مرة داخل الصفحة (تلاشٍ فقط، لا حركة تحرك ما حوله). */
export function fadeIn(node, { doc = globalThis.document } = {}) {
  if (!node?.animate || motionReduced(doc)) return;
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE_IN });
}

/**
 * التبويبات داخل الصفحة (مكتبتي، الاجتماع، الأصدقاء، المجلس، جدول البث…): نظام واحد لـVANTARA كلها. بعد أن
 * يرسم معالج التبويب محتواه الجديد، يظهر ما بعد شريط التبويبات بتلاشٍ قصير في مكانه. الشريط نفسه لا
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
      for (const n of nodes.slice(0, 4)) n.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE_IN });
    });
  }, true);
}
