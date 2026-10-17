/**
 * بطل صفحة العمل وهو ينطوي مع التمرير (الأنمي والسينما).
 *
 * طبقات بسرعات مختلفة: الخلفية أبطأ من الصفحة (تنزل وتغرق خلفها)، والغلاف (إن وُجد)
 * قدّامها يصعد أسرع وينحني للخلف بعمق خفيف، والشعار بسرعة ثالثة يصغر ويخفت. وحين يقترب البطل من الترويسة تصير الترويسة صلبة (لا
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
  if (still) return { bg: null, head: null, cover: null, headOpacity: 1, coverOpacity: 1, collapsed: p >= 0.9 };
  const y = Math.max(0, scrollY);
  return {
    // الخلفية تتحرك بنصف سرعة الصفحة، وتكبر قليلًا فلا يظهر حدّها
    bg: `translate3d(0, ${(y * 0.5).toFixed(1)}px, 0) scale(${(1 + p * 0.06).toFixed(4)})`,
    // الشعار يسبق الصفحة صعودًا قليلًا (فلا يقترب مما تحته) ويصغر نحو الترويسة
    head: `translate3d(0, ${(-y * 0.18).toFixed(1)}px, 0) scale(${(1 - p * 0.14).toFixed(4)})`,
    headOpacity: clamp(1 - (p - 0.2) / 0.5),
    // الغلاف أقرب للعين: يصعد أسرع من الصفحة وينحني للخلف ويصغر — العمق بين الطبقتين
    cover: `perspective(900px) translate3d(0, ${(-y * 0.32).toFixed(1)}px, 0) rotateX(${(p * 18).toFixed(2)}deg) scale(${(1 - p * 0.14).toFixed(4)})`,
    coverOpacity: clamp(1 - (p - 0.3) / 0.45),
    collapsed: p >= 0.9,
  };
}

/**
 * @param {{ hero: HTMLElement, bar: HTMLElement, bg?: HTMLElement|null, head?: HTMLElement|null, cover?: HTMLElement|null, active: () => boolean }} o
 * @returns {() => void} فكّ الربط
 */
export function bindCollapsingHero({ hero, bar, bg = null, head = null, cover = null, active }) {
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
    if (cover) {
      if (f.cover) cover.style.transform = f.cover;
      cover.style.opacity = String(f.coverOpacity);
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
