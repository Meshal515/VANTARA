package com.vantara.plugins.translation
import org.junit.Test
import org.junit.Assert.*
class MissingTextSweepTest {
 @Test fun `finds an undetected high contrast text line but not an empty page`() {
  val img=RgbImage(300,180,ByteArray(300*180*3){255.toByte()})
  for(i in 0..4) for(y in 60..74) for(x in 40+i*14..47+i*14) if(x%7<3 || y in 60..62 || y in 72..74) for(c in 0..2) img.data[(y*300+x)*3+c]=0
  val candidates=MissingTextSweep.candidates(img,emptyList())
  assertTrue(candidates.any {it.contains(Box(40,60,103,75))>.8f})
  assertTrue(MissingTextSweep.candidates(RgbImage(300,180,ByteArray(300*180*3){255.toByte()}),emptyList()).isEmpty())
  assertTrue(MissingTextSweep.candidates(img,listOf(Detection(Box(35,55,115,85),.9f,"text_bubble"))).isEmpty())
  assertFalse(MissingTextSweep.candidates(img,listOf(Detection(Box(35,55,115,85),.3f,"text_bubble"))).isEmpty())
 }
 @Test fun `short Latin confirmations require real high-confidence OCR`() {
  assertTrue(MissingTextSweep.confirmed("HUH?",.95f))
  assertTrue(MissingTextSweep.confirmed("GO",.90f))
  assertFalse(MissingTextSweep.confirmed("GO",.60f))
  assertFalse(MissingTextSweep.confirmed("?!",.99f))
 }
}
