package com.vantara.anime.player

object ClipExportBounds {
    fun supportsSource(url: String): Boolean = runCatching {
        java.net.URI(url).scheme in setOf("http", "https", "vantara-torrent")
    }.getOrDefault(false)
    const val MAX_BYTES = 16L * 1024 * 1024
    fun selection(range: ClipRange, @Suppress("UNUSED_PARAMETER") segmentStartMs: Long?): ClipRange {
        require(range.startMs >= 0 && range.durationMs in 1..ClipMath.MAX_TOTAL_MS)
        return range
    }
    fun accepts(selectedMs: Long, actualMs: Long, bytes: Long): Boolean =
        bytes in 1..MAX_BYTES && actualMs > 0 && kotlin.math.abs(actualMs - selectedMs) <= 150
}
