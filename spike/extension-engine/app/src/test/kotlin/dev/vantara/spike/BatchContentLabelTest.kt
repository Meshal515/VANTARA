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

    @Test
    fun consentCopyNamesTheExactEighteenSourcePolicy() {
        val copy = batchConsentCopy(
            listOf(
                *Array(15) { ContentWarning.SAFE },
                ContentWarning.MIXED,
                ContentWarning.NSFW,
                ContentWarning.NSFW,
            ),
        )

        assertEquals(
            "15 عربي SAFE · MangaDex واحد MIXED · مصدران عربيان NSFW. " +
                "قد تظهر صور فصول للبالغين أثناء الفحص.",
            copy,
        )
    }

    @Test
    fun sensitiveBatchRequiresExplicitConsent() {
        assertFalse(requiresExplicitConsent(listOf(ContentWarning.SAFE)))
        assertEquals(
            true,
            requiresExplicitConsent(listOf(ContentWarning.SAFE, ContentWarning.MIXED)),
        )
        assertEquals(
            true,
            requiresExplicitConsent(listOf(ContentWarning.SAFE, ContentWarning.NSFW)),
        )
    }
}
