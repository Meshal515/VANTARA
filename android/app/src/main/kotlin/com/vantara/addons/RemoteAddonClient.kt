package com.vantara.addons

import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/** GET محدود، بلا auth/cookies/redirect؛ يُحقن عميل مشتق من الشبكة الأصلية. */
class RemoteAddonClient(base: OkHttpClient) {
    private val client = base.newBuilder().cookieJar(CookieJar.NO_COOKIES)
        .authenticator(Authenticator.NONE).proxyAuthenticator(Authenticator.NONE)
        .followRedirects(false).followSslRedirects(false).cache(null)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()
    private val calls = ConcurrentHashMap<String, Call>()
    // Capacitor cancellation may arrive before the IO coroutine registers its Call.
    private val cancelled = LinkedHashMap<String, Boolean>()

    fun request(url: String, requestId: String, limit: Int = 2 * 1024 * 1024, timeoutMs: Long = 15000): String {
        require(limit in 1..2 * 1024 * 1024)
        val target = publicUrl(url)
        val call = client.newCall(Request.Builder().url(target).get().header("Accept", "application/json, text/plain").build())
        call.timeout().timeout(timeoutMs.coerceIn(1000, 45000), TimeUnit.MILLISECONDS)
        synchronized(cancelled) {
            require(calls.putIfAbsent(requestId, call) == null) { "طلب إضافة مكرر" }
            if (cancelled.remove(requestId) == true) call.cancel()
        }
        try {
            if (call.isCanceled()) throw java.io.IOException("ألغي طلب الإضافة")
            call.execute().use { response ->
                check(response.isSuccessful) { "الإضافة أعادت HTTP ${response.code}" }
                val body = checkNotNull(response.body) { "الإضافة لم تُرجع بيانات" }
                check(body.contentLength() <= limit) { "حجم نتيجة الإضافة أكبر من الحد" }
                val buffer = okio.Buffer()
                val source = body.source()
                while (source.read(buffer, minOf(8192L, limit + 1L - buffer.size)) != -1L) {
                    check(buffer.size <= limit) { "حجم نتيجة الإضافة أكبر من الحد" }
                }
                return buffer.readUtf8()
            }
        } finally {
            synchronized(cancelled) {
                calls.remove(requestId, call)
                cancelled.remove(requestId)
            }
        }
    }
    fun cancel(requestId: String) {
        synchronized(cancelled) {
            val call = calls[requestId]
            if (call != null) call.cancel() else {
                cancelled[requestId] = true
                while (cancelled.size > 1000) cancelled.remove(cancelled.keys.first())
            }
        }
    }
    fun cancelPrefix(prefix: String) { calls.filterKeys { it.startsWith(prefix) }.values.forEach { it.cancel() } }

    companion object {
        fun publicUrl(input: String): HttpUrl {
            val u = input.toHttpUrl()
            require(u.scheme == "https" && u.port == 443 && u.username.isEmpty() && u.password.isEmpty()) { "رابط إضافة غير مسموح" }
            require(Regex("([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z][a-z0-9-]*").matches(u.host) && !Regex("(?:^|\\.)(localhost|local|internal|lan|home)$").containsMatchIn(u.host)) { "مضيف إضافة غير مسموح" }
            return u
        }
        fun publicAddresses(addresses: List<InetAddress>): List<InetAddress> {
            if (addresses.isEmpty() || addresses.any { ip ->
                    val b = ip.address
                    ip.isAnyLocalAddress || ip.isLoopbackAddress || ip.isLinkLocalAddress || ip.isSiteLocalAddress || ip.isMulticastAddress ||
                        b.size == 16 && (b[0].toInt() and 0xfe) == 0xfc ||
                        b.size == 4 && ((b[0].toInt() and 255) == 0 || (b[0].toInt() and 255) == 100 && (b[1].toInt() and 255) in 64..127)
                }) throw UnknownHostException("عنوان إضافة غير عام")
            return addresses
        }
    }
}
