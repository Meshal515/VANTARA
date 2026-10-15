package com.vantara.addons.torrent

import org.junit.Assert.*
import org.junit.Test

class TorrentWindowTest {
    private val mib = 1024L * 1024
    private val gib = 1024 * mib
    // فيلم 40GB مدته ساعتان ونصف (≈4.55MB/ث) بقطع 16MB
    private val film = TorrentFile(0, "film.mkv", 40 * gib, 0)
    private val piece = (16 * mib).toInt()
    private val duration = 9_000_000L

    @Test fun keepsOnlyFiftySecondsBehindPlusVariableBitrateMargin() {
        val keep = TorrentWindow.keepFrom(film, piece, 3_600_000, duration)!!
        val bps = TorrentWindow.bytesPerSecond(film.size, duration)
        val play = 3_600_000.0 / duration * film.size
        val keptBytes = play - keep.toLong() * piece
        assertTrue("يبقي 50 ث على الأقل", keptBytes >= 50 * bps)
        // الهامش: دقيقتان للأفلام الكبيرة (3% من 40GB أكبر بكثير)
        assertTrue("لا يبقي أكثر من 50 ث + دقيقتين + قطعة", keptBytes <= (50 + 120) * bps + piece)
    }

    @Test fun nothingEvictedAtTheStartOrWithoutDuration() {
        assertNull(TorrentWindow.keepFrom(film, piece, 10_000, duration))
        assertNull(TorrentWindow.keepFrom(film, piece, 3_600_000, 0))
    }

    @Test fun neverEvictsTheHeaderOrTheIndexAtTheEnd() {
        val last = ((film.size - 1) / piece).toInt()
        val range = TorrentWindow.evictRange(film, piece, keepFrom = last + 10, evictedUntil = 0)!!
        assertEquals(1, range.first)
        assertEquals(last - 2, range.last)
    }

    @Test fun evictsInBatchesAndContinuesWhereItStopped() {
        // أقل من 64MB: لا تفريغ صغير متكرر
        assertNull(TorrentWindow.evictRange(film, piece, keepFrom = 4, evictedUntil = 0))
        assertEquals(1 until 10, TorrentWindow.evictRange(film, piece, keepFrom = 10, evictedUntil = 0))
        assertNull(TorrentWindow.evictRange(film, piece, keepFrom = 12, evictedUntil = 10))
        assertEquals(10 until 20, TorrentWindow.evictRange(film, piece, keepFrom = 20, evictedUntil = 10))
    }

    @Test fun fileSpanIsClippedToTheFileInsideAPack() {
        val inPack = TorrentFile(1, "ep2.mkv", 100, 250)
        assertEquals(50L to 50L, TorrentWindow.fileSpan(inPack, 100, 3..3))
        assertEquals(0L to 50L, TorrentWindow.fileSpan(inPack, 100, 2..2))
    }

    @Test fun aheadGrowsWithFreeSpaceUpToTenMinutes() {
        val bps = TorrentWindow.bytesPerSecond(film.size, duration)
        val full = TorrentWindow.aheadPieces(film, piece, duration, 100 * gib)
        assertEquals(kotlin.math.ceil(600 * bps / piece).toInt(), full)
        assertEquals(TorrentWindow.MIN_AHEAD_PIECES, TorrentWindow.aheadPieces(film, piece, duration, 900 * mib))
        val some = TorrentWindow.aheadPieces(film, piece, duration, gib + 640 * mib)
        assertEquals(20, some)
        assertEquals(TorrentWindow.MIN_AHEAD_PIECES, TorrentWindow.aheadPieces(film, piece, 0, 100 * gib))
    }
}
