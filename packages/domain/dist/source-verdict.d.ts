/**
 * حكم المصدر: لا يُوصف مصدر بأنه مدعوم بلا دليل.
 *
 * المعيار الخمسي مأخوذ من الـspike، حيث ثبت أن مصدرًا يمكن أن ينجح في البحث
 * ويفشل في الفصول (Mangalek: Cloudflare)، وأن مصدرًا يمكن أن يكون حيًّا تمامًا
 * وبحثه غير صالح (Team X و3asq).
 */
export type SourceVerdict = 'REGISTERED_NOT_TESTED' | 'SUPPORTED' | 'SEARCH_BROKEN' | 'NEEDS_FLARESOLVERR' | 'PARSER_FAILED' | 'TEMPORARILY_UNAVAILABLE' | 'POLICY_BLOCKED';
/** محاولة بحث واحدة باستعلام واحد. */
export interface SearchAttempt {
    query: string;
    ok: boolean;
    count?: number;
    relevant?: boolean;
    error?: string;
}
export interface ProbeEvidence {
    /** قائمة الأكثر شعبية ترجع عناصر ⇒ المصدر حيّ. */
    popular: {
        ok: boolean;
        count?: number;
        error?: string;
    };
    /** البحث يرجع نتائج **ذات صلة** بالاستعلام، لا مجرد نتائج. */
    search: {
        ok: boolean;
        count?: number;
        relevant?: boolean;
        error?: string;
    };
    /**
     * محاولات بحث متعددة.
     *
     * قِيس أن المصدر يستجيب لاستعلام ويرمي على آخر: Kawii Manga خدم
     * `nano machine` ورمى على `the`، ثلاث جولات متطابقة. فحكم البحث من استعلام
     * واحد غير صالح، وهذا الحقل يجعله من مجموعة.
     */
    searchAttempts?: SearchAttempt[];
    /** الاستعلام الذي وجد العمل، والعمل نفسه: بدونهما الأعداد بلا معنى. */
    probeQuery?: string;
    probedWork?: string;
    chapters: {
        ok: boolean;
        count?: number;
        error?: string;
    };
    /** فصل قديم وفصل حديث: الفصل الأول قد يعمل والأحدث لا. */
    pagesOldest: {
        ok: boolean;
        count?: number;
        error?: string;
    };
    pagesNewest: {
        ok: boolean;
        count?: number;
        error?: string;
    };
    /** الصور فُكّ ترميزها فعلًا، لا Content-Type فقط. */
    imagesDecoded: {
        ok: boolean;
        types?: string[];
        error?: string;
    };
}
/**
 * صلاحية البحث من كل المحاولات، لا من واحدة.
 *
 * `partial` هي الحالة التي كشفها القياس: Kawii Manga خدم `nano machine` ورمى
 * على `the`، ثلاث جولات متطابقة. حكمها من استعلام واحد يقلبها بين
 * `SUPPORTED` و`PARSER_FAILED` بحسب أي استعلام جرّبناه — وهذا عيب في الفحص
 * لا في المصدر.
 */
export declare function searchUsability(evidence: ProbeEvidence): 'usable' | 'partial' | 'unusable';
/**
 * الحكم من الدليل. الترتيب مقصود: Cloudflare يُشخّص قبل PARSER_FAILED لأنه
 * قابل للإصلاح بتشغيل FlareSolverr، بخلاف parser مكسور.
 */
export declare function verdictFrom(evidence: ProbeEvidence): SourceVerdict;
/** المصادر التي يجوز للقارئ الذكي أن يسحب منها فصلًا. */
export declare function usableForReading(verdict: SourceVerdict): boolean;
/** المصادر التي يجوز أن تُستخدم لاكتشاف عمل جديد عبر البحث. */
export declare function usableForSearch(verdict: SourceVerdict): boolean;
/**
 * هل يُعدّ البحث ذا صلة؟
 *
 * الـspike أظهر أن Team X يرجع 11 نتيجة لا علاقة لها بالاستعلام، فمجرد وجود
 * نتائج ليس نجاحًا. نطلب تطابقًا جزئيًا بين الاستعلام وأحد العناوين.
 */
export declare function looksRelevant(query: string, titles: readonly string[]): boolean;
//# sourceMappingURL=source-verdict.d.ts.map