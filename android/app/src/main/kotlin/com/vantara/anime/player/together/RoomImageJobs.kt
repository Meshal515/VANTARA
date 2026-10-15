package com.vantara.anime.player.together

import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException

/** Image decoding stays off the UI thread; result delivery belongs to the room lifetime. */
internal class RoomImageJobs<T>(
    private val post: (() -> Unit) -> Unit,
    private val io: ExecutorService = Executors.newFixedThreadPool(2),
) : AutoCloseable {
    @Volatile private var closed = false

    fun load(read: () -> T?, done: (T?) -> Unit) {
        if (closed) return
        try {
            io.execute {
                if (closed) return@execute
                val value = runCatching(read).getOrNull()
                if (!closed) post { if (!closed) done(value) }
            }
        } catch (error: RejectedExecutionException) {
            if (!closed) throw error
        }
    }

    override fun close() { closed = true; io.shutdownNow() }
}
