package com.vantara.plugins.translation

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface

/** تخطيط نص عربي: الحجم والأسطر ومركز كل سطر وقاعدته وحدود الكتلة. */
class TextLayout(val size: Float, val lines: List<String>, val centers: List<FloatArray>, val bounds: Box, val lineBounds: List<Box>)

/**
 * تخطيط العربي داخل الفقاعة — ترجمة `vantara_worker/layout.py`:
 * التفاف مقيَّد بوتر الفقاعة عند كل سطر، تمركز حول مركز النص الأصلي، أكبر
 * حجم يدخل. القياس والرسم بـ`Paint` أندرويد: تشكيل العربي والاتجاه من النظام
 * نفسه (HarfBuzz/ICU داخل Minikin)، بخط Baloo Bhaijaan 2 المرفق.
 */
class ArabicLayout(private val typeface: Typeface) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = this@ArabicLayout.typeface
        textAlign = Paint.Align.CENTER
        isFakeBoldText = false
    }
    private val minSize = 12f
    private val lineSpacing = 1.08f

    private fun width(text: String, size: Float): Float {
        paint.textSize = size
        return paint.measureText(text)
    }

    /** ارتفاع السطر وصعود القاعدة من صندوق حبر عيّنة عربية عالية ومنخفضة. */
    private fun metrics(size: Float): Pair<Float, Float> {
        paint.textSize = size
        val r = android.graphics.Rect()
        paint.getTextBounds("لجفقيبطئ", 0, 8, r)
        val ascent = -r.top.toFloat()
        val descent = r.bottom.toFloat()
        return (ascent + descent) * lineSpacing to ascent
    }

    private fun wrapPolygon(words: List<String>, size: Float, mask: ByteMask, cx: Int, top: Int, lineH: Float, pad: Int): Pair<List<String>, List<IntArray>>? {
        val lines = ArrayList<String>()
        val spans = ArrayList<IntArray>()
        var y = top.toFloat()
        var i = 0
        while (i < words.size) {
            val rows = listOf(y.toInt(), (y + lineH / 2).toInt(), (y + lineH - 1).toInt()).map { mask.chord(it, cx) }
            if (rows.any { it == null }) return null
            val left = rows.maxOf { it!![0] } + pad
            val right = rows.minOf { it!![1] } - pad
            val w = right - left
            if (w < size) return null
            var line = words[i]
            if (width(line, size) > w) return null
            i++
            while (i < words.size && width("$line ${words[i]}", size) <= w) { line = "$line ${words[i]}"; i++ }
            lines.add(line)
            spans.add(intArrayOf(left, right))
            y += lineH
        }
        return lines to spans
    }

    fun fitInMask(text: String, mask: ByteMask, anchor: Box, maxSize: Float, pad: Int = 4): TextLayout? {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return null
        val b = mask.bounds() ?: return null
        var sumY = 0L; var n = 0L
        for (y in b[1] until b[3]) for (x in b[0] until b[2]) if (mask[x, y].toInt() != 0) { sumY += y; n++ }
        if (n == 0L) return null
        val cx = (anchor.x1 + anchor.x2) / 2
        val cyAnchor = (anchor.y1 + anchor.y2) / 2f
        val cyMask = sumY.toFloat() / n
        val cy = if (Math.abs(cyAnchor - cyMask) < (b[3] - b[1]) * 0.25f) cyAnchor else cyMask
        var size = maxSize
        while (size >= minSize) {
            val (lineH, ascent) = metrics(size)
            var guess = 1
            var tries = 0
            while (tries++ < 14) {
                var top = (cy - guess * lineH / 2).toInt()
                var res = wrapPolygon(words, size, mask, cx, top, lineH, pad)
                if (res == null) { guess++; continue }
                if (res.first.size != guess) {
                    guess = res.first.size
                    top = (cy - guess * lineH / 2).toInt()
                    val res2 = wrapPolygon(words, size, mask, cx, top, lineH, pad)
                    if (res2 == null || res2.first.size != guess) { guess++; continue }
                    res = res2
                }
                val (lines, spans) = res
                val centers = ArrayList<FloatArray>()
                val lb = ArrayList<Box>()
                var x1 = Int.MAX_VALUE; var x2 = -1
                for (k in lines.indices) {
                    val w = width(lines[k], size)
                    val mid = (spans[k][0] + spans[k][1]) / 2f
                    val base = top + k * lineH + ascent
                    centers.add(floatArrayOf(mid, base))
                    val lx1 = (mid - w / 2).toInt(); val lx2 = (mid + w / 2).toInt()
                    lb.add(Box(lx1, (base - ascent).toInt(), lx2, (base - ascent + lineH).toInt()))
                    if (lx1 < x1) x1 = lx1; if (lx2 > x2) x2 = lx2
                }
                return TextLayout(size, lines, centers, Box(x1, top, x2, (top + lines.size * lineH).toInt()), lb)
            }
            size -= 1f
        }
        return null
    }

    fun fitInBox(text: String, box: Box, maxSize: Float, imageW: Int, imageH: Int, grow: Float = 1.2f): TextLayout? {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return null
        val cx = (box.x1 + box.x2) / 2f; val cy = (box.y1 + box.y2) / 2f
        val margin = 8f
        val w = minOf(box.w * grow, 2 * (cx - margin), 2 * (imageW - margin - cx))
        val h = minOf(box.h * grow, 2 * (cy - margin), 2 * (imageH - margin - cy))
        var size = maxSize
        while (size >= minSize) {
            val (lineH, ascent) = metrics(size)
            val lines = ArrayList<String>()
            var cur = ""
            var ok = true
            for (word in words) {
                val cand = if (cur.isEmpty()) word else "$cur $word"
                if (cur.isEmpty() || width(cand, size) <= w) cur = cand
                else { if (width(cur, size) > w) ok = false; lines.add(cur); cur = word }
            }
            if (cur.isNotEmpty()) lines.add(cur)
            if (!ok || lines.any { width(it, size) > w } || lines.size * lineH > h) { size -= 1f; continue }
            val top = cy - lines.size * lineH / 2
            val centers = lines.indices.map { floatArrayOf(cx, top + it * lineH + ascent) }
            val widest = lines.maxOf { width(it, size) }
            val lb = lines.indices.map { k -> Box((cx - width(lines[k], size) / 2).toInt(), (top + k * lineH).toInt(), (cx + width(lines[k], size) / 2).toInt(), (top + (k + 1) * lineH).toInt()) }
            return TextLayout(size, lines, centers, Box((cx - widest / 2).toInt(), top.toInt(), (cx + widest / 2).toInt(), (top + lines.size * lineH).toInt()), lb)
        }
        return null
    }

    /** داخل الفقاعة المتآكل، مقتسمًا مع الشقيقات. */
    fun innerMaskFor(img: RgbImage, region: Region, siblings: List<Region>?): ByteMask? {
        val mask = bubbleMaskFor(img, region) ?: return null
        return innerOf(mask, region, siblings, maxOf(6, (Cleaner.glyphHeight(region.glyph, region.box) * 0.45).toInt()))
    }

    private fun bubbleMaskFor(img: RgbImage, region: Region): ByteMask? =
        region.bubble?.mask ?: region.bubbleBox?.let { Regions.flatBoxMask(img, it, region.box) }

    private fun innerOf(mask: ByteMask, region: Region, siblings: List<Region>?, erode: Int): ByteMask {
        val gh = Cleaner.glyphHeight(region.glyph, region.box)
        val inner = mask.erode(erode)
        for (sib in siblings ?: emptyList()) {
            val gap = maxOf(4, gh / 2)
            if (sib.box.y1 >= region.box.y2) inner.fillRect(0, (region.box.y2 + sib.box.y1) / 2 - gap / 2, inner.width, inner.height, 0)
            else if (sib.box.y2 <= region.box.y1) inner.fillRect(0, 0, inner.width, (sib.box.y2 + region.box.y1) / 2 + gap / 2, 0)
            else inner.fillRect(sib.box.x1 - gap, sib.box.y1 - gap, sib.box.x2 + gap, sib.box.y2 + gap, 0)
        }
        return inner
    }

    /**
     * فقاعة معروفة: العربي داخل مضلّعها وحده، لا يخرج إلى الرسم أبدًا. إن لم يدخل
     * في الداخل المتآكل يُجرَّب هامش أرفع، ثم الصندوق بشرط أن يقع كله داخل الفقاعة؛
     * وإلا لا تخطيط (تبقى الفقاعة كما هي). النص الحر بلا فقاعة: الصندوق كما كان.
     */
    fun layoutRegion(img: RgbImage, region: Region, text: String, siblings: List<Region>?): TextLayout? {
        val gh = Cleaner.glyphHeight(region.glyph, region.box)
        val boxSize = maxOf(minSize + 4, minOf(gh * 1.15f, 96f))
        val bubble = bubbleMaskFor(img, region)
            ?: return fitInBox(text, region.box, boxSize, img.width, img.height)
        val maxSize = maxOf(minSize + 4, minOf(gh * 2.0f, 110f))
        val erode = maxOf(6, (gh * 0.45).toInt())
        fitInMask(text, innerOf(bubble, region, siblings, erode), region.box, maxSize)?.let { return it }
        val thin = maxOf(3, erode / 2)
        val inner = innerOf(bubble, region, siblings, thin)
        fitInMask(text, inner, region.box, maxSize, pad = 2)?.let { return it }
        return fitInBox(text, region.box, boxSize, img.width, img.height)?.takeIf { insideMask(it, inner) }
    }

    /** كل سطر (بزواياه ومنتصف حوافه) داخل القناع. */
    private fun insideMask(l: TextLayout, mask: ByteMask): Boolean = l.lineBounds.all { b ->
        val xs = intArrayOf(b.x1, (b.x1 + b.x2) / 2, b.x2 - 1)
        val ys = intArrayOf(b.y1, (b.y1 + b.y2) / 2, b.y2 - 1)
        xs.all { x -> ys.all { y -> x in 0 until mask.width && y in 0 until mask.height && mask[x, y].toInt() != 0 } }
    }

    /** يرسم التخطيط على الـBitmap: لون الحبر الأصلي، وحدّ مضاد فوق الرسم. */
    fun draw(canvas: Canvas, layout: TextLayout, inkLight: Boolean, onArt: Boolean) {
        val fill = Paint(paint).apply {
            textSize = layout.size
            color = if (inkLight) 0xFFFFFFFF.toInt() else 0xFF101010.toInt()
            style = Paint.Style.FILL
        }
        val stroke = if (onArt) Paint(paint).apply {
            textSize = layout.size
            color = if (inkLight) 0xFF101010.toInt() else 0xFFFFFFFF.toInt()
            style = Paint.Style.STROKE
            strokeWidth = maxOf(2f, layout.size / 9f) * 2
            strokeJoin = Paint.Join.ROUND
        } else null
        for (k in layout.lines.indices) {
            val (cx, base) = layout.centers[k].let { it[0] to it[1] }
            stroke?.let { canvas.drawText(layout.lines[k], cx, base, it) }
            canvas.drawText(layout.lines[k], cx, base, fill)
        }
    }

    companion object {
        fun bitmapOf(img: RgbImage): Bitmap {
            val bmp = Bitmap.createBitmap(img.width, img.height, Bitmap.Config.ARGB_8888)
            val px = IntArray(img.width * img.height)
            for (i in px.indices) px[i] = (0xff shl 24) or ((img.data[i * 3].toInt() and 0xff) shl 16) or ((img.data[i * 3 + 1].toInt() and 0xff) shl 8) or (img.data[i * 3 + 2].toInt() and 0xff)
            bmp.setPixels(px, 0, img.width, 0, 0, img.width, img.height)
            return bmp
        }

        fun rgbOf(bmp: Bitmap): RgbImage {
            val w = bmp.width; val h = bmp.height
            val px = IntArray(w * h)
            bmp.getPixels(px, 0, w, 0, 0, w, h)
            val out = ByteArray(w * h * 3)
            for (i in px.indices) {
                out[i * 3] = (px[i] shr 16).toByte(); out[i * 3 + 1] = (px[i] shr 8).toByte(); out[i * 3 + 2] = px[i].toByte()
            }
            return RgbImage(w, h, out)
        }
    }
}
