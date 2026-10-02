package com.vantara.anime

import com.vantara.anime.adapters.ArabSeedSiteAdapter
import com.vantara.anime.adapters.ArabSeedSiteAdapter.Parse
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.Sniffer
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** أجزاء مطابقة لصفحات m.myseed.pics الحقيقية (فحص 2026-10-02). */
class ArabSeedSiteTest {

    private val searchHtml = """
        <ul class="blocks__ul">
        <li><div class="item__contents "><a href="https://m.myseed.pics/%d9%81%d9%8a%d9%84%d9%85-toy-story-5-2026-%d9%85%d8%aa%d8%b1%d8%ac%d9%85/" title="فيلم Toy Story 5 2026 مترجم" class="movie__block"><div class="post__image"><img data-src="https://m.myseed.pics/wp-content/uploads/2026/09/ts5-300x450.webp" class="images__loader"></div></a></div></li>
        <li><div class="item__contents "><a href="https://m.myseed.pics/x-the-gentlemen-s2-eps8/" title="مسلسل The Gentlemen الموسم الثاني الحلقة 8 الثامنة والاخيرة مترجمة" class="movie__block"><img data-src="https://m.myseed.pics/g8.webp"></a></div></li>
        <li><div class="item__contents "><a href="https://m.myseed.pics/x-the-gentlemen-s2-eps7/" title="مسلسل The Gentlemen الموسم الثاني الحلقة 7 السابعة مترجمة" class="movie__block"><img data-src="https://m.myseed.pics/g7.webp"></a></div></li>
        <li><div class="item__contents "><a href="https://m.myseed.pics/x-the-gentlemen-8/" title="مسلسل The Gentlemen الموسم الاول الحلقة 8 الثامنة والاخيرة مترجمة" class="movie__block"><img data-src="https://m.myseed.pics/g18.webp"></a></div></li>
        </ul>
    """

    private val watchHtml = """
        <script>var main__obj = {'home__url': 'https://m.myseed.pics/','csrf__token': "7a00e16c31"};</script>
        <ul class="qualities__list">
          <li class="active" data-title="سيرفرات المشاهدة 480p" data-quality="480">480</li>
          <li class="" data-title="سيرفرات المشاهدة 720p" data-quality="720">720</li>
          <li class="" data-title="سيرفرات المشاهدة 1080p" data-quality="1080">1080</li>
        </ul>
        <ul>
        <li data-post="851554" data-server="0" data-qu="480" data-link="/vids.php?t=aaa480" data-server-name="سيرفر ماي سيد المباشر" data-direct-arabseed="1" data-file-size="628.05 MB" class="active"></li>
        <li data-post="851554" data-server="1" data-qu="480" data-link="https://m.myseed.pics/vid/?id=aHR0cHM6Ly92aWRhcmEudG8vZS9PSjRJWnp4WEJOQkhs" data-server-name="سيرفر 1" data-direct-arabseed="0"></li>
        </ul>
        <iframe id="video_frame" src="/vids.php?t=aaa480"></iframe>
    """

    private fun qualityJson(q: Int) = """{"type":"success","html":"<li data-post=\"851554\" data-server=\"0\" data-qu=\"$q\" data-server-name=\"سيرفر ماي سيد المباشر\" data-direct-arabseed=\"1\" class=\"active\"><\/li><li data-post=\"851554\" data-server=\"1\" data-qu=\"$q\" data-server-name=\"سيرفر 1\" data-direct-arabseed=\"0\" class=\"\"><\/li>","server":"\/vids.php?t=bbb$q"}"""

    private val episodeHtml = """
        <div id="seasons__list"><ul><li data-term="401752"><span>الموسم الاول</span></li><li class="selected" data-term="559524"><span>الموسم الثاني</span></li></ul></div>
        <ul class="episodes__list boxs__wrapper">
          <li><a href="https://m.myseed.pics/x-the-gentlemen-s2-eps8/"><div class="epi__num">الحلقة<b>8</b></div></a></li>
          <li><a href="https://m.myseed.pics/x-the-gentlemen-s2-eps2/"><div class="epi__num">الحلقة<b>2</b></div></a></li>
          <li><a href="https://m.myseed.pics/x-the-gentlemen-s2-eps1/"><div class="epi__num">الحلقة<b>1</b></div></a></li>
        </ul>
    """

