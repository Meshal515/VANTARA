package com.vantara.anime.net

import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Locale

/**
 * حدود طلبات مصدر واحد، مشتركة بين كل من يطلبه: البحث والحلقات والسيرفرات
 * والكتالوج. مهلة داخل دالة واحدة لا تكفي، فالطالبون المتوازيون يتجاوزونها معًا.
 *
 * مثال WitAnime (فحص 2026-09-25): `X-RateLimit-Limit: 20` في الدقيقة على
 * `…/sources` و`stream-source` معًا، وسطل آخر بعشرين لـ`stream-gate`. حلقة بسبعة
 * سيرفرات كانت تستهلك 8 + 7 طلبات دفعة واحدة، فحلقتان في دقيقة ← 429.
 *
 * - [Rule]: نافذة منزلقة لكل مسار مطابق (دقيقة كاملة).
 * - 429: `Retry-After` يغلق المصدر كله حتى انقضائه؛ كل الطالبين ينتظرون معًا.
 * - انتظار أطول من المسموح يُرمى [RateLimitedException] بسببه بدل تعليق الواجهة.
 */
class RateGate(
    val rules: List<Rule>,
    private val clock: () -> Long = System::currentTimeMillis,
    private val sleep: (Long) -> Unit = Thread::sleep,
) {
    data class Rule(val path: Regex, val perMinute: Int) {
        override fun equals(other: Any?) = other is Rule && other.path.pattern == path.pattern && other.perMinute == perMinute
        override fun hashCode() = path.pattern.hashCode() * 31 + perMinute
    }

    private val windows = rules.map { ArrayDeque<Long>() }
    private var cooldownUntil = 0L

    /** كم ينتظر هذا الطلب الآن؛ صفر = احجز مكانه في النوافذ وانطلق. */
    private fun reserve(path: String): Long = synchronized(this) {
        val now = clock()
        var wait = (cooldownUntil - now).coerceAtLeast(0)
        val matching = rules.indices.filter { rules[it].path.containsMatchIn(path) }
        for (i in matching) {
            val q = windows[i]
            while (q.isNotEmpty() && now - q.first() >= WINDOW_MS) q.removeFirst()
            if (q.size >= rules[i].perMinute) wait = maxOf(wait, q.first() + WINDOW_MS - now)
        }
        if (wait == 0L) matching.forEach { windows[it].addLast(now) }
        wait
    }

    fun acquire(path: String, maxWaitMs: Long, canceled: () -> Boolean = { false }) {
        while (true) {
            val wait = reserve(path)
            if (wait == 0L) return
            if (wait > maxWaitMs) throw RateLimitedException(path, wait)
            if (canceled()) throw IOException("Canceled")
            sleep(minOf(wait, SLICE_MS))
        }
    }

    fun onRateLimited(retryAfterMs: Long) = synchronized(this) {
        cooldownUntil = maxOf(cooldownUntil, clock() + retryAfterMs)
    }

    fun cooldownLeft(): Long = synchronized(this) { (cooldownUntil - clock()).coerceAtLeast(0) }

    companion object {
        private const val WINDOW_MS = 60_000L
        private const val SLICE_MS = 250L
        const val DEFAULT_RETRY_AFTER_MS = 5_000L
        const val MAX_RETRY_AFTER_MS = 120_000L

        /** ثوانٍ (`Retry-After: 42`) أو تاريخ HTTP؛ غيابه = 5 ثوانٍ. */
        fun parseRetryAfter(value: String?, now: Long = System.currentTimeMillis()): Long {
            val v = value?.trim().orEmpty()
            val ms = v.toLongOrNull()?.times(1000)
                ?: runCatching {
                    SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).parse(v)!!.time - now
                }.getOrNull()
                ?: DEFAULT_RETRY_AFTER_MS
            return ms.coerceIn(1_000L, MAX_RETRY_AFTER_MS)
        }
    }
}

class RateLimitedException(val path: String, val waitMs: Long) :
    IOException("المصدر يحدّ الطلبات (429) على $path — متاح بعد ${(waitMs + 999) / 1000} ثانية")
