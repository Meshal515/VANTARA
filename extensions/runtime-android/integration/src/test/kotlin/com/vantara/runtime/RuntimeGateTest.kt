package com.vantara.runtime

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * البحث العام يسأل كل مصدر CloudStream بعدة أسماء معًا. مصدر لا يحجز الخانات بأسمائه بينما ينتظر الباقون،
 * وروابط الحلقة التي ينتظرها المستخدم تسبق البحث في الخلفية.
 */
class RuntimeGateTest {
    private suspend fun settle() = repeat(20) { yield() }

    @Test fun oneSourceCannotHoldEverySlotWhileOthersWait() = runBlocking {
        val gate = RuntimeGate(total = 2)
        val started = mutableListOf<String>()
        val release = CompletableDeferred<Unit>()
        // مصدر A بأربعة أسماء يصل أولًا، ثم B وC بطلب واحد لكل منهما
        val jobs = (listOf("A#1", "A#2", "A#3", "A#4", "B#1", "C#1")).map { name ->
            launch { gate.run(name.substringBefore('#'), urgent = false) { started += name; release.await() } }
        }
        settle()
        // خانتان: A مرة واحدة ثم B، لا A مرتين
        assertEquals(listOf("A#1", "B#1"), started)
        release.complete(Unit)
        jobs.forEach { it.join() }
        assertEquals(6, started.size)
        assertEquals(0, gate.active())
    }

    @Test fun playbackLinksJumpAheadOfBackgroundSearch() = runBlocking {
        val gate = RuntimeGate(total = 1)
        val order = mutableListOf<String>()
        val first = CompletableDeferred<Unit>()
        val busy = launch { gate.run("A", false) { order += "search A"; first.await() } }
        settle()
        val search = launch { gate.run("B", false) { order += "search B" } }
        val links = launch { gate.run("C", urgent = true) { order += "links C" } }
        settle()
        first.complete(Unit)
        listOf(busy, search, links).forEach { it.join() }
        assertEquals(listOf("search A", "links C", "search B"), order)
    }

    @Test fun aCancelledWaiterDoesNotLeakItsSlot() = runBlocking {
        val gate = RuntimeGate(total = 1)
        val hold = CompletableDeferred<Unit>()
        val busy = launch { gate.run("A", false) { hold.await() } }
        settle()
        val waiting = launch { gate.run("B", false) { } }
        settle()
        waiting.cancelAndJoin()
        hold.complete(Unit)
        busy.join()
        assertEquals(0, gate.active())
        assertEquals("ok", async { gate.run("C", false) { "ok" } }.await())
    }
}
