package dev.vantara.spike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class BatchContentLabelTest {

    @Test
    fun safeOnlyBatchLabelNeverMentionsNsfw() {
        val label = batchContentLabel(setOf(ContentWarning.SAFE))

        assertEquals("SAFE فقط", label)
        assertFalse(label.contains("NSFW"))
    }

    @Test
    fun safeAndMixedBatchLabelNamesOnlyPresentClasses() {
        val label = batchContentLabel(setOf(ContentWarning.SAFE, ContentWarning.MIXED))

        assertEquals("SAFE + MIXED", label)
        assertFalse(label.contains("NSFW"))
    }
}
