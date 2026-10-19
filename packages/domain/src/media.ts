/**
 * صور الملف الشخصي: الصورة والبانر.
 *
 * تُخزَّن بعنوان محتواها (SHA-256): نفس الصورة مرتين صفٌّ واحد، والرابط لا
 * يتغيّر فيُخزَّن في الكاش للأبد. والنوع يُعرف من **بايتات الملف** لا مما
 * يقوله العميل: ملفٌّ يدّعي أنه صورة وهو HTML لا يُقبل، ولا SVG إطلاقًا
 * (نصٌّ قد يحمل شيفرة).
 */

/**
 * سقف الصورة الواحدة بعد القصّ والضغط على الجهاز.
 *
 * محكومٌ بـD1 لا بالذوق: الصف لا يتجاوز 2,000,000 بايت، والصورة تُخزَّن
 * base64 (×4/3). 1.4MB تصير 1.87MB نصًّا وتترك هامشًا لبقية الأعمدة؛ و1.5MB
 * كانت تصير 2.0MB بالضبط فيرفضها D1 بخطأ لا يقول السبب.
 */
export const MAX_MEDIA_BYTES = 1_400_000;
/** سقف ما يرفعه الحساب كله: إعادة الرفع لا تملأ القاعدة. */
export const MAX_MEDIA_BYTES_PER_USER = 25_000_000;

export type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export type AudioType = 'audio/webm' | 'audio/ogg' | 'audio/mp4';

/**
 * رسالة المجلس الصوتية: النوع من بايتاتها أيضًا. WebM/Opus من MediaRecorder في
 * أندرويد، وOgg وMP4 لغيره. يُخدَم بنوعه ومعه nosniff، فلا يُنفَّذ شيء.
 */
export function sniffAudioType(bytes: Uint8Array): AudioType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x1a && at(1) === 0x45 && at(2) === 0xdf && at(3) === 0xa3) return 'audio/webm';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(4, 8) === 'ftyp') return 'audio/mp4';
  return null;
}

/** نوع الصورة من أول بايتاتها، أو `null` إن لم تكن صورة مقبولة. */
export function sniffImageType(bytes: Uint8Array): MediaType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function isMediaHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** Videos are split into bounded rows; image/audio limits stay unchanged. */
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
export const MAX_VIDEO_BYTES_PER_USER = 64 * 1024 * 1024;
export const MEDIA_CHUNK_BYTES = 512 * 1024;
export const MAX_MOMENT_DURATION_MS = 70_000;

/** Validate ISO BMFF box boundaries and read mvhd, including 64-bit duration. */
export function mp4DurationMs(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  let ftyp = false;
  let duration: number | null = null;
  let media = false;
  function boxes(start: number, end: number, movie = false): boolean {
    for (let offset = start; offset < end;) {
      if (end - offset < 8) return false;
      let size = view.getUint32(offset);
      let header = 8;
      if (size === 1) {
        if (end - offset < 16) return false;
        size = Number(view.getBigUint64(offset + 8)); header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || size > end - offset) return false;
      const type = ascii(offset + 4);
      const data = offset + header;
      if (!movie && type === 'ftyp') {
        if (offset !== 0 || size < header + 8 || (size - header) % 4 !== 0) return false;
        const brands = [ascii(data)];
        for (let at = data + 8; at + 4 <= offset + size; at += 4) brands.push(ascii(at));
        ftyp = brands.some(brand => /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash|MSNV|qt  )$/.test(brand));
      }
      if (!movie && type === 'moov' && !boxes(data, offset + size, true)) return false;
      if (!movie && type === 'mdat' && size > header) media = true;
      if (movie && type === 'mvhd') {
        const version = bytes[data];
        if (version !== 0 && version !== 1) return false;
        const timeOffset = data + (version === 1 ? 20 : 12);
        const needed = timeOffset + (version === 1 ? 12 : 8);
        if (needed > offset + size) return false;
        const timescale = view.getUint32(timeOffset);
        const ticks = version === 1 ? Number(view.getBigUint64(timeOffset + 4)) : view.getUint32(timeOffset + 4);
        if (!timescale || !Number.isSafeInteger(ticks)) return false;
        duration = ticks * 1000 / timescale;
      }
      offset += size;
    }
    return true;
  }
  if (!boxes(0, bytes.length) || !ftyp || !media || duration === null || duration <= 0 || duration > MAX_MOMENT_DURATION_MS) return null;
  return Math.round(duration);
}
