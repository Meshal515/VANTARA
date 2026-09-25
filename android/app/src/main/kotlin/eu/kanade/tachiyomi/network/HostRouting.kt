package eu.kanade.tachiyomi.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * نقطة ربط عامة في جذر الشبكة، مشتركة بين الـspike والتطبيق بالبايت.
 *
 * طبقة الشبكة لا تعرف محرك الأنمي ولا غيره: من يريد توجيه مضيفات بعينها
 * (إعادة كتابة دومين، قياس صحة) يسجّل [delegate]، ومن يريد منع تحدّي Cloudflare
 * المرئي لمضيفاته يسجّل [hiddenOnly]. في الـspike يبقيان فارغين فلا يتغيّر شيء.
 */
object HostRouting : Interceptor {
    @Volatile
    var delegate: Interceptor? = null

    /** مضيفات لا يُعرض لها تحقق Cloudflare أبدًا (يفشل الطلب فيُنتقل لمصدر آخر). */
    @Volatile
    var hiddenOnly: (String) -> Boolean = { false }

    override fun intercept(chain: Interceptor.Chain): Response =
        delegate?.intercept(chain) ?: chain.proceed(chain.request())
}
