package com.vantara.plugins.translation

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ComputeSchedulingTest {
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    // Exact tail bytes of comictextdetector-seg.onnx (graph.input / graph.output ValueInfoProto).
    private val input = hex("0a06696d6167657312180a16080112120a0208010a0208030a030880080a03088008")
    private val output = hex("0a0373656712180a16080112120a0208010a0208010a030880080a03088008")

    @Test fun `ctd patch makes only H and W symbolic and keeps every length`() {
        val body = ByteArray(4096) { (it * 31).toByte() }
        val bytes = body + input + output
        val copy = bytes.copyOf()
        assertTrue(CtdDynamicModel.patch(copy))
        assertEquals(bytes.size, copy.size)
        assertArrayEquals("weights untouched", body, copy.copyOfRange(0, body.size))
        val inAt = body.size; val outAt = inAt + input.size
        assertArrayEquals(input.copyOfRange(0, input.size - 10), copy.copyOfRange(inAt, outAt - 10))
        assertArrayEquals(hex("0a031201680a03120177"), copy.copyOfRange(outAt - 10, outAt))
        assertArrayEquals(hex("0a031201680a03120177"), copy.copyOfRange(copy.size - 10, copy.size))
    }

    @Test fun `ctd patch refuses ambiguous or foreign models`() {
        assertFalse(CtdDynamicModel.patch(ByteArray(64)))
        assertFalse("descriptor twice", CtdDynamicModel.patch(input + input + output))
        assertNull(CtdDynamicModel.patchOffsets(input))
    }

    @Test fun `ctd dynamic sibling is generated once and refreshed when the source changes`() {
        val dir = createTempDir()
        try {
            val src = File(dir, "comictextdetector-seg.onnx").apply { writeBytes(ByteArray(1000) { 7 } + input + output) }
            val dyn = CtdDynamicModel.ensure(src)!!
            assertEquals(src.length(), dyn.length())
            val first = dyn.lastModified()
            assertEquals(dyn, CtdDynamicModel.ensure(src))
            assertEquals("reused", first, dyn.lastModified())
            assertNull(CtdDynamicModel.ensure(File(dir, "x.onnx").apply { writeBytes(ByteArray(10)) }))
        } finally { dir.deleteRecursively() }
    }

    @Test fun `tight canvases follow crop size at reference scale`() {
        val crops = listOf(Box(0, 0, 170, 170), Box(10, 400, 810, 1000))
        val t = RoiAtlas.tight(crops, scale = 1f)
        assertEquals(256, t[0].canvasW); assertEquals(256, t[0].canvasH)
        assertEquals(32, t[0].x); assertEquals(32, t[0].y)
        assertEquals(896, t[1].canvasW); assertEquals(704, t[1].canvasH)
        for (c in t) { assertEquals(0, c.canvasW % 64); assertEquals(0, c.canvasH % 64); assertTrue(c.x + c.w <= c.canvasW && c.y + c.h <= c.canvasH) }
        assertTrue("small crop: 16x fewer pixels than a 1024² pass", t[0].pixels * 16 <= 1024L * 1024)
        val big = RoiAtlas.tight(listOf(Box(0, 0, 2000, 300)), scale = 1f).single()
        assertEquals(1024, big.canvasW); assertTrue(big.w <= 1024)
    }

    @Test fun `tight extract maps the canvas window back to the source crop`() {
        val t = RoiAtlas.tight(listOf(Box(5, 5, 69, 37)), scale = 1f).single()
        val plane = Array(t.canvasH) { y -> FloatArray(t.canvasW) { x -> if (x >= t.x && y >= t.y && x < t.x + t.w && y < t.y + t.h) 1f else 0f } }
        val out = RoiAtlas.tightExtract(t, plane)
        assertEquals(64 * 32, out.size)
        assertTrue(out.all { it == 1f })
    }

    @Test fun `compute lock grants the best live priority, not arrival order`() {
        val lanes = InferenceLanes()
        val order = Collections.synchronizedList(ArrayList<String>())
        val holding = CountDownLatch(1); val release = CountDownLatch(1)
        val owner = Thread { lanes.run(InferenceWork.HEAVY) { holding.countDown(); release.await(5, TimeUnit.SECONDS) } }
        owner.start(); assertTrue(holding.await(5, TimeUnit.SECONDS))
        fun waiter(name: String, key: Long) = Thread {
            InferenceLanes.priority.set { key }
            lanes.run(InferenceWork.HEAVY) { order.add(name) }
        }
        val far = waiter("far-route", 1L shl 56).apply { start() }
        Thread.sleep(50)
        val visible = waiter("visible-analyze", 3L shl 40).apply { start() }
        Thread.sleep(50)
        release.countDown()
        owner.join(5000); far.join(5000); visible.join(5000)
        assertEquals(listOf("visible-analyze", "far-route"), order.toList())
    }

    @Test fun `expired budget leaves the compute queue without blocking others`() {
        val lanes = InferenceLanes()
        val holding = CountDownLatch(1); val release = CountDownLatch(1)
        val owner = Thread { lanes.run(InferenceWork.HEAVY) { holding.countDown(); release.await(5, TimeUnit.SECONDS) } }
        owner.start(); assertTrue(holding.await(5, TimeUnit.SECONDS))
        var cancelled = false
        val t = Thread { try { lanes.run(InferenceWork.HEAVY, InferenceBudget(30)) {} } catch (e: java.util.concurrent.CancellationException) { cancelled = true } }
        t.start(); t.join(5000)
        assertTrue(cancelled)
        release.countDown(); owner.join(5000)
        var ran = false
        lanes.run(InferenceWork.HEAVY) { ran = true }
        assertTrue(ran)
    }
}
