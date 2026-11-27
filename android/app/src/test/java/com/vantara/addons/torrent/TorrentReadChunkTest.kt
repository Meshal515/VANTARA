package com.vantara.addons.torrent

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** شروط المالك (27 نوفمبر) لمخزن القراءات الصغيرة ([ReadChunk]) قبل نشره. */
class TorrentReadChunkTest {
    private val file = ByteArray(3_000_000) { (it * 31 + 7).toByte() }

    /**
     * مصدر كالمحرك (Lease.read): يعيد ما هو متاح الآن من [available] بايت، ولا يعبر حد القطعة ([pieceLength])، ويسجل كم
     * طُلب منه وكم مرة.
     */
    private class Engine(private val file: ByteArray, var available: Int = Int.MAX_VALUE, private val pieceLength: Int = 512 * 1024) {
        val asked = ArrayList<Int>()
        fun read(position: Long, target: ByteArray, offset: Int, count: Int): Int {
            asked += count
            val toPieceEnd = pieceLength - (position % pieceLength).toInt()
            val n = minOf(count, available, toPieceEnd, file.size - position.toInt())
            if (n <= 0) return 0
            System.arraycopy(file, position.toInt(), target, offset, n)
            return n
        }
    }

    /** نفس منطق TorrentDataSource.read: المخزن أولًا، والصغير يملأه، والكبير مباشرة. */
    private fun read(chunk: ReadChunk?, engine: Engine, position: Long, target: ByteArray, offset: Int, want: Int, trust: () -> Int = { 0 }, early: Boolean = false): Int {
        if (chunk == null) return engine.read(position, target, offset, want)
        val held = chunk.take(position, target, offset, want, trust())
        if (held > 0) return held
        val size = minOf(64 * 1024, file.size - position.toInt())
        if (want >= size) return engine.read(position, target, offset, want)
        val got = chunk.fill(position, size, trust(), { b, o, n -> engine.read(position, b, o, n) }) { early }
        if (got <= 0) return got
        val n = chunk.take(position, target, offset, want, trust())
        return if (n > 0) n else engine.read(position, target, offset, want)
    }

    /** قراءة MKV للفهرس: عناصر صغيرة (1–7 بايت) متتالية من [from] حتى [to]. */
    private fun cues(chunk: ReadChunk?, engine: Engine, from: Long, to: Long): ByteArray {
        val seen = ByteArray((to - from).toInt())
        var position = from
        while (position < to) {
            val want = minOf(1 + (position % 7).toInt(), (to - position).toInt())
            val n = read(chunk, engine, position, seen, (position - from).toInt(), want)
            assertTrue(n > 0)
            position += n
        }
        return seen
    }

    @Test fun `one available byte returns at once without waiting for the rest of the chunk`() {
        val chunk = ReadChunk(64 * 1024)
        val engine = Engine(file, available = 1)
        val out = ByteArray(1)
        assertEquals("المحرك أعاد المتاح (بايتًا) ولم يُنتظر غيره", 1, read(chunk, engine, 1000, out, 0, 1))
        assertEquals(file[1000], out[0])
        assertEquals(listOf(64 * 1024), engine.asked)
        // البايت التالي لم يُجلب: يُطلب من المحرك (لا يُنتظر ما لم يصل، ولا يُعطى من المخزن ما ليس فيه)
        assertEquals(-1, chunk.take(1001, out, 0, 1, 0))
    }

    @Test fun `engine calls before and after the fix for a 519KB index read in 1–7 byte elements`() {
        val before = Engine(file)
        val after = Engine(file)
        val a = cues(null, before, 2_000_000, 2_000_000 + 519_160)
        val b = cues(ReadChunk(64 * 1024), after, 2_000_000, 2_000_000 + 519_160)
        assertArrayEquals(file.copyOfRange(2_000_000, 2_000_000 + 519_160), a)
        assertArrayEquals(a, b)
        println("CALLS before=${before.asked.size} after=${after.asked.size}")
        assertTrue("قبل: استدعاء لكل عنصر (~130 ألفًا)", before.asked.size > 100_000)
        assertTrue("بعد: كتلة 64KB لكل استدعاء تقريبًا، وحدود القطع تقطعها", after.asked.size <= 12)
    }

    @Test fun `reads across piece boundaries stay exact and never span two pieces in one engine call`() {
        val pieceLength = 512 * 1024
        val engine = Engine(file, pieceLength = pieceLength)
        val from = pieceLength - 3_000L
        val got = cues(ReadChunk(64 * 1024), engine, from, from + 10_000)
        assertArrayEquals(file.copyOfRange(from.toInt(), from.toInt() + 10_000), got)
        assertEquals("الأولى تقف عند حد القطعة، والثانية تبدأ منه", 2, engine.asked.size)
    }

    @Test fun `repeated forward and back seeks, new opens and file switches never serve stale bytes`() {
        val chunk = ReadChunk(64 * 1024)
        val engine = Engine(file)
        val other = ByteArray(file.size) { (it * 17 + 3).toByte() }
        val otherEngine = Engine(other)
        val out = ByteArray(32)
        var at = 1_000_000L
        for (step in listOf(+10_000L, -10_000L, +10_000L, -10_000L, +700_000L, -1_500_000L, +3L)) {
            at += step
            // كل قفزة في Media3 = فتح جديد (TorrentDataSource.open يفرّغ المخزن)
            chunk.reset()
            assertEquals(32, read(chunk, engine, at, out, 0, 32))
            assertArrayEquals("قفزة $step", file.copyOfRange(at.toInt(), at.toInt() + 32), out)
        }
        // ملف آخر (أو مصدر آخر) بالموضع نفسه: الفتح يفرّغ المخزن فلا يُعطى من الملف السابق
        chunk.reset()
        assertEquals(32, read(chunk, otherEngine, at, out, 0, 32))
        assertArrayEquals(other.copyOfRange(at.toInt(), at.toInt() + 32), out)
        // وبلا فتح جديد: ما خارج ما جُلب لا يُقدَّم من المخزن
        assertEquals(-1, chunk.take(at - 1, out, 0, 1, 0))
        assertEquals(-1, chunk.take(at + 64 * 1024, out, 0, 1, 0))
    }

    @Test fun `a hash failure while early bytes sit in the buffer drops them, verified bytes stay`() {
        val chunk = ReadChunk(64 * 1024)
        val engine = Engine(file)
        var trust = 0
        val out = ByteArray(8)
        assertEquals(8, read(chunk, engine, 0, out, 0, 8, { trust }, early = true))
        val calls = engine.asked.size
        // فشل تحقق في المحرك (جيل الثقة زاد): لا يُسلَّم ما بقي من المخزن، ويُطلب من المحرك (موثقًا هناك)
        trust++
        assertEquals(-1, chunk.take(8, out, 0, 8, trust))
        assertEquals(-1, chunk.take(8, out, 0, 8, trust))
        assertEquals(8, read(chunk, engine, 8, out, 0, 8, { trust }, early = false))
        assertTrue("طُلب من المحرك من جديد", engine.asked.size > calls)
        assertArrayEquals(file.copyOfRange(8, 16), out)
        // الموثق لا يتأثر بتغيّر الجيل
        trust++
        assertEquals(8, chunk.take(16, out, 0, 8, trust))
    }
}
