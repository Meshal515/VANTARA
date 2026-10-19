// نافذة التورنت المتحركة على القرص.
//
// rqbit يكتب كل قطعة ينزّلها في ملف sparse ولا يحذف القديم. هنا نحدّ ما يبقى على القرص:
//   - قدّام موضع المشاهدة: بقدر ما تسمح المساحة الحرة (قد تكون دقائق أو نصف ساعة).
//   - ورا: 50 ثانية فقط (على الأقل 32 ميغابايت)؛ ما قبلها يُفرَّغ من القرص (hole punch).
//   - المساحة قاربت الحد ⇒ نوقف التنزيل مؤقتًا، ويُستأنف كلما تقدّمت المشاهدة وتحرّرت مساحة.
//   - رجوع إلى منطقة فُرّغت ⇒ يُعاد بناء التورنت من تلك النقطة (لا تُقرأ أصفار أبدًا).
// القرارات هنا دوال صافية قابلة للاختبار؛ التنفيذ في services.mjs.
import { execFile, spawn } from 'node:child_process';

const MiB = 1024 * 1024;
export const WINDOW = Object.freeze({
  behindSeconds: 50,
  minBehindBytes: 32 * MiB,
  /** لا نفرّغ قطعًا صغيرة متكررة: الدفعة الأدنى. */
  minEvictBytes: 64 * MiB,
  /** أوقف التنزيل حين تهبط المساحة الحرة تحت هذا… */
  pauseBelowFree: 768 * MiB,
  /** …واستأنفه حين تتجاوز هذا (فارق يمنع التذبذب). */
  resumeAboveFree: 1280 * MiB,
  /** القرص ممتلئ فعلًا ولا يتحرّر شيء: نوقف بأمان بدل ملء النظام. */
  hardFloorFree: 96 * MiB,
  /** مخزون قدّام بالثواني: تحته نستأنف التنزيل حتى لو المساحة قليلة (فوق الحد الأدنى الصلب). */
  starvingAheadSeconds: 20,
});

/** معدل البايتات في الثانية من حجم الملف ومدته؛ تقدير آمن إن لم تُعرف المدة. */
export function bytesPerSecond(fileLength, durationSeconds) {
  if (Number.isFinite(durationSeconds) && durationSeconds > 30 && fileLength > 0) return fileLength / durationSeconds;
  return 1.5 * MiB;
}

/**
 * موضع المشاهدة بالبايت. القراءة الحالية من الوكيل ناقص ما خزّنه المشغّل أمامه في الذاكرة،
 * وإن غاب أحدهما فنسبة الوقت من الحجم مع هامش للأمان (معدل البت ليس ثابتًا).
 */
export function playbackByte({ readPos, forwardCacheBytes, positionSeconds, durationSeconds, fileLength }) {
  const byTime = Number.isFinite(positionSeconds) && Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.max(0, Math.min(fileLength, (positionSeconds / durationSeconds) * fileLength)) : null;
  if (Number.isFinite(readPos) && readPos >= 0 && Number.isFinite(forwardCacheBytes) && forwardCacheBytes >= 0) {
    const byRead = Math.max(0, readPos - forwardCacheBytes);
    // معدل بت متغيّر: لا نثق بتقدير أكبر من نسبة الوقت + 2% من الحجم
    return byTime == null ? byRead : Math.min(byRead, byTime + fileLength * 0.02);
  }
  if (byTime == null) return null;
  // هامش لمعدل البت المتغيّر: 3% من الحجم وبحد أقصى دقيقتين من الفيديو
  const margin = Math.min(fileLength * 0.03, 120 * bytesPerSecond(fileLength, durationSeconds));
  return Math.max(0, byTime - margin);
}

/** تقدير «أين يشاهد الآن» بلا هامش أمان: لحساب المخزون قدّام لا للتفريغ. */
export function playbackByteNearest({ readPos, forwardCacheBytes, positionSeconds, durationSeconds, fileLength }) {
  if (Number.isFinite(readPos) && Number.isFinite(forwardCacheBytes)) return Math.max(0, readPos - forwardCacheBytes);
  if (Number.isFinite(positionSeconds) && Number.isFinite(durationSeconds) && durationSeconds > 0) return Math.max(0, Math.min(fileLength, (positionSeconds / durationSeconds) * fileLength));
  return null;
}

/** يقرّب إلى حدّ القطعة (القطع تُعدّ من بداية التورنت، والملف قد لا يبدأ عند صفر). */
export function alignDownToPiece(fileRelative, fileOffset, pieceLength) {
  if (!(pieceLength > 0)) return fileRelative;
  const absolute = fileOffset + fileRelative;
  return Math.max(0, Math.floor(absolute / pieceLength) * pieceLength - fileOffset);
}

/**
 * القرار الواحد لكل نبضة.
 * @returns {{evictTo: number|null, action: 'pause'|'resume'|null, fail: string|null, aheadSeconds: number|null}}
 */
