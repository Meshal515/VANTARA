package com.vantara.anime

import com.vantara.anime.adapters.ResolveTrace
import com.vantara.anime.adapters.ShahiidSiteAdapter
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.health.HealthStore
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.Sniffer
import com.vantara.anime.stream.*
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class RockResolutionTest {
    private fun client(body: (String) -> String) = OkHttpClient.Builder().addInterceptor { chain ->
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body(body(chain.request().url.toString()).toResponseBody("text/html".toMediaType())).build()
    }.build()

    @Test fun `explicit upstream deletion never enters the slow browser fallback`() = runBlocking {
        for ((host, body) in listOf(
            "mp4upload.com" to "File was deleted",
            "uqload.vc" to "<div>File is no longer available as it expired or has been deleted.</div>",
            "mxdrop.top" to "<div class='tb error'><p>We can't find the video you are looking for.</p></div>",
        )) {
            val sniffed = AtomicInteger()
            val resolver = EmbedResolver(client { body }, Sniffer { _, _ -> sniffed.incrementAndGet(); null })
            val error = runCatching { resolver.resolve("https://$host/embed/1", null) }.exceptionOrNull()
            assertNotNull("$host must report the upstream deletion", error)
            assertTrue(error!!.message.orEmpty(), error.message.orEmpty().contains("UPSTREAM_REMOVED"))
            assertEquals("$host must not wait for WebView", 0, sniffed.get())
        }
    }

    private fun candidate(id: String, q: Int) = Candidate(id, "shahiid", "Shahiid", "Megamax", "cdn.test", "https://cdn.test/$id.mp4", quality = q, variant = Variant.SUB, container = Container.MP4, resolvedAt = 1, expiresAt = Long.MAX_VALUE)

    @Test fun `each quality of one host is selectable without mixing its candidates`() {
        val health = HealthStore(null)
        val prep = PreparedEpisode("s", emptyList(), 1f, Preferences(1080, Variant.SUB), PlaybackSession(emptyList(), health), health)
        prep.report(RouteReport("shahiid", "one", "Megamax", null, Variant.SUB, RouteState.RESOLVING))
        prep.report(RouteReport("shahiid", "one", "Megamax", 1080, Variant.SUB, RouteState.READY, listOf(candidate("1080", 1080), candidate("480", 480))))
        val ready = prep.routes().filter { it.state == RouteState.READY }
        assertEquals(setOf(1080, 480), ready.map { it.quality }.toSet())
        for (route in ready) assertTrue(prep.candidatesOf(route.id).all { it.quality == route.quality })
    }

    @Test fun `Shahiid publishes the first MegaMax mirror before waiting for the others`() = runBlocking {
        val waiting = CompletableDeferred<Unit>()
        val ready = CompletableDeferred<List<Candidate>>()
        val dispatch = OkHttpClient.Builder().addInterceptor { chain ->
            val req = chain.request()
            val body = when {
                req.url.host == "slow.test" -> { runBlocking { waiting.await() }; "File was deleted" }
                req.header("X-Inertia") != null -> """{"props":{"streams":{"data":[{"label":"720p","mirrors":[{"driver":"earnvids","link":"https://fast.test/e/1"},{"driver":"mixdrop","link":"https://slow.test/e/1"}]}]}}}"""
                req.url.encodedPath.contains("admin-ajax") -> "<iframe src='https://share4max.net/iframe/x'></iframe>"
                req.url.host == "shahiid.test" -> "<a class='buttosn' data-post='1' data-serv='x' data-frameserver='x'>Megamax متعدد</a>"
                req.url.host == "share4max.net" -> """<script data-page>{"version":"v"}</script>"""
                else -> "<video src='https://cdn.test/720.mp4'></video>"
            }
            Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body.toResponseBody("text/html".toMediaType())).build()
        }.build()
        val adapter = ShahiidSiteAdapter("shahiid", "Shahiid", dispatch, { "https://shahiid.test" }, EmbedResolver(dispatch), serverTimeoutMs = 2000)
        val job = async { adapter.candidates(SourceEpisode("shahiid", "/ep/1", "1", 1f), trace = ResolveTrace { if (it.state == RouteState.READY) ready.complete(it.candidates) }) }
        try {
            assertTrue(withTimeout(500) { ready.await() }.isNotEmpty())
            assertFalse("other qualities continue in background", job.isCompleted)
        } finally { waiting.complete(Unit); job.await() }
    }
    @Test fun `maintained primary page resolution preserves Aniyomi as fallback on HTTP failure`() = runBlocking {
        val calls = AtomicInteger()
        val http = OkHttpClient.Builder().addInterceptor { throw java.io.IOException("page temporarily offline") }.build()
        val source = object : eu.kanade.tachiyomi.animesource.online.AnimeHttpSource() {
            override val name = "OkAnime"
            override val lang = "ar"
            override val supportsLatest = true
            override val baseUrl = "https://okanime.test"
            override val client = http
            override fun headersBuilder() = Headers.Builder()
            override fun popularAnimeRequest(page: Int) = Request.Builder().url(baseUrl).build()
            override fun searchAnimeRequest(page: Int, query: String, filters: eu.kanade.tachiyomi.animesource.model.AnimeFilterList) = popularAnimeRequest(page)
            override fun latestUpdatesRequest(page: Int) = popularAnimeRequest(page)
            override fun popularAnimeParse(response: Response) = eu.kanade.tachiyomi.animesource.model.AnimesPage(emptyList(), false)
            override fun searchAnimeParse(response: Response) = popularAnimeParse(response)
            override fun latestUpdatesParse(response: Response) = popularAnimeParse(response)
            override fun animeDetailsParse(response: Response) = eu.kanade.tachiyomi.animesource.model.SAnime.create()
            override fun episodeListParse(response: Response) = emptyList<eu.kanade.tachiyomi.animesource.model.SEpisode>()
            override fun seasonListParse(response: Response) = emptyList<eu.kanade.tachiyomi.animesource.model.SAnime>()
            override fun hosterListParse(response: Response) = emptyList<eu.kanade.tachiyomi.animesource.model.Hoster>()
            override suspend fun getHosterList(episode: eu.kanade.tachiyomi.animesource.model.SEpisode): List<eu.kanade.tachiyomi.animesource.model.Hoster> {
                calls.incrementAndGet()
                return listOf(eu.kanade.tachiyomi.animesource.model.Hoster(hosterName = "Aniyomi", videoList = listOf(eu.kanade.tachiyomi.animesource.model.Video("https://cdn.test/720.mp4", "720p", 720))))
            }
        }
        val adapter = com.vantara.anime.adapters.ExtensionAdapter("okanime", source,
            pageEmbeds = { com.vantara.anime.registry.PageEmbeds("iframe", "src", primary = true) }, resolver = EmbedResolver(http))
        val got = adapter.candidates(SourceEpisode("okanime", "/episode/1", "1", 1f))
        assertEquals(1, calls.get())
        assertEquals("https://cdn.test/720.mp4", got.single().url)
    }

}
