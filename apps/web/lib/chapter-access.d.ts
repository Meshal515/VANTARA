export function teamxChapterLink(href: unknown, base: string, locked?: boolean): boolean;
export function ikenChapterLocked(chapter: {
  isLocked?: boolean; isTimeLocked?: boolean; isPermanentlyLocked?: boolean;
  chapterPurchased?: boolean; price?: unknown;
} | null | undefined): boolean;