export function planWindow({
  fileLength, fileOffset = 0, pieceLength, durationSeconds, positionSeconds,
  readPos = null, forwardCacheBytes = null, contiguousEnd = null,
  evictedTo = 0, freeBytes, paused = false, buffering = false, limits = WINDOW,
}) {
  const bps = bytesPerSecond(fileLength, durationSeconds);
  const play = playbackByte({ readPos, forwardCacheBytes, positionSeconds, durationSeconds, fileLength });
  let evictTo = null;
  if (play != null) {
    const keepBehind = Math.max(limits.minBehindBytes, limits.behindSeconds * bps);
    const target = alignDownToPiece(play - keepBehind, fileOffset, pieceLength);
    if (target > 0 && target - evictedTo >= limits.minEvictBytes) evictTo = target;
  }
  const near = playbackByteNearest({ readPos, forwardCacheBytes, positionSeconds, durationSeconds, fileLength });
  const aheadSeconds = near != null && Number.isFinite(contiguousEnd) ? Math.max(0, contiguousEnd - near) / bps : null;
  let action = null;
  let fail = null;
  if (Number.isFinite(freeBytes)) {
    const starving = buffering || (aheadSeconds != null && aheadSeconds < limits.starvingAheadSeconds);
    if (freeBytes < limits.hardFloorFree && starving && evictTo == null)
      fail = 'القرص ممتلئ ولا مساحة لاستكمال الفيديو؛ حرر مساحة ثم أعد التشغيل';
    else if (!paused && freeBytes < limits.pauseBelowFree && !starving) action = 'pause';
    else if (paused && (freeBytes > limits.resumeAboveFree || (starving && freeBytes >= limits.hardFloorFree))) action = 'resume';
  }
  return { evictTo, action, fail, aheadSeconds };
}

/** هل طلب القراءة يقع في منطقة فُرّغت؟ عندها يجب إعادة بناء التورنت قبل الرد. */
export function readNeedsRebuild(rangeStart, evictedTo) {
  return Number.isFinite(rangeStart) && evictedTo > 0 && rangeStart < evictedTo;
}

/** "bytes=123-" ← 123 */
export function rangeStart(header) {
  const m = /^bytes=(\d+)-/.exec(String(header ?? ''));
  return m ? Number(m[1]) : 0;
}

// ───────────── تفريغ نطاق من الملف (hole punch) ─────────────

const WINDOWS_PUNCH = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles;
public static class VantaraSparse {
  [StructLayout(LayoutKind.Sequential)] struct ZeroData { public long Offset; public long BeyondFinalZero; }
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle h, uint code, ref ZeroData input, int inSize, IntPtr output, int outSize, out int returned, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(SafeFileHandle h, uint code, IntPtr input, int inSize, IntPtr output, int outSize, out int returned, IntPtr overlapped);
  const uint FSCTL_SET_SPARSE = 0x900C4, FSCTL_SET_ZERO_DATA = 0x980C8;
  public static string Punch(string path, long offset, long length) {
    using (var f = new FileStream(path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) {
      int r;
      DeviceIoControl(f.SafeFileHandle, FSCTL_SET_SPARSE, IntPtr.Zero, 0, IntPtr.Zero, 0, out r, IntPtr.Zero);
      var z = new ZeroData { Offset = offset, BeyondFinalZero = offset + length };
      if (!DeviceIoControl(f.SafeFileHandle, FSCTL_SET_ZERO_DATA, ref z, Marshal.SizeOf(z), IntPtr.Zero, 0, out r, IntPtr.Zero))
        return "err " + Marshal.GetLastWin32Error();
      return "ok";
    }
  }
}
"@
[Console]::Out.WriteLine('ready')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  try { $p = $line | ConvertFrom-Json; [Console]::Out.WriteLine([VantaraSparse]::Punch($p.path, [long]$p.offset, [long]$p.length)) }
  catch { [Console]::Out.WriteLine('err ' + $_.Exception.Message.Replace([char]10, ' ')) }
}
`;

/**
 * مُفرّغ نطاقات: على ويندوز عملية PowerShell واحدة دائمة (FSCTL_SET_ZERO_DATA على ملف sparse،
 * والملف مفتوح عند rqbit بمشاركة قراءة/كتابة)؛ على لينكس fallocate --punch-hole؛ غيرهما: لا شيء.
 * punch(path, offset, length) ← true إن تحرّر النطاق.
 */
export function createHolePuncher(platform = process.platform) {
  if (platform === 'linux') {
    return {
      punch: (path, offset, length) => new Promise((resolve) => {
        if (!(length > 0)) return resolve(true);
        execFile('fallocate', ['--punch-hole', '--keep-size', '--offset', String(offset), '--length', String(length), path],
          { timeout: 15000, windowsHide: true }, (error) => resolve(!error));
      }),
      close() {},
    };
  }
  if (platform !== 'win32') return { punch: async () => false, close() {} };
  let child = null;
  let ready = null;
  let buffer = '';
  const waiting = [];
  function start() {
    // السكربت عبر EncodedCommand؛ stdin للأوامر فقط (سطر JSON لكل تفريغ)
    const encoded = Buffer.from(WINDOWS_PUNCH, 'utf16le').toString('base64');
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    ready = new Promise((resolve) => {
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i).trim();
          buffer = buffer.slice(i + 1);
          if (line === 'ready') { resolve(true); continue; }
          waiting.shift()?.(line === 'ok');
        }
      });
      child.once('error', () => resolve(false));
      child.once('exit', () => { resolve(false); for (const w of waiting.splice(0)) w(false); child = null; });
    });
  }
  return {
    async punch(path, offset, length) {
      if (!(length > 0)) return true;
      if (!child) start();
      if (!(await ready) || !child) return false;
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 15000);
        waiting.push((ok) => { clearTimeout(timer); resolve(ok); });
        child.stdin.write(JSON.stringify({ path, offset, length }) + '\n');
      });
    },
    close() { try { child?.stdin.end(); child?.kill(); } catch { /* أُغلق */ } child = null; },
  };
}
