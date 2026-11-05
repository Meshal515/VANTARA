package com.vantara.anime.stream

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.EventListener
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** Loopback HTTP exercises the same OkHttp body, headers and CookieJar used by route probes. */
class StreamProbeTest {
    private val mpd = "<MPD xmlns=\"urn:mpeg:dash:schema:mpd:2011\" type=\"static\"><Period/></MPD>"
    private val mp4 = byteArrayOf(0, 0, 0, 24) + "ftypisom".toByteArray() + ByteArray(12)
    private fun candidate(url: String, container: Container = Container.UNKNOWN, headers: Map<String, String> = emptyMap()) =
        Candidate("probe", "source", "fixture", "server", "localhost", url, headers = headers,
            container = container, resolvedAt = 0, expiresAt = Long.MAX_VALUE)

    @Test fun dashIsAdmittedWithMimeParametersOrNoMime() {
        for (type in listOf("application/dash+xml; charset=UTF-8", "APPLICATION/DASH+XML", "text/plain", "application/octet-stream", null)) {
            assertTrue("DASH rejected for MIME $type", StreamProbe.verdict(Container.DASH, type, mpd))
            assertTrue(StreamProbe.verdict(Container.UNKNOWN, type, mpd))
        }
    }

    @Test fun dashAcceptsBomDeclarationCommentsAndBoundNamespaces() {
        val prefix = "\uFEFF \n<?xml version=\"1.0\"?>\n<!-- legal preamble -->\n<?producer fixture?>\n"
        assertTrue(StreamProbe.verdict(Container.DASH, "application/dash+xml", prefix + mpd))
        assertTrue(StreamProbe.verdict(Container.DASH, null,
            prefix + "<dash:MPD xmlns:dash='urn:mpeg:dash:schema:mpd:2011'><dash:Period/></dash:MPD>"))
    }

    @Test fun manifestMimeAndFileExtensionCannotAdmitErrorsOrMalformedRoots() {
        for (head in listOf("", "File expired", "{\"error\":\"expired\"}", "[1,2]", "<html>challenge</html>",
            "<!-- preamble --><!DOCTYPE html><html>verification</html>", "<?xml version='1.0'?><Error>expired</Error>",
            "<!-- <MPD> -->blocked", "<MPDwhatever/>", "<MPD", "<MPD type='unterminated>",
            "<bad:MPD/>", "<MPD xmlns='https://example.invalid/not-dash'/>", "#EXTM3U-error", "challenge ftyp here")) {
            for (type in listOf("application/dash+xml", "video/mp4", "application/octet-stream", null)) {
                assertFalse("Incorrectly admitted $head / $type", StreamProbe.verdict(Container.DASH, type, head))
                assertFalse("Incorrectly admitted unknown $head / $type", StreamProbe.verdict(Container.UNKNOWN, type, head))
            }
        }
    }

    @Test fun hlsAndMp4ContinueToWorkWithMissingOrMislabelledMime() {
        assertTrue(StreamProbe.verdict(Container.HLS, "text/plain; charset=utf-8", "\uFEFF\n#EXTM3U\n#EXT-X-VERSION:3"))
        assertTrue(StreamProbe.verdict(Container.UNKNOWN, null, "#EXTM3U\n#EXTINF:6,\nsegment.ts"))
        assertTrue(StreamProbe.verdict(Container.MP4, null, mp4.toString(Charsets.ISO_8859_1)))
        assertTrue(StreamProbe.verdict(Container.MP4, "text/plain", mp4.toString(Charsets.ISO_8859_1)))
        assertFalse(StreamProbe.verdict(Container.HLS, "video/mp4", mp4.toString(Charsets.ISO_8859_1)))
        assertFalse(StreamProbe.verdict(Container.DASH, "application/dash+xml", "#EXTM3U\n"))
        assertFalse(StreamProbe.verdict(Container.UNKNOWN, null, "ftyp is not a box header"))
        assertFalse(StreamProbe.verdict(Container.UNKNOWN, null, "xxxxftypisom is prose"))
        assertFalse(StreamProbe.verdict(Container.UNKNOWN, null, "\u0000\u0000\u0000\u000cftypisom"))
    }

