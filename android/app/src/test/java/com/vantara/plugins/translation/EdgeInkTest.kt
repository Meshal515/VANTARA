package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * فقاعة بيضاء بإطار أسود فوق حافة لوحة داكنة، ومضلّع الفقاعة المكتشف يقصر عن
 * يمينها: حروف إنجليزية هناك فاتها قناع الحروف. تُمسح كلها، والإطار والذيل
 * واللوحة الداكنة لا يُلمس منها بكسل.
 */
class EdgeInkTest {
    private val w = 400
    private val h = 260

    private fun page(): RgbImage {
        val img = RgbImage(w, h, ByteArray(w * h * 3))
        fun put(x: Int, y: Int, v: Int) { val i = (y * w + x) * 3; img.data[i] = v.toByte(); img.data[i + 1] = v.toByte(); img.data[i + 2] = v.toByte() }
        for (y in 0 until h) for (x in 0 until w) put(x, y, if (y < 90) 250 else 60) // أبيض فوق، لوحة داكنة تحت
        // الفقاعة: قطع ناقص أبيض بإطار أسود سميك
        for (y in 0 until h) for (x in 0 until w) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 130.0) / 90.0, 2.0)
            if (e <= 1.0) put(x, y, 250) else if (e <= 1.08) put(x, y, 15)
        }
        return img
    }

    private fun letter(img: RgbImage, x: Int, y: Int, gw: Int = 8, gh: Int = 16) {
        for (yy in y until y + gh) for (xx in x until x + gw) if (xx == x || xx == x + gw - 1 || yy == y || yy == y + gh - 1 || xx == x + 1) {
            val i = (yy * w + xx) * 3; img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 20
        }
    }

    @Test
    fun `English letters at the edge of a flat bubble are erased, outline and art untouched`() {
        val img = page()
        val known = ArrayList<IntArray>()
        val missed = ArrayList<IntArray>()
        for (row in 0 until 3) for (k in 0 until 10) {
            val x = 90 + k * 12; val y = 100 + row * 22
            letter(img, x, y); known.add(intArrayOf(x, y))
        }
        // «ou» و«l.» عند الحافة اليمنى: بعيدة عن القناع وخارج المضلّع المكتشف
        for ((x, y) in listOf(300 to 100, 312 to 100, 300 to 144, 312 to 144)) { letter(img, x, y); missed.add(intArrayOf(x, y)) }

        val glyph = ByteMask(w, h)
        for ((x, y) in known) glyph.fillRect(x, y, x + 8, y + 16)
        // مضلّع مكتشف يقصر عن يمين الفقاعة
        val bubble = ByteMask(w, h)
        for (y in 0 until h) for (x in 0 until 270) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 130.0) / 90.0, 2.0)
            if (e <= 1.0) bubble[x, y] = 1
        }
        val region = Region("r1", Box(90, 100, 210, 160), 0.9f, "speech", Bubble(Box(30, 40, 370, 220), 0.9f, bubble), null, glyph, glyph.count(), false)
        Cleaner.planErase(img, region, null)
        assertEquals("fill", region.cleanMode)
        val erase = region.eraseMask!!
        for ((x, y) in missed) for (yy in y until y + 16) for (xx in x until x + 8) {
            assertTrue("missed letter pixel at $xx,$yy", erase[xx, yy].toInt() != 0)
        }
        // لا شيء من الإطار ولا من اللوحة الداكنة خارج الفقاعة
        for (y in 0 until h) for (x in 0 until w) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 130.0) / 90.0, 2.0)
            if (e > 1.0) assertEquals("outside bubble at $x,$y", 0, erase[x, y].toInt())
        }
    }

    @Test
    fun `a large drawing enclosed in the bubble is left alone`() {
        val img = page()
        for (k in 0 until 10) letter(img, 90 + k * 12, 110)
        // رسم كبير (قلب/شعار) داخل الفقاعة على سطر النص
        for (y in 95 until 175) for (x in 250 until 330) { val i = (y * w + x) * 3; img.data[i] = 30; img.data[i + 1] = 30; img.data[i + 2] = 30 }
        val glyph = ByteMask(w, h)
        for (k in 0 until 10) glyph.fillRect(90 + k * 12, 110, 98 + k * 12, 126)
        val bubble = ByteMask(w, h)
        for (y in 0 until h) for (x in 0 until w) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 130.0) / 90.0, 2.0)
            if (e <= 1.0) bubble[x, y] = 1
        }
        val region = Region("r1", Box(90, 110, 210, 126), 0.9f, "speech", Bubble(Box(30, 40, 370, 220), 0.9f, bubble), null, glyph, glyph.count(), false)
        Cleaner.planErase(img, region, null)
        val erase = region.eraseMask!!
        assertEquals(0, erase[290, 135].toInt())
    }

    @Test
    fun `an open outline over a white page adds nothing beyond the glyph mask`() {
        val img = page()
        // فتحة في الإطار أعلى الفقاعة فوق الخلفية البيضاء: الورق يسيل
        for (y in 30 until 60) for (x in 190 until 215) { val i = (y * w + x) * 3; img.data[i] = -6; img.data[i + 1] = -6; img.data[i + 2] = -6 }
        for (k in 0 until 10) letter(img, 90 + k * 12, 110)
        letter(img, 300, 110)
        val glyph = ByteMask(w, h)
        for (k in 0 until 10) glyph.fillRect(90 + k * 12, 110, 98 + k * 12, 126)
        val bubble = ByteMask(w, h)
        for (y in 0 until h) for (x in 0 until 270) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 130.0) / 90.0, 2.0)
            if (e <= 1.0) bubble[x, y] = 1
        }
        val region = Region("r1", Box(90, 110, 210, 126), 0.9f, "speech", Bubble(Box(30, 40, 370, 220), 0.9f, bubble), null, glyph, glyph.count(), false)
        Cleaner.planErase(img, region, null)
        assertEquals(0, region.eraseMask!![303, 118].toInt())
    }

    @Test
    fun `a bold word whose letters touch is erased as one piece`() {
        val img = page()
        for (k in 0 until 10) letter(img, 90 + k * 12, 110)
        // «MEAN» بخط عريض: حروف ملتحمة = مكوّن واحد عرضه 60 (أكبر من 3 أسطر)
        for (y in 132 until 148) for (x in 240 until 300) if (y == 132 || y == 147 || x % 6 == 0) { val i = (y * w + x) * 3; img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 20 }
        val glyph = ByteMask(w, h)
        for (k in 0 until 10) glyph.fillRect(90 + k * 12, 110, 98 + k * 12, 126)
        val bubble = ByteMask(w, h)
        for (y in 0 until h) for (x in 0 until w) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 130.0) / 90.0, 2.0)
            if (e <= 1.0) bubble[x, y] = 1
        }
        val region = Region("r1", Box(90, 110, 210, 150), 0.9f, "speech", Bubble(Box(30, 40, 370, 220), 0.9f, bubble), null, glyph, glyph.count(), false)
        Cleaner.planErase(img, region, null)
        val erase = region.eraseMask!!
        for (y in 132 until 148) for (x in 240 until 300) if (y == 132 || y == 147 || x % 6 == 0) assertTrue("word pixel at $x,$y", erase[x, y].toInt() != 0)
    }

    @Test
    fun `a bubble cut by the bottom of the image is erased down to the edge`() {
        // الصفحة تنتهي وسط الفقاعة (تكمل في الصورة التالية): آخر سطر ملاصق للحافة
        val hh = 150
        val img = RgbImage(w, hh, ByteArray(w * hh * 3))
        java.util.Arrays.fill(img.data, 250.toByte())
        val bubble = ByteMask(w, hh)
        for (y in 0 until hh) for (x in 0 until w) {
            val e = Math.pow((x - 200.0) / 170.0, 2.0) + Math.pow((y - 150.0) / 110.0, 2.0)
            if (e <= 1.0) bubble[x, y] = 1 else if (e <= 1.08) { val i = (y * w + x) * 3; img.data[i] = 15; img.data[i + 1] = 15; img.data[i + 2] = 15 }
        }
        val glyph = ByteMask(w, hh)
        for (row in 0 until 2) for (k in 0 until 10) {
            val x = 90 + k * 12; val y = 114 + row * 20
            for (yy in y until minOf(hh, y + 16)) for (xx in x until x + 8) { val i = (yy * w + xx) * 3; img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 20 }
            glyph.fillRect(x, y, x + 8, minOf(hh, y + 16))
        }
        val region = Region("r1", Box(90, 114, 210, 150), 0.9f, "speech", Bubble(Box(30, 40, 370, 150), 0.9f, bubble), null, glyph, glyph.count(), false)
        Cleaner.planErase(img, region, null)
        assertEquals("fill", region.cleanMode)
        val erase = region.eraseMask!!
        for (x in 90 until 210) if (glyph[x, hh - 1].toInt() != 0) assertTrue("edge row ink at $x", erase[x, hh - 1].toInt() != 0)
    }
}
