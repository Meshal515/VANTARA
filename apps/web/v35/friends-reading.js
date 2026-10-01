/** Shared reading candidates, keyed by VANTARA's canonical work reference. */
export function rankFriendsReading(rows, { me, friendIds, now = Date.now() }) {
  const friends = new Set(friendIds);
  const byRef = new Map();
  for (const v of rows) {
    if (v.user_id === me || !friends.has(v.user_id) || v.removed || !v.chapter_label || !v.series_ref?.startsWith('ext:') || !Number.isFinite(v.viewed_at) || v.viewed_at <= 0 || v.viewed_at > now + 60_000 || v.viewed_at < now - 14 * 86_400_000) continue;
    const item = byRef.get(v.series_ref) ?? { ref: v.series_ref, users: new Map(), at: 0, title: v.series_title, cover: v.cover_url };
    item.users.set(v.user_id, Math.max(item.users.get(v.user_id) ?? 0, v.viewed_at));
    item.at = Math.max(item.at, v.viewed_at);
    byRef.set(item.ref, item);
  }
  // Each distinct friend contributes once; the weight halves every two days.
  // A stale crowd naturally yields to what friends are reading this week.
  return [...byRef.values()].map(({ users, ...w }) => ({
    ...w, readers: users.size,
    score: [...users.values()].reduce((sum, at) => sum + 2 ** (-Math.max(0, now - at) / (2 * 86_400_000)), 0),
  })).sort((a, b) => b.score - a.score || b.at - a.at || a.ref.localeCompare(b.ref));
}
