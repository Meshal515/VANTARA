package com.vantara.anime.player

import java.util.Locale

/**
 * حساب مقطع «الكاميرا» — منفصل عن الواجهة ليُختبر وحده.
 *
 * اللحظة [moment] هي موضع التشغيل حين ضُغطت الكاميرا. المقطع الافتراضي
 * ٥ ثوانٍ قبلها و٥ بعدها. كل طرف يمتد وحده حتى ٣٠ ثانية إضافية، فأقصى مقطع
 * ٧٠ ثانية (٣٥ قبل + ٣٥ بعد). اللحظة تبقى داخل المقطع دائمًا (لا يتجاوزها
 * أي مقبض)، والمقطع لا يخرج عن [0، مدة الحلقة].
 */
data class ClipRange(val startMs: Long, val endMs: Long, val momentMs: Long) {
    val durationMs: Long get() = endMs - startMs
}

object ClipMath {
    const val DEFAULT_SIDE_MS = 5_000L
    const val EXTRA_SIDE_MS = 30_000L
    const val MAX_SIDE_MS = DEFAULT_SIDE_MS + EXTRA_SIDE_MS
    const val MAX_TOTAL_MS = MAX_SIDE_MS * 2
    const val MIN_TOTAL_MS = 1_000L

    /** المقطع الأول: اللحظة ±٥ ثوانٍ، مقصوصًا على حدود الحلقة. */
    fun initial(momentMs: Long, durationMs: Long): ClipRange {
        val d = durationMs.coerceAtLeast(0)
        val p = if (d > 0) momentMs.coerceIn(0, d) else momentMs.coerceAtLeast(0)
        val start = (p - DEFAULT_SIDE_MS).coerceAtLeast(0)
        val end = if (d > 0) (p + DEFAULT_SIDE_MS).coerceAtMost(d) else p + DEFAULT_SIDE_MS
        return widen(ClipRange(start, end, p), d)
    }

    /** أبعد ما يصل إليه كل مقبض: [أدنى بداية، أقصى نهاية]. */
    fun bounds(momentMs: Long, durationMs: Long): Pair<Long, Long> {
        val lo = (momentMs - MAX_SIDE_MS).coerceAtLeast(0)
        val hi = if (durationMs > 0) (momentMs + MAX_SIDE_MS).coerceAtMost(durationMs) else momentMs + MAX_SIDE_MS
        return lo to hi
    }

    /** يحرّك مقبض البداية: بين أدنى حد واللحظة، ويترك للمقطع ثانية على الأقل. */
    fun moveStart(r: ClipRange, toMs: Long, durationMs: Long): ClipRange {
        val (lo, _) = bounds(r.momentMs, durationMs)
        val start = toMs.coerceIn(lo, r.momentMs).coerceAtMost(r.endMs - MIN_TOTAL_MS).coerceAtLeast(lo)
        return r.copy(startMs = start)
    }

    /** يحرّك مقبض النهاية: بين اللحظة وأقصى حد، ويترك للمقطع ثانية على الأقل. */
    fun moveEnd(r: ClipRange, toMs: Long, durationMs: Long): ClipRange {
        val (_, hi) = bounds(r.momentMs, durationMs)
        val end = toMs.coerceIn(r.momentMs, hi).coerceAtLeast(r.startMs + MIN_TOTAL_MS).coerceAtMost(hi)
        return r.copy(endMs = end)
    }

    /**
     * اللحظة في أول الحلقة أو آخرها: طرف واحد لا يكفي لثانية، فيأخذ من الآخر.
     * (حلقة أقصر من ثانية لا تُقصّ أصلًا — الواجهة تمنعها قبل ذلك.)
     */
    private fun widen(r: ClipRange, durationMs: Long): ClipRange {
        if (r.durationMs >= MIN_TOTAL_MS) return r
        val hi = if (durationMs > 0) durationMs else Long.MAX_VALUE
        val end = (r.startMs + MIN_TOTAL_MS).coerceAtMost(hi)
        val start = (end - MIN_TOTAL_MS).coerceAtLeast(0)
        return r.copy(startMs = start, endMs = end)
    }

    /**
     * القصّ المباشر (بلا إعادة ترميز) يبدأ من إطار مفتاحي. مقاطع HLS تبدأ كلٌّ
     * منها بإطار مفتاحي، فنبدأ من بداية المقطع الذي يحوي بداية الاختيار.
     * [segmentStartsMs] بدايات المقاطع مرتبة؛ null = لا نعرفها.
     */
    fun snapDown(segmentStartsMs: List<Long>, ms: Long): Long? =
        segmentStartsMs.lastOrNull { it <= ms }

    /** «12:05» أو «1:02:05». */
    fun clock(ms: Long): String {
        val s = (ms.coerceAtLeast(0) / 1000)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, sec) else String.format(Locale.US, "%d:%02d", m, sec)
    }

    /** «10 ث» / «1:05 د». */
    fun length(ms: Long): String {
        val s = ((ms + 500) / 1000).coerceAtLeast(0)
        return if (s < 60) "$s ث" else String.format(Locale.US, "%d:%02d د", s / 60, s % 60)
    }
}
