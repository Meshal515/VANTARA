package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * السؤال: هل يرى القارئ العربي كتالوج MangaDex العربي، أم أول لغة في الحزمة؟
 */
class ArabicSourceSelectionTest {

    private class FakeSource(override val id: Long, override val lang: String) : CatalogueSource {
        override val name: String = "MangaDex"
    }

    private fun spec(ids: Set<String>) = SourceSpec(
        label = "MangaDex",
        pkg = "eu.kanade.tachiyomi.extension.all.mangadex",
        expectedLib = 1.4,
        apkUrl = "https://example.invalid/mangadex.apk",
        sha256 = "0".repeat(64),
        versionName = "1.4.0",
        warning = ContentWarning.MIXED,
        arabicSourceIds = ids,
        arabicSourceNames = listOf("MangaDex"),
    )

    private val english = FakeSource(10L, "en")
    private val arabic = FakeSource(20L, "ar")
    private val french = FakeSource(30L, "fr")

    @Test
    fun `the indexed arabic id wins even when english comes first`() {
        val picked = selectArabicSources(spec(setOf("20")), listOf(english, arabic, french))
        assertEquals(listOf(arabic), picked)
    }

    @Test
    fun `without a matching id it falls back to arabic language only`() {
        val picked = selectArabicSources(spec(setOf("999")), listOf(english, arabic))
        assertEquals(listOf(arabic), picked)
    }

    @Test
    fun `a package with no arabic source yields nothing rather than english`() {
        val picked = selectArabicSources(spec(setOf("999")), listOf(english, french))
        assertEquals(emptyList<CatalogueSource>(), picked)
    }

    @Test
    fun `ids larger than a signed long survive as strings`() {
        // source.id قد يتجاوز Long الموجب؛ المقارنة نصية بقصد
        val big = FakeSource(-4_611_686_018_427_387_904L, "ar")
        val picked = selectArabicSources(spec(setOf(big.id.toString())), listOf(english, big))
        assertEquals(listOf(big), picked)
    }
}
