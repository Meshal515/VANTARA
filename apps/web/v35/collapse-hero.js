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
 * @param {{ hero: HTMLElement, bar: HTMLElement, bg?: HTMLElement|null, head?: HTMLElement|null, active: () => boolean }} o
 * @returns {() => void} فكّ الربط
 */
export function bindCollapsingHero({ hero, bar, bg = null, head = null, active }) {
  let queued = false;
  let last = null;
  const still = reduced();
  const frame = () => {
    queued = false;
    if (!active() || !hero.isConnected) return;
    const y = window.scrollY;
    const p = collapseProgress(y, hero.offsetHeight, bar.offsetHeight);
    const f = heroFrame(y, p, { still });
    if (bg && f.bg) bg.style.transform = f.bg;
    if (head) {
      if (f.head) head.style.transform = f.head;
      head.style.opacity = String(f.headOpacity);
    }
    if (f.collapsed !== last) {
      last = f.collapsed;
      bar.classList.toggle('collapsed', f.collapsed);
    }
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  frame();
  return () => window.removeEventListener('scroll', onScroll);
}
