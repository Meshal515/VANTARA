import { type AdminUser, type Chapter, type GroupedResult, type LoginResult, type Page, type ProgressUpdate, type SeriesSummary, type SourceInfo, type SourceProvider, type UchiyomiUser } from './types.ts';
export interface UchiyomiClientOptions {
    baseUrl: string;
    /** توكن خدمة `uy_…` بنطاق. يُستخدم لكل نداء لا يتصرف بهوية مستخدم. */
    serviceToken?: string;
    timeoutMs?: number;
    retries?: number;
    fetchImpl?: typeof fetch;
}
/**
 * العميل الوحيد الذي يتكلم مع Uchiyomi.
 *
 * VANTARA لا يتكلم مع Suwayomi مباشرة (D-01) ولا يكتب تقدمًا من عنده (D-02):
 * `setProgress` هنا تمريرة إلى Uchiyomi، وليست كتابة في جداولنا.
 */
export declare class UchiyomiClient {
    #private;
    constructor(options: UchiyomiClientOptions);
    healthy(): Promise<boolean>;
    needsSetup(): Promise<boolean>;
    /**
     * تحقق من بيانات الدخول عند Uchiyomi. VANTARA لا يخزّن كلمات مرور ولا يتحقق منها.
     */
    login(username: string, password: string): Promise<LoginResult>;
    me(token: string): Promise<UchiyomiUser>;
    /**
     * يصكّ توكن `uy_…` طويل العمر باسم صاحب `sessionToken`.
     *
     * هذا ما يعفي VANTARA من دورة refresh: توكن الجلسة عند Uchiyomi يعيش 900
     * ثانية، أما هذا فيعيش بعمر جلسة VANTARA. السرّ يُرجَع مرة واحدة فقط.
     */
    mintToken(sessionToken: string, options: {
        name: string;
        scopes: string[];
        expiresInDays: number;
    }): Promise<{
        id: string;
        token: string;
    }>;
    revokeToken(sessionToken: string, tokenId: string): Promise<void>;
    listUsers(): Promise<AdminUser[]>;
    listSources(token?: string): Promise<SourceInfo[]>;
    /**
     * بحث عبر كل المصادر، مُجمّعًا بالعنوان مع `providers[]`.
     * هذا هو ما يجعل طبقة الهوية عندنا إثراءً لا بناءً — انظر RESULTS.md §3.
     */
    searchAll(q: string, token?: string): Promise<GroupedResult[]>;
    /** بحث مسطّح: صف لكل مصدر، بلا تجميع. */
    find(q: string, token?: string): Promise<SourceProvider[]>;
    /** ملاحظة: المعامل اسمه `sourceId` لا `id` — `id` يرجع 400. */
    sourceDetail(source: string, sourceId: string): Promise<SeriesSummary & {
        count: number;
    }>;
    testSource(sourceId: string, token?: string): Promise<unknown>;
    extensionStatus(token?: string): Promise<{
        configured: boolean;
        reachable: boolean;
        version: string;
        enabled: number;
        registered: number;
        cap: number;
    }>;
    series(id: string, token?: string): Promise<SeriesSummary | undefined>;
    chapters(seriesId: string, token?: string): Promise<Chapter[]>;
    /** نسخ الفصل من مصادر مختلفة — ChapterVariant الجاهز. */
    versions(seriesId: string, token?: string): Promise<unknown>;
    pages(bookId: string, token?: string): Promise<Page[]>;
    /**
     * التقدم يُكتب هنا وهنا فقط (D-02). التوكن إلزامي: التقدم ملك مستخدم بعينه،
     * ولا يُكتب بتوكن خدمة.
     */
    setProgress(bookId: string, token: string, update: ProgressUpdate): Promise<void>;
    history(token: string): Promise<unknown>;
    stats(token: string): Promise<unknown>;
    rating(seriesId: string, token: string, value: number): Promise<unknown>;
    /** عنوان صورة الصفحة. تُقدَّم عبر vantara-api لا مباشرة للمتصفح. */
    pageImageUrl(bookId: string, index: number, maxWidth?: number): string;
}
//# sourceMappingURL=client.d.ts.map