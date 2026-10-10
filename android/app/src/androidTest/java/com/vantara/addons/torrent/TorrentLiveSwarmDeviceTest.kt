package com.vantara.addons.torrent

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
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
 * Fixtures: Blender open movies (CC-BY) with long-lived public swarms. The first archive.org
 * fixture had zero peers for 3 minutes: its torrents rely on HTTP webseeds that a bare magnet
 * never learns about, so it said nothing about the engine. Each fixture is tried in turn and the
 * timeline records DHT nodes too, to tell "no network" from "no peers" from "engine stuck".
 * Opt-in (-e liveTorrent 1) because it depends on the public internet.
 */
@RunWith(AndroidJUnit4::class)
class TorrentLiveSwarmDeviceTest {
    private val trackers = listOf(
        "tracker:udp://tracker.opentrackr.org:1337/announce", "tracker:udp://explodie.org:6969",
        "tracker:udp://open.stealth.si:80/announce", "tracker:udp://tracker.torrent.eu.org:451/announce",
        "tracker:udp://exodus.desync.com:6969/announce", "tracker:udp://tracker.openbittorrent.com:6969/announce",
    )
    private val fixtures = listOf(
        "Sintel" to "08ada5a7a6183aae1e09d831df6748d566095a10",
        "Big Buck Bunny" to "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c",
        "Tears of Steel" to "209c8226b299b308beaf2b9cd3fb49212dbd13ec",
        "Cosmos Laundromat" to "c9e15763f722f23e98a29decdfae341b98d53056",
    )

    @Test fun realSwarmMagnetReachesFirstFrameAndSeeks() {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("live swarm test is opt-in", args.getString("liveTorrent") == "1")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val results = JSONArray()
        val proof = JSONObject().put("results", results)
        val proofFile = File(context.filesDir, "addon-proof/live-torrent.json").apply { parentFile!!.mkdirs() }
        val engine = TorrentEngine(context)
        try {
            for ((name, hash) in fixtures) {
                val result = attempt(engine, name, hash)
                results.put(result)
                proofFile.writeText(proof.toString(2))
                if (result.optBoolean("passed")) { proof.put("passed", true).put("winner", name); break }
            }
            if (!proof.optBoolean("passed")) proof.put("passed", false)
        } finally {
            proofFile.writeText(proof.toString(2))
            engine.close()
        }
        assertTrue("No fixture reached first frame + seek from a real swarm", proof.optBoolean("passed"))
    }

    private fun attempt(engine: TorrentEngine, name: String, hash: String): JSONObject {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        File(context.cacheDir, "torrent-streams/$hash").deleteRecursively()
        val uri = engine.register(TorrentRequest(hash, null, trackers))
        val result = JSONObject().put("name", name).put("infoHash", hash)
        val timeline = JSONArray()
        val begun = SystemClock.elapsedRealtime()
        fun mark(event: String) {
            val s = engine.stats(uri)
            timeline.put(JSONObject().put("t", SystemClock.elapsedRealtime() - begun).put("event", event).put("dht", engine.dhtNodes())
                .put("peers", s?.peers).put("seeds", s?.seeds).put("rate", s?.downloadBytesPerSecond).put("done", s?.totalDone).put("metadata", s?.metadata))
        }
        val sampler = Thread {
            try { while (!Thread.currentThread().isInterrupted) { Thread.sleep(3000); mark("sample") } } catch (_: InterruptedException) {}
        }.apply { isDaemon = true }
        val firstFrame = CountDownLatch(1)
        val soughtFrame = CountDownLatch(1)
        val seeking = AtomicBoolean(false)
        val failure = AtomicReference<Throwable?>()
        val consumer = HandlerThread("LiveTorrentFrames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ reader -> reader.acquireLatestImage()?.close() }, Handler(consumer.looper))
        var player: ExoPlayer? = null
        try {
            sampler.start()
            instrumentation.runOnMainSync {
                val p = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(engine.dataSourceFactory(DefaultDataSource.Factory(context)))).build()
                player = p
                p.setVideoSurface(images.surface)
                p.addListener(object : Player.Listener {
                    override fun onRenderedFirstFrame() { mark("firstFrame"); firstFrame.countDown() }
                    override fun onPlaybackStateChanged(state: Int) { mark("state:$state") }
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        mark("error:${error.errorCodeName}:${error.cause}"); failure.set(error); firstFrame.countDown(); soughtFrame.countDown()
                    }
                })
                p.setVideoFrameMetadataListener { presentationTimeUs, _, _, _ ->
                    if (seeking.get() && presentationTimeUs >= 60_000_000) soughtFrame.countDown()
                }
                p.setMediaItem(MediaItem.fromUri(uri))
                p.prepare(); p.play()
            }
            val gotFrame = firstFrame.await(150, TimeUnit.SECONDS) && failure.get() == null
            result.put("firstFrame", gotFrame).put("firstFrameMs", SystemClock.elapsedRealtime() - begun)
            if (gotFrame) {
                instrumentation.runOnMainSync { seeking.set(true); mark("seek:60s"); player!!.seekTo(60_000) }
                val seekStart = SystemClock.elapsedRealtime()
                val gotSeek = soughtFrame.await(120, TimeUnit.SECONDS) && failure.get() == null
                result.put("decodedAfterSeek", gotSeek).put("seekMs", SystemClock.elapsedRealtime() - seekStart)
                instrumentation.runOnMainSync { result.put("videoWidth", player!!.videoFormat?.width).put("videoHeight", player!!.videoFormat?.height) }
                result.put("passed", gotSeek)
            } else result.put("passed", false).put("failure", failure.get()?.cause?.toString() ?: "no first frame within 150s")
        } catch (error: Throwable) {
            result.put("passed", false).put("failure", error.toString())
        } finally {
            sampler.interrupt()
            mark("end")
            runCatching { instrumentation.runOnMainSync { player?.release() } }
            images.close(); consumer.quitSafely()
            result.put("elapsedMs", SystemClock.elapsedRealtime() - begun).put("timeline", timeline)
            engine.release(uri)
        }
        return result
    }
}
