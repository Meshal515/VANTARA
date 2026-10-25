package com.vantara.addons.torrent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TorrentHotswapTest {
    private fun p(ip: String, piece: Int, kbps: Int) = TorrentHotswap.Peer(ip, piece, kbps * 1024)

    @Test fun `the slow peer holding the awaited piece is swapped when faster peers exist`() {
        val peers = listOf(p("1.1.1.1", 812, 3), p("2.2.2.2", 900, 800), p("3.3.3.3", 901, 650), p("4.4.4.4", 902, 700))
        assertEquals(listOf("1.1.1.1"), TorrentHotswap.victims(peers, 812, 2_000))
    }

    @Test fun `no swap before the wait threshold or when the holder is not slow`() {
        val peers = listOf(p("1.1.1.1", 812, 3), p("2.2.2.2", 900, 800))
        assertTrue(TorrentHotswap.victims(peers, 812, 1_000).isEmpty())
        val fast = listOf(p("1.1.1.1", 812, 600), p("2.2.2.2", 900, 800))
        assertTrue(TorrentHotswap.victims(fast, 812, 5_000).isEmpty())
    }

    @Test fun `no swap when nobody faster could take the block`() {
        val peers = listOf(p("1.1.1.1", 812, 10), p("2.2.2.2", 900, 12))
        assertTrue(TorrentHotswap.victims(peers, 812, 5_000).isEmpty())
        assertTrue(TorrentHotswap.victims(listOf(p("1.1.1.1", 812, 2)), 812, 5_000).isEmpty())
    }

    @Test fun `at most two victims, slowest first`() {
        val peers = listOf(p("a", 7, 5), p("b", 7, 1), p("c", 7, 3), p("d", 9, 900), p("e", 10, 900))
        assertEquals(listOf("b", "c"), TorrentHotswap.victims(peers, 7, 3_000))
    }
}
