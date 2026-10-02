package com.vantara.anime

import com.vantara.anime.adapters.ShahiidSiteAdapter.Parse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** أجزاء مطابقة لصفحات shahiid-anime.net الحقيقية (فحص 2026-10-02). */
class ShahiidSiteTest {

    @Test fun `titles keep the Latin name AniList matches`() {
        assertEquals("One Piece", Parse.cleanTitle("أنمي One Piece ون بيس مترجم"))
        assertEquals("Sousou no Frieren 2nd Season", Parse.cleanTitle("أنمي Sousou no Frieren 2nd Season الموسم الثاني مترجم"))
        assertEquals("Kaijuu 8-gou: Narumi no Heijitsu", Parse.cleanTitle("أونا Kaijuu 8-gou: Narumi no Heijitsu مترجم"))
        assertEquals("ون بيس", Parse.cleanTitle("أنمي ون بيس مترجم"))
    }

    @Test fun `search cards give the work path, clean title and poster`() {
        val html = """
            <div class="one-poster col-lg-2"><div class="wrap-poster clearfix">
              <a href="https://shahiid-anime.net/series/one-piece-x/"><img src="https://i0.wp.com/shahiid-anime.net/op.jpg" alt="الملصق الرسمي لأنمي One Piece ون بيس مترجم"></a>
              <h2><a href="https://shahiid-anime.net/series/one-piece-x/">أنمي One Piece ون بيس مترجم</a></h2>
            </div></div>"""
        val item = Parse.search(html, "shahiid").single()
        assertEquals("One Piece", item.title)
        assertEquals("/series/one-piece-x/", item.url)
        assertEquals("https://i0.wp.com/shahiid-anime.net/op.jpg", item.thumbnail)
    }

    @Test fun `a series page leads to its first real season, not the seasons archive`() {
        val html = """
            <a href="https://shahiid-anime.net/seasons/">كل المواسم</a>
            <a href="https://shahiid-anime.net/seasons/page/2/">2</a>
            <a href="https://shahiid-anime.net/seasons/sousou-no-frieren/">أنمي Sousou no Frieren مترجم</a>"""
        assertEquals("https://shahiid-anime.net/seasons/sousou-no-frieren/", Parse.firstSeason(html, "https://shahiid-anime.net/series/sousou-no-frieren/"))
        assertNull(Parse.firstSeason("""<a href="https://shahiid-anime.net/seasons/">x</a>""", "https://shahiid-anime.net/series/x/"))
    }

    @Test fun `season episodes are numbered from their links, watch buttons skipped`() {
        val html = """
            <a href="https://shahiid-anime.net/episodes/frieren-02/">أنمي Sousou no Frieren الحلقة 02 مترجمة</a>
            <a href="https://shahiid-anime.net/episodes/frieren-02/">مشاهدة الحلقة</a>
            <a href="https://shahiid-anime.net/episodes/frieren-01/">أنمي Sousou no Frieren الحلقة 01 مترجمة</a>"""
        val eps = Parse.episodes(html, "https://shahiid-anime.net/seasons/x/", "shahiid")
        assertEquals(listOf(1f, 2f), eps.map { it.number })
        assertEquals("/episodes/frieren-01/", eps[0].url)
    }

    @Test fun `servers come from the buttons, closed hosts dropped, iframe read from the ajax reply`() {
        val html = """
            <ul class="tabs-ul">
              <li><a class="buttosn" data-serv="_server_movie_41363" data-frameserver='WaSEAwfEFgDXs' data-post="41363">Megamax متعدد</a></li>
              <li><a class="buttosn" data-serv="_server_movie_38543" data-frameserver='1821494348494' data-post="38543">Okru</a></li>
              <li><a class="buttosn" data-serv="_server_movie_37888" data-frameserver='6895494' data-post="37888">TunePk</a></li>
            </ul>"""
        val servers = Parse.servers(html)
        assertEquals(listOf("Megamax متعدد", "Okru"), servers.map { it.name })
        assertEquals("1821494348494", servers[1].frame)
        assertEquals("https://ok.ru/videoembed/1821494348494", Parse.iframe("""<iframe width="100%" src="//ok.ru/videoembed/1821494348494"></iframe>"""))
    }
}
