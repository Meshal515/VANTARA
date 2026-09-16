/**
 * حكم المصدر: لا يُوصف مصدر بأنه مدعوم بلا دليل.
 *
 * المعيار الخمسي مأخوذ من الـspike، حيث ثبت أن مصدرًا يمكن أن ينجح في البحث
 * ويفشل في الفصول (Mangalek: Cloudflare)، وأن مصدرًا يمكن أن يكون حيًّا تمامًا
 * وبحثه غير صالح (Team X و3asq).
 */
const CLOUDFLARE_MARKERS = [
    'cloudflare bypass currently disabled',
    'cloudflare',
    'flaresolverr',
    'challenge',
];
function mentionsCloudflare(evidence) {
    const errors = [
        evidence.popular.error,
        evidence.search.error,
        evidence.chapters.error,
        evidence.pagesOldest.error,
        evidence.pagesNewest.error,
    ]
        .filter((e) => typeof e === 'string')
        .map((e) => e.toLowerCase());
    return errors.some((error) => CLOUDFLARE_MARKERS.some((marker) => error.includes(marker)));
}
/**
 * صلاحية البحث من كل المحاولات، لا من واحدة.
 *
 * `partial` هي الحالة التي كشفها القياس: Kawii Manga خدم `nano machine` ورمى
 * على `the`، ثلاث جولات متطابقة. حكمها من استعلام واحد يقلبها بين
 * `SUPPORTED` و`PARSER_FAILED` بحسب أي استعلام جرّبناه — وهذا عيب في الفحص
 * لا في المصدر.
 */
export function searchUsability(evidence) {
    const attempts = evidence.searchAttempts;
    if (attempts === undefined || attempts.length === 0) {
        return evidence.search.ok && evidence.search.relevant === true ? 'usable' : 'unusable';
    }
    const relevant = attempts.filter((a) => a.ok && a.relevant === true).length;
    if (relevant === 0)
        return 'unusable';
    return relevant === attempts.length ? 'usable' : 'partial';
}
/**
 * الحكم من الدليل. الترتيب مقصود: Cloudflare يُشخّص قبل PARSER_FAILED لأنه
 * قابل للإصلاح بتشغيل FlareSolverr، بخلاف parser مكسور.
 */
export function verdictFrom(evidence) {
    if (mentionsCloudflare(evidence))
        return 'NEEDS_FLARESOLVERR';
    const alive = evidence.popular.ok || evidence.search.ok;
    if (!alive)
        return 'PARSER_FAILED';
    // حيّ، لكن البحث لا يُوصل إلى العمل ⇒ الاكتشاف يمر بـPOPULAR/LATEST + مطابقة عنوان
    if (searchUsability(evidence) === 'unusable')
        return 'SEARCH_BROKEN';
    if (!evidence.chapters.ok)
        return 'PARSER_FAILED';
    if (!evidence.pagesOldest.ok || !evidence.pagesNewest.ok)
        return 'PARSER_FAILED';
    if (!evidence.imagesDecoded.ok)
        return 'PARSER_FAILED';
    return 'SUPPORTED';
}
/** المصادر التي يجوز للقارئ الذكي أن يسحب منها فصلًا. */
export function usableForReading(verdict) {
    return verdict === 'SUPPORTED' || verdict === 'SEARCH_BROKEN';
}
/** المصادر التي يجوز أن تُستخدم لاكتشاف عمل جديد عبر البحث. */
export function usableForSearch(verdict) {
    return verdict === 'SUPPORTED';
}
/**
 * هل يُعدّ البحث ذا صلة؟
 *
 * الـspike أظهر أن Team X يرجع 11 نتيجة لا علاقة لها بالاستعلام، فمجرد وجود
 * نتائج ليس نجاحًا. نطلب تطابقًا جزئيًا بين الاستعلام وأحد العناوين.
 */
export function looksRelevant(query, titles) {
    const normalise = (s) => s
        .toLowerCase()
        .replace(/[ً-ْ]/g, '') // تشكيل عربي
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
    const needle = normalise(query);
    if (needle.length === 0)
        return false;
    const terms = needle.split(' ').filter((t) => t.length >= 3);
    if (terms.length === 0)
        return titles.some((t) => normalise(t).includes(needle));
    return titles.some((title) => {
        const hay = normalise(title);
        return terms.every((term) => hay.includes(term));
    });
}
//# sourceMappingURL=source-verdict.js.map