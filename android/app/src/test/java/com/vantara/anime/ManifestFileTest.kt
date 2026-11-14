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

    /** قرار المالك (30 أكتوبر 2026): لا مصادر أنمي أو سينما مدمجة؛ المستخدم يضيف إضافاته. */
    @Test fun `shipped manifest parses, validates and ships no built-in sources`() {
        val m = ManifestParser.parse(file.readText())
        assertEquals(emptyList<String>(), ManifestParser.validate(m))
        assertTrue(m.sources.isEmpty())
    }

    @Test fun `an adapter this app version does not know is rejected`() {
        val m = ManifestParser.parse("""{"sources":[{"id":"x","name":"X","adapter":"nope","domains":{"current":"https://x.test"}}]}""")
        assertTrue(ManifestParser.validate(m).any { "nope" in it })
    }
}
