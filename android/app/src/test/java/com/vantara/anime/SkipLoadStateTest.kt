package com.vantara.anime

import com.vantara.anime.player.IntroSkip
import com.vantara.anime.player.SkipLoadState
import com.vantara.anime.player.SkipRepository
import org.junit.Assert.*
import org.junit.Test

class SkipLoadStateTest {
    private fun ready() = SkipRepository.Result(IntroSkip.Timings(opening = IntroSkip.Interval(90_000, 180_000)), SkipRepository.Status.READY)

    @Test fun `a late response cannot follow a server switch`() {
        val state = SkipLoadState()
        val a = state.begin("episode-1/server-a", 1_440_000)!!
        val b = state.begin("episode-1/server-b", 1_440_000)!!
        assertFalse(state.complete(a, ready()))
        assertNull(state.result)
        assertTrue(state.complete(b, ready()))
        assertEquals(ready().timings, state.result!!.timings)
    }

    @Test fun `an in flight request is not duplicated by the player clock`() {
        val state = SkipLoadState()
        state.begin("a", 1_440_000)
        assertNull(state.begin("a", 1_440_000))
    }

    @Test fun `network retries have a deadline and a finite limit`() {
        var now = 0L
        val state = SkipLoadState { now }
        repeat(3) {
            val token = state.begin("a", 1_440_000)!!
            state.complete(token, SkipRepository.Result(status = SkipRepository.Status.FAILED))
            assertNull(state.begin("a", 1_440_000))
            now += 60_000
        }
        assertNull(state.begin("a", 1_440_000))
        assertNotNull(state.begin("a", 1_440_000, force = true))
    }

    @Test fun `missing timings stay quiet until a deliberate retry`() {
        val state = SkipLoadState()
        val token = state.begin("a", 1_440_000)!!
        state.complete(token, SkipRepository.Result(status = SkipRepository.Status.NOT_FOUND))
        assertNull(state.begin("a", 1_440_000))
        assertNotNull(state.begin("a", 1_440_000, force = true))
    }

    @Test fun `a corrected video duration requests matching data again`() {
        val state = SkipLoadState()
        val token = state.begin("a", 1_440_000)!!
        state.complete(token, ready())
        assertNull(state.begin("a", 1_440_800))
        assertNotNull(state.begin("a", 1_445_000))
        assertNull(state.result)
    }

    @Test fun `clearing playback invalidates pending results`() {
        val state = SkipLoadState()
        val token = state.begin("a", 1_440_000)!!
        state.clear()
        assertFalse(state.complete(token, ready()))
        assertNull(state.result)
        assertFalse(state.pending)
    }

    @Test fun `manual retry respects the service cooldown`() {
        var now = 0L
        val state = SkipLoadState { now }
        val token = state.begin("a", 1_440_000)!!
        state.complete(token, SkipRepository.Result(status = SkipRepository.Status.FAILED, retryAfterMs = 60_000))
        assertNull(state.begin("a", 1_440_000, force = true))
        now = 60_000
        assertNotNull(state.begin("a", 1_440_000, force = true))
    }

    @Test fun `switching servers cannot bypass the service cooldown`() {
        var now = 0L
        val state = SkipLoadState { now }
        val token = state.begin("a", 1_440_000)!!
        state.complete(token, SkipRepository.Result(status = SkipRepository.Status.FAILED, retryAfterMs = 60_000))
        state.clear()
        assertEquals(60_000L, state.cooldownLeftMs)
        assertNull(state.begin("b", 1_440_000, force = true))
        now = 60_000
        assertEquals(0L, state.cooldownLeftMs)
        assertNotNull(state.begin("b", 1_440_000))
    }
}
