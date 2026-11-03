package com.vantara.anime.player

import android.graphics.ImageFormat
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.TrackRef
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Authored 12s H.264/AAC/tx3g fixture and separate AAC track; no external service or consent. */
@RunWith(AndroidJUnit4::class)
class CandidateExternalAudioDeviceTest {
    @Test fun embeddedTracksRemainAvailableAndExternalAudioCanBeSelectedAndSought() = playAndSelect("alternate.m4a")

    @Test fun extraVideoAndTextInAnAudioSidecarNeverCompeteWithThePrimary() = playAndSelect("primary.mp4")

    @Test fun retryWithoutSidecarsPreservesPrimaryMimeAndSubtitleConfiguration() {
        val factory = DefaultDataSource.Factory(InstrumentationRegistry.getInstrumentation().context)
        for ((container, mime) in listOf(Container.HLS to "application/x-mpegURL", Container.DASH to "application/dash+xml")) {
            val candidate = Candidate("retry", "fixture", "fixture", "fixture", "local", "https://example.test/signed?id=1",
                container = container, subtitles = listOf(TrackRef("https://example.test/sub.srt?token=x", "ar")),
                audio = listOf(TrackRef("https://example.test/audio.m4a", "ja")), resolvedAt = 0, expiresAt = Long.MAX_VALUE)
            val built = CandidateMediaSources.create(candidate, factory, includeExternalAudio = false, mediaId = "attempt-42")
            assertEquals("attempt-42", built.mediaSource.mediaItem.mediaId)
            assertTrue(built.externalAudioUrls.isEmpty())
            val configuration = requireNotNull(built.mediaSource.mediaItem.localConfiguration)
            assertEquals(mime, configuration.mimeType)
            assertEquals(candidate.url, configuration.uri.toString())
            assertEquals("application/x-subrip", configuration.subtitleConfigurations.single().mimeType)
            assertEquals("ar", configuration.subtitleConfigurations.single().language)
        }
    }

