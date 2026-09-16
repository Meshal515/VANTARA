import type { UchiyomiClient } from '@vantara/uchiyomi';
export declare const SESSION_COOKIE = "vantara_session";
export interface Session {
    id: string;
    userId: string;
    username: string;
    /** توكن Uchiyomi بعد فكّ التشفير. لا يُسجَّل ولا يُعاد إلى العميل. */
    token: string;
}
export interface SessionStoreOptions {
    key: Buffer;
    ttlDays: number;
    uchiyomi: UchiyomiClient;
}
export declare class SessionStore {
    #private;
    constructor(options: SessionStoreOptions);
    /**
     * تسجيل دخول: Uchiyomi يتحقق من كلمة المرور، ثم نصك توكنًا طويل العمر باسم
     * المستخدم ونخزّنه مشفّرًا. VANTARA لا يرى كلمة المرور بعد هذه اللحظة ولا
     * يخزّنها، ولا يحتاج دورة refresh.
     */
    login(username: string, password: string, device?: string): Promise<Session>;
    /** يُرجع undefined للجلسة المنتهية أو المُبطلة أو غير الموجودة — بلا تمييز. */
    resolve(sessionId: string): Promise<Session | undefined>;
    /** لمسة خفيفة لآخر استخدام. لا تُنتظر في مسار الطلب. */
    touch(sessionId: string): Promise<void>;
    revoke(sessionId: string): Promise<void>;
    revokeAllFor(userId: string): Promise<number>;
    /** تنظيف دوري. الجلسة المنتهية تبقى صفًا ميتًا حتى تُحذف. */
    purgeExpired(): Promise<number>;
}
//# sourceMappingURL=sessions.d.ts.map