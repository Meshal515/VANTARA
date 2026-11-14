package com.vantara.anime

import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withTimeoutOrNull

/**
 * One parallel slot of the general search. A source keeps its slot for the normal budget only, so a slow source
 * never delays the ones queued behind it; past that it keeps searching outside the gate (its own ceiling decides
 * when it is given up) instead of being cancelled, since the source page searches the same source with no cap.
 */
internal object SearchSlots {
    suspend fun hold(gate: Semaphore, slotMs: Long, work: suspend () -> Unit) = coroutineScope {
        gate.acquire()
        var held = true
        fun release() { if (held) { held = false; gate.release() } }
        try {
            val job = launch { work() }
            withTimeoutOrNull(slotMs) { job.join() }
            release()
            job.join()
        } finally {
            release()
        }
    }
}
