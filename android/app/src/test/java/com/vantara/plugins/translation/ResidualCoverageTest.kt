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

    @Test fun `residual inspection covers missed text elsewhere inside the bubble`() {
        val img=RgbImage(120,100,ByteArray(120*100*3){255.toByte()})
        val glyph=ByteMask(120,100).apply { fillRect(25,30,30,45) }
        val bubble=Box(10,10,110,90)
        val r=Region("bubble",Box(20,20,55,55),.95f,"speech",null,bubble,glyph,glyph.count(),false)
        r.fillColor=intArrayOf(255,255,255)
        // A missed English line sits well outside the detector box but inside the same balloon.
        for(y in 60 until 72) for(x in 72 until 92) for(ch in 0..2) img.data[(y*120+x)*3+ch]=0
        val mask=ResidualLatin.inspectionMask(img,r)
        assertEquals(bubble.w,mask.width)
        assertEquals(bubble.h,mask.height)
        assertEquals(1,mask[72-bubble.x1,60-bubble.y1].toInt())
    }

    @Test fun `residual candidate sees missed Latin contrast anywhere inside the bubble`() {
        val img=RgbImage(120,100,ByteArray(120*100*3){255.toByte()})
        val glyph=ByteMask(120,100).apply { fillRect(25,30,30,45) }
        val bubble=Box(10,10,110,90)
        val r=Region("bubble",Box(20,20,55,55),.95f,"speech",null,bubble,glyph,glyph.count(),false)
        r.fillColor=intArrayOf(255,255,255)
        for(y in 60 until 72) for(x in 72 until 92) for(ch in 0..2) img.data[(y*120+x)*3+ch]=0
        assertTrue(ResidualLatin.candidate(img,r))
    }

    @Test fun `residual rescue expands a speech region to its whole bubble`() {
        val glyph=ByteMask(120,100).apply { fillRect(25,30,30,45) }
        val bubble=Box(10,10,110,90)
        val r=Region("bubble",Box(20,20,55,55),.95f,"speech",null,bubble,glyph,glyph.count(),false)
        assertEquals(listOf(bubble),ResidualLatin.rescueBoxes(listOf(r)))
    }
}
