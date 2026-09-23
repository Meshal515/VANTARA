package dev.vantara.spike

import eu.kanade.tachiyomi.network.HttpException

/**
 * خطأ HTTP أثناء التصفّح: هل هو «اهدأ وارجع» أم وقوف؟
 *
 * Mangalek وقف على الجهاز عند p970 والموقع يعرضها سليمة وينتهي عند p2029؛
 * وMangaDex عند p67. معاملة كل HttpException كوقوفٍ نهائي أظهرت نصف
 * الكتالوج كأنه كله.
 *
 * العابر: حدّ المعدّل، وأخطاء الخادم، ورفض الحافة (403 من Cloudflare يعود
 * بعد إعادة تحقّق). والباقي يصف الطلب نفسه فلا تحلّه الإعادة.
 */
object HttpStopPolicy {
    /** محاولات الصفحة نفسها قبل أن يُترك المصدر لجولة لاحقة. */
    const val PAGE_RETRIES = 3

    fun codeOf(t: Throwable): Int? =
        generateSequence(t) { it.cause }.filterIsInstance<HttpException>().firstOrNull()?.code

    fun isTemporary(t: Throwable): Boolean {
        val code = codeOf(t) ?: return false
        return code == 403 || code == 408 || code == 425 || code == 429 || code in 500..599
    }

    fun describe(t: Throwable): String =
        codeOf(t)?.let { "HTTP $it" } ?: "${t.javaClass.simpleName}: ${t.message?.take(160) ?: "—"}"

    /** 5 ث ثم 15 ثم 45: حدّ المعدّل يرتاح في دقيقة، ولا يحجز الدور أطول. */
    fun retryDelayMs(attempt: Int): Long = when (attempt) {
        0 -> 5_000L
        1 -> 15_000L
        else -> 45_000L
    }
}
