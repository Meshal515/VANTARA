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

private fun manyLines(count: Int): RgbImage {
    val img = RgbImage(320, count * 32 + 24, ByteArray(320 * (count * 32 + 24) * 3) { 255.toByte() })
    for (row in 0 until count) {
        val y0 = 8 + row * 32
        for (g in 0 until 3) {
            val x0 = 24 + g * 18
            for (y in y0 until y0 + 12) for (x in x0 until x0 + 8)
                if (x == x0 || x == x0 + 7 || y == y0 || y == y0 + 11)
                    for (c in 0..2) img.data[(y * img.width + x) * 3 + c] = 0
        }
    }
    return img
}

@Test fun `default missing sweep is not capped at twelve dialogue lines`() {
    assertTrue(MissingTextSweep.candidates(manyLines(16), emptyList()).size >= 16)
}

@Test fun `partial overlap with a detector box does not hide the uncovered line`() {
    val img=line(6,0)
    val proposal=MissingTextSweep.candidates(img,emptyList()).first()
    val half=Box(proposal.x1,proposal.y1,proposal.x1 + proposal.w/2,proposal.y2)
    val known=listOf(Detection(half,1f,"text_bubble"))
    assertFalse(MissingTextSweep.candidates(img,known).isEmpty())
}

@Test fun `ctd glyph mask can promote an unowned line after detector routing`() {
    val mask=ByteMask(300,180)
    fun glyphLine(y0:Int) {
        for(g in 0 until 4) {
            val x0=40+g*18
            for(y in y0 until y0+12) for(x in x0 until x0+8)
                if(x==x0 || x==x0+7 || y==y0 || y==y0+11) mask[x,y]=1
        }
    }
    glyphLine(40);glyphLine(110)
    val known=listOf(Detection(Box(32,32,120,68),1f,"text_bubble"))
    val extra=MissingTextSweep.candidatesFromMask(mask,known)
    assertTrue(extra.any { it.y1 >= 90 })
}