    @Test fun realProbePreservesCandidateHeadersAndInheritedCookieJar() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Type", "application/dash+xml; charset=utf-8").setBody("<?xml version=\"1.0\"?><!--" + "padding".repeat(100) + "-->" + mpd))
            server.start()
            val jar = object : CookieJar {
                override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = Unit
                override fun loadForRequest(url: HttpUrl) = listOf(Cookie.Builder().name("cf_clearance").value("fixture").domain(url.host).build())
            }
            val headers = mapOf("Referer" to "https://source.example/watch", "Origin" to "https://source.example", "User-Agent" to "Fixture player", "Authorization" to "Bearer fixture")
            assertTrue(runBlocking { StreamProbe.checkCancellable(OkHttpClient.Builder().cookieJar(jar).build(), candidate(server.url("/signed.mpd").toString(), Container.DASH, headers)) })
            val request = server.takeRequest(1, TimeUnit.SECONDS)!!
            for ((key, value) in headers) assertEquals(value, request.getHeader(key))
            assertEquals("cf_clearance=fixture", request.getHeader("Cookie"))
            assertNotNull(request.getHeader("Range"))
        }
    }

    @Test fun explicitlySuppliedCookieIsPreservedOnCookieFreeClient() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("#EXTM3U\n")); server.start()
            assertTrue(StreamProbe.check(OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).build(),
                candidate(server.url("/video").toString(), Container.HLS, mapOf("Cookie" to "ticket=fixture"))))
            assertEquals("ticket=fixture", server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Cookie"))
        }
    }

    @Test fun errorHttpStatusesAreRejectedEvenWithValidMediaBytes() {
        MockWebServer().use { server ->
            server.start()
            for (status in listOf(401, 403, 404, 500)) {
                server.enqueue(MockResponse().setResponseCode(status).setHeader("Content-Type", "video/mp4").setBody(Buffer().write(mp4)))
                assertFalse(StreamProbe.check(OkHttpClient(), candidate(server.url("/video").toString(), Container.MP4)))
            }
        }
    }

    @Test fun retryWithoutRangeWhenServerExplicitlyRejectsRange() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(416))
            server.enqueue(MockResponse().setBody(mpd)); server.start()
            assertTrue(runBlocking { StreamProbe.checkCancellable(OkHttpClient(), candidate(server.url("/video.mpd").toString(), Container.DASH)) })
            assertNotNull(server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Range"))
            assertNull(server.takeRequest(1, TimeUnit.SECONDS)!!.getHeader("Range"))
            assertEquals(2, server.requestCount)
        }
    }

    @Test fun ignoredRangeDoesNotReadOrWaitForTheFullBody() {
        MockWebServer().use { server ->
            val body = Buffer().write(mp4).write(ByteArray(128 * 1024))
            server.enqueue(MockResponse().setHeader("Content-Type", "video/mp4").setBody(body).throttleBody(16 * 1024, 30, TimeUnit.SECONDS))
            server.start()
            val read = AtomicLong(-1)
            val client = OkHttpClient.Builder().eventListener(object : EventListener() {
                override fun responseBodyEnd(call: Call, byteCount: Long) { read.set(byteCount) }
            }).build()
            val began = System.nanoTime()
            assertTrue(StreamProbe.check(client, candidate(server.url("/large").toString(), Container.MP4)))
            assertTrue("Probe waited for full body", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) < 2000)
            assertTrue("Read ${read.get()} bytes", read.get() in 1..(16 * 1024))
        }
    }
    @Test fun coroutineTimeoutCancelsPhysicalCallBeforeItsNetworkDeadline() {
        for (response in listOf(
            MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE),
            MockResponse().setBody("#EXTM3U\n").setBodyDelay(5, TimeUnit.SECONDS),
        )) {
            MockWebServer().use { server ->
                server.enqueue(response); server.start()
                val failed = java.util.concurrent.CountDownLatch(1)
                val client = OkHttpClient.Builder().callTimeout(2, TimeUnit.SECONDS)
                    .eventListener(object : EventListener() {
                        override fun callFailed(call: Call, ioe: java.io.IOException) { failed.countDown() }
                    }).build()
                val began = System.nanoTime()
                val error = runCatching { runBlocking { withTimeout(100) {
                    StreamProbe.checkCancellable(client, candidate(server.url("/stall").toString(), Container.HLS))
                } } }.exceptionOrNull()
                assertTrue("Timeout was swallowed: $error", error is TimeoutCancellationException)
                assertTrue("Cancellation waited for network deadline", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - began) < 1000)
                assertTrue("Abandoned call still active", failed.await(500, TimeUnit.MILLISECONDS))
            }
        }
    }
    @Test fun interceptorRejectionReturnsItsRealCauseWithoutAnUncaughtDispatcherFailure() {
        val uncaught = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val pool = java.util.concurrent.Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "probe-rejection-proof").apply { uncaughtExceptionHandler = Thread.UncaughtExceptionHandler { _, error -> uncaught.set(error) } }
        }
        val client = OkHttpClient.Builder().dispatcher(okhttp3.Dispatcher(pool))
            .addInterceptor { throw IllegalArgumentException("PUBLIC_URL_REJECTED") }.build()
        try {
            val failure = runBlocking { runCatching { withTimeout(3_000) { StreamProbe.checkCancellable(client, candidate("https://fixture.example/proof.mpd")) } }.exceptionOrNull() }
            assertTrue("Real interceptor cause was lost: $failure", failure is IllegalArgumentException)
            assertEquals("PUBLIC_URL_REJECTED", failure?.message)
            assertNull("Interceptor rejection must never escape on a dispatcher thread", uncaught.get())
        } finally { pool.shutdownNow(); client.connectionPool.evictAll() }
    }

}
