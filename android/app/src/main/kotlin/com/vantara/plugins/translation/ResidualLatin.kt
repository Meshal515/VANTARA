package com.vantara.plugins.translation

import kotlin.math.abs

/**
 * Residual-English verification must not trust the glyph mask that performed the erase:
 * a missing glyph is exactly the failure we are trying to detect.
 */
object ResidualLatin {
    fun readable(text: String, confidence: Float, kind: String): Boolean =
        kind !in setOf("sfx","credit") && confidence >= 0.80f &&
            Regex("(?<![A-Za-z])[A-Za-z]{2,}(?![A-Za-z])").containsMatchIn(text)

    /** Cheap pre-gate: skip OCR when a flat fill is visually clean. */
    fun candidate(img: RgbImage, region: Region): Boolean {
        val color = region.fillColor ?: return region.cleanMode != "fill"
        var contrast = 0
        val b = region.box
        for (y in maxOf(0,b.y1) until minOf(img.height,b.y2)) for (x in maxOf(0,b.x1) until minOf(img.width,b.x2)) {
            if (maxOf(abs(img.r(x,y)-color[0]),abs(img.g(x,y)-color[1]),abs(img.b(x,y)-color[2])) > 45 &&
                ++contrast >= Regions.MIN_GLYPH_PIXELS) return true
        }
        return false
    }

    /**
     * Builds OCR line proposals from the *cleaned pixels*, never from region.glyph.
     * Flat bubbles use distance from the known paper colour. Art/inpaint regions try
     * both Otsu polarities and keep only letter-sized connected components.
     */
    fun probeBoxes(img: RgbImage, region: Region, limit: Int = 8): List<Box> {
        val b = Box(
            maxOf(0, region.box.x1), maxOf(0, region.box.y1),
            minOf(img.width, region.box.x2), minOf(img.height, region.box.y2)
        )
        if (b.w < 4 || b.h < 4) return emptyList()
        val masks = ArrayList<ByteMask>()
        val fill = region.fillColor
        if (fill != null) {
            val m = ByteMask(img.width,img.height)
            for (y in b.y1 until b.y2) for (x in b.x1 until b.x2) {
                if (maxOf(abs(img.r(x,y)-fill[0]),abs(img.g(x,y)-fill[1]),abs(img.b(x,y)-fill[2])) > 45) m[x,y]=1
            }
            masks += m
        } else {
            val gray=img.gray()
            val t=ByteMask.otsu(gray,img.width,b.x1,b.y1,b.x2,b.y2)
            val dark=ByteMask(img.width,img.height)
            val light=ByteMask(img.width,img.height)
            for(y in b.y1 until b.y2) for(x in b.x1 until b.x2) {
                val v=gray[y*img.width+x].toInt() and 255
                if(v <= t) dark[x,y]=1
                if(v > t) light[x,y]=1
            }
            masks += dark; masks += light
        }

        val lines=ArrayList<Box>()
        for(mask in masks) {
            val comps=mask.components().second.filter { c ->
                val w=c.x1-c.x0; val h=c.y1-c.y0
                w>=2 && h>=4 && w<=minOf(96,b.w) && h<=minOf(112,b.h) &&
                    c.area>=4 && c.area < b.area/2 && w.toFloat()/h in 0.08f..5.0f
            }.sortedWith(compareBy({(it.y0+it.y1)/2},{it.x0}))
            val groups=ArrayList<MutableList<ByteMask.Component>>()
            for(c in comps) {
                val cy=(c.y0+c.y1)/2
                val match=groups.lastOrNull { row ->
                    val last=row.last()
                    val ly=(last.y0+last.y1)/2
                    val hh=maxOf(c.y1-c.y0,last.y1-last.y0)
                    abs(cy-ly) <= maxOf(3,hh*2/3) && c.x0-last.x1 <= maxOf(16,hh*4)
                }
                if(match==null) groups.add(arrayListOf(c)) else match.add(c)
            }
            for(g in groups) {
                if(g.size < 2) continue
                val x1=maxOf(b.x1,g.minOf{it.x0}-3); val y1=maxOf(b.y1,g.minOf{it.y0}-3)
                val x2=minOf(b.x2,g.maxOf{it.x1}+3); val y2=minOf(b.y2,g.maxOf{it.y1}+3)
                val box=Box(x1,y1,x2,y2)
                if(box.w>=6 && box.h>=6 && lines.none {it.iou(box)>.65f}) lines += box
            }
        }
        return lines.sortedWith(compareBy({it.y1},{it.x1})).take(limit)
    }

    /** All residual regions are retried together; no one-region-per-minute repair chain. */
    fun rescuePlan(regions: List<Region>): List<Detection> = regions.distinctBy { it.id }.map {
        Detection(it.box,it.score,if(it.bubbleBox != null || it.kind in setOf("speech","narration")) "text_bubble" else "text_free")
    }
}
