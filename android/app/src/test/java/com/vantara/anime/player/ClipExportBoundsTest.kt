package com.vantara.anime.player

import org.junit.Assert.*
import org.junit.Test

class ClipExportBoundsTest {
    @Test fun `HLS segments cannot widen a twenty second selection`() {
        val selected = ClipRange(8500, 28500, 15000)
        assertEquals(selected, ClipExportBounds.selection(selected, 6000))
        assertEquals(20000L, ClipExportBounds.selection(selected, 6000).durationMs)
    }
    @Test fun `local torrent tickets and HTTP sources export but arbitrary local URIs do not`() {
        assertTrue(ClipExportBounds.supportsSource("vantara-torrent://ticket/video.mp4"))
        assertTrue(ClipExportBounds.supportsSource("https://video.example/episode.m3u8"))
        assertTrue(ClipExportBounds.supportsSource("http://127.0.0.1:9000/fixture.m3u8"))
        assertFalse(ClipExportBounds.supportsSource("file:///data/private.mp4"))
        assertFalse(ClipExportBounds.supportsSource("blob:https://example/clip"))
        assertFalse(ClipExportBounds.supportsSource("httpsomething://video.example/episode.mp4"))
    }
    @Test fun `rejects empty oversized and imprecise output instead of sharing wrong clip`() {
        assertFalse(ClipExportBounds.accepts(20000, 26000, 1000))
        assertFalse(ClipExportBounds.accepts(20000, 20000, 0))
        assertFalse(ClipExportBounds.accepts(20000, 20000, ClipExportBounds.MAX_BYTES + 1))
        assertTrue(ClipExportBounds.accepts(20000, 19980, 1000000))
        assertFalse(ClipExportBounds.accepts(20000, 19500, 1000000))
    }
}
