package dev.vantara.spike

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CataloguePageFailurePolicyTest {

    @Test
    fun `known Iken empty filtered page NPE is skippable`() {
        assertTrue(
            isKnownEmptyIkenPageBug(
                NullPointerException(),
                listOf(
                    "eu.kanade.tachiyomi.extension.ar.azora.AzoraFactory",
                    "eu.kanade.tachiyomi.extension.ar.azora.Azora",
                    "eu.kanade.tachiyomi.multisrc.iken.Iken",
                ),
            ),
        )
    }

    @Test
    fun `ordinary source NPE is never skipped`() {
        assertFalse(
            isKnownEmptyIkenPageBug(
                NullPointerException(),
                listOf("eu.kanade.tachiyomi.multisrc.madara.Madara"),
            ),
        )
    }

    @Test
    fun `Iken transport errors are never skipped`() {
        assertFalse(
            isKnownEmptyIkenPageBug(
                java.io.IOException("network"),
                listOf("eu.kanade.tachiyomi.multisrc.iken.Iken"),
            ),
        )
    }
}
