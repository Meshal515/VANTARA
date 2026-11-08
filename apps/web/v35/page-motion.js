/**
 * انتقالات الصفحات الداخلية (لا انتقال الأقسام الرئيسية: ذاك في dock/طبقات الأقسام ولا يمرّ من هنا).
 *
 * - الغلاف المتصل (FLIP): نسخة واحدة من صورة الغلاف تنتقل من مكانها في البطاقة إلى مكانها في صفحة
 *   العمل (وبالعكس) بـtransform على خيط الرسم المستقل، والصفحة تدخل بتلاشٍ (opacity). كانت أولًا
 *   View Transitions: تلتقط الصفحة كلها مرتين، فجمّدت WebView أندرويد نصف ثانية (533ms بإبطاء ×6).
 *   الصورة نفسها (لا تحميل جديد)، والوجهة مخفية حتى تصلها النسخة فلا ومضة ولا صورتان.
 * - دخول الصفحة الفرعية: تلاشٍ قصير (شفافية فقط: لا إزاحة تُقاس كقفزة في تبديل الأقسام).
 *
 * بلا بطاقة ظاهرة أو مع «تقليل الحركة»: التبديل كما كان. أي انتقال جديد يُنهي السابق فورًا.
 */

const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
const DURATION = 460;

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
const settle = () => {
  if (!running) return;
  const { ghost, to, anim } = running;
  running = null;
  anim?.cancel?.();
  ghost.remove();
  if (to) to.style.visibility = '';
};

/**
 * ينقل الغلاف من `from` إلى ما يعيده `target()` بعد `swap()` (يرسم الوجهة متزامنًا). يعيد true إن جرى
 * الانتقال المتصل، وfalse إن بُدّلت الصفحة بلا انتقال (فيتولى المستدعي تلاشيها).
 */
export function morphCover(from, swap, target, { doc = globalThis.document } = {}) {
  settle();
  const image = from?.querySelector?.('img');
  if (motionReduced(doc) || !image?.getAttribute('src') || !onScreen(from)) {
    swap();
    return false;
  }
  const a = from.getBoundingClientRect();
  const radiusFrom = globalThis.getComputedStyle?.(from).borderRadius ?? '0px';
  swap();
  const to = target();
  if (!to) return false;
  // الوجهة لم تُرسم صورتها بعد (تحميلها غير متزامن): الصورة نفسها مكانها
  if (!to.querySelector('img')) {
    const copy = image.cloneNode();
    copy.dataset.morphCopy = '1';
    to.append(copy);
  }
  if (!onScreen(to)) return false;
  const b = to.getBoundingClientRect();
  const radiusTo = globalThis.getComputedStyle?.(to).borderRadius ?? '0px';
  const ghost = image.cloneNode();
  ghost.removeAttribute('id');
  ghost.className = 'vantara-morph-ghost';
  // بإحداثيات الصفحة لا الشاشة: إن مرّر المستخدم أثناء الحركة تتحرك النسخة مع الصفحة إلى البطاقة حيث هي
  // الآن. كانت fixed فتكمل إلى مكان البطاقة القديم ثم تختفي وتظهر البطاقة أعلى منه (تنزل ثم ترتفع دفعة).
  const sx0 = globalThis.scrollX ?? 0;
  const sy0 = globalThis.scrollY ?? 0;
  Object.assign(ghost.style, {
    position: 'absolute', left: `${b.left + sx0}px`, top: `${b.top + sy0}px`, width: `${b.width}px`, height: `${b.height}px`,
    objectFit: 'cover', borderRadius: radiusTo, zIndex: '9999', pointerEvents: 'none', margin: '0', transformOrigin: '0 0',
  });
  doc.body.append(ghost);
  to.style.visibility = 'hidden';
  const sx = a.width / b.width;
  const sy = a.height / b.height;
  const anim = ghost.animate?.([
    { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${sx}, ${sy})`, borderRadius: radiusFrom },
    { transform: 'none', borderRadius: radiusTo },
  ], { duration: DURATION, easing: EASE });
  running = { ghost, to, anim };
  const mine = running;
  const done = () => { clearTimeout(mine.guard); if (running === mine) settle(); };
  // ضمان لا يعتمد على finished: حمل ثقيل أو مقاطعة قد تؤخره، والغلاف المخفي لا يبقى مخفيًا أبدًا
  mine.guard = setTimeout(done, DURATION + 400);
  if (anim) anim.finished.then(done, done);
  else done();
  return true;
}

/** دخول صفحة: تلاشٍ قصير (شفافية فقط)، يُعاد من أوله إن دخلت صفحة أخرى قبل انتهائه. */
export function pageFadeIn(page, { doc = globalThis.document } = {}) {
  if (!page || motionReduced(doc)) return;
  // Web Animations على الشفافية وحدها: على خيط الرسم، بلا إعادة تخطيط قسرية (offsetWidth كانت تخطّط
  // الصفحة كلها لحظة الدخول)، والدخول التالي يلغي السابق.
  page._enter?.cancel();
  page._enter = page.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }) ?? null;
}
