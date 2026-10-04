/** عقود بيانات فقط؛ لا تُحمّل إضافة كودًا داخل التطبيق. */
export const CONTENT_TYPES = Object.freeze([
  "manga",
  "anime",
  "movie",
  "series",
]);
export const CAPABILITIES = Object.freeze([
  "home",
  "search",
  "details",
  "chapters",
  "pages",
  "episodes",
  "streams",
  "subtitles",
  "catalog",
  "meta",
]);
export const LIMITS = Object.freeze({
  manifest: 256 * 1024,
  resource: 2 * 1024 * 1024,
  items: 1000,
});
export const PRODUCT_VERSION = "0.2.2";
export function boundedItems(value) {
  if (!Array.isArray(value) || value.length > LIMITS.items)
    throw new Error("نتيجة إضافة مخالفة للعقد");
  return value;
}
export const plainObject = (v) =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
