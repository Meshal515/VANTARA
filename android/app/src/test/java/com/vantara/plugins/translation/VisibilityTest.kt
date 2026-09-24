package com.vantara.plugins.translation

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random

/** لا فقاعة مبيّضة بلا عربي ظاهر، والتحليل المحفوظ يُفرَد كما كان. */
class VisibilityTest {

    private fun flat(w: Int, h: Int, v: Int) = RgbImage(w, h, ByteArray(w * h * 3) { v.toByte() })

    private val layout = TextLayout(20f, listOf("مرحبا"), listOf(floatArrayOf(50f, 30f)), Box(20, 10, 80, 40), listOf(Box(20, 10, 80, 40)))

    @Test
    fun `ink keeps its original colour whenever it contrasts with the cleaned bubble`() {
        assertFalse(Visibility.inkLight(flat(100, 60, 250), layout, original = false)) // أسود على أبيض
        assertTrue(Visibility.inkLight(flat(100, 60, 10), layout, original = true)) // أبيض على أسود
    }

    @Test
    fun `white ink on a white bubble is flipped to dark, and dark on black to light`() {
        assertFalse(Visibility.inkLight(flat(100, 60, 245), layout, original = true))
        assertTrue(Visibility.inkLight(flat(100, 60, 12), layout, original = false))
    }

    @Test
    fun `text that did not show up is caught`() {
        val before = flat(100, 60, 250)
        assertFalse(Visibility.textShows(before, before.copy(), layout))
        val after = before.copy()
        for (y in 15 until 35) for (x in 25 until 75 step 3) {
            val i = (y * 100 + x) * 3
            after.data[i] = 16; after.data[i + 1] = 16; after.data[i + 2] = 16
        }
        assertTrue(Visibility.textShows(before, after, layout))
    }

    @Test
    fun `packed masks unpack to the very same pixels`() {
        val rnd = Random(3)
        repeat(300) {
            val m = ByteMask(1 + rnd.nextInt(60), 1 + rnd.nextInt(60))
            repeat(rnd.nextInt(40)) { m[rnd.nextInt(m.width), rnd.nextInt(m.height)] = 1 }
            val back = PackedMask.of(m).unpack()
            assertEquals(m.width, back.width)
            assertArrayEquals(m.data, back.data)
        }
    }
}
