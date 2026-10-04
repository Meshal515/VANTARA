const TTL = {
  manifest: 86400000,
  home: 900000,
  catalog: 900000,
  search: 300000,
  details: 86400000,
  meta: 86400000,
  chapters: 300000,
  episodes: 300000,
  subtitles: 900000,
  subtitleFile: 86400000,
};
export function createAddonCache({ store, clock = Date.now }) {
  const key = (addon, cap, input) =>
    `addon|${JSON.stringify([addon, cap, input])}`;
  async function get(addon, cap, input) {
    const item = await store.get("source", key(addon, cap, input));
    if (!item || item.stale || item.value.expiresAt <= clock()) return null;
    return item.value.data;
  }
  async function set(addon, cap, input, data, { expiresAt } = {}) {
    const expiry =
      cap === "streams" ? expiresAt : clock() + (TTL[cap] ?? 300000);
    if (!Number.isFinite(expiry) || expiry <= clock()) return;
    await store.set(
      "source",
      key(addon, cap, input),
      { data, expiresAt: expiry },
      { ttlMs: expiry - clock() },
    );
  }
  return { get, set };
}
