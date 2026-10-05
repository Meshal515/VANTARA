package com.vantara.plugins.translation

/** Bounded-context crops for the independent ROI-only experiment. */
object HeavyRoi {
    fun bubbleNeeded(texts:List<Detection>,trusted:List<Bubble>):List<Detection> =
        texts.filter {it.label=="text_bubble" && trusted.none {b->b.box.contains(it.box)>=.85f}}

    fun plan(width: Int, height: Int, detections: List<Detection>, holders: List<Detection>, pad: Int = 64): List<Box> {
        val boxes = ArrayList<Box>()
        for (d in detections) {
            val holder=holders.filter { it.box.contains(d.box)>=0.85f && it.box.w+pad*2<=1024 && it.box.h+pad*2<=1024 }.minByOrNull { it.box.area }
            val b=(holder?.box ?: d.box).union(d.box)
            var crop=Box(maxOf(0,b.x1-pad),maxOf(0,b.y1-pad),minOf(width,b.x2+pad),minOf(height,b.y2+pad))
            if(crop.w<=0 || crop.h<=0) continue
            // Coalesce intersecting context crops instead of running the same pixels repeatedly.
            var i=0
            while(i<boxes.size) {
                val union=boxes[i].union(crop)
                if(boxes[i].iou(crop)>0f && union.w<=1024 && union.h<=1024) { crop=union;boxes.removeAt(i);i=0 } else i++
            }
            boxes.add(crop)
        }
        // Oversized text itself is tiled with overlap; a giant detected holder is not a page fallback.
        val bounded=ArrayList<Box>()
        for(b in boxes) {
            var y=b.y1
            while(y<b.y2) {
                val bottom=minOf(b.y2,y+1024);var x=b.x1
                while(x<b.x2) {
                    val right=minOf(b.x2,x+1024);bounded.add(Box(x,y,right,bottom))
                    if(right==b.x2) break
                    x=right-128
                }
                if(bottom==b.y2) break
                y=bottom-128
            }
        }
        return bounded.sortedWith(compareBy({it.y1},{-it.x1}))
    }
}
