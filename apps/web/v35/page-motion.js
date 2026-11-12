/**
 * عقد الحركة الواحد في VANTARA (قرار المالك، 12 نوفمبر): تلاشٍ مع اندفاع للداخل عند الدخول وللخارج
 * عند الخروج، هادئ فخم. كل انتقال صفحة وتسليم وتبديل لسان يقرأ من هنا؛ لا قسم مستثنى بالاسم.
 */
export const MOTION = Object.freeze({ ms: 380, push: 0.96, enter: 'cubic-bezier(0.22, 1, 0.36, 1)', exit: 'cubic-bezier(0.4, 0, 0.2, 1)' });
const MS = MOTION.ms;
const EASE = MOTION.exit;
const EASE_IN = MOTION.enter;
const DEPTH = MOTION.push;

export function motionReduced(doc = globalThis.document) {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || doc?.documentElement?.dataset.motion === 'off';
}
const running = new Set();
const active = new WeakMap();
/** حالة اندفاع الصفحة الجارية (وحداتها ونقطة الاندفاع): تُقرأ عند المقاطعة ليكمل الخروج من حيث وصل الدخول. */
const pushes = new WeakMap();
export function finishPageMotion() {
  for (const stop of [...running]) stop();
}
/** Read once before interrupting: a quick Back must fade from the visible state, not flash opaque. */
export function pageMotionState(page) {
  if (!page || !active.has(page)) return null;
  const css = globalThis.getComputedStyle?.(page);
  if (!css) return null;
  const push = pushes.get(page);
  const first = push?.units.find((u) => u.isConnected);
  const scale = first ? Number.parseFloat(globalThis.getComputedStyle(first).scale) : NaN;
  return { opacity: Number(css.opacity), scale: Number.isFinite(scale) ? scale : 1, origin: push?.origin ?? null, scrollTop: globalThis.scrollY || 0 };
}
function track(page, animations, restore) {
  let done = false;
  let guard;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    running.delete(stop);
    if (active.get(page) === stop) active.delete(page);
    pushes.delete(page);
    for (const a of animations) a.cancel();
    restore();
  };
  running.add(stop); active.set(page, stop);
  guard = setTimeout(stop, MS + 150);
  animations[0].finished?.then(stop, stop);
}
const save = (page, props) => {
  const previous = Object.fromEntries(props.map(k => [k, page.style[k] ?? '']));
  return () => Object.assign(page.style, previous);
};

/**
 * نقطة الاندفاع على الشاشة: مركز غلاف العمل إن كان ظاهرًا، وإلا ثلث الشاشة العلوي. تُحصر داخل الشاشة: غلاف
 * مُرِّر بعيدًا للأعلى كان يجعل الاندفاع حول نقطة خارجها فتنزاح الصفحة كلها بدل أن تندفع في مكانها.
 */
function originOf(page) {
  const vw = globalThis.innerWidth || 0, vh = globalThis.innerHeight || 0;
  const cover = page.querySelector?.('#detailCover,.aw-cover,.wl-stage3d > .wl-card,.wl-cover,.wl-series > img,.cn-poster,.cn-detail-art');
  const c = cover?.getBoundingClientRect();
  if (c && c.height > 0) return { x: c.left + c.width / 2, y: vh ? Math.min(vh, Math.max(0, c.top + c.height / 2)) : c.top + c.height / 2 };
  const r = page.getBoundingClientRect();
  return { x: r.left + r.width / 2 || vw / 2, y: Math.min(r.height / 2, (vh || r.height) * 0.3) };
}

/**
 * ما يندفع من الصفحة: محتواها دون أشرطتها الثابتة. الصفحة نفسها لا تأخذ transform أبدًا: أي transform (أو
 * will-change/contain) على سلف عنصر position:fixed يجعله مرجعه بدل الشاشة، فكان شريط صفحة العمل وزرها
 * العائم يُرسمان في غير مكانهما طوال الحركة ثم يقفزان عند نهايتها («كلاسيكي» المانجا، «المنصة»، «الشريط
 * العريض»)، وكان الخروج يحتاج تثبيتها يدويًا بقائمة أسماء. الأشرطة الثابتة تعلن نفسها بـdata-motion-fixed؛
 * وحدات الاندفاع هي أبناء كل سلف لها، عدا الأسلاف نفسها والأشرطة. صفحة بلا أشرطة: أبناؤها المباشرون.
 */
