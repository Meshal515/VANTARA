/** Adult content (hentai, ecchi, BL/GL, 18+) never reaches VANTARA: see adult-filter.js. */
export function adultGenre(genre: unknown): boolean;
export function adultTitle(title: unknown): boolean;
export function adultManga(manga: unknown): boolean;
export function isBlockedKey(key: unknown): boolean;
export function blockKey(key: unknown): void;
export function setHiddenUser(userOf: (() => string | null | undefined) | string | null): void;
export function isHiddenKey(key: unknown): boolean;
export function hideWork(work: { id?: string; keys?: string[]; title?: string; cover?: string | null }): void;
export function restoreWork(id: string): void;
export function hiddenWorks(): Array<{ id: string; keys: string[]; title: string; cover: string | null; at: number }>;
