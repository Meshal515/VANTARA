package com.vantara.anime.player

/** لا نخزّن رابط الحلقة التالية من أول الحلقة: روابط الاستضافة تنتهي سريعًا. */
internal object NextEpisodeWarmup {
    private const val WINDOW_MS = 4 * 60_000L
    /** في الغرفة: قبل النهاية بثلاث دقائق (قرار المالك، 19 نوفمبر: «دقيقتين إلى ثلاث»)، وكل عضو بسيرفره وجودته. */
    const val ROOM_WINDOW_MS = 3 * 60_000L

    fun shouldPrepare(durationMs: Long, positionMs: Long, windowMs: Long = WINDOW_MS): Boolean =
        durationMs > 0 && positionMs >= 0 && positionMs < durationMs &&
            durationMs - positionMs <= windowMs
}