export function motionUnits(page) {
  const fixed = [...(page.querySelectorAll?.('[data-motion-fixed]') ?? [])];
  const containers = new Set([page]);
  for (const f of fixed) for (let n = f.parentElement; n && n !== page; n = n.parentElement) containers.add(n);
  const skip = new Set(fixed);
  const units = [];
  for (const c of containers) for (const child of c.children ?? []) if (!containers.has(child) && !skip.has(child)) units.push(child);
  return units;
}
/** إطارا اندفاع وحدة حول نقطة الشاشة `o` بين مقياسين. خصائص scale/translate المنفردة: لا تمسح transform الوحدة. */
function pushFrames(unit, o, from, to) {
  const r = unit.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const at = (s) => ({ scale: String(s), translate: `${((1 - s) * (o.x - cx)).toFixed(2)}px ${((1 - s) * (o.y - cy)).toFixed(2)}px` });
  return [at(from), at(to)];
}
function push(page, o, from, to, timing) {
  const units = motionUnits(page);
  const animations = [];
  // القياس كله أولًا ثم بدء الحركات: لا تخطيط متكرر بين وحدة وأخرى
  const plans = units.map((u) => [u, pushFrames(u, o, from, to)]);
  for (const [u, frames] of plans) if (frames && u.animate) animations.push(u.animate(frames, timing));
  pushes.set(page, { units, origin: o });
  return animations;
}

export function pageOut(page, { depth = false, hold = false, visual = null, scrollTop = 0, doc = globalThis.document } = {}) {
  active.get(page)?.();
  if (!page?.animate || motionReduced(doc)) return;
  if (hold) depth = false;
  const frozen = [...(page.getAnimations?.({subtree:true}) ?? [])].filter(a => a.effect?.target !== page && a.playState === 'running');
  for (const a of frozen) { const t = a.currentTime; a.pause(); if (t != null) a.currentTime = t; }
  const r = page.getBoundingClientRect();
  const origin = depth ? visual?.origin ?? originOf(page) : null;
  const viewHeight = globalThis.innerHeight || r.height;
  const top = Math.max(0, Number.isFinite(r.top) ? r.top : -scrollTop);
  const offset = Math.max(0, -r.top);
  const previousScroll = page.scrollTop || 0;
  const restore = save(page, ['position','top','left','width','height','minHeight','overflow']);
  page.classList.add('page-out');
  // الصفحة المغادرة تبقى بموضعها المرئي: نافذة ثابتة بحجم الشاشة يُعوَّض فيها تمرير الجذر الذي يعود للداخلة.
  // بلا transform ولا contain عليها، فأشرطتها الثابتة تبقى على الشاشة كما هي دون أي تثبيت يدوي.
  Object.assign(page.style, { position:'fixed', top: `${top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${Math.max(1, Math.min(r.height, viewHeight - top))}px`, minHeight: '0', overflow: 'hidden' });
  page.scrollTop = previousScroll + offset;
  // When returning to a saved unified modal, keep this work opaque until
  // the modal has completely faded back in; never reveal Home between them.
  const timing = {duration:MS,easing:EASE,fill:'both'};
  const fade = page.animate(hold ? [{opacity:1},{opacity:1}] : [{opacity:visual?.opacity ?? 1},{opacity:0}], timing);
  const pushed = depth ? push(page, origin, visual?.scale ?? 1, DEPTH, timing) : [];
  track(page, [fade, ...pushed], () => {
    page.classList.remove('page-out'); restore(); page.scrollTop = previousScroll;
    for (const a of frozen) if (a.effect?.target?.isConnected) a.play();
  });
}
/**
 * الصفحة الداخلة تبقى في تدفق المستند (لا تُثبَّت ولا تأخذ transform): تمرير الجذر وخطوطه الزمنية وأشرطتها
 * الثابتة تعمل من أول إطار. تتلاشى هي، ويندفع محتواها (motionUnits) من MOTION.push إلى حجمه.
 */
