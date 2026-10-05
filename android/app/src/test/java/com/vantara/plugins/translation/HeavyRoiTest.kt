package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class HeavyRoiTest {
    @Test fun `only hard detections receive crops with their holder context`() {
        val hard=Detection(Box(500,700,560,760),.9f,"text_free")
        val holder=Detection(Box(470,650,600,810),.9f,"bubble")
        val plan=HeavyRoi.plan(1000,2000,listOf(hard),listOf(holder))
        assertEquals(listOf(Box(406,586,664,874)),plan)
        assertEquals(1f,plan.single().contains(holder.box),0f)
    }
    @Test fun `overlapping ROIs merge and edge coordinates remain bounded`() {
        val dets=listOf(Detection(Box(0,0,50,50),.9f,"text_free"),Detection(Box(60,60,110,110),.9f,"text_free"))
        assertEquals(listOf(Box(0,0,174,174)),HeavyRoi.plan(200,200,dets,emptyList()))
    }
    @Test fun `free art text needs no bubble inference but unresolved speech does`() {
        val free=Detection(Box(50,60,100,80),.9f,"text_free")
        val speech=free.copy(label="text_bubble")
        assertTrue(HeavyRoi.bubbleNeeded(listOf(free),emptyList()).isEmpty())
        assertEquals(listOf(speech),HeavyRoi.bubbleNeeded(listOf(speech),emptyList()))
        val mask=ByteMask(200,200)
        for(y in 30..120) for(x in 20..140) mask[x,y]=1
        assertTrue(HeavyRoi.bubbleNeeded(listOf(speech),listOf(Bubble(Box(20,30,141,121),.9f,mask))).isEmpty())
    }
    @Test fun `oversized holders and chains never turn small text ROIs into a whole page`() {
        val texts=(0..5).map {Detection(Box(50+it*250,50,110+it*250,90),.9f,"text_free")}
        val huge=Detection(Box(0,0,2000,2000),.9f,"bubble")
        val plan=HeavyRoi.plan(2000,2000,texts,listOf(huge))
        assertTrue(plan.all {it.w<=1024 && it.h<=1024})
        for(t in texts) assertTrue(plan.any {it.contains(t.box)>=.99f})
    }
}
