/** One compositor transition for work pages: opacity + a small depth scale, 400ms.
 * Navigation tabs retain their stationary fade. No child stagger, blur or cover clone.
 */
const MS = 400;
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
const EASE_IN = EASE;
const DEPTH = 0.985;

export function motionReduced(doc = globalThis.document) {
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || doc?.documentElement?.dataset.motion === 'off';
}
const running = new Set();
const active = new WeakMap();
export function finishPageMotion() {
  for (const stop of [...running]) stop();
}
/** Read once before interrupting: a quick Back must fade from the visible state, not flash opaque. */
export function pageMotionState(page) {
  if (!page || !active.has(page)) return null;
  const css = globalThis.getComputedStyle?.(page);
  return css ? { opacity: Number(css.opacity), transform: css.transform, origin: css.transformOrigin, scrollTop: page.classList.contains('page-in') && page.classList.contains('page-depth') ? page.scrollTop : globalThis.scrollY || 0 } : null;
}
function track(page, animation, restore) {
  let done = false;
  let guard;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(guard);
    running.delete(stop);
    if (active.get(page) === stop) active.delete(page);
    animation.cancel();
    restore();
  };
  running.add(stop); active.set(page, stop);
  guard = setTimeout(stop, MS + 150);
  animation.finished?.then(stop, stop);
}
const save = (page, props) => {
  const previous = Object.fromEntries(props.map(k => [k, page.style[k] ?? '']));
  return () => Object.assign(page.style, previous);
};
function originOf(page, r, offset = 0) {
  const cover = page.querySelector?.('#detailCover,.aw-cover,.wl-stage3d > .wl-card,.wl-cover,.wl-series > img,.cn-poster,.cn-detail-art');
  const c = cover?.getBoundingClientRect();
  // Keep the cover centre anchored; layout and the relative positions of all controls stay intact.
  return c && c.height > 0 ? `${c.left + c.width / 2 - r.left}px ${c.top + c.height / 2 - r.top - offset}px` : `50% ${Math.min(r.height / 2, (globalThis.innerHeight || r.height) * 0.3)}px`;
}
function captureFixed(page, r) {
  // Fixed descendants of a transformed scroll container need the scroll offset
  // compensated. Capture their genuine viewport boxes before changing the containing block.
  const selector = '.aw-bar,.wl-dock,.wl-mini,.cn-detail-bar,.header';
  const anchors = new Map();
  for (const node of page.querySelectorAll?.(selector) ?? []) {
    const css = globalThis.getComputedStyle?.(node);
    if (css?.position !== 'fixed') continue;
    const box = node.getBoundingClientRect();
    const m = css.transform === 'none' ? null : new DOMMatrixReadOnly(css.transform);
    anchors.set([...node.classList].find(c=>['aw-bar','wl-dock','wl-mini','cn-detail-bar','header'].includes(c)),{top:box.top-(m?.m42||0)-Math.max(0,r.top),left:box.left-(m?.m41||0)-r.left,width:box.width,height:box.height});
  }
  const pinned = new Map();
  const scrollControls = () => { for (const node of pinned.keys()) node.style.translate = `0 ${page.scrollTop}px`; };
  const pin = () => {
    for (const node of page.querySelectorAll?.(selector) ?? []) {
      const box = anchors.get([...node.classList].find(c=>['aw-bar','wl-dock','wl-mini','cn-detail-bar','header'].includes(c)));
      if (!box || pinned.has(node)) continue;
      pinned.set(node,save(node,['position','top','left','right','bottom','width','height','margin','translate']));
      Object.assign(node.style,{position:'fixed',top:`${box.top}px`,left:`${box.left}px`,width:`${box.width}px`,height:`${box.height}px`,bottom:'auto',right:'auto',margin:'0'});
    }
    scrollControls();
  };
  return () => {
    pin();
    page.addEventListener?.('scroll',scrollControls,{passive:true});
    const observer = globalThis.MutationObserver ? new MutationObserver(pin) : null;
    observer?.observe(page,{childList:true,subtree:true});
    return () => {
      observer?.disconnect();page.removeEventListener?.('scroll',scrollControls);
      for (const restorePin of pinned.values()) restorePin();
    };
  };
}
export function pageOut(page, { depth = false, hold = false, visual = null, scrollTop = 0, doc = globalThis.document } = {}) {
  active.get(page)?.();
  if (!page?.animate || motionReduced(doc)) return;
  // Entry and exit must both avoid cinema's fixed depth viewport (marquee jump).
  if (page.id === 'cinema' || hold) depth = false;
  const frozen = [...(page.getAnimations?.({subtree:true}) ?? [])].filter(a => a.effect?.target !== page && a.playState === 'running');
  for (const a of frozen) { const t = a.currentTime; a.pause(); if (t != null) a.currentTime = t; }
  const r = page.getBoundingClientRect();
  const bindFixed = captureFixed(page,r);
  const viewHeight = globalThis.innerHeight || r.height;
  const top = Math.max(0, Number.isFinite(r.top) ? r.top : -scrollTop);
  const offset = Math.max(0, -r.top);
  const previousScroll = page.scrollTop || 0;
  const restore = save(page, ['position','top','left','width','height','minHeight','overflow','transformOrigin']);
  const origin = visual?.origin || originOf(page, r, offset);
  page.classList.add('page-out');
  if (depth) page.classList.add('page-depth');
  Object.assign(page.style, { position:'fixed', top: `${top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${Math.max(1, Math.min(r.height, viewHeight - top))}px`, minHeight: '0', overflow: 'hidden' });
  page.scrollTop = previousScroll + offset;
  const unpin = bindFixed();
  if (depth) page.style.transformOrigin = origin;
  const cleanup = () => {
    unpin(); page.classList.remove('page-out','page-depth'); restore(); page.scrollTop = previousScroll;
    for (const a of frozen) if (a.effect?.target?.isConnected) a.play();
  };
  // A fixed-duration "hold" used to expire before the modal fade finished.
  // Hold the old page until the actual handoff completion; the caller releases
  // it on animation.finish, cancellation, reduced-motion or a newer navigation.
  if (hold) {
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      running.delete(release);
      if (active.get(page) === release) active.delete(page);
      cleanup();
    };
    running.add(release);
    active.set(page, release);
    return release;
  }
  const frames = depth
    ? [{ opacity: visual?.opacity ?? 1, transform: visual?.transform && visual.transform !== 'none' ? visual.transform : 'scale(1)' }, { opacity: 0, transform: `scale(${DEPTH})` }]
    : [{opacity:visual?.opacity ?? 1},{opacity:0}];
  track(page, page.animate(frames, {duration:MS,easing:EASE,fill:'both'}), cleanup);
}
/** Keep work-page fixed controls relative to a viewport, not to a 10,000px document.
 * A nonvisual flow placeholder preserves document height and existing root scroll timelines.
 */
