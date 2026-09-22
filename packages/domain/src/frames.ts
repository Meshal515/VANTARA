/**
 * «فريم» — لقطة من الفصل تُرسل لصديق.
 *
 * القارئ يلتقط صفحة أو أكثر من الفصل الذي يقرؤه ويرسلها، فيفتحها الصديق في
 * قارئ صغير على هذه الصفحات وحدها.
 *
 * ما يُخزَّن **مراجع** لا صور: المصدر والعمل والفصل ومواضع الصفحات. المستلم
 * يجلب الصور من المصدر بمحرّكه كما يجلب أي فصل — فلا يصير خادمنا مستودع
 * صفحات مانجا، ولا تكبر قاعدة البيانات بصورٍ لا نملكها.
 *
 * ورابط الصورة إن حُفظ تلميحٌ لا مرجع: كثير من المصادر يوقّع روابطه بمهلة
 * (MangaDar مثلًا)، فالمستلم يعيد طلب قائمة الصفحات ويأخذ الموضع نفسه.
 */

export const MAX_FRAME_PAGES = 10;

/** أعلى موضع صفحة معقول في فصل؛ ما فوقه عبث لا فصل. */
const MAX_PAGE_INDEX = 9_999;
const MAX_IMAGE_URL = 1_000;

export interface FramePage {
  index: number;
  /** رابط الصفحة كما أعطاه المصدر؛ يُعاد إليه وحده فلا يُفتح كرابط. */
  url: string;
  imageUrl: string | null;
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_URL) return null;
  // رابطٌ يفتحه جهاز صديقك: http(s) وحدها، لا javascript: ولا file:
  return /^https?:\/\//i.test(value) ? value : null;
}

/**
 * الصفحات كما تُخزَّن، أو `null` إن لم يبقَ فريم.
 *
 * الترتيب ترتيب الالتقاط لا ترتيب الفصل: من أرسل الصفحة ٧ ثم ٢ أراد أن تُقرأ
 * هكذا. والتكرار يسقط، والزائد عن [MAX_FRAME_PAGES] يُقصّ. وأي موضع غير صالح
 * يُسقط الفريم كله: عميلٌ يرسل مواضع مكسورة لا يُصدَّق في الباقي.
 */
export function normalizeFramePages(input: unknown): FramePage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const seen = new Set<number>();
  const pages: FramePage[] = [];
  for (const raw of input) {
    const index = (raw as { index?: unknown } | null)?.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > MAX_PAGE_INDEX) {
      return null;
    }
    if (seen.has(index)) continue;
    seen.add(index);
    const url = (raw as { url?: unknown }).url;
    pages.push({
      index,
      url: typeof url === 'string' ? url.slice(0, MAX_IMAGE_URL) : '',
      imageUrl: safeImageUrl((raw as { imageUrl?: unknown }).imageUrl),
    });
    if (pages.length === MAX_FRAME_PAGES) break;
  }
  return pages.length > 0 ? pages : null;
}

export function frameLinkFor(frameId: string): string {
  return `vantara://frame/${encodeURIComponent(frameId)}`;
}
