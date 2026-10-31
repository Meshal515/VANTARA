package eu.kanade.tachiyomi.network.interceptor

import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/**
 * طلبات الإضافات بـhttp إلى مواقع خارجية تُرقّى إلى https قبل خروجها، كما تفعل المتصفحات الحديثة.
 * سياسة التطبيق تمنع الاتصال غير المشفّر (network_security_config)، فكانت صفحات وصور مصادر تكتب
 * روابطها بـhttp (AsgardScans) تفشل بـ«CLEARTEXT communication not permitted» مع أن الموقع نفسه يحوّل
 * إلى https. لا يفتح الترقية بابًا لاتصال غير مشفّر؛ المضيفات المحلية المسموحة في السياسة تبقى كما هي.
 */
class HttpsUpgradeInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val url = request.url
        if (url.scheme != "http" || isLocal(url)) return chain.proceed(request)
        val secure = url.newBuilder().scheme("https").port(if (url.port == 80) 443 else url.port).build()
        return chain.proceed(request.newBuilder().url(secure).build())
    }

    companion object {
        /** مطابقة لاستثناءات network_security_config: لا ترقية لها. */
        fun isLocal(url: HttpUrl): Boolean {
            val host = url.host
            return host == "localhost" || host.endsWith(".localhost") || host == "127.0.0.1" || host == "10.0.2.2" ||
                host == "vantara.local" || host.endsWith(".vantara.local")
        }
    }
}