export function pageIn(page, { depth = false, doc = globalThis.document } = {}) {
  active.get(page)?.();
  if (!page?.animate || motionReduced(doc)) return;
  page.classList.add('page-in');
  const timing = {duration:MS,easing:EASE_IN,fill:'both'};
  const fade = page.animate([{opacity:0},{opacity:1}], timing);
  const pushed = depth ? push(page, originOf(page), DEPTH, 1, timing) : [];
  track(page, [fade, ...pushed], () => { page.classList.remove('page-in'); });
}

/**
 * Unified subpages stay mounted above a work page. Transition that same
 * subpage to/from the work with the EXISTING page-motion timing and easing.
 * No clone, independently programmed curve, or reveal of the underlying Home.
 */
export function handoffSurface(node, {enter = false, doc = globalThis.document, onComplete = () => {}} = {}) {
  active.get(node)?.();
  if (!node?.animate || motionReduced(doc)) { onComplete(); return; }
  const restore = save(node, ['opacity']);
  // Stage the restored modal as transparent within the SAME JS turn as resume().
  if (enter) node.style.opacity = '0';
  const frames = enter ? [{opacity:0},{opacity:1}] : [{opacity:1},{opacity:0}];
  track(node, [node.animate(frames, {duration:MS,easing:EASE,fill:'both'})], () => {
    restore();
    onComplete();
  });
}

/**
 * الشريط السفلي جزء من الصفحة التي يظهر فيها، فيتبع عقدها: يدخل مع الصفحة الداخلة (تلاشٍ واندفاع للداخل)
 * ويخرج مع المغادرة. كان يظهر دفعة واحدة فوق صفحة العمل وهي ما زالت تغادر (#323، ملاحظة المالك)،
 * وقبلها كان يُخفى ~470ms ثم يقفز. خاصية scale لا transform: translate الشريط محجوز لإزاحة لوحة المفاتيح.
 */
export function dockIn(nav, { doc = globalThis.document } = {}) {
  if (!nav?.animate || motionReduced(doc)) return;
  const restore = save(nav, ['pointerEvents']);
  track(nav, [nav.animate([{ opacity: 0, scale: String(DEPTH) }, { opacity: 1, scale: '1' }], { duration: MS, easing: EASE_IN, fill: 'backwards' })], restore);
}
export function dockOut(nav, { doc = globalThis.document, onComplete = () => {} } = {}) {
  if (!nav?.animate || motionReduced(doc)) return onComplete();
  nav.inert = true; // لا لمسة على شريط يغادر
  track(nav, [nav.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: String(DEPTH) }], { duration: MS, easing: EASE, fill: 'forwards' })], () => {
    nav.inert = false;
    onComplete();
  });
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
    // شاشة تحرّك محتواها في مكانها (الإحصائيات: شرائح تنزلق وصفوف تنتقل) تعلن ذلك بـ data-tab-motion="self":
    // التلاشي العام هنا كان يُخفي كل ما تحت التبويبات ثم يعيده فوق حركتها (ملاحظة المالك، 9 نوفمبر)
    if (!tab || tab.closest('.dock, .bottom-nav, .rail, .drawer, [data-tab-motion="self"]') || motionReduced(doc)) return;
    const bar = tab.closest('[role="tablist"]') ?? tab.parentElement;
    const host = bar?.parentElement;
    if (!host) return;
    const index = [...host.children].indexOf(bar);
    requestAnimationFrame(() => {
      // المعالج قد يعيد بناء الشريط: ما بعد موضعه في الحاوية نفسها هو المحتوى
      const nodes = host.isConnected ? [...host.children].slice(index + 1).filter((n) => !n.matches('[role="tablist"]') && !n.querySelector('[role="tablist"]')) : [];
      for (const n of nodes.slice(0, 4)) n.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: MS, easing: EASE_IN });
    });
  }, true);
}