    private fun playAndSelect(sidecar: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        // Test APK assets are accessed through the instrumentation context, not the app context.
        val sourceFactory = DefaultDataSource.Factory(instrumentation.context)
        val candidate = Candidate("external-audio", "fixture", "fixture", "fixture", "local",
            "asset:///player-audio/primary.mp4", container = Container.MP4,
            audio = listOf(TrackRef("asset:///player-audio/$sidecar", "ar")),
            subtitles = listOf(TrackRef("asset:///addon-http-proof.vtt", "en")), resolvedAt = 0, expiresAt = Long.MAX_VALUE)
        val frame = CountDownLatch(1)
        val selected = CountDownLatch(1)
        val externalDecoderFormat = CountDownLatch(1)
        val afterSeek = CountDownLatch(1)
        val progressed = CountDownLatch(1)
        val beyondShortSidecar = CountDownLatch(1)
        val embeddedDecoderAgain = CountDownLatch(1)
        val externalWasDecoded = java.util.concurrent.atomic.AtomicBoolean(false)
        val failure = AtomicReference<Throwable?>()
        val consumer = HandlerThread("ExternalAudioFrames").apply { start() }
        val images = ImageReader.newInstance(320, 180, ImageFormat.PRIVATE, 3)
        images.setOnImageAvailableListener({ it.acquireLatestImage()?.close() }, Handler(consumer.looper))
        var player: ExoPlayer? = null
        try {
            instrumentation.runOnMainSync {
                player = ExoPlayer.Builder(context).build().also { p ->
                    p.setVideoSurface(images.surface)
                    p.addListener(object : Player.Listener {
                        override fun onRenderedFirstFrame() { frame.countDown() }
                        override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                            if (tracks.groups.any { g -> g.type == C.TRACK_TYPE_AUDIO && (0 until g.length).any {
                                g.isTrackSelected(it) && g.getTrackFormat(it).id.orEmpty().contains("external-audio|")
                            } }) selected.countDown()
                        }
                        override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                            failure.set(error); frame.countDown(); selected.countDown(); afterSeek.countDown(); progressed.countDown()
                        }
                    })
                    p.addAnalyticsListener(object : AnalyticsListener {
                        override fun onAudioInputFormatChanged(eventTime: AnalyticsListener.EventTime,
                            format: androidx.media3.common.Format, decoderReuseEvaluation: androidx.media3.exoplayer.DecoderReuseEvaluation?) {
                            if (format.id.orEmpty().contains("external-audio|") && format.language == "ar") {
                                externalWasDecoded.set(true); externalDecoderFormat.countDown()
                            } else if (externalWasDecoded.get()) embeddedDecoderAgain.countDown()
                        }
                    })
                    p.setVideoFrameMetadataListener { timeUs, _, _, _ ->
                        if (timeUs >= 5_000_000) afterSeek.countDown()
                        if (timeUs >= 6_000_000) progressed.countDown()
                        if (timeUs >= 9_000_000) beyondShortSidecar.countDown()
                    }
                    val built = CandidateMediaSources.create(candidate, sourceFactory)
                    assertEquals(candidate.id, built.mediaSource.mediaItem.mediaId)
                    assertEquals(setOf(candidate.audio.single().url), built.externalAudioUrls)
                    assertTrue(built.rejectedAudio.isEmpty())
                    p.setMediaSource(built.mediaSource); p.prepare(); p.play()
                }
            }
            assertTrue("No decoded primary frame", frame.await(30, TimeUnit.SECONDS)); assertNull(failure.get())
            instrumentation.runOnMainSync {
                val p = requireNotNull(player)
                val groups = p.currentTracks.groups
                assertTrue("Short sidecar truncated the primary timeline", p.duration >= 11_900)
                assertEquals("External media must never add video tracks", 1, groups.filter { it.type == C.TRACK_TYPE_VIDEO }.sumOf { it.length })
                assertEquals("Embedded audio was lost", 2, groups.filter { it.type == C.TRACK_TYPE_AUDIO }.sumOf { it.length })
                assertEquals("Embedded or sidecar subtitles were lost", 2, groups.filter { it.type == C.TRACK_TYPE_TEXT }.sumOf { it.length })
                val external = groups.first { g -> g.type == C.TRACK_TYPE_AUDIO && g.getTrackFormat(0).id.orEmpty().contains("external-audio|") }
                assertEquals("ar", external.getTrackFormat(0).language)
                assertEquals("ar", external.getTrackFormat(0).label)
                assertFalse("Sidecar should not replace the default embedded track", external.isSelected)
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(external.mediaTrackGroup, 0)).build()
            }
            assertTrue("External track could not be selected", selected.await(15, TimeUnit.SECONDS)); assertNull(failure.get())
            assertTrue("External audio did not reach the decoder", externalDecoderFormat.await(15, TimeUnit.SECONDS)); assertNull(failure.get())
            instrumentation.runOnMainSync { player!!.seekTo(5000) }
            assertTrue("Video did not seek after switching audio", afterSeek.await(20, TimeUnit.SECONDS))
            assertTrue("Video stopped after switching audio", progressed.await(15, TimeUnit.SECONDS)); assertNull(failure.get())
            instrumentation.runOnMainSync {
                assertEquals("ar", player!!.audioFormat?.language)
                val counters = requireNotNull(player!!.audioDecoderCounters)
                counters.ensureUpdated()
                assertTrue("External audio never produced decoded output", counters.renderedOutputBufferCount > 0)
            }
            assertTrue("Short sidecar ended the primary video", beyondShortSidecar.await(20, TimeUnit.SECONDS)); assertNull(failure.get())
            instrumentation.runOnMainSync {
                val p = requireNotNull(player)
                val embedded = p.currentTracks.groups.first { g -> g.type == C.TRACK_TYPE_AUDIO && !g.getTrackFormat(0).id.orEmpty().contains("external-audio|") }
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(embedded.mediaTrackGroup, 0)).build()
            }
            assertTrue("Embedded audio did not resume after switching back", embeddedDecoderAgain.await(10, TimeUnit.SECONDS)); assertNull(failure.get())
            instrumentation.runOnMainSync {
                assertFalse(player!!.audioFormat?.id.orEmpty().contains("external-audio|"))
                android.util.Log.i("VantaraRuntime", "PHASE2_AUDIO_PROOF sidecar=$sidecar;primaryDurationMs=${player!!.duration};positionMs=${player!!.currentPosition};externalSelectedAndDecoded=true;seekContinued=true;primaryPassedShortSidecar=true;embeddedAudioRestored=true")
            }
        } finally {
            instrumentation.runOnMainSync { player?.release() }
            images.close(); consumer.quitSafely(); consumer.join(3000)
        }
    }
}
