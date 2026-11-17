package com.vantara.downloads

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * تنزيل حقيقي عبر HTTP محلي: ملف كامل، انقطاع واستئناف من آخر بايت، رابط منتهٍ، مصدر يتجاهل Range،
 * صفحة HTML بدل فيديو، وHLS بمقاطعه وصوته وترجمته ومفتاح AES-128 — كلها تُكتب على قرص فعلي ثم تُفحص.
 */
class DownloadRunnerTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private val client = OkHttpClient()

    /** «MKV» بتوقيع EBML حقيقي وبايتات معروفة: نقارن الملف المحفوظ بها بايتًا ببايت. */
    private val video: ByteArray = ByteArray(3 * 1024 * 1024 + 123) { (it * 31 % 251).toByte() }.also {
        it[0] = 0x1A; it[1] = 0x45; it[2] = 0xDF.toByte(); it[3] = 0xA3.toByte()
    }
    private val served = AtomicInteger(0)
    @Volatile private var ignoreRange = false
    @Volatile private var expired = false
    @Volatile private var cutAfter = -1

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path ?: ""
                if (expired) return MockResponse().setResponseCode(403)
                return when {
                    path.startsWith("/video.mkv") -> rangeResponse(video, request.getHeader("Range"))
                    path.startsWith("/page") -> MockResponse().setHeader("Content-Type", "text/html").setBody("<!DOCTYPE html><html>nope</html>")
                    path == "/master.m3u8" -> MockResponse().setBody(
                        "#EXTM3U\n" +
                            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"ja\",NAME=\"Japanese\",DEFAULT=YES,URI=\"audio/ja.m3u8\"\n" +
                            "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",LANGUAGE=\"en\",NAME=\"English\",URI=\"audio/en.m3u8\"\n" +
                            "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"sub\",LANGUAGE=\"ar\",NAME=\"العربية\",URI=\"subs/ar.m3u8\"\n" +
                            "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720,CODECS=\"avc1.64001f,mp4a.40.2\",AUDIO=\"aud\",SUBTITLES=\"sub\"\n720/index.m3u8\n" +
                            "#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,CODECS=\"avc1.640028,mp4a.40.2\",AUDIO=\"aud\",SUBTITLES=\"sub\"\n1080/index.m3u8\n",
                    )
                    path.endsWith("index.m3u8") || path.endsWith("ja.m3u8") || path.endsWith("en.m3u8") || path.endsWith("ar.m3u8") -> MockResponse().setBody(media(path.substringBeforeLast('/')))
                    path.endsWith(".key") -> MockResponse().setBody(Buffer().write(ByteArray(16) { it.toByte() }))
                    path.endsWith(".ts") || path.endsWith(".vtt") || path.endsWith(".aac") -> {
                        val n = served.incrementAndGet()
                        if (cutAfter in 1 until n) MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AT_START)
                        else MockResponse().setBody(Buffer().write(("seg:$path").toByteArray() + ByteArray(1000) { 0x47 }))
                    }
                    else -> MockResponse().setResponseCode(404)
                }
            }
        }
        server.start()
    }

    @After fun tearDown() = server.shutdown()

    private fun media(dir: String) = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n" +
        "#EXT-X-KEY:METHOD=AES-128,URI=\"$dir/k.key\",IV=0x00000000000000000000000000000001\n" +
        (0 until 4).joinToString("") { "#EXTINF:6.0,\n$dir/s$it.ts\n" } + "#EXT-X-ENDLIST\n"

    private fun rangeResponse(body: ByteArray, range: String?): MockResponse {
        val start = range?.removePrefix("bytes=")?.substringBefore('-')?.toLongOrNull()
        if (start == null || ignoreRange) return MockResponse().setHeader("Accept-Ranges", "bytes").setHeader("ETag", "\"v1\"")
            .setBody(Buffer().write(body)).apply { if (cutAfter > 0) throttleBody(256 * 1024, 50, java.util.concurrent.TimeUnit.MILLISECONDS) }
        val endSpec = range.substringAfter('-').toLongOrNull()
        val end = minOf(endSpec ?: (body.size - 1L), body.size - 1L)
        if (start >= body.size) return MockResponse().setResponseCode(416).setHeader("Content-Range", "bytes */${body.size}")
        return MockResponse().setResponseCode(206).setHeader("ETag", "\"v1\"")
            .setHeader("Content-Range", "bytes $start-$end/${body.size}")
            .setBody(Buffer().write(body.copyOfRange(start.toInt(), end.toInt() + 1)))
    }

    private fun store() = JobStore(File(tmp.root, "Downloads"))
    private fun transfers() = Transfers { _, _ -> client }
    private fun job(path: String, kind: String = "FILE", subs: List<Sidecar> = emptyList()) =
        DownloadJob(id = "dl_test1", sourceKey = "src|SWH", url = server.url(path).toString(), kind = kind, subtitles = subs)

    @Test fun `downloads a complete file, verifies it and stores it outside any cache`() {
        val store = store()
        val events = mutableListOf<String>()
        val done = DownloadRunner(store, transfers()).run(job("/video.mkv")) { events += it.state }
        assertEquals("ready", done.state)
        assertTrue(done.verified)
        assertEquals("video.mkv", done.main)
        assertArrayEquals(video, File(store.dir("dl_test1"), "video.mkv").readBytes())
        assertTrue(events.contains("verifying"))
        assertEquals("ready", store.read("dl_test1")?.state)
    }

    @Test fun `restart during verification uses the committed media without requesting it again`() {
        val store = store()
        val original = job("/video.mkv")
        File(store.dir(original.id).apply { mkdirs() }, "video.mkv").writeBytes(video)
        val saved = original.copy(state = "verifying", main = "video.mkv", mainBytes = video.size.toLong(), total = video.size.toLong())
        store.write(saved)
        expired = true
        val done = DownloadRunner(store, transfers()).run(requireNotNull(store.read(original.id))) {}
        assertEquals("ready", done.state)
        assertTrue(done.verified)
        assertEquals(0, server.requestCount)
    }

    @Test fun `HLS byte range rejects a 200 response that contains the entire resource`() {
        ignoreRange = true
        val dest = File(tmp.root, "segment")
        try {
            transfers().whole(server.url("/video.mkv").toString(), emptyMap(), dest, 4L..11L)
            fail("expected the mismatched response to fail validation")
        } catch (e: DownloadFailure) {
            assertEquals("VERIFY", e.code)
        }
        assertFalse(dest.exists())
    }

    @Test fun `resumes an interrupted download from the last valid byte without re-downloading`() {
        val store = store()
        val part = File(store.dir("dl_test1").apply { mkdirs() }, "video.part")
        val half = 1_500_000
        part.writeBytes(video.copyOfRange(0, half))
        val done = DownloadRunner(store, transfers()).run(job("/video.mkv").copy(etag = "\"v1\"")) {}
        assertEquals("ready", done.state)
        assertArrayEquals(video, File(store.dir("dl_test1"), "video.mkv").readBytes())
        val ranges = (0 until server.requestCount).map { server.takeRequest().getHeader("Range") }
        assertEquals(listOf("bytes=$half-"), ranges)
    }

    @Test fun `restarts from zero when the source ignores Range instead of gluing two copies`() {
        ignoreRange = true
        val store = store()
        File(store.dir("dl_test1").apply { mkdirs() }, "video.part").writeBytes(ByteArray(999) { 7 })
        DownloadRunner(store, transfers()).run(job("/video.mkv")) {}
        assertArrayEquals(video, File(store.dir("dl_test1"), "video.mkv").readBytes())
    }

    @Test fun `a cancelled transfer keeps its partial data for resume`() {
        cutAfter = 1
        val store = store()
        val t = transfers()
        val thread = Thread { runCatching { DownloadRunner(store, t).run(job("/video.mkv")) { if (it.bytes > 300_000) t.cancel() } } }
        thread.start(); thread.join(20_000)
        val part = File(store.dir("dl_test1"), "video.part")
        assertTrue(part.length() in 300_000 until video.size)
        assertArrayEquals(video.copyOfRange(0, part.length().toInt()), part.readBytes())
    }

    @Test fun `an expired signed link is reported as EXPIRED so the same server can renew it`() {
        expired = true
        try {
            DownloadRunner(store(), transfers()).run(job("/video.mkv")) {}
            fail("expected failure")
        } catch (e: DownloadFailure) {
            assertEquals("EXPIRED", e.code)
        }
    }

    @Test fun `a web page is never saved as a video`() {
        try {
            DownloadRunner(store(), transfers()).run(job("/page")) {}
            fail("expected failure")
        } catch (e: DownloadFailure) {
            assertEquals("VERIFY", e.code)
        }
    }

    @Test fun `HLS keeps every audio language and subtitle, picks the best variant and writes a local playlist`() {
        val store = store()
        val done = DownloadRunner(store, transfers()).run(job("/master.m3u8", kind = "HLS").copy(quality = 1080)) {}
        val dir = store.dir("dl_test1")
        assertEquals("ready", done.state)
        assertEquals("index.m3u8", done.main)
        val index = File(dir, "index.m3u8").readText()
        assertTrue(index.contains("LANGUAGE=\"ja\"") && index.contains("LANGUAGE=\"en\"") && index.contains("LANGUAGE=\"ar\""))
        assertTrue(index.contains("CODECS=\"avc1.640028,mp4a.40.2\""))
        val video = File(dir, "video.m3u8").readText()
        assertTrue(video.contains("p0/s0.seg") && video.contains("#EXT-X-ENDLIST"))
        assertTrue(video.contains("URI=\"p0/k0.key\""))
        assertFalse(video.contains("http"))
        // 4 مسارات (فيديو، صوتان، ترجمة) × 4 مقاطع
        assertEquals(16, done.segmentsTotal)
        assertEquals(16, (0 until 4).sumOf { p -> File(dir, "p$p").listFiles { f -> f.name.endsWith(".seg") }!!.size })
        assertTrue(File(dir, "p0/s3.seg").readText().contains("seg:/1080/s3.ts"))
    }

    @Test fun `HLS resume skips saved segments`() {
        cutAfter = 6
        val store = store()
        try { DownloadRunner(store, transfers()).run(job("/master.m3u8", kind = "HLS")) {} ; fail("expected cut") } catch (e: DownloadFailure) { assertEquals("NETWORK", e.code) }
        cutAfter = -1
        val before = served.get()
        DownloadRunner(store, transfers()).run(job("/master.m3u8", kind = "HLS")) {}
        assertEquals(16 - 6, served.get() - before)
    }

    @Test fun `protected HLS is refused before any segment is downloaded`() {
        val text = "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://x\",KEYFORMAT=\"com.apple.streamingkeydelivery\"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n"
        assertTrue(HlsPlaylist.parseMedia(text, "https://h/x.m3u8").drm)
        val widevine = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"data:x\",KEYFORMAT=\"urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed\"\n#EXTINF:6,\na.ts\n#EXT-X-ENDLIST\n"
        assertTrue(HlsPlaylist.parseMedia(widevine, "https://h/x.m3u8").drm)
        assertFalse(HlsPlaylist.parseMedia(media("/x"), "https://h/x.m3u8").drm)
    }

    @Test fun `external subtitles are saved next to the video with their extension`() {
        val store = store()
        val done = DownloadRunner(store, transfers()).run(job("/video.mkv", subs = listOf(Sidecar(server.url("/subs/ar.vtt").toString(), "ar")))) {}
        assertEquals("sub-0.vtt", done.subtitles.single().file)
        assertTrue(File(store.dir("dl_test1"), "sub-0.vtt").length() > 0)
    }

    @Test fun `ids cannot escape the downloads folder`() {
        try { store().dir("../../etc"); fail("expected rejection") } catch (e: IllegalArgumentException) { /* ok */ }
    }

    @Test fun `variant choice respects the requested quality without exceeding it`() {
        val m = HlsPlaylist.parseMaster(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\na\n#EXT-X-STREAM-INF:BANDWIDTH=3,RESOLUTION=1280x720\nb\n#EXT-X-STREAM-INF:BANDWIDTH=9,RESOLUTION=1920x1080\nc\n",
            "https://h/m.m3u8",
        )
        assertEquals("https://h/b", HlsPlaylist.chooseVariant(m, 720)?.uri)
        assertEquals("https://h/c", HlsPlaylist.chooseVariant(m, null)?.uri)
        assertEquals("https://h/a", HlsPlaylist.chooseVariant(m, 240)?.uri)
    }
}
