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
  const index = Math.min(frames.length - 1, Math.max(0, Math.floor(position)));
  const rect = frames[index]?.getBoundingClientRect();
  if (!rect) return null;
  return rect.top - viewportTop + scrollTop + (position - Math.floor(position)) * rect.height;
}
