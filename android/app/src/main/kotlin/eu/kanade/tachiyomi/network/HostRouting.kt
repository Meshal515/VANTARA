package eu.kanade.tachiyomi.network

import okhttp3.Dns
import okhttp3.Interceptor
import okhttp3.Response
import java.net.InetAddress

/**
 * نقطة ربط عامة في جذر الشبكة، مشتركة بين الـspike والتطبيق بالبايت.
 *
 * طبقة الشبكة لا تعرف محرك الأنمي ولا غيره: من يريد توجيه مضيفات بعينها
 * (إعادة كتابة دومين، قياس صحة) يسجّل [delegate]، ومن يريد منع تحدّي Cloudflare
 * المرئي لمضيفاته يسجّل [hiddenOnly]، ومن يريد حلّ أسماء بطريقة أخرى (DNS عبر
 * HTTPS حين يحجب مزوّد الإنترنت دومينًا) يسجّل [dns]. في الـspike تبقى فارغة
 * فلا يتغيّر شيء.
 */
object HostRouting : Interceptor, Dns {
    @Volatile
    var delegate: Interceptor? = null

    /** مضيفات لا يُعرض لها تحقق Cloudflare أبدًا (يفشل الطلب فيُنتقل لمصدر آخر). */
    @Volatile
    var hiddenOnly: (String) -> Boolean = { false }

    /** محلّل أسماء بديل؛ بدونه يُستخدم محلّل النظام كما هو. */
    @Volatile
    var dns: Dns? = null

    /**
     * DNS1: مضيفات مصادر المانجا المحمّلة (baseUrl) ونطاقاتها الفرعية (خوادم الصور s2.<site>). كانت المانجا على DNS
     * المزوّد أولًا ولا يُلجأ لـDoH إلا إن فشل أو أعاد 0.0.0.0، فمزوّد يعيد عنوانًا عامًا لصفحة حجب يُقبل جوابه ولا
     * يُكتشف الحجب. الآن سياسة الأنمي نفسها: DoH أولًا لهذه المضيفات، ثم النظام.
     */
    private val sourceHosts: MutableSet<String> = java.util.concurrent.ConcurrentHashMap.newKeySet()

    fun noteSourceHost(baseUrl: String?) {
        val host = baseUrl?.let { runCatching { java.net.URI(it.trim()).host }.getOrNull() }?.lowercase()?.removePrefix("www.") ?: return
        if (host.isNotEmpty() && '.' in host && sourceHosts.size < 2000) sourceHosts += host
    }

    fun isSourceHost(hostname: String): Boolean {
        val h = hostname.lowercase().removePrefix("www.")
        if (h in sourceHosts) return true
        var dot = h.indexOf('.')
        while (dot >= 0) {
            val parent = h.substring(dot + 1)
            if ('.' !in parent) return false
            if (parent in sourceHosts) return true
            dot = h.indexOf('.', dot + 1)
        }
        return false
    }

    override fun intercept(chain: Interceptor.Chain): Response =
        delegate?.intercept(chain) ?: chain.proceed(chain.request())

    override fun lookup(hostname: String): List<InetAddress> =
        (dns ?: Dns.SYSTEM).lookup(hostname)
}
