package com.vantara.anime

import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.adapters.WitAnimeSiteAdapter
import com.vantara.anime.adapters.WitAnimeSiteAdapter.Parse
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.FourShared
import com.vantara.anime.hosts.OkRu
import com.vantara.anime.hosts.WebViewSniffer
import com.vantara.anime.stream.Variant
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** أجزاء مطابقة لصفحات witanime.site الحقيقية (فحص 2026-09-25). */
class WitAnimeSiteTest {

    private val searchHtml = """
        <a class="group block w-full cursor-pointer" href="https://witanime.site/anime/naruto-shippuden">
          <div class="relative mb-3"><img alt="Naruto Shippuden" src="https://images.witanime.site/posters/60ee.jpg"/>
          <div class="absolute end-2 top-2">TV</div></div>
          <h3 class="truncate font-semibold">Naruto Shippuden</h3>
        </a>
        <a class="group block" href="https://witanime.site/movie/boruto-naruto-the-movie">
          <img alt="Boruto: Naruto the Movie" src="https://images.witanime.site/posters/b0.jpg"/>
        </a>
        <a href="https://witanime.site/watch/naruto-shippuden/1"><img alt="x" src="/y.jpg"/>ep</a>
        <a href="https://witanime.site/browse">تصفّح</a>
        <a href="https://witanime.site/search?q=naruto&amp;page=2">2</a>
    """

    @Test fun `search cards give work paths, titles and posters, and nothing else`() {
        val cards = Parse.cards(searchHtml, "witanime")
        assertEquals(listOf("/anime/naruto-shippuden", "/movie/boruto-naruto-the-movie"), cards.map { it.url })
        assertEquals("Naruto Shippuden", cards[0].title)
        assertEquals("Boruto: Naruto the Movie", cards[1].title)
        assertEquals("https://images.witanime.site/posters/60ee.jpg", cards[0].thumbnail)
        assertTrue(Parse.hasPage(searchHtml, 2))
        assertFalse(Parse.hasPage(searchHtml, 3))
    }

    @Test fun `the sitemap becomes the full catalog with titles from slugs`() {
        val xml = """<urlset><url><loc>https://witanime.site/anime/one-piece-film-red</loc></url>
            <url><loc>https://witanime.site/anime/diamond-no-ace</loc></url>
            <url><loc>https://witanime.site/watch/diamond-no-ace/1</loc></url></urlset>"""
        val items = Parse.sitemap(xml, "witanime")
        assertEquals(listOf("/anime/one-piece-film-red", "/anime/diamond-no-ace"), items.map { it.url })
        assertEquals("One Piece Film Red", items[0].title)
    }

    @Test fun `episodes come from the work page in order, half episodes included`() {
        val html = """
            <a href="https://witanime.site/watch/one-piece/1">شاهد الآن</a>
            <a href="https://witanime.site/watch/one-piece/1141.5">1141.5</a>
            <a href="https://witanime.site/watch/one-piece/2">2</a>
            <a href="https://witanime.site/watch/one-piece/1">1</a>
            <a href="https://witanime.site/watch/one-piece-film-red/1">other work</a>"""
        val eps = Parse.episodes(html, "one-piece", "witanime")
        assertEquals(listOf(1f, 2f, 1141.5f), eps.map { it.number })
        assertEquals("/watch/one-piece/2", eps[1].url)
        assertEquals("الحلقة 1141.5", eps[2].name)
    }

    @Test fun `details read the title, poster and synopsis`() {
        val html = """<h1>One Piece</h1><img src="https://images.witanime.site/posters/96b6.jpg">
            <p class="mb-6 text-sm leading-relaxed">العظمة , المجد , الذهب</p>"""
        val d = Parse.details(html, SourceAnime("witanime", "/anime/one-piece", "One Piece"))
        assertEquals("https://images.witanime.site/posters/96b6.jpg", d.thumbnail)
        assertEquals("العظمة , المجد , الذهب", d.description)
    }

