/**
 * Page zoom geometry. The image sits at `base` (its on-screen rect at scale 1) and is drawn with
 * `translate(t) scale(s)` from its top-left corner. A content point u (in base pixels) lands on screen at
 * base + t + s·u, so keeping the point under the fingers fixed is plain algebra, not a guess.
 */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The point under the fingers stays under them; moving the fingers moves the page with them. */
export function zoomAround({ base, scale, t, from, to, ratio }) {
  const s = clamp(scale * ratio, ZOOM_MIN, ZOOM_MAX);
  const u = { x: (from.x - base.left - t.x) / scale, y: (from.y - base.top - t.y) / scale };
  return { scale: s, t: { x: to.x - base.left - s * u.x, y: to.y - base.top - s * u.y } };
}

/** One-finger pan stays inside the page: an edge never leaves the viewport while there is more image beyond it. */
export function clampPan({ base, scale, t, view }) {
  const w = base.width * scale, h = base.height * scale;
  const axis = (pos, size, start, extent) => {
    // screen position of the scaled image's leading edge: start + pos
    if (size <= extent) return (extent - size) / 2 - start + 0; // smaller than the view: centred
    return clamp(pos, extent - size - start, -start);
  };
  return { x: axis(t.x, w, base.left - view.left, view.width), y: axis(t.y, h, base.top - view.top, view.height) };
}

/**
 * While pinching, the page follows the fingers vertically but never leaves a gap at the sides: at
 * normal width it cannot slide left or right at all, zoomed in an edge stops at the screen edge.
 */
export function clampSides({ base, scale, t, view }) {
  return { x: clampPan({ base, scale, t, view }).x, y: t.y };
}

export const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 40;

/** A tap (short, still, one finger) right after another near it: on the zoomed page it returns to reading. */
export function isDoubleTap(previous, tap) {
  return Boolean(previous) && tap.at - previous.at <= DOUBLE_TAP_MS
    && Math.hypot(tap.x - previous.x, tap.y - previous.y) <= DOUBLE_TAP_SLOP;
}
