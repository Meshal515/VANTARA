/**
 * عقد الحركة الواحد في VANTARA (قرار المالك، 12 نوفمبر): تلاشٍ مع اندفاع للداخل عند الدخول وللخارج
 * عند الخروج، هادئ فخم. كل انتقال صفحة وتسليم وتبديل لسان يقرأ من هنا؛ لا قسم مستثنى بالاسم.
 */
// 400ms بمنحنى واحد للاتجاهين (قرار المالك، 13 نوفمبر): كان الدخول بمنحنى يبلغ 98% في نصف المدة فيبدو «سريعًا»
// والخروج بمنحنى آخر، فلا يتشابهان. المدة نفسها والإيقاع نفسه في كل نمط وكل اتجاه.
export const MOTION = Object.freeze({ ms: 400, push: 0.96, enter: 'cubic-bezier(0.4, 0, 0.2, 1)', exit: 'cubic-bezier(0.4, 0, 0.2, 1)' });
const MS = MOTION.ms;
const EASE = MOTION.exit;
const EASE_IN = MOTION.enter;
const DEPTH = MOTION.push;

export function motionReduced(doc = globalThis.document) {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || doc?.documentElement?.dataset.motion === 'off';
}
const running = new Set();
const active = new WeakMap();
/** ما ينتظر انتهاء حركة صفحة (رسم بيانات وصلت أثناءها). */
const waiters = new WeakMap();
const playing = new WeakSet();
/**
 * هل يُمنع رسم الصفحة الآن؟ وهي تغادر (من أول لحظة، ولو كانت الحركة تنتظر البوابة: المغادرة ظاهرة كما هي)،
 * أو وهي تدخل والحركة جارية. أما انتظار البوابة قبل الدخول فهو بالضبط وقت الرسم: الصفحة ما زالت لا تُرى.
 */
export const motionActive = (page) => Boolean(page && (playing.has(page) || page.classList?.contains('page-out')));
/**
 * لا يُعاد بناء صفحة وهي تتحرك: ما يصل من بيانات أثناء دخولها أو خروجها يُرسم حين تنتهي الحركة. كان الرسم
 * يستبدل محتواها في منتصف الحركة، فيقفز ما فيها أو يختفي، ويختلف الخروج من مرة لأخرى بحسب وصول الشبكة.
 * `fn` يُنادى فورًا إن لم تكن تتحرك.
 */
export function afterMotion(page, fn) {
  if (!motionActive(page)) return fn();
  const list = waiters.get(page) ?? [];
  list.push(fn);
  waiters.set(page, list);
}
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
/**
 * دورة حياة انتقال واحدة: تبدأ الحركة حين تفتح `gate` (أو فورًا بلا بوابة)، وتنتهي بانتهاء أول حركة أو
 * بمقاطعة finishPageMotion، فتُعاد الصفحة كما كانت. الحارس الزمني يبدأ مع التشغيل لا مع التجهيز.
 */
function track(page, animations, restore, gate = null, later = null) {
  let done = false;
  let guard;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    running.delete(stop);
    if (active.get(page) === stop) active.delete(page);
    pushes.delete(page);
    playing.delete(page);
    for (const a of animations) a.cancel();
    restore();
    const queued = waiters.get(page);
    if (queued && !motionActive(page)) { waiters.delete(page); for (const fn of queued) queueMicrotask(() => afterMotion(page, fn)); }
  };
  running.add(stop); active.set(page, stop);
  const go = () => {
    if (done) return;
    // ما يُقاس من الصفحة (نقطة الاندفاع وحدود الوحدات) يُقاس لحظة البدء الفعلي: قبلها قد تكون الصفحة هيكلًا
    // بلا غلاف (0×0)، فكان المحتوى ينزلق 50–70px نحو نقطة احتياطية بدل اندفاع 4% في مكانه
    if (later) animations.push(...later());
    playing.add(page);
    for (const a of animations) a.play?.();
    guard = setTimeout(stop, MS + 150);
    animations[0].finished?.then(stop, stop);
  };
  if (!gate) return go();
  // مجهّزة ومتوقفة على إطارها الأول: المغادرة معتمة كما هي والداخلة شفافة، إلى أن تجهز الداخلة
  for (const a of animations) a.pause?.();
  gate.then(go, go);
}

