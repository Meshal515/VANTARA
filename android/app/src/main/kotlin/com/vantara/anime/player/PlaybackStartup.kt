package com.vantara.anime.player

/** Attempt-scoped output evidence. Deadlines count only foreground, unpaused playback time. */
internal class PlaybackStartup(private val now: () -> Long) {
    enum class Output { VIDEO, AUDIO_ONLY }
    enum class Timeout { STARTUP_TIMEOUT, FIRST_VIDEO_FRAME_TIMEOUT, FIRST_AUDIO_OUTPUT_TIMEOUT, UNKNOWN_OUTPUT_TIMEOUT }
    var output: Output? = null; private set
    private var id: String? = null
    private var startupBudget = 0L
    private var outputBudget = 0L
    private var elapsed = 0L
    private var last = 0L
    private var playing = false
    private var readyAt: Long? = null
    private var video = false
    private var audio = false
    private var audioAdvanced = false

    fun begin(id: String, startupMs: Long, outputMs: Long) {
        this.id = id; output = null; elapsed = 0; last = now(); playing = false
        readyAt = null; video = false; audio = false; audioAdvanced = false
        startupBudget = startupMs; outputBudget = outputMs
    }
    private fun tick() { val time = now(); if (playing) elapsed += (time - last).coerceAtLeast(0); last = time }
    fun active(value: Boolean) { tick(); playing = value }
    fun ready(id: String) { if (id != this.id) return; tick(); if (readyAt == null) readyAt = elapsed; audioOutput() }
    fun tracks(id: String, video: Boolean, audio: Boolean) {
        if (id != this.id) return
        this.video = video; this.audio = audio; audioOutput()
    }
    fun frame(id: String) { if (id == this.id && this.id != null) output = Output.VIDEO }
    fun audio(id: String) { if (id != this.id) return; audioAdvanced = true; audioOutput() }
    private fun audioOutput() {
        if (output == null && readyAt != null && !video && audio && audioAdvanced) output = Output.AUDIO_ONLY
    }
    fun cancel() { tick(); id = null; playing = false; output = null }
    fun timeout(): Timeout? {
        tick()
        if (id == null || !playing || output != null) return null
        if (elapsed >= startupBudget) return Timeout.STARTUP_TIMEOUT
        if (readyAt?.let { elapsed - it >= outputBudget } != true) return null
        return when { video -> Timeout.FIRST_VIDEO_FRAME_TIMEOUT; audio -> Timeout.FIRST_AUDIO_OUTPUT_TIMEOUT; else -> Timeout.UNKNOWN_OUTPUT_TIMEOUT }
    }
}
