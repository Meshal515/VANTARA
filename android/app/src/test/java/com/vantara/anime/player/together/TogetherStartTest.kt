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
}
