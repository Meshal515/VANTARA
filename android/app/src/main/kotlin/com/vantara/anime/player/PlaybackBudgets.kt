package com.vantara.anime.player

/** Ordinary THE ROCK startup stays unchanged; native torrent metadata/pieces have a finite budget. */
object PlaybackBudgets {
    fun startupMs(url: String?): Long = if (url?.startsWith("vantara-torrent:") == true) 90_000L else 15_000L
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
