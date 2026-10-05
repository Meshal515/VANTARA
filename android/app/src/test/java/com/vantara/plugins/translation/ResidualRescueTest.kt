package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class ResidualRescueTest {
    private fun snapshot(id:String,box:Box,holder:Box?,score:Float=.8f):Pipeline.Snapshot =
        Pipeline.Snapshot(id,box,score,if(holder==null) "free" else "speech",-1,holder,
            PackedMask.of(ByteMask(1400,1400)),0,false,null,"known line","pending")

    @Test fun `large failed holder covers missed far line in bounded CTD crops`() {
        val holder=Box(50,50,1250,1250)
        val plan=ResidualRescue.detections(listOf(snapshot("old",Box(200,180,300,200),holder)))
        val text=plan.filter {it.label.startsWith("text")}
        assertEquals(listOf(holder),text.map {it.box})
        val crops=HeavyRoi.plan(1400,1400,text,plan.filter {it.label=="bubble"})
        assertTrue(crops.all {it.w<=1024 && it.h<=1024})
        for((x,y) in listOf(220 to 185,900 to 1100))
            assertTrue("failed holder pixel $x,$y never reaches CTD",crops.any {x in it.x1 until it.x2 && y in it.y1 until it.y2})
    }

    @Test fun `assembly recovers far missed glyphs rather than clipping to stale text box`() {
        val w=360;val h=360
        val img=RgbImage(w,h,ByteArray(w*h*3){250.toByte()})
        val glyph=ByteMask(w,h)
        fun line(y:Int) {
            for(k in 0..7) for(py in y until y+14) for(px in 110+k*11 until 118+k*11) {
                glyph[px,py]=1
                for(c in 0..2) img.data[(py*w+px)*3+c]=20
            }
        }
        line(60);line(260)
        val holder=Box(40,20,300,320)
        val mask=ByteMask(w,h).apply {fillRect(holder.x1,holder.y1,holder.x2,holder.y2)}
        val plan=ResidualRescue.detections(listOf(snapshot("old",Box(105,55,205,80),holder)))
        val assembled=Regions.assemble(img,img.gray(),"page",plan,listOf(Bubble(holder,.95f,mask)),glyph)
        assertTrue("far missed line was not retained for OCR",assembled.any {it.glyph[110,260].toInt()!=0 && it.box.y2>=274})
    }

    @Test fun `one failed holder is one rescue text and free text keeps its own scope`() {
        val holder=Box(40,20,300,320)
        val free=Box(330,20,350,50)
        val plan=ResidualRescue.detections(listOf(
            snapshot("first",Box(100,60,180,80),holder,.6f),
            snapshot("second",Box(100,100,180,120),holder,.9f),
            snapshot("free",free,null,.7f)))
        assertEquals(3,plan.size)
        assertEquals(1,plan.count {it.label=="bubble" && it.box==holder})
        assertEquals(.9f,plan.single {it.label=="text_bubble"}.score,0f)
        assertEquals(free,plan.single {it.label=="text_free"}.box)
    }
}
