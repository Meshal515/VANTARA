package eu.kanade.tachiyomi.network.interceptor

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/** الموقع طلب التوقف مؤقتًا: نحترمه بدل أن نكرر الطلب فنُحظر. */
class HostCoolingException(val host: String, val waitMs: Long) :
    IOException("الموقع $host طلب التوقف مؤقتًا؛ نعاود بعد ${(waitMs + 999) / 1000} ثانية (الخلل من الموقع لا من VANTARA)")

/**
 * قاطع دائرة لكل مضيف، مشترك بين كل الإضافات ولغاتها (docs/addons/PERSISTENT_PLUGINS.md §3.4، قرار 13).
 *
 * حد المعدّل في إضافات Keiyoushi لكل عميل لا لكل مضيف: إضافة بعشر لغات تضاعف الطلبات عشر مرات، ومواقع
 * على CDN واحد لا تتشارك الحد، ولا أحد يحترم `Retry-After`. هنا:
 *  - 429 أو 503 مع `Retry-After`: يتوقف المضيف المدة التي طلبها الموقع (حتى 6 ساعات).
 *  - ثلاثة ردود 429/5xx متتالية: يتوقف 30 ثانية ثم يتضاعف حتى 6 ساعات.
 *  - أي رد سليم يعيد العدّاد للصفر. أخطاء الشبكة لا تُحسب (انقطاع الجهاز ليس خلل موقع).
 * المنطق في [HostBreaker] بلا OkHttp ليُختبر بساعة وهمية.
 */
class HostCircuitBreaker(private val breaker: HostBreaker = HostBreaker()) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host
        breaker.waitMs(host, System.currentTimeMillis())?.let { throw HostCoolingException(host, it) }
        val response = chain.proceed(request)
        breaker.record(host, response.code, HostBreaker.retryAfterMs(response.header("Retry-After"), System.currentTimeMillis()), System.currentTimeMillis())
        return response
    }
}

class HostBreaker {
    private class State(var failures: Int = 0, var opens: Int = 0, var openUntil: Long = 0)
    private val hosts = ConcurrentHashMap<String, State>()

    /** المدة المتبقية قبل السماح بطلب لهذا المضيف، أو null إن كان مسموحًا. */
    fun waitMs(host: String, now: Long): Long? {
        val s = hosts[host.lowercase()] ?: return null
        synchronized(s) { return (s.openUntil - now).takeIf { it > 0 } }
    }

    fun record(host: String, code: Int, retryAfterMs: Long?, now: Long) {
        val s = hosts.getOrPut(host.lowercase()) { State() }
        synchronized(s) {
            if (code != 429 && code < 500) { s.failures = 0; s.opens = 0; return }
            s.failures++
            val asked = retryAfterMs?.takeIf { (code == 429 || code == 503) && it > 0 }
            when {
                asked != null -> s.openUntil = now + minOf(asked, MAX_MS)
                s.failures >= THRESHOLD -> {
                    s.openUntil = now + minOf(BASE_MS shl minOf(s.opens, 20), MAX_MS)
                    s.opens++
                    // بعد انتهاء المهلة فشل واحد يكفي ليعود التوقف (نصف مفتوح)
                    s.failures = THRESHOLD - 1
                }
            }
        }
    }

    companion object {
        const val THRESHOLD = 3
        const val BASE_MS = 30_000L
        const val MAX_MS = 6 * 60 * 60 * 1000L

        /** `Retry-After` بالثواني أو بتاريخ HTTP، أو null. */
        fun retryAfterMs(value: String?, now: Long): Long? {
            val v = value?.trim()?.ifEmpty { null } ?: return null
            v.toLongOrNull()?.let { return if (it >= 0) it * 1000 else null }
            val at = runCatching { java.time.ZonedDateTime.parse(v, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull()
            return at?.let { (it - now).takeIf { ms -> ms > 0 } }
        }
    }
}
