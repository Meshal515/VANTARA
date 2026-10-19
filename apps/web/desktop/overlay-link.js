/**
 * وصلة player.js ↔ طبقة أدوات المشغل (overlay.js في نافذة شفافة فوق الفيديو).
 * ترسل الحالة مجمّعة (التقدّم كل 250ms على الأكثر، والتغييرات الأخرى فورًا)، وتسلّم الأوامر.
 */
export function createOverlayLink({ bridge, session, snapshot, onCommand, timers = globalThis, interval = 250 }) {
  if (typeof bridge?.playerOverlay !== 'function' || typeof bridge?.onOverlayCommand !== 'function') return null;
  let active = false, closed = false, timer = 0, last = 0;
  const off = bridge.onOverlayCommand((message) => { if (!closed && active && message?.session === session) onCommand(message); });
  const flush = () => {
    timer = 0;
    if (!active || closed) return;
    last = Date.now();
    void bridge.playerOverlay({ ...snapshot(), session }).catch(() => {});
  };
  return {
    async open() {
      try { active = (await bridge.playerOverlay({ open: true, session })) === true; } catch { active = false; }
      if (active && closed) { void bridge.playerOverlay({ close: true, session }).catch(() => {}); active = false; }
      if (active && !closed) flush();
      return active && !closed;
    },
    get active() { return active && !closed; },
    /** urgent: تغيير يراه المستخدم فورًا (إيقاف، ورقة، حالة)؛ غيره يُجمَّع. */
    push(urgent = false) {
      if (!active || closed) return;
      if (urgent) { timers.clearTimeout(timer); flush(); return; }
      if (timer) return;
      timer = timers.setTimeout(flush, Math.max(0, interval - (Date.now() - last)));
    },
    close() {
      if (closed) return;
      closed = true; timers.clearTimeout(timer); off?.();
      if (active) void bridge.playerOverlay({ close: true, session }).catch(() => {});
    },
  };
}
