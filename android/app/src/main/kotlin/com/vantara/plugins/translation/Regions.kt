package com.vantara.plugins.translation

import java.security.MessageDigest

/**
 * تجميع ما رأته النماذج إلى «مناطق» بمعرّفات ثابتة، مع بوابات الأمان —
 * ترجمة حرفية لـ`vantara_worker/regions.py`:
 *
 *   منطقة = صندوق نص من RT-DETR + (اختياريًا) فقاعة تحتويه + قناع حروفها
 *   المقصوص داخل الصندوق والمنقّى بعتبة Otsu بقطبية الحبر.
 *   المعرّف من بصمة الصفحة وموضع الصندوق بالنسب (دقة 0.5%): ثابت عبر التشغيلات.
 *
 * بوابات الأمان: بلا حروف → لا منطقة؛ ثقة دون العتبة → لا منطقة؛ «فقاعة»
 * بلا نص → تُهمل.
 */
class Region(
    val id: String,
    val box: Box,
    val score: Float,
    var kind: String, // speech | narration | free | sfx
    val bubble: Bubble?,
    val bubbleBox: Box?,
    val glyph: ByteMask,
    val glyphPixels: Int,
    val inkLight: Boolean,
) {
    var ocr: OcrResult? = null
    var source: String = ""
    var arabic: String? = null
    var status: String = "pending"
    var eraseMask: ByteMask? = null
    var cleanMode: String? = null
    var fillColor: IntArray? = null
    var layout: TextLayout? = null
}

object Regions {
    const val MIN_SCORE = 0.35f
    const val MIN_GLYPH_PIXELS = 40
    const val MIN_OCR_CONF = 0.55f

    fun stableId(pageHash: String, box: Box, width: Int, height: Int): String {
        val key = "$pageHash:${Math.round(200f * box.x1 / width)}:${Math.round(200f * box.y1 / height)}:${Math.round(200f * box.x2 / width)}:${Math.round(200f * box.y2 / height)}"
        val d = MessageDigest.getInstance("SHA-1").digest(key.toByteArray())
        return "r" + d.joinToString("") { "%02x".format(it) }.substring(0, 8)
    }

    /** صناديق النص المتكررة أو المتداخلة تُدمج في صندوق واحد يحيط بهما. */
    fun mergeTextBoxes(dets: List<Detection>, iouThr: Float = 0.4f, containThr: Float = 0.75f): List<Detection> {
        val texts = dets.filter { it.label.startsWith("text") }.sortedByDescending { it.score }
        val merged = ArrayList<Detection>()
        for (d in texts) {
            val hit = merged.indexOfFirst { m -> m.box.iou(d.box) > iouThr || m.box.contains(d.box) > containThr || d.box.contains(m.box) > containThr }
            if (hit < 0) { merged.add(d); continue }
            val m = merged[hit]
            merged[hit] = Detection(m.box.union(d.box), maxOf(m.score, d.score), if (m.score >= d.score) m.label else d.label)
        }
        return merged
    }

