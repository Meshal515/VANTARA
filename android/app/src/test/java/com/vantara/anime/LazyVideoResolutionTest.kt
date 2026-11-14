package com.vantara.anime

import com.vantara.anime.adapters.ExtensionAdapter
import com.vantara.anime.adapters.SourceEpisode
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.animesource.model.Hoster
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Track
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import okhttp3.Headers
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class LazyVideoResolutionTest {
    private val episode = SourceEpisode("fixture", "/episode/1", "Episode 1", 1f)

    @Test fun `initialized video bypasses resolver`() = runBlocking {
        val source = object : VideoSource(listOf(Video(videoUrl = "https://cdn.test/direct.mp4", initialized = true))) {
            override suspend fun resolveVideo(video: Video): Video? = error("Already initialized")
        }

        assertEquals("https://cdn.test/direct.mp4", ExtensionAdapter("fixture", source).candidates(episode).single().url)
    }

    @Test fun `lazy nonblank URL resolves before candidate and preserves resolved metadata`() = runBlocking {
        val source = object : VideoSource(listOf(Video(videoUrl = "https://host.test/embed/1", internalData = "token-1"))) {
            override suspend fun resolveVideo(video: Video): Video {
                assertEquals("token-1", video.internalData)
                return Video(
                    videoUrl = "https://cdn.test/resolved.m3u8", videoTitle = "1080p", resolution = 1080,
                    headers = Headers.headersOf("Referer", "https://host.test/embed/1"),
                    subtitleTracks = listOf(Track("https://cdn.test/ar.vtt", "ar")),
                    audioTracks = listOf(Track("https://cdn.test/en.m4a", "en")), initialized = true,
                )
            }
        }

        val candidate = ExtensionAdapter("fixture", source).candidates(episode).single()
        assertEquals("https://cdn.test/resolved.m3u8", candidate.url)
        assertEquals(1080, candidate.quality)
        assertEquals("https://host.test/embed/1", candidate.headers["Referer"])
        assertEquals("https://cdn.test/ar.vtt", candidate.subtitles.single().url)
        assertEquals("https://cdn.test/en.m4a", candidate.audio.single().url)
    }

    @Test fun `blank lazy video resolves from internal data`() = runBlocking {
        val source = object : VideoSource(listOf(Video(internalData = "opaque-id"))) {
            override suspend fun resolveVideo(video: Video): Video {
                assertEquals("opaque-id", video.internalData)
                return Video(videoUrl = "https://cdn.test/from-id.mp4", initialized = true)
            }
        }

        assertEquals("https://cdn.test/from-id.mp4", ExtensionAdapter("fixture", source).candidates(episode).single().url)
    }

    @Suppress("DEPRECATION")
    @Test fun `legacy direct constructor remains playable with default identity resolver`() = runBlocking {
        val source = VideoSource(listOf(Video(
            url = "https://host.test/old", quality = "720p", videoUrl = "https://cdn.test/legacy.mp4",
            headers = Headers.headersOf("X-Legacy", "yes"),
        )))

        val candidate = ExtensionAdapter("fixture", source).candidates(episode).single()
        assertEquals("https://cdn.test/legacy.mp4", candidate.url)
        assertEquals("yes", candidate.headers["X-Legacy"])
        assertEquals(720, candidate.quality)
    }

    @Test fun `resolver result without initialized flag is consumed once without recursion`() = runBlocking {
        var resolutions = 0
        val source = object : VideoSource(listOf(Video(videoUrl = "https://host.test/embed/1"))) {
            override suspend fun resolveVideo(video: Video): Video {
                resolutions++
                check(resolutions == 1) { "Resolved result must not be resolved again" }
                return Video(videoUrl = "https://cdn.test/one-shot.mp4")
            }
        }

        assertEquals("https://cdn.test/one-shot.mp4", ExtensionAdapter("fixture", source).candidates(episode).single().url)
        assertEquals(1, resolutions)
    }

    @Test fun `failed and null resolutions drop only those videos without exposing placeholders`() = runBlocking {
        val source = object : VideoSource(listOf(
            Video(videoUrl = "https://host.test/fails"),
            Video(videoUrl = "https://host.test/null"),
            Video(videoUrl = "https://host.test/incompatible"),
            Video(videoUrl = "https://host.test/works"),
        )) {
            override suspend fun resolveVideo(video: Video): Video? = when (video.videoUrl) {
                "https://host.test/fails" -> throw IOException("Expired token")
                "https://host.test/null" -> null
                "https://host.test/incompatible" -> throw NoSuchMethodError("Extension API mismatch")
                else -> Video(videoUrl = "https://cdn.test/survivor.mp4", initialized = true)
            }
        }

        assertEquals(listOf("https://cdn.test/survivor.mp4"), ExtensionAdapter("fixture", source).candidates(episode).map { it.url })
    }

    @Test fun `resolver cancellation escapes video and hoster failure handling`() = runBlocking {
        val cancelled = CancellationException("Resolution cancelled")
        val source = object : VideoSource(listOf(Video(internalData = "cancel"))) {
            override suspend fun resolveVideo(video: Video): Video? = throw cancelled
        }

        try {
            ExtensionAdapter("fixture", source).candidates(episode)
            fail("Cancellation must reach the caller")
        } catch (actual: CancellationException) {
            assertEquals("Resolution cancelled", actual.message)
        }
    }

    @Test fun `incompatible hoster does not discard working hoster`() = runBlocking {
        val source = object : VideoSource(emptyList()) {
            override suspend fun getHosterList(episode: SEpisode) = listOf(
                Hoster(hosterName = "incompatible"),
                Hoster(hosterName = "working", videoList = listOf(Video(videoUrl = "https://cdn.test/working.mp4", initialized = true))),
            )
            override suspend fun getVideoList(hoster: Hoster): List<Video> = throw NoSuchMethodError("Extension API mismatch")
        }

        assertEquals(listOf("https://cdn.test/working.mp4"), ExtensionAdapter("fixture", source).candidates(episode).map { it.url })
    }

    @Test fun `video list cancellation escapes hoster failure handling`() = runBlocking {
        val cancelled = CancellationException("List cancelled")
        val source = object : VideoSource(emptyList()) {
            override suspend fun getHosterList(episode: SEpisode) = listOf(Hoster(hosterName = "fixture"))
            override suspend fun getVideoList(hoster: Hoster): List<Video> = throw cancelled
        }

        try {
            ExtensionAdapter("fixture", source).candidates(episode)
            fail("Cancellation must reach the caller")
        } catch (actual: CancellationException) {
            assertEquals("List cancelled", actual.message)
        }
    }

    /** Only source IO is replaced; candidate resolution and the SDK default resolver remain real. */
    private open class VideoSource(private val videos: List<Video>) : AnimeHttpSource() {
        override val name = "fixture"
        override val lang = "en"
        override val supportsLatest = false
        override val baseUrl = "https://source.test"
        override fun headersBuilder() = Headers.Builder()
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
