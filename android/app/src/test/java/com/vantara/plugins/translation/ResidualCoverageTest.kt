package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class ResidualCoverageTest {
    private fun region(id: String, box: Box): Region = Region(id,box,.95f,"speech",null,null,ByteMask(100,100),0,false)
    @Test fun `residual inspection is local and includes ink outside old glyph`() {
        val img=RgbImage(100,100,ByteArray(30000){255.toByte()})
        val r=region("a",Box(20,20,60,60))
        r.fillColor=intArrayOf(255,255,255)
        for(y in 40..48) for(x in 40..46) for(c in 0..2) img.data[(y*100+x)*3+c]=0
        val mask=ResidualLatin.inspectionMask(img,r)
        assertEquals(40,mask.width);assertEquals(40,mask.height)
        assertEquals(1,mask[20,20].toInt())
        assertFalse(r.glyph.any())
    }
    @Test fun `rescue retains every failed region rather than the first only`() {
        val regions=listOf(region("a",Box(10,10,30,30)),region("b",Box(50,50,70,70)))
        assertEquals(regions.map {it.box},ResidualLatin.rescueBoxes(regions))
    }
    @Test fun `art inspection includes the dark Otsu boundary`() {
        val img=RgbImage(100,100,ByteArray(30000){255.toByte()})
        val r=region("art",Box(20,20,60,60))
        for(y in 40..48) for(x in 40..46) for(c in 0..2) img.data[(y*100+x)*3+c]=0
        assertEquals(1,ResidualLatin.inspectionMask(img,r)[20,20].toInt())
    }
}
