package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** يثبت أن مسار التعبئة المحلي يغيّر بكسلات النص فعلًا، لا أنه يكوّن قناعًا فقط. */
class CleanerApplyTest {
    @Test
    fun `flat bubble cleaning changes source ink and never touches outside art`() {
        val w = 160
        val h = 120
        val img = RgbImage(w, h, ByteArray(w * h * 3) { 245.toByte() })

        fun paint(x0: Int, y0: Int, x1: Int, y1: Int, v: Int) {
            for (y in y0 until y1) for (x in x0 until x1) {
                val i = (y * w + x) * 3
                img.data[i] = v.toByte()
                img.data[i + 1] = v.toByte()
                img.data[i + 2] = v.toByte()
            }
        }

        // حروف داكنة داخل فقاعة بيضاء، ورسم داكن خارجها يجب ألا يتغير.
        paint(55, 48, 72, 62, 20)
        paint(4, 4, 14, 14, 35)

        val bubbleMask = ByteMask(w, h).also { it.fillRect(30, 25, 130, 95) }
        val glyph = ByteMask(w, h).also { it.fillRect(55, 48, 72, 62) }
        val region = Region(
            "r1",
            Box(50, 44, 78, 66),
            0.95f,
            "speech",
            Bubble(Box(30, 25, 130, 95), 0.95f, bubbleMask),
            null,
            glyph,
            glyph.count(),
            false,
        )
        region.status = "translated"

        Cleaner.planErase(img, region, null)
        assertEquals("fill", region.cleanMode)
        val beforeOutside = img.r(8, 8)
        val beforeInk = img.r(60, 54)
        assertEquals(20, beforeInk)

        val stats = Cleaner.applyErase(img, listOf(region), null)

        assertTrue(stats.fillRegions > 0)
        assertTrue(stats.fillMaskPixels > 0)
        assertTrue("source ink must be changed by whitening", stats.fillChangedPixels > 0)
        assertEquals("art outside the erase mask must stay exact", beforeOutside, img.r(8, 8))
        assertTrue("source ink should no longer be dark", img.r(60, 54) > 180)
    }
}
