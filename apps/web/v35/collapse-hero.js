/**
 * بطل صفحة العمل وهو ينطوي مع التمرير (الأنمي والسينما).
 *
 * طبقتان بسرعتين: الخلفية أبطأ من الصفحة (تبدو كأنها تنكمش خلفها)، والشعار فوقها
 * بسرعة ثالثة يصغر ويخفت. وحين يقترب البطل من الترويسة تصير الترويسة صلبة (لا
 * محتوى يظهر من خلفها) ويدخلها الشعار صغيرًا. كله transform وopacity فقط، كل
 * إطار مرة واحدة (rAF)، ومن طلب تقليل الحركة يرى الطيّ وحده بلا انزلاق.
 */

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** نسبة الطيّ 0..1 من التمرير وارتفاع البطل والترويسة. */
export function collapseProgress(scrollY, heroHeight, barHeight) {
  const span = Math.max(1, heroHeight - barHeight);
  return clamp(scrollY / span);
}

/** قيم الطبقات لنسبة طيّ وتمرير معيّنين (منفصلة لتُختبر). */
export function heroFrame(scrollY, p, { still = false } = {}) {
  if (still) return { bg: null, head: null, headOpacity: 1, collapsed: p >= 0.9 };
  const y = Math.max(0, scrollY);
  return {
    // الخلفية تنزل بنصف سرعة الصفحة وتكبر فتغوص خلفها (العمق)، ولا يظهر حدّها
    bg: `translate3d(0, ${(y * 0.5).toFixed(1)}px, 0) scale(${(1 + p * 0.12).toFixed(4)})`,
    // الشعار أقرب للعين: يسبق الصفحة صعودًا وينحني للخلف بمنظور خفيف ويصغر نحو الترويسة
    head: `perspective(800px) translate3d(0, ${(-y * 0.18).toFixed(1)}px, 0) rotateX(${(p * 14).toFixed(2)}deg) scale(${(1 - p * 0.14).toFixed(4)})`,
    headOpacity: clamp(1 - (p - 0.2) / 0.5),
    collapsed: p >= 0.9,
  };
}

/**
 * طبقة عمق إضافية لها معادلة CSS نفسها: `range(span, vh)` يعطي بداية المدى ونهايته بالبكسل،
 * و`at(t, span)` قيم الطبقة عند نسبة t من 0 إلى 1. يُكتب منها فقط حين لا يدعم المحرك الخط الزمني،
 * أو أثناء الانزلاق بعد رفع الإصبع؛ فالمعادلتان يجب أن تتطابقا وإلا قفزت الطبقة عند التسليم.
 * @typedef {{ node: HTMLElement, range: (span: number, vh: number) => [number, number], at: (t: number, span: number) => { transform: string, opacity: number } }} DepthLayer
 */

/** قيمة خطية بين a وb عند t (نفس استيفاء CSS لـkeyframes ذات الدوال المتطابقة). */
export const lerp = (a, b, t) => a + (b - a) * t;
/** نسبة التقدم داخل مدى [start, end] من التمرير، محصورة بين 0 و1. */
export const rangeProgress = (y, [start, end]) => clamp((y - start) / Math.max(1, end - start));

/**
 * @param {{ hero: HTMLElement, bar: HTMLElement, bg?: HTMLElement|null, head?: HTMLElement|null, layers?: DepthLayer[], active: () => boolean }} o
 * @returns {() => void} فكّ الربط
 */
