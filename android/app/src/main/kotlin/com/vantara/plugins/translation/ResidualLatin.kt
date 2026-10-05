package com.vantara.plugins.translation
/** Known translated regions only. Credits/SFX and low-confidence art-like OCR never trigger retry. */
object ResidualLatin {
    /** Read-only local proposal from remaining pixels, never the old glyph mask. */
    fun inspectionMask(img: RgbImage, region: Region): ByteMask {
        val b = region.box
        val mask = ByteMask(b.w, b.h)
        val color = region.fillColor
        val crop = img.crop(b.x1,b.y1,b.x2,b.y2)
        val gray = if (color == null) crop.gray() else null
        val threshold = gray?.let { ByteMask.otsu(it,b.w,0,0,b.w,b.h) }
        for (y in 0 until b.h) for (x in 0 until b.w) {
            val ink = if (color != null) {
                maxOf(kotlin.math.abs(crop.r(x,y)-color[0]),kotlin.math.abs(crop.g(x,y)-color[1]),kotlin.math.abs(crop.b(x,y)-color[2])) > 45
            } else {
                val v = gray!![y*b.w+x].toInt() and 255
                if (region.inkLight) v > threshold!! else v <= threshold!!
            }
            if (ink) mask[x,y]=1
        }
        return mask
    }
    fun rescueBoxes(regions: List<Region>): List<Box> = regions.map { it.box }.distinct()
    fun readable(text: String, confidence: Float, kind: String): Boolean =
        kind !in setOf("sfx","credit") && confidence >= 0.80f && Regex("(?<![A-Za-z])[A-Za-z]{2,}(?![A-Za-z])").containsMatchIn(text)
    fun candidate(img: RgbImage, region: Region): Boolean {
        val color = region.fillColor ?: return region.cleanMode != "fill"
        var contrast = 0
        val b = region.box
        for (y in maxOf(0,b.y1) until minOf(img.height,b.y2)) for (x in maxOf(0,b.x1) until minOf(img.width,b.x2)) {
            if (maxOf(kotlin.math.abs(img.r(x,y)-color[0]),kotlin.math.abs(img.g(x,y)-color[1]),kotlin.math.abs(img.b(x,y)-color[2])) > 45 && ++contrast >= Regions.MIN_GLYPH_PIXELS) return true
        }
        return false
    }
}
