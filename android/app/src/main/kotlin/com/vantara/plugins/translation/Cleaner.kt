package com.vantara.plugins.translation

/**
 * التبييض الآمن — ترجمة حرفية لـ`vantara_worker/clean.py`:
 *   1. فقاعة مسطّحة: ملء بلونها الدقيق داخل حدّها المتآكل (الحروف + ما يخالف لونها قربها).
 *   2. فقاعة فيها رسم أو نص فوق الرسم: LaMa على الحروف موسَّعة بما يكفي لحدّ الحرف وهالته.
 *   3. لا عربي = لا مسح.
 * لا بكسل خارج `eraseMask` يتغير.
 */
object Cleaner {

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
                // فقاعة مسطّحة: صندوق النص كله داخلها يُملأ بلونها أيضًا، فلا يبقى حرف إنجليزي
                // فاته قناع الحروف بجانب العربي (اللون واحد، فلا شيء يضيع)
                val box = ByteMask(img.width, img.height)
                box.fillRect(region.box.x1 - 2, region.box.y1 - 2, region.box.x2 + 2, region.box.y2 + 2)
                region.eraseMask = mask.open(1).or(near.and(inner)).or(box.and(inner)).or(enclosedInk(img, color, bubbleMask, near.and(inner), region.box, gh, others))
                region.cleanMode = "fill"
                region.fillColor = color
                return
            }
            region.eraseMask = near.and(inner)
            region.cleanMode = "inpaint"
            return
        }
        val grow = maxOf(9, (gh * 0.5).toInt())
        val allow = ByteMask(img.width, img.height)
        val m = grow + 4
        allow.fillRect(region.box.x1 - m, region.box.y1 - m, region.box.x2 + m, region.box.y2 + m)
        region.eraseMask = core.dilate(grow).and(allow)
        region.cleanMode = "inpaint"
    }

    /** هل تحتاج الصفحة LaMa؟ (يُحمَّل النموذج حينها فقط.) */
    fun needsInpaint(regions: List<Region>): Boolean =
        regions.any { it.status == "translated" && it.cleanMode != "fill" && it.eraseMask?.any() == true }

    /** ينفّذ المسح المخطَّط على `img` في مكانها. `inpainter` لازم متى [needsInpaint]. */
    fun applyErase(img: RgbImage, regions: List<Region>, inpainter: Inpainter?) {
        for (r in regions) {
            if (r.status != "translated") continue
            val mask = r.eraseMask ?: continue
            if (!mask.any()) continue
            if (r.cleanMode == "fill") {
                val c = r.fillColor ?: continue
                val w = mask.scanWindow() ?: continue
                for (y in w[1] until w[3]) for (x in w[0] until w[2]) if (mask[x, y].toInt() != 0) {
                    val i = (y * img.width + x) * 3
                    img.data[i] = c[0].toByte(); img.data[i + 1] = c[1].toByte(); img.data[i + 2] = c[2].toByte()
                }
            } else {
                val b = mask.bounds() ?: continue
                (inpainter ?: error("lama not loaded")).inpaint(img, mask, Box(b[0], b[1], b[2], b[3]))
            }
        }
    }
}