    @Test fun `search keeps movies and folds a season's episode posts into one work`() {
        val items = Parse.search(searchHtml, "arabseed")
        assertEquals(listOf("فيلم Toy Story 5 2026 مترجم", "مسلسل The Gentlemen الموسم الثاني", "مسلسل The Gentlemen الموسم الاول"), items.map { it.title })
        assertEquals("/x-the-gentlemen-s2-eps8/", items[1].url)
        assertEquals("https://m.myseed.pics/wp-content/uploads/2026/09/ts5-300x450.webp", items[0].thumbnail)
    }

    @Test fun `a season's episodes come from any of its episode pages, in order`() {
        val eps = Parse.episodes(episodeHtml, "https://m.myseed.pics/x-the-gentlemen-s2-eps8/", "arabseed")
        assertEquals(listOf(1f, 2f, 8f), eps.map { it.number })
        assertEquals("/x-the-gentlemen-s2-eps1/", eps[0].url)
    }

    @Test fun `the watch page gives the token, the post, every quality and the first servers`() {
        val w = Parse.watchPage(watchHtml)!!
        assertEquals("7a00e16c31", w.csrf)
        assertEquals("851554", w.postId)
        assertEquals(listOf(480, 720, 1080), w.qualities)
        assertEquals(480, w.activeQuality)
        assertEquals(listOf(true, false), w.servers.map { it.direct })
        assertEquals("/vids.php?t=aaa480", w.servers[0].link)
    }

    @Test fun `quality servers take the returned link for the active one only`() {
        val list = Parse.qualityServers(qualityJson(1080), 1080)
        assertEquals(listOf(1080, 1080), list.map { it.quality })
        assertEquals("/vids.php?t=bbb1080", list[0].link)
        assertNull(list[1].link)
    }

    @Test fun `base64 server links open the real player directly`() {
        assertEquals("https://vidara.to/e/OJ4IZzxXBNBHl", Parse.unwrap("https://m.myseed.pics/vid/?id=aHR0cHM6Ly92aWRhcmEudG8vZS9PSjRJWnp4WEJOQkhs"))
        assertEquals("https://m.myseed.pics/vids.php?t=1", Parse.unwrap("https://m.myseed.pics/vids.php?t=1"))
    }

    @Test fun `a movie resolves to direct files in every quality without a browser`() = runBlocking {
        val asked = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val r = chain.request()
            val url = r.url.toString()
            asked += "${r.method} ${r.url.encodedPath}"
            val body = when {
                r.url.encodedPath.endsWith("/watch/") -> watchHtml
                r.url.encodedPath == "/get__quality__servers/" -> {
                    val form = okio.Buffer().also { r.body!!.writeTo(it) }.readUtf8()
                    qualityJson(Regex("quality=(\\d+)").find(form)!!.groupValues[1].toInt())
                }
                r.url.encodedPath == "/vids.php" -> "<iframe src=\"https://d.myseed.tv/player-gateway.php?t=${r.url.queryParameter("t")}\"></iframe>"
                r.url.host == "d.myseed.tv" -> "<script>var f='https://cdn.makeup/d/${r.url.queryParameter("t")}/video.mp4';</script>"
                else -> "<html></html>"
            }
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(body.toResponseBody("text/html".toMediaType())).build()
        }.build()
        val adapter = ArabSeedSiteAdapter("arabseed", "ArabSeed", client, { "https://m.myseed.pics" },
            EmbedResolver(client, Sniffer { _, _ -> null }))
        val ep = adapter.episodes(SourceAnime("arabseed", "/toy-story-5/", "فيلم Toy Story 5 2026 مترجم")).single()
        val list = adapter.candidates(ep)
        val direct = list.filter { it.server == "MySeed" }
        assertEquals(setOf(480, 720, 1080), direct.map { it.quality }.toSet())
        assertTrue(direct.all { it.url.endsWith("/video.mp4") && it.headers["Referer"] == "https://d.myseed.tv/" })
        // صفحة المشاهدة مرة واحدة، وطلب سيرفرات لكل جودة غير الظاهرة فقط
        assertEquals(1, asked.count { it.endsWith("/watch/") })
        assertEquals(2, asked.count { it.contains("get__quality__servers") })
    }

    @Test fun `search asks the site's own find path`() = runBlocking {
        var seen = ""
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            seen = chain.request().url.toString()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                .body(searchHtml.toResponseBody("text/html".toMediaType())).build()
        }.build()
        val page = ArabSeedSiteAdapter("arabseed", "ArabSeed", client, { "https://m.myseed.pics" }, EmbedResolver(client, null))
            .page(Listing.SEARCH, 1, "toy story 5")
        assertEquals("https://m.myseed.pics/find/?word=toy%20story%205", seen)
        assertEquals(3, page.items.size)
    }
}
