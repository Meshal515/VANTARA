package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.ResolveTrace
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.adapters.SourcePage
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.Generic
import com.vantara.anime.hosts.GoogleDrive
import com.vantara.anime.hosts.Packer
import com.vantara.anime.hosts.Vk
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.Preferences
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketException

/** صفحات مشغّلات حقيقية (2026-09-25) من سيرفرات OkAnime وWitAnime ومرايا megamax. */
class HostsTest {

    private fun fixture(name: String) = javaClass.getResource("/anime/embeds/$name")!!.readText()

    // ── الاستخراج العام ──

    @Test fun `packed players are unpacked to their HLS playlist`() {
        for ((file, host) in listOf("streamruby.html" to "streamruby.net", "earnvids.html" to "dramiyos-cdn.com", "lulustream.html" to "tnmr.org")) {
            val html = fixture(file)
            assertTrue(file, Packer.unpackAll(html).isNotEmpty())
            val found = Generic.streams(html, "https://example.test/e/x")
            assertTrue("$file → $found", found.first().contains(host) && found.first().contains("master.m3u8"))
        }
    }

    @Test fun `mp4upload's plain player source is found, not its own hostname`() {
        val found = Generic.streams(fixture("mp4upload.html"), "https://www.mp4upload.com/embed-or3d079vy3pq.html")
        assertEquals(1, found.size)
        assertTrue(found[0], found[0].startsWith("https://a4.mp4upload.com:183/d/") && found[0].endsWith("/video.mp4"))
    }

    @Test fun `mixdrop's protocol-relative file and krakenfiles' source element are found`() {
        val mix = Generic.streams(fixture("mixdrop.html"), "https://mxdrop.top/e/9w1048rdspe93w")
        assertTrue(mix.toString(), mix.first().startsWith("https://") && mix.first().contains(".mp4?"))
        val kraken = Generic.streams(fixture("krakenfiles.html"), "https://krakenfiles.com/embed-video/IC9bnLJ3Qz")
        assertTrue(kraken.toString(), kraken.first().startsWith("https://hs1.krakencloud.net/play/video/"))
    }

    @Test fun `page assets and ads are not taken for the video`() {
        val html = """<script src="https://x.test/player.js"></script><img src="https://x.test/poster.jpg">
            <a href="https://ads.test/ads/v.mp4">ad</a>"""
        assertTrue(Generic.streams(html, "https://x.test/").isEmpty())
    }

    // ── معالجات خاصة ──

    @Test fun `a Google Drive preview becomes its confirmed download, known to be mp4`() {
        val s = GoogleDrive.stream("https://drive.google.com/file/d/1kesfvU2jTMUD44X8kjAELbx-xj3fVu1q/preview", "UA")!!
        assertEquals("https://drive.usercontent.google.com/download?id=1kesfvU2jTMUD44X8kjAELbx-xj3fVu1q&export=download&confirm=t", s.url)
        assertEquals(Container.MP4, s.container)
    }

    @Test fun `vk pages give their files and HLS`() {
        val html = """var playerParams = {"url480":"https:\/\/vkvd1.okcdn.ru\/?id=480","url720":"https:\/\/vkvd1.okcdn.ru\/?id=720","hls":"https:\/\/vkvd1.okcdn.ru\/video.m3u8?id=1"}"""
        val s = Vk.parse(html, emptyMap())
        assertEquals(listOf(null, 720, 480), s.map { it.quality })
        assertEquals(Container.HLS, s[0].container)
    }

    private fun fakeWeb(routes: Map<String, Pair<Int, String>>, seen: MutableList<Request> = mutableListOf()): OkHttpClient =
        OkHttpClient.Builder().addInterceptor { chain ->
            val r = chain.request()
            seen += r
            val key = r.url.host + r.url.encodedPath
            val (code, body) = routes[key] ?: (404 to "")
            Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(code).message("x")
                .body(body.toResponseBody("text/html".toMediaType())).build()
        }.build()

