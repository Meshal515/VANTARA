/**
 * مسجّل وقفات التمرير في القارئ: Debug فقط، ومن «إظهار التشخيص» فقط (lib/diagnostics-ui.js).
 *
 * يقيس على الجهاز نفسه ما لا يظهر في Chromium المكتبي (زخمه المحاكى يعطي إطارات «ثابتة» حتى بلا أي عمل):
 * هل وقف التمرير فعلًا (الموضع ثابت والإطارات تجري)، أم تجمّد الرسم (فجوة بين الإطارات)، والإصبع على
 * الشاشة أم هو الزخم، وما الذي حدث قبلها مباشرة (صورة دخلت، بُعدها عن موضعك، فكّها، مهمة طويلة).
 * لا يغيّر شيئًا في القارئ؛ بلا التشخيص لا يُنشأ أصلًا.
 */

/** فجوة بين إطارين تعني أن الرسم تجمّد. */
export const FRAME_GAP_MS = 50;
/** إطارات متتالية بلا حركة بين حركتين تعني أن التمرير نفسه وقف (لا نهاية زخم: الحركة عادت). */
export const HOLD_FRAMES = 3;
/** ما يُعرض مع كل وقفة: ما حدث قبلها بهذه المدة. */
export const LOOKBACK_MS = 300;

/**
 * يفحص آخر الإطارات `[t, top, finger]` ويرجع وقفة انتهت للتو، أو null.
 * - `frame-gap`: إطار تأخر أكثر من FRAME_GAP_MS والصفحة كانت تتحرك قبله.
 * - `scroll-hold`: HOLD_FRAMES إطارات أو أكثر بلا حركة، قبلها حركة وبعدها حركة في الاتجاه نفسه.
 */
export function detectStall(frames) {
  const n = frames.length;
  if (n < 3) return null;
  const [t, top, finger] = frames[n - 1];
  const [pt, ptop] = frames[n - 2];
  const moved = top !== ptop;
  const before = n >= 3 ? ptop - frames[n - 3][1] : 0;
  if (t - pt > FRAME_GAP_MS && before !== 0) {
    return { kind: 'frame-gap', at: pt, ms: Math.round(t - pt), dy: Math.round(top - ptop), finger: Boolean(finger) };
  }
  if (!moved) return null;
  // الحركة عادت الآن: كم إطارًا قبلها كان ثابتًا؟
  let i = n - 2;
  while (i > 0 && frames[i][1] === frames[i - 1][1]) i--;
  const still = n - 2 - i;
  if (still < HOLD_FRAMES || i < 1) return null;
  const was = frames[i][1] - frames[i - 1][1];
  const now = top - ptop;
  if (was === 0 || Math.sign(was) !== Math.sign(now)) return null;
  return { kind: 'scroll-hold', at: frames[i][0], ms: Math.round(pt - frames[i][0]), frames: still, finger: Boolean(finger || frames[i][2]) };
}

/**
 * @param {{ scroll: Element, page: () => { index: number, total: number },
 *   now?: () => number, raf?: Function, caf?: Function, Observer?: any }} deps
 */