/**
 * بوابة جاهزية صفحة العمل: تفتح حين يعلن القسم أن أساس الصفحة جاهز (البيانات والغلاف المحسوم)، أو عند
 * المهلة أيهما أسبق. الانتقال لا يبدأ على صفحة نصف مبنية تكتمل أمام العين.
 */
export const WORK_READY_MS = 280;
export function readyGate(ms = WORK_READY_MS) {
  let resolve;
  const gate = { opened: false };
  const promise = new Promise((r) => { resolve = r; });
  const open = (why) => { if (gate.opened) return; gate.opened = true; resolve(why); };
  const timer = setTimeout(() => open('deadline'), ms);
  return Object.assign(gate, { promise, ready: () => { clearTimeout(timer); open('ready'); } });
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

const isScrollLinked = (a) => Boolean(a.timeline) && a.timeline !== globalThis.document?.timeline && a.timeline?.constructor?.name !== 'DocumentTimeline';
/** يثبت شكل كل عنصر تحركه حركة مربوطة بالتمرير كما يُرسم الآن، ويفصله عنها. يعيد دالة الاستعادة. */
function bakeScrollLayers(animations) {
  const targets = [...new Set(animations.filter(isScrollLinked).map((a) => a.effect?.target).filter(Boolean))];
  const css = globalThis.getComputedStyle;
  // القراءة كلها أولًا ثم الكتابة: لا تخطيط بين عنصر وآخر
  const values = targets.map((n) => { const c = css?.(n); return [n, c?.transform ?? 'none', c?.opacity ?? '1']; });
  const undo = values.map(([n, transform, opacity]) => {
    const prev = save(n, ['animation', 'transform', 'opacity']);
    Object.assign(n.style, { animation: 'none', transform, opacity });
    return prev;
  });
  return () => { for (const u of undo) u(); };
}

export function pageOut(page, { depth = false, visual = null, scrollTop = 0, gate = null, doc = globalThis.document } = {}) {
  active.get(page)?.();
  if (!page?.animate || motionReduced(doc)) return;
  const sub = [...(page.getAnimations?.({subtree:true}) ?? [])].filter(a => a.effect?.target !== page);
  // طبقات العمق مربوطة بتمرير الجذر، والجذر يعود لموضع الوجهة لحظة الرجوع. إيقافها لا يكفي: ما تجاوز مداه
  // حالته «منتهية» فلا يُوقف، وما أُوقف قيمته نسبة من طول المستند الذي يتغير، فيقفز الغلاف قبل الخروج.
  // تُثبَّت قيمتها المرسومة الآن على العنصر وتُفصل عن التمرير حتى تنتهي المغادرة.
  const baked = bakeScrollLayers(sub);
  const frozen = sub.filter(a => a.playState === 'running' && !isScrollLinked(a));
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
  // صفحة أقصر من موضع التمرير المطلوب (الجذر كان أطول منها بحشوة الشريط): لا تمرر إليه كاملًا، فيُعوَّض الباقي
  // بإزاحة الصفحة للأعلى. كان الباقي يظهر قفزة للأسفل لحظة الرجوع (25px في «البطاقة الطائرة»)
  const short = previousScroll + offset - page.scrollTop;
  // (الارتفاع كما هو: ما تحت نهاية الصفحة لم يكن منها أصلًا، وزيادته تُنقص التمرير الممكن فيعود الفرق)
  if (short > 0.5) page.style.top = `${top - short}px`;
  const timing = {duration:MS,easing:EASE,fill:'both'};
  const fade = page.animate([{opacity:visual?.opacity ?? 1},{opacity:0}], timing);
  const pushed = depth ? push(page, origin, visual?.scale ?? 1, DEPTH, timing) : [];
  track(page, [fade, ...pushed], () => {
    page.classList.remove('page-out'); restore(); page.scrollTop = previousScroll;
    baked();
    for (const a of frozen) if (a.effect?.target?.isConnected) a.play();
  }, gate);
}
/**
 * الصفحة الداخلة تبقى في تدفق المستند (لا تُثبَّت ولا تأخذ transform): تمرير الجذر وخطوطه الزمنية وأشرطتها
 * الثابتة تعمل من أول إطار. تتلاشى هي، ويندفع محتواها (motionUnits) من MOTION.push إلى حجمه.
 */
export function pageIn(page, { depth = false, gate = null, from = null, doc = globalThis.document } = {}) {
  active.get(page)?.();
  if (!page?.animate || motionReduced(doc)) return;
  page.classList.add('page-in');
  const timing = {duration:MS,easing:EASE_IN,fill:'both'};
  // رجوع يقاطع حركة: الوجهة تكمل من شفافيتها الظاهرة الآن (كانت تبدأ من صفر والمغادرة كذلك، فتُرى شاشة فارغة)
  const fade = page.animate([{opacity:from?.opacity ?? 0},{opacity:1}], timing);
  // الاندفاع يُبنى حين تبدأ الحركة فعلًا (بعد البوابة)، على الصفحة كما ستُرى
  track(page, [fade], () => { page.classList.remove('page-in'); }, gate, depth ? () => push(page, originOf(page), DEPTH, 1, timing) : null);
}

/**
 * محتوى وصل بعد أن ظهرت الصفحة (فصول، حلقات، مواسم): يظهر في مكانه المحجوز بتلاشٍ واحد بدل أن يظهر
 * دفعة. لا حركة موضع؛ عنصر واحد لكل دفعة.
 */
export function settleIn(node, { doc = globalThis.document } = {}) {
  if (!node?.animate || motionReduced(doc)) return;
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE_IN });
}

