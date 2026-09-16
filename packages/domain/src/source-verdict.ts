/**
 * حكم المصدر: لا يُوصف مصدر بأنه مدعوم بلا دليل.
 *
 * المعيار الخمسي مأخوذ من الـspike، حيث ثبت أن مصدرًا يمكن أن ينجح في البحث
 * ويفشل في الفصول (Mangalek: Cloudflare)، وأن مصدرًا يمكن أن يكون حيًّا تمامًا
 * وبحثه غير صالح (Team X و3asq).
 */

export type SourceVerdict =
  | 'REGISTERED_NOT_TESTED'
  | 'SUPPORTED'
  | 'SEARCH_BROKEN'
  | 'NEEDS_FLARESOLVERR'
  | 'PARSER_FAILED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'POLICY_BLOCKED';

export interface ProbeEvidence {
  /** قائمة الأكثر شعبية ترجع عناصر ⇒ المصدر حيّ. */
  popular: { ok: boolean; count?: number; error?: string };
  /** البحث يرجع نتائج **ذات صلة** بالاستعلام، لا مجرد نتائج. */
  search: { ok: boolean; count?: number; relevant?: boolean; error?: string };
  chapters: { ok: boolean; count?: number; error?: string };
  /** فصل قديم وفصل حديث: الفصل الأول قد يعمل والأحدث لا. */
  pagesOldest: { ok: boolean; count?: number; error?: string };
  pagesNewest: { ok: boolean; count?: number; error?: string };
  /** الصور فُكّ ترميزها فعلًا، لا Content-Type فقط. */
  imagesDecoded: { ok: boolean; types?: string[]; error?: string };
}

const CLOUDFLARE_MARKERS = [
  'cloudflare bypass currently disabled',
  'cloudflare',
  'flaresolverr',
  'challenge',
];

function mentionsCloudflare(evidence: ProbeEvidence): boolean {
  const errors = [
    evidence.popular.error,
    evidence.search.error,
    evidence.chapters.error,
    evidence.pagesOldest.error,
    evidence.pagesNewest.error,
  ]
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.toLowerCase());

  return errors.some((error) => CLOUDFLARE_MARKERS.some((marker) => error.includes(marker)));
}

/**
 * الحكم من الدليل. الترتيب مقصود: Cloudflare يُشخّص قبل PARSER_FAILED لأنه
 * قابل للإصلاح بتشغيل FlareSolverr، بخلاف parser مكسور.
 */
export function verdictFrom(evidence: ProbeEvidence): SourceVerdict {
  if (mentionsCloudflare(evidence)) return 'NEEDS_FLARESOLVERR';

  const alive = evidence.popular.ok || evidence.search.ok;
  if (!alive) return 'PARSER_FAILED';

  // حيّ، لكن البحث لا يُوصل إلى العمل ⇒ الاكتشاف يمر بـPOPULAR/LATEST + مطابقة عنوان
  const searchUsable = evidence.search.ok && evidence.search.relevant === true;
  if (!searchUsable) return 'SEARCH_BROKEN';

  if (!evidence.chapters.ok) return 'PARSER_FAILED';
  if (!evidence.pagesOldest.ok || !evidence.pagesNewest.ok) return 'PARSER_FAILED';
  if (!evidence.imagesDecoded.ok) return 'PARSER_FAILED';

  return 'SUPPORTED';
}

/** المصادر التي يجوز للقارئ الذكي أن يسحب منها فصلًا. */
export function usableForReading(verdict: SourceVerdict): boolean {
  return verdict === 'SUPPORTED' || verdict === 'SEARCH_BROKEN';
}

/** المصادر التي يجوز أن تُستخدم لاكتشاف عمل جديد عبر البحث. */
export function usableForSearch(verdict: SourceVerdict): boolean {
  return verdict === 'SUPPORTED';
}

/**
 * هل يُعدّ البحث ذا صلة؟
 *
 * الـspike أظهر أن Team X يرجع 11 نتيجة لا علاقة لها بالاستعلام، فمجرد وجود
 * نتائج ليس نجاحًا. نطلب تطابقًا جزئيًا بين الاستعلام وأحد العناوين.
 */
export function looksRelevant(query: string, titles: readonly string[]): boolean {
  const normalise = (s: string) =>
    s
      .toLowerCase()
      .replace(/[ً-ْ]/g, '') // تشكيل عربي
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();

  const needle = normalise(query);
  if (needle.length === 0) return false;

  const terms = needle.split(' ').filter((t) => t.length >= 3);
  if (terms.length === 0) return titles.some((t) => normalise(t).includes(needle));

  return titles.some((title) => {
    const hay = normalise(title);
    return terms.every((term) => hay.includes(term));
  });
}
