package com.vantara.anime.player

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl

/** Forward time is the goal; allocator bytes remain a hard guard for heavy videos. */
@UnstableApi
internal object PlaybackBuffering {
    private const val MIB = 1024L * 1024

    fun create(maxHeapBytes: Long): DefaultLoadControl {
        // The old automatic video target (~128 MiB) included 40 seconds behind.
        // At high bitrates that left only a few seconds ahead, even while paused.
        val bytes = (maxHeapBytes / 2).coerceIn(16 * MIB, 384 * MIB).toInt()
        val backMs = when {
            maxHeapBytes >= 768 * MIB -> 40_000
            maxHeapBytes >= 384 * MIB -> 10_000
            else -> 5_000
        }
        return DefaultLoadControl.Builder()
            .setBufferDurationsMs(50_000, 120_000, 1_500, 3_000)
            .setTargetBufferBytes(bytes)
            // Respect the heap guard rather than risking OOM to force 50s of 4K into RAM.
            .setPrioritizeTimeOverSizeThresholds(false)
            .setBackBuffer(backMs, true)
            .build()
    }
}
