package com.vantara.plugins.translation

/**
 * ضمان أن العربي المرسوم يُرى: لون الحبر من الأصل قد يخطئ (قناع حروف خشن يجعل
 * «الحبر» هو الخلفية)، فيُرسم أبيض على فقاعة بيضاء — فقاعة مبيّضة بلا عربي.
 */
object Visibility {
    private const val DARK = 16
    private const val LIGHT = 255

    private fun luma(img: RgbImage, i: Int): Int =
        (299 * (img.data[i * 3].toInt() and 0xff) + 587 * (img.data[i * 3 + 1].toInt() and 0xff) + 114 * (img.data[i * 3 + 2].toInt() and 0xff)) / 1000

    /** وسيط سطوع الخلفية (بعد المسح) تحت أسطر العربي. */
    fun background(img: RgbImage, layout: TextLayout): Int? {
        val hist = IntArray(256)
        var n = 0
        for (b in layout.lineBounds) {
            for (y in maxOf(0, b.y1) until minOf(img.height, b.y2)) for (x in maxOf(0, b.x1) until minOf(img.width, b.x2)) {
                hist[luma(img, y * img.width + x)]++; n++
            }
        }
        if (n == 0) return null
        var acc = 0
        for (v in 0 until 256) { acc += hist[v]; if (acc * 2 >= n) return v }
        return 255
    }

    /**
     * لون الحبر: الأصلي ما دام يتباين مع الخلفية؛ وإلا المقابل. لا يتغير شيء في
     * الحالة العادية (أسود على أبيض، أبيض على أسود).
     */
    fun inkLight(img: RgbImage, layout: TextLayout, original: Boolean): Boolean {
        val bg = background(img, layout) ?: return original
        val ink = if (original) LIGHT else DARK
        if (Math.abs(ink - bg) >= 90) return original
        val other = if (original) DARK else LIGHT
        return if (Math.abs(other - bg) > Math.abs(ink - bg)) !original else original
    }

    /** هل ظهر العربي فعلًا؟ بكسلات تغيّرت بوضوح داخل أسطره بعد الرسم. */
    fun textShows(before: RgbImage, after: RgbImage, layout: TextLayout): Boolean {
        var changed = 0
        var area = 0
        for (b in layout.lineBounds) {
            for (y in maxOf(0, b.y1) until minOf(before.height, b.y2)) for (x in maxOf(0, b.x1) until minOf(before.width, b.x2)) {
                val i = y * before.width + x
                area++
                if (Math.abs(luma(before, i) - luma(after, i)) >= 60) changed++
            }
        }
        if (area == 0) return false
        return changed >= maxOf(12, area / 200)
    }
}
