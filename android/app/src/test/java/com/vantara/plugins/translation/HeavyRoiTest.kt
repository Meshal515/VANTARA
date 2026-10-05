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
}
