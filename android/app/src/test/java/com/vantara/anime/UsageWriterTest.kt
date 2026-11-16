package com.vantara.anime

import com.vantara.usage.UsageOwner
import com.vantara.usage.UsageWriter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class UsageWriterTest {
    private val manga = UsageOwner("u1", "manga", "m1", "M", null)
    private val other = UsageOwner("u1", "manga", "m2", "N", null)

    /** The journal write ends in fsync; on the main thread it froze the WebView's momentum every 5 s while reading. */
    @Test fun `a checkpoint never writes the journal on the calling thread`() {
        val queued = ArrayDeque<Runnable>()
        val written = mutableListOf<Triple<UsageOwner, Long, Long>>()
        val writer = UsageWriter({ o, ms, at -> written += Triple(o, ms, at) }, Executor { queued.addLast(it) })
        writer.write(manga, 5_000, 1_800_000_000_000)
        assertTrue(written.isEmpty())
        queued.removeFirst().run()
        assertEquals(listOf(Triple(manga, 5_000L, 1_800_000_000_000L)), written)
    }

    @Test fun `a failed write stays with its own work and lands before newer time`() {
        val queued = ArrayDeque<Runnable>()
        val written = mutableListOf<Pair<UsageOwner, Long>>()
        var failNext = true
        val writer = UsageWriter({ o, ms, _ -> if (failNext) { failNext = false; error("disk full") }; written += o to ms }, Executor { queued.addLast(it) })
        writer.write(manga, 5_000, 1)
        queued.removeFirst().run()
        assertTrue(written.isEmpty())
        writer.write(other, 3_000, 2)
        queued.removeFirst().run()
        assertEquals(listOf(manga to 5_000L, other to 3_000L), written)
    }

    @Test fun `drain waits for queued writes before the app leaves the foreground`() {
        val io = Executors.newSingleThreadExecutor()
        val written = mutableListOf<Long>()
        val writer = UsageWriter({ _, ms, _ -> Thread.sleep(50); synchronized(written) { written += ms } }, io)
        writer.write(manga, 1_000, 1)
        writer.write(manga, 2_000, 2)
        writer.drain(2_000)
        assertEquals(listOf(1_000L, 2_000L), synchronized(written) { written.toList() })
        io.shutdown(); io.awaitTermination(1, TimeUnit.SECONDS)
    }
}
