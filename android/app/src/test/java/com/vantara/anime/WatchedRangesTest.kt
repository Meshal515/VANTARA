package com.vantara.anime

import com.vantara.usage.WatchedRanges
import org.junit.Assert.assertEquals
import org.junit.Test

class WatchedRangesTest {
    @Test fun `seeking to the credits is not a completed episode and replays count only once`() {
        val meter = WatchedRanges()
        meter.sample(0, true)
        meter.seek(10_000, 90_000, true)
        meter.sample(100_000, false)
        assertEquals(0.2, meter.ratio(100_000), 0.0001)
        meter.seek(100_000, 0, true)
        meter.sample(10_000, false)
        assertEquals(0.2, meter.ratio(100_000), 0.0001)
        val restored = WatchedRanges(meter.snapshot())
        restored.sample(10_000, true)
        restored.sample(90_000, false)
        assertEquals(1.0, restored.ratio(100_000), 0.0001)
    }
}
