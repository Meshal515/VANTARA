package com.vantara.anime

import com.vantara.anime.player.NextEpisodeWarmup
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NextEpisodeWarmupTest {
    @Test fun `do not warm signed video links at the start of a full episode`() {
        assertFalse(NextEpisodeWarmup.shouldPrepare(24 * 60_000L, 0))
        assertFalse(NextEpisodeWarmup.shouldPrepare(-1, 0))
        assertTrue(NextEpisodeWarmup.shouldPrepare(24 * 60_000L, 21 * 60_000L))
        assertFalse(NextEpisodeWarmup.shouldPrepare(24 * 60_000L, 24 * 60_000L))
    }

    @Test fun `in a room the next episode is warmed three minutes before the end (owner decision)`() {
        val w = NextEpisodeWarmup.ROOM_WINDOW_MS
        assertFalse(NextEpisodeWarmup.shouldPrepare(24 * 60_000L, 20 * 60_000L, w))
        assertTrue(NextEpisodeWarmup.shouldPrepare(24 * 60_000L, 21 * 60_000L, w))
    }
}
