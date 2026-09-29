package com.vantara.usage

/** Monotonic foreground clock; media position and speed are deliberately absent. */
class ForegroundTime(private val now: () -> Long) {
    fun sample(active: Boolean): Long = 0L
}
