package com.vantara.anime.player

internal class SkipLoadState(private val clock: () -> Long = System::currentTimeMillis) {
    data class Token(val key: String, val durationMs: Long, val generation: Int)
    var result: SkipRepository.Result? = null
        private set
    var pending = false
        private set
    private var key: String? = null
    private var durationMs = 0L
    private var generation = 0
    private var attempts = 0
    private var retryAt = 0L
    private var serviceRetryAt = 0L
    private var active: Token? = null
    val cooldownLeftMs: Long get() = (serviceRetryAt - clock()).coerceAtLeast(0)

    fun begin(key: String, durationMs: Long, force: Boolean = false): Token? {
        if (durationMs <= 0) return null
        if (this.key != key || kotlin.math.abs(this.durationMs - durationMs) > 1_000) {
            clear()
            this.key = key
            this.durationMs = durationMs
        }
        val now = clock()
        if (pending || now < serviceRetryAt) return null
        if (!force && (attempts >= 3 || now < retryAt || result?.status?.let { it != SkipRepository.Status.FAILED } == true)) return null
        if (force) attempts = 0
        attempts++
        generation++
        pending = true
        return Token(key, durationMs, generation).also { active = it }
    }

    fun complete(token: Token, value: SkipRepository.Result): Boolean {
        if (active != token) return false
        pending = false
        active = null
        result = value
        serviceRetryAt = clock() + value.retryAfterMs
        retryAt = if (value.status == SkipRepository.Status.FAILED) maxOf(serviceRetryAt, clock() + 30_000) else Long.MAX_VALUE
        return true
    }

    fun clear() {
        generation++
        key = null
        result = null
        active = null
        pending = false
        attempts = 0
        retryAt = 0
        // A server switch does not lift a service-wide Retry-After.
    }
}
