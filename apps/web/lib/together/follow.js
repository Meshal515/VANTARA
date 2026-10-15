/**
 * متابعة موضع المضيف في القراءة بسلاسة حركته نفسها.
 *
 * المضيف يرسل موضعه (صفحة كسرية: 3.42) كل ~80ms، والخادم يختم كل تحديث بوقته `at`.
 * الضيف كان يطارد كل تحديث لحظة وصوله (تقطّع وتأخر). هنا نعرض حركة المضيف متأخرة
 * تأخيرًا ثابتًا صغيرًا (~150ms) ونستكمل بين المواضع الفعلية بأوقاتها — نفس طريقة
 * الألعاب الشبكية (interpolation buffer): حركة مستمرة بنفس السرعة، بلا قفزات.
 *
 * لا يحتاج معرفة ساعة الخادم ولا مقدار تقديمه: الفرق بين وصول التحديث محليًا ووقته `at`
 * أصغره في آخر ثوانٍ هو الربط بين الساعتين (كأسرع رسالة وصلت).
 */
export function createFollower({ delayMs = 150, windowMs = 3000, jumpPages = 3, gapMs = 300, stepMs = 80 } = {}) {
  let samples = [];
  let lags = [];
  return {
    /** موضع جديد من المضيف. يعيد true إن كان قفزة (يُعرض فورًا لا بالتدريج). */
    push(at, pos, local) {
      if (!Number.isFinite(at) || !Number.isFinite(pos)) return false;
      const last = samples.at(-1);
      if (last && at < last.at) return false; // قديم أو خارج الترتيب
      const jump = !last || Math.abs(pos - last.pos) > jumpPages;
      if (jump) samples = [];
      // بعد سكون طويل: الحركة تبدأ قبل أول تحديث بخطوة، لا من آخر موضع قديم بعيد
      else if (at - last.at > gapMs) samples.push({ at: at - stepMs, pos: last.pos });
      if (samples.length && samples.at(-1).at === at) samples[samples.length - 1] = { at, pos };
      else samples.push({ at, pos });
      lags.push({ local, d: local - at });
      lags = lags.filter((x) => local - x.local <= windowMs);
      while (samples.length > 2 && samples[1].at < at - windowMs) samples.shift();
      return jump;
    },
    /** الموضع المعروض الآن؛ `settled` حين وصل آخر موضع معروف (فتتوقف الحركة). */
    position(local) {
      if (!samples.length) return null;
      const d = Math.min(...lags.map((x) => x.d));
      const t = local - d - delayMs;
      const first = samples[0];
      const last = samples.at(-1);
      if (samples.length === 1 || t >= last.at) return { pos: last.pos, settled: true };
      if (t <= first.at) return { pos: first.pos, settled: false };
      for (let i = samples.length - 1; i > 0; i--) {
        const a = samples[i - 1];
        const b = samples[i];
        if (t >= a.at) {
          const k = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
          return { pos: a.pos + (b.pos - a.pos) * k, settled: false };
        }
      }
      return { pos: first.pos, settled: false };
    },
    reset() { samples = []; lags = []; },
  };
}