/**
 * صفحات الموحد الفرعية (الرائج، اكتشف، البحث) طبقة فوق الصفحات: تتبع العقد نفسه كأي صفحة. عند فتح عمل منها
 * تخرج بتلاشٍ واندفاع للخلف، وعند الرجوع تدخل بتلاشٍ واندفاع للداخل، بالمدة والمنحنى نفسيهما وعلى بوابة
 * الجاهزية نفسها. كانت تتلاشى فقط (بلا اندفاع) وصفحة العمل تحتها تظهر بلا حركة دخول.
 */
export function handoffSurface(node, {enter = false, gate = null, doc = globalThis.document, onComplete = () => {}} = {}) {
  active.get(node)?.();
  if (!node?.animate || motionReduced(doc)) { onComplete(); return; }
  const frames = enter
    ? [{ opacity: 0, scale: String(DEPTH) }, { opacity: 1, scale: '1' }]
    : [{ opacity: 1, scale: '1' }, { opacity: 0, scale: String(DEPTH) }];
  track(node, [node.animate(frames, { duration: MS, easing: enter ? EASE_IN : EASE, fill: 'both' })], onComplete, gate);
}
/** فتح طبقة فرعية (صفحات الموحد: آخر التحديثات، الجدول، اكتشف، البحث): العقد نفسه، تلاشٍ واندفاع للداخل. */
export function layerIn(node, opts = {}) { handoffSurface(node, { ...opts, enter: true }); }
/** إغلاقها: تلاشٍ واندفاع للخارج، ثم `done` (إزالتها). بلا حركة: فورًا. */
export function layerOut(node, done = () => {}, opts = {}) { handoffSurface(node, { ...opts, onComplete: done }); }
/**
 * الرئيسية تحت طبقة الموحد العائدة: مخفية طوال دخول الطبقة ثم تظهر تحتها وقد صارت الطبقة معتمة. بلا هذا
 * تُرى الرئيسية من خلال الطبقة وهي تتلاشى (صفحة ثالثة بين المغادرة والعائدة).
 */
export function veil(page, { doc = globalThis.document } = {}) {
  if (!page?.animate || motionReduced(doc)) return;
  track(page, [page.animate([{ opacity: 0 }, { opacity: 0 }], { duration: MS, fill: 'both' })], () => {});
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
