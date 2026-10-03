package com.vantara.anime

import com.vantara.anime.adapters.EgyDeadSiteAdapter.Parse
import org.junit.Assert.assertEquals
import org.junit.Test

/** أجزاء مطابقة لصفحات tv10.egydead.live الحقيقية (فحص 2026-10-03). نفس عيّنات `engines/egydead.test.js`. */
class EgyDeadSiteTest {
    private val b = "https://tv10.egydead.live"
    private fun card(href: String, title: String) = """<li class="movieItem"><a href="$b$href" title="$title"><img src="$b/wp-content/uploads/x.jpg"><h1 class="BottomTitle">$title</h1></a></li>"""

    @Test fun `movies and season pages are copies, collections are not, lone episodes fold`() {
        val html = listOf(
            card("/serie/all-shameless/", "جميع مواسم مسلسل Shameless 2011 مترجم كامل"),
            card("/assembly/dune-collection/", "سلسلة افلام Dune مترجمة كاملة"),
            card("/season/shameless-s3/", "مسلسل Shameless الموسم الثالث مترجم كامل"),
            card("/episode/shameless-s3-e12/", "مسلسل Shameless الموسم الثالث الحلقة 12 الاخيرة"),
            card("/episode/dune-prophecy-6/", "مسلسل Dune Prophecy الحلقة 6 مترجمة"),
            card("/episode/dune-prophecy-5/", "مسلسل Dune Prophecy الحلقة 5 مترجمة"),
            card("/watch-dune-part-1-2021/", "مشاهدة فيلم Dune Part 1 2021 مترجم"),
        ).joinToString("")
        val items = Parse.cards(html, "$b/?s=x", "egydead")
        assertEquals(
            listOf(
                "/season/shameless-s3/" to "مسلسل Shameless الموسم الثالث مترجم كامل",
                "/watch-dune-part-1-2021/" to "مشاهدة فيلم Dune Part 1 2021 مترجم",
                "/episode/dune-prophecy-6/" to "مسلسل Dune Prophecy",
            ),
            items.map { it.url to it.title },
        )
    }

    @Test fun `season episodes and unique servers`() {
        val season = """<div class="EpsList">
            <li><a href="$b/episode/shameless-s3-e12/" title="مسلسل Shameless الموسم الثالث الحلقة 12 الاخيرة"> حلقه 12 </a></li>
            <li><a href="$b/episode/shameless-s3-e1/" title="مسلسل Shameless الموسم الثالث الحلقة 1"> حلقه 1 </a></li></div>"""
        assertEquals(listOf(1f, 12f), Parse.episodes(season, "$b/season/shameless-s3/", "egydead").map { it.number })
        val watch = """<ul class="serversList"><li data-link="https://hgcloud.to/e/vhipmjhf4oaa"><p>StreamHG</p></li><li data-link="https://mixdrop.top/e/eng9wxx0uqdjgo9"><p>Mixdrop</p></li></ul>
            <div class="mob-servers"><ul><li data-link="https://hgcloud.to/e/vhipmjhf4oaa"><span><p>StreamHG</p></span></li><li data-link="https://playmogo.com/e/0a9mkfs6nxup"><span><p>DoodStream</p></span></li></ul></div>"""
        assertEquals(listOf("StreamHG", "Mixdrop", "DoodStream"), Parse.servers(watch, "$b/x/").map { it.name })
    }
}
