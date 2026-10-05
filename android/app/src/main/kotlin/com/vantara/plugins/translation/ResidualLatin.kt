package com.vantara.plugins.translation
/** Known translated regions only. Credits/SFX and low-confidence art-like OCR never trigger retry. */
object ResidualLatin {
    fun readable(text: String, confidence: Float, kind: String): Boolean =
        kind !in setOf("sfx","credit") && confidence >= 0.80f && Regex("(?<![A-Za-z])[A-Za-z]{3,}(?![A-Za-z])").containsMatchIn(text)
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
