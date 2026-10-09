package com.vantara.addons

import com.vantara.anime.stream.Container
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class NativeAddonCandidateTest {
    private fun parse(raw: String) = NativeAddonCandidates.parse("session", "addon|provider", "Provider", Json.parseToJsonElement(raw), 1000L)

    @Test fun `native HTTP preserves DASH headers subtitle and display provenance`() {
        val c = parse("""[{"id":"track", "status":"READY", "url":"https://video.example/movie.mpd", "type":"dash", "quality":2160, "name":"2160p", "headers":{"Referer":"https://source.example/","Authorization":"Bearer custom"},"subtitles":[{"url":"https://sub.example/ar.vtt","lang":"ar"}]}]""").single()
        assertEquals(Container.DASH, c.container)
        assertEquals(2160, c.quality)
        assertEquals("Provider", c.sourceName)
        assertEquals("Bearer custom", c.headers["Authorization"])
        assertEquals("ar", c.subtitles.single().lang)
        assertTrue(c.id.startsWith("session|addon|"))
    }
    @Test fun `malformed sibling cannot discard a good stream or smuggle local media`() {
        val c = parse("""[null,{}, {"url":"https://127.0.0.1/private.mp4"}, {"url":"https://user:secret@video.example/movie.mp4"}, {"url":"https://video.example/valid.mkv","status":"READY"}]""")
        assertEquals(1, c.size)
        assertEquals("https://video.example/valid.mkv", c.single().url)
    }
    @Test fun `unsupported and expired normalized results are not playback candidates`() {
        assertTrue(parse("""[{"url":"https://video.example/video.mp4","status":"UNSUPPORTED"},{"url":"https://video.example/old.mp4","expiresAt":500}]""").isEmpty())
    }
    @Test fun `response headers cannot become request headers`() {
        assertTrue(parse("""[{"url":"https://video.example/video.mp4","headers":{"Host":"localhost","X-Test":"bad\r\nInjected: value","Accept":"video/*"}}]""").isEmpty())
    }
    @Test fun `provider names cannot expose configured manifest secrets`() {
        val c = NativeAddonCandidates.parse("s", "addon|https://addon.example/private-token", "https://addon.example/private-token", Json.parseToJsonElement("""[{"url":"https://video.example/video.mp4"}]"""), 1000L).single()
        assertEquals("إضافة", c.sourceName)
        assertFalse(c.id.contains("private-token"))
    }
    @Test fun `native raw response transformations are refused but CORS hints are harmless`() {
        assertTrue(parse("""[{"url":"https://video.example/video.mp4","behaviorHints":{"proxyHeaders":{"response":{"Content-Encoding":"gzip"}}}}]""").isEmpty())
        assertEquals(1, parse("""[{"url":"https://video.example/video.mp4","behaviorHints":{"notWebReady":true,"proxyHeaders":{"response":{"Access-Control-Allow-Origin":"*"}}}}]""").size)
    }
    @Test fun `raw next episode retains matching metadata and merges real request headers`() {
        val c = parse("""[{"url":"https://video.example/video.mkv","name":"4k","headers":{"Accept":"video/*"},"behaviorHints":{"filename":"Show.S02E04.mkv","videoHash":"abcdef0123456789","videoSize":12345,"proxyHeaders":{"request":{"Referer":"https://source.example/"}}}}]""").single()
        assertEquals(2160, c.quality)
        assertEquals("Show.S02E04.mkv", c.filename)
        assertEquals("abcdef0123456789", c.videoHash)
        assertEquals(12345L, c.videoSize)
        assertEquals(2, c.headers.size)
    }

    @Test fun `normal infoHash Torrentio result with null magnet and fileIdx remains valid`() {
        val raw = Json.parseToJsonElement("""{"infoHash":"0123456789abcdef0123456789abcdef01234567","magnet":null,"fileIdx":null,"sources":[]}""").jsonObject
        val request = NativeAddonCandidates.torrentRequest(raw)
        assertNull(request.fileIdx)
        assertEquals("0123456789abcdef0123456789abcdef01234567", request.infoHash)
        assertEquals("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567", request.magnetUri())
    }
    @Test fun `invalid torrent file index never silently selects a different video`() {
        for (index in listOf("-1", "2147483648", "1.5", "\"2\"")) {
            val raw = Json.parseToJsonElement("""{"infoHash":"0123456789abcdef0123456789abcdef01234567","fileIdx":$index}""").jsonObject
            assertTrue(runCatching { NativeAddonCandidates.torrentRequest(raw) }.isFailure)
        }
    }

    @Test fun `native next episode magnet URL uses the same precise hash identity`() {
        val request = NativeAddonCandidates.torrentRequest(Json.parseToJsonElement("""{"url":"magnet:?xt=urn%3Abtih%3A0123456789abcdef0123456789abcdef01234567","fileIdx":3}""").jsonObject)
        assertEquals("0123456789abcdef0123456789abcdef01234567", request.infoHash)
        assertEquals(3, request.fileIdx)
    }

}
