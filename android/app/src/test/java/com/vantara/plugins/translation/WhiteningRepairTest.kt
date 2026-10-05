package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class WhiteningRepairTest {
 @Test fun `repair cannot cross a bubble outline or extend beyond a local bound`() {
  val glyph=ByteMask(100,100);glyph.fillRect(20,20,23,23)
  val bubble=ByteMask(100,100);bubble.fillRect(19,19,60,60)
  val r=Region("r",Box(20,20,30,30),.9f,"speech",Bubble(Box(19,19,60,60),.9f,bubble),Box(19,19,60,60),glyph,9,false)
  r.eraseMask=glyph
  val repair=WhiteningRepair.mask(r,2)
  assertEquals(0,repair[19,20].toInt());assertEquals(0,repair[18,20].toInt());assertTrue(repair.count()>0)
 }
 @Test fun `zero changed pixels may never be accepted as whitening`() {
  val img=RgbImage(100,100,ByteArray(100*100*3){255.toByte()});val glyph=ByteMask(100,100);glyph.fillRect(20,20,23,23)
  val r=Region("r",Box(20,20,30,30),.9f,"speech",null,null,glyph,9,false)
  r.status="translated";r.cleanMode="fill";r.fillColor=intArrayOf(255,255,255);r.eraseMask=glyph
  val stats=Cleaner.applyErase(img,listOf(r),null)
  assertEquals(1,stats.noOpRegions);assertEquals("skipped:no_erase",r.status)
 }
}
