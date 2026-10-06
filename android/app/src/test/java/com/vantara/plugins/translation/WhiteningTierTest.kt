package com.vantara.plugins.translation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WhiteningTierTest {
    private fun region(glyph: ByteMask, bubbleMask: ByteMask): Region =
        Region(
            "tier",
            Box(56, 46, 80, 72),
            0.97f,
            "speech",
            Bubble(Box(30, 25, 150, 105), 0.97f, bubbleMask),
            Box(30, 25, 150, 105),
            glyph,
            glyph.count(),
            false,
        ).also { it.status = "translated" }

    @Test
    fun `smooth gradient uses local reconstruction and stays inside mask`() {
        val w = 180
        val h = 130
        val img = RgbImage(w, h, ByteArray(w * h * 3))
        for (y in 0 until h) for (x in 0 until w) {
            val base = (150 + x / 3 + y / 5).coerceAtMost(245)
            val i = (y * w + x) * 3
            img.data[i] = base.toByte()
            img.data[i + 1] = (base - 8).toByte()
            img.data[i + 2] = (base - 14).toByte()
        }
        val bubble = ByteMask(w, h).also { it.fillRect(30, 25, 150, 105) }
        val glyph = ByteMask(w, h).also { it.fillRect(60, 50, 75, 66) }
        for (y in 50 until 66) for (x in 60 until 75) {
            val i = (y * w + x) * 3
            img.data[i] = 20
            img.data[i + 1] = 20
            img.data[i + 2] = 20
        }
        val r = region(glyph, bubble)
        Cleaner.planErase(img, r, null)
        assertEquals("reconstruct", r.cleanMode)
        val mask = r.eraseMask!!
        val before = img.data.copyOf()

        val stats = Cleaner.applyErase(img, listOf(r), null)

        assertEquals(1, stats.reconstructRegions)
        assertEquals(0, stats.inpaintRegions)
        assertTrue(stats.reconstructChangedPixels > 0)
        for (p in 0 until w * h) {
            val x = p % w
            val y = p / w
            if (mask[x, y].toInt() != 0) continue
            val i = p * 3
            assertEquals("red changed outside erase mask at $x,$y", before[i], img.data[i])
            assertEquals("green changed outside erase mask at $x,$y", before[i + 1], img.data[i + 1])
            assertEquals("blue changed outside erase mask at $x,$y", before[i + 2], img.data[i + 2])
        }
        assertTrue("source ink should be reconstructed", img.r(66, 57) > 150)
        assertTrue(mask[66, 57].toInt() != 0)
    }

    @Test
    fun `complex texture remains LaMa rescue instead of aggressive local reconstruction`() {
        val w = 180
        val h = 130
        val img = RgbImage(w, h, ByteArray(w * h * 3))
        for (y in 0 until h) for (x in 0 until w) {
            val v = if (((x / 7) + (y / 7)) % 2 == 0) 75 else 230
            val i = (y * w + x) * 3
            img.data[i] = v.toByte()
            img.data[i + 1] = (255 - v / 2).toByte()
            img.data[i + 2] = (80 + v / 3).toByte()
        }
        val bubble = ByteMask(w, h).also { it.fillRect(30, 25, 150, 105) }
        val glyph = ByteMask(w, h).also { it.fillRect(60, 50, 75, 66) }
        val r = region(glyph, bubble)

        Cleaner.planErase(img, r, null)

        assertEquals("lama", r.cleanMode)
        assertTrue(Cleaner.needsInpaint(listOf(r)))
    }

    @Test
    fun `E0 or unknown mode never escalates implicitly to LaMa`() {
        val img = RgbImage(40, 40, ByteArray(40 * 40 * 3) { 220.toByte() })
        val glyph = ByteMask(40, 40).also { it.fillRect(10, 10, 16, 16) }
        val r = Region("e0", Box(10, 10, 16, 16), .95f, "speech", null, null, glyph, glyph.count(), false).also {
            it.status = "translated"
            it.eraseMask = glyph
            it.cleanMode = null
        }
        val before = img.data.copyOf()

        val stats = Cleaner.applyErase(img, listOf(r), null)

        assertEquals("skipped:no_erase", r.status)
        assertEquals(0, stats.inpaintRegions)
        assertTrue(before.contentEquals(img.data))
        assertTrue(!Cleaner.needsInpaint(listOf(r)))
    }
}
