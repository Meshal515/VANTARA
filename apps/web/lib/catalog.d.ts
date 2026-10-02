/** The Worker collector uses the exact canonical title key shipped by the web app. */
export function normalizeTitle(raw: unknown): string;
/** Titles copied from HTML («Don&#039;t») are decoded before display and matching. */
export function decodeEntities<T>(raw: T): T;
