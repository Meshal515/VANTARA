package com.vantara.plugins.translation
/** Known translated regions only. Credits/SFX and low-confidence art-like OCR never trigger retry. */
object ResidualLatin {
    /**
     * Residual ownership follows the visible speech holder, not the detector text box.
     * The detector may have captured only one line of a multi-line balloon.
     */
    fun inspectionBox(region: Region): Box = region.bubbleBox ?: region.box

    private fun allowedInside(img: RgbImage, region: Region, scope: Box): ByteMask? {
        val full = region.bubble?.mask
            ?: region.bubbleBox?.let { Regions.flatBoxMask(img, it, region.box) }
            ?: return null
        val out = ByteMask(scope.w, scope.h)
        for (y in 0 until scope.h) for (x in 0 until scope.w) {
            val px = scope.x1 + x
            val py = scope.y1 + y
            if (px in 0 until full.width && py in 0 until full.height && full[px, py].toInt() != 0) out[x, y] = 1
        }
        return out
    }

    /** Read-only local proposal from remaining pixels, never the old glyph mask. */
    fun inspectionMask(img: RgbImage, region: Region): ByteMask {
        val b = inspectionBox(region)
        val mask = ByteMask(b.w, b.h)
        val color = region.fillColor
        val crop = img.crop(b.x1,b.y1,b.x2,b.y2)
        val allowed = allowedInside(img, region, b)
        val gray = if (color == null) crop.gray() else null
        val threshold = gray?.let { ByteMask.otsu(it,b.w,0,0,b.w,b.h) }
        for (y in 0 until b.h) for (x in 0 until b.w) {
            if (allowed != null && allowed[x,y].toInt() == 0) continue
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

    /** Rescue the visible holder. Free text has no holder, so its own text box remains the scope. */
    fun rescueBoxes(regions: List<Region>): List<Box> = regions.map { inspectionBox(it) }.distinct()

    /** A globally found leftover inherits a known speech/narration holder when it sits inside it. */
    fun rescueScope(leftover: Box, regions: List<Region>): Box {
        val cx=(leftover.x1+leftover.x2)/2
        val cy=(leftover.y1+leftover.y2)/2
        val holder=regions.asSequence().mapNotNull { r -> (r.bubbleBox ?: r.bubble?.box)?.let { it to r } }
            .filter { (box,_) -> cx in box.x1 until box.x2 && cy in box.y1 until box.y2 }
            .minByOrNull { (box,_) -> box.area }
        return holder?.first ?: leftover
    }

    fun readable(text: String, confidence: Float, kind: String): Boolean =
        kind !in setOf("sfx","credit") && confidence >= 0.80f && Regex("(?<![A-Za-z])[A-Za-z]{2,}(?![A-Za-z])").containsMatchIn(text)

    fun candidate(img: RgbImage, region: Region): Boolean {
        if (region.cleanMode != "fill") return true
        return inspectionMask(img,region).count() >= Regions.MIN_GLYPH_PIXELS
    }
}