    @Test fun `servers are read best quality first and bad tokens are dropped`() {
        val t = "a".repeat(64)
        val body = """{"players":{"SD":[{"token":"${"c".repeat(64)}","label":"hgcloud","version":"sub","lang":"jp"}],
            "FHD":[{"token":"$t","label":"ok","version":"dub","lang":"jp"},{"token":"../evil","label":"x"}]},"downloads":{}}"""
        val s = Parse.servers(body)
        assertEquals(listOf("FHD" to "ok", "SD" to "hgcloud"), s.map { it.quality to it.label })
        assertEquals(1080, Parse.quality("FHD"))
        assertEquals("https://hgcloud.to/e/d3", Parse.metaRefresh("""<meta http-equiv="refresh" content="0;url='https://hgcloud.to/e/d3'" />"""))
    }

    // ── السيرفرات المضمّنة ──

    private val okHtml = """<div data-module="OKVideo" data-options="{&quot;flashvars&quot;:{&quot;metadata&quot;:&quot;{\&quot;videos\&quot;:[{\&quot;name\&quot;:\&quot;sd\&quot;,\&quot;url\&quot;:\&quot;https://vd1.okcdn.ru/?id=sd\&quot;},{\&quot;name\&quot;:\&quot;full\&quot;,\&quot;url\&quot;:\&quot;https://vd1.okcdn.ru/?id=full\&quot;}],\&quot;hlsManifestUrl\&quot;:\&quot;https://vd1.okcdn.ru/video.m3u8?id=1\&quot;}&quot;}}"></div>"""

    @Test fun `ok ru pages give the HLS manifest first, then files best quality first`() {
        val s = OkRu.parse(okHtml)
        assertEquals(listOf("https://vd1.okcdn.ru/video.m3u8?id=1", "https://vd1.okcdn.ru/?id=full", "https://vd1.okcdn.ru/?id=sd"), s.map { it.url })
        assertEquals(1080, s[1].quality)
        assertEquals("https://ok.ru/", s[0].headers["Referer"])
        assertTrue(OkRu.parse("<html></html>").isEmpty())
    }

    @Test fun `4shared pages give their video source`() {
        val s = FourShared.parse("""<video><source src="https://dc726.4shared.com/img/x/preview.mp4" type="video/mp4"></video>""")
        assertEquals(listOf("https://dc726.4shared.com/img/x/preview.mp4"), s.map { it.url })
    }

    @Test fun `the sniffer keeps playlists and files, not segments or page assets`() {
        assertTrue(WebViewSniffer.isMedia("https://cdn.x/hls/abc/master.m3u8?t=1"))
        assertTrue(WebViewSniffer.isMedia("https://cdn.x/v/file.mp4"))
        assertFalse(WebViewSniffer.isMedia("https://cdn.x/hls/abc/seg-1.ts"))
        assertFalse(WebViewSniffer.isMedia("https://cdn.x/main.js?v=1.1.9"))
    }

    // ── السلسلة كاملة: صفحة الحلقة ← السيرفرات ← البوابة ← ok.ru ──

    @Test fun `an episode resolves to playable links through the site's gate`() = runBlocking {
        val ok = "1".repeat(64)
        val mega = "2".repeat(64)
        val seen = mutableListOf<String>()
        var csrfSent: String? = null
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val r = chain.request()
            seen += "${r.method} ${r.url.encodedPath}"
            fun reply(code: Int, body: String, location: String? = null) = Response.Builder().request(r).protocol(Protocol.HTTP_1_1)
                .code(code).message("x").apply { location?.let { header("Location", it) } }
                .body(body.toResponseBody("text/html".toMediaType())).build()
            when {
                r.url.host == "ok.ru" -> reply(200, okHtml)
                r.url.encodedPath == "/watch/one-piece/1" -> reply(200, """<meta name="csrf-token" content="tok123">
                    <div x-data="watchPlayer({ sourcesUrl: '\/watch\/one-piece\/1\/sources', qualityOrder: []})"></div>""")
                r.url.encodedPath == "/watch/one-piece/1/sources" -> {
                    csrfSent = r.header("X-CSRF-TOKEN")
                    reply(200, """{"players":{"FHD":[{"token":"$ok","label":"ok","version":"sub","lang":"jp"},{"token":"$mega","label":"mega","version":"sub","lang":"jp"}]}}""")
                }
                r.url.encodedPath.startsWith("/watch/stream-source/") -> reply(200, """{"sandbox":false}""")
                r.url.encodedPath == "/watch/stream-gate/$ok" -> reply(302, "", "https://ok.ru/videoembed/16056762043078")
                else -> reply(404, "")
            }
        }.build()
        val adapter = WitAnimeSiteAdapter("witanime", "WitAnime", client, { "https://witanime.site" }, EmbedResolver(client))