export function createStallRecorder({ scroll, page, now = () => performance.now(), raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame, Observer = globalThis.PerformanceObserver }) {
  const started = now();
  const frames = [];
  const events = [];
  const stalls = [];
  const listeners = new Set();
  let finger = false;
  let id = 0;
  let stopped = false;
  const keep = (list, ms) => { const edge = now() - ms; while (list.length && list[0][0] < edge) list.shift(); };
  const note = (kind, detail) => { if (!stopped) { events.push([now(), kind, detail]); keep(events, 2_000); } };
  const down = () => { finger = true; };
  const up = (e) => { if (!e.touches?.length) finger = false; };
  scroll.addEventListener('touchstart', down, { passive: true });
  scroll.addEventListener('touchend', up, { passive: true });
  scroll.addEventListener('touchcancel', up, { passive: true });
  const visible = (e) => { if (!e.skipped) note('draw', `p${Number(e.target?.dataset?.index ?? -1) + 1}`); };
  scroll.addEventListener('contentvisibilityautostatechange', visible, true);
  const observers = [];
  const watch = (type, fn) => {
    try { const o = new Observer((list) => { for (const e of list.getEntries()) fn(e); }); o.observe({ type, buffered: false }); observers.push(o); } catch { /* غير مدعوم هنا (سفاري) */ }
  };
  watch('long-animation-frame', (e) => {
    const layout = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0;
    const scripts = (e.scripts ?? []).filter((s) => s.duration >= 5).slice(0, 3).map((s) => `${s.sourceFunctionName || s.invoker || 'script'} ${Math.round(s.duration)}ms`);
    events.push([e.startTime, 'long', `${Math.round(e.duration)}ms (تخطيط ${Math.round(layout)}ms)${scripts.length ? ' ' + scripts.join('، ') : ''}`]);
  });
  watch('layout-shift', (e) => { if (e.value >= 0.01) events.push([e.startTime, 'shift', e.value.toFixed(2)]); });
  const loop = (t) => {
    if (stopped) return;
    frames.push([t, scroll.scrollTop, finger]);
    keep(frames, 3_000);
    const stall = detectStall(frames);
    if (stall) {
      const from = stall.at - LOOKBACK_MS;
      const before = events.filter(([at]) => at >= from && at <= stall.at + 20).map(([at, kind, detail]) => `${Math.round(at - stall.at)}ms ${kind} ${detail}`);
      const where = page();
      stalls.push({ ...stall, sec: Math.round((stall.at - started) / 100) / 10, page: `${where.index + 1}/${where.total}`, before });
      if (stalls.length > 40) stalls.shift();
      for (const fn of listeners) fn(stalls.length);
    }
    id = raf(loop);
  };
  id = raf(loop);
  return {
    note,
    stalls: () => stalls.slice(),
    onStall(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** `native`: رسائل الخيط الرئيسي الطويلة في الـAPK `{ start, end, ms, what, stack }` بساعة هذه الصفحة. */
    report(native = []) {
      const overlap = (s) => native.filter((b) => b.end >= s.at - LOOKBACK_MS && b.start <= s.at + s.ms + 50);
      const nativeLine = (b, at) => `${Math.round(b.start - at)}ms الخيط الرئيسي ${b.ms}ms ${b.what}${b.stack?.length ? ` ← ${b.stack.slice(0, 4).join(' ← ')}` : ''}`;
      const text = stalls.map((s) => [
        `${s.sec}s ${s.kind === 'scroll-hold' ? `وقف التمرير ${s.ms}ms (${s.frames} إطارات)` : `تجمّد الرسم ${s.ms}ms (قفز ${s.dy}px)`} ${s.finger ? 'والإصبع على الشاشة' : 'أثناء الزخم'}، صفحة ${s.page}`,
        ...s.before.map((line) => `  ${line}`),
        ...overlap(s).map((b) => `  ${nativeLine(b, s.at)}`),
      ].join('\n')).join('\n') || 'لا وقفات مسجّلة';
      if (!native.length) return text;
      return `${text}\n\nالخيط الرئيسي للتطبيق (أطول من 32ms):\n${native.map((b) => `${Math.round((b.start - started) / 100) / 10}s ${b.ms}ms ${b.what}${b.stack?.length ? `\n  ${b.stack.join('\n  ')}` : ''}`).join('\n')}`;
    },
    stop() {
      stopped = true;
      caf?.(id);
      for (const o of observers) try { o.disconnect(); } catch {}
      scroll.removeEventListener('touchstart', down);
      scroll.removeEventListener('touchend', up);
      scroll.removeEventListener('touchcancel', up);
      scroll.removeEventListener('contentvisibilityautostatechange', visible, true);
    },
  };
}
