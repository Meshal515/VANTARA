package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File

/**
 * قناع الحروف: رأس UNet في comic-text-detector (`seg` من الخرج الثلاثي).
 * المدخل 1024×1024 ثابت؛ الصفحة تُقسَّم شرائح مربعة بعرضها، والمتوسط في التداخل.
 * الخرج خريطة احتمال [0,1] بحجم الصورة.
 */
class GlyphSegmenter(file: File) {
    private val session: OrtSession = Ort.open(file)
    private val size = 1024

    /** عدد المربعات في آخر صفحة (للقياس). */
    var tiles = 0
        private set

    /** يرجع احتمال «حرف» لكل بكسل. */
    /**
     * `rows`: صفوف النص (من الكاشف موسّعة). قطعة لا تمسّ أي صف لا تُشغَّل: كل بكسل في
     * تلك الصفوف يأخذ القطع نفسها التي كان يأخذها، فقيمته هي نفسها بتًّا بتًّا.
     */
    fun probabilities(img: RgbImage, rows: List<IntRange>? = null): FloatArray {
        val acc = FloatArray(img.width * img.height)
        val cnt = FloatArray(img.width * img.height)
        val tileH = img.width
        val overlap = (img.width * 0.12).toInt()
        val spans = verticalTiles(img.height, tileH, overlap)
        val needed = if (rows == null) spans else spans.filter { (y0, y1) -> rows.any { it.first < y1 && it.last >= y0 } }
        tiles = needed.size
        for ((y0, y1) in needed) {
            val crop = img.crop(0, y0, img.width, y1)
            val (chw, r) = crop.toChwPadded(size, 0)
            val nw = Math.round(crop.width * r)
            val nh = Math.round(crop.height * r)
            val input = Ort.tensor(chw, 1, 3, size.toLong(), size.toLong())
            session.run(mapOf("images" to input)).use { res ->
                val seg = res.get("seg").get().value
                @Suppress("UNCHECKED_CAST")
                val plane = (seg as Array<Array<Array<FloatArray>>>)[0][0] // size × size
                // تكبير ثنائي الخطي من (nh×nw) إلى حجم القطعة
                for (y in 0 until crop.height) {
                    val fy = ((y + 0.5f) * nh / crop.height - 0.5f).coerceIn(0f, (nh - 1).toFloat())
                    val ya = fy.toInt(); val yb = minOf(nh - 1, ya + 1); val wy = fy - ya
                    for (x in 0 until crop.width) {
                        val fx = ((x + 0.5f) * nw / crop.width - 0.5f).coerceIn(0f, (nw - 1).toFloat())
                        val xa = fx.toInt(); val xb = minOf(nw - 1, xa + 1); val wx = fx - xa
                        val v = (plane[ya][xa] * (1 - wx) + plane[ya][xb] * wx) * (1 - wy) + (plane[yb][xa] * (1 - wx) + plane[yb][xb] * wx) * wy
                        val i = (y0 + y) * img.width + x
                        acc[i] += v
                        cnt[i] += 1f
                    }
                }
            }
            input.close()
        }
        for (i in acc.indices) if (cnt[i] > 0) acc[i] /= cnt[i]
        return acc
    }

    fun close() = session.close()
}
