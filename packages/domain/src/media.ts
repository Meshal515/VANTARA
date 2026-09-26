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
