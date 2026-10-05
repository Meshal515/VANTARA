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
}
