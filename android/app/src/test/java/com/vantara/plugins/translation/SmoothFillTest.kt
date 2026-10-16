package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** E2b: سلس يُملأ بالغشاء، والمنقّط/المهشّر يبقى لـLaMa. لا بكسل خارج القناع يتغير. */
class SmoothFillTest {
    private val w = 220
    private val h = 160

    private fun radial(x: Int, y: Int): Int {
        val dx = (x - 110).toDouble(); val dy = (y - 80).toDouble()
        val r2 = (dx * dx + dy * dy) / (100.0 * 100.0)
        return (250 - 70 * r2).toInt().coerceIn(0, 255)
    }

    private fun image(bg: (Int, Int) -> Int): Pair<RgbImage, RgbImage> {
        val img = RgbImage(w, h, ByteArray(w * h * 3))
        for (y in 0 until h) for (x in 0 until w) {
            val v = bg(x, y)
            val i = (y * w + x) * 3
            img.data[i] = v.toByte(); img.data[i + 1] = (v - 6).coerceAtLeast(0).toByte(); img.data[i + 2] = (v - 12).coerceAtLeast(0).toByte()
        }
        return img to img.copy()
    }

    private fun strokes(img: RgbImage): ByteMask {
        val glyph = ByteMask(w, h)
        // three "letters": vertical bars and a crossbar, dark ink
        for ((x0, x1) in listOf(80 to 84, 96 to 100, 112 to 116, 128 to 132)) glyph.fillRect(x0, 66, x1, 92)
        glyph.fillRect(80, 76, 132, 80)
        for (y in 0 until h) for (x in 0 until w) if (glyph[x, y].toInt() != 0) {
            val i = (y * w + x) * 3
            img.data[i] = 20; img.data[i + 1] = 20; img.data[i + 2] = 20
        }
        return glyph
    }

    @Test
    fun `smooth radial background is reconstructed from the ring`() {
        val (img, truth) = image(::radial)
        val glyph = strokes(img)
        val mask = glyph.dilate(7)
        val support = SmoothFill.support(mask, null, null)!!
        val verdict = SmoothFill.admit(img, mask, support)
        assertTrue("verdict=$verdict", verdict.admitted)
        val before = img.copy()
        val changed = SmoothFill.apply(img, mask, support)
        assertTrue(changed > 0)
        var err = 0.0; var n = 0
        for (y in 0 until h) for (x in 0 until w) {
            val i = (y * w + x) * 3
            if (mask[x, y].toInt() != 0) {
                err += Math.abs((img.data[i].toInt() and 0xff) - (truth.data[i].toInt() and 0xff)); n++
            } else {
                assertEquals("outside mask must be untouched", before.data[i], img.data[i])
                assertEquals(before.data[i + 1], img.data[i + 1])
                assertEquals(before.data[i + 2], img.data[i + 2])
            }
        }
        // Membrane bias on a curved (non-harmonic) field stays well under the 4.0 hold-out bound.
        assertTrue("mae=${err / n}", err / n < 3.0)
    }

    @Test
    fun `screentone background is refused`() {
        val (img, _) = image { x, y -> if ((x / 2 + y / 2) % 2 == 0) 235 else 120 }
        val glyph = strokes(img)
        val mask = glyph.dilate(7)
        val verdict = SmoothFill.admit(img, mask, SmoothFill.support(mask, null, null)!!)
        assertFalse(verdict.admitted)
        assertEquals("textured", verdict.reason)
    }

    @Test
    fun `hard edge crossing the mask fails hold-out`() {
        // Panel border: left half black, right half white. Smooth on each side, but a
        // membrane across the edge would blur it, so the hold-out must refuse.
        val (img, _) = image { x, _ -> if (x < 106) 30 else 240 }
        val glyph = strokes(img)
        val mask = glyph.dilate(7)
        val verdict = SmoothFill.admit(img, mask, SmoothFill.support(mask, null, null)!!)
        assertFalse("verdict=$verdict", verdict.admitted)
    }

    @Test
    fun `unbounded component is refused instead of inventing colour`() {
        val (img, _) = image(::radial)
        val mask = ByteMask(w, h).also { it.fillRect(60, 60, 160, 100) }
        val allowed = ByteMask(w, h) // no evidence anywhere
        val support = SmoothFill.support(mask, allowed, null)!!
        assertFalse(SmoothFill.admit(img, mask, support).admitted)
        assertEquals(-1, SmoothFill.apply(img, mask, support))
    }

    @Test
    fun `cleaner routes a gradient bubble to E2b and a textured one to LaMa`() {
        fun region(img: RgbImage, glyph: ByteMask): Region {
            val bubbleMask = ByteMask(w, h).also { it.fillRect(20, 15, 200, 145) }
            return Region("r", Box(76, 62, 136, 96), .95f, "speech", Bubble(Box(20, 15, 200, 145), .95f, bubbleMask), null, glyph, glyph.count(), false)
                .also { it.status = "translated" }
        }
        val (smoothImg, _) = image(::radial)
        val smooth = region(smoothImg, strokes(smoothImg))
        Cleaner.planErase(smoothImg, smooth, null)
        assertEquals("smooth", smooth.cleanMode)
        val stats = Cleaner.applyErase(smoothImg, listOf(smooth), null)
        assertTrue(stats.smoothChangedPixels > 0)
        assertEquals(0, stats.inpaintRegions)
        assertTrue("ink removed", smoothImg.r(98, 70) > 180)

        val (toneImg, _) = image { x, y -> if ((x / 2 + y / 2) % 2 == 0) 235 else 120 }
        val tone = region(toneImg, strokes(toneImg))
        Cleaner.planErase(toneImg, tone, null)
        assertEquals("lama", tone.cleanMode)
        assertEquals("smooth:textured", tone.eraseNote)
    }

    @Test
    fun `disabled switch keeps the previous ladder`() {
        val (img, _) = image(::radial)
        val glyph = strokes(img)
        val bubbleMask = ByteMask(w, h).also { it.fillRect(20, 15, 200, 145) }
        val r = Region("r", Box(76, 62, 136, 96), .95f, "speech", Bubble(Box(20, 15, 200, 145), .95f, bubbleMask), null, glyph, glyph.count(), false)
        r.status = "translated"
        Cleaner.smoothEnabled = false
        try {
            Cleaner.planErase(img, r, null)
            assertEquals("lama", r.cleanMode)
        } finally {
            Cleaner.smoothEnabled = true
        }
    }
}
