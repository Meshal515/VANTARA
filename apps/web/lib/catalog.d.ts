/** The Worker collector uses the exact canonical title key shipped by the web app. */
export function normalizeTitle(raw: unknown): string;
/** Titles copied from HTML («Don&#039;t») are decoded before display and matching. */
export function decodeEntities<T>(raw: T): T;
/** First number in a chapter label («الفصل ٣٣٠» → 330), or -1. Shared with the app's chapter parser. */
export function parseChapterNumber(name: unknown): number;
