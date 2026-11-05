package com.vantara.addons

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.Player
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.health.HealthStore
import com.vantara.anime.player.CandidateMediaSources
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.StreamProbe
import kotlinx.coroutines.Job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/**
 * Authored local HTTP bytes -> addon extraction parser -> cancellable probe -> Prepared admission
 * -> production media-source builder -> actual Media3 video decoder. No external service is needed.
 *
 * Addon production transport correctly forbids loopback. Only this test's transport routes the
 * reserved HTTPS fixture name to its owned HTTP server; it does not relax production URL policy.
 * NativeAddonHttpPlaybackDeviceTest separately exercises the real public HTTPS addon transport.
 */
@RunWith(AndroidJUnit4::class)
class PreparedHttpPlaybackDeviceTest {
    @Test fun dashWithBomCommentsAndExplicitCookieReachesDecodedFrames() = play("dash", Container.DASH)
    @Test fun mislabelledHlsWithExplicitCookieReachesDecodedFrames() = play("hls", Container.HLS)
    @Test fun mp4WithInheritedCookieJarReachesDecodedFrames() = play("mp4", Container.MP4, useJar = true)

    @Test fun htmlErrorNeverEntersThePreparedPlaybackSession() {
        FixtureServer(mapOf("/blocked.mpd" to Asset("text/html", "<html>verification required</html>".toByteArray())), required(false)).use { server ->
            val candidate = extracted("dash", "https://fixture.vantara.example/blocked.mpd", false)
            val prep = prepared(candidate)
            try {
                assertNull("Extraction alone must not admit a candidate", prep.best())
                val accepted = runBlocking { withTimeout(10_000) { StreamProbe.checkCancellable(transport(server, false), candidate) } }
                assertFalse(accepted)
                prep.markProbe(requireNotNull(prep.routeOf(candidate.id)).id, accepted, 0, candidate.id)
                prep.finish()
                assertNull(prep.best()); assertNull(prep.session.next())
                assertEquals(false, prep.routeOf(candidate.id)?.probed)
                assertTrue(server.requests.isNotEmpty()); assertTrue(server.rejected.isEmpty())
            } finally { prep.job?.cancel() }
        }
    }

