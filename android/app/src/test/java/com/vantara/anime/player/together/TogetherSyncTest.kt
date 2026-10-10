package com.vantara.anime.player.together

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/** نفس محاكاة sync.test.js: يجب أن يتطابق السلوك في الويب والـAPK. */
class TogetherSyncTest {
    private data class Sim(val seeks: Int, val caughtAt: Double?, val flips: Int, val finalError: Double, val rates: List<Double>)

    private fun simulate(initialError: Double, seconds: Int = 40, noise: Double = 0.0, ahead: Double = 30_000.0, behind: Double = 0.0, canRate: Boolean = true, actualLoad: Long = 900): Sim {
        val ctl = DriftController()
        var rnd = 7L
        fun random(): Double { rnd = (rnd * 1103515245 + 12345) % (1L shl 31); return rnd.toDouble() / (1L shl 31) * 2 - 1 }
        val tl = Timeline("k", null, true, true, 0.0, 0.0, 1.0, 1)
        var pos = initialError
        var rate = 1.0
        var stalledUntil = -1.0
        var seeks = 0
        var caught: Double? = null
        var flips = 0
        var lastSign = 0.0
        val rates = ArrayList<Double>()
        var trueError = 0.0
        var at = 0.0
        while (at <= seconds * 1000.0) {
            if (at > 0) pos += if (at <= stalledUntil) 0.0 else 500 * rate
            val buffering = at <= stalledUntil
            val d = ctl.step(tl, pos + random() * noise, at, buffering, canRate, ahead, behind)
            rate = d.rate
            val sign = Math.signum(rate - 1)
            if (sign != 0.0 && lastSign != 0.0 && sign != lastSign) flips++
            if (sign != 0.0) lastSign = sign
            d.seekTo?.let {
                seeks++
                pos = it.toDouble()
                if (d.reason != "seek-buffered") { stalledUntil = at + actualLoad; ctl.seeked(actualLoad) }
            }
            trueError = pos - targetAt(tl, at)
            rates.add(rate)
            if (caught == null && abs(trueError) < SyncRules.DEADBAND_MS && !buffering) caught = at
            if (caught != null && abs(trueError) >= SyncRules.DEADBAND_MS * 2 && !buffering) caught = null
            at += 500
        }
        return Sim(seeks, caught, flips, trueError, rates)
    }

    @Test fun clockPicksLowestRtt() {
        var local = 1000.0
        val c = SharedClock({ local })
        c.sample(1000.0, 6020.0, 1040.0)
        c.sample(2000.0, 7350.0, 2400.0)
        assertEquals(5000.0, c.offset, 0.001)
        local = 3000.0
        assertEquals(8000.0, c.serverNow(), 0.001)
    }

    @Test fun behindAndBufferedJumpsOnce() {
        val r = simulate(-1400.0, noise = 20.0)
        assertEquals(1, r.seeks)
        assertTrue((r.caughtAt ?: 1e9) <= 1000.0)
    }

    @Test fun aheadUsesProportionalRateWithoutFlips() {
        val r = simulate(1000.0, noise = 20.0)
        assertEquals(0, r.seeks)
        assertTrue(r.rates.min() >= 1 - SyncRules.MAX_STEP)
        assertNotNull(r.caughtAt)
        assertTrue(r.caughtAt!! < 20_000)
        assertEquals(0, r.flips)
        assertEquals(1.0, r.rates.last(), 0.0)
    }

    @Test fun smallDriftGentleRate() {
        val r = simulate(-80.0, seconds = 20, noise = 10.0)
        val corrected = r.rates.filter { it != 1.0 }
        assertTrue(corrected.isNotEmpty())
        assertTrue(corrected.max() <= 1.04)
        assertEquals(1.0, r.rates.last(), 0.0)
    }

    @Test fun jitterAloneNeverCorrects() {
        val r = simulate(0.0, seconds = 60, noise = 45.0)
        assertEquals(0, r.seeks)
        assertTrue(r.rates.all { it == 1.0 })
    }

    @Test fun neverCorrectsWhileBuffering() {
        val ctl = DriftController()
        val tl = Timeline("k", null, true, true, 0.0, 0.0, 1.0, 1)
        repeat(6) { i -> assertEquals("buffering", ctl.step(tl, 0.0, i * 500.0, buffering = true).reason) }
    }

    @Test fun hostCommandFollowedInsideCooldown() {
        val ctl = DriftController()
        val tl = Timeline("k", null, true, true, 0.0, 0.0, 1.0, 1)
        assertNull(ctl.step(tl, -3000.0, 0.0, bufferedAhead = 10_000.0).seekTo)
        assertNotNull(ctl.step(tl, -2500.0, 500.0, bufferedAhead = 10_000.0).seekTo)
        val moved = Timeline("k", null, true, true, 600_000.0, 1000.0, 1.0, 2)
        val d = ctl.step(moved, 1000.0, 1000.0, bufferedAhead = 10_000.0)
        assertEquals("host-command", d.reason)
        assertTrue(d.seekTo!! >= 600_000)
    }

    @Test fun matchesWebMedian() {
        assertEquals(0.0, conservativeMedian(listOf(0.0, 500.0)), 0.0)
        assertEquals(-20.0, conservativeMedian(listOf(-20.0, 900.0)), 0.0)
        assertEquals(30.0, conservativeMedian(listOf(10.0, 30.0, 200.0)), 0.0)
    }
}
