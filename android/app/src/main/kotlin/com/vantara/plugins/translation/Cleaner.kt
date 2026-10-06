package com.vantara.plugins.translation

/**
 * التبييض الآمن — ترجمة حرفية لـ`vantara_worker/clean.py`:
 *   1. فقاعة مسطّحة: ملء بلونها الدقيق داخل حدّها المتآكل (الحروف + ما يخالف لونها قربها).
 *   2. فقاعة فيها رسم أو نص فوق الرسم: LaMa على الحروف موسَّعة بما يكفي لحدّ الحرف وهالته.
 *   3. لا عربي = لا مسح.
 * لا بكسل خارج `eraseMask` يتغير.
 */
object Cleaner {
    /** ما حدث فعلًا أثناء التبييض، لا مجرد «دخلنا الدالة». */
    data class EraseStats(
        var maskPixels: Int = 0,
        var changedPixels: Int = 0,
        var fillMaskPixels: Int = 0,
        var fillChangedPixels: Int = 0,
        var reconstructMaskPixels: Int = 0,
        var reconstructChangedPixels: Int = 0,
        var inpaintMaskPixels: Int = 0,
        var inpaintChangedPixels: Int = 0,
        var fillRegions: Int = 0,
        var reconstructRegions: Int = 0,
        var inpaintRegions: Int = 0,
        var noOpRegions: Int = 0,
        var scaledInpaintRegions: Int = 0,
    )

    /**
     * E2 reconstruction model. Coordinates are normalized around the sampled holder so
     * the least-squares fit stays numerically stable even on very tall webtoon pages.
     */
    data class Reconstruction(
        val cx: Double,
        val cy: Double,
        val scale: Double,
        val r: DoubleArray,
        val g: DoubleArray,
        val b: DoubleArray,
        val mae: Double,
    ) {
        fun colorAt(x: Double, y: Double): IntArray {
            val nx = (x - cx) / scale
            val ny = (y - cy) / scale
            fun channel(c: DoubleArray): Int = Math.round(c[0] + c[1] * nx + c[2] * ny).toInt().coerceIn(0, 255)
            return intArrayOf(channel(r), channel(g), channel(b))
        }
    }

    private fun solve3(m: DoubleArray, rhs: DoubleArray): DoubleArray? {
        val a = Array(3) { row -> DoubleArray(4) { col -> if (col < 3) m[row * 3 + col] else rhs[row] } }
        for (col in 0..2) {
            var pivot = col
            for (row in col + 1..2) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row
            if (Math.abs(a[pivot][col]) < 1e-7) return null
            if (pivot != col) {
                val tmp = a[pivot]
                a[pivot] = a[col]
                a[col] = tmp
            }
            val div = a[col][col]
            for (j in col..3) a[col][j] /= div
            for (row in 0..2) {
                if (row == col) continue
                val f = a[row][col]
                for (j in col..3) a[row][j] -= f * a[col][j]
            }
        }
        return doubleArrayOf(a[0][3], a[1][3], a[2][3])
    }

    /**
     * Conservative E2 admission. It does not synthesize arbitrary art: only a locally
     * smooth RGB plane that predicts safe holder pixels with low error is accepted.
     * Anything more complex remains E3 LaMa.
     */
    private fun fitReconstruction(img: RgbImage, inner: ByteMask, exclude: ByteMask): Reconstruction? {
        val w = inner.scanWindow() ?: return null
        val ww = w[2] - w[0]
        val hh = w[3] - w[1]
        if (ww < 12 || hh < 12) return null
        val stride = maxOf(1, maxOf(ww, hh) / 72)
        val cx = (w[0] + w[2] - 1) / 2.0
        val cy = (w[1] + w[3] - 1) / 2.0
        val scale = maxOf(ww, hh).toDouble().coerceAtLeast(1.0)
        val normal = DoubleArray(9)
        val rr = DoubleArray(3)
        val gg = DoubleArray(3)
        val bb = DoubleArray(3)
        var trained = 0
        for (y in w[1] until w[3] step stride) for (x in w[0] until w[2] step stride) {
            if (inner[x, y].toInt() == 0 || exclude[x, y].toInt() != 0) continue
            // Deterministic spatial hold-out: validation pixels never influence the fit.
            if (((x - w[0]) / stride + (y - w[1]) / stride) % 3 == 0) continue
            val f = doubleArrayOf(1.0, (x - cx) / scale, (y - cy) / scale)
            for (i in 0..2) {
                for (j in 0..2) normal[i * 3 + j] += f[i] * f[j]
                rr[i] += f[i] * img.r(x, y)
                gg[i] += f[i] * img.g(x, y)
                bb[i] += f[i] * img.b(x, y)
            }
            trained++
        }
        if (trained < 60) return null
        val rc = solve3(normal, rr) ?: return null
        val gc = solve3(normal, gg) ?: return null
        val bc = solve3(normal, bb) ?: return null
        val model = Reconstruction(cx, cy, scale, rc, gc, bc, 0.0)
        var error = 0.0
        var checked = 0
        var outliers = 0
        for (y in w[1] until w[3] step stride) for (x in w[0] until w[2] step stride) {
            if (inner[x, y].toInt() == 0 || exclude[x, y].toInt() != 0) continue
            if (((x - w[0]) / stride + (y - w[1]) / stride) % 3 != 0) continue
            val p = model.colorAt(x.toDouble(), y.toDouble())
            val e = (Math.abs(img.r(x, y) - p[0]) + Math.abs(img.g(x, y) - p[1]) + Math.abs(img.b(x, y) - p[2])) / 3.0
            error += e
            if (e > 12.0) outliers++
            checked++
        }
        if (checked < 30) return null
        val mae = error / checked
        if (mae > 4.75 || outliers > maxOf(2, checked / 20)) return null
        return Reconstruction(cx, cy, scale, rc, gc, bc, mae)
    }

    fun glyphHeight(glyph: ByteMask, box: Box): Int {
        val runs = ArrayList<Int>()
        var n = 0
        for (y in maxOf(0, box.y1) until minOf(glyph.height, box.y2)) {
            var any = false
            for (x in maxOf(0, box.x1) until minOf(glyph.width, box.x2)) if (glyph[x, y].toInt() != 0) { any = true; break }
            if (any) n++ else if (n > 0) { runs.add(n); n = 0 }
        }
        if (n > 0) runs.add(n)
        if (runs.isEmpty()) return 12
        runs.sort()
        return runs[runs.size / 2]
    }

    /** لون الفقاعة حول النص ومدى تجانسه (متوسط البعد عن الوسيط). */
    private fun flatColor(img: RgbImage, inner: ByteMask, nearText: ByteMask): Pair<IntArray?, Double> {
        val rs = ArrayList<Int>(); val gs = ArrayList<Int>(); val bs = ArrayList<Int>()
        val w = inner.scanWindow() ?: return null to 999.0
        for (y in w[1] until w[3]) for (x in w[0] until w[2]) {
            if (inner[x, y].toInt() == 0 || nearText[x, y].toInt() != 0) continue
            rs.add(img.r(x, y)); gs.add(img.g(x, y)); bs.add(img.b(x, y))
        }
        if (rs.size < 50) return null to 999.0
        rs.sort(); gs.sort(); bs.sort()
        val med = intArrayOf(rs[rs.size / 2], gs[gs.size / 2], bs[bs.size / 2])
        var spread = 0.0
        for (i in rs.indices) spread += (Math.abs(rs[i] - med[0]) + Math.abs(gs[i] - med[1]) + Math.abs(bs[i] - med[2])) / 3.0
        return med to spread / rs.size
    }

    /**
     * حروف إنجليزية فاتها قناع الحروف ومضلّع الفقاعة (عند حافة الفقاعة، أو حيث يقصر
     * المضلّع): الداخل الحقيقي للفقاعة يُؤخذ من الصورة نفسها — ورق بلونها متصل بما
     * حول النص ومحبوس بإطارها — وكل علامة محاطة بالورق كليًّا على أسطر النص وبحجم
     * حرف تُمسح. الإطار والذيل والرسم خارجه لا يُحاطون بالورق فلا يُلمسون.
     */
    internal fun enclosedInk(img: RgbImage, color: IntArray, bubbleMask: ByteMask, seeds: ByteMask, box: Box, gh: Int, others: ByteMask): ByteMask {
        val out = ByteMask(img.width, img.height)
        // نافذة واسعة حول الفقاعة والنص: الإطار الأسود هو الحدّ لا المضلّع المكتشف
        val bb = bubbleMask.bounds() ?: return out
        // المضلّع قد يقصر عن الفقاعة الحقيقية: نافذة بقدر الفقاعة نفسها من كل جهة
        val span = maxOf(gh * 8, bb[2] - bb[0], bb[3] - bb[1])
        val x0 = maxOf(0, minOf(bb[0], box.x1) - span); val y0 = maxOf(0, minOf(bb[1], box.y1) - span)
        val x1 = minOf(img.width, maxOf(bb[2], box.x2) + span); val y1 = minOf(img.height, maxOf(bb[3], box.y2) + span)
        val ww = x1 - x0; val wh = y1 - y0
        fun paper(x: Int, y: Int): Boolean =
            maxOf(Math.abs(img.r(x, y) - color[0]), Math.abs(img.g(x, y) - color[1]), Math.abs(img.b(x, y) - color[2])) <= 40
        // ١. الورق: متصل (4 جوار) ببكسلات ورق حول النص
        val inside = ByteArray(ww * wh)
        val queue = java.util.ArrayDeque<Int>()
        for (y in y0 until y1) for (x in x0 until x1) {
            if (seeds[x, y].toInt() != 0 && paper(x, y)) { inside[(y - y0) * ww + (x - x0)] = 1; queue.add((y - y0) * ww + (x - x0)) }
        }
        if (queue.isEmpty()) return out
        var leaked = false
        while (queue.isNotEmpty()) {
            val p = queue.poll()
            val lx = p % ww; val ly = p / ww
            if (lx == 0 || ly == 0 || lx == ww - 1 || ly == wh - 1) leaked = true
            for ((dx, dy) in NEIGHBOURS) {
                val nx = lx + dx; val ny = ly + dy
                if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue
                val q = ny * ww + nx
                if (inside[q].toInt() == 0 && paper(x0 + nx, y0 + ny)) { inside[q] = 1; queue.add(q) }
            }
        }
        // الورق يسيل خارج الفقاعة (إطار مفتوح، فقاعة ملتحمة بخلفية بلونها): لا شيء زائد
        if (leaked) return out
        // ٢. ما ليس ورقًا ويصل حافة النافذة دون عبور الورق: خارج (إطار، ذيل، رسم)
        val outside = ByteArray(ww * wh)
        fun seedOut(q: Int) { if (inside[q].toInt() == 0 && outside[q].toInt() == 0) { outside[q] = 1; queue.add(q) } }
        for (x in 0 until ww) { seedOut(x); seedOut((wh - 1) * ww + x) }
        for (y in 0 until wh) { seedOut(y * ww); seedOut(y * ww + ww - 1) }
        while (queue.isNotEmpty()) {
            val p = queue.poll()
            val lx = p % ww; val ly = p / ww
            for ((dx, dy) in NEIGHBOURS) {
                val nx = lx + dx; val ny = ly + dy
                if (nx < 0 || ny < 0 || nx >= ww || ny >= wh) continue
                seedOut(ny * ww + nx)
            }
        }
        // ٣. المحاط بالورق: مكوّنات بحجم حرف على أسطر النص، لا نص فقاعة شقيقة
        val enclosed = ByteMask(img.width, img.height)
        for (ly in 0 until wh) for (lx in 0 until ww) {
            val q = ly * ww + lx
            if (inside[q].toInt() == 0 && outside[q].toInt() == 0) enclosed[x0 + lx, y0 + ly] = 1
        }
        val sib = others.dilate(maxOf(3, gh / 3))
        val rowTop = box.y1 - gh / 2; val rowBottom = box.y2 + gh / 2
        val (labels, comps) = enclosed.components(true)
        for (c in comps) {
            val cy = (c.y0 + c.y1) / 2
            // كلمة بخط عريض تلتحم حروفها («MEAN») فتصير مكوّنًا واحدًا أعرض من حرف:
            // الطول بقدر سطر هو الحدّ، والعرض بقدر الفقاعة (محاطة بالورق كليًّا أصلًا)
            if (c.y1 - c.y0 > gh * 2 || c.x1 - c.x0 > maxOf(gh * 3, bb[2] - bb[0]) || cy < rowTop || cy > rowBottom) continue
            var touchesSibling = false
            for (y in c.y0 until c.y1) for (x in c.x0 until c.x1) if (labels[y * img.width + x] == c.label && sib[x, y].toInt() != 0) touchesSibling = true
            if (touchesSibling) continue
            // بكسل حوله يغطي الحافة الناعمة للحرف
            for (y in maxOf(0, c.y0 - 1) until minOf(img.height, c.y1 + 1)) for (x in maxOf(0, c.x0 - 1) until minOf(img.width, c.x1 + 1)) {
                var hit = false
                for (dy in -1..1) for (dx in -1..1) {
                    val nx = x + dx; val ny = y + dy
                    if (nx in 0 until img.width && ny in 0 until img.height && labels[ny * img.width + nx] == c.label) hit = true
                }
                if (hit) out[x, y] = 1
            }
        }
        return out
    }

    private val NEIGHBOURS = arrayOf(1 to 0, -1 to 0, 0 to 1, 0 to -1)

    /**
     * داخل الفقاعة بعيدًا عن إطارها. فقاعة يقطعها طرف الصورة (الويبتون مقسوم صورًا،
     * والفقاعة تكمل في التالية) لا إطار لها هناك: التآكل من طرف الصورة كان يترك
     * آخر سطر ملاصق للحافة بلا مسح. حيث تصل الفقاعة الحافة يبقى داخلها كما هو.
     */
    internal fun innerOf(bubbleMask: ByteMask, erode: Int): ByteMask {
        val inner = bubbleMask.erode(erode)
        val w = bubbleMask.width; val h = bubbleMask.height
        val e = minOf(erode, w, h)
        for (x in 0 until w) {
            if (bubbleMask[x, h - 1].toInt() != 0) for (y in h - e until h) if (bubbleMask[x, y].toInt() != 0) inner[x, y] = 1
            if (bubbleMask[x, 0].toInt() != 0) for (y in 0 until e) if (bubbleMask[x, y].toInt() != 0) inner[x, y] = 1
        }
        for (y in 0 until h) {
            if (bubbleMask[w - 1, y].toInt() != 0) for (x in w - e until w) if (bubbleMask[x, y].toInt() != 0) inner[x, y] = 1
            if (bubbleMask[0, y].toInt() != 0) for (x in 0 until e) if (bubbleMask[x, y].toInt() != 0) inner[x, y] = 1
        }
        return inner
    }

    fun planErase(img: RgbImage, region: Region, siblings: List<Region>?) {
        val gh = glyphHeight(region.glyph, region.box)
        val core = region.glyph.close(2)
        var others = ByteMask(img.width, img.height)
        siblings?.forEach { others = others.or(it.glyph) }

        var bubbleMask: ByteMask? = region.bubble?.mask
        if (bubbleMask == null && region.bubbleBox != null) bubbleMask = Regions.flatBoxMask(img, region.bubbleBox, region.box)

        if (bubbleMask != null) {
            val erode = maxOf(3, (gh * 0.25).toInt())
            val inner = innerOf(bubbleMask, erode)
            val grow = maxOf(7, (gh * 0.45).toInt())
            val near = core.dilate(grow)
            val (color, spread) = flatColor(img, inner, core.or(others).dilate((grow * 3) / 2))
            if (color != null && spread < 7.0) {
                val halo = core.dilate(grow * 2)
                val mask = ByteMask(img.width, img.height)
                val w = inner.scanWindow()
                if (w != null) for (y in w[1] until w[3]) for (x in w[0] until w[2]) {
                    if (inner[x, y].toInt() == 0) continue
                    val deviant = maxOf(Math.abs(img.r(x, y) - color[0]), Math.abs(img.g(x, y) - color[1]), Math.abs(img.b(x, y) - color[2])) > 12
                    if (near[x, y].toInt() != 0 || (deviant && halo[x, y].toInt() != 0)) mask[x, y] = 1
                }
                // فقاعة مسطّحة: الكاشف قد يقصّ صندوق النص قبل ظلّ/طرف حرف ببضعة بكسلات.
                // ±2 الثابتة تركت بقايا سوداء فعلية في صفحات الجهاز. بما أن الخلفية هنا
                // اجتازت اختبار التجانس (spread < 7)، نوسّع شريط الصندوق بنسبة من ارتفاع
                // الحرف، لكن لا نخرج أبدًا من داخل الفقاعة المتآكل.
                val box = ByteMask(img.width, img.height)
                val boxPad = maxOf(2, (gh * 0.60).toInt())
                box.fillRect(region.box.x1 - boxPad, region.box.y1 - boxPad, region.box.x2 + boxPad, region.box.y2 + boxPad)
                region.eraseMask = mask.open(1).or(near.and(inner)).or(box.and(inner)).or(enclosedInk(img, color, bubbleMask, near.and(inner), region.box, gh, others))
                region.cleanMode = "fill"
                region.fillColor = color
                region.reconstruction = null
                return
            }
            val localMask = near.and(inner)
            val reconstruction = fitReconstruction(img, inner, core.or(others).dilate(grow * 2))
            if (reconstruction != null && localMask.any()) {
                region.eraseMask = localMask
                region.cleanMode = "reconstruct"
                region.reconstruction = reconstruction
                return
            }
            region.eraseMask = localMask
            region.cleanMode = "lama"
            region.reconstruction = null
            return
        }
        val grow = maxOf(9, (gh * 0.5).toInt())
        val allow = ByteMask(img.width, img.height)
        val m = grow + 4
        allow.fillRect(region.box.x1 - m, region.box.y1 - m, region.box.x2 + m, region.box.y2 + m)
        region.eraseMask = core.dilate(grow).and(allow)
        region.cleanMode = "lama"
        region.reconstruction = null
    }

    /** E3 only: LaMa is a rescue engine, never the default for an unknown mode. */
    fun needsInpaint(regions: List<Region>): Boolean =
        regions.any { it.status == "translated" && it.cleanMode == "lama" && it.eraseMask?.any() == true }

    /**
     * ينفّذ المسح المخطَّط على `img` في مكانها. `inpainter` لازم متى [needsInpaint].
     * ويرجع قياسًا من البكسلات نفسها؛ بهذا نعرف إن كان التبييض فعليًا أم no-op.
     */
    fun applyErase(img: RgbImage, regions: List<Region>, inpainter: Inpainter?): EraseStats {
        val stats = EraseStats()
        for (r in regions) {
            if (r.status != "translated") continue
            val mask = r.eraseMask
            if (mask == null || !mask.any()) { r.status = "skipped:no_erase"; stats.noOpRegions++; continue }
            if (r.cleanMode == "fill") {
                val color = r.fillColor
                if (color == null) { r.status = "skipped:no_erase"; stats.noOpRegions++; continue }
                val w = mask.scanWindow() ?: continue
                stats.fillRegions++
                var regionChanged = 0
                for (y in w[1] until w[3]) for (x in w[0] until w[2]) if (mask[x, y].toInt() != 0) {
                    stats.maskPixels++
                    stats.fillMaskPixels++
                    val i = (y * img.width + x) * 3
                    if ((img.data[i].toInt() and 0xff) != color[0] || (img.data[i + 1].toInt() and 0xff) != color[1] || (img.data[i + 2].toInt() and 0xff) != color[2]) {
                        stats.changedPixels++
                        stats.fillChangedPixels++
                        regionChanged++
                    }
                    img.data[i] = color[0].toByte(); img.data[i + 1] = color[1].toByte(); img.data[i + 2] = color[2].toByte()
                }
                if (regionChanged == 0) { stats.noOpRegions++; r.status = "skipped:no_erase" }
            } else if (r.cleanMode == "reconstruct") {
                val model = r.reconstruction
                if (model == null) { r.status = "skipped:no_erase"; stats.noOpRegions++; continue }
                val w = mask.scanWindow() ?: continue
                stats.reconstructRegions++
                var regionChanged = 0
                for (y in w[1] until w[3]) for (x in w[0] until w[2]) if (mask[x, y].toInt() != 0) {
                    stats.maskPixels++
                    stats.reconstructMaskPixels++
                    val color = model.colorAt(x.toDouble(), y.toDouble())
                    val i = (y * img.width + x) * 3
                    if ((img.data[i].toInt() and 0xff) != color[0] || (img.data[i + 1].toInt() and 0xff) != color[1] || (img.data[i + 2].toInt() and 0xff) != color[2]) {
                        stats.changedPixels++
                        stats.reconstructChangedPixels++
                        regionChanged++
                    }
                    img.data[i] = color[0].toByte()
                    img.data[i + 1] = color[1].toByte()
                    img.data[i + 2] = color[2].toByte()
                }
                if (regionChanged == 0) { stats.noOpRegions++; r.status = "skipped:no_erase" }
            } else if (r.cleanMode == "lama") {
                val b = mask.bounds() ?: continue
                stats.inpaintRegions++
                val s = (inpainter ?: error("lama not loaded")).inpaint(img, mask, Box(b[0], b[1], b[2], b[3]))
                stats.maskPixels += s.maskPixels
                stats.inpaintMaskPixels += s.maskPixels
                stats.changedPixels += s.changedPixels
                stats.inpaintChangedPixels += s.changedPixels
                if (s.changedPixels == 0) { stats.noOpRegions++; r.status = "skipped:no_erase" }
                if (s.scaled) stats.scaledInpaintRegions++
            } else {
                r.status = "skipped:no_erase"
                stats.noOpRegions++
            }
        }
        return stats
    }
}
