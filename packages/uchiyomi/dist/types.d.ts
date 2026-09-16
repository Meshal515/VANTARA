/** أنواع Uchiyomi REST المستخدمة فعليًا، مشتقة من openapi.yaml v0.34. */
export interface UchiyomiUser {
    id: string;
    username: string;
    displayName: string;
    role: 'admin' | 'user';
    totpEnabled: boolean;
}
export interface LoginResult {
    accessToken: string;
    expiresIn: number;
    user: UchiyomiUser;
    refreshExpiresAt: number;
}
export interface AdminUser {
    id: string;
    username: string;
    display_name: string;
    role: 'admin' | 'user';
    disabled: boolean;
    max_age_rating: number | null;
    last_active: string | null;
}
export interface SourceInfo {
    id: string;
    name: string;
    lang: string;
    extension: string | null;
    status: string;
    /** غير null ⇒ المصدر معاقب مؤقتًا ولا يُسأل */
    blockedUntil: string | null;
    note: string | null;
}
export interface SourceProvider {
    source: string;
    name: string;
    sourceId: string;
    title: string;
    coverUrl: string | null;
}
/**
 * نتيجة بحث مُجمّعة بالعنوان عبر عدة مصادر.
 * التجميع يجري في Uchiyomi، لا عندنا — انظر D-01.
 */
export interface GroupedResult {
    title: string;
    coverUrl: string | null;
    providers: SourceProvider[];
    inLibrary: boolean;
}
export interface SeriesSummary {
    id: string;
    title: string;
    summary?: string;
    coverUrl?: string | null;
    genres?: string[];
    status?: string;
}
export interface Chapter {
    id: string;
    name?: string;
    number?: number;
    scanlator?: string | null;
    read?: boolean;
}
export interface Page {
    index: number;
    url: string;
}
export interface ProgressUpdate {
    page?: number;
    completed?: boolean;
}
export declare class UchiyomiError extends Error {
    readonly status: number;
    readonly code: string | undefined;
    readonly path: string;
    constructor(message: string, status: number, code: string | undefined, path: string);
    /** الأخطاء العابرة: تستحق إعادة محاولة، بخلاف 4xx. */
    get retryable(): boolean;
}
//# sourceMappingURL=types.d.ts.map