/** Cinema progress stays separate, owned by the account that launched playback. */
const prefix = 'vantara.cinema.v1.';
export const ownerKey = (owner) => `${prefix}${owner || 'guest'}`;
export const episodeKey = (type, season = 1, episode = 1) => type === 'movie' ? 'movie' : `s${season}e${episode}`;
export function readCinema(owner, storage = globalThis.localStorage) {
  try { const data = JSON.parse(storage.getItem(ownerKey(owner)) || '{}'); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; }
}
export function writeCinema(owner, data, storage = globalThis.localStorage) {
  try { storage.setItem(ownerKey(owner), JSON.stringify(data)); return true; } catch { return false; }
}
export function toggleSaved(owner, work, storage) {
  const data = readCinema(owner, storage);
  const entry = data[work.id] ?? { work, progress: {} };
  entry.saved = !entry.saved;
  entry.work = work;
  data[work.id] = entry;
  writeCinema(owner, data, storage);
  return entry.saved;
}
export function recordCinema(owner, work, progress, storage) {
  if (!Number.isFinite(progress.position) || !(progress.duration > 0) || !(progress.episode > 0) || !(progress.season > 0)) return false;
  const data = readCinema(owner, storage);
  const entry = data[work.id] ?? { work, progress: {} };
  const key = episodeKey(work.type, progress.season, progress.episode);
  entry.work = work;
  entry.progress ??= {};
  entry.progress[key] = { ...progress, position: Math.max(0, progress.position), at: Date.now() };
  entry.latest = key;
  entry.at = Date.now();
  data[work.id] = entry;
  return writeCinema(owner, data, storage);
}
export const readProgress = (owner, work, season, episode) => readCinema(owner)[work.id]?.progress?.[episodeKey(work.type, season, episode)] ?? null;
