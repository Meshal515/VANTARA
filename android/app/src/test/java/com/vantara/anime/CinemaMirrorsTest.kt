package com.vantara.anime

import com.vantara.anime.adapters.*
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.stream.RouteState
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class CinemaMirrorsTest {
    @Test fun wrapperOffersIndependentLuluAndEarnRoutesWithoutTorrentMirror() = runBlocking {
        val iframe = "https://megatuktuk.store/iframe/test"
        val crypt = java.util.Base64.getEncoder().encodeToString(iframe.toByteArray())
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            val body = when {
                request.url.host == "tuktukhd.com" -> "<iframe id='main-video-frame' data-crypt='$crypt'></iframe>"
                request.url.host == "megatuktuk.store" && request.header("X-Inertia") == null -> """<script data-page>{"version":"test"}</script>"""
                request.url.host == "megatuktuk.store" -> """{"props":{"streams":{"data":[{"label":"1080p","mirrors":[{"driver":"earnvids","link":"https://morencius.com/v/test"},{"driver":"lulustream","link":"https://lulustream.com/e/test"},{"driver":"streamp2p","link":"https://torrent.test/watch"}]}]}}}"""
                else -> "<script>var sources = [{file:'https://media.test/${request.url.host}.m3u8'}];</script>"
            }
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body.toResponseBody("text/html".toMediaType())).build()
        }.build()
        val adapter = TuktukSiteAdapter("cinema-tuktuk", "Tuktuk", client, { "https://tuktukhd.com" }, EmbedResolver(client))
        val routes = java.util.concurrent.ConcurrentLinkedQueue<com.vantara.anime.stream.RouteReport>()
        val trace = ResolveTrace { routes += it }
        val candidates = adapter.candidates(SourceEpisode("cinema-tuktuk", "/runner/", "مشاهدة", 1f), trace = trace)
        assertEquals(setOf("earnvids", "lulustream"), candidates.map { it.server }.toSet())
        assertEquals(2, candidates.size)
        assertTrue(candidates.all { it.quality == 1080 })
        assertTrue(candidates.all { it.headers["Referer"]?.startsWith("https://${if (it.server == "earnvids") "morencius.com" else "lulustream.com"}") == true })
        assertEquals(2, routes.count { it.state == RouteState.READY })
        assertFalse(candidates.any { it.url.contains("torrent") })
    }
}
