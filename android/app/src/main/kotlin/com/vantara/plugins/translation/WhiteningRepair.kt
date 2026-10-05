package com.vantara.plugins.translation
/** Bounded deterministic repair; the bubble interior still owns every writable pixel. */
object WhiteningRepair {
 fun mask(r:Region,pixels:Int):ByteMask {
  var expanded=(r.eraseMask ?: r.glyph).dilate(pixels.coerceIn(1,2))
  r.bubble?.let {expanded=expanded.and(it.mask.erode(2))}
  return expanded.clipped(r.box.x1-Regions.GLYPH_MARGIN,r.box.y1-Regions.GLYPH_MARGIN,r.box.x2+Regions.GLYPH_MARGIN,r.box.y2+Regions.GLYPH_MARGIN)
 }
}
