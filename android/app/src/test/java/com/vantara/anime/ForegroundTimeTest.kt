package com.vantara.anime

import com.vantara.usage.ForegroundTime
import org.junit.Assert.assertEquals
import org.junit.Test

class ForegroundTimeTest {
    @Test fun `six full episodes count all foreground time even without web events`() {
        var now = 0L
        val clock = ForegroundTime { now }
        clock.sample(true)
        now = 9_360_000L
        assertEquals(9_360_000L, clock.sample(false))
        now += 60_000L
        assertEquals(0L, clock.sample(false))
    }

    @Test fun `foreground pause counts but background and closed time do not`() {
        var now = 0L
        val clock = ForegroundTime { now }
        clock.sample(false)
        now = 20_000L // loading before first frame
        assertEquals(0L, clock.sample(true))
        now += 13_000L // playback at any speed
        assertEquals(13_000L, clock.sample(true))
        now += 5_000L // pause while still inside
        assertEquals(5_000L, clock.sample(false))
        now += 100_000L // outside
        assertEquals(0L, clock.sample(true))
        now += 2_300L
        assertEquals(2_300L, clock.sample(false))
        assertEquals(0L, clock.sample(false))
    }
}
