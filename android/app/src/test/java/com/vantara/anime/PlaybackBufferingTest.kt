package com.vantara.anime

import androidx.media3.common.C
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.LoadControl
import androidx.media3.exoplayer.analytics.PlayerId
import androidx.media3.exoplayer.source.MediaSource
import com.vantara.anime.player.PlaybackBuffering
import org.junit.Assert.*
import org.junit.Test

class PlaybackBufferingTest {
    private fun parameters(bufferedMs: Long) = LoadControl.Parameters(
        PlayerId.UNSET, Timeline.EMPTY, MediaSource.MediaPeriodId(Any()),
        180_000_000, bufferedMs * 1000, 1f, true, false, C.TIME_UNSET, C.TIME_UNSET,
    )
    @Test fun `high bitrate buffer does not stop at five seconds after the old byte target`() {
        val control = PlaybackBuffering.create(512L * 1024 * 1024)
        control.onPrepared(PlayerId.UNSET)
        val pool = control.allocator
        val chunks = ArrayList<androidx.media3.exoplayer.upstream.Allocation>()
        try {
            while (pool.totalBytesAllocated < 132 * 1024 * 1024) chunks.add(pool.allocate())
            assertTrue(control.shouldContinueLoading(parameters(5_000)))
        } finally { chunks.forEach(pool::release); control.onReleased(PlayerId.UNSET) }
    }
    @Test fun `good connection may keep filling beyond fifty seconds but stops at two minutes`() {
        val control = PlaybackBuffering.create(512L * 1024 * 1024)
        control.onPrepared(PlayerId.UNSET)
        assertTrue(control.shouldContinueLoading(parameters(5_000)))
        assertTrue(control.shouldContinueLoading(parameters(70_000)))
        assertFalse(control.shouldContinueLoading(parameters(120_000)))
        assertFalse(control.shouldContinueLoading(parameters(70_000)))
        assertTrue(control.shouldContinueLoading(parameters(49_000)))
        control.onReleased(PlayerId.UNSET)
    }
    @Test fun `smaller heaps reserve forward memory instead of retaining forty seconds behind`() {
        val control = PlaybackBuffering.create(256L * 1024 * 1024)
        assertTrue(control.getBackBufferDurationUs(PlayerId.UNSET) <= 10_000_000)
    }
    @Test fun `memory guard still stops a heavy stream instead of exhausting a small heap`() {
        val control = PlaybackBuffering.create(64L * 1024 * 1024)
        control.onPrepared(PlayerId.UNSET)
        val pool = control.allocator
        val chunks = ArrayList<androidx.media3.exoplayer.upstream.Allocation>()
        try {
            while (pool.totalBytesAllocated < 32 * 1024 * 1024) chunks.add(pool.allocate())
            assertFalse(control.shouldContinueLoading(parameters(5_000)))
        } finally { chunks.forEach(pool::release); control.onReleased(PlayerId.UNSET) }
    }
    @Test fun `large forward buffer does not delay initial playback until fifty seconds`() {
        val control = PlaybackBuffering.create(512L * 1024 * 1024)
        control.onPrepared(PlayerId.UNSET)
        assertTrue(control.shouldStartPlayback(parameters(2_000)))
        control.onReleased(PlayerId.UNSET)
    }
}
