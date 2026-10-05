package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class ResidualLatinTest {
    @Test fun `requires confident Latin words in translated text`() {
        assertTrue(ResidualLatin.readable("HELLO",.93f,"speech"))
        assertFalse(ResidualLatin.readable("HELLO",.60f,"speech"))
        assertFalse(ResidualLatin.readable("BOOM",.99f,"sfx"))
        assertFalse(ResidualLatin.readable("42 i",.99f,"speech"))
        assertFalse(ResidualLatin.readable("مرحبا",.99f,"speech"))
    }
 @Test fun `short standalone English dialogue cannot pass the gate`() {
  assertTrue(ResidualLatin.readable("GO",.95f,"speech"))
  assertTrue(ResidualLatin.readable("NO!",.95f,"speech"))
 }

 @Test fun `independent probe sees leftover ink outside the original glyph mask`() {
  val w=180; val h=100
  val img=RgbImage(w,h,ByteArray(w*h*3){255.toByte()})
  fun dark(x0:Int,y0:Int,x1:Int,y1:Int) {
   for(y in y0 until y1) for(x in x0 until x1) for(ch in 0..2) img.data[(y*w+x)*3+ch]=0
  }
  // old glyph only knew the first tiny mark; the visible word is elsewhere.
  val glyph=ByteMask(w,h).apply { fillRect(20,40,24,55) }
  dark(82,38,88,60); dark(94,38,100,60); dark(106,38,112,60)
  val r=Region("r",Box(15,30,125,70),.95f,"speech",null,null,glyph,glyph.count(),false)
  r.cleanMode="fill"; r.fillColor=intArrayOf(255,255,255); r.eraseMask=glyph
  val probes=ResidualLatin.probeBoxes(img,r)
  assertTrue(probes.any { it.x1 <= 82 && it.x2 >= 112 && it.y1 <= 38 && it.y2 >= 60 })
 }

 @Test fun `rescue plan keeps every residual region in one heavy retry`() {
  val glyph=ByteMask(200,120).apply { fillRect(10,10,20,20) }
  val a=Region("a",Box(10,10,40,35),.9f,"speech",null,null,glyph,glyph.count(),false)
  val b=Region("b",Box(100,50,140,80),.9f,"free",null,null,glyph,glyph.count(),false)
  val plan=ResidualLatin.rescuePlan(listOf(a,b))
  assertEquals(setOf(a.box,b.box),plan.map {it.box}.toSet())
  assertEquals(setOf("text_bubble","text_free"),plan.map {it.label}.toSet())
 }
}
