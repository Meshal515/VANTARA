package com.vantara.anime.player

/** Ordinary THE ROCK startup stays unchanged; native torrent metadata/pieces have a finite budget. */
object PlaybackBudgets {
    fun startupMs(url: String?): Long = if (url?.startsWith("vantara-torrent:") == true) 90_000L else 15_000L
    fun firstOutputMs(url: String?): Long = if (url?.startsWith("vantara-torrent:") == true) 30_000L else 8_000L
    fun stalledMs(url: String?): Long = if (url?.startsWith("vantara-torrent:") == true) 35_000L else 20_000L
}

/** A seek may need to download pieces removed from the bounded torrent cache. */
internal class PlaybackSeekBudget {
    private var deadlineMs: Long? = null

    fun seek(url: String?, nowMs: Long) {
        deadlineMs = if (url?.startsWith("vantara-torrent:") == true) nowMs + 120_000L else null
    }

    fun reset() { deadlineMs = null }

    fun stalledMs(url: String?, nowMs: Long): Long =
        deadlineMs?.let { (it - nowMs).coerceAtLeast(0) } ?: PlaybackBudgets.stalledMs(url)
}

/**
 * موضع بدء التورنت: أقل من [RESUME_FLOOR_MS] بدءٌ من أول الحلقة، كما تعامله الواجهة (لا «تكمل من» تحت 5 ث في
 * anime.js وcinema.js، وهي ترسل الموضع المحفوظ مهما صغر). محاولة سابقة توقفت عند ثانية واحدة كانت تجعل المشغّل
 * يطلب فهرس MKV من آخر الملف: Reacher «انتظار عند 0:01» ثم 168KB من الذيل في 12.6 ث قبل أول صورة.
 * الغرفة والمقطع ([shared]) يبقيان على موضعهما بالضبط.
 */
object PlaybackStart {
    const val RESUME_FLOOR_MS = 5_000L
    fun torrent(positionMs: Long, shared: Boolean): Long = when {
        positionMs <= 0 -> 0
        !shared && positionMs < RESUME_FLOOR_MS -> 0
        else -> positionMs
    }
}
