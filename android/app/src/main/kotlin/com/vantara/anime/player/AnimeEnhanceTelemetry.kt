package com.vantara.anime.player

import android.opengl.GLES20

/**
 * Sparse debug-only GPU timing for the two-pass enhancer.
 *
 * OpenGL ES' Java wrapper doesn't expose EXT_disjoint_timer_query consistently across our minSdk,
 * so once every ~10 seconds we bracket the full restore+upscale path with glFinish(). This is NOT
 * used every frame and is intentionally only telemetry: normal frames stay fully asynchronous.
 */
object AnimeEnhanceTelemetry {
    @Volatile var sourceWidth: Int = 0
        private set
    @Volatile var sourceHeight: Int = 0
        private set
    @Volatile var outputWidth: Int = 0
        private set
    @Volatile var outputHeight: Int = 0
        private set
    @Volatile var profile: String = ""
        private set
    @Volatile var gpuMs: Float = 0f
        private set
    @Volatile var samples: Int = 0
        private set
    @Volatile var lastPass: String = "idle"
        private set

    private var lastSamplePtsUs = Long.MIN_VALUE
    private var pendingPtsUs = Long.MIN_VALUE
    private var pendingStartNs = 0L

    fun mark(pass: String) {
        lastPass = pass
    }

    fun configureSource(width: Int, height: Int, outWidth: Int, outHeight: Int) {
        sourceWidth = width
        sourceHeight = height
        outputWidth = outWidth
        outputHeight = outHeight
        profile = AnimeQualityTuning.profileName(height)
    }

    /** Called by the first pass on the GL thread. */
    fun beginFrame(presentationTimeUs: Long) {
        if (pendingPtsUs != Long.MIN_VALUE) return
        if (lastSamplePtsUs != Long.MIN_VALUE && presentationTimeUs - lastSamplePtsUs < 10_000_000L) return
        GLES20.glFinish()
        pendingPtsUs = presentationTimeUs
        pendingStartNs = System.nanoTime()
    }

    /** Called by the last pass on the same GL thread. */
    fun endFrame(presentationTimeUs: Long) {
        if (pendingPtsUs != presentationTimeUs || pendingStartNs == 0L) return
        GLES20.glFinish()
        val elapsedMs = (System.nanoTime() - pendingStartNs) / 1_000_000f
        gpuMs = if (samples == 0) elapsedMs else gpuMs * 0.72f + elapsedMs * 0.28f
        samples += 1
        lastSamplePtsUs = presentationTimeUs
        pendingPtsUs = Long.MIN_VALUE
        pendingStartNs = 0L
    }

    fun reset() {
        sourceWidth = 0
        sourceHeight = 0
        outputWidth = 0
        outputHeight = 0
        profile = ""
        gpuMs = 0f
        samples = 0
        lastPass = "idle"
        lastSamplePtsUs = Long.MIN_VALUE
        pendingPtsUs = Long.MIN_VALUE
        pendingStartNs = 0L
    }
}
