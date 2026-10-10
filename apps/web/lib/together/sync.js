/**
 * VANTARA Together — الساعة المشتركة ومتحكّم الانحراف. دوال صافية بلا DOM ولا شبكة،
 * فتُختبر بمحاكاة، ويُنقل نفس المنطق حرفيًا إلى Kotlin للـAPK.
 *
 * الخط الزمني من الخادم: {playing, pos, at, rate, seq}. الموقع المطلوب عند لحظة
 * الخادم t هو pos + (t − at) × rate. والانحراف يُقاس عند لحظة قياس موقع المشغّل
 * نفسها (لا عند آخر رسالة وصلت)، فتأخر الشبكة لا يدخل في الحساب.
 *
 * قواعد التصحيح:
 *   |e| < 60ms           ← لا شيء.
 *   انحراف ثابت فوق 60ms ← سرعة متناسبة مع الفرق: 1 − e/2.5s، بين ±1% و±8%،
 *                          حتى يعود تحت 20ms ثم 1×. قراءة عابرة واحدة لا تبدأ تصحيحًا.
 *   قفز                  ← إن كان الموضع المطلوب داخل المخزَّن (قفز رخيص بلا تحميل):
 *                          من 400ms. وإلا من 1.5s. بعد القفز 3 ثوانٍ بلا قفز آخر.
 *   أمر من المضيف        ← يُتبع فورًا، حتى داخل مهلة الثلاث ثوانٍ.
 *   أثناء التحميل        ← لا تصحيح ولا تغيير سرعة؛ يُلحق بعد الجاهزية.
 */

export const SYNC = Object.freeze({
  DEADBAND_MS: 60,
  EXIT_MS: 20,
  CONFIRM: 2,
  TAU_MS: 2500,
  MIN_STEP: 0.01,
  MAX_STEP: 0.08,
  SEEK_BUFFERED_MS: 400,
  SEEK_MS: 1500,
  SEEK_NO_RATE_MS: 1000,
  COOLDOWN_MS: 3000,
  HOST_CMD_SEEK_MS: 250,
  PAUSED_SEEK_MS: 100,
  SAMPLES: 3,
});

/**
 * ساعة الخادم من عينات ping/pong: نأخذ العينة ذات أقل زمن ذهاب وإياب من آخر 8،
 * لأن تأخرها أقل تذبذبًا. now ساعة رتيبة (performance.now / elapsedRealtime).
 */
export function createClock({ now = () => performance.now(), keep = 8 } = {}) {
  const samples = [];
  let best = null;
  return {
    sample(t0, ts, t1 = now()) {
      const rtt = t1 - t0;
      if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(ts)) return best;
      samples.push({ rtt, offset: ts - (t0 + rtt / 2) });
      while (samples.length > keep) samples.shift();
      best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      return best;
    },
    get ready() { return best != null; },
    get offset() { return best?.offset ?? 0; },
    get rtt() { return best?.rtt ?? null; },
    /** خطأ الساعة الأقصى المحتمل: نصف أقل زمن ذهاب وإياب. */
    get uncertainty() { return best ? best.rtt / 2 : null; },
    serverNow(at = now()) { return at + (best?.offset ?? 0); },
    toLocal(serverTime) { return serverTime - (best?.offset ?? 0); },
  };
}

/** الموقع المطلوب عند لحظة الخادم t، مع إزاحة نسخة هذا المشارك (نسخة بمقدمة أطول = إزاحة موجبة). */
export function targetAt(timeline, t, offsetMs = 0) {
  if (!timeline) return null;
  const base = timeline.playing && timeline.media?.kind !== 'manga' ? timeline.pos + Math.max(0, t - timeline.at) * (timeline.rate ?? 1) : timeline.pos;
  return Math.max(0, base + offsetMs);
}

/** وسيط محافظ: في العدد الزوجي يأخذ الأقرب للصفر، فقراءة شاذة واحدة لا تقرّر وحدها. */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length % 2) return s[(s.length - 1) / 2];
  const a = s[s.length / 2 - 1];
  const b = s[s.length / 2];
  return Math.abs(a) <= Math.abs(b) ? a : b;
};

/**
 * متحكّم لكل مشغّل. step() يُستدعى كل ~500ms بقراءة المشغّل، ويُرجع ما يجب فعله:
 *   { playing, rate, seekTo, error, reason }
 * seekTo = null إن لا قفز. المشغّل ينفّذ ثم يستدعي seeked(msحتى الجاهزية) بعد القفز.
 */
