/**
 * صور الملف الشخصي: الصورة والبانر.
 *
 * تُخزَّن بعنوان محتواها (SHA-256): نفس الصورة مرتين صفٌّ واحد، والرابط لا
 * يتغيّر فيُخزَّن في الكاش للأبد. والنوع يُعرف من **بايتات الملف** لا مما
 * يقوله العميل: ملفٌّ يدّعي أنه صورة وهو HTML لا يُقبل، ولا SVG إطلاقًا
 * (نصٌّ قد يحمل شيفرة).
 */

/** سقف الصورة الواحدة بعد القصّ والضغط على الجهاز. GIF متحرّك يحتاج أكثر. */
export const MAX_MEDIA_BYTES = 1_500_000;
/** سقف ما يرفعه الحساب كله: إعادة الرفع لا تملأ القاعدة. */
export const MAX_MEDIA_BYTES_PER_USER = 25_000_000;

export type MediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

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
