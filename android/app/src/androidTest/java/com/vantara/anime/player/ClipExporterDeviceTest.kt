package com.vantara.anime.player

import android.media.MediaMetadataRetriever
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.concurrent.thread

/** Real codec + HLS regression: selected 8.5–28.5s must not become 6–28.5s. */
@RunWith(AndroidJUnit4::class)
class ClipExporterDeviceTest {
    @Test fun twentySecondsAcrossHlsKeyframesExportsTwentySecondsAndSavesRealMp4() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val server = ServerSocket(0)
        val worker = thread(isDaemon = true) {
            while (!server.isClosed) runCatching {
                server.accept().use { socket ->
                    val reader = socket.getInputStream().bufferedReader()
                    val path = reader.readLine().split(' ')[1].substringAfterLast('/')
                    while (!reader.readLine().isNullOrEmpty()) { }
                    val bytes = instrumentation.context.assets.open("moment/$path").use { it.readBytes() }
                    socket.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\nContent-Type: ${if (path.endsWith("m3u8")) "application/vnd.apple.mpegurl" else "video/mp2t"}\r\n\r\n".toByteArray())
                        write(bytes); flush()
                    }
                }
            }
        }
        val candidate = Candidate("fixture", "fixture", "fixture", "fixture", "127.0.0.1", "http://127.0.0.1:${server.localPort}/fixture.m3u8", container = Container.HLS, resolvedAt = 0, expiresAt = Long.MAX_VALUE)
        val result = AtomicReference<ClipExporter.Result>()
        val done = CountDownLatch(1)
        var exporter: ClipExporter? = null
        try {
            instrumentation.runOnMainSync {
                exporter = ClipExporter(context, OkHttpClient())
                exporter!!.export(candidate, ClipRange(8500, 28500, 15000), 6000, {}, { result.set(it); done.countDown() })
            }
            assertTrue("export timed out", done.await(120, TimeUnit.SECONDS))
            val exported = result.get()
            assertTrue("$exported", exported is ClipExporter.Result.Done)
            val file = (exported as ClipExporter.Result.Done).file
            MediaMetadataRetriever().use { retriever ->
                retriever.setDataSource(file.absolutePath)
                val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong()
                assertTrue("duration=$duration", kotlin.math.abs(duration - 20000) <= 150)
                assertNotNull(retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST))
            }
            val saved = exporter!!.saveToGallery(file, "VANTARA-test-exact20s")
            assertNotNull(saved)
            context.contentResolver.openInputStream(saved!!).use { input ->
                assertNotNull(input)
                assertEquals(file.length(), input!!.readBytes().size.toLong())
            }
            context.contentResolver.delete(saved, null, null)
        } finally {
            instrumentation.runOnMainSync { exporter?.let { it.cancel(); it.purge() } }
            server.close(); worker.join(1000)
        }
    }
}
