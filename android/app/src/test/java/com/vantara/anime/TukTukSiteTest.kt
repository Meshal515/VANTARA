package com.vantara.anime

import com.vantara.anime.adapters.TukTukSiteAdapter.Parse
import org.junit.Assert.assertEquals
import org.junit.Test

/** أجزاء مطابقة لصفحات tuktukhd.com الحقيقية (فحص 2026-10-02). */
class TukTukSiteTest {

    @Test fun `server links decode like the site's own decodeLink`() {
        assertEquals(
            "https://megatuktuk.store/iframe/yHeHiy7qXvQI5",
            Parse.decode("1kUU2hVc3kXaIVGS59SZtFmcml2LlJ3b0NnLrVHdrVHdhdWZt9yL6MHc0RHa0REL0Y&amp;vHyqBRZ3ih"),
        )
    }

    @Test fun `search keeps movies and folds a season's episodes into one work`() {
        val html = """
            <ul class="Blocks--List">
            <div class="Block--Item"><a href="https://tuktukhd.com/toy-story-5/" title="فيلم Toy Story 5 2026 مترجم اون لاين"><div class="Poster--Block"><img src="/no.png" data-src="https://tuktukhd.com/ts5.webp"></div></a></div>
            <div class="Block--Item"><a href="https://tuktukhd.com/mobland-s2-2/" title="مسلسل MobLand الموسم الثاني الحلقة 2"><img data-src="https://tuktukhd.com/m2.webp"></a></div>
            <div class="Block--Item"><a href="https://tuktukhd.com/mobland-s2-1/" title="مسلسل MobLand الموسم الثاني الحلقة 1"><img data-src="https://tuktukhd.com/m1.webp"></a></div>
            </ul>"""
        val items = Parse.search(html, "tuktukcinema")
        assertEquals(listOf("فيلم Toy Story 5 2026 مترجم اون لاين", "مسلسل MobLand الموسم الثاني"), items.map { it.title })
        assertEquals("https://tuktukhd.com/ts5.webp", items[0].thumbnail)
        assertEquals("/mobland-s2-2/", items[1].url)
    }

    @Test fun `episodes and servers come from the episode page`() {
        val html = """
            <div class="episodes--list--side">
              <a class="active" href="https://tuktukhd.com/mobland-s1-10/" title="مسلسل MobLand الموسم الاول الحلقة 10 والاخيرة"> الحلقة <em>10</em> </a>
              <a href="https://tuktukhd.com/mobland-s1-9/" title="مسلسل MobLand الموسم الاول الحلقة 9"> الحلقة <em>9</em> </a>
            </div>
            <div class="watch--servers--list"><ul>
              <li data-link="1kUU2hVc3kXaIVGS59SZtFmcml2LlJ3b0NnLrVHdrVHdhdWZt9yL6MHc0RHa0REL0Y&amp;vHyqBRZ3ih" class="server--item active"><span>⭐ TukTuk Vip</span></li>
            </ul></div>
            <iframe id="main-video-frame" src="about:blank" data-crypt="aHR0cHM6Ly9tZWdhdHVrdHVrLnN0b3JlL2lmcmFtZS95SGVIaXk3cVh2UUk1"></iframe>"""
        assertEquals(listOf(9f, 10f), Parse.episodes(html, "https://tuktukhd.com/mobland-s1-10/", "tuktukcinema").map { it.number })
        val servers = Parse.servers(html)
        assertEquals(listOf("TukTuk Vip"), servers.map { it.name })
        assertEquals("https://megatuktuk.store/iframe/yHeHiy7qXvQI5", servers.single().url)
    }
}
