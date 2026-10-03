package com.vantara.anime

import com.vantara.anime.adapters.RistoAnimeSiteAdapter.Parse
import com.vantara.anime.hosts.Generic
import org.junit.Assert.assertEquals
import org.junit.Test

/** أجزاء مطابقة لصفحات ristoanime.me الحقيقية (فحص 2026-10-03). نفس عيّنات `engines/ristoanime.test.js`. */
class RistoAnimeSiteTest {
    private val b = "https://ristoanime.me"

    @Test fun `search cards give the latin name`() {
        val html = """<div class="BlocksHolder"><div class="MovieItem"><a href="$b/series/all-naruto/"><div class="poster" style="background-image: url($b/wp-content/uploads/naruto.webp);"></div><div class="title"><p>مشاهدة انمي ناروتو Naruto الحلقة 1</p><h4>جميع حلقات انمي ناروتو Naruto مترجمة اون لاين</h4></div></a></div></div>"""
        val cards = Parse.cards(html, b)
        assertEquals(listOf("Naruto"), cards.map { it.title })
        assertEquals("/series/all-naruto/", cards[0].url)
        assertEquals("$b/wp-content/uploads/naruto.webp", cards[0].thumb)
    }

    @Test fun `series page seasons and post id`() {
        val html = """<div class="SeasonsList"><ul><li><a class="no-ajax" data-season="34548" href="javascript:void(0)">Sousou no Frieren الموسم 1</a></li><li class="active"><a class="no-ajax" data-season="34605" href="javascript:void(0)">Sousou no Frieren الموسم 2</a></li></ul></div>
            <script>${'$'}.ajax({url: AjaxtURL+'Single/Episodes.php',type: 'POST',dataType: 'html',data: {season: ${'$'}(this).data('season') ,post_id: '27110'}})</script>"""
        val (post, seasons) = Parse.seasons(html)
        assertEquals("27110", post)
        assertEquals(listOf("34548" to 1, "34605" to 2), seasons.map { it.id to it.n })
    }

    @Test fun `episodes from the ajax reply`() {
        val html = """<a href="$b/frieren-ep-28/">الحلقة<em>28</em></a><a href="$b/frieren-ep-2/">الحلقة<em>2</em></a><a href="$b/frieren-ep-1/">الحلقة<em>1</em></a>"""
        assertEquals(listOf(1f, 2f, 28f), Parse.episodes(html, b, "ristoanime").map { it.number })
    }

    @Test fun `servers drop the trailing html except embed-x html, and skip MEGA`() {
        val html = """<ul id="watch">
            <li data-watch="https://vidmoly.biz/embed-exqjhwsjl0et.html" class="ISActive"><span>0</span>سيرفر 1</li>
            <li data-watch="https://mega.nz/embed/uXYAwArQ#Ml.html"><span>1</span>سيرفر 1.2</li>
            <li data-watch="https://sendvid.com/embed/6wbjikq0.html"><span>3</span>سيرفر 3.1</li>
            <li data-watch="https://hgcloud.to/e/lvegtxhv1c7x.html"><span>7</span>سيرفر احتياطي 1</li></ul>"""
        assertEquals(
            listOf("سيرفر 1" to "https://vidmoly.biz/embed-exqjhwsjl0et.html", "سيرفر 3.1" to "https://sendvid.com/embed/6wbjikq0", "سيرفر احتياطي 1" to "https://hgcloud.to/e/lvegtxhv1c7x"),
            Parse.servers(html).map { it.name to it.url },
        )
    }

    @Test fun `media links in raw attributes lose their html entities`() {
        val html = """<meta property="og:video" content="https://videos2.sendvid.com/a5/b7/9x54tp9v.mp4?validfrom=1&amp;validto=2&amp;rate=3">"""
        assertEquals(listOf("https://videos2.sendvid.com/a5/b7/9x54tp9v.mp4?validfrom=1&validto=2&rate=3"), Generic.streams(html, "https://sendvid.com/embed/x"))
    }
}
