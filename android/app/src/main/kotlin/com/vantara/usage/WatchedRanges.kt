package com.vantara.usage

import kotlinx.serialization.Serializable

@Serializable data class WatchedRange(val from: Long, val to: Long)

/** Union of actually traversed media, separate from foreground elapsed time. */
class WatchedRanges(initial: List<WatchedRange> = emptyList()) {
    private var ranges = initial.filter { it.from >= 0 && it.to > it.from }
    private var lastPosition: Long? = null
    private var lastPlaying = false

    fun sample(position: Long, playing: Boolean) {
        val previous = lastPosition
        if (lastPlaying && previous != null && position > previous) add(previous, position)
        lastPosition = position
        lastPlaying = playing
    }

    /** Media3 supplies both sides of a seek: close the old span, skip the jump. */
    fun seek(oldPosition: Long, newPosition: Long, playing: Boolean) {
        sample(oldPosition, false)
        lastPosition = newPosition
        lastPlaying = playing
    }

    private fun add(from: Long, to: Long) {
        val sorted = (ranges + WatchedRange(from, to)).sortedBy { it.from }
        val merged = mutableListOf<WatchedRange>()
        for (r in sorted) {
            val last = merged.lastOrNull()
            if (last != null && r.from <= last.to) merged[merged.lastIndex] = last.copy(to = maxOf(last.to, r.to))
            else merged += r
        }
        ranges = merged
    }
    fun snapshot(): List<WatchedRange> = ranges.toList()
    fun ratio(duration: Long): Double = if (duration <= 0) 0.0 else
        (ranges.sumOf { (minOf(it.to, duration) - it.from).coerceAtLeast(0) }.toDouble() / duration).coerceIn(0.0, 1.0)
}
