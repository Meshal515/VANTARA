package com.vantara.anime

import com.vantara.anime.net.DomainPolicy
import com.vantara.anime.registry.ManifestParser
import okhttp3.HttpUrl.Companion.toHttpUrl
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

    @Test fun `EgyDead has a native MegaMax server extraction path`() {
        val rule = ManifestParser.parse(file.readText()).sources.first { it.id == "egydead" }.embeds
        assertTrue("Old extension ignores MegaMax, so it needs the page server path", rule != null)
        val embeds = rule!!.extract("""<ul class="serversList"><li data-link="https://megamax.me/iframe/x"><span><p>MegaMax</p></span></li></ul>""", "https://tv10.egydead.live/unabomber-2026/")
        assertEquals("https://megamax.me/iframe/x", embeds.single().url)
        assertEquals("MegaMax", embeds.single().name)
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

    /**
     * تحويلات رآها جوال حقيقي (السعودية): كانت كلها «موقع غريب» فتعذّرت ثلاثة
     * مصادر من أربعة. الموقع نفسه في بيت جديد يُقبل؛ صفحة غريبة تبقى مرفوضة.
     */
    @Test fun `cinema sources follow their real domain moves and nothing else`() {
        val m = ManifestParser.parse(file.readText())
        fun plan(id: String) = m.sources.first { it.id == id }.domains.plan(null)
        fun judge(id: String, from: String, to: String, html: String?) =
            DomainPolicy.judge(from.toHttpUrl(), to.toHttpUrl(), plan(id), html)

        val cima = "<title>سيما ليك الأصلي - مشاهدة افلام</title>"
        assertEquals(DomainPolicy.Verdict.FINGERPRINT_OK, judge("cimaleek", "https://m.cimaleek.pw/?s=x", "https://wwr433.b2cima.click/?s=x", cima))
        assertEquals(DomainPolicy.Verdict.FOREIGN, judge("cimaleek", "https://m.cimaleek.pw/?s=x", "https://wwr433.b2cima.click/?s=x", "<title>Parked domain</title>"))
        assertEquals(DomainPolicy.Verdict.KNOWN, judge("egydead", "https://tv10.egydead.live/?s=x", "https://m6o3p.sbs/?s=x", null))
        assertEquals(DomainPolicy.Verdict.FINGERPRINT_OK, judge("arabseed", "https://m.myseed.pics/", "https://m.myseed.tv/", "<title>ماي سيد - MySeed</title>"))
        assertEquals(DomainPolicy.Verdict.FOREIGN, judge("egydead", "https://tv10.egydead.live/", "https://ads.example.com/", "<title>Win a prize</title>"))
        // ArabSeed انتقل رسميًا: الدومين القديم يُعاد كتابته للجديد قبل الطلب، بلا تحويلين
        val asd = plan("arabseed")
        assertEquals("m.myseed.pics", DomainPolicy.rewrite("https://m.asd.homes/find/?word=x".toHttpUrl(), asd, null)?.host)
    }

    @Test fun `every enabled cinema source can recognise itself after a domain move`() {
        val m = ManifestParser.parse(file.readText())
        for (s in m.sources.filter { it.content == "cinema" && it.enabled && it.disabledReason == null }) {
            assertTrue("${s.id} بلا بصمة: أي تغيير دومين سيُرفض", !s.domains.fingerprint.isNullOrBlank())
        }
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
