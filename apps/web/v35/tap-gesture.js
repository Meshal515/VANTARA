/**
 * لمسة القارئ: متى تكون «ضغطة» فعلًا، لا جزءًا من تمرير.
 *
 * على قواعد Android نفسها (`GestureDetector`، وعليها قارئ Mihon المفتوح المصدر):
 *   - الإصبع لم يتحرك أكثر من مسافة اللمس (touch slop ≈ 8dp) ورُفع بسرعة.
 *   - الضغطة المفردة لا تُعتمد إلا بعد مهلة الضغطة المزدوجة
 *     (`onSingleTapConfirmed`)، ولا تُعتمد إن بدأ تمريرٌ خلالها.
 *   - إصبع ثانٍ (تكبير) أو إلغاءٌ من المتصفح يُسقط اللمسة.
 * وفوقها ما يخص صفحة ويب تتمرر:
 *   - لمسةٌ توقف تمريرًا مندفعًا ليست ضغطة (كان هذا أكثر ما يُظهر الشريط).
 *   - إن تحرّك المحتوى نفسه بين النزول والرفع فهي تمرير، مهما قلّت حركة الإصبع.
 *
 * منطقٌ صرف بلا DOM: الوقت والتمرير يُمرَّران إليه، فيُختبر بلا متصفح.
 */

export const TAP = Object.freeze({
  SLOP: 10, // بكسل CSS (≈ dp)
  MAX_PRESS: 300, // أطول ضغطة؛ أطول منها ضغطٌ مطوّل لا ضغطة
  CONFIRM: 280, // مهلة الضغطة المزدوجة قبل اعتماد المفردة
  FLING_GUARD: 350, // لمسةٌ بعد تمرير بأقل من هذا توقفه ولا تُحسب
  DOUBLE_REACH: 90, // الضغطة الثانية قريبة من الأولى
  SCROLL_EPS: 2, // المحتوى تحرك أكثر من هذا = تمرير
});

/**
 * @param {{ onTap: (p: {x:number,y:number,target:any}) => void,
 *   onDoubleTap?: (p: {x:number,y:number,target:any}) => void,
 *   scrollPos: () => number, doubleTap?: () => boolean,
 *   setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} opts
 */
export function createTapRecognizer(opts) {
  const setTimer = opts.setTimer ?? setTimeout;
  const clearTimer = opts.clearTimer ?? clearTimeout;
  const pointers = new Set();
  let press = null;
  let lastScrollAt = -Infinity;
  let pending = null; // ضغطة مفردة تنتظر التأكيد
  let lastUp = null; // لضغطةٍ مزدوجة

  function dropPending() {
    if (pending) clearTimer(pending.timer);
    pending = null;
  }

  return {
    /** كل حدث تمرير (المحتوى تحرك). */
    scrolled(t) {
      lastScrollAt = t;
      // تمريرٌ بدأ بعد الضغطة وقبل اعتمادها: كانت بداية سحب لا ضغطة
      if (pending && t >= pending.t) dropPending();
    },
    down({ id, x, y, t, target }) {
      pointers.add(id);
      if (pointers.size > 1) {
        // إصبعان = تكبير أو سحب، لا ضغطة
        press = null;
        dropPending();
        return;
      }
      press = { id, x, y, t, target, scroll: opts.scrollPos(), dead: t - lastScrollAt < TAP.FLING_GUARD };
    },
    move({ id, x, y }) {
      if (!press || press.id !== id) return;
      if (Math.abs(x - press.x) > TAP.SLOP || Math.abs(y - press.y) > TAP.SLOP) press.dead = true;
    },
    cancel({ id }) {
      pointers.delete(id);
      if (press?.id === id) press = null;
    },
    up({ id, x, y, t }) {
      pointers.delete(id);
      const p = press;
      press = null;
      if (!p || p.id !== id || p.dead) return false;
      if (t - p.t > TAP.MAX_PRESS) return false;
      if (Math.abs(x - p.x) > TAP.SLOP || Math.abs(y - p.y) > TAP.SLOP) return false;
      if (Math.abs(opts.scrollPos() - p.scroll) > TAP.SCROLL_EPS) return false;
      const point = { x, y, target: p.target };
      // ضغطة ثانية قريبة وسريعة = مزدوجة
      if (opts.onDoubleTap && opts.doubleTap?.() && lastUp && t - lastUp.t < TAP.CONFIRM && Math.hypot(x - lastUp.x, y - lastUp.y) < TAP.DOUBLE_REACH) {
        dropPending();
        lastUp = null;
        opts.onDoubleTap(point);
        return true;
      }
      lastUp = { x, y, t };
      dropPending();
      pending = {
        t,
        timer: setTimer(() => {
          const ok = pending;
          pending = null;
          if (ok) opts.onTap(point);
        }, TAP.CONFIRM),
      };
      return true;
    },
    reset() {
      pointers.clear();
      press = null;
      dropPending();
    },
  };
}
