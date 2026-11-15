/**
 * وحدات التنزيل: الحجم والسرعة والوقت المتبقي.
 *
 * قواعد ثابتة:
 *   - البايت بوحدات ثنائية (1024) وأسماء SI المألوفة (KB/MB/GB) كما يعرضها مستكشف الملفات،
 *     والسرعة بايتات في الثانية (MB/s) لا بتات (Mbps): خلطهما يضرب الرقم في ثمانية.
 *   - الأرقام لاتينية ومن اليسار لليمين حتى داخل نص عربي (`dir="ltr"` على العقدة).
 *   - الوقت المتبقي لا يُعرض إلا والسرعة مستقرة: رقم يقفز من دقيقة إلى ساعة كل ثانية أسوأ من غيابه.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** «840 MB»، «1.4 GB». المجهول أو السالب ⇒ null (الواجهة لا تخترع رقمًا). */
export function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 1;
  return `${Number(v.toFixed(digits))} ${UNITS[i]}`;
}

/** «8.2 MB/s». صفر أو مجهول ⇒ null: لا «0 B/s» توهم أن التنزيل يعمل. */
export function formatSpeed(bytesPerSecond) {
  const n = Number(bytesPerSecond);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${formatBytes(n)}/s`;
}

/** «840 MB / 1.4 GB»، أو «840 MB» إن كان الإجمالي مجهولًا. */
export function formatProgressBytes(done, total) {
  const a = formatBytes(done ?? 0);
  const b = total > 0 ? formatBytes(total) : null;
  return b ? `${a} / ${b}` : a;
}

/** الوقت المتبقي نصًا عربيًا قصيرًا: «نحو دقيقة»، «نحو 12 دقيقة»، «نحو ساعتين». */
export function formatEta(seconds) {
  // null/undefined تعني «لا يصح الحساب» (سرعة غير مستقرة أو حجم مجهول): لا نص. Number(null) صفر فكان يعرض «أقل من دقيقة»
  if (seconds == null || seconds === '') return null;
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 45) return 'أقل من دقيقة';
  const minutes = Math.round(s / 60);
  if (minutes < 2) return 'نحو دقيقة';
  if (minutes === 2) return 'نحو دقيقتين';
  if (minutes < 60) return `نحو ${minutes} ${minutes <= 10 ? 'دقائق' : 'دقيقة'}`;
  const hours = Math.round(minutes / 60);
  if (hours === 1) return 'نحو ساعة';
  if (hours === 2) return 'نحو ساعتين';
  return `نحو ${hours} ${hours <= 10 ? 'ساعات' : 'ساعة'}`;
}

/** نسبة التقدّم 0..1، أو null حين الإجمالي مجهول (شريط غير محدد لا نسبة مختلقة). */
export function progressRatio(done, total) {
  const d = Number(done);
  const t = Number(total);
  if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(d) || d < 0) return null;
  return Math.min(1, d / t);
}

/**
 * مقياس سرعة: متوسط أسي مرجَّح على عينات (وقت، بايتات تراكمية)، ومعه حكم الاستقرار.
 * السرعة اللحظية تهتز مع كل جزء؛ المتوسط يعطي رقمًا هادئًا، والاستقرار يقرر هل يُعرض الوقت المتبقي.
 */
export function createRateMeter({ halfLifeMs = 3000, minSamples = 3, maxSpread = 0.6 } = {}) {
  let last = null;
  let rate = 0;
  let samples = 0;
  /** آخر السرعات اللحظية: انحرافها النسبي هو مقياس الاستقرار. */
  const recent = [];
  return {
    /** عينة جديدة: الزمن (ms) والبايتات المنزّلة حتى الآن. التراجع (استئناف من الصفر) يبدأ القياس من جديد. */
    sample(atMs, bytes) {
      if (!last || bytes < last.bytes || atMs <= last.at) {
        if (!last || bytes < last.bytes) {
          rate = 0;
          samples = 0;
          recent.length = 0;
        }
        last = { at: atMs, bytes };
        return rate;
      }
      const dt = atMs - last.at;
      const instant = ((bytes - last.bytes) * 1000) / dt;
      const alpha = 1 - 2 ** (-dt / halfLifeMs);
      rate = samples === 0 ? instant : rate + alpha * (instant - rate);
      samples++;
      recent.push(instant);
      if (recent.length > 6) recent.shift();
      last = { at: atMs, bytes };
      return rate;
    },
    /** توقف النقل (إيقاف أو انقطاع): السرعة صفر، والقياس يبدأ من جديد عند العودة. */
    reset() {
      last = null;
      rate = 0;
      samples = 0;
      recent.length = 0;
    },
    rate: () => rate,
    /** مستقرة = عينات كافية، وتشتت السرعات الأخيرة حول متوسطها أقل من الحد. */
    stable() {
      if (samples < minSamples || rate <= 0 || recent.length < minSamples) return false;
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (mean <= 0) return false;
      const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length;
      return Math.sqrt(variance) / mean <= maxSpread;
    },
  };
}

/** ثوانٍ متبقية، أو null حين لا يصح الحساب (إجمالي مجهول، سرعة غير مستقرة). */
export function etaSeconds({ done, total, rate, stable }) {
  if (!stable || !(rate > 0) || !(total > 0)) return null;
  const left = total - (done ?? 0);
  if (left <= 0) return 0;
  return left / rate;
}
