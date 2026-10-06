package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class BubbleRescuePolicyTest {
    private fun setRgb(img: RgbImage, x: Int, y: Int, r: Int, g: Int = r, b: Int = r) {
        val i=(y*img.width+x)*3
        img.data[i]=r.toByte();img.data[i+1]=g.toByte();img.data[i+2]=b.toByte()
    }

    private fun looseFlatBubble(): Triple<RgbImage, Detection, Detection> {
        val w=240;val h=200
        val img=RgbImage(w,h,ByteArray(w*h*3))
        // Textured art fills a deliberately loose detector holder.
        for(y in 0 until h) for(x in 0 until w) {
            val v=if(((x/9)+(y/7))%2==0) 42 else 86
            setRgb(img,x,y,v)
        }
        // A closed, flat speech-bubble interior occupies too little of the loose
        // holder for the old whole-holder majority heuristic to trust it.
        for(y in 38 until 162) for(x in 52 until 188) setRgb(img,x,y,18)
        for(y in 42 until 158) for(x in 56 until 184) setRgb(img,x,y,246)
        // Synthetic Latin ink.
        for(k in 0 until 5) for(y in 88 until 113) for(x in 82+k*14 until 89+k*14) setRgb(img,x,y,20)
        val text=Detection(Box(76,82,156,120),.94f,"text_bubble")
        val holder=Detection(Box(12,10,228,190),.91f,"bubble")
        return Triple(img,text,holder)
    }

    @Test fun `closed local paper inside a loose holder bypasses neural BubbleSeg`() {
        val (img,text,holder)=looseFlatBubble()
        // Baseline heuristics intentionally fail on this loose holder.
        assertNull(Regions.fastBubbleMask(img,holder.box,text.box))
        assertNull(Regions.flatBoxMask(img,holder.box,text.box))

        val glyph=ByteMask(img.width,img.height)
        for(y in 88 until 113) for(k in 0 until 5) for(x in 82+k*14 until 89+k*14) glyph[x,y]=1
        val plan=Regions.trustedHolderPlan(img,listOf(text),listOf(holder),glyph)

        assertEquals(1,plan.bubbles.size)
        assertEquals(1,plan.seeded)
        assertTrue(HeavyRoi.bubbleNeeded(listOf(text),plan.bubbles).isEmpty())
        val bubble=plan.bubbles.single()
        assertTrue(bubble.mask[70,70].toInt()!=0)
        assertEquals(0,bubble.mask[20,20].toInt())
        assertTrue(bubble.box.contains(text.box)>=.85f)
    }

    @Test fun `same-color component that leaks to holder edge is never trusted`() {
        val w=220;val h=160
        val img=RgbImage(w,h,ByteArray(w*h*3){245.toByte()})
        val text=Detection(Box(78,66,142,94),.95f,"text_bubble")
        val holder=Detection(Box(20,20,200,140),.9f,"bubble")
        val glyph=ByteMask(w,h)
        glyph.fillRect(88,70,96,90)
        // No enclosing boundary: accepting this would turn the page background into a bubble mask.
        val plan=Regions.trustedHolderPlan(img,listOf(text),listOf(holder),glyph)
        assertEquals(0,plan.seeded)
        assertEquals(listOf(text),HeavyRoi.bubbleNeeded(listOf(text),plan.bubbles))
    }

    @Test fun `seeded bypass still requires all text boxes in the holder to be covered`() {
        val (img,first,holder)=looseFlatBubble()
        val second=Detection(Box(90,126,150,146),.90f,"text_bubble")
        for(k in 0 until 4) for(y in 130 until 143) for(x in 96+k*12 until 102+k*12) setRgb(img,x,y,20)
        val glyph=ByteMask(img.width,img.height)
        glyph.fillRect(82,88,145,113)
        glyph.fillRect(96,130,138,143)

        val plan=Regions.trustedHolderPlan(img,listOf(first,second),listOf(holder),glyph)
        assertEquals(1,plan.seeded)
        assertTrue(HeavyRoi.bubbleNeeded(listOf(first,second),plan.bubbles).isEmpty())
        val mask=plan.bubbles.single().mask
        assertTrue(mask[first.box.x1,first.box.y1].toInt()!=0)
        assertTrue(mask[second.box.x1,second.box.y1].toInt()!=0)
    }

    @Test fun `seeded bypass keeps whitening local and does not require LaMa`() {
        val (img,text,holder)=looseFlatBubble()
        val glyph=ByteMask(img.width,img.height)
        for(y in 88 until 113) for(k in 0 until 5) for(x in 82+k*14 until 89+k*14) glyph[x,y]=1
        val bubble=Regions.trustedHolderPlan(img,listOf(text),listOf(holder),glyph).bubbles.single()
        val region=Region("seeded",text.box,.94f,"speech",bubble,holder.box,glyph,glyph.count(),false)
        region.status="translated"

        Cleaner.planErase(img,region,null)
        assertEquals("fill",region.cleanMode)
        assertNotNull(region.eraseMask)
        assertEquals(0,region.eraseMask!![20,20].toInt())
        val outsideBefore=img.r(20,20)
        val stats=Cleaner.applyErase(img,listOf(region),null)

        assertEquals(0,stats.inpaintMaskPixels)
        assertTrue(stats.fillChangedPixels>0)
        assertEquals(outsideBefore,img.r(20,20))
    }

    @Test fun `free art text never becomes a BubbleSeg request`() {
        val free=Detection(Box(40,50,100,80),.9f,"text_free")
        assertTrue(HeavyRoi.bubbleNeeded(listOf(free),emptyList()).isEmpty())
    }
}
