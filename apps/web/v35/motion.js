/**
 * الحركة — GSAP بطبقة واحدة.
 *
 * كل حركة في الواجهة تمرّ من هنا فتبقى بلغة واحدة: دخول ناعم من تحت، تدرّج
 * بين العناصر، ونوابض قصيرة. ومن طلب تقليل الحركة من نظامه تظهر له الحالة
 * النهائية فورًا. وإن لم يُحمَّل GSAP لأي سبب، تعمل الواجهة كما هي بلا حركة.
 */
import { gsap as GSAP } from '../vendor/gsap.esm.js';

const gsap = () => GSAP ?? null;
export const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const live = () => (reduced() ? null : gsap());

export const EASE = { out: 'expo.out', soft: 'power3.out', spring: 'back.out(1.6)', inOut: 'power2.inOut' };

/** لوحة الأقسام: اللوحة تنزل، والأقسام تتبعها واحدًا واحدًا. */
export function menuIn(menu, items) {
  const g = live();
  if (!g) return;
  g.killTweensOf([menu, ...items]);
  g.fromTo(menu, { opacity: 0, y: -10, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: EASE.out, clearProps: 'opacity,scale,y' });
  g.fromTo(items, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.36, ease: EASE.soft, stagger: 0.045, delay: 0.05, clearProps: 'all' });
}
export function menuOut(menu, done) {
  const g = live();
  if (!g) return done();
  g.killTweensOf(menu);
  g.to(menu, { opacity: 0, y: -6, scale: 0.97, duration: 0.18, ease: 'power2.in', onComplete: () => (g.set(menu, { clearProps: 'opacity,scale,y' }), done()) });
}

/**
 * تبديل القسم: الرئيسية الحالية تبهت وتنكمش قليلًا، ثم الجديدة تدخل
 * بطبقاتها (البانر ثم الشرائط) بتدرّج — كأن التطبيق يغيّر «غرفته».
 */
export function swapViews(from, to, { onSwap } = {}) {
  const g = live();
  if (!g || !from) {
    if (from) from.hidden = true;
    to.hidden = false;
    onSwap?.();
    return;
  }
  g.killTweensOf([from, to]);
  g.timeline()
    .to(from, { opacity: 0, scale: 0.985, filter: 'blur(6px)', duration: 0.22, ease: 'power2.in' })
    .add(() => {
      from.hidden = true;
      g.set(from, { clearProps: 'all' });
      to.hidden = false;
      onSwap?.();
      window.scrollTo({ top: 0, behavior: 'instant' });
    })
    .fromTo(to, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: EASE.soft, clearProps: 'opacity' });
  revealIn(to, 0.26);
}

/** دخول العناصر المعلَّمة `[data-reveal]` داخل حاوية، بترتيبها. */
export function revealIn(container, delay = 0) {
  const g = live();
  if (!g || !container) return;
  const items = [...container.querySelectorAll('[data-reveal]')];
  if (!items.length) return;
  g.fromTo(items, { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.6, ease: EASE.out, stagger: 0.07, delay, clearProps: 'opacity,transform' });
}

/** بطاقات شريط جديد: تنزلق من جهة البداية بتتابع سريع. */
export function stripIn(cards) {
  const g = live();
  if (!g || !cards.length) return;
  g.fromTo(cards, { opacity: 0, x: -18 }, { opacity: 1, x: 0, duration: 0.5, ease: EASE.out, stagger: 0.04, clearProps: 'opacity,transform' });
}

/** البانر: صورة تتقدّم ببطء (Ken Burns) ونص يصعد سطرًا سطرًا. */
export function heroSlideIn(slide) {
  const g = live();
  if (!g || !slide) return;
  const art = slide.querySelector('[data-art]');
  const lines = slide.querySelectorAll('[data-line]');
  if (art) g.fromTo(art, { scale: 1.12 }, { scale: 1, duration: 7, ease: 'power1.out' });
  if (lines.length) g.fromTo(lines, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: EASE.out, stagger: 0.08, delay: 0.1, clearProps: 'opacity,transform' });
}

/** شريط تقدّم البانر: يمتلئ خلال مدة الشريحة. يرجع أداة الإيقاف. */
export function progressFill(bar, seconds, onDone) {
  const g = gsap();
  if (!g || !bar) {
    const t = setTimeout(onDone, seconds * 1000);
    return { kill: () => clearTimeout(t), pause() {}, resume() {} };
  }
  g.killTweensOf(bar);
  return g.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: seconds, ease: 'none', onComplete: onDone });
}

/** نبضة صغيرة لما يُضغط: تأكيد بصري أن اللمسة وصلت. */
export function pop(node) {
  const g = live();
  if (!g || !node) return;
  g.fromTo(node, { scale: 0.92 }, { scale: 1, duration: 0.45, ease: EASE.spring, clearProps: 'transform' });
}

/** دخول صفحة كاملة (صفحة العمل مثلًا): الغلاف ثم الطبقات. */
export function pageIn(page) {
  const g = live();
  if (!g || !page) return;
  const art = page.querySelector('[data-art]');
  if (art) g.fromTo(art, { scale: 1.08, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.9, ease: EASE.out, clearProps: 'opacity' });
  revealIn(page, 0.08);
}

/** عدّ رقمٍ حتى قيمته (التقييم مثلًا). */
export function countUp(node, to, { decimals = 1 } = {}) {
  const g = live();
  if (!node) return;
  if (!g) {
    node.textContent = to.toFixed(decimals);
    return;
  }
  const o = { v: 0 };
  g.to(o, { v: to, duration: 1.1, ease: EASE.soft, onUpdate: () => (node.textContent = o.v.toFixed(decimals)) });
}
