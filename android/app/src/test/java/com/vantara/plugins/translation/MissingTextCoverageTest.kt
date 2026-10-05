package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class MissingTextCoverageTest {
    private fun line(count: Int, shade: Int): RgbImage {
        val img = RgbImage(300, 180, ByteArray(300 * 180 * 3) { 255.toByte() })
        for (i in 0 until count) for (y in 60..74) for (x in 40 + i * 14..47 + i * 14)
            if (x % 7 < 3 || y in 60..62 || y in 72..74)
                for (c in 0..2) img.data[(y * 300 + x) * 3 + c] = shade.toByte()
        return img
    }
    @Test fun `two glyphs reach real OCR confirmation`() {
        assertFalse(MissingTextSweep.candidates(line(2, 0), emptyList()).isEmpty())
    }
    @Test fun `midgray glyphs reach real OCR confirmation`() {
        assertFalse(MissingTextSweep.candidates(line(4, 150), emptyList()).isEmpty())
    }
    private fun manyLines(count: Int): RgbImage {
        val img = RgbImage(360, count * 26 + 30, ByteArray(360 * (count * 26 + 30) * 3) { 255.toByte() })
        for (line in 0 until count) {
            val y0 = 10 + line * 26
            for (i in 0 until 4) for (y in y0..y0 + 12) for (x in 30 + i * 16..38 + i * 16)
                if (x % 7 < 3 || y in y0..y0 + 2 || y in y0 + 10..y0 + 12)
                    for (channel in 0..2) img.data[(y * img.width + x) * 3 + channel] = 0
        }
        return img
    }

    @Test fun `coverage sweep is not silently capped at twelve dialogue lines`() {
        assertTrue(MissingTextSweep.candidates(manyLines(20), emptyList()).size >= 20)
    }

    @Test fun `partial detector overlap does not hide the rest of a line`() {
        val img = line(5, 0)
        val partial = Detection(Box(35,55,70,85), .95f, "text_bubble")
        assertFalse(MissingTextSweep.candidates(img, listOf(partial)).isEmpty())
    }
    @Test fun `every bubble holder keeps a page out of false textless when text boxes are missed`() {
        val holders=(0 until 12).map { i ->
            Detection(Box(20,20+i*12,260,30+i*12),.91f,"bubble")
        }
        val fallback=MissingTextSweep.holderFallbacks(holders)
        assertEquals(holders.size,fallback.size)
        assertTrue(fallback.all { it.label=="text_bubble" && it.score >= Regions.MIN_SCORE })
        assertEquals(holders.map {it.box},fallback.map {it.box})
    }
}
