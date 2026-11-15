package com.vantara.anime.player

import com.vantara.anime.stream.TrackRef
import org.junit.Assert.*
import org.junit.Test

class ExternalAudioPlanTest {
    @Test fun signedAudioUrlsKeepTheirLanguageAndContainer() {
        val tracks = listOf(TrackRef("https://cdn.example/voice.M4A?token=secret", "ar"),
            TrackRef("https://cdn.example/audio.m3u8?signature=x", "ja"),
            TrackRef("https://cdn.example/audio.mpd", "en"))
        val plan = ExternalAudioPlan.from(tracks)
        assertEquals(tracks, plan.accepted.map { it.track })
        assertEquals(listOf(ExternalAudioKind.PROGRESSIVE, ExternalAudioKind.HLS, ExternalAudioKind.DASH), plan.accepted.map { it.kind })
        assertTrue(plan.rejected.isEmpty())
    }

    @Test fun duplicateUrlsAreLoadedOnlyOnceEvenWhenLabelsDiffer() {
        val plan = ExternalAudioPlan.from(listOf(TrackRef("https://cdn.example/voice.mp3", "ar"), TrackRef("https://cdn.example/voice.mp3", "Arabic")))
        assertEquals(1, plan.accepted.size)
        assertEquals(ExternalAudioRejection.DUPLICATE, plan.rejected.single().reason)
    }

    @Test fun unsupportedOrInvalidUrlsAreReportedInsteadOfInventingAnAudioContainer() {
        val plan = ExternalAudioPlan.from(listOf(TrackRef("https://cdn.example/video.webm", "ar"),
            TrackRef("https://cdn.example/signed?id=1", "ja"), TrackRef("javascript:alert(1)", "en")))
        assertTrue(plan.accepted.isEmpty())
        assertEquals(listOf(ExternalAudioRejection.UNSUPPORTED_CONTAINER, ExternalAudioRejection.UNSUPPORTED_CONTAINER,
            ExternalAudioRejection.INVALID_URL), plan.rejected.map { it.reason })
    }

    @Test fun sidecarLoadingHasAFixedBound() {
        val tracks = (0..20).map { TrackRef("https://cdn.example/audio-$it.aac", "ar") }
        val plan = ExternalAudioPlan.from(tracks)
        assertEquals(8, plan.accepted.size)
        assertEquals(13, plan.rejected.size)
        assertTrue(plan.rejected.all { it.reason == ExternalAudioRejection.TRACK_LIMIT })
    }
}
