package com.vantara.addons

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.media3.common.Player
import androidx.media3.common.text.CueGroup
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.health.HealthStore
import com.vantara.anime.player.CandidateMediaSources
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.StreamProbe
import kotlinx.coroutines.Job
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
                putJsonArray("subtitles") { add(buildJsonObject { put("url", subtitleUrl); put("lang", "en") }) }
            }) }
            val c = NativeAddonCandidates.parse("proof", "addon|proof", "Authored proof", raw, System.currentTimeMillis()).single()
            val transport = nativeAddonMediaClient(OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build())
            assertTrue("Real public HTTPS candidate must pass video probe", runBlocking { withTimeout(15_000) { StreamProbe.checkCancellable(transport, c) } })
            val health = HealthStore(null)
            val prep = PreparedEpisode("proof", emptyList(), -1f, Preferences(), PlaybackSession(emptyList(), health), health, probe = true).also { it.job = Job() }
            prep.reserveAddonBatches(listOf(c.sourceId)); prep.finish()
            assertFalse(prep.done); assertTrue(prep.claimAddonBatch(c.sourceId))
            prep.adopt(c.sourceId, listOf(c)); prep.routeOf(c.id)?.let { prep.markProbe(it.id, true, 0, c.id) }; prep.finish()
            val selected = requireNotNull(prep.best())
            assertEquals(selected, prep.session.take(selected.id)); assertTrue(prep.done)
            // The cue the player must show is read from the very file it loads (CI may pass another fixture than
            // the authored asset): its exact text, at its own time. A hard-coded phrase silently mismatched the
            // fixture actually served and the gate failed with «No real external subtitle cue».
            val authored = requireNotNull(FirstCue.of(transport.newCall(okhttp3.Request.Builder().url(subtitleUrl).build()).execute().use { it.body!!.string() })) { "Subtitle fixture has no cue" }
            proof.put("expectedCue", authored.text).put("cueStartMs", authored.startMs).put("cueEndMs", authored.endMs)
            val cueAt = java.util.concurrent.atomic.AtomicLong(-1)
            val firstFrame = CountDownLatch(1)
            val cue = CountDownLatch(1)
            val sought = CountDownLatch(1)
            val progressed = CountDownLatch(1)
            val seeking = AtomicBoolean(false)
            val failure = AtomicReference<Throwable?>()
            instrumentation.runOnMainSync {
                player = ExoPlayer.Builder(context).build().also { p ->
                    p.setVideoSurface(images.surface)
                    p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setPreferredTextLanguage("en").build()
                    p.addListener(object : Player.Listener {
                        override fun onRenderedFirstFrame() { firstFrame.countDown() }
                        override fun onCues(cueGroup: CueGroup) {
                            if (cueAt.get() < 0 && cueGroup.cues.any { it.text.toString().contains(authored.text) }) { cueAt.set(player!!.currentPosition); cue.countDown() }
                        }
                        override fun onPlayerError(error: androidx.media3.common.PlaybackException) { failure.set(error); firstFrame.countDown(); cue.countDown(); sought.countDown(); progressed.countDown() }
                    })
                    p.setVideoFrameMetadataListener { presentationTimeUs, _, _, _ ->
                        if (seeking.get() && presentationTimeUs >= 4_900_000) sought.countDown()
                        if (seeking.get() && presentationTimeUs >= 6_000_000) progressed.countDown()
                    }
                    val built = CandidateMediaSources.create(selected, OkHttpDataSource.Factory(transport).setDefaultRequestProperties(selected.headers))
                    p.setMediaSource(built.mediaSource); p.prepare(); p.play()
                }
            }
            assertTrue("No real first frame", firstFrame.await(60, TimeUnit.SECONDS)); assertNull(failure.get())
            proof.put("firstFrame", true).put("firstFrameElapsedMs", SystemClock.elapsedRealtime() - begun)
            assertTrue("No real external subtitle cue «${authored.text}»", cue.await(20, TimeUnit.SECONDS)); assertNull(failure.get())
            // Shown at its own time (decoder/clock slack only), not just somewhere in the stream.
            assertTrue("Cue shown at ${cueAt.get()} ms, outside ${authored.startMs}..${authored.endMs} ms", cueAt.get() in (authored.startMs - 750)..(authored.endMs + 750))
            proof.put("externalSubtitleCue", true).put("cueShownAtMs", cueAt.get())
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
            android.util.Log.i("VantaraRuntime", "PHASE2_PUBLIC_HTTP_PROOF ${proof}")
        }
    }
}

/** First cue of a WebVTT file: its first text line and its time window. */
internal data class FirstCue(val text: String, val startMs: Long, val endMs: Long) {
    companion object {
        private val TIMING = Regex("""((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{3})""")
        fun ms(t: String): Long = t.replace(',', '.').split(':').let { p ->
            val (sec, milli) = p.last().split('.').let { it[0].toLong() to it[1].toLong() }
            val minutes = p[p.size - 2].toLong(); val hours = if (p.size == 3) p[0].toLong() else 0L
            ((hours * 60 + minutes) * 60 + sec) * 1000 + milli
        }
        fun of(vtt: String): FirstCue? {
            val lines = vtt.lines()
            for ((i, line) in lines.withIndex()) {
                val m = TIMING.find(line) ?: continue
                val text = lines.drop(i + 1).firstOrNull { it.isNotBlank() }?.trim() ?: return null
                return FirstCue(text, ms(m.groupValues[1]), ms(m.groupValues[2]))
            }
            return null
        }
    }
}
