package com.vantara.anime.player

/** لا نخزّن رابط الحلقة التالية من أول الحلقة: روابط الاستضافة تنتهي سريعًا. */
internal object NextEpisodeWarmup {
    private const val WINDOW_MS = 4 * 60_000L

    fun shouldPrepare(durationMs: Long, positionMs: Long): Boolean =
        durationMs > 0 && positionMs >= 0 && positionMs < durationMs &&
            durationMs - positionMs <= WINDOW_MS
}
