package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * The path a Torrentio choice takes on the phone, against a REAL public swarm: magnet only (no
 * webseed, no cached metadata), production public-only IP filter, metadata from peers, Media3
 * progressive extraction (which closes/reopens the reader on its seeks), first frame, then a seek.
 *
 * Fixture: Big Buck Bunny (CC-BY Blender Foundation) as seeded by archive.org's own BitTorrent
 * seeders. Opt-in (-e liveTorrent 1) because it depends on the public internet.
 */
@RunWith(AndroidJUnit4::class)
class TorrentLiveSwarmDeviceTest {
    @Test fun realSwarmMagnetReachesFirstFrameAndSeeks() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("live swarm test is opt-in", args.getString("liveTorrent") == "1")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val hash = "8337c196d4536e9af5d2c7e599f0f1b7d71eee54"
        File(context.cacheDir, "torrent-streams/$hash").deleteRecursively()
        val engine = TorrentEngine(context)
        val uri = engine.register(TorrentRequest(hash, 10, listOf(
            "tracker:http://bt1.archive.org:6969/announce",
            "tracker:http://bt2.archive.org:6969/announce",
            "tracker:udp://tracker.opentrackr.org:1337/announce",
        )))
        val proof = JSONObject().put("infoHash", hash).put("fileIdx", 10)
        val timeline = JSONArray()
        val begun = SystemClock.elapsedRealtime()
        fun mark(event: String) {
            val s = engine.stats(uri)
            timeline.put(JSONObject().put("t", SystemClock.elapsedRealtime() - begun).put("event", event)
                .put("peers", s?.peers).put("seeds", s?.seeds).put("rate", s?.downloadBytesPerSecond).put("done", s?.totalDone).put("metadata", s?.metadata))
        }
        val proofFile = File(context.filesDir, "addon-proof/live-torrent.json").apply { parentFile!!.mkdirs() }
        val sampler = Thread {
            try { while (!Thread.currentThread().isInterrupted) { Thread.sleep(2000); mark("sample") } } catch (_: InterruptedException) {}
        }.apply { isDaemon = true }
        val firstFrame = CountDownLatch(1)
        val soughtFrame = CountDownLatch(1)
        val seeking = AtomicBoolean(false)
        val failure = AtomicReference<Throwable?>()
        val consumer = HandlerThread("LiveTorrentFrames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ reader -> reader.acquireLatestImage()?.close() }, Handler(consumer.looper))
        lateinit var player: ExoPlayer
        try {
            sampler.start()
            instrumentation.runOnMainSync {
                player = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(engine.dataSourceFactory(DefaultDataSource.Factory(context)))).build()
                player.setVideoSurface(images.surface)
                player.addListener(object : Player.Listener {
                    override fun onRenderedFirstFrame() { mark("firstFrame"); firstFrame.countDown() }
                    override fun onPlaybackStateChanged(state: Int) { mark("state:$state") }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        mark("error:${error.errorCodeName}:${error.cause}"); failure.set(error); firstFrame.countDown(); soughtFrame.countDown()
                    }
                })
                player.setVideoFrameMetadataListener { presentationTimeUs, _, _, _ ->
                    if (seeking.get() && presentationTimeUs >= 300_000_000) soughtFrame.countDown()
                }
                player.setMediaItem(MediaItem.Builder().setUri(uri).setMimeType(MimeTypes.VIDEO_MP4).build())
                player.prepare(); player.play()
            }
            val gotFrame = firstFrame.await(240, TimeUnit.SECONDS)
            proof.put("firstFrame", gotFrame && failure.get() == null).put("firstFrameMs", SystemClock.elapsedRealtime() - begun)
            assertTrue("No first frame from the real swarm within 240s", gotFrame)
            assertNull("Playback failed", failure.get())
            instrumentation.runOnMainSync { seeking.set(true); mark("seek:300s"); player.seekTo(300_000) }
            val seekStart = SystemClock.elapsedRealtime()
            val gotSeek = soughtFrame.await(120, TimeUnit.SECONDS)
            proof.put("decodedAfterSeek", gotSeek && failure.get() == null).put("seekMs", SystemClock.elapsedRealtime() - seekStart)
            assertTrue("No frame after seeking into the real swarm", gotSeek)
            assertNull(failure.get())
            instrumentation.runOnMainSync { proof.put("videoWidth", player.videoFormat?.width).put("videoHeight", player.videoFormat?.height) }
            proof.put("passed", true)
        } catch (error: Throwable) {
            proof.put("passed", false).put("failure", error.toString())
            throw error
        } finally {
            sampler.interrupt()
            mark("end")
            runCatching { instrumentation.runOnMainSync { player.release() } }
            images.close(); consumer.quitSafely()
            proof.put("elapsedMs", SystemClock.elapsedRealtime() - begun).put("timeline", timeline)
            proofFile.writeText(proof.toString(2))
            engine.release(uri); engine.close()
        }
    }
}