export function bindCollapsingHero({ hero, bar, bg = null, head = null, layers = [], active }) {
  let queued = false;
  let last = null;
  const still = reduced();
  // عنصر يحرّكه CSS بخط زمني للتمرير (anime.css/cinema.css) لا يُكتب عليه transform: الكتابة
  // من هنا متأخرة إطارًا عن التمرير وهي سبب الاهتزاز. يبقى هذا المسار للمحركات التي لا تدعمه.
  const scrollDriven = (node) => !!node && (globalThis.getComputedStyle?.(node)?.animationName ?? 'none') !== 'none';
  const cssBg = scrollDriven(bg), cssHead = scrollDriven(head);
  // طبقة قد تكون دالة تُرجع العنصر الحالي: أنماط الصفحة تعيد رسم محتواها حين تصل البيانات
  const nodeOf = (l) => (typeof l.node === 'function' ? l.node() : l.node);
  const cssLayers = layers.filter((l) => scrollDriven(nodeOf(l)));
  const fixedCss = [cssBg ? bg : null, cssHead ? head : null].filter(Boolean);
  const cssNodesNow = () => [...fixedCss, ...cssLayers.map(nodeOf)].filter(Boolean);
  const cssNodes = cssNodesNow();
  // WebView من 153 إلى 156 يحبس الانزلاق بعد رفع الإصبع ما دامت على الصفحة حركة مربوطة بالتمرير
  // ثم يلقيه دفعة واحدة (crbug 572898003). فالسحب بالإصبع لـCSS، والانزلاق بعده لهذا المسار
  // بنفس القيم حتى يتوقف، ثم يعود CSS.
  let handed = false;
  let span = 0;
  let touching = false;
  let moved = false;
  let idle = null;
  const frame = () => {
    queued = false;
    if (!active() || !hero.isConnected) return;
    const y = window.scrollY;
    const next = Math.max(1, hero.offsetHeight - bar.offsetHeight);
    // مدى CSS هو مدى هذا المسار نفسه: لا قفزة عند التسليم بينهما
    if (cssNodes.length && next !== span) hero.style.setProperty?.('--hero-span', `${next}px`);
    span = next;
    const p = collapseProgress(y, hero.offsetHeight, bar.offsetHeight);
    // CSS يثبت عند نهاية المدى، فالمسار حين يتسلّم منه يثبت مثله
    const f = heroFrame(handed ? Math.min(y, span) : y, p, { still });
    if (bg && f.bg && (!cssBg || handed)) bg.style.transform = f.bg;
    if (head && (!cssHead || handed)) {
      if (f.head) head.style.transform = f.head;
      head.style.opacity = String(f.headOpacity);
    }
    const vh = globalThis.innerHeight || window.innerHeight || 800;
    for (const l of layers) {
      if (still || (cssLayers.includes(l) && !handed)) continue;
      const node = nodeOf(l);
      if (!node) continue;
      const v = l.at(rangeProgress(y, l.range(span, vh)), span);
      node.style.transform = v.transform;
      node.style.opacity = String(v.opacity);
    }
    if (f.collapsed !== last) {
      last = f.collapsed;
      bar.classList.toggle('collapsed', f.collapsed);
    }
  };
  const handBack = () => {
    clearTimeout(idle);
    idle = null;
    if (!handed) return;
    handed = false;
    for (const n of cssNodesNow()) n.style.animation = '';
    // حركة CSS العائدة تبدأ معلّقة إطارًا تُرسم فيه بلا قيمها (البنر في أعلاه لحظة)؛ القيم
    // المكتوبة تبقى تحتها حتى تعمل، فهي تغطيها ما دامت فاعلة
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (handed) return;
      for (const n of cssNodesNow()) {
        n.style.transform = '';
        n.style.opacity = '';
      }
    }));
  };
  const settle = (ms) => {
    clearTimeout(idle);
    idle = setTimeout(handBack, ms);
  };
  const onScroll = () => {
    if (touching) moved = true;
    if (handed) settle(180);
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  let startY = 0;
  const onTouchStart = (e) => {
    touching = true;
    moved = false;
    startY = e?.touches?.[0]?.clientY ?? 0;
    handBack();
  };
  const onTouchEnd = (e) => {
    touching = false;
    // الزحلقة السريعة: الـWebView يمرّر على خيط آخر وحدث scroll يصل الصفحة بعد رفع الإصبع،
    // فالحكم بحركة الإصبع نفسها (كانت تفوت زحلقة من كل خمس تقريبًا فيتجمّد الانزلاق)
    const endY = e?.changedTouches?.[0]?.clientY;
    if (endY != null && Math.abs(endY - startY) > 6) moved = true;
    if (!moved || !cssNodes.length || !active() || !hero.isConnected) return;
    handed = true;
    frame();
    for (const n of cssNodesNow()) n.style.animation = 'none';
    settle(180);
  };
  const touch = { passive: true };
  window.addEventListener('scroll', onScroll, { passive: true });
  if (cssNodes.length) {
    window.addEventListener('touchstart', onTouchStart, touch);
    window.addEventListener('touchend', onTouchEnd, touch);
    window.addEventListener('touchcancel', onTouchEnd, touch);
    window.addEventListener('scrollend', handBack, touch);
  }
  frame();
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('scrollend', handBack);
    handBack();
  };
}
