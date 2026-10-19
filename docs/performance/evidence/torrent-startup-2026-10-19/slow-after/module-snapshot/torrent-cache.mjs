import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join, parse } from 'node:path';

export const MiB = 1024n * 1024n;
export const TORRENT_FREE_RESERVE = 512n * MiB;
const CACHE_FOLDER = '.vantara-torrent-cache';

function windowsFixedRoots() {
  // Enumerate ready *fixed* NTFS/ReFS volumes. Do not select removable drives or mapped shares.
  return new Promise(resolve => {
    const script = '[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq [System.IO.DriveType]::Fixed -and $_.IsReady -and ($_.DriveFormat -eq "NTFS" -or $_.DriveFormat -eq "ReFS") } | ForEach-Object { $_.RootDirectory.FullName }';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 8000, windowsHide: true, maxBuffer: 16384,
    }, (error, stdout) => {
      if (error) return resolve([]);
      resolve([...new Set(stdout.split(/\r?\n/).map(v => v.trim()).filter(v => /^[A-Za-z]:\\$/.test(v)))]);
    });
  });
}
export function cacheNamespace(userData) {
  // Different portable and installed copies must not delete each other's caches.
  const identity = createHash('sha256').update(userData).digest('hex').slice(0, 20);
  return CACHE_FOLDER + '-' + identity;
}
export async function cacheFreeBytes(root, statfs = fs.statfs) {
  const s = await statfs(root, { bigint: true });
  const available = BigInt(s.bavail) * BigInt(s.bsize);
  return available >= 0n ? available : 0n;
}
async function probeWritable(root) {
  const dir = join(root, '.vantara-write-probe');
  const target = join(dir, randomBytes(8).toString('hex'));
  try {
    await fs.mkdir(dir, { recursive: true });
    const handle = await fs.open(target, 'wx', 0o600);
    await handle.close();
    return true;
  } catch { return false; }
  finally {
    await fs.rm(target, { force: true }).catch(() => {});
    // Only remove our empty probe folder; never touch other contents.
    await fs.rmdir(dir).catch(() => {});
  }
}
/** Choose the largest *usable* fixed local volume. The profile disk is always a fallback. */
export async function selectTorrentCacheRoot({
  userData, platform = process.platform, roots, statfs = fs.statfs,
  writable = probeWritable, minimumFree = TORRENT_FREE_RESERVE,
} = {}) {
  if (typeof userData !== 'string' || !userData) throw new Error('مسار بيانات VANTARA غير صالح');
  const fixed = platform === 'win32' ? (roots ?? await windowsFixedRoots()) : [];
  const candidates = [...new Set([...fixed, userData])].filter(Boolean);
  const usable = [];
  for (const root of candidates) {
    // A non-fixed profile fallback is permitted only when enumerating volumes failed;
    // it must still pass the actual write probe and space check.
    try {
      const available = await cacheFreeBytes(root, statfs);
      if (available < minimumFree || !(await writable(root))) continue;
      usable.push({root, available});
    } catch { /* inaccessible/unmounted volume */ }
  }
  usable.sort((a,b) => a.available === b.available ? 0 : a.available > b.available ? -1 : 1);
  if (!usable.length) throw new Error('لا توجد مساحة آمنة لكاش التورنت على الأقراص المتاحة؛ يلزم 512 ميغابايت خالية على قرص قابل للكتابة');
  return usable[0];
}
/** Only our namespaced, disposable downloads are ever removed. */
export async function prepareTorrentCache(root, userData) {
  const directory = join(root, cacheNamespace(userData));
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  return directory;
}
export function validateStreamingHeadroom(file, freeBytes) {
  if (!Number.isSafeInteger(file?.length) || file.length <= 0) throw new Error('حجم ملف التورنت غير معروف أو غير صالح؛ اختر مصدرًا آخر');
  if (typeof freeBytes !== 'bigint' || freeBytes < TORRENT_FREE_RESERVE)
    throw new Error('المساحة المتاحة لكاش التورنت منخفضة جدًا؛ حاول قرصًا آخر');
  // File length is *logical*, not the physical storage a stream must reserve.
  // Do not assume this proves bounded caching: rqbit does not evict old pieces.
  return file.length;
}
