package com.vantara.plugins.translation

import org.junit.Assert.*
import org.junit.Test

class MixedRegionPlanTest {
    private fun fixture(): Pair<RgbImage, List<Detection>> {
        val w = 440; val h = 180
        val data = ByteArray(w * h * 3) { 90.toByte() }
        fun paint(x0: Int, y0: Int, x1: Int, y1: Int, v: Int) {
            for (y in y0 until y1) for (x in x0 until x1) for (c in 0..2) data[(y*w+x)*3+c] = v.toByte()
        }
        for (offset in listOf(0, 220)) {
            paint(35+offset,30,185+offset,145,246)
            for (x in listOf(70,80,92,104,118)) paint(x+offset,68,x+offset+6,91,20)
            for (x in listOf(72,88,104)) paint(x+offset,100,x+offset+8,122,25)
        }
        return RgbImage(w,h,data) to listOf(
            Detection(Box(35,30,185,145),.96f,"bubble"), Detection(Box(64,62,132,126),.95f,"text_bubble"),
            Detection(Box(255,30,405,145),.96f,"bubble"), Detection(Box(284,62,352,126),.95f,"text_bubble"),
        )
    }
    @Test fun `free text does not discard flat neighbour even with a holder`() {
        val (img,dets) = fixture()
        val mixed = dets.dropLast(1) + dets.last().copy(label="text_free")
        val plan = Regions.fastFlatPlan(img,img.gray(),"hash",mixed)
        assertEquals(1,plan.fast.size); assertEquals(1,plan.heavy.size)
        assertEquals("text_free",plan.heavy.single().label)
        assertEquals(plan.fast.single().id, Regions.fastFlatPlan(img,img.gray(),"hash",dets.take(2)).fast.single().id)
    }
    @Test fun `textured holder sends only its region to heavy`() {
        val (img,dets) = fixture()
        for (y in 30 until 145) for (x in 255 until 405) for (c in 0..2) img.data[(y*img.width+x)*3+c] = (if ((x/5+y/5)%2==0) 235 else 160).toByte()
        val plan = Regions.fastFlatPlan(img,img.gray(),"hash",dets)
        assertEquals(1,plan.fast.size); assertEquals(listOf(dets.last()),plan.heavy)
    }
    @Test fun `missing holder keeps text for heavy`() {
        val (img,dets) = fixture()
        val texts = dets.filter { it.label.startsWith("text") }
        val plan = Regions.fastFlatPlan(img,img.gray(),"hash",texts)
        assertTrue(plan.fast.isEmpty()); assertEquals(texts,plan.heavy)
    }
    @Test fun `one holder with split or duplicated text yields one stable region`() {
        val (img,dets) = fixture()
        val split = listOf(dets[0],Detection(Box(64,62,132,93),.95f,"text_bubble"),Detection(Box(64,98,132,126),.95f,"text_bubble"))
        val one = Regions.fastFlatPlan(img,img.gray(),"hash",dets.take(2)).fast.single()
        val plan = Regions.fastFlatPlan(img,img.gray(),"hash",split + split[1])
        assertEquals(1,plan.fast.size); assertTrue(plan.heavy.isEmpty()); assertEquals(one.id,plan.fast.single().id)
    }
    @Test fun `heavy bubble cannot absorb glyphs already owned by a fast holder`() {
        val (img,dets)=fixture()
        val fast=Regions.fastFlatPlan(img,img.gray(),"hash",dets.take(2)).fast
        val glyph=ByteMask(img.width,img.height)
        for(r in Regions.fastFlatPlan(img,img.gray(),"hash",dets).fast) for(i in glyph.data.indices) if(r.glyph.data[i].toInt()!=0) glyph.data[i]=1
        val broad=ByteMask(img.width,img.height).apply { fillRect(35,30,405,145) }
        val heavyBubbles=Regions.excludeFastOwnership(fast,glyph,listOf(Bubble(Box(35,30,405,145),.95f,broad)))
        val heavy=Regions.assemble(img,img.gray(),"hash",dets.drop(2),heavyBubbles,glyph)
        assertEquals(1,heavy.size)
        assertTrue(heavy.single().box.x1>=220)
        for(y in 30 until 145) for(x in 35 until 185) {
            assertEquals(0,glyph[x,y].toInt())
            assertEquals(0,heavyBubbles.single().mask[x,y].toInt())
        }
        assertTrue(fast.single().glyph.count()>0)
    }
 @Test fun `uniform free dialogue can skip CTD but textured art cannot`() {
  val img=RgbImage(220,150,ByteArray(220*150*3){250.toByte()})
  for(i in 0..4) for(y in 55..75) for(x in 60+i*15..65+i*15) for(c in 0..2) img.data[(y*220+x)*3+c]=20
  val text=Detection(Box(54,49,135,83),.95f,"text_free")
  val fast=Regions.fastFlatPlan(img,img.gray(),"hash",listOf(text),allowFlatFree=true)
  assertEquals(1,fast.fast.size);assertTrue(fast.heavy.isEmpty())
  for(y in 35..100) for(x in 35..155) if((x+y)%4==0) for(c in 0..2) img.data[(y*220+x)*3+c]=110
  val hard=Regions.fastFlatPlan(img,img.gray(),"hash",listOf(text),allowFlatFree=true)
  assertTrue(hard.fast.isEmpty());assertEquals(1,hard.heavy.size)
 }

    @Test fun `low confidence free dialogue stays translatable instead of becoming sfx`() {
        val w=180; val h=120
        val data=ByteArray(w*h*3){245.toByte()}
        fun dark(x0:Int,y0:Int,x1:Int,y1:Int) {
            for(y in y0 until y1) for(x in x0 until x1) for(ch in 0..2) data[(y*w+x)*3+ch]=20
        }
        dark(55,45,62,68); dark(68,45,75,68); dark(81,45,88,68)
        val img=RgbImage(w,h,data)
        val glyph=ByteMask(w,h).apply {
            fillRect(55,45,62,68); fillRect(68,45,75,68); fillRect(81,45,88,68)
        }
        val regions=Regions.assemble(
            img,img.gray(),"hash",
            listOf(Detection(Box(50,40,95,75),.45f,"text_free")),
            emptyList(),glyph
        )
        assertEquals(1,regions.size)
        assertEquals("free",regions.single().kind)
    }
}
