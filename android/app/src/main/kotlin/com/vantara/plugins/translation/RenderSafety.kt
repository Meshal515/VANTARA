package com.vantara.plugins.translation
/** Shared invariants used before drawing and again after visibility verification. */
internal object RenderSafety {
 private val missing=setOf("skipped:untranslated","skipped:unreadable","skipped:no_fit","skipped:invisible","skipped:residual","skipped:no_erase","skipped:overlap","skipped:sibling")
 fun keepWholeBubbles(regions:List<Region>,siblings:Map<String,List<Region>>,leave:Set<String>,perf:Perf) {
  for(r in regions) if(r.status=="translated" && siblings[r.id]?.any {it.status in missing && it.id !in leave}==true) {
   r.status="skipped:sibling";perf.count("bubbleKept")
  }
 }
 fun enforce(regions:List<Region>,siblings:Map<String,List<Region>>,leave:Set<String>,perf:Perf) {
  val retainedBounds=HashMap<Region,Box>()
  do {
   val before=regions.count {it.status=="translated"}
   keepWholeBubbles(regions,siblings,leave,perf)
   protectRetained(regions,perf,retainedBounds)
  } while(regions.count {it.status=="translated"}<before)
 }
 fun cumulative(initial:ByteMask?,repair:ByteMask):ByteMask = initial?.or(repair) ?: repair
 fun protectRetained(regions:List<Region>,perf:Perf,retainedBounds:MutableMap<Region,Box> = HashMap()) {
  if(regions.none {it.status=="translated"} || regions.all {it.status=="translated"}) return
  // Rejection can expose another overlapping region: converge before drawing.
  do {
   var changed=false
   for(r in regions) if(r.status=="translated") {
    val conflict=regions.any {other->other!==r && other.status!="translated" && overlaps(r,retainedBounds.getOrPut(other) {
     val bounds=other.glyph.bounds()
     if(bounds==null) other.box else other.box.union(Box(bounds[0],bounds[1],bounds[2],bounds[3]))
    })}
    if(conflict) {r.status="skipped:overlap";perf.count("retainedOverlap");changed=true}
   }
  } while(changed)
 }
 private fun overlaps(r:Region,box:Box):Boolean {
  r.eraseMask?.let {m->
   for(y in maxOf(0,box.y1) until minOf(m.height,box.y2)) for(x in maxOf(0,box.x1) until minOf(m.width,box.x2)) if(m[x,y].toInt()!=0) return true
  }
  r.layout?.let {l->
   val pad=(l.size/2).toInt();val b=l.bounds
   if(b.x1-pad<box.x2 && b.x2+pad>box.x1 && b.y1-pad<box.y2 && b.y2+pad>box.y1) return true
  }
  return false
 }
}