function viewportWork(page, doc) {
  const owner = page.ownerDocument ?? doc;
  if (!owner?.createElement || !page.before) return () => {};
  const r = page.getBoundingClientRect();
  const h = globalThis.innerHeight || r.height;
  const previousScroll = page.scrollTop || 0;
  const bindFixed = captureFixed(page,r);
  const restore = save(page,['position','top','left','width','height','minHeight','overflow']);
  const spacer = owner.createElement('div');
  spacer.setAttribute('aria-hidden','true'); spacer.setAttribute('data-motion-space','');
  spacer.style.height = `${r.height}px`;
  page.before(spacer);
  Object.assign(page.style,{position:'fixed',top:`${Math.max(0,r.top)}px`,left:`${r.left}px`,width:`${r.width}px`,height:`${h}px`,minHeight:'0',overflow:'auto'});
  page.scrollTop = previousScroll + Math.max(0,-r.top);
  const unpin = bindFixed();
  return () => {
    unpin();
    const y = page.scrollTop;
    restore(); spacer.remove(); page.scrollTop = previousScroll;
    if (page.classList.contains('active')) globalThis.scrollTo?.({top:y,behavior:'instant'});
  };
}
export function pageIn(page, { depth = false, doc = globalThis.document } = {}) {
  active.get(page)?.();
  if (!page?.animate || motionReduced(doc)) return;
  // Cinema's wide hero must not be put in a temporary fixed, scrollable viewport:
  // restoring that viewport after the fade caused a visible Dexter/Marquee jump.
  if (page.id === 'cinema') depth = false;
  const restore = save(page, ['transformOrigin']);
  const restoreViewport = depth ? viewportWork(page, doc) : () => {};
  if (depth) {
    const r = page.getBoundingClientRect();
    page.style.transformOrigin = originOf(page, r);
    page.classList.add('page-depth');
  }
  page.classList.add('page-in');
  const frames = depth ? [{opacity:0,transform:`scale(${DEPTH})`},{opacity:1,transform:'scale(1)'}] : [{opacity:0},{opacity:1}];
  track(page, page.animate(frames,{duration:MS,easing:EASE,fill:'both'}), () => {
    page.classList.remove('page-in','page-depth'); restore(); restoreViewport();
  });
}

/**
 * Unified subpages stay mounted above a work page. Transition that same
 * subpage to/from the work with the EXISTING page-motion timing and easing.
 * No clone, independently programmed curve, or reveal of the underlying Home.
 */
export function handoffSurface(node, {enter = false, doc = globalThis.document, onComplete = () => {}} = {}) {
  active.get(node)?.();
  if (!node?.animate || motionReduced(doc)) { onComplete(); return; }
  const priorOpacity = node.style.opacity;
  const priorTransition = node.style.transition;
  // .uv-page has its own 400ms CSS opacity transition. Do not let a second
  // transition replay from zero when the Web Animation is cancelled/restored.
  node.style.transition = 'none';
  // Stage the restored modal as transparent within the SAME JS turn as resume().
  if (enter) node.style.opacity = '0';
  const frames = enter ? [{opacity:0},{opacity:1}] : [{opacity:1},{opacity:0}];
  track(node, node.animate(frames, {duration:MS,easing:EASE,fill:'both'}), () => {
    node.style.opacity = priorOpacity;
    // Commit the final opacity before enabling CSS transitions again.
    // Otherwise a finished animation visibly jumps into another 400ms fade.
    void node.offsetWidth;
    node.style.transition = priorTransition;
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
