package com.vantara.addons

import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class RemoteAddonTest {
    @Test fun `public addon policy rejects credentials private IP and unsafe scheme`() {
        for (u in listOf("http://addon.test/x", "https://localhost/x", "https://127.0.0.1/x", "https://user@addon.test/x", "https://addon.local/x")) assertTrue(runCatching { RemoteAddonClient.publicUrl(u) }.isFailure)
        assertEquals("addon.test", RemoteAddonClient.publicUrl("https://addon.test/config/manifest.json").host)
    }
    @Test fun `DNS guard preserves both working address families but rejects private answers`() {
        val addresses = listOf(InetAddress.getByName("2606:4700::1111"), InetAddress.getByName("104.21.1.1"))
        assertEquals(addresses, RemoteAddonClient.publicAddresses(addresses))
        assertTrue(runCatching { RemoteAddonClient.publicAddresses(listOf(InetAddress.getByName("10.1.2.3"))) }.isFailure)
        assertTrue(runCatching { RemoteAddonClient.publicAddresses(listOf(InetAddress.getByName("fd00::1"))) }.isFailure)
    }
    @Test fun `bounded GET does not follow redirect or send identity credentials`() {
        var request: Request? = null
        val base = OkHttpClient.Builder().addInterceptor { chain ->
            request = chain.request()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{}".toResponseBody()).build()
        }.build()
        val client = RemoteAddonClient(base)
        assertEquals("{}", client.request("https://addon.test/token/manifest.json", "one"))
        assertNull(request!!.header("Authorization")); assertNull(request!!.header("Cookie"))
        assertTrue(runCatching { client.request("https://addon.test/api", "two", limit = 1) }.isFailure)
    }
    @Test fun `subtitle identity uses season and episode and never guesses from title`() {
        assertEquals("tt1196946:1:1", SubtitleProviders.videoId("""{"kind":"series","externalIds":{"imdb":"tt1196946"},"season":1}""", 1f)?.second)
        assertNull(SubtitleProviders.videoId("""{"kind":"anime","title":"Mentalist"}""", 1f))
        assertNull(SubtitleProviders.videoId("""{"kind":"series","externalIds":{"imdb":"tt1"}}""", 1f))
    }
    @Test fun `late subtitle results cannot cross a server or episode boundary`() {
        val session = SubtitleSession()
        val old = session.begin()
        val current = session.begin()
        val track = AddonSubtitle("ar", "provider", "ar", "https://addon.test/sub.srt")
        assertFalse(session.accept(old, listOf(track)))
        assertTrue(session.tracks.isEmpty())
        assertTrue(session.accept(current, listOf(track)))
        assertEquals(listOf(track), session.tracks)
        session.begin()
        assertTrue(session.tracks.isEmpty())
        assertFalse(session.accept(current, listOf(track)))
        val generation = session.generation
        val firstChoice = session.select()
        val secondChoice = session.select()
        assertFalse(session.current(generation, firstChoice))
        assertTrue(session.current(generation, secondChoice))
    }
    @Test fun `cancel before native IO starts prevents the pending request`() {
        var reached = false
        val client = RemoteAddonClient(OkHttpClient.Builder().addInterceptor { chain ->
            reached = true
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{}".toResponseBody()).build()
        }.build())
        client.cancel("pending")
        assertTrue(runCatching { client.request("https://addon.test/api", "pending") }.isFailure)
        assertFalse(reached)
    }

    @Test fun `native subtitle lookup includes selected release and preserves configured base query`() {
        var path: String? = null
        var query: String? = null
        val client = RemoteAddonClient(OkHttpClient.Builder().addInterceptor { chain ->
            path = chain.request().url.encodedPath
            query = chain.request().url.query
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{\"subtitles\":[]}".toResponseBody()).build()
        }.build())
        val stream = com.vantara.anime.stream.Candidate("id", "addon|one", "One", "One", "video.test", "https://video.test/file.mp4", resolvedAt = 0, expiresAt = 1000,
            filename = "Series S01E01 2160p.mkv", videoHash = "abcdef", videoSize = 123456)
        SubtitleProviders.discover(client, AddonSubtitleProvider("key", "Sub", "https://addon.test/config/manifest.json?token=private"),
            """{"kind":"series","externalIds":{"imdb":"tt1196946"},"season":1}""", 1f, "request", stream)
        assertTrue(path!!.contains("tt1196946%3A1%3A1/filename=Series+S01E01+2160p.mkv&videoHash=abcdef&videoSize=123456.json"))
        assertEquals("token=private", query)
    }

    @Test fun `Kitsu mapped anime subtitle identity is episode exact with no guessed IMDb season`() {
        assertEquals("series" to "kitsu:1234:9", SubtitleProviders.videoId("""{"kind":"anime","externalIds":{"kitsu":"1234","anilist":"999"}}""", 9f))
        assertNull(SubtitleProviders.videoId("""{"kind":"movie","externalIds":{"kitsu":"1234"}}""", 9f))
        assertNull(SubtitleProviders.videoId("""{"kind":"anime","externalIds":{"kitsu":"title guessed"}}""", 9f))
        assertNull(SubtitleProviders.videoId("""{"kind":"anime","externalIds":{"kitsu":"1234"}}""", 9.5f))
    }

    @org.junit.Test fun `anime movie subtitle identity is not mistaken for an episode`() {
        org.junit.Assert.assertEquals("movie" to "kitsu:142", SubtitleProviders.videoId("""{"kind":"anime","format":"MOVIE","externalIds":{"kitsu":"142"}}""", 1f))
    }
    @org.junit.Test fun `IMDb anime movie subtitle fallback remains a movie without a season`() {
        org.junit.Assert.assertEquals("movie" to "tt123456", SubtitleProviders.videoId("""{"kind":"anime","format":"MOVIE","externalIds":{"imdb":"tt123456"}}""", 1f))
    }

    // ترجمات الأنمي كالمسلسلات: خريطة ani.zip ترسل الحلقة بموسم TVDB ورقمها فيه، لا برقمها داخل عمل AniList
    @Test fun `anime subtitle ids follow the ani zip episode map like series`() {
        val mushoku = """{"kind":"anime","format":"TV","externalIds":{"anilist":166873,"imdb":"tt13293588"},"season":2,"imdbEpisodes":{"1":[2,13,38],"2":[2,14,39]}}"""
        assertEquals(listOf("series" to "tt13293588:2:13", "series" to "tt13293588:1:38"), SubtitleProviders.videoIds(mushoku, 1f))
        // الحلقة التالية داخل المشغّل وحلقة لم تصل الخريطة بعد (أنمي يُعرض الآن)
        assertEquals("series" to "tt13293588:2:14", SubtitleProviders.videoId(mushoku, 2f))
        assertEquals("series" to "tt13293588:2:16", SubtitleProviders.videoId(mushoku, 4f))
        val onePiece = """{"kind":"anime","externalIds":{"kitsu":"12","imdb":"tt0388629"},"imdbEpisodes":{"62":[5,2,62]}}"""
        assertEquals(listOf("series" to "kitsu:12:62", "series" to "tt0388629:5:2", "series" to "tt0388629:1:62"), SubtitleProviders.videoIds(onePiece, 62f))
        // بلا خريطة: الموسم كما في المسلسل
        assertEquals("series" to "tt5607616:4:1", SubtitleProviders.videoId("""{"kind":"anime","externalIds":{"imdb":"tt5607616"},"season":4}""", 1f))
    }
    @Test fun `subtitle provider falls through to the next id when one returns nothing`() {
        val paths = mutableListOf<String>()
        val client = RemoteAddonClient(OkHttpClient.Builder().addInterceptor { chain ->
            val path = chain.request().url.encodedPath
            paths += path
            val body = if (path.contains("tt0388629%3A1%3A62")) "{\"subtitles\":[{\"url\":\"https://subs.test/a.srt\",\"lang\":\"ara\"}]}" else "{\"subtitles\":[]}"
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body.toResponseBody()).build()
        }.build())
        val provider = AddonSubtitleProvider("os", "OpenSubtitles", "https://addon.test/manifest.json", listOf("movie", "series"), listOf("tt"))
        val tracks = SubtitleProviders.discover(client, provider, """{"kind":"anime","externalIds":{"kitsu":"12","imdb":"tt0388629"},"imdbEpisodes":{"62":[5,2,62]}}""", 62f, "r")
        assertEquals(listOf("ar"), tracks.map { it.lang })
        assertEquals(2, paths.size)
        assertTrue(paths[0].contains("tt0388629%3A5%3A2"))
    }
}
