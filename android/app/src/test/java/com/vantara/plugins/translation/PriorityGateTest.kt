package com.vantara.plugins.translation

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Collections

/** الدور بترتيب ثابت: الكشف، ثم إكمال صفحة القارئ، ثم تحليلها، ثم المقدّمة؛ ومن وصل أولًا في الرتبة نفسها. */
class PriorityGateTest {
    @Test
    fun `waiting pages go by rank, then by arrival`() = runBlocking {
        val gate = PriorityGate()
        val order = Collections.synchronizedList(ArrayList<String>())
        val holding = CompletableDeferred<Unit>()
        val first = async { gate.run(PriorityGate.ANALYZE_JOB, Perf()) { runBlocking { holding.await() }; order.add("holder") } }
        delay(50)
        val waiting = listOf(
            "job-analyze-1" to PriorityGate.ANALYZE_JOB,
            "job-render" to PriorityGate.RENDER_JOB,
            "reader-analyze" to PriorityGate.ANALYZE_READER,
            "job-analyze-2" to PriorityGate.ANALYZE_JOB,
            "detect" to PriorityGate.DETECT,
            "reader-render" to PriorityGate.RENDER_READER,
        ).map { (name, rank) ->
            async { gate.run(rank, Perf()) { order.add(name) } }.also { delay(20) }
        }
        holding.complete(Unit)
        (waiting + first).awaitAll()
        assertEquals(listOf("holder", "detect", "reader-render", "reader-analyze", "job-render", "job-analyze-1", "job-analyze-2"), order)
    }

    @Test
    fun `reader pages go by distance from the page in front of you, decided at hand-over`() = runBlocking {
        val gate = PriorityGate()
        val order = Collections.synchronizedList(ArrayList<String>())
        val holding = CompletableDeferred<Unit>()
        gate.focus(PriorityGate.Page("c1", 0))
        val first = async { gate.run(PriorityGate.ANALYZE_READER, Perf(), PriorityGate.Page("c1", 0)) { runBlocking { holding.await() }; order.add("p0") } }
        delay(50)
        val waiting = listOf(
            "p1" to PriorityGate.Page("c1", 1),
            "p2" to PriorityGate.Page("c1", 2),
            "p3" to PriorityGate.Page("c1", 3),
            "p6" to PriorityGate.Page("c1", 6),
            "next-chapter" to PriorityGate.Page("c2", 0),
        ).map { (name, page) ->
            async { gate.run(PriorityGate.ANALYZE_READER, Perf(), page) { order.add(name) } }.also { delay(20) }
        }
        // قفزت للصفحة 6 وهي في الانتظار: تتقدّم على ما طُلب قبلها
        gate.focus(PriorityGate.Page("c1", 6))
        val job = async { gate.run(PriorityGate.ANALYZE_JOB, Perf()) { order.add("job") } }
        delay(20)
        holding.complete(Unit)
        (waiting + first + job).awaitAll()
        assertEquals(listOf("p0", "p6", "p3", "p2", "p1", "next-chapter", "job"), order)
    }
}
