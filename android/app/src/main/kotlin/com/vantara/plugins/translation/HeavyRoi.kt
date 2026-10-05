package com.vantara.plugins.translation

/** Context-preserving candidate crops; activation requires comparison on the real quality corpus. */
object HeavyRoi {
    fun plan(width: Int, height: Int, detections: List<Detection>, holders: List<Detection>, pad: Int = 64): List<Box> {
        val boxes = ArrayList<Box>()
        for (d in detections) {
            val holder=holders.filter { it.box.contains(d.box)>=0.85f }.minByOrNull { it.box.area }
            val b=(holder?.box ?: d.box).union(d.box)
            var crop=Box(maxOf(0,b.x1-pad),maxOf(0,b.y1-pad),minOf(width,b.x2+pad),minOf(height,b.y2+pad))
            if(crop.w<=0 || crop.h<=0) continue
            // Coalesce intersecting context crops instead of running the same pixels repeatedly.
            var i=0
            while(i<boxes.size) {
                if(boxes[i].iou(crop)>0f) { crop=crop.union(boxes.removeAt(i));i=0 } else i++
            }
            boxes.add(crop)
        }
        return boxes.sortedWith(compareBy({it.y1},{-it.x1}))
    }
}
