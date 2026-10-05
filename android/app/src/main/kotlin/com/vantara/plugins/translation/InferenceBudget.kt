package com.vantara.plugins.translation

import java.util.concurrent.CancellationException

/** Native owner remains acquired until run exits; cancellation requests termination, never closes a session. */
class InferenceBudget(milliseconds: Long, private val now: () -> Long = { System.nanoTime() / 1_000_000 }) {
    private val deadline = now() + milliseconds
    private var cancelled = false
    private val runs = LinkedHashSet<() -> Unit>()
    @Synchronized fun remainingMs(): Long = maxOf(0, deadline - now())
    @Synchronized fun check() {
        if (cancelled || now() >= deadline) throw CancellationException("native inference budget expired")
    }
    @Synchronized fun attach(terminate: () -> Unit): AutoCloseable {
        check()
        runs.add(terminate)
        return AutoCloseable { synchronized(this) { runs.remove(terminate) } }
    }
    @Synchronized fun cancel() {
        if (cancelled) return
        cancelled = true
        // Invoke under the lifetime lock: detach/RunOptions.close cannot race a stale callback.
        for (terminate in runs) runCatching { terminate() }
    }
    @Synchronized fun activeRuns() = runs.size
}
