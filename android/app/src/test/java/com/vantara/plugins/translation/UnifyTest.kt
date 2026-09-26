package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * فقاعة واحدة = جملة واحدة: الكاشف قد يقسم فقاعة إلى صندوقين (فتُترجم مرتين)،
 * وقد يفوته سطر كامل (فيبقى إنجليزيًّا تحت العربي). التجميع يدمجهما في منطقة واحدة
 * بكل حبرها، ويترك الفقاعتين المتباعدتين والنص خارج الفقاعات كما هي.
 */
class UnifyTest {
    private val w = 320
    private val h = 240

    private fun white(): RgbImage {
        val img = RgbImage(w, h, ByteArray(w * h * 3))
        java.util.Arrays.fill(img.data, 250.toByte())
        return img
    }

    private fun ellipse(cx: Double, cy: Double, rx: Double, ry: Double): ByteMask {
        val m = ByteMask(w, h)
        for (y in 0 until h) for (x in 0 until w) if (Math.pow((x - cx) / rx, 2.0) + Math.pow((y - cy) / ry, 2.0) <= 1.0) m[x, y] = 1
        return m
    }

    /** سطر نص: حروف 8×14 بمسافة 3. */
    private fun line(mask: ByteMask, x: Int, y: Int, letters: Int) {
        for (k in 0 until letters) mask.fillRect(x + k * 11, y, x + k * 11 + 8, y + 14)
    }

    private fun region(id: String, glyph: ByteMask, bubble: Bubble?): Region {
        val b = glyph.bounds()!!
        return Region(id, Box(b[0], b[1], b[2], b[3]), 0.9f, "speech", bubble, bubble?.box, glyph, glyph.count(), false)
    }

    @Test
    fun `a bubble split in two plus a missed line becomes one region with all its ink`() {
        val img = white()
        val gray = ByteArray(w * h) { 250.toByte() }
        val bubble = Bubble(Box(40, 20, 280, 200), 0.9f, ellipse(160.0, 110.0, 120.0, 90.0))
        val top = ByteMask(w, h).also { line(it, 100, 60, 10) }
        val middle = ByteMask(w, h).also { line(it, 100, 82, 10) }
        val missed = ByteMask(w, h).also { line(it, 110, 104, 8) } // «MEAN YOU'RE»: لا صندوق له
        val full = top.or(middle).or(missed)

        val out = Regions.unify(img, gray, "page", listOf(region("a", top, bubble), region("b", middle, bubble)), listOf(bubble), full)

        assertEquals(1, out.size)
        val r = out[0]
        assertSame(bubble, r.bubble)
        for (m in listOf(top, middle, missed)) {
            val b = m.bounds()!!
            for (y in b[1] until b[3]) for (x in b[0] until b[2]) if (m[x, y].toInt() != 0) assertTrue("ink at $x,$y", r.glyph[x, y].toInt() != 0)
        }
        assertTrue(r.box.y2 >= 118)
        assertTrue(r.box.y1 <= 60)
    }

    @Test
    fun `a lone region keeps its id, far groups and text outside bubbles stay apart`() {
        val img = white()
        val gray = ByteArray(w * h) { 250.toByte() }
        // فقاعتان ملتحمتان كفقاعة واحدة كبيرة: سطر فوق وسطر بعيد تحت
        val bubble = Bubble(Box(10, 5, 310, 235), 0.9f, ellipse(160.0, 120.0, 150.0, 115.0))
        val upper = ByteMask(w, h).also { line(it, 110, 30, 8) }
        val lower = ByteMask(w, h).also { line(it, 110, 190, 8) }
        val free = ByteMask(w, h).also { line(it, 2, 2, 1) }
        val regions = listOf(region("up", upper, bubble), region("low", lower, bubble), region("free", free, null))
        val out = Regions.unify(img, gray, "page", regions, listOf(bubble), upper.or(lower).or(free))
        assertEquals(setOf("up", "low", "free"), out.map { it.id }.toSet())
        assertSame(regions[2], out.first { it.id == "free" })
    }

    @Test
    fun `lines missed above the detected box join one after another`() {
        val img = white()
        val gray = ByteArray(w * h) { 250.toByte() }
        val bubble = Bubble(Box(40, 10, 280, 230), 0.9f, ellipse(160.0, 120.0, 120.0, 110.0))
        // الكاشف أخذ السطر الأخير وحده، وفوقه أربعة أسطر (أبعدها بعيد عن الصندوق)
        val last = ByteMask(w, h).also { line(it, 100, 170, 10) }
        val above = ByteMask(w, h).also { m -> for (k in 1..4) line(m, 100, 170 - k * 22, 10) }
        val out = Regions.unify(img, gray, "page", listOf(region("last", last, bubble)), listOf(bubble), last.or(above))
        assertEquals(1, out.size)
        assertEquals("last", out[0].id)
        assertTrue("top line joined, box=${out[0].box}", out[0].box.y1 <= 170 - 4 * 22)
    }
}
