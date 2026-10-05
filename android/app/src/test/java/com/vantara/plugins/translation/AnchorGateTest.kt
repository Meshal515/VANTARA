package com.vantara.plugins.translation

import kotlinx.coroutines.*
import org.junit.Assert.*
import org.junit.Test

class AnchorGateTest {
    @Test fun `focused prefetch overtakes old reader work`() = runBlocking {
        val gate = PriorityGate()
        val hold = CompletableDeferred<Unit>()
        val order = arrayListOf<Int>()
        val p = PriorityGate.Page("c", 50)
        gate.focus(PriorityGate.Page("c", 0))
        val owner = async { gate.run(PriorityGate.ANALYZE_READER, Perf()) { runBlocking { hold.await() } } }
        delay(20)
        val old = async { gate.run(PriorityGate.ANALYZE_READER, Perf(), PriorityGate.Page("c", 51)) { order.add(51) } }
        val focused = async { gate.run(PriorityGate.ANALYZE_JOB, Perf(), p) { order.add(50) } }
        delay(20); gate.focus(p); hold.complete(Unit)
        withTimeout(1000) { listOf(owner, old, focused).awaitAll() }
        assertEquals(listOf(50, 51), order)
    }

    @Test fun `moving focus releases stale network reservation`() = runBlocking {
        val gate = PriorityGate()
        val old = PriorityGate.Page("c", 0)
        val current = PriorityGate.Page("c", 50)
        gate.focus(old); gate.expectRender(old)
        val waiting = async { gate.run(PriorityGate.ANALYZE_JOB, Perf(), current) { 42 } }
        delay(20); gate.focus(current)
        assertEquals(42, withTimeout(300) { waiting.await() })
    }
    @Test fun `current and near forward pages beat missed-behind then far future`() = runBlocking {
        val gate=PriorityGate();val entered=CompletableDeferred<Unit>();val hold=CompletableDeferred<Unit>();val order=arrayListOf<Int>()
        gate.focus(PriorityGate.Page("c",50),100)
        val owner=async(Dispatchers.Default) {gate.run(PriorityGate.ANALYZE_JOB,Perf()) {entered.complete(Unit);runBlocking {hold.await()}}}
        entered.await()
        val jobs=listOf(95,49,53,51,50).map {index->async {gate.run(PriorityGate.ANALYZE_JOB,Perf(),PriorityGate.Page("c",index)) {order.add(index)}}}
        delay(20);hold.complete(Unit)
        withTimeout(1000) {(jobs+owner).awaitAll()}
        assertEquals(listOf(50,51,53,49,95),order)
    }

}
