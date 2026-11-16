package com.vantara.anime.player.together

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** اتصال الغرفة في الجوال بقواعد الويب نفسها (room.js)، ونوع العمل في أمر «الحلقة التالية». */
class TogetherConnectionTest {
    @Test fun aSilentSocketIsDeadAfterTwelveSecondsAndAnyMessageKeepsItAlive() {
        val w = ConnectionWatch()
        w.opened(0)
        assertFalse(w.dead(ConnectionWatch.SILENCE_MS))
        assertTrue("صمت أطول من 12 ث", w.dead(ConnectionWatch.SILENCE_MS + 1))
        w.received(10_000)
        assertFalse(w.dead(20_000))
    }

    @Test fun aCommandWithNoReplyWithinTwoAndAHalfSecondsMeansADeadSocket() {
        val w = ConnectionWatch()
        w.opened(0)
        w.expectReply(1_000)
        w.expectReply(2_000) // الانتظار من أول ما لم يُرد عليه
        assertFalse(w.dead(1_000 + ConnectionWatch.ECHO_MS))
        assertTrue(w.dead(1_000 + ConnectionWatch.ECHO_MS + 1))
        w.received(3_000)
        assertFalse("الرد (أي رسالة) ينهي الانتظار", w.dead(3_000 + ConnectionWatch.ECHO_MS + 1))
    }

    @Test fun theNextEpisodeKeepsTheKindOfTheWorkFromItsKey() {
        assertEquals("cinema", TogetherClient.mediaKind("cinema:tt0903747:2#4"))
        assertEquals("anime", TogetherClient.mediaKind("anime:154587#5"))
        assertEquals("manga", TogetherClient.mediaKind("manga:mangadex:abc#12"))
        assertEquals("anime", TogetherClient.mediaKind("unknown#1"))
    }
}
