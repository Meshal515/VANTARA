package com.vantara.anime

import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchSlotsTest {
    @Test
    fun aSlowSourceIsNotCancelledAndFreesItsSlotForTheNextOne() = runBlocking {
        val gate = Semaphore(1)
        val order = mutableListOf<String>()
        val t0 = System.nanoTime()
        var fastAt = 0L
        val slow = launch { SearchSlots.hold(gate, 150) { delay(900); order += "slow" } }
        val fast = launch { SearchSlots.hold(gate, 150) { delay(20); fastAt = (System.nanoTime() - t0) / 1_000_000; order += "fast" } }
        slow.join(); fast.join()
        // The slow one was not cut at its slot: its result still arrives (before: cancelled + recorded as a timeout).
        assertEquals(listOf("fast", "slow"), order)
        // The source queued behind it starts when the slot is handed back, not when the slow one finishes.
        assertTrue("fast finished at $fastAt ms", fastAt in 150..700)
        assertEquals(1, gate.availablePermits)
    }

    @Test
    fun aFastSourceReleasesItsSlotWhenItAnswers() = runBlocking {
        val gate = Semaphore(1)
        val t0 = System.nanoTime()
        SearchSlots.hold(gate, 5_000) { delay(30) }
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 2_000)
        assertEquals(1, gate.availablePermits)
    }

    @Test
    fun aFailingSourceStillGivesItsSlotBack() = runBlocking {
        val gate = Semaphore(1)
        runCatching { SearchSlots.hold(gate, 5_000) { error("site changed") } }
        assertEquals(1, gate.availablePermits)
    }
}
