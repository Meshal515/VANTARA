package com.vantara.plugins.translation

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * الأجزاء الخالصة من خط الترجمة على الجهاز، بلا أندرويد ولا نماذج: الأقنعة،
 * NMS، الشرائح، المعرّفات الثابتة، دمج الصناديق، تنقية قناع الحروف.
 * السلوك مطابق لنسخة Python المقيسة على الصفحات الحقيقية.
 */
class GeometryTest {

    @Test
    fun `nms keeps the strongest of overlapping boxes and every distinct box`() {
        val boxes = listOf(Box(0, 0, 100, 100), Box(5, 5, 105, 105), Box(300, 300, 400, 400))
        val keep = nms(boxes, floatArrayOf(0.6f, 0.9f, 0.5f), 0.5f)
        assertEquals(listOf(1, 2), keep)
    }

    @Test
    fun `vertical tiles cover the page with overlap and a full last tile`() {
        assertEquals(listOf(0 to 500), verticalTiles(500, 1000, 100))
        val tiles = verticalTiles(2316, 1080, 130)
        assertEquals(0, tiles.first().first)
        assertEquals(2316, tiles.last().second)
        assertTrue(tiles.all { it.second - it.first == 1080 })
        for (i in 1 until tiles.size) assertTrue(tiles[i].first < tiles[i - 1].second)
    }

    @Test
    fun `dilate grows, erode shrinks, and edges count as background for erosion`() {
        val m = ByteMask(20, 20)
        m.fillRect(8, 8, 12, 12)
        assertEquals(16, m.count())
        assertEquals(6 * 6, m.dilate(1).count())
        assertEquals(2 * 2, m.erode(1).count())
        val edge = ByteMask(10, 10)
        edge.fillRect(0, 0, 3, 3)
        assertEquals(1, edge.erode(1).count()) // يبقى مركزه وحده: الحافة خلفية
    }

    @Test
    fun `connected components separate islands and largestComponent keeps one`() {
        val m = ByteMask(30, 10)
        m.fillRect(1, 1, 5, 5)
        m.fillRect(20, 2, 28, 8)
        val (_, comps) = m.components(true)
        assertEquals(2, comps.size)
        assertEquals(48, m.largestComponent().count())
    }

    @Test
    fun `filledHoles fills a ring into a disc`() {
        val ring = ByteMask(12, 12)
        ring.fillRect(2, 2, 10, 10)
        ring.fillRect(4, 4, 8, 8, 0)
        assertEquals(64, ring.filledHoles().count())
    }

    @Test
    fun `chord returns the run containing the centre or the closest one`() {
        val m = ByteMask(20, 1)
        m.fillRect(2, 0, 6, 1)
        m.fillRect(10, 0, 18, 1)
        assertArrayEquals(intArrayOf(10, 17), m.chord(0, 12))
        assertArrayEquals(intArrayOf(2, 5), m.chord(0, 0))
        assertNull(m.chord(3, 5))
    }

    @Test
    fun `otsu splits a two-level image`() {
        val w = 10
        val gray = ByteArray(100) { if (it % w < 5) 30.toByte() else 220.toByte() }
        val thr = ByteMask.otsu(gray, w, 0, 0, 10, 10)
        assertTrue("threshold $thr", thr in 30..219)
    }

    @Test
    fun `stable ids depend on page hash and relative position only`() {
        val a = Regions.stableId("h", Box(100, 200, 300, 400), 1000, 2000)
        val b = Regions.stableId("h", Box(101, 201, 301, 401), 1000, 2000) // فرق 0.1%: نفس المعرّف
        val c = Regions.stableId("h", Box(200, 200, 400, 400), 1000, 2000)
        val d = Regions.stableId("other", Box(100, 200, 300, 400), 1000, 2000)
        assertEquals(a, b)
        assertFalse(a == c)
        assertFalse(a == d)
        assertTrue(a.matches(Regex("r[0-9a-f]{8}")))
    }

    @Test
    fun `duplicate text boxes merge into their union with the best score`() {
        val dets = listOf(
            Detection(Box(10, 10, 100, 50), 0.9f, "text_bubble"),
            Detection(Box(12, 12, 98, 60), 0.7f, "text_free"),
            Detection(Box(500, 500, 600, 540), 0.8f, "text_free"),
            Detection(Box(0, 0, 200, 200), 0.95f, "bubble"),
        )
        val merged = Regions.mergeTextBoxes(dets)
        assertEquals(2, merged.size)
        val first = merged.first { it.box.x1 == 10 }
        assertEquals(Box(10, 10, 100, 60), first.box)
        assertEquals(0.9f, first.score, 1e-6f)
        assertEquals("text_bubble", first.label)
    }

    @Test
    fun `refineGlyph keeps ink under the coarse mask and drops a stroke crossing the box`() {
        val w = 60; val h = 30
        val data = ByteArray(w * h * 3) { 255.toByte() } // أبيض
        // حرفان داكنان
        fun paint(x0: Int, y0: Int, x1: Int, y1: Int) { for (y in y0 until y1) for (x in x0 until x1) { val i = (y * w + x) * 3; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0 } }
        paint(10, 10, 16, 20); paint(20, 10, 26, 20)
        // خط رسم طويل يمرّ بالصندوق، خارج القناع الخشن غالبًا
        paint(0, 25, 60, 27)
        val img = RgbImage(w, h, data)
        val gray = img.gray()
        val coarse = ByteMask(w, h); coarse.fillRect(8, 8, 28, 22) // يغطي الحرفين ومسافة بينهما
        val refined = Regions.refineGlyph(img, gray, coarse, Box(8, 8, 28, 22))
        assertEquals(120, refined.count()) // بكسلات الحرفين فقط، لا الفراغ بينهما ولا الخط
        assertEquals(0.toByte(), refined[30, 25])
    }

    @Test
    fun `resize keeps size and colour for identity and halves correctly`() {
        val img = RgbImage(4, 2, ByteArray(24) { (it * 10).toByte() })
        assertArrayEquals(img.data, img.resize(4, 2).data)
        val small = img.resize(2, 1)
        assertEquals(2, small.width); assertEquals(1, small.height)
        assertNotNull(small.data)
    }
}
