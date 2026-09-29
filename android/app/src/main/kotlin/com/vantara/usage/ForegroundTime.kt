package com.vantara.usage

/** Monotonic foreground clock; media position and speed are deliberately absent. */
class ForegroundTime(private val now: () -> Long) {
    private var last = now()
    private var counting = false
    fun sample(active: Boolean): Long {
        val at = now()
        val elapsed = if (counting) (at - last).coerceAtLeast(0) else 0L
        last = at
        counting = active
        return elapsed
    }
}
