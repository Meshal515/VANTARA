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

    fun planErase(img: RgbImage, region: Region, siblings: List<Region>?) {
        val gh = glyphHeight(region.glyph, region.box)
        val core = region.glyph.close(2)
        var others = ByteMask(img.width, img.height)
        siblings?.forEach { others = others.or(it.glyph) }

        var bubbleMask: ByteMask? = region.bubble?.mask
        if (bubbleMask == null && region.bubbleBox != null) bubbleMask = Regions.flatBoxMask(img, region.bubbleBox, region.box)

        if (bubbleMask != null) {
            val erode = maxOf(3, (gh * 0.25).toInt())
            val inner = bubbleMask.erode(erode)
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
                region.eraseMask = mask.open(1).or(near.and(inner))
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
