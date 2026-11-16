package com.vantara.anime.player

import org.junit.Assert.*
import org.junit.Test

class PlaybackStartupTest {
    private var clock = 1_000L
    private val monitor = PlaybackStartup { clock }
    private fun begin(id: String = "a") { monitor.begin(id, 15_000, 8_000); monitor.active(true) }
    @Test fun readyDoesNotProveVideoOutput() {
        begin(); monitor.tracks("a", true, true); monitor.ready("a")
        assertNull(monitor.output); clock += 8_000
        assertEquals(PlaybackStartup.Timeout.FIRST_VIDEO_FRAME_TIMEOUT, monitor.timeout())
    }
    @Test fun actualFrameSucceedsEvenBeforeReady() {
        begin(); monitor.frame("a")
        assertEquals(PlaybackStartup.Output.VIDEO, monitor.output)
        clock += 90_000; assertNull(monitor.timeout())
    }
    @Test fun audioRequiresKnownAudioOnlyTracksAndOutput() {
        begin(); monitor.ready("a"); monitor.tracks("a", false, true)
        assertNull(monitor.output); monitor.audio("a")
        assertEquals(PlaybackStartup.Output.AUDIO_ONLY, monitor.output)
    }
    @Test fun audioAdvancingDoesNotProveVideoOutput() {
        begin(); monitor.tracks("a", true, true); monitor.ready("a"); monitor.audio("a")
        assertNull(monitor.output)
        clock += 8_000; assertEquals(PlaybackStartup.Timeout.FIRST_VIDEO_FRAME_TIMEOUT, monitor.timeout())
    }
    @Test fun unknownTracksAreNotAudioOnly() {
        begin(); monitor.ready("a"); monitor.tracks("a", false, false); monitor.audio("a")
        assertNull(monitor.output)
        clock += 8_000; assertEquals(PlaybackStartup.Timeout.UNKNOWN_OUTPUT_TIMEOUT, monitor.timeout())
    }
    @Test fun audioOutputCanArriveBeforeTracksButStillNeedsReady() {
        begin(); monitor.audio("a"); monitor.tracks("a", false, true)
        assertNull(monitor.output); monitor.ready("a")
        assertEquals(PlaybackStartup.Output.AUDIO_ONLY, monitor.output)
    }
    @Test fun repeatedReadyCannotRestartFirstFrameDeadline() {
        begin(); monitor.tracks("a", true, false); monitor.ready("a")
        clock += 7_000; monitor.ready("a"); clock += 1_000
        assertEquals(PlaybackStartup.Timeout.FIRST_VIDEO_FRAME_TIMEOUT, monitor.timeout())
    }
    @Test fun readyDoesNotExtendTotalStartupBudget() {
        begin(); clock += 14_000; monitor.ready("a"); clock += 1_000
        assertEquals(PlaybackStartup.Timeout.STARTUP_TIMEOUT, monitor.timeout())
    }
    @Test fun pauseSuspendsDeadlinesAndResumeUsesRemainingBudget() {
        begin(); monitor.tracks("a", true, false); monitor.ready("a"); clock += 7_000
        monitor.active(false); clock += 100_000; assertNull(monitor.timeout())
        monitor.active(true); clock += 999; assertNull(monitor.timeout()); clock++
        assertEquals(PlaybackStartup.Timeout.FIRST_VIDEO_FRAME_TIMEOUT, monitor.timeout())
    }
    @Test fun replacedAttemptRejectsStaleFramesReadyAudioAndTracks() {
        begin(); begin("b"); monitor.frame("a"); monitor.ready("a"); monitor.audio("a"); monitor.tracks("a", false, true)
        assertNull(monitor.output); clock += 15_000
        assertEquals(PlaybackStartup.Timeout.STARTUP_TIMEOUT, monitor.timeout())
    }
    @Test fun cancelInvalidatesEvidenceAndTimers() {
        begin(); monitor.cancel(); monitor.frame("a"); clock += 100_000
        assertNull(monitor.output); assertNull(monitor.timeout())
    }
    @Test fun readyAudioWithoutAdvancingHasOwnOutputTimeout() {
        begin(); monitor.tracks("a", false, true); monitor.ready("a"); clock += 8_000
        assertEquals(PlaybackStartup.Timeout.FIRST_AUDIO_OUTPUT_TIMEOUT, monitor.timeout())
    }
}