    /** قناع UNet خشن؛ يُقطع ببكسلات الحبر الفعلية (Otsu بقطبية الحبر داخل الصندوق). */
    fun refineGlyph(img: RgbImage, gray: ByteArray, glyph: ByteMask, box: Box): ByteMask {
        val pad = 6
        val x1 = maxOf(0, box.x1 - pad); val y1 = maxOf(0, box.y1 - pad)
        val x2 = minOf(img.width, box.x2 + pad); val y2 = minOf(img.height, box.y2 + pad)
        var inSum = 0L; var inN = 0L; var outSum = 0L; var outN = 0L
        for (y in y1 until y2) for (x in x1 until x2) {
            val v = (gray[y * img.width + x].toInt() and 0xff).toLong()
            if (glyph[x, y].toInt() != 0) { inSum += v; inN++ } else { outSum += v; outN++ }
        }
        if (inN == 0L) return glyph
        val light = outN == 0L || inSum / inN > outSum / outN
        val thr = ByteMask.otsu(gray, img.width, x1, y1, x2, y2)
        val core = glyph.dilate(1)
        val ink = ByteMask(img.width, img.height)
        for (y in y1 until y2) for (x in x1 until x2) {
            val v = gray[y * img.width + x].toInt() and 0xff
            val isInk = if (light) v > thr else v <= thr
            if (isInk && core[x, y].toInt() != 0) ink[x, y] = 1
        }
        // مكوّنات يغطيها القناع الأصلي بنصفها على الأقل: الباقي خط رسم مرّ بالصندوق
        val (labels, comps) = ink.components(true)
        val keep = ByteMask(img.width, img.height)
        val overlap = IntArray(comps.size + 1)
        for (i in labels.indices) if (labels[i] != 0 && glyph.data[i].toInt() != 0) overlap[labels[i]]++
        val ok = BooleanArray(comps.size + 1)
        for (c in comps) if (c.area >= 3 && overlap[c.label] * 2 >= c.area) ok[c.label] = true
        for (i in labels.indices) if (labels[i] != 0 && ok[labels[i]]) keep.data[i] = 1
        return if (keep.count() < 0.25 * glyph.count()) glyph else keep
    }

    fun inkIsLight(gray: ByteArray, width: Int, glyph: ByteMask, box: Box): Boolean {
        val vals = ArrayList<Int>()
        for (y in maxOf(0, box.y1) until minOf(glyph.height, box.y2)) for (x in maxOf(0, box.x1) until minOf(glyph.width, box.x2)) if (glyph[x, y].toInt() != 0) vals.add(gray[y * width + x].toInt() and 0xff)
        if (vals.isEmpty()) return false
        vals.sort()
        return vals[vals.size / 2] > 140
    }

    /**
     * قناع صندوق سرد مستطيل فاته YOLO-seg: المكوّن المتصل بلون الحافة الداخلية
     * للصندوق. null إن لم يكن مسطّح اللون (نص فوق رسم).
     */
    fun flatBoxMask(img: RgbImage, bubbleBox: Box, textBox: Box, tol: Int = 18): ByteMask? {
        val bw = bubbleBox.w; val bh = bubbleBox.h
        if (bw < 8 || bh < 8) return null
        val m = maxOf(2, minOf(6, bh / 12))
        val ring = ArrayList<IntArray>()
        for (y in bubbleBox.y1 until bubbleBox.y2) for (x in bubbleBox.x1 until bubbleBox.x2) {
            if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
            val onRing = (y - bubbleBox.y1 < m) || (bubbleBox.y2 - 1 - y < m) || (x - bubbleBox.x1 < m) || (bubbleBox.x2 - 1 - x < m)
            val inText = x >= textBox.x1 - 2 && x < textBox.x2 + 2 && y >= textBox.y1 - 2 && y < textBox.y2 + 2
            if (onRing && !inText) ring.add(intArrayOf(img.r(x, y), img.g(x, y), img.b(x, y)))
        }
        if (ring.size < 20) return null
        val color = IntArray(3) { c -> ring.map { it[c] }.sorted()[ring.size / 2] }
        val spread = ring.map { (Math.abs(it[0] - color[0]) + Math.abs(it[1] - color[1]) + Math.abs(it[2] - color[2])) / 3.0 }.average()
        if (spread > 10) return null
        val close = ByteMask(img.width, img.height)
        for (y in maxOf(0, bubbleBox.y1) until minOf(img.height, bubbleBox.y2)) for (x in maxOf(0, bubbleBox.x1) until minOf(img.width, bubbleBox.x2)) {
            val d = maxOf(Math.abs(img.r(x, y) - color[0]), Math.abs(img.g(x, y) - color[1]), Math.abs(img.b(x, y) - color[2]))
            if (d <= tol) close[x, y] = 1
        }
        val closed = close.close(2)
        val (labels, comps) = closed.components(false)
        if (comps.isEmpty()) return null
        // المكوّن الذي يلامس معظم الحلقة
        val counts = IntArray(comps.size + 1)
        var ringN = 0
        for (y in maxOf(0, bubbleBox.y1) until minOf(img.height, bubbleBox.y2)) for (x in maxOf(0, bubbleBox.x1) until minOf(img.width, bubbleBox.x2)) {
            val onRing = (y - bubbleBox.y1 < m) || (bubbleBox.y2 - 1 - y < m) || (x - bubbleBox.x1 < m) || (bubbleBox.x2 - 1 - x < m)
            if (!onRing) continue
            ringN++
            val l = labels[y * img.width + x]
            if (l != 0) counts[l]++
        }
        val best = counts.indices.maxByOrNull { counts[it] } ?: return null
        if (best == 0 || counts[best] < ringN * 0.8) return null
        val comp = ByteMask(img.width, img.height)
        for (i in labels.indices) if (labels[i] == best) comp.data[i] = 1
        return comp.filledHoles()
    }

