/** Existing page index plus a fraction of its height: independent of viewport width. */
export function readingPosition(frames, viewportTop) {
  if (!frames.length) return 0;
  // Tall chapters can contain hundreds of images. A linear scan calls
  // getBoundingClientRect() for each preceding frame on every sync tick,
  // forcing expensive layout reads while the follower is scrolling.
  // Ordered reader frames have monotonically increasing bottom edges.
  let low = 0, high = frames.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].getBoundingClientRect().bottom > viewportTop) high = middle;
    else low = middle + 1;
  }
  const index = Math.min(low, frames.length - 1);
  const rect = frames[index].getBoundingClientRect();
  return index + Math.max(0, Math.min(.999999, rect.height > 0 ? (viewportTop - rect.top) / rect.height : 0));
}

export function readingTop(frames, position, viewportTop, scrollTop) {
  if (!Number.isFinite(position) || !frames.length) return null;
  position = Math.max(0, Math.min(frames.length, position));
  const index = Math.min(frames.length - 1, Math.floor(position));
  const rect = frames[index]?.getBoundingClientRect();
  if (!rect) return null;
  return rect.top - viewportTop + scrollTop + Math.max(0, Math.min(1, position - index)) * rect.height;
}


/** One animation per follower. Geometry is read once per new anchor/resize,
 * never after each scroll write. Time-based easing behaves consistently at
 * different refresh rates and stops when within half a pixel of the target. */
export function createReadingFollower({ getPosition, setPosition, readTarget, active = () => true,
  now = () => performance.now(), requestFrame = fn => requestAnimationFrame(fn), cancelFrame = id => cancelAnimationFrame(id) }) {
  let frame = 0, dirty = false, immediate = false, destroyed = false;
  let target = null, lastAt = null;
  const stats = { updates: 0, frames: 0, geometryReads: 0, firstFrameDelayMs: null, maxFrameGapMs: 0, settledMs: null };
  let startedAt = null, receivedAt = null;
  function schedule() { if (!destroyed && !frame && active()) frame = requestFrame(move); }
  function move(at) {
    frame = 0;
    if (destroyed || !active()) { lastAt = null; return; }
    if (dirty) { target = readTarget(); stats.geometryReads++; dirty = false; startedAt = at; stats.firstFrameDelayMs = Math.max(0, at - receivedAt); }
    if (!Number.isFinite(target)) { lastAt = null; return; }
    const elapsed = lastAt == null ? 16 : Math.max(0, at - lastAt);
    if (lastAt != null) stats.maxFrameGapMs = Math.max(stats.maxFrameGapMs, elapsed);
    lastAt = at;
    const current = getPosition(), delta = target - current;
    const next = immediate || Math.abs(delta) < .5 ? target : current + delta * (1 - Math.exp(-Math.min(elapsed, 64) / 38));
    immediate = false; stats.frames++;
    setPosition(next);
    if (Math.abs(target - getPosition()) >= .5 && Math.abs(getPosition() - current) > .01) schedule();
    else { stats.settledMs = at - startedAt; lastAt = null; }
  }
  return {
    update(jump = false) { if (destroyed) return; dirty = true; receivedAt = now(); stats.updates++; immediate ||= jump; schedule(); },
    suspend() { cancelFrame(frame); frame = 0; lastAt = null; },
    destroy() { this.suspend(); destroyed = true; target = null; },
    stats() { return { ...stats }; },
  };
}
