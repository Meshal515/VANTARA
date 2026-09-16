/**
 * قواعد الحضور واحتساب وقت القراءة.
 *
 * القاعدة الحاكمة: التبويب المفتوح ليس قراءة. الوقت يُحتسب فقط عندما تصل نبضة
 * تقول إن القارئ ظاهر وهناك تفاعل، وبفارق زمني معقول عن النبضة السابقة.
 */
/** الفاصل المتوقع بين النبضات. العميل يرسل كل 25 ثانية. */
export declare const HEARTBEAT_INTERVAL_MS = 25000;
/**
 * أقصى ما تُحتسبه نبضة واحدة. لو نامت الشاشة أو نام الجهاز ثم عادت نبضة بعد
 * ساعة، نحتسب هذا السقف لا الساعة كلها.
 */
export declare const MAX_BEAT_CREDIT_MS: number;
/** بعد هذا الصمت تُعتبر الجلسة خاملة، وبعد ضعفه تُغلق. */
export declare const IDLE_AFTER_MS = 90000;
export declare const OFFLINE_AFTER_MS = 300000;
export type PresenceStatus = 'READING' | 'ONLINE' | 'IDLE' | 'OFFLINE';
export interface Heartbeat {
    /** هل القارئ ظاهر على الشاشة فعلًا (document.visibilityState). */
    visible: boolean;
    /** تفاعلات منذ النبضة السابقة: تمرير، نقرة، تغيير صفحة. */
    interactions: number;
    progress?: number | undefined;
    pagesSeen?: number | undefined;
}
/**
 * الوقت الذي تستحقه هذه النبضة.
 *
 * صفر إذا: القارئ غير ظاهر، أو لا تفاعل، أو النبضة مكرّرة/رجعية.
 * مسقوف بـMAX_BEAT_CREDIT_MS حتى لا تُسجّل فجوة النوم كقراءة.
 */
export declare function creditForBeat(beat: Heartbeat, sinceLastBeatMs: number): number;
/** الحالة المعروضة، مشتقة من آخر نبضة. */
export declare function statusFor(lastBeatAgoMs: number, options?: {
    reading: boolean;
}): PresenceStatus;
export interface VisiblePresence {
    userId: string;
    username: string;
    status: PresenceStatus;
    seriesTitle?: string;
    chapterLabel?: string;
    progress?: number;
}
/**
 * ما يراه الآخرون.
 *
 * الإخفاء لا يخفي وجودك، يخفي ما تقرأه: تبقى ONLINE بلا عمل ولا فصل. وهذا يسدّ
 * التسريب الذي يخلقه خيار محتوى البالغين لو بُثّ العمل للجميع.
 */
export declare function redactForViewers(presence: VisiblePresence, opts: {
    incognito: boolean;
}): VisiblePresence;
//# sourceMappingURL=presence.d.ts.map