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
    /** ما يقرؤه التجميع من قناع الحروف حول كل صندوق (`pad`) وزيادة. */
    const val GLYPH_MARGIN = 16

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
        // الحبر محصور في الصندوق؛ التسميات خارجه صفر
        val win = ink.scanWindow()
        if (win != null) for (y in win[1] until win[3]) for (x in win[0] until win[2]) {
            val i = y * img.width + x
            if (labels[i] != 0 && glyph.data[i].toInt() != 0) overlap[labels[i]]++
        }
        val ok = BooleanArray(comps.size + 1)
        for (c in comps) if (c.area >= 3 && overlap[c.label] * 2 >= c.area) ok[c.label] = true
        if (win != null) for (y in win[1] until win[3]) for (x in win[0] until win[2]) {
            val i = y * img.width + x
            if (labels[i] != 0 && ok[labels[i]]) keep.data[i] = 1
        }
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
        val c = comps.first { it.label == best }
        for (y in c.y0 until c.y1) for (x in c.x0 until c.x1) {
            val i = y * img.width + x
            if (labels[i] == best) comp.data[i] = 1
        }
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
        return unify(img, gray, pageHash, out, bubbles, glyphFull).sortedWith(compareBy({ it.box.y1 / 60 }, { -it.box.x1 }))
    }

    /**
     * فقاعة واحدة = جملة واحدة = منطقة واحدة.
     *
     * الكاشف يقسم نص الفقاعة أحيانًا صناديق (سطر وسطران بينهما فراغ)، وأحيانًا يفوته
     * سطر كامل. النتيجة كانت: كل صندوق يُقرأ ويُترجم وحده (ترجمتان في فقاعة واحدة)،
     * والسطر الفائت لا يدخل أي قناع مسح فيبقى إنجليزيًّا تحت العربي.
     *
     * هنا:
     *  1. منطقة داخل فقاعة لم تُنسب لها (نصف صندوقها أو أكثر في قناعها) تُنسب لها.
     *  2. حبر النص داخل الفقاعة (قناع الحروف داخل حدّها المتآكل) الذي لم يدخل أي
     *     صندوق يُضم لأقرب مجموعة، ومكوّن يقع بين مجموعتين يصلهما (سطر فائت في الوسط).
     *  3. الصناديق المتقاربة (فجوة ≤ 2.5 سطر) تُدمج: قناع حروف واحد، صندوق واحد،
     *     قراءة واحدة بكل الأسطر، وترجمة واحدة. المتباعدة (فقاعتان ملتحمتان) تبقى منفصلة.
     * معرّف المنطقة المنفردة لا يتغير (ترجماتها المحفوظة تبقى صالحة)؛ المدموجة تأخذ
     * معرّف مجموع صناديقها.
     */
    internal fun unify(img: RgbImage, gray: ByteArray, pageHash: String, regions: List<Region>, bubbles: List<Bubble>, glyphFull: ByteMask): List<Region> {
        if (bubbles.isEmpty()) return regions
        val owner = java.util.IdentityHashMap<Region, Bubble>()
        for (r in regions) {
            val b = r.bubble ?: if (r.kind == "sfx") null else adoptive(img, r.box, bubbles)
            if (b != null) owner[r] = b
        }
        if (owner.isEmpty()) return regions
        val groups = java.util.IdentityHashMap<Bubble, MutableList<Region>>()
        for (r in regions) owner[r]?.let { groups.getOrPut(it) { ArrayList() }.add(r) }
        val out = ArrayList<Region>(regions.filter { owner[it] == null })
        for ((b, group) in groups) out += mergeBubble(img, gray, pageHash, b, group, glyphFull)
        return out
    }

    /** فقاعة تحتوي مركز الصندوق ونصفه على الأقل (منطقة فاتها شرط 85%). */
    private fun adoptive(img: RgbImage, box: Box, bubbles: List<Bubble>): Bubble? {
        val cx = ((box.x1 + box.x2) / 2).coerceIn(0, img.width - 1)
        val cy = ((box.y1 + box.y2) / 2).coerceIn(0, img.height - 1)
        return bubbles.firstOrNull { b ->
            if (b.mask[cx, cy].toInt() == 0) return@firstOrNull false
            var inside = 0; var total = 0
            for (y in maxOf(0, box.y1) until minOf(img.height, box.y2)) for (x in maxOf(0, box.x1) until minOf(img.width, box.x2)) { total++; if (b.mask[x, y].toInt() != 0) inside++ }
            total > 0 && inside * 2 >= total
        }
    }

    private fun gap(a: Box, b: Box): Pair<Int, Int> =
        maxOf(0, maxOf(a.x1, b.x1) - minOf(a.x2, b.x2)) to maxOf(0, maxOf(a.y1, b.y1) - minOf(a.y2, b.y2))

    private fun mergeBubble(img: RgbImage, gray: ByteArray, pageHash: String, b: Bubble, group: List<Region>, glyphFull: ByteMask): List<Region> {
        val heights = group.map { Cleaner.glyphHeight(it.glyph, it.box) }.sorted()
        val gh = maxOf(6, heights[heights.size / 2])
        // اتحاد-بحث على الصناديق المتقاربة
        val parent = IntArray(group.size) { it }
        fun find(i: Int): Int { var x = i; while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x] }; return x }
        fun join(a: Int, c: Int) { val ra = find(a); val rc = find(c); if (ra != rc) parent[ra] = rc }
        val near = (gh * 2.5).toInt()
        for (i in group.indices) for (j in i + 1 until group.size) {
            val (gx, gy) = gap(group[i].box, group[j].box)
            if (gx <= near && gy <= near) join(i, j)
        }
        // حبر نص داخل الفقاعة لم يدخل أي صندوق
        val inner = Cleaner.innerOf(b.mask, maxOf(2, gh / 5))
        var claimed = ByteMask(img.width, img.height)
        for (r in group) claimed = claimed.or(r.glyph)
        claimed = claimed.dilate(2)
        val stray = ByteMask(img.width, img.height)
        val bx0 = maxOf(0, b.box.x1); val by0 = maxOf(0, b.box.y1); val bx1 = minOf(img.width, b.box.x2); val by1 = minOf(img.height, b.box.y2)
        for (y in by0 until by1) for (x in bx0 until bx1) {
            val i = y * img.width + x
            if (glyphFull.data[i].toInt() != 0 && inner.data[i].toInt() != 0 && claimed.data[i].toInt() == 0) stray.data[i] = 1
        }
        val (labels, comps) = stray.components(true)
        val extra = HashMap<Int, ByteMask>() // جذر المجموعة ← حبرها الإضافي
        // بحجم حرف أو كلمة، لا خط رسم ولا نقطة ضجيج
        val pending = comps.filter { c -> val h = c.y1 - c.y0; c.area >= 12 && h <= gh * 2.2 && h >= gh * 0.3 && c.x1 - c.x0 <= b.box.w }.toMutableList()
        // الصندوق ينمو بما يُضم إليه: سطور فائتة متتالية فوق الصندوق (الكاشف أخذ آخر
        // سطرين من فقاعة بخمسة) تنضم سطرًا بعد سطر، لا الأقرب وحده
        val grown = group.map { it.box }.toMutableList()
        var changed = true
        while (changed && pending.isNotEmpty()) {
            changed = false
            val it = pending.iterator()
            while (it.hasNext()) {
                val c = it.next()
                val cb = Box(c.x0, c.y0, c.x1, c.y1)
                val close = group.indices.filter { idx -> val (gx, gy) = gap(grown[idx], cb); gy <= gh * 3 && gx <= gh * 4 }
                if (close.isEmpty()) continue
                // سطر فائت بين مجموعتين: هما جملة واحدة
                for (k in 1 until close.size) join(close[0], close[k])
                grown[close[0]] = grown[close[0]].union(cb)
                val root = find(close[0])
                val m = extra.getOrPut(root) { ByteMask(img.width, img.height) }
                for (y in c.y0 until c.y1) for (x in c.x0 until c.x1) {
                    val i = y * img.width + x
                    if (labels[i] == c.label) m.data[i] = 1
                }
                it.remove()
                changed = true
            }
        }
        // الجذور قد تغيّرت بعد الوصل: الحبر الإضافي يُعاد إلى جذره الأخير
        val extraByRoot = HashMap<Int, ByteMask>()
        for ((root, m) in extra) {
            val r = find(root)
            extraByRoot[r] = extraByRoot[r]?.or(m) ?: m
        }
        val clusters = group.indices.groupBy { find(it) }
        return clusters.map { (root, members) ->
            val rs = members.map { group[it] }
            val add = extraByRoot[root]
            if (rs.size == 1 && add == null) {
                val r = rs[0]
                if (r.bubble === b) r
                else Region(r.id, r.box, r.score, "speech", b, b.box, r.glyph, r.glyphPixels, r.inkLight)
            } else {
                var glyph = rs[0].glyph
                for (r in rs.drop(1)) glyph = glyph.or(r.glyph)
                if (add != null) glyph = glyph.or(add)
                val detBox = rs.map { it.box }.reduce { a, c -> a.union(c) }
                val gb = glyph.bounds()
                val box = if (gb != null) detBox.union(Box(gb[0], gb[1], gb[2], gb[3])) else detBox
                val id = if (rs.size == 1) rs[0].id else stableId(pageHash, detBox, img.width, img.height)
                val n = glyph.count()
                Region(id, box, rs.maxOf { it.score }, "speech", b, b.box, glyph, n, inkIsLight(gray, img.width, glyph, box))
            }
        }
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
