/**
 * Do not present a tiny replay prefix as a warm video start.
 *
 * A first decoded/screenshot frame is not proof that mpv has enough packet
 * data to advance. Large files with only a few hundred KiB of replay bytes
 * can appear ready then remain stuck at 0s while the swarm warms up.
 *
 * For short files, the entire file is the relevant threshold. For feature
 * films, request a bounded verified head (at most one 4 MiB extent read).
 * Reject sparse/invalid heads without changing or deleting the cache.
 */
export function replayStartupHeadBytes(fileLength) {
  if (!Number.isSafeInteger(fileLength) || fileLength <= 0) return 0;
  const MiB = 1024 * 1024;
  return Math.min(fileLength, Math.max(2 * MiB, Math.min(4 * MiB, Math.ceil(fileLength / 128))));
}
export async function reusableStartupReplay(entry) {
  const required = replayStartupHeadBytes(entry?.descriptor?.fileLength);
  if (!required || typeof entry?.read !== 'function') return { usable: false, requiredBytes: required, verifiedBytes: 0 };
  // entry.read verifies the persisted SHA-256 of each extent and enforces
  // the same 4MiB read bound as the ordinary replay streamer.
  try {
    const bytes = await entry.read(0, required);
    const available = bytes?.length ?? 0;
    return { usable: available === required, requiredBytes: required, verifiedBytes: available };
  } catch {
    return { usable: false, requiredBytes: required, verifiedBytes: 0 };
  }
}