        val c = adapter.candidates(SourceEpisode("witanime", "/watch/one-piece/1", "الحلقة 1", 1f), now = 0)

        assertEquals("tok123", csrfSent)
        assertEquals(3, c.size)
        assertTrue(c.all { it.server == "ok" && it.variant == Variant.SUB })
        assertEquals(1080, c.first { it.url.endsWith("id=full") }.quality)
        // mega لا يُطلب أصلًا: فيديوه مشفّر ولا نشغّله بعد
        assertTrue(seen.none { mega in it })
        // البوابة وحدها تكفي: stream-source يستهلك من حد الطلبات بلا فائدة
        assertTrue(seen.contains("GET /watch/stream-gate/$ok"))
        assertTrue(seen.none { it.contains("stream-source") })
    }

    @Test fun `the trace says why each server gave nothing`() = runBlocking {
        val hg = "3".repeat(64)
        val mega = "4".repeat(64)
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val r = chain.request()
            fun reply(code: Int, body: String) = Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(body.toResponseBody("text/html".toMediaType())).build()
            when {
                r.url.encodedPath == "/watch/x/1" -> reply(200, """<meta name="csrf-token" content="t">""")
                r.url.encodedPath == "/watch/x/1/sources" ->
                    reply(200, """{"players":{"FHD":[{"token":"$hg","label":"hgcloud"},{"token":"$mega","label":"mega"}]}}""")
                else -> reply(429, "")
            }
        }.build()
        val adapter = WitAnimeSiteAdapter("witanime", "WitAnime", client, { "https://witanime.site" }, EmbedResolver(client))
        val trace = com.vantara.anime.adapters.ResolveTrace()

        val c = adapter.candidates(SourceEpisode("witanime", "/watch/x/1", "الحلقة 1", 1f), now = 0, trace = trace)

        assertTrue(c.isEmpty())
        val notes = trace.notes().joinToString(" | ")
        assertTrue(notes, notes.contains("mega") && notes.contains("غير مدعوم"))
        assertTrue(notes, notes.contains("hgcloud FHD") && notes.contains("البوابة"))
    }

    @Test fun `a movie is one episode on its own watch path`() = runBlocking {
        val adapter = WitAnimeSiteAdapter("witanime", "WitAnime", OkHttpClient(), { "https://witanime.site" }, EmbedResolver(OkHttpClient()))
        val eps = adapter.episodes(SourceAnime("witanime", "/movie/one-piece-film-red", "One Piece Film Red"))
        assertEquals(listOf("/watch/movie/one-piece-film-red"), eps.map { it.url })
    }

    @Test fun `search asks the site's own search path`() = runBlocking {
        var asked: String? = null
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            asked = chain.request().url.toString()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(searchHtml.toResponseBody("text/html".toMediaType())).build()
        }.build()
        val adapter = WitAnimeSiteAdapter("witanime", "WitAnime", client, { "https://witanime.site" }, EmbedResolver(client))
        val p = adapter.page(Listing.SEARCH, 1, "one piece")
        assertEquals("https://witanime.site/search?q=one%20piece", asked)
        assertEquals(2, p.items.size)
        assertTrue(p.hasNext)
    }
}
