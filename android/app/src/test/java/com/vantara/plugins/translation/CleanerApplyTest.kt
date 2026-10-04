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
    @Test
    fun `flat bubble also removes a missed glyph fragment just outside detector box`() {
        val w = 180
        val h = 130
        val img = RgbImage(w, h, ByteArray(w * h * 3) { 246.toByte() })

        fun paint(x0: Int, y0: Int, x1: Int, y1: Int, v: Int) {
            for (y in y0 until y1) for (x in x0 until x1) {
                val i = (y * w + x) * 3
                img.data[i] = v.toByte()
                img.data[i + 1] = v.toByte()
                img.data[i + 2] = v.toByte()
            }
        }

        // الحروف التي التقطها CTD.
        paint(60, 50, 75, 66, 25)
        // قطعة صغيرة من حرف/ظله فاتها القناع والصندوق ببضعة بكسلات؛ هذه هي
        // البقايا السوداء التي ظهرت في الصفحة الحقيقية.
        paint(82, 54, 86, 60, 20)
        // رسم خارج الفقاعة يجب أن يبقى حرفيًا.
        paint(5, 5, 16, 16, 30)

        val bubbleMask = ByteMask(w, h).also { it.fillRect(30, 25, 145, 105) }
        val glyph = ByteMask(w, h).also { it.fillRect(60, 50, 75, 66) }
        val region = Region(
            "r1",
            Box(56, 46, 78, 70),
            0.96f,
            "speech",
            Bubble(Box(30, 25, 145, 105), 0.96f, bubbleMask),
            null,
            glyph,
            glyph.count(),
            false,
        )
        region.status = "translated"

        Cleaner.planErase(img, region, null)
        assertEquals("fill", region.cleanMode)
        assertEquals(20, img.r(83, 56))
        val outside = img.r(8, 8)

        val stats = Cleaner.applyErase(img, listOf(region), null)

        assertTrue("missed fragment near the detector box must be whitened", img.r(83, 56) > 180)
        assertEquals("outside art must remain exact", outside, img.r(8, 8))
        assertTrue(stats.fillChangedPixels > 0)
    }

}
