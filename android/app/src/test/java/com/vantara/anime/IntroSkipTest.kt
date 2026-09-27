package com.vantara.anime

import com.vantara.anime.player.IntroSkip
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IntroSkipTest {
    private val body = """{"found":true,"results":[{"skipType":"ed","interval":{"startTime":1300,"endTime":1380},"episodeLength":1440},{"skipType":"op","interval":{"startTime":90,"endTime":180},"episodeLength":1440}]}"""

    @Test fun `only offers the opening within the actual episode duration`() {
        val op = IntroSkip.parse(body, 1_440_000)
        assertEquals(IntroSkip.Interval(90_000, 180_000), op)
        assertFalse(IntroSkip.visible(op, 89_999))
        assertTrue(IntroSkip.visible(op, 90_000))
        assertFalse(IntroSkip.visible(op, 179_000))
    }

    @Test fun `different cut or missing timing never skips guessed footage`() {
        assertNull(IntroSkip.parse(body, 1_200_000))
        assertNull(IntroSkip.parse("""{"found":false,"results":[]}""", 1_440_000))
        assertNull(IntroSkip.parse("""{"found":true,"results":[{"skipType":"op","interval":{"startTime":0,"endTime":1500}}]}""", 1_440_000))
    }
}
