package com.vantara.anime

import com.vantara.anime.player.IntroSkip
import com.vantara.anime.player.SkipRepository
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.io.IOException
import okhttp3.ResponseBody
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class SkipRepositoryTest {
    private val body = """{"found":true,"results":[{"skipType":"op","episodeLength":1440,"interval":{"startTime":90,"endTime":180}},{"skipType":"ed","episodeLength":1440,"interval":{"startTime":1300,"endTime":1380}}]}"""
    private fun client(answer: (okhttp3.Request) -> Pair<Int, String>) = OkHttpClient.Builder().addInterceptor { chain ->
        val request = chain.request()
        val (code, payload) = answer(request)
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("fixture")
            .body(payload.toResponseBody()).build()
    }.build()
    private fun cache() = Files.createTempDirectory("skip-times-test").toFile().apply { deleteOnExit() }

    @Test fun `temporary service failure recovers without restarting the video`() = runBlocking {
        var calls = 0
        val repo = SkipRepository(client { if (++calls == 1) 503 to "" else 200 to body }, cache(), pause = {})
        val result = repo.load(16498, 16498, 1f, 1_440_000)
        assertEquals(SkipRepository.Status.READY, result.status)
        assertEquals(IntroSkip.Interval(90_000, 180_000), result.timings.opening)
        assertEquals(2, calls)
    }

    @Test fun `missing MAL id is recovered from the exact AniList mapping`() = runBlocking {
        val urls = mutableListOf<String>()
        val repo = SkipRepository(client { request ->
            urls += request.url.toString()
            if (request.url.host == "api.ani.zip") 200 to """{"mappings":{"anilist_id":500,"mal_id":16498}}"""
            else 200 to body
        }, cache(), pause = {})
        assertEquals(SkipRepository.Status.READY, repo.load(500, null, 2f, 1_440_000).status)
        assertTrue(urls.any { it.contains("anilist_id=500") })
        assertTrue(urls.any { it.contains("skip-times/16498/2") })
    }

    @Test fun `mapping for another anime is never used`() = runBlocking {
        val repo = SkipRepository(client { 200 to """{"mappings":{"anilist_id":501,"mal_id":16498}}""" }, cache(), pause = {})
        assertEquals(SkipRepository.Status.MISSING_ID, repo.load(500, null, 1f, 1_440_000).status)
    }

    @Test fun `successful timings survive reopening while the service is offline`() = runBlocking {
        val directory = cache()
        val first = SkipRepository(client { 200 to body }, directory, pause = {})
        assertEquals(SkipRepository.Status.READY, first.load(16498, 16498, 1f, 1_440_000).status)
        val reopened = SkipRepository(client { error("cached timing must not need the network") }, directory, pause = {})
        val cached = reopened.load(16498, 16498, 1f, 1_440_000)
        assertTrue(cached.cached)
        assertEquals(IntroSkip.Interval(1_300_000, 1_380_000), cached.timings.ending)
    }

    @Test fun `cached data never follows a different episode or video cut`() = runBlocking {
        val directory = cache()
        val first = SkipRepository(client { 200 to body }, directory, pause = {})
        first.load(16498, 16498, 1f, 1_440_000)
        val other = SkipRepository(client { 404 to "" }, directory, pause = {})
        assertEquals(SkipRepository.Status.NOT_FOUND, other.load(16498, 16498, 2f, 1_440_000).status)
        assertEquals(SkipRepository.Status.NOT_FOUND, other.load(16498, 16498, 1f, 1_200_000).status)
    }

    @Test fun `a missing result does not poison the next successful request`() = runBlocking {
        var available = false
        val repo = SkipRepository(client { if (available) 200 to body else 404 to "" }, cache(), pause = {})
        assertEquals(SkipRepository.Status.NOT_FOUND, repo.load(16498, 16498, 1f, 1_440_000).status)
        available = true
        assertEquals(SkipRepository.Status.READY, repo.load(16498, 16498, 1f, 1_440_000).status)
    }

    @Test fun `legacy endpoint supplies trusted timing when v2 is unavailable`() = runBlocking {
        val legacy = body.replace("skipType", "skip_type").replace("episodeLength", "episode_length")
            .replace("startTime", "start_time").replace("endTime", "end_time")
        val repo = SkipRepository(client { request -> if (request.url.encodedPath.startsWith("/v2/")) 404 to "" else 200 to legacy }, cache(), pause = {})
        val result = repo.load(16498, 16498, 1f, 1_440_000)
        assertEquals(SkipRepository.Status.READY, result.status)
        assertEquals(IntroSkip.Interval(90_000, 180_000), result.timings.opening)
    }

    @Test fun `rate limiting postpones retries instead of hammering the fallback endpoint`() = runBlocking {
        var calls = 0
        val c = OkHttpClient.Builder().addInterceptor { chain ->
            calls++
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(429).message("limited")
                .header("Retry-After", "60").body("".toResponseBody()).build()
        }.build()
        val result = SkipRepository(c, cache(), pause = {}).load(16498, 16498, 1f, 1_440_000)
        assertEquals(SkipRepository.Status.FAILED, result.status)
        assertTrue(result.retryAfterMs >= 60_000)
        assertEquals(1, calls)
    }

    @Test fun `fractional specials never borrow the previous episode timing`() = runBlocking {
        val repo = SkipRepository(client { error("no rounded episode request") }, cache(), pause = {})
        assertEquals(SkipRepository.Status.SPECIAL, repo.load(16498, 16498, 12.5f, 1_440_000).status)
    }

    @Test fun `cache expires and corrupt files cannot create skip buttons`() = runBlocking {
        var now = 0L
        val dir = cache()
        SkipRepository(client { 200 to body }, dir, { now }, {}).load(16498, 16498, 1f, 1_440_000)
        now = 8 * 24 * 60 * 60_000L
        assertEquals(SkipRepository.Status.NOT_FOUND, SkipRepository(client { 404 to "" }, dir, { now }, {}).load(16498, 16498, 1f, 1_440_000).status)
        dir.listFiles()?.forEach { it.writeText("broken") }
        assertEquals(SkipRepository.Status.NOT_FOUND, SkipRepository(client { 404 to "" }, dir, { now }, {}).load(16498, 16498, 1f, 1_440_000).status)
    }

    @Test fun `a response body interruption is retried instead of breaking playback`() = runBlocking {
        var calls = 0
        val c = OkHttpClient.Builder().addInterceptor { chain ->
            calls++
            val payload = if (calls == 1) object : ResponseBody() {
                override fun contentType(): okhttp3.MediaType? = null
                override fun contentLength() = -1L
                override fun source(): BufferedSource = object : Source {
                    override fun read(sink: okio.Buffer, byteCount: Long): Long = throw IOException("connection lost while reading JSON")
                    override fun timeout() = Timeout.NONE
                    override fun close() {}
                }.buffer()
            } else body.toResponseBody()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(payload).build()
        }.build()
        val result = SkipRepository(c, cache(), pause = {}).load(16498, 16498, 1f, 1_440_000)
        assertEquals(SkipRepository.Status.READY, result.status)
        assertEquals(2, calls)
    }

    @Test fun `large episode mapping responses still resolve the exact MAL id`() = runBlocking {
        val mapping = """{"mappings":{"anilist_id":500,"mal_id":16498},"episodes":{"fixture":"${"x".repeat(100_000)}"}}"""
        val repo = SkipRepository(client { if (it.url.host == "api.ani.zip") 200 to mapping else 200 to body }, cache(), pause = {})
        assertEquals(SkipRepository.Status.READY, repo.load(500, null, 1f, 1_440_000).status)
    }

    @Test fun `canceling a lookup cancels its HTTP call without retrying`() = runBlocking {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val call = AtomicReference<okhttp3.Call>()
        val c = OkHttpClient.Builder().addInterceptor { chain ->
            call.set(chain.call())
            started.countDown()
            release.await(5, TimeUnit.SECONDS)
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(body.toResponseBody()).build()
        }.build()
        val lookup = async(Dispatchers.Default) { SkipRepository(c, cache(), pause = { error("canceled calls must not retry") }).load(16498, 16498, 1f, 1_440_000) }
        try {
            assertTrue(started.await(5, TimeUnit.SECONDS))
            lookup.cancelAndJoin()
            assertTrue(call.get().isCanceled())
        } finally { release.countDown() }
    }

    @Test fun `canceling after headers also cancels a call reading its body`() = runBlocking {
        val reading = CountDownLatch(1)
        val release = CountDownLatch(1)
        val call = AtomicReference<okhttp3.Call>()
        val c = OkHttpClient.Builder().addInterceptor { chain ->
            call.set(chain.call())
            val payload = object : ResponseBody() {
                override fun contentType(): okhttp3.MediaType? = null
                override fun contentLength() = -1L
                override fun source(): BufferedSource = object : Source {
                    override fun read(sink: okio.Buffer, byteCount: Long): Long {
                        reading.countDown()
                        release.await(5, TimeUnit.SECONDS)
                        return -1L
                    }
                    override fun timeout() = Timeout.NONE
                    override fun close() {}
                }.buffer()
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("fixture").body(payload).build()
        }.build()
        val lookup = async(Dispatchers.Default) { SkipRepository(c, cache(), pause = { error("canceled calls must not retry") }).load(16498, 16498, 1f, 1_440_000) }
        try {
            assertTrue(reading.await(5, TimeUnit.SECONDS))
            lookup.cancel()
            assertTrue(call.get().isCanceled())
        } finally { release.countDown(); lookup.cancelAndJoin() }
    }
}
