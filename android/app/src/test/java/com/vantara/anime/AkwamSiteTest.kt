package com.vantara.anime

import com.vantara.anime.adapters.AkwamSiteAdapter.Parse
import org.junit.Assert.assertEquals
import org.junit.Test

/** أجزاء مطابقة لصفحات akwam.ss الحقيقية (فحص 2026-10-03). نفس عيّنات `engines/akwam.test.js`. */
class AkwamSiteTest {

    @Test fun `search cards carry kind and year, one card per season page`() {
        val html = """
            <div class="entry-box entry-box-1"><div class="entry-image"><a href="https://akwam.ss/movie/4819/dune" class="box"><picture><img src="https://img.downet.net/thumb/178x260/placeholder.png" data-src="https://img.downet.net/thumb/178x260/uploads/dune.jpg" alt="Dune"/></picture></a></div>
              <div class="entry-body"><h3 class="entry-title font-size-14 m-0"><a href="https://akwam.ss/movie/4819/dune"class="text-white">Dune</a></h3>
              <div><span class="badge badge-pill badge-secondary ml-1">2021</span><span class="badge badge-pill badge-light ml-1">خيال علمي</span></div></div></div>
            <div class="entry-box entry-box-1"><div class="entry-image"><a href="https://akwam.ss/series/1112/shameless-الموسم-لاول" class="box"><img data-src="https://img.downet.net/thumb/178x260/uploads/s1.jpg" alt="x"/></a></div>
              <h3 class="entry-title"><a href="https://akwam.ss/series/1112/shameless-الموسم-لاول">Shameless الموسم لاول</a></h3><span class="badge badge-pill badge-secondary">2011</span></div>
            <div class="entry-box"><h3 class="entry-title"><a href="https://akwam.ss/person/1/x">شخص</a></h3></div>"""
        val items = Parse.cards(html, "https://akwam.ss/search?q=x", "akwam")
        assertEquals(listOf("فيلم Dune 2021", "مسلسل Shameless الموسم لاول 2011"), items.map { it.title })
        assertEquals("/movie/4819/dune", items[0].url)
        assertEquals("https://img.downet.net/thumb/178x260/uploads/dune.jpg", items[0].thumbnail)
        assertEquals("series", Parse.kindOfPath(items[1].url))
    }

    @Test fun `season page lists its episodes in order`() {
        val html = """
            <a href="https://akwam.ss/episode/17490/shameless-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85-%D9%84%D8%A7%D9%88%D9%84/%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-2">حلقة 2 : مسلسل Shameless الموسم لاول</a>
            <a href="https://akwam.ss/episode/17489/shameless-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85-%D9%84%D8%A7%D9%88%D9%84/%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1">حلقة 1 : مسلسل Shameless الموسم لاول Pilot</a>
            <a href="https://akwam.ss/episode/17489/shameless-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85-%D9%84%D8%A7%D9%88%D9%84/%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1"><img></a>"""
        val eps = Parse.episodes(html, "https://akwam.ss/series/1112/x", "akwam")
        assertEquals(listOf(1f, 2f), eps.map { it.number })
        assertEquals("الحلقة 1", eps[0].name)
    }

    @Test fun `quality tabs point at watch pages, highest first`() {
        val html = """
            <ul class="header-tabs"><li><a href="#tab-3">480p</a></li><li><a href="#tab-5" class="selected">1080p</a></li><li><a href="#tab-4">720p</a></li></ul>
            <div class="tab-content quality" id="tab-5"><a href="https://akwam.ss/watch/101/4819/dune" class="link-btn link-show">مشاهدة</a><a href="https://akwam.ss/download/101/4819/dune" class="link-download">تحميل</a></div>
            <div class="tab-content quality" id="tab-4"><a href="https://akwam.ss/watch/102/4819/dune" class="link-btn link-show">مشاهدة</a></div>
            <div class="tab-content quality" id="tab-3"><a href="https://akwam.ss/watch/103/4819/dune" class="link-btn link-show">مشاهدة</a></div>"""
        val tabs = Parse.tabs(html, "https://akwam.ss/movie/4819/dune")
        assertEquals(listOf(1080, 720, 480), tabs.map { it.quality })
        assertEquals("https://akwam.ss/watch/101/4819/dune", tabs[0].watch)
    }

    @Test fun `watch page gives direct files by size`() {
        val html = """
            <video id="player" controls>
              <source
                  src="https://s302d6.downet.net/download/1791103374/abc/Dune.2021.720p.Bluray.AKWAM.mp4"
                  type="video/mp4"
                  size="720"
              />
              <source src="https://s301d4.downet.net/download/1791103374/def/Dune.2021.1080p.Bluray.AKWAM.mp4" type="video/mp4" size="1080"/>
            </video>"""
        val files = Parse.sources(html, "https://akwam.ss/watch/101/4819/dune")
        assertEquals(listOf(1080, 720), files.map { it.quality })
        assertEquals("https://s301d4.downet.net/download/1791103374/def/Dune.2021.1080p.Bluray.AKWAM.mp4", files[0].url)
    }
}
