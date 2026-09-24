package com.vantara.plugins.translation

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Random

/**
 * المسار المحصور حول البكسلات المضاءة يجب أن يطابق المسار الأصلي على الصفحة
 * كلها بكسلًا بكسلًا: السرعة لا تُشترى بتغيير التبييض أو الكشف.
 */
class MaskWindowTest {

    @After
    fun restore() {
        ByteMask.windowed = true
    }

    private fun both(block: () -> Any?): Pair<Any?, Any?> {
        ByteMask.windowed = false
        val legacy = block()
        ByteMask.windowed = true
        return legacy to block()
    }

    /** بقع وخطوط وحلقات (ثقوب) متفرقة، أحيانًا ملاصقة لحافة الصورة. */
    private fun randomMask(rnd: Random): ByteMask {
        val w = 8 + rnd.nextInt(90)
        val h = 8 + rnd.nextInt(90)
        val m = ByteMask(w, h)
        when (rnd.nextInt(6)) {
            0 -> Unit // فارغ
            1 -> m.fill(1) // ممتلئ
            else -> repeat(1 + rnd.nextInt(6)) {
                val x = rnd.nextInt(w) - 3
                val y = rnd.nextInt(h) - 3
                val bw = 1 + rnd.nextInt(w / 2 + 1)
                val bh = 1 + rnd.nextInt(h / 2 + 1)
                when (rnd.nextInt(3)) {
                    0 -> m.fillRect(x, y, x + bw, y + bh)
                    1 -> { // حلقة بثقب
                        m.fillRect(x, y, x + bw + 4, y + bh + 4)
                        m.fillRect(x + 2, y + 2, x + bw + 2, y + bh + 2, 0)
                    }
                    else -> repeat(bw * bh / 3 + 1) { m[rnd.nextInt(w), rnd.nextInt(h)] = 1 }
                }
            }
        }
        return m
    }

    @Test
    fun `dilate, erode, close and open match the full-page path`() {
        val rnd = Random(7)
        repeat(1500) {
            val m = randomMask(rnd)
            val r = rnd.nextInt(14)
            for (op in listOf<(ByteMask) -> ByteMask>({ it.dilate(r) }, { it.erode(r) }, { it.close(r) }, { it.open(r) })) {
                val (a, b) = both { op(m).data }
                assertArrayEquals("w=${m.width} h=${m.height} r=$r", a as ByteArray, b as ByteArray)
            }
        }
    }

    @Test
    fun `components, largest component and hole filling match the full-page path`() {
        val rnd = Random(11)
        repeat(1500) {
            val m = randomMask(rnd)
            for (eight in listOf(true, false)) {
                val (a, b) = both { m.components(eight) }
                @Suppress("UNCHECKED_CAST") val la = a as Pair<IntArray, List<ByteMask.Component>>
                @Suppress("UNCHECKED_CAST") val lb = b as Pair<IntArray, List<ByteMask.Component>>
                assertArrayEquals(la.first, lb.first)
                assertEquals(la.second, lb.second)
            }
            val (c, d) = both { m.largestComponent().data }
            assertArrayEquals(c as ByteArray, d as ByteArray)
            val (e, f) = both { m.filledHoles().data }
            assertArrayEquals("w=${m.width} h=${m.height}", e as ByteArray, f as ByteArray)
        }
    }
}
