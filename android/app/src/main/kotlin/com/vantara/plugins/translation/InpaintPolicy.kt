package com.vantara.plugins.translation

/** Admission only; 1536 is never selected by a model name or CPU-core count alone. */
object InpaintPolicy {
    fun maxEdge(availableBytes: Long, lowMemory: Boolean, thermal: Int, heapLimitBytes: Long): Int =
        if (!lowMemory && thermal <= 1 && availableBytes >= 768L * 1024 * 1024 && heapLimitBytes >= 256L * 1024 * 1024) 1536 else 1024
}
