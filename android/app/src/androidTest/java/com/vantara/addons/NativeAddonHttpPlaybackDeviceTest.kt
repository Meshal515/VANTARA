package com.vantara.addons

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.Player
import androidx.media3.common.text.CueGroup
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.StreamProbe
import kotlinx.coroutines.Job
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.OkHttpClient
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Public HTTPS fixture -> normalized addon Candidate -> shared session -> Media3 first frame,
 * real soft-subtitle cue, seek and continuing frames. Does not claim to test JS installation UI. */
@RunWith(AndroidJUnit4::class)
class NativeAddonHttpPlaybackDeviceTest {
    @Test fun publicHttpsAddonCandidatePlaysSeeksAndLoadsRealSubtitle() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val videoUrl = requireNotNull(InstrumentationRegistry.getArguments().getString("addonHttpFixtureUrl")) { "Pinned public fixture URL required" }
        val subtitleUrl = InstrumentationRegistry.getArguments().getString("addonSubtitleFixtureUrl") ?: videoUrl.substringBeforeLast('/') + "/addon-http-proof.vtt"
        val begun = SystemClock.elapsedRealtime()
        val proof = JSONObject().put("fixtureHost", RemoteAddonClient.publicUrl(videoUrl).host)
        val proofFile = File(context.filesDir, "addon-proof/native-http.json").apply { parentFile!!.mkdirs() }
        val consumer = HandlerThread("AddonHttpProofFrames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ reader -> reader.acquireLatestImage()?.close() }, Handler(consumer.looper))
        var player: ExoPlayer? = null
        try {
            val raw = buildJsonArray { add(buildJsonObject {
                put("id", "public-http"); put("status", "RESOLVED"); put("url", videoUrl); put("type", "mp4")
                put("filename", "authored-proof.mp4")
                putJsonArray("subtitles") { add(buildJsonObject { put("url", subtitleUrl); put("lang", "ar") }) }
            }) }
            val c = NativeAddonCandidates.parse("proof", "addon|proof", "Authored proof", raw, System.currentTimeMillis()).single()
            val transport = nativeAddonMediaClient(OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build())
            assertTrue("Real public HTTPS candidate must pass video probe", StreamProbe.check(transport, c))
            val health = HealthStore(null)
            val prep = PreparedEpisode("proof", emptyList(), -1f, Preferences(), PlaybackSession(emptyList(), health), health, probe = true).also { it.job = Job() }
            prep.reserveAddonBatches(listOf(c.sourceId)); prep.finish()
            assertFalse(prep.done); assertTrue(prep.claimAddonBatch(c.sourceId))
            prep.adopt(c.sourceId, listOf(c)); prep.routeOf(c.id)?.let { prep.markProbe(it.id, true, 0, c.id) }; prep.finish()
            val selected = requireNotNull(prep.best())
            assertEquals(selected, prep.session.take(selected.id)); assertTrue(prep.done)
            val firstFrame = CountDownLatch(1)
            val cue = CountDownLatch(1)
            val sought = CountDownLatch(1)
            val progressed = CountDownLatch(1)
            val seeking = AtomicBoolean(false)
            val failure = AtomicReference<Throwable?>()
            instrumentation.runOnMainSync {
                player = ExoPlayer.Builder(context).setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(transport).setDefaultRequestProperties(selected.headers))).build().also { p ->
                    p.setVideoSurface(images.surface)
                    p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setPreferredTextLanguage("ar").build()
                    p.addListener(object : Player.Listener {
                        override fun onRenderedFirstFrame() { firstFrame.countDown() }
                        override fun onCues(cueGroup: CueGroup) {
                            if (cueGroup.cues.any { it.text.toString().contains("VANTARA_NATIVE_SUBTITLE_PROOF") }) cue.countDown()
                        }
                        override fun onPlayerError(error: androidx.media3.common.PlaybackException) { failure.set(error); firstFrame.countDown(); cue.countDown(); sought.countDown(); progressed.countDown() }
                    })
                    p.setVideoFrameMetadataListener { presentationTimeUs, _, _, _ ->
                        if (seeking.get() && presentationTimeUs >= 4_900_000) sought.countDown()
                        if (seeking.get() && presentationTimeUs >= 6_000_000) progressed.countDown()
                    }
                    val item = MediaItem.Builder().setUri(selected.url).setMimeType(MimeTypes.VIDEO_MP4)
                        .setSubtitleConfigurations(selected.subtitles.map { t -> MediaItem.SubtitleConfiguration.Builder(android.net.Uri.parse(t.url)).setMimeType(MimeTypes.TEXT_VTT).setLanguage(t.lang).setSelectionFlags(C.SELECTION_FLAG_DEFAULT).build() }).build()
                    p.setMediaItem(item); p.prepare(); p.play()
                }
            }
            assertTrue("No real first frame", firstFrame.await(60, TimeUnit.SECONDS)); assertNull(failure.get())
            proof.put("firstFrame", true).put("firstFrameElapsedMs", SystemClock.elapsedRealtime() - begun)
            assertTrue("No real external subtitle cue", cue.await(20, TimeUnit.SECONDS)); assertNull(failure.get())
            proof.put("externalSubtitleCue", true)
            instrumentation.runOnMainSync { seeking.set(true); player!!.seekTo(5000) }
            assertTrue("No frame after seek", sought.await(30, TimeUnit.SECONDS))
            assertTrue("Playback stopped after seek", progressed.await(15, TimeUnit.SECONDS)); assertNull(failure.get())
            instrumentation.runOnMainSync {
                proof.put("positionMs", player!!.currentPosition).put("videoWidth", player!!.videoFormat?.width).put("videoHeight", player!!.videoFormat?.height)
                assertEquals(1, player!!.mediaItemCount)
            }
            proof.put("decodedAfterSeek", true).put("continuedPastSixSeconds", true).put("passed", true)
            prep.job?.cancel()
        } catch (error: Throwable) {
            proof.put("passed", false).put("failure", error.toString()); throw error
        } finally {
            instrumentation.runOnMainSync { player?.release() }
            images.close(); consumer.quitSafely(); consumer.join(3000)
            proof.put("elapsedMs", SystemClock.elapsedRealtime() - begun); proofFile.writeText(proof.toString(2))
        }
    }
}
