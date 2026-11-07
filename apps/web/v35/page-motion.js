/**
 * انتقالات الصفحات الداخلية (لا انتقال الأقسام الرئيسية: ذاك في dock/طبقات الأقسام ولا يمرّ من هنا).
 *
 * - الغلاف المتصل: الغلاف نفسه ينتقل من بطاقته إلى مكانه في صفحة العمل وبالعكس (View Transitions،
 *   مثل طيّ الشريط في wide.css). المتصفح يلتقط الصورتين فلا يُعاد تحميل الغلاف ولا يومض أثناء
 *   الحركة، والباقي يتلاشى. بلا الواجهة، أو مع «تقليل الحركة»، أو بلا بطاقة ظاهرة: التبديل كما كان
 *   وتلاشٍ قصير للصفحة.
 * - دخول الصفحة الفرعية: تلاشٍ قصير، بلا شاشة فارغة بين الصفحتين ولا إزاحة.
 *
 * كل ما يتحرك هنا transform/opacity، وكل انتقال يُلغى بالذي بعده (startViewTransition يُنهي السابق).
 */

const NAME = 'vantara-work-cover';

export function motionReduced(doc = globalThis.document) {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || doc?.documentElement?.dataset.motion === 'off';
}

/** هل العنصر ظاهر فعلًا في الشاشة (لا ينتقل الغلاف من بطاقة خارجها أو مخفية). */
export function onScreen(node, view = globalThis) {
  if (!node?.isConnected) return false;
  const r = node.getBoundingClientRect();
  return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < (view.innerHeight ?? 0) && r.right > 0 && r.left < (view.innerWidth ?? 0);
}

let running = null;

/**
 * ينقل الغلاف من `from` إلى ما يعيده `target()` بعد `swap()`. يعيد true إن جرى الانتقال المتصل.
 * `swap` يجب أن يرسم الوجهة متزامنًا (المتصفح يلتقطها بعده مباشرة).
 */
export function morphCover(from, swap, target, { doc = globalThis.document } = {}) {
  if (!doc?.startViewTransition || motionReduced(doc) || !onScreen(from)) {
    swap();
    return false;
  }
  running?.skipTransition?.();
  const image = from.querySelector('img');
  from.style.viewTransitionName = NAME;
  doc.documentElement.classList.add('work-morph');
  const t = doc.startViewTransition(() => {
    from.style.viewTransitionName = '';
    swap();
    const to = target();
    if (!to) return;
    // الوجهة لم تُرسم صورتها بعد (تحميلها غير متزامن): الصورة نفسها مكانها فلا تُلتقط علبة فارغة
    if (image && !to.querySelector('img')) {
      const copy = image.cloneNode();
      copy.dataset.morphCopy = '1';
      to.append(copy);
    }
    to.style.viewTransitionName = NAME;
  });
  running = t;
  t.finished.finally(() => {
    if (running === t) running = null;
    const to = target();
    if (to) to.style.viewTransitionName = '';
    doc.documentElement.classList.remove('work-morph');
  });
  return true;
}

/** دخول صفحة فرعية: تلاشٍ قصير (شفافية فقط)، يُعاد من أوله إن دخلت صفحة أخرى قبل انتهائه. */
export function pageFadeIn(page, { doc = globalThis.document } = {}) {
  if (!page || motionReduced(doc)) return;
  page.classList.remove('page-enter');
  void page.offsetWidth;
  page.classList.add('page-enter');
  clearTimeout(page._enterTimer);
  page._enterTimer = setTimeout(() => page.classList.remove('page-enter'), 260);
}
