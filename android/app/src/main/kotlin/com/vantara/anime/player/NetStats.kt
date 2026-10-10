package com.vantara.anime.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.util.IdentityHashMap

/**
 * قياس الشبكة كما يعيشه المشغّل، لا اختبار سرعة صناعي:
 *  - زمن الاستجابة (ms): من فتح الطلب حتى بدء وصول البيانات، لكل طلب فيديو حقيقي
 *    (DNS + اتصال + TLS + انتظار السيرفر). الوسيط لآخر 8 طلبات.
 *  - السرعة الآن: البايتات التي وصلت فعلًا في آخر 3 ثوانٍ.
 * فيعرف المستخدم: هل البطء من شبكته (سرعة منخفضة) أم من السيرفر (استجابة طويلة).
 */
@UnstableApi
class NetStats(private val now: () -> Long = { android.os.SystemClock.elapsedRealtime() }) : TransferListener {
    private val opening = IdentityHashMap<DataSource, Long>()
    private val latencies = ArrayDeque<Long>()
    private val window = ArrayDeque<LongArray>() // [وقت، بايتات]
    @Volatile var host: String? = null; private set
    @Volatile var requests = 0; private set

    @Synchronized override fun onTransferInitializing(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
        if (isNetwork) opening[source] = now()
    }
    @Synchronized override fun onTransferStart(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
        if (!isNetwork) return
        val t0 = opening.remove(source) ?: return
        latencies.addLast(now() - t0)
        while (latencies.size > 8) latencies.removeFirst()
        requests++
        dataSpec.uri.host?.let { host = it }
    }
    @Synchronized override fun onBytesTransferred(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean, bytesTransferred: Int) {
        if (!isNetwork || bytesTransferred <= 0) return
        val t = now()
        window.addLast(longArrayOf(t, bytesTransferred.toLong()))
        trim(t)
    }
    @Synchronized override fun onTransferEnd(source: DataSource, dataSpec: DataSpec, isNetwork: Boolean) {
        opening.remove(source)
    }

    private fun trim(t: Long) { while (window.isNotEmpty() && t - window.first()[0] > WINDOW_MS) window.removeFirst() }

    /** وسيط زمن الاستجابة، أو null قبل أول طلب. */
    @Synchronized fun latencyMs(): Long? = latencies.sorted().let { if (it.isEmpty()) null else it[it.size / 2] }

    /** بايت/ثانية في آخر 3 ثوانٍ. */
    @Synchronized fun bytesPerSecond(): Long {
        trim(now())
        return window.sumOf { it[1] } * 1000 / WINDOW_MS
    }

    companion object {
        const val WINDOW_MS = 3000L

        fun mbps(bytesPerSecond: Long) = bytesPerSecond * 8 / 1_000_000.0

        /**
         * الخلاصة للمستخدم بكلمات بسيطة. [needBps] معدل الفيديو المطلوب (بت/ث) إن عُرف.
         * [bufferedMs] المخزّن أمامك: 30 ث فأكثر = لا مشكلة الآن مهما كانت الأرقام.
         */
        fun verdict(latencyMs: Long?, bytesPerSecond: Long, needBps: Long?, bufferedMs: Long, torrentPeers: Int? = null): String = when {
            torrentPeers == 0 -> "لا مشاركين متصلين بعد: التورنت ينتظر السرب، جرّب نسخة بمشاركين أكثر"
            bufferedMs >= 30_000 -> "ممتاز: أمامك ${bufferedMs / 1000} ثانية جاهزة"
            needBps != null && needBps > 0 && bytesPerSecond * 8 < needBps * 0.9 && bytesPerSecond > 0 ->
                "سرعتك الآن أقل من دقة الفيديو: اختر دقة أقل أو سيرفرًا آخر"
            latencyMs != null && latencyMs > 1500 -> "السيرفر بطيء الاستجابة (${latencyMs} ms): جرّب سيرفرًا آخر"
            latencyMs != null && latencyMs > 600 -> "الاستجابة متوسطة (${latencyMs} ms)"
            else -> "الشبكة جيدة"
        }
    }
}
