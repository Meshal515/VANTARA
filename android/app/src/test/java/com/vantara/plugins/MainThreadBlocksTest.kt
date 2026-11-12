package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MainThreadBlocksTest {
    @Test fun `a long main-thread message is kept with what ran, a short one is not`() {
        var t = 1_000L
        val watch = MainThreadBlocks({ t })
        watch.line(">>>>> Dispatching to Handler (android.view.Choreographer\$FrameHandler) {1} null: 0")
        t += 8
        watch.line("<<<<< Finished to Handler (android.view.Choreographer\$FrameHandler) {1} null")
        assertTrue(watch.snapshot().isEmpty())
        watch.line(">>>>> Dispatching to Handler (android.os.Handler) {2} com.vantara.usage.UsagePlugin\$tick\$1@3: 0")
        t += 4
        watch.sample = listOf("UsageJournal.save:30")
        assertEquals(4L, watch.runningFor())
        t += 70
        watch.line("<<<<< Finished to Handler (android.os.Handler) {2} com.vantara.usage.UsagePlugin\$tick\$1@3")
        val block = watch.snapshot().single()
        assertEquals(74L, block.ms)
        assertTrue(block.what.contains("UsagePlugin"))
        assertEquals(listOf("UsageJournal.save:30"), block.stack)
        assertEquals(0L, watch.runningFor())
    }

    @Test fun `only the most recent blocks are kept`() {
        var t = 0L
        val watch = MainThreadBlocks({ t }, keep = 3)
        repeat(5) { i ->
            watch.line(">>>>> Dispatching to message $i")
            t += 40
            watch.line("<<<<< Finished to message $i")
        }
        assertEquals(listOf("message 2", "message 3", "message 4"), watch.snapshot().map { it.what })
    }

    @Test fun `the stack sample skips the looper frames themselves`() {
        val frames = arrayOf(
            StackTraceElement("android.os.MessageQueue", "nativePollOnce", "MessageQueue.java", 1),
            StackTraceElement("android.os.Looper", "loopOnce", "Looper.java", 2),
            StackTraceElement("com.vantara.usage.UsageJournal", "save", "UsageJournal.kt", 30),
            StackTraceElement("com.vantara.usage.UsagePlugin", "checkpoint", "UsagePlugin.kt", 31),
        )
        assertEquals(listOf("UsageJournal.save:30", "UsagePlugin.checkpoint:31"), MainThreadBlocks.stackTop(frames))
    }

    @Test fun `each new blocking GC is recorded with its duration, the first reading only sets the baseline`() {
        var t = 0L
        val watch = MainThreadBlocks({ t })
        watch.gc(12, 300)
        assertTrue(watch.snapshot().isEmpty())
        watch.gc(12, 300)
        assertTrue(watch.snapshot().isEmpty())
        t = 500
        watch.gc(13, 345)
        val block = watch.snapshot().single()
        assertEquals(45L, block.ms)
        assertEquals("ART blocking GC ×1", block.what)
    }
}
