package com.vantara.plugins.translation

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Collections

/** الدور: كشف الصفحة الحالية، ثم Render جاهز، ثم بقية الكشف، ثم Analyze الثقيل. */
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
    fun `reader pages go by distance from the page in front of you within the same class`() = runBlocking {
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
        gate.focus(PriorityGate.Page("c1", 6))
        val job = async { gate.run(PriorityGate.ANALYZE_JOB, Perf()) { order.add("job") } }
        delay(20)
        holding.complete(Unit)
        (waiting + first + job).awaitAll()
        assertEquals(listOf("p0", "p6", "p3", "p2", "p1", "next-chapter", "job"), order)
    }

    @Test
    fun `moving one page ahead finishes the previous render before heavy analysis`() = runBlocking {
        val gate = PriorityGate()
        val order = Collections.synchronizedList(ArrayList<String>())
        val holding = CompletableDeferred<Unit>()
        gate.focus(PriorityGate.Page("c1", 0))
        val holder = async {
            gate.run(PriorityGate.ANALYZE_READER, Perf(), PriorityGate.Page("c1", 0)) {
                runBlocking { holding.await() }
                order.add("holder")
            }
        }
        delay(40)
        val previousRender = async {
            gate.run(PriorityGate.RENDER_READER, Perf(), PriorityGate.Page("c1", 0)) { order.add("p0-render") }
        }
        val currentDetect = async {
            gate.run(PriorityGate.DETECT, Perf(), PriorityGate.Page("c1", 1)) { order.add("p1-detect") }
        }
        val currentAnalyze = async {
            gate.run(PriorityGate.ANALYZE_READER, Perf(), PriorityGate.Page("c1", 1)) { order.add("p1-analyze") }
        }
        delay(40)
        gate.focus(PriorityGate.Page("c1", 1))
        holding.complete(Unit)
        listOf(holder, previousRender, currentDetect, currentAnalyze).awaitAll()

        assertEquals(listOf("holder", "p1-detect", "p0-render", "p1-analyze"), order)
    }

    @Test
    fun `heavy analysis waits for Luna render but light detect may continue`() = runBlocking {
        val gate = PriorityGate()
        val order = Collections.synchronizedList(ArrayList<String>())
        val p0 = PriorityGate.Page("c", 0)
        val p1 = PriorityGate.Page("c", 1)
        gate.focus(p0)
        gate.expectRender(p0)

        val heavy = async { gate.run(PriorityGate.ANALYZE_READER, Perf(), p1) { order.add("p1-heavy") } }
        delay(30)
        assertFalse(heavy.isCompleted)

        val detect = async { gate.run(PriorityGate.DETECT, Perf(), p1) { order.add("p1-detect") } }
        detect.await()
        assertFalse(heavy.isCompleted)

        val render = async { gate.run(PriorityGate.RENDER_READER, Perf(), p0) { order.add("p0-render") } }
        render.await()
        heavy.await()
        assertEquals(listOf("p1-detect", "p0-render", "p1-heavy"), order)
    }

    @Test
    fun `failed Luna releases reserved reader slot`() = runBlocking {
        val gate = PriorityGate()
        val p0 = PriorityGate.Page("c", 0)
        val p1 = PriorityGate.Page("c", 1)
        gate.expectRender(p0)
        val heavy = async { gate.run(PriorityGate.ANALYZE_READER, Perf(), p1) { "done" } }
        delay(30)
        assertFalse(heavy.isCompleted)
        gate.cancelExpectedRender(p0)
        assertEquals("done", heavy.await())
    }

    @Test
    fun `busy state is visible while a model owns the gate`() = runBlocking {
        val gate = PriorityGate()
        val hold = CompletableDeferred<Unit>()
        val work = async {
            gate.run(PriorityGate.ANALYZE_READER, Perf(), PriorityGate.Page("c", 0)) {
                runBlocking { hold.await() }
            }
        }
        delay(30)
        assertTrue(gate.isBusy())
        hold.complete(Unit)
        work.await()
        assertFalse(gate.isBusy())
    }
    @Test
    fun `current and next three beat missed behind, then missed behind beats far future`() = runBlocking {
        val gate = PriorityGate()
        val order = Collections.synchronizedList(ArrayList<String>())
        val holding = CompletableDeferred<Unit>()
        val holder = async { gate.run(PriorityGate.BACKGROUND, Perf()) { runBlocking { holding.await() }; order.add("holder") } }
        delay(30)
        gate.focus(PriorityGate.Page("c", 30), 100)
        val pages = listOf(95,34,28,29,31,32,33,30).map { index ->
            async { gate.run(PriorityGate.ANALYZE_READER, Perf(), PriorityGate.Page("c", index)) { order.add("p$index") } }.also { delay(10) }
        }
        holding.complete(Unit)
        (pages + holder).awaitAll()
        assertEquals(listOf("holder","p30","p31","p32","p33","p29","p28","p34","p95"), order)
    }
}
