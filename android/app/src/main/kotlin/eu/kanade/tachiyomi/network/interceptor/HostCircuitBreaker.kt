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
        val path = HostBreaker.pathOf(request.url.encodedPath, request.url.encodedQuery)
        breaker.waitMs(host, System.currentTimeMillis(), path)?.let { throw HostCoolingException(host, it) }
        val response = chain.proceed(request)
        breaker.record(host, response.code, HostBreaker.retryAfterMs(response.header("Retry-After"), System.currentTimeMillis()), System.currentTimeMillis(), path)
        return response
    }
}

/**
 * نوع الخطأ يحدد نطاقه (AW26، مثل lib/host-breaker.js): 429 و502/503/504 و520-530 للمضيف كله؛ 500 وأخواته
 * صفحة عمل معطوبة تُعدّ على الصفحة نفسها، ولا يُعدّ المضيف ساقطًا إلا بفشل [HOST_SPREAD] صفحات مختلفة متتالية.
 */
class HostBreaker {
    private class State(var failures: Int = 0, var opens: Int = 0, var openUntil: Long = 0, var spread: MutableSet<String>? = null)
    private val hosts = ConcurrentHashMap<String, State>()

    private fun left(key: String, now: Long): Long? {
        val s = hosts[key] ?: return null
        synchronized(s) { return (s.openUntil - now).takeIf { it > 0 } }
    }

    /** المدة المتبقية قبل السماح بطلب لهذا المضيف (أو لهذه الصفحة منه)، أو null إن كان مسموحًا. */
    fun waitMs(host: String, now: Long, path: String = ""): Long? {
        val h = host.lowercase()
        return left(h, now) ?: if (path.isNotEmpty()) left(pageKey(h, path), now) else null
    }

    private fun open(s: State, asked: Long?, now: Long) {
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

    fun record(host: String, code: Int, retryAfterMs: Long?, now: Long, path: String = "") {
        val h = host.lowercase()
        if (code != 429 && code < 500) {
            hosts[h]?.let { s -> synchronized(s) { s.failures = 0; s.opens = 0; s.spread = null } }
            if (path.isNotEmpty()) hosts[pageKey(h, path)]?.let { p -> synchronized(p) { p.failures = 0; p.opens = 0 } }
            return
        }
        if (path.isNotEmpty() && !hostWide(code)) {
            val p = hosts.getOrPut(pageKey(h, path)) { State() }
            synchronized(p) { p.failures++; open(p, null, now) }
            val s = hosts.getOrPut(h) { State() }
            synchronized(s) {
                val spread = s.spread ?: mutableSetOf<String>().also { s.spread = it }
                spread += path
                if (spread.size >= HOST_SPREAD) { s.failures = THRESHOLD; open(s, null, now); s.spread = null }
            }
            trim()
            return
        }
        val s = hosts.getOrPut(h) { State() }
        synchronized(s) {
            s.failures++
            val asked = retryAfterMs?.takeIf { (code == 429 || code == 503) && it > 0 }
            open(s, asked, now)
        }
    }

    /** حد للذاكرة: مفاتيح الصفحات كثيرة، والأقدم يُنسى. */
    private fun trim() {
        if (hosts.size <= MAX_KEYS) return
        hosts.keys.firstOrNull { ' ' in it }?.let { hosts.remove(it) }
    }

    companion object {
        const val THRESHOLD = 3
        const val BASE_MS = 30_000L
        const val MAX_MS = 6 * 60 * 60 * 1000L
        const val HOST_SPREAD = 6
        private const val MAX_KEYS = 4000

        private fun pageKey(host: String, path: String) = "$host $path"

        /** حالات تعني أن الموقع نفسه مشغول أو ساقط. */
        fun hostWide(code: Int) = code == 429 || code == 502 || code == 503 || code == 504 || code in 520..530

        /** مفتاح الصفحة داخل المضيف. */
        fun pathOf(path: String, query: String?) = (if (query.isNullOrEmpty()) path else "$path?$query").take(512)

        /** `Retry-After` بالثواني أو بتاريخ HTTP، أو null. */
        fun retryAfterMs(value: String?, now: Long): Long? {
            val v = value?.trim()?.ifEmpty { null } ?: return null
            v.toLongOrNull()?.let { return if (it >= 0) it * 1000 else null }
            val at = runCatching { java.time.ZonedDateTime.parse(v, java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull()
            return at?.let { (it - now).takeIf { ms -> ms > 0 } }
        }
    }
}
