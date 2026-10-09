package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import org.json.JSONObject
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.frostwire.jlibtorrent.swig.ip_filter
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** Actual native libtorrent reads/hash verification -> Media3 codec -> rendered frame -> seek.
 * This authored fixture uses an isolated loopback webseed, not a commercial provider/torrent. */
@RunWith(AndroidJUnit4::class)
class TorrentPlaybackDeviceTest {
    @Test fun actualNativePiecesPlayAndSeekWithoutVideoRestart() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val video = instrumentation.context.assets.open("addon-torrent-proof.mp4").use { it.readBytes() }
        val seed = WebSeed(video)
        val info = linkedMapOf<String, Any>(
            "length" to video.size.toLong(), "name" to "addon-torrent-proof.mp4",
            "piece length" to 32_768L,
            "pieces" to video.asList().chunked(32_768).flatMap { MessageDigest.getInstance("SHA-1").digest(it.toByteArray()).asList() }.toByteArray()
        )
        val hash = MessageDigest.getInstance("SHA-1").digest(bencode(info)).joinToString("") { "%02x".format(it) }
        val folder = File(context.cacheDir, "torrent-streams/$hash").apply { deleteRecursively(); mkdirs() }
        File(folder, "metadata.torrent").writeBytes(bencode(mapOf("info" to info, "url-list" to seed.url)))
        // Explicit native dependency injection. The production singleton always uses public-only IP rules.
        val engine = TorrentEngine(context) { ip_filter() }
        val uri = engine.register(TorrentRequest(hash, 0))
        val factory = engine.dataSourceFactory(DefaultDataSource.Factory(context))
        assertTrue("JNI torrent libraries must really load", TorrentEngine.nativeAvailable())
        val proof = JSONObject().put("infoHash", hash).put("fixtureBytes", video.size).put("nativeLibrariesLoaded", TorrentEngine.nativeAvailable())
        val proofFile = File(context.filesDir, "addon-proof/native-torrent.json").apply { parentFile!!.mkdirs() }
        val begun = SystemClock.elapsedRealtime()
        try {
            // A nonzero range crosses piece boundaries. Equality proves verified original bytes, not zeros from a sparse file.
            val source = factory.createDataSource()
            val start = 31_900
            val expected = video.copyOfRange(start, start + 48_000)
            val actual = ByteArray(expected.size)
            assertEquals(expected.size.toLong(), source.open(DataSpec.Builder().setUri(uri).setPosition(start.toLong()).setLength(expected.size.toLong()).build()))
            var read = 0
            while (read < actual.size) { val n = source.read(actual, read, actual.size - read); assertTrue(n > 0); read += n }
            assertArrayEquals(expected, actual)
            proof.put("verifiedRangeBytes", actual.size).put("verifiedRangeSha256", MessageDigest.getInstance("SHA-256").digest(actual).joinToString("") { "%02x".format(it) })
            assertEquals(-1, source.read(ByteArray(1), 0, 1)); source.close()
            val firstFrame = CountDownLatch(1)
            val soughtFrame = CountDownLatch(1)
            val progressed = CountDownLatch(1)
            val seeking = AtomicBoolean(false)
            val failure = AtomicReference<Throwable?>()
            lateinit var player: ExoPlayer
            val consumer = HandlerThread("TorrentProofFrames").apply { start() }
            val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
            images.setOnImageAvailableListener({ reader -> reader.acquireLatestImage()?.close() }, Handler(consumer.looper))
            instrumentation.runOnMainSync {
                player = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(factory)).build()
                player.setVideoSurface(images.surface)
                player.addListener(object : Player.Listener {
                    override fun onRenderedFirstFrame() { firstFrame.countDown() }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) { failure.set(error); firstFrame.countDown(); soughtFrame.countDown(); progressed.countDown() }
                })
                player.setVideoFrameMetadataListener { presentationTimeUs, _, _, _ ->
                    if (seeking.get() && presentationTimeUs >= 4_900_000) soughtFrame.countDown()
                    if (seeking.get() && presentationTimeUs >= 6_000_000) progressed.countDown()
                }
                player.setMediaItem(MediaItem.Builder().setUri(uri).setMimeType(MimeTypes.VIDEO_MP4).build())
                player.prepare(); player.play()
            }
            try {
                assertTrue("No actual first frame from torrent", firstFrame.await(60, TimeUnit.SECONDS))
                assertNull("Native torrent playback failed", failure.get())
                proof.put("firstFrame", true).put("firstFrameElapsedMs", SystemClock.elapsedRealtime() - begun)
                instrumentation.runOnMainSync { seeking.set(true); player.seekTo(5000) }
                assertTrue("No decoded frame at seek position", soughtFrame.await(30, TimeUnit.SECONDS))
                assertTrue("Playback did not continue after seek", progressed.await(15, TimeUnit.SECONDS))
                assertNull(failure.get())
                proof.put("decodedAfterSeek", true).put("continuedPastSixSeconds", true)
                instrumentation.runOnMainSync {
                    assertTrue(player.currentPosition >= 5000); assertEquals(1, player.mediaItemCount)
                    proof.put("positionMs", player.currentPosition).put("videoWidth", player.videoFormat?.width).put("videoHeight", player.videoFormat?.height).put("mediaItems", player.mediaItemCount)
                }
            } finally {
                instrumentation.runOnMainSync { player.release() }
                images.close(); consumer.quitSafely(); consumer.join(3000)
            }
            assertTrue("Native engine did not request seed ranges", seed.requests > 0)
            proof.put("passed", true)
        } catch (error: Throwable) {
            proof.put("passed", false).put("failure", error.toString())
            throw error
        } finally {
            proof.put("webSeedRequests", seed.requests).put("elapsedMs", SystemClock.elapsedRealtime() - begun)
            proofFile.writeText(proof.toString(2))
            engine.release(uri); engine.close(); seed.close()
        }
    }
    @Test fun closingReaderUnblocksWaitingForUnavailablePiece() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val video = instrumentation.context.assets.open("addon-torrent-proof.mp4").use { it.readBytes() }
        val info = mapOf<String, Any>("length" to video.size.toLong(), "name" to "addon-torrent-proof.mp4", "piece length" to 32_768L,
            "pieces" to video.asList().chunked(32_768).flatMap { MessageDigest.getInstance("SHA-1").digest(it.toByteArray()).asList() }.toByteArray())
        val hash = MessageDigest.getInstance("SHA-1").digest(bencode(info)).joinToString("") { "%02x".format(it) }
        val folder = File(context.cacheDir, "torrent-streams/$hash").apply { deleteRecursively(); mkdirs() }
        // No webseed/peer has these synthetic bytes. Metadata is known, so only the buffer read waits.
        File(folder, "metadata.torrent").writeBytes(bencode(mapOf("info" to info)))
        val engine = TorrentEngine(context) { ip_filter() }
        val uri = engine.register(TorrentRequest(hash, 0))
        val source = engine.dataSourceFactory(DefaultDataSource.Factory(context)).createDataSource()
        val waiting = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        try {
            source.open(DataSpec.Builder().setUri(uri).setLength(1).build())
            val loader = thread {
                waiting.countDown()
                try { source.read(ByteArray(1), 0, 1) } catch (error: Throwable) { failure.set(error) } finally { finished.countDown() }
            }
            assertTrue(waiting.await(2, TimeUnit.SECONDS))
            assertFalse("Unavailable piece unexpectedly returned", finished.await(250, TimeUnit.MILLISECONDS))
            source.close()
            assertTrue("Closing reader did not cancel piece wait", finished.await(2, TimeUnit.SECONDS))
            assertTrue(failure.get() is java.io.InterruptedIOException)
            loader.join(2000)
        } finally { source.close(); engine.release(uri); engine.close() }
    }
    private fun bencode(value: Any): ByteArray = ByteArrayOutputStream().apply {
        when (value) {
            is String -> write(bencode(value.toByteArray()))
            is ByteArray -> { write("${value.size}:".toByteArray()); write(value) }
            is Long -> write("i${value}e".toByteArray())
            is Map<*, *> -> { write('d'.code); value.keys.map { it as String }.sorted().forEach { write(bencode(it)); write(bencode(value[it]!!)) }; write('e'.code) }
            else -> error("Invalid test metadata value")
        }
    }.toByteArray()

    /** Minimal byte-range HTTP server is test-owned, never part of product runtime. */
    private class WebSeed(private val video: ByteArray) : AutoCloseable {
        private val server = ServerSocket(0)
        @Volatile private var running = true
        @Volatile var requests = 0; private set
        val url = "http://127.0.0.1:${server.localPort}/addon-torrent-proof.mp4"
        init {
            thread(name = "OwnedTorrentSeed", isDaemon = true) {
                while (running) runCatching {
                    val socket = server.accept()
                    thread(isDaemon = true) {
                        socket.use {
                            val reader = it.getInputStream().bufferedReader()
                            val line = reader.readLine() ?: return@use
                            var range: String? = null
                            while (true) { val header = reader.readLine() ?: break; if (header.isEmpty()) break; if (header.startsWith("Range:", true)) range = header.substringAfter(':').trim() }
                            if (!line.contains("/addon-torrent-proof.mp4")) return@use
                            val match = range?.let { Regex("bytes=(\\d+)-(\\d*)").find(it) }
                            val start = match?.groupValues?.get(1)?.toInt() ?: 0
                            val end = minOf(video.lastIndex, match?.groupValues?.get(2)?.toIntOrNull() ?: video.lastIndex)
                            if (start !in video.indices || end < start) return@use
                            requests++
                            val response = if (match != null) "206 Partial Content" else "200 OK"
                            val headers = "HTTP/1.1 $response\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: ${end - start + 1}\r\n" +
                                (if (match != null) "Content-Range: bytes $start-$end/${video.size}\r\n" else "") + "Connection: close\r\n\r\n"
                            it.getOutputStream().apply { write(headers.toByteArray()); if (!line.startsWith("HEAD ")) write(video, start, end - start + 1); flush() }
                        }
                    }
                }
            }
        }
        override fun close() { running = false; server.close() }
    }
}