    private fun play(type: String, container: Container, useJar: Boolean = false) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val paths = if (type == "mp4") listOf("/primary.mp4") else {
            instrumentation.context.assets.list("player-formats/$type")!!.map { "/$type/$it" }
        }
        val assets = paths.associateWith { path ->
            val asset = if (type == "mp4") "player-audio/primary.mp4" else "player-formats${path}"
            var bytes = instrumentation.context.assets.open(asset).use { it.readBytes() }
            if (path.endsWith(".mpd")) {
                // More than the old 256-byte prefix; still a valid XML preamble for Media3.
                bytes = ("\uFEFF<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!--" + " authored ".repeat(80) + "-->\n" +
                    bytes.toString(Charsets.UTF_8).substringAfter("?>")).toByteArray()
            }
            Asset(when {
                path.endsWith(".mpd") -> "application/dash+xml; charset=utf-8"
                path.endsWith(".m3u8") -> "text/plain; charset=utf-8" // deliberately incorrect MIME
                path.endsWith(".ts") -> "video/mp2t"
                path.endsWith(".mp4") -> "video/mp4"
                else -> "application/octet-stream"
            }, bytes)
        }
        FixtureServer(assets, required(useJar)).use { server ->
            val url = "https://fixture.vantara.example/" + when (type) { "mp4" -> "primary.mp4"; "hls" -> "hls/manifest.m3u8"; else -> "dash/manifest.mpd" }
            val candidate = extracted(type, url, useJar)
            assertEquals(container, candidate.container)
            val prep = prepared(candidate)
            val client = transport(server, useJar)
            val proof = JSONObject().put("format", type).put("fixtureTransport", "test-owned loopback HTTP").put("headersRequiredOnEveryRequest", true)
            val proofFile = File(instrumentation.targetContext.filesDir, "addon-proof/local-format-$type.json").apply { parentFile!!.mkdirs() }
            val frame = CountDownLatch(1)
            val continuing = CountDownLatch(1)
            val failure = AtomicReference<Throwable?>()
            val consumer = HandlerThread("PreparedFormatFrames-$type").apply { start() }
            val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
            images.setOnImageAvailableListener({ it.acquireLatestImage()?.close() }, Handler(consumer.looper))
            var player: ExoPlayer? = null
            try {
                assertNull("Unprobed extraction must not play", prep.best())
                val accepted = runBlocking { withTimeout(10_000) { StreamProbe.checkCancellable(client, candidate) } }
                assertTrue("Valid $type candidate was rejected", accepted)
                prep.markProbe(requireNotNull(prep.routeOf(candidate.id)).id, accepted, 0, candidate.id)
                prep.finish()
                val selected = requireNotNull(prep.best())
                assertEquals(selected, prep.session.take(selected.id)); assertTrue(prep.done)
                proof.put("probeAccepted", true).put("preparedAdmitted", true)
                instrumentation.runOnMainSync {
                    player = ExoPlayer.Builder(instrumentation.targetContext).build().also { p ->
                        p.setVideoSurface(images.surface)
                        p.addListener(object : Player.Listener {
                            override fun onRenderedFirstFrame() { frame.countDown() }
                            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                                failure.set(error); frame.countDown(); continuing.countDown()
                            }
                        })
                        p.setVideoFrameMetadataListener { timeUs, _, _, _ -> if (timeUs >= 1_000_000) continuing.countDown() }
                        val source = CandidateMediaSources.create(selected, OkHttpDataSource.Factory(client).setDefaultRequestProperties(selected.headers))
                        p.setMediaSource(source.mediaSource); p.prepare(); p.play()
                    }
                }
                assertTrue("No first $type frame", frame.await(30, TimeUnit.SECONDS)); assertNull(failure.get())
                assertTrue("$type stopped after its first frame", continuing.await(15, TimeUnit.SECONDS)); assertNull(failure.get())
                instrumentation.runOnMainSync {
                    assertEquals(320, player!!.videoFormat?.width)
                    assertEquals(180, player!!.videoFormat?.height)
                    val counters = requireNotNull(player!!.videoDecoderCounters)
                    counters.ensureUpdated()
                    assertTrue("No decoder output", counters.renderedOutputBufferCount > 0)
                }
                assertTrue("Headers/cookies were rejected: ${server.rejected}", server.rejected.isEmpty())
                val requests = server.requests.toList()
                val manifestPath = java.net.URI(url).path
                assertTrue("Probe and playback must each fetch the primary", requests.count { it.path == manifestPath } >= 2)
                assertTrue("Bounded probe Range was absent", requests.any { it.path == manifestPath && it.range == "bytes=0-8191" })
                if (type == "hls") assertTrue("HLS segments were never fetched", requests.any { it.path.endsWith(".ts") })
                if (type == "dash") assertTrue("DASH segments were never fetched", requests.any { it.path.contains("chunk-") })
                proof.put("firstFrame", true).put("continuedPastOneSecond", true).put("passed", true)
            } catch (error: Throwable) {
                proof.put("passed", false).put("failure", error.toString()); throw error
            } finally {
                instrumentation.runOnMainSync { player?.release() }
                images.close(); consumer.quitSafely(); consumer.join(3000); prep.job?.cancel()
                proof.put("requests", JSONArray(server.requests.map { JSONObject().put("path", it.path).put("range", it.range).put("headersMatched", it.headersMatched) }))
                proofFile.writeText(proof.toString(2))
                android.util.Log.i("VantaraRuntime", "PHASE2_FORMAT_PROOF ${proof}")
                client.dispatcher.executorService.shutdownNow(); client.connectionPool.evictAll()
            }
        }
    }

    private fun extracted(type: String, url: String, useJar: Boolean): Candidate {
        val raw = buildJsonArray { add(buildJsonObject {
            put("id", "local-$type"); put("status", "RESOLVED"); put("url", url); put("type", type)
            put("headers", buildJsonObject { for ((name, value) in required(useJar)) if (name != "cookie" || !useJar) put(name, value) })
        }) }
        return NativeAddonCandidates.parse("local-format", "addon|local-format", "Authored local proof", raw, System.currentTimeMillis()).single()
    }

    private fun prepared(candidate: Candidate): PreparedEpisode {
        val health = HealthStore(null)
        return PreparedEpisode("local-format", emptyList(), -1f, Preferences(), PlaybackSession(emptyList(), health), health, probe = true)
            .also { it.job = Job(); it.adopt(candidate.sourceId, listOf(candidate)) }
    }

    private fun required(useJar: Boolean) = mapOf(
        "referer" to "https://source.vantara.example/watch", "origin" to "https://source.vantara.example",
        "user-agent" to "Vantara authored device proof", "authorization" to "Bearer authored-fixture",
        "cookie" to if (useJar) "cf_clearance=authored-fixture" else "ticket=authored-fixture",
    )

    private fun transport(server: FixtureServer, useJar: Boolean): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).callTimeout(10, TimeUnit.SECONDS)
        .cookieJar(if (!useJar) CookieJar.NO_COOKIES else object : CookieJar {
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) = Unit
            override fun loadForRequest(url: HttpUrl) = listOf(Cookie.Builder().name("cf_clearance").value("authored-fixture").domain(url.host).build())
        })
        .addInterceptor { chain ->
            val request = chain.request()
            require(request.url.host == "fixture.vantara.example" || request.url.host == "127.0.0.1")
            chain.proceed(request.newBuilder().url("${server.baseUrl}${request.url.encodedPath}").build())
        }.build()

    private data class Asset(val contentType: String, val bytes: ByteArray)
    private data class Seen(val path: String, val range: String?, val headersMatched: Boolean)

    /** Real byte-range HTTP; every manifest/segment request must carry the fixture credentials. */
    private class FixtureServer(private val assets: Map<String, Asset>, private val required: Map<String, String>) : AutoCloseable {
        private val server = ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"))
        private val sockets = Collections.synchronizedSet(mutableSetOf<Socket>())
        @Volatile private var running = true
        val requests = CopyOnWriteArrayList<Seen>()
        val rejected = CopyOnWriteArrayList<String>()
        val baseUrl = "http://127.0.0.1:${server.localPort}"
        private val acceptor = thread(name = "PreparedFormatHttp", isDaemon = true) {
            while (running) runCatching {
                val socket = server.accept(); sockets.add(socket)
                thread(name = "PreparedFormatRequest", isDaemon = true) {
                    try { socket.use { serve(it) } } catch (_: Exception) { /* probe may close a bounded prefix */ }
                    finally { sockets.remove(socket) }
                }
            }
        }
        private fun serve(socket: Socket) {
            socket.soTimeout = 10_000
            val input = socket.getInputStream().bufferedReader()
            val first = input.readLine() ?: return
            val parts = first.split(' ')
            val path = parts.getOrNull(1)?.substringBefore('?') ?: return
            val headers = mutableMapOf<String, String>()
            while (true) {
                val line = input.readLine() ?: return
                if (line.isEmpty()) break
                headers[line.substringBefore(':').lowercase()] = line.substringAfter(':').trim()
            }
            val matched = required.all { (key, value) -> headers[key] == value }
            requests += Seen(path, headers["range"], matched)
            if (!matched) { rejected += path; respond(socket, "403 Forbidden", "text/plain", "missing fixture credentials".toByteArray()); return }
            val asset = assets[path]
            if (asset == null) { respond(socket, "404 Not Found", "text/plain", "missing fixture".toByteArray()); return }
            val range = headers["range"]?.let { Regex("bytes=(\\d+)-(\\d*)").matchEntire(it) }
            val start = range?.groupValues?.get(1)?.toIntOrNull() ?: 0
            val end = minOf(asset.bytes.lastIndex, range?.groupValues?.get(2)?.toIntOrNull() ?: asset.bytes.lastIndex)
            if (start !in asset.bytes.indices || end < start) { respond(socket, "416 Range Not Satisfiable", "text/plain", ByteArray(0)); return }
            val body = asset.bytes.copyOfRange(start, end + 1)
            respond(socket, if (range == null) "200 OK" else "206 Partial Content", asset.contentType, body,
                if (range == null) "" else "Content-Range: bytes $start-$end/${asset.bytes.size}\r\n", parts[0] == "HEAD")
        }
        private fun respond(socket: Socket, status: String, type: String, body: ByteArray, extra: String = "", head: Boolean = false) {
            socket.getOutputStream().apply {
                write(("HTTP/1.1 $status\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\nAccept-Ranges: bytes\r\n" + extra + "Connection: close\r\n\r\n").toByteArray())
                if (!head) write(body)
                flush()
            }
        }
        override fun close() {
            running = false; server.close()
            synchronized(sockets) { sockets.toList().forEach { runCatching { it.close() } } }
            acceptor.join(2000)
        }
    }
}