    fun assemble(img: RgbImage, gray: ByteArray, pageHash: String, dets: List<Detection>, bubbles: List<Bubble>, glyphFull: ByteMask): List<Region> {
        val bubbleBoxes = dets.filter { it.label == "bubble" }
        val out = ArrayList<Region>()
        for (d in mergeTextBoxes(dets)) {
            if (d.score < MIN_SCORE) continue
            val pad = 10
            var glyph = glyphFull.clipped(d.box.x1 - pad, d.box.y1 - pad, d.box.x2 + pad, d.box.y2 + pad)
            glyph = refineGlyph(img, gray, glyph, d.box)
            val n = glyph.count()
            if (n < MIN_GLYPH_PIXELS) continue
            var bubble: Bubble? = null
            var bestCov = 0f
            for (b in bubbles) {
                var inside = 0; var total = 0
                for (y in maxOf(0, d.box.y1) until minOf(img.height, d.box.y2)) for (x in maxOf(0, d.box.x1) until minOf(img.width, d.box.x2)) { total++; if (b.mask[x, y].toInt() != 0) inside++ }
                val cov = if (total > 0) inside.toFloat() / total else 0f
                if (cov > bestCov) { bestCov = cov; bubble = b }
            }
            if (bestCov < 0.85f) bubble = null
            var bubbleBox = bubble?.box
            if (bubble == null) {
                val holder = bubbleBoxes.filter { it.box.contains(d.box) > 0.9f }.maxByOrNull { it.score }
                if (holder != null && holder.box.area > 1.15 * d.box.area) bubbleBox = holder.box
            }
            val light = inkIsLight(gray, img.width, glyph, d.box)
            val kind = when {
                bubble != null -> "speech"
                bubbleBox != null -> "narration"
                d.label == "text_free" && d.score < 0.5f -> "sfx"
                else -> "free"
            }
            out.add(Region(stableId(pageHash, d.box, img.width, img.height), d.box, d.score, kind, bubble, bubbleBox, glyph, n, light))
        }
        // ترتيب القراءة: من أعلى لأسفل ثم من اليمين لليسار
        return out.sortedWith(compareBy({ it.box.y1 / 60 }, { -it.box.x1 }))
    }

    /** المناطق التي تتشارك الفقاعة نفسها. */
    fun siblings(regions: List<Region>): Map<String, List<Region>> {
        val out = HashMap<String, List<Region>>()
        for (a in regions) {
            val same = regions.filter { b -> b !== a && ((a.bubble != null && a.bubble === b.bubble) || (a.bubble == null && a.bubbleBox != null && a.bubbleBox == b.bubbleBox)) }
            if (same.isNotEmpty()) out[a.id] = same
        }
        return out
    }
}
