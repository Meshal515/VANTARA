package com.vantara.plugins.translation
import org.junit.Assert.*
import org.junit.Test
class RenderSafetyTest {
 private fun region(id:String,box:Box):Region=Region(id,box,.9f,"speech",null,Box(5,5,95,95),ByteMask(100,100),0,false)
 @Test fun `unreadable sibling keeps the entire shared bubble in English`() {
  val a=region("a",Box(20,20,30,30)).also {it.status="translated"}
  val b=region("b",Box(20,40,30,50)).also {it.status="skipped:unreadable"}
  RenderSafety.keepWholeBubbles(listOf(a,b),mapOf("a" to listOf(b)),emptySet(),Perf())
  assertEquals("skipped:sibling",a.status)
 }
 @Test fun `retry retains initial erasure outside local repair window`() {
  val r=region("a",Box(40,40,50,50));val initial=ByteMask(100,100).also {it.fillRect(10,40,48,48)}
  r.eraseMask=initial;val local=WhiteningRepair.mask(r,1)
  assertEquals(0,local[10,42].toInt())
  val cumulative=RenderSafety.cumulative(initial,local)
  assertEquals(1,cumulative[10,42].toInt());assertEquals(1,cumulative[48,42].toInt())
 }
 @Test fun `accepted mask cannot damage a retained region`() {
  val a=region("a",Box(10,10,20,20)).also {it.status="translated";it.eraseMask=ByteMask(100,100).also {m->m.fillRect(10,10,38,20)}}
  val b=region("b",Box(35,10,45,20)).also {it.status="skipped:residual"}
  RenderSafety.protectRetained(listOf(a,b),Perf())
  assertEquals("skipped:overlap",a.status)
 }
 @Test fun `separated successful masks remain accepted`() {
  val a=region("a",Box(10,10,20,20)).also {it.status="translated";it.eraseMask=ByteMask(100,100).also {m->m.fillRect(10,10,20,20)}}
  val b=region("b",Box(55,55,65,65)).also {it.status="skipped:unreadable"}
  RenderSafety.protectRetained(listOf(a,b),Perf());assertEquals("translated",a.status)
 }
 @Test fun `sibling and overlap rejection converge together through multiple bubbles`() {
  val a=region("a",Box(1,1,5,5)).also {it.status="skipped:invisible"}
  val b=region("b",Box(20,10,30,20)).also {it.status="translated"}
  val c=region("c",Box(35,10,45,20)).also {it.status="translated";it.eraseMask=ByteMask(100,100).also {m->m.fillRect(25,10,45,20)}}
  val d=region("d",Box(60,10,70,20)).also {it.status="translated"}
  val e=region("e",Box(75,10,85,20)).also {it.status="translated";it.eraseMask=ByteMask(100,100).also {m->m.fillRect(65,10,85,20)}}
  RenderSafety.enforce(listOf(a,b,c,d,e),mapOf("b" to listOf(a),"d" to listOf(c)),emptySet(),Perf())
  assertTrue(listOf(a,b,c,d,e).none {it.status=="translated"})
 }

 @Test fun `retained glyph outside detector box is protected`() {
  val a=region("a",Box(10,10,20,20)).also {it.status="translated";it.eraseMask=ByteMask(100,100).also {m->m.fillRect(32,10,34,20)}}
  val b=region("b",Box(35,10,45,20)).also {it.status="skipped:unreadable";it.glyph.fillRect(32,10,34,20)}
  RenderSafety.protectRetained(listOf(a,b),Perf());assertEquals("skipped:overlap",a.status)
 }

}
