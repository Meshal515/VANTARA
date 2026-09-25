package com.vantara.anime

import com.vantara.anime.registry.ManifestParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** البيان الحقيقي الذي تشحنه حزمة الويب يجب أن يمر بفحص المحرك نفسه. */
class ManifestFileTest {

    private val file = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "apps/web/anime/sources.json") }
        .first { it.isFile }

    @Test fun `shipped manifest parses and validates`() {
        val m = ManifestParser.parse(file.readText())
        assertEquals(emptyList<String>(), ManifestParser.validate(m))
        assertTrue(m.sources.any { it.id == "okanime" && it.enabled })
    }

    @Test fun `every disabled source says why`() {
        val m = ManifestParser.parse(file.readText())
        for (s in m.sources.filter { !it.enabled }) assertTrue(s.id, !s.disabledReason.isNullOrBlank())
    }

    @Test fun `fingerprints and card selectors are usable`() {
        val m = ManifestParser.parse(file.readText())
        for (s in m.sources) {
            s.domains.fingerprint?.let { Regex(it) }
            s.catalog.urlTemplate?.let { assertTrue(s.id, "{page}" in it) }
        }
    }
}