    @Test fun `megamax expands to its mirrors and the first extractable one plays with its own Referer`() = runBlocking {
        val seen = mutableListOf<Request>()
        val web = fakeWeb(
            mapOf(
                "share4max.com/iframe/nRcSlqx5tF9nn" to (200 to fixture("megamax.html")),
                "mp4upload.com/embed-khkthjiwfdch.html" to (200 to fixture("mp4upload.html")),
            ),
            seen,
        )
        // الطلب الثاني لنفس الصفحة (Inertia) يعيد JSON المرايا؛ يسبق الموقع الوهمي
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val r = chain.request()
            if (r.header("X-Inertia") == "true") {
                seen += r
                Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .body(fixture("megamax-streams.json").toResponseBody("application/json".toMediaType())).build()
            } else chain.proceed(r)
        }.apply { web.interceptors.forEach { addInterceptor(it) } }.build()
        val streams = EmbedResolver(client, sniffer = null, userAgent = { "UA" })
            .resolve("https://share4max.com/iframe/nRcSlqx5tF9nn", "https://ww3.okanime.xyz/episode/x")
        assertTrue(streams.toString(), streams.isNotEmpty())
        val s = streams.first()
        assertTrue(s.url, s.url.contains("mp4upload.com:183"))
        assertEquals("https://mp4upload.com/", s.headers["Referer"])
        assertEquals(720, s.quality)
        assertTrue(seen.any { it.header("X-Inertia-Version") == "a601a2d0d16b8ae7121ceb1fd46c1f5a" })
    }

    @Test fun `a page the extractor cannot read falls back to the sniffer`() = runBlocking {
        val web = fakeWeb(mapOf("uqload.is/embed-x.html" to (403 to "<title>Just a moment...</title>")))
        var sniffed: String? = null
        val resolver = EmbedResolver(web, sniffer = { url, _ -> sniffed = url; com.vantara.anime.hosts.Stream("https://cdn.test/v.mp4") })
        val s = resolver.resolve("https://uqload.is/embed-x.html", null)
        assertEquals("https://uqload.is/embed-x.html", sniffed)
        assertEquals("https://cdn.test/v.mp4", s.single().url)
    }

    // ── بداية سريعة وتنوّع ──

    private class Servers(override val id: String, val perServer: List<Pair<String, Long>>) : AnimeAdapter {
        override val name = id
        var resolved = 0
        override suspend fun page(listing: Listing, page: Int, query: String) = SourcePage(emptyList(), false)
        override suspend fun details(anime: SourceAnime) = anime
        override suspend fun seasons(anime: SourceAnime) = emptyList<SourceAnime>()
        override suspend fun episodes(anime: SourceAnime) = listOf(SourceEpisode(id, "/e/1", "1", 1f))
        override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> =
            com.vantara.anime.adapters.gatherUntil(
                perServer.map { (host, ms) ->
                    suspend {
                        delay(ms)
                        resolved++
                        listOf(Candidate("$id|$host", id, id, host, host, "https://$host/v.m3u8", resolvedAt = now, expiresAt = Long.MAX_VALUE))
                    }
                },
                enough,
            )
    }

    @Test fun `playback starts once two hosts are ready, without waiting for the slowest`() = runBlocking {
        val a = Servers("src", listOf("fast1.test" to 10L, "fast2.test" to 20L, "slow.test" to 5_000L))
        val started = System.currentTimeMillis()
        val list = EpisodeResolver({ a }, HealthStore(null)).candidates(
            listOf(EpisodeResolver.Copy("src", SourceAnime("src", "/a", "A"))), 1f, Preferences(),
        )
        assertEquals(setOf("fast1.test", "fast2.test"), list.map { it.host }.toSet())
        assertTrue(System.currentTimeMillis() - started < 3_000)
    }

    @Test fun `three links on one host are not two paths, so the next source is asked`() = runBlocking {
        val one = Servers("one", listOf("same.test" to 1L))
        val two = Servers("two", emptyList())
        val oneMore = object : AnimeAdapter by one {
            override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) =
                (1..3).map { Candidate("one|$it", "one", "one", "q$it", "same.test", "https://same.test/$it.m3u8", resolvedAt = now, expiresAt = Long.MAX_VALUE) }
        }
        val adapters = mapOf("one" to oneMore, "two" to two, "three" to Servers("three", listOf("other.test" to 1L)))
        val list = EpisodeResolver({ adapters[it] }, HealthStore(null), priorityOf = { mapOf("one" to 3, "two" to 2, "three" to 1)[it] ?: 0 })
            .candidates(adapters.keys.map { EpisodeResolver.Copy(it, SourceAnime(it, "/a", "A")) }, 1f, Preferences())
        assertTrue(list.map { it.host }.toSet().containsAll(setOf("same.test", "other.test")))
    }

    // ── تجزئة SNI لمضيفات الفيديو ──

    @Test fun `a video host whose handshake is reset is retried through fragmentation too`() {
        var viaFragment = 0
        AnimeHostRouter.fragmentClient = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain -> viaFragment++; Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").build() }
            .build()
        val client = OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { throw SocketException("Connection reset") }
            .build()
        val r = client.newCall(Request.Builder().url("https://cdn-not-a-source.test/v.m3u8").build()).execute()
        assertEquals(200, r.code)
        assertEquals(1, viaFragment)
        AnimeHostRouter.fragmentClient = null
    }
}
