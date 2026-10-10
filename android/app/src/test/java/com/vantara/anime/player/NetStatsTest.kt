package com.vantara.anime.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NetStatsTest {
    @Test fun verdictNamesTheRealCause() {
        assertTrue(NetStats.verdict(120, 2_000_000, 8_000_000, 40_000).startsWith("ممتاز"))
        assertTrue(NetStats.verdict(120, 500_000, 8_000_000, 2_000).contains("أقل من دقة الفيديو"))
        assertTrue(NetStats.verdict(2400, 3_000_000, 8_000_000, 2_000).contains("2400 ms"))
        assertTrue(NetStats.verdict(null, 0, null, 0, torrentPeers = 0).contains("لا مشاركين"))
        assertEquals("الشبكة جيدة", NetStats.verdict(90, 3_000_000, 8_000_000, 8_000))
        assertEquals(8.0, NetStats.mbps(1_000_000), 0.001)
    }
}
