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
    fun consentCopyNamesTheExactSafeSixteenSourcePolicy() {
        val copy = batchConsentCopy(
            listOf(
                *Array(15) { ContentWarning.SAFE },
                ContentWarning.MIXED,
            ),
        )

        assertEquals(
            "15 عربي SAFE · MangaDex واحد MIXED · لا توجد مصادر NSFW في الدفعة. " +
                "قد يعرض MangaDex محتوى مختلطًا أثناء الفحص.",
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

    @Test
    fun catalogueCrawlIncludesEveryNonBlockedContentClass() {
        assertEquals(true, shouldCrawlCatalogue(ContentWarning.SAFE, null))
        assertEquals(true, shouldCrawlCatalogue(ContentWarning.MIXED, null))
        assertEquals(true, shouldCrawlCatalogue(ContentWarning.NSFW, null))
        assertFalse(
            shouldCrawlCatalogue(
                ContentWarning.NSFW,
                "BL/GL specialized source blocked by VANTARA owner policy",
            ),
        )
    }
}
