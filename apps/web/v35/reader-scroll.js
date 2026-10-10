/** Existing page index plus a fraction of its height: independent of viewport width. */
export function readingPosition(frames, viewportTop) {
  if (!frames.length) return 0;
  let index = frames.findIndex(frame => frame.getBoundingClientRect().bottom > viewportTop);
  if (index < 0) index = frames.length - 1;
  const rect = frames[index].getBoundingClientRect();
  return index + Math.max(0, Math.min(.999999, rect.height > 0 ? (viewportTop - rect.top) / rect.height : 0));
}

export function readingTop(frames, position, viewportTop, scrollTop) {
  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(position)));
  const rect = frames[index]?.getBoundingClientRect();
  if (!rect) return null;
  return rect.top - viewportTop + scrollTop + (position - Math.floor(position)) * rect.height;
}
