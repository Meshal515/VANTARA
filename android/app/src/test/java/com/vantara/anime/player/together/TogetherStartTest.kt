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
