package eu.kanade.tachiyomi.network

import eu.kanade.tachiyomi.network.interceptor.UncaughtExceptionInterceptor
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * انحدار الفحص الحي: إضافة مبنية على coroutines أحدث نادت runBlockingK داخل اعتراضها، فرمى NoSuchMethodError
 * في نداء OkHttp غير متزامن وأسقط التطبيق كله. صار فشل IOException لهذا الطلب وحده.
 */
class UncaughtLinkageTest {
    @Test fun linkageErrorInExtensionInterceptorBecomesAnIoFailureNotACrash() {
        val client = OkHttpClient.Builder()
            .addInterceptor(UncaughtExceptionInterceptor())
            .addInterceptor { throw NoSuchMethodError("runBlockingK\$default") }
            .build()
        val failure = AtomicReference<IOException?>()
        val done = CountDownLatch(1)
        client.newCall(Request.Builder().url("https://extension.example/").build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { failure.set(e); done.countDown() }
            override fun onResponse(call: Call, response: Response) { response.close(); done.countDown() }
        })
        assertTrue(done.await(5, TimeUnit.SECONDS))
        assertTrue(generateSequence(failure.get() as Throwable?) { it.cause }.any { it is NoSuchMethodError })
    }
}