export function createDriftController(options = {}) {
  const k = { ...SYNC, ...options };
  let errors = [];
  let correcting = false;
  let over = 0;
  let cooldownUntil = -Infinity;
  let lastSeq = null;
  let loadMs = 800;
  const drift = [];

  const reset = () => { errors = []; correcting = false; over = 0; };

  function step({ timeline, pos, at, buffering = false, canRate = true, bufferedAhead = 0, bufferedBehind = 0, offsetMs = 0 }) {
    if (!timeline || !Number.isFinite(pos) || !Number.isFinite(at)) return { playing: false, rate: 1, seekTo: null, error: null, reason: 'no-timeline' };
    const target = targetAt(timeline, at, offsetMs);
    const e = pos - target;
    const hostCommand = lastSeq != null && timeline.seq !== lastSeq;
    lastSeq = timeline.seq;
    const seekTarget = (cheap) => targetAt(timeline, at + (cheap || !timeline.playing ? 0 : loadMs), offsetMs);

    if (hostCommand) {
      reset();
      if (Math.abs(e) > k.HOST_CMD_SEEK_MS) {
        cooldownUntil = at + k.COOLDOWN_MS;
        return { playing: timeline.playing, rate: 1, seekTo: seekTarget(cheapSeek(e, bufferedAhead, bufferedBehind)), error: e, reason: 'host-command' };
      }
    }
    // المتوقف للتحميل: لا سرعة ولا قفز الآن. الغرفة لا تنتظره، وهو يلحق بعد الجاهزية
    if (buffering) {
      reset();
      return { playing: timeline.playing, rate: 1, seekTo: null, error: e, reason: 'buffering' };
    }
    if (!timeline.playing) {
      reset();
      const far = Math.abs(e) > k.PAUSED_SEEK_MS;
      return { playing: false, rate: 1, seekTo: far ? target : null, error: e, reason: far ? 'paused-align' : 'paused' };
    }

    drift.push(Math.abs(e));
    while (drift.length > 60) drift.shift();
    errors.push(e);
    while (errors.length > k.SAMPLES) errors.shift();
    // قراءة واحدة بعد بداية أو قفز لا تكفي لأي قرار
    if (errors.length < 2) return { playing: true, rate: 1, seekTo: null, error: e, reason: 'settling' };
    const sm = median(errors);
    const abs = Math.abs(sm);

    const cheap = cheapSeek(sm, bufferedAhead, bufferedBehind);
    const jumpAt = cheap ? k.SEEK_BUFFERED_MS : canRate ? k.SEEK_MS : k.SEEK_NO_RATE_MS;
    if (abs >= jumpAt && at >= cooldownUntil) {
      reset();
      cooldownUntil = at + k.COOLDOWN_MS;
      return { playing: true, rate: 1, seekTo: seekTarget(cheap), error: e, reason: cheap ? 'seek-buffered' : 'seek' };
    }
    if (!canRate) return { playing: true, rate: 1, seekTo: null, error: e, reason: 'no-rate' };

    if (correcting) {
      if (abs < k.EXIT_MS) { reset(); return { playing: true, rate: 1, seekTo: null, error: e, reason: 'in-sync' }; }
    } else if (abs > k.DEADBAND_MS) {
      over += 1;
      if (over >= k.CONFIRM) correcting = true;
    } else over = 0;

    if (!correcting) return { playing: true, rate: 1, seekTo: null, error: e, reason: 'in-sync' };
    const stepSize = Math.min(k.MAX_STEP, Math.max(k.MIN_STEP, abs / k.TAU_MS));
    return { playing: true, rate: 1 - Math.sign(sm) * stepSize, seekTo: null, error: e, reason: 'rate' };
  }

  function cheapSeek(e, ahead, behind) {
    // متأخر (e<0) يقفز للأمام داخل المخزَّن؛ متقدّم يقفز للخلف داخل ما بقي خلفه
    return e < 0 ? ahead >= -e + 500 : behind >= e;
  }

  return {
    step,
    /** زمن جاهزية آخر قفز خارج المخزَّن: يُضاف للهدف في القفز القادم. */
    seeked(msToReady) {
      if (Number.isFinite(msToReady) && msToReady >= 0) loadMs = Math.min(3000, loadMs * 0.6 + msToReady * 0.4);
    },
    /** p50 وp95 لِـ|e| خلال آخر ~30 ثانية: يُرسل في report ويظهر في اللوحة. */
    stats() {
      if (!drift.length) return { p50: null, p95: null };
      const s = [...drift].sort((a, b) => a - b);
      const at = (q) => Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
      return { p50: at(0.5), p95: at(0.95) };
    },
    get loadMs() { return loadMs; },
  };
}

/** موقع مشارك الآن في الوضع الحر من آخر تقرير: يتقدّم بين التقارير إن كان يشاهد. */
export function memberPosition(member, serverNow) {
  if (member?.pos == null) return null;
  if (member.state !== 'playing' || member.at == null) return member.pos;
  return member.pos + Math.max(0, serverNow - member.at);
}

/** «12:04» أو «1:02:09» للوحة الغرفة. */
export function clockLabel(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
