/**
 * إعادة كتابة قائمة HLS لتمرّ مقاطعها من الجالب.
 *
 * بعض مشغّلات الفيديو ترفض الطلب بلا `Referer` موقعها، والمتصفح لا يسمح
 * بضبطه. فإن احتاج سيرفرٌ ذلك، تُجلب قائمته `.m3u8` من الجالب، وكل رابط فيها
 * (مقاطع، مفاتيح، قوائم فرعية) يُعاد كتابته ليمرّ من الجالب بنفس الإذن
 * والمرجع. المقاطع نفسها تمرّ بايتاتٍ كما هي (Range مدعوم) ولا تُخزَّن.
 */

export function isPlaylist(contentType: string | null, url: string): boolean {
  const type = (contentType ?? '').toLowerCase();
  return type.includes('mpegurl') || /\.m3u8(\?|$)/i.test(url);
}

/** `wrap(absoluteUrl)` يرجع رابط الجالب لذلك العنوان. */
export function rewritePlaylist(text: string, base: string, wrap: (absolute: string) => string): string {
  const resolve = (ref: string) => {
    try {
      return new URL(ref, base).toString();
    } catch {
      return ref;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // URI="…" داخل الوسوم: المفاتيح وMAP والمسارات البديلة والإطارات
        return line.replace(/URI="([^"]+)"/g, (_, ref: string) => `URI="${wrap(resolve(ref))}"`);
      }
      return wrap(resolve(trimmed));
    })
    .join('\n');
}
