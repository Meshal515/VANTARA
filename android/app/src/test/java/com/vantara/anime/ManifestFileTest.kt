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
        assertTrue(m.sources.any { it.id == "witanime" && it.enabled && it.adapter == "witanime-site" })
    }

    @Test fun `OkAnime's server rule reads the redesigned episode page`() {
        val rule = ManifestParser.parse(file.readText()).sources.first { it.id == "okanime" }.embeds!!
        val html = """
            <a href="javascript:void(0);" class="no-link ep-link" data-server="mp4upload" data-umami-event-quality="720p"
               @click="setServer('https://mp4upload.com/embed-dlhs6n110l8p.html')">HD Mp4upload</a>
            <a href="javascript:void(0);" class="no-link ep-link" data-server="vk" data-umami-event-quality="720p"
               @click="setServer('https://vkvideo.ru/video_ext.php?oid=-1&amp;id=2&amp;hash=3&amp;hd=3')">HD vk</a>
            <a href="https://mega.nz/#!6zpm!cIQb" class="no-link ep-link" data-umami-event-host="meganz">FHD mega.nz</a>"""
        val e = rule.extract(html, "https://ww3.okanime.xyz/episode/x-episode-12")
        assertEquals(listOf("mp4upload", "vk"), e.map { it.name })
        assertEquals("https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=3&hd=3", e[1].url)
        assertEquals(720, e[0].quality)
    }

    @Test fun `an adapter this app version does not know is rejected`() {
        val m = ManifestParser.parse("""{"sources":[{"id":"x","name":"X","adapter":"nope","domains":{"current":"https://x.test"}}]}""")
        assertTrue(ManifestParser.validate(m).any { "nope" in it })
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
