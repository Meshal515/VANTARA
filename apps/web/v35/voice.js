/**
 * رسائل المجلس الصوتية: تسجيل وتشغيل.
 *
 * التسجيل MediaRecorder (Opus في WebM على أندرويد)، والموجة تُقرأ من
 * AnalyserNode أثناء التسجيل نفسه (لا فكّ للملف بعده): 48 قيمة 0..1 تُرسل مع
 * الرسالة فتُرسم عند الجميع بلا تنزيل الصوت. أقل من ثلث ثانية لا يُرسل،
 * والسقف خمس دقائق (حجم الملف تحت سقف الخادم).
 *
 * التشغيل: عنصر صوت واحد للتطبيق كله — تشغيل رسالة يوقف السابقة، والتمرير لا
 * يقطعه.
 */

export const MIN_VOICE_MS = 300;
export const MAX_VOICE_MS = 300_000;
export const WAVE_BARS = 48;

/** يضغط عيّنات السعة إلى عدد ثابت من الأعمدة، مطبّعة لأعلاها. */
export function toWaveform(samples, bars = WAVE_BARS) {
  if (!samples.length) return Array(bars).fill(0.08);
  const out = [];
  const step = samples.length / bars;
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let peak = 0;
    for (let j = from; j < to && j < samples.length; j++) peak = Math.max(peak, samples[j]);
    out.push(peak);
  }
  const max = Math.max(...out, 0.001);
  return out.map((v) => Math.max(0.06, Math.round((v / max) * 100) / 100));
}

export function formatDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * يبدأ التسجيل. يرجع مقبضًا: `stop()` يعطي {blob, durationMs, waveform} أو null
 * إن كان فارغًا/قصيرًا، و`cancel()` يرمي كل شيء. `onLevel(level)` للموجة الحيّة.
 */
export async function startRecording({ onLevel, onLimit } = {}) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw Object.assign(new Error('unsupported'), { code: 'unsupported' });
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    throw Object.assign(new Error('denied'), { code: e?.name === 'NotAllowedError' ? 'denied' : 'unavailable' });
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
  const recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data?.size && chunks.push(e.data);

  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const audio = Ctx ? new Ctx() : null;
  const analyser = audio?.createAnalyser();
  if (audio && analyser) {
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
  }
  const samples = [];
  const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
  const startedAt = performance.now();
  let raf = 0;
  let done = false;
  const tick = () => {
    if (done) return;
    if (analyser && buf) {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / buf.length) * 3);
      samples.push(level);
      onLevel?.(level);
    }
    if (performance.now() - startedAt >= MAX_VOICE_MS) {
      onLimit?.();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  recorder.start(250);
  raf = requestAnimationFrame(tick);

  const release = () => {
    done = true;
    cancelAnimationFrame(raf);
    for (const t of stream.getTracks()) t.stop();
    void audio?.close().catch(() => {});
  };
  // مكالمة، أو خرج من التطبيق: التسجيل المقطوع يُرمى نظيفًا لا يُرسل نصفه
  const interrupted = () => {
    if (document.visibilityState === 'hidden' && recorder.state === 'recording') handle.cancel();
  };
  document.addEventListener('visibilitychange', interrupted);

  const handle = {
    elapsed: () => performance.now() - startedAt,
    stop: () =>
      new Promise((resolve) => {
        document.removeEventListener('visibilitychange', interrupted);
        if (recorder.state === 'inactive') {
          release();
          return resolve(null);
        }
        const durationMs = Math.min(MAX_VOICE_MS, performance.now() - startedAt);
        recorder.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: (recorder.mimeType || type || 'audio/webm').split(';')[0] });
          if (durationMs < MIN_VOICE_MS || blob.size < 200) return resolve(null);
          resolve({ blob, durationMs: Math.round(durationMs), waveform: toWaveform(samples) });
        };
        recorder.stop();
      }),
    cancel: () => {
      document.removeEventListener('visibilitychange', interrupted);
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      chunks.length = 0;
      release();
    },
  };
  return handle;
}

// ───────────────────────── التشغيل ─────────────────────────

const SPEEDS = [1, 1.5, 2];
let player = null;
let current = null;

function audioEl() {
  if (player) return player;
  player = new Audio();
  player.preload = 'none';
  player.addEventListener('timeupdate', () => current?.onTime(player.currentTime * 1000));
  player.addEventListener('ended', () => {
    const c = current;
    current = null;
    c?.onEnd();
  });
  player.addEventListener('pause', () => current?.onPause());
  player.addEventListener('play', () => current?.onPlay());
  return player;
}

/**
 * يشغّل/يوقف رسالة. رسالة جديدة توقف السابقة (وتعيد زرّها لحاله).
 * @param {{ id: string, src: string, speed: number, onTime: Function, onEnd: Function, onPause: Function, onPlay: Function }} msg
 */
export function toggleVoice(msg) {
  const a = audioEl();
  if (current?.id === msg.id) {
    if (a.paused) void a.play().catch(() => msg.onPause());
    else a.pause();
    return;
  }
  const prev = current;
  current = msg;
  prev?.onEnd();
  a.src = msg.src;
  a.playbackRate = msg.speed;
  void a.play().catch(() => {
    current = null;
    msg.onEnd();
  });
}
export function setVoiceSpeed(id, speed) {
  if (current?.id === id && player) player.playbackRate = speed;
}
export function seekVoice(id, ratio) {
  if (current?.id === id && player && Number.isFinite(player.duration)) player.currentTime = player.duration * ratio;
}
export function nextSpeed(speed) {
  return SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
}
export const isPlaying = (id) => current?.id === id && player && !player.paused;
