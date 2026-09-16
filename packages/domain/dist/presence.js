/**
 * قواعد الحضور واحتساب وقت القراءة.
 *
 * القاعدة الحاكمة: التبويب المفتوح ليس قراءة. الوقت يُحتسب فقط عندما تصل نبضة
 * تقول إن القارئ ظاهر وهناك تفاعل، وبفارق زمني معقول عن النبضة السابقة.
 */
/** الفاصل المتوقع بين النبضات. العميل يرسل كل 25 ثانية. */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/**
 * أقصى ما تُحتسبه نبضة واحدة. لو نامت الشاشة أو نام الجهاز ثم عادت نبضة بعد
 * ساعة، نحتسب هذا السقف لا الساعة كلها.
 */
export const MAX_BEAT_CREDIT_MS = HEARTBEAT_INTERVAL_MS * 2;
/** بعد هذا الصمت تُعتبر الجلسة خاملة، وبعد ضعفه تُغلق. */
export const IDLE_AFTER_MS = 90_000;
export const OFFLINE_AFTER_MS = 300_000;
/**
 * الوقت الذي تستحقه هذه النبضة.
 *
 * صفر إذا: القارئ غير ظاهر، أو لا تفاعل، أو النبضة مكرّرة/رجعية.
 * مسقوف بـMAX_BEAT_CREDIT_MS حتى لا تُسجّل فجوة النوم كقراءة.
 */
export function creditForBeat(beat, sinceLastBeatMs) {
    if (!beat.visible)
        return 0;
    if (beat.interactions <= 0)
        return 0;
    if (sinceLastBeatMs <= 0)
        return 0;
    return Math.min(sinceLastBeatMs, MAX_BEAT_CREDIT_MS);
}
/** الحالة المعروضة، مشتقة من آخر نبضة. */
export function statusFor(lastBeatAgoMs, options = { reading: false }) {
    if (lastBeatAgoMs >= OFFLINE_AFTER_MS)
        return 'OFFLINE';
    if (lastBeatAgoMs >= IDLE_AFTER_MS)
        return 'IDLE';
    return options.reading ? 'READING' : 'ONLINE';
}
/**
 * ما يراه الآخرون.
 *
 * الإخفاء لا يخفي وجودك، يخفي ما تقرأه: تبقى ONLINE بلا عمل ولا فصل. وهذا يسدّ
 * التسريب الذي يخلقه خيار محتوى البالغين لو بُثّ العمل للجميع.
 */
export function redactForViewers(presence, opts) {
    if (!opts.incognito)
        return presence;
    return {
        userId: presence.userId,
        username: presence.username,
        status: presence.status === 'READING' ? 'ONLINE' : presence.status,
    };
}
//# sourceMappingURL=presence.js.map