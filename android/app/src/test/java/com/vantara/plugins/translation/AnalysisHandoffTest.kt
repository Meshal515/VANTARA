package com.vantara.plugins.translation
import org.junit.Test
import org.junit.Assert.*
class AnalysisHandoffTest {
 data class Value(val revision:Int,val rescue:Boolean)
 @Test fun `an older in-flight analysis cannot overwrite a residual repair request`() {
  val handoff=AnalysisHandoff<Value>(2) {it.revision}
  handoff["page"]=Value(0,false);handoff["page"]=Value(1,true);handoff["page"]=Value(0,false)
  assertEquals(Value(1,true),handoff["page"])
  handoff["page"]=Value(2,false);assertEquals(Value(2,false),handoff["page"])
  handoff["other"]=Value(0,false);handoff["third"]=Value(0,false)
  assertNull(handoff["page"])
 }
}
