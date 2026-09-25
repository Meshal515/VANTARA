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

    override fun intercept(chain: Interceptor.Chain): Response =
        delegate?.intercept(chain) ?: chain.proceed(chain.request())

    override fun lookup(hostname: String): List<InetAddress> =
        (dns ?: Dns.SYSTEM).lookup(hostname)
}
