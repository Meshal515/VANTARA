package com.vantara.anime.player.together

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** «البدء» في غرفة المشاهدة معًا: يرسل فقط حين يجهز المضيف، وكل رفض له رسالة بسببه (لا لمسة صامتة). */
class TogetherStartTest {
    @Test fun `ready connected host with a server sends the start command`() {
        assertEquals(TogetherStart.Gate.SEND, TogetherStart.gate(ready = true, connected = true, awaitingPick = false))
        assertNull(TogetherStart.message(TogetherStart.Gate.SEND))
    }

    @Test fun `every refusal has a visible reason, server first then connection then preparation`() {
        assertEquals(TogetherStart.Gate.PICK_SERVER, TogetherStart.gate(ready = false, connected = false, awaitingPick = true))
        assertEquals(TogetherStart.Gate.OFFLINE, TogetherStart.gate(ready = true, connected = false, awaitingPick = false))
        assertEquals(TogetherStart.Gate.PREPARING, TogetherStart.gate(ready = false, connected = true, awaitingPick = false))
        for (g in TogetherStart.Gate.values().filter { it != TogetherStart.Gate.SEND }) assertNotNull("$g needs a message", TogetherStart.message(g))
    }

    @Test fun `the shared countdown is three seconds and failures after sending are explained`() {
        assertEquals(3_000L, TogetherStart.COUNTDOWN_MS)
        assert(TogetherStart.REPLY_TIMEOUT_MS > TogetherStart.COUNTDOWN_MS)
        listOf(TogetherStart.SEND_FAILED, TogetherStart.DENIED, TogetherStart.NO_REPLY).forEach { assert(it.isNotBlank()) }
    }

    private val invite = TogetherStart.EpisodeArt(image = "https://img/ep1.jpg", title = "عنوان 1", rating = "8.7", duration = "24 دقيقة")
    private val known = mapOf(1 to ("https://zip/ep1.jpg" to "Title 1"), 2 to ("https://zip/ep2.jpg" to "Title 2"))

    @Test fun `the invite episode keeps the art sent with the invitation`() {
        assertEquals(invite, TogetherStart.episodeArt(1, 1, invite, known[1]))
    }

    @Test fun `changing the room episode changes the thumbnail and never keeps the previous one`() {
        val art = TogetherStart.episodeArt(2, 1, invite, known[2])
        assertEquals("https://zip/ep2.jpg", art.image)
        assertEquals("Title 2", art.title)
        // التقييم والمدة كانا للحلقة 1: لا يبقيان على الحلقة 2
        assertNull(art.rating)
        assertNull(art.duration)
    }

    @Test fun `an episode with unknown art shows nothing rather than the previous episode`() {
        val art = TogetherStart.episodeArt(3, 1, invite, known[3])
        assertNull(art.image)
        assertNull(art.title)
        // الرجوع لحلقة الدعوة يعيد فنها
        assertEquals("https://img/ep1.jpg", TogetherStart.episodeArt(1, 1, invite, null).image)
    }

    @Test fun `the invite episode falls back to episode art when the invitation had none`() {
        val bare = TogetherStart.EpisodeArt(null, null, null, null)
        assertEquals("https://zip/ep1.jpg", TogetherStart.episodeArt(1, 1, bare, known[1]).image)
    }

    private fun m(id: String, state: String, key: String?, host: Boolean = false) =
        Member(userId = id, name = id, host = host, joinedAt = 0, pos = null, at = null, state = state, source = null, driftMs = null, sameVersion = null, mediaKey = key)

    @Test fun `start waits for every guest to be ready on the room episode`() {
        val roster = listOf(m("host", "ready", "anime:1#2", host = true), m("b", "playing", "anime:1#1"), m("c", "ready", "anime:1#2"), m("d", "failed", "anime:1#2"))
        // تقرير الحلقة السابقة والمتعذّر غير جاهزين؛ المضيف ونفسي خارج الحساب
        assertEquals(listOf("b", "d"), TogetherStart.notReady(roster, "host", "anime:1#2").map { it.userId })
        assertEquals(TogetherStart.Gate.GUESTS, TogetherStart.gate(ready = true, connected = true, awaitingPick = false, guestsWaiting = 2))
        assertEquals(TogetherStart.Gate.SEND, TogetherStart.gate(ready = true, connected = true, awaitingPick = false, guestsWaiting = 0))
        assertEquals("ما نقدر نبدأ: بانتظار b يجهز", TogetherStart.waitingText(listOf("b")))
    }
}
