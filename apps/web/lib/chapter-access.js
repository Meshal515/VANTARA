/** Public reader availability; metadata and purchase dialogs are not chapter pages. */
export function teamxChapterLink(href, base, locked = false) {
  if (locked || !href || String(href).trim().startsWith('#')) return false;
  try {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin && /^https?:$/.test(url.protocol)
      && /^\/series\/[^/]+\/[^/]+\/?$/.test(url.pathname) && !url.hash;
  } catch { return false; }
}

export const ikenChapterLocked = (chapter) => chapter?.isLocked === true
  || chapter?.isTimeLocked === true || chapter?.isPermanentlyLocked === true
  || (chapter?.chapterPurchased === false && Number(chapter?.price ?? 0) !== 0);
