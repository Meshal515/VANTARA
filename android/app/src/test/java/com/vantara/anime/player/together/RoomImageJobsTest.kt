package com.vantara.anime.player.together

import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.*
import org.junit.Test

class RoomImageJobsTest {
    @Test fun leavingRoomBeforeLateImageRequestNeverThrowsOrStartsWork() {
        val read = AtomicBoolean(false)
        val jobs = RoomImageJobs<String>({ it() })
        jobs.close()
        jobs.load({ read.set(true); "late avatar" }) { fail("closed room received image") }
        assertFalse(read.get())
    }

    @Test fun queuedUiCallbackCannotTouchClosedRoom() {
        val callbacks = LinkedBlockingQueue<() -> Unit>()
        val jobs = RoomImageJobs<String>({ callbacks.put(it) })
        val delivered = AtomicBoolean(false)
        jobs.load({ "avatar" }) { delivered.set(true) }
        val callback = callbacks.poll(2, TimeUnit.SECONDS) ?: error("decoder did not finish")
        jobs.close()
        callback()
        assertFalse("stale image changed a destroyed view", delivered.get())
    }

    @Test fun openRoomGetsDecodedImageOnItsUiQueue() {
        val callbacks = LinkedBlockingQueue<() -> Unit>()
        val jobs = RoomImageJobs<String>({ callbacks.put(it) })
        var image: String? = null
        try {
            jobs.load({ "avatar" }) { image = it }
            val callback = callbacks.poll(2, TimeUnit.SECONDS) ?: error("decoder did not finish")
            assertNull(image)
            callback()
            assertEquals("avatar", image)
        } finally { jobs.close() }
    }

    @Test fun decodingInFlightAtExitCannotPublishAfterShutdown() {
        val reading = CountDownLatch(1)
        val release = CountDownLatch(1)
        val delivered = AtomicBoolean(false)
        val worker = Executors.newSingleThreadExecutor()
        val jobs = RoomImageJobs<String>({ it() }, worker)
        jobs.load({
            reading.countDown()
            try { release.await() } catch (_: InterruptedException) { /* emulate an image decoder finishing after cancellation */ }
            "late avatar"
        }) { delivered.set(true) }
        assertTrue(reading.await(2, TimeUnit.SECONDS))
        jobs.close()
        release.countDown()
        assertTrue(worker.awaitTermination(2, TimeUnit.SECONDS))
        // The worker's completion is fenced by close, even if its decoder ignores interruption.
        assertFalse(delivered.get())
    }
}
