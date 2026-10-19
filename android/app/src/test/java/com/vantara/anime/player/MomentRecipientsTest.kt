package com.vantara.anime.player

import org.junit.Assert.*
import org.junit.Test

class MomentRecipientsTest {
    @Test fun `everyone uses real friends and never duplicates a single face`() {
        assertEquals(emptyList<String>(), MomentRecipients.faces(emptyList<String>()))
        assertEquals(listOf("a"), MomentRecipients.faces(listOf("a")))
        assertEquals(listOf("a", "b"), MomentRecipients.faces(listOf("a", "b")))
        assertEquals(listOf("a", "b", "c"), MomentRecipients.faces(listOf("a", "b", "c", "d")))
        assertEquals(5, MomentRecipients.remaining(8))
        assertEquals(0, MomentRecipients.remaining(2))
    }
}
