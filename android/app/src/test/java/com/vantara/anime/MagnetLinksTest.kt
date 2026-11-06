package com.vantara.anime

import com.vantara.anime.adapters.ExtensionAdapter
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.stream.MagnetLinks
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.Hoster
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import kotlinx.coroutines.runBlocking
import okhttp3.Headers
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.*
import org.junit.Test

/**
 * إضافة Torrentio Anime في Aniyomi (بلا debrid) تعطي magnet بصيغة Aniyomi:
 * `magnet:?xt=urn:btih:<hash>&dn=<hash>&tr=…&index=<fileIdx>`. كان فانتارا يرفضها «رابط غير قابل للتشغيل (magnet)».
 */
class MagnetLinksTest {
    private val hash = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    private fun aniyomi(index: String) =
        "magnet:?xt=urn:btih:$hash&dn=$hash&tr=http://nyaa.tracker.wf:7777/announce&tr=udp://tracker.opentrackr.org:1337/announce&index=$index"

    @Test fun `aniyomi magnet keeps the exact episode file and its trackers`() {
        val request = requireNotNull(MagnetLinks.request(aniyomi("3")))
        assertEquals(hash.lowercase(), request.infoHash)
        assertEquals(3, request.fileIdx)
        assertTrue(request.trackers.contains("http://nyaa.tracker.wf:7777/announce"))
        assertTrue(request.trackers.contains("udp://tracker.opentrackr.org:1337/announce"))
    }

    @Test fun `index null from the extension means the largest file`() {
        assertNull(requireNotNull(MagnetLinks.request(aniyomi("null"))).fileIdx)
        assertNull(requireNotNull(MagnetLinks.request("magnet:?xt=urn:btih:$hash")).fileIdx)
    }

    @Test fun `malformed or ambiguous magnets are refused, not guessed`() {
        assertNull(MagnetLinks.request("magnet:?dn=only-a-name"))
        assertNull(MagnetLinks.request("magnet:?xt=urn:btih:$hash&xt=urn:btih:${"1".repeat(40)}"))
        assertNull(MagnetLinks.request("magnet:?xt=urn:btih:not-a-hash"))
        assertNull(MagnetLinks.request("https://cdn.test/video.mp4"))
    }

    @Test fun `aniyomi adapter now hands the magnet on as a torrent candidate`() = runBlocking {
        val title = "[NyaaSi] 1080p\nBlack Lagoon - 01 [1080p].mkv\n👤 39 💾 1.7 GB ⚙️ NyaaSi"
        @Suppress("DEPRECATION")
        val source = MagnetSource(listOf(Video(aniyomi("0"), title, aniyomi("0"))))
        val candidate = ExtensionAdapter("torrentio-anime", source).candidates(SourceEpisode("torrentio-anime", "/ep/1", "Episode 1", 1f)).single()
        assertTrue(MagnetLinks.isMagnet(candidate.url))
        assertEquals("torrent", candidate.host)
        assertEquals(1080, candidate.quality)
        assertTrue(candidate.headers.isEmpty())
    }

    private class MagnetSource(private val videos: List<Video>) : AnimeHttpSource() {
        override val name = "Torrentio Anime"
        override val lang = "all"
        override val supportsLatest = false
        override val baseUrl = "https://torrentio.test"
        override fun headersBuilder() = Headers.Builder().add("User-Agent", "fixture")
        override suspend fun getHosterList(episode: SEpisode) = listOf(Hoster(hosterName = name, videoList = videos))
        override fun popularAnimeRequest(page: Int): Request = error("No catalogue IO expected")
        override fun searchAnimeRequest(page: Int, query: String, filters: AnimeFilterList): Request = error("No catalogue IO expected")
        override fun latestUpdatesRequest(page: Int): Request = error("No catalogue IO expected")
        override fun popularAnimeParse(response: Response) = AnimesPage(emptyList(), false)
        override fun searchAnimeParse(response: Response) = popularAnimeParse(response)
        override fun latestUpdatesParse(response: Response) = popularAnimeParse(response)
        override fun animeDetailsParse(response: Response) = SAnime.create()
        override fun episodeListParse(response: Response) = emptyList<SEpisode>()
        override fun seasonListParse(response: Response) = emptyList<SAnime>()
        override fun hosterListParse(response: Response) = emptyList<Hoster>()
    }
}
