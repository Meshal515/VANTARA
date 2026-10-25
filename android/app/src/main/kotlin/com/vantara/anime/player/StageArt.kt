package com.vantara.anime.player

import android.content.Context
import okhttp3.Cache
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.Executors

/**
 * بنر العمل وشعاره لشاشة التحميل، من كاش على القرص.
 *
 * كانا يُنزَّلان من الإنترنت في كل فتح للمشغّل (كاش ذاكرة يموت معه)، فتظهر الشاشة سوداء والعنوان
 * نصًا ثم يصل البنر ثم الشعار. الآن: تجهيز مسبق من صفحة العمل لحظة تجهيز السيرفرات ([warm])،
 * والمشغّل يقرأ من القرص فيظهران فورًا كما في Stremio.
 */
object StageArt {
    private const val CACHE_BYTES = 40L * 1024 * 1024
    private const val MAX_WARM = 4
    @Volatile private var shared: OkHttpClient? = null
    private val io = Executors.newFixedThreadPool(2) { r -> Thread(r, "VantaraStageArt").apply { isDaemon = true } }

    /** عميل [base] نفسه بكاش قرص مشترك؛ صورة بلا مدة صلاحية من الخادم تبقى أسبوعًا. */
    fun client(context: Context, base: OkHttpClient): OkHttpClient = shared ?: synchronized(this) {
        shared ?: base.newBuilder()
            .cache(Cache(File(context.applicationContext.cacheDir, "stage-art"), CACHE_BYTES))
            .addNetworkInterceptor { chain ->
                val response = chain.proceed(chain.request())
                val control = response.header("Cache-Control").orEmpty()
                if (response.isSuccessful && "max-age" !in control && "no-store" !in control)
                    response.newBuilder().header("Cache-Control", "public, max-age=604800").removeHeader("Pragma").build()
                else response
            }
            .build().also { shared = it }
    }

    /** ينزّل [urls] إلى الكاش في الخلفية بلا فك؛ روابط https فقط وبحد أقصى. */
    fun warm(context: Context, base: OkHttpClient, urls: List<String>) {
        val client = client(context, base)
        for (url in urls.asSequence().filter { it.startsWith("https://") && it.length <= 2048 }.distinct().take(MAX_WARM)) {
            runCatching {
                io.execute {
                    runCatching {
                        client.newCall(Request.Builder().url(url).build()).execute().use { r -> if (r.isSuccessful) r.body.bytes() }
                    }
                }
            }
        }
    }
}
