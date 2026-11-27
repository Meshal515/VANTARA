package com.vantara.addons.torrent

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

/** شروط المالك (27 نوفمبر) لمخزن القراءات الصغيرة ([ReadChunk]) قبل نشره. */
class TorrentReadChunkTest {
    private val file = ByteArray(300_000) { (it * 31 + 7).toByte() }

    /** مصدر كالمحرك: يعيد ما هو متاح الآن من [available] بايت، ويسجل كم طُلب منه وكم مرة. */
    private class Source(private val file: ByteArray, var available: Int) {
        val asked = ArrayList<Int>()
        fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int {
            asked += count
            val n = minOf(count, available, file.size - position.toInt())
            if (n <= 0) return 0
            System.arraycopy(file, position.toInt(), target, offset, n)
            return n
        }
    }

    @Test fun `one available byte returns at once without waiting for the rest of the chunk`() {
        val chunk = ReadChunk(64 * 1024)
        val source = Source(file, available = 1)
        val out = ByteArray(1)
        val got = chunk.fill(1000, 64 * 1024, { b, o, n -> source.read(1000, b, o, n) }) { false }
        assertEquals("المحرك أعاد المتاح (بايتًا) ولم يُنتظر غيره", 1, got)
        assertEquals(listOf(64 * 1024), source.asked)
        assertEquals(1, chunk.take(1000, out, 0, 1) { true })
        assertEquals(file[1000], out[0])
        // البايت التالي غير مخزّن: يُطلب من المحرك من جديد (لا يُنتظر ما لم يصل)
        assertEquals(-1, chunk.take(1001, out, 0, 1) { true })
    }

    @Test fun `thousands of tiny reads cost one engine call per chunk and return the exact bytes`() {
        val chunk = ReadChunk(64 * 1024)
        val source = Source(file, available = Int.MAX_VALUE)
        val seen = ByteArray(200_000)
        var position = 0L
        while (position < seen.size) {
            val want = 1 + (position % 7).toInt()
            var n = chunk.take(position, seen, position.toInt(), minOf(want, seen.size - position.toInt())) { true }
            if (n < 0) {
                val at = position
                chunk.fill(at, minOf(64 * 1024, seen.size - at.toInt()), { b, o, c -> source.read(at, b, o, c) }) { false }
                n = chunk.take(position, seen, position.toInt(), minOf(want, seen.size - position.toInt())) { true }
            }
            position += n
        }
        assertArrayEquals(file.copyOf(200_000), seen)
        assertEquals("200KB بقراءات 1–7 بايت: أربع كتل لا ~50 ألف استدعاء", 4, source.asked.size)
    }

    @Test fun `reset on a new open or range drops the buffer, and nothing outside what was fetched is served`() {
        val chunk = ReadChunk(64 * 1024)
        val source = Source(file, available = Int.MAX_VALUE)
        chunk.fill(5000, 4096, { b, o, n -> source.read(5000, b, o, n) }) { false }
        val out = ByteArray(16)
        assertEquals("لا يُجلب أكثر من المتبقي من نطاق الطلب", listOf(4096), source.asked)
        assertEquals(-1, chunk.take(4999, out, 0, 1) { true })
        assertEquals(-1, chunk.take(5000 + 4096, out, 0, 1) { true })
        assertEquals(16, chunk.take(5000 + 4080, out, 0, 64) { true }) // لا يتجاوز آخر ما جُلب
        chunk.reset()
        assertEquals("فتح جديد (ملف آخر أو نطاق آخر): لا شيء من المخزن", -1, chunk.take(5000, out, 0, 1) { true })
    }

    @Test fun `bytes read before verification are dropped when the engine stops trusting early reads`() {
        val chunk = ReadChunk(64 * 1024)
        val source = Source(file, available = Int.MAX_VALUE)
        chunk.fill(0, 64 * 1024, { b, o, n -> source.read(0, b, o, n) }) { true }
        val out = ByteArray(8)
        assertEquals(8, chunk.take(0, out, 0, 8) { true })
        // فشل تحقق قطعة قُرئت مبكرًا: ما بقي في المخزن منها لا يُسلَّم، ويبقى مرميًّا
        assertEquals(-1, chunk.take(8, out, 0, 8) { false })
        assertEquals(-1, chunk.take(8, out, 0, 8) { true })
        // الموثق لا يتأثر بثقة القراءة المبكرة
        chunk.fill(100, 1024, { b, o, n -> source.read(100, b, o, n) }) { false }
        assertEquals(8, chunk.take(100, out, 0, 8) { false })
    }
}
