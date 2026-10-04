import { publicUrl } from "./manifest.js";
export const addonMedia = (c) =>
  c?.sourceId?.startsWith("addon|") || Boolean(c?.addonKey);
/** إضافات المستخدم لا تدخل allowlist المصادر ولا تطلب auth فانتارا. */
export async function candidatePaths(
  c,
  runtime,
  { requireGrant = false } = {},
) {
  if (addonMedia(c)) return [["direct", publicUrl(c.url).href]];
  if (requireGrant) await runtime.ensureMedia();
  else await runtime.ensureMedia().catch(() => null);
  return [
    ["direct", c.url],
    ["edge", runtime.fetcher.mediaUrl(c.url, c.referer)],
  ];
}
