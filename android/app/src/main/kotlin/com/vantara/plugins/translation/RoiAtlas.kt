package com.vantara.plugins.translation

/**
 * أطلس ROI: عدة قطع نص في لوحة 1024² واحدة لنداء CTD واحد.
 *
 * comic-text-detector ملفه ثابت المدخل (1×3×1024×1024). المسار السابق كان يكبّر
 * كل قطعة (300×200 مثلًا) إلى 1024 ويدفع نداءً كاملًا (~1.8 ث على S23) لكل واحدة:
 * 4–6 نداءات للصفحة. هنا القطع توضع بمقياس المرجع نفسه (عرض الصفحة → 1024، كما
 * يفعل مرجع Python وشرائح `probabilities`) في رفوف داخل لوحة واحدة، بينها فواصل
 * سوداء بعرض [DEFAULT_GUTTER] (لون الحشو نفسه الذي كانت تراه القطعة سابقًا)، ثم
 * يُقرأ ناتج كل قطعة من مكانها. وصفحة كثيفة لا تحتاج شرائح أكثر من اللوحات تأخذ
 * الشرائح الكاملة نفسها ([stripes]) فتطابق المرجع هندسيًا.
 *
 * على 11 صفحة حقيقية (OpenCV DNN، نفس الأوزان): تطابق قناع الأطلس مع المرجع أعلى
 * من تطابق المسار السابق المكبَّر — انظر docs/translation-v3-throughput.md.
 *
 * الحساب نقي (بلا ORT) ليُختبر على JVM؛ `GlyphSegmenter.maskAtlas` يمرر النموذج.
 */
internal object RoiAtlas {
    const val SIZE = 1024
    const val DEFAULT_GUTTER = 32

    /** Switch for device A/B (`engineBenchmark` compares both paths on the same page). */
    @Volatile var enabled: Boolean = true

    data class Placement(val index: Int, val crop: Box, val atlas: Int, val x: Int, val y: Int, val w: Int, val h: Int) {
        val scale: Float get() = w.toFloat() / maxOf(1, crop.w)
    }

    data class Plan(val size: Int, val gutter: Int, val atlases: Int, val placements: List<Placement>) {
        /** Fraction of tensor pixels carrying real crop pixels (telemetry). */
        fun occupancy(): Float = if (atlases == 0) 0f else placements.sumOf { it.w.toLong() * it.h }.toFloat() / (atlases.toLong() * size * size)
    }

    private class Shelf(val y: Int, val h: Int, var x: Int)

    /**
     * Deterministic shelf packing: tallest first (ties by original order), first fit.
     * Every crop is resampled by `scale` (production: [referenceScale]); a crop that
     * would not fit the canvas is shrunk further to fit and gets a shelf of its own.
     */
    fun plan(crops: List<Box>, size: Int = SIZE, gutter: Int = DEFAULT_GUTTER, scale: Float = 1f): Plan {
        data class Item(val index: Int, val crop: Box, val w: Int, val h: Int)
        val items = crops.mapIndexedNotNull { i, b ->
            if (b.w <= 0 || b.h <= 0) return@mapIndexedNotNull null
            val s = minOf(scale.coerceAtLeast(0.05f), size.toFloat() / b.w, size.toFloat() / b.h)
            Item(i, b, maxOf(1, minOf(size, Math.round(b.w * s))), maxOf(1, minOf(size, Math.round(b.h * s))))
        }.sortedWith(compareBy({ -it.h }, { it.index }))

        val shelves = ArrayList<MutableList<Shelf>>()
        val placed = ArrayList<Placement>()
        for (it in items) {
            var done = false
            for ((a, list) in shelves.withIndex()) {
                for (s in list) {
                    val x = if (s.x == 0) 0 else s.x + gutter
                    if (it.h <= s.h && x + it.w <= size) {
                        placed.add(Placement(it.index, it.crop, a, x, s.y, it.w, it.h)); s.x = x + it.w; done = true; break
                    }
                }
                if (done) break
                val last = list.last()
                val y = last.y + last.h + gutter
                if (y + it.h <= size) {
                    list.add(Shelf(y, it.h, it.w))
                    placed.add(Placement(it.index, it.crop, a, 0, y, it.w, it.h)); done = true; break
                }
            }
            if (!done) {
                shelves.add(mutableListOf(Shelf(0, it.h, it.w)))
                placed.add(Placement(it.index, it.crop, shelves.size - 1, 0, 0, it.w, it.h))
            }
        }
        return Plan(size, gutter, shelves.size, placed.sortedBy { it.index })
    }

    /** One crop at the reference glyph scale on its own canvas (dynamic-shape CTD). */
    data class Tight(val index: Int, val crop: Box, val canvasW: Int, val canvasH: Int, val x: Int, val y: Int, val w: Int, val h: Int) {
        val pixels: Long get() = canvasW.toLong() * canvasH
    }

    /**
     * v3.1: with [CtdDynamicModel] the model accepts any multiple of [quantum]. Each crop
     * is resampled exactly like the atlas (same `scale`) and framed by a black `margin`
     * (the atlas gutter context), then rounded up to the stride. Cost follows the crop's
     * own pixels instead of a fixed 1024² canvas. On the 11 reference pages: 41% fewer
     * tensor pixels than the atlas, glyph IoU vs reference 0.918 vs 0.915.
     */
    fun tight(crops: List<Box>, scale: Float, size: Int = SIZE, margin: Int = DEFAULT_GUTTER, quantum: Int = 64): List<Tight> =
        crops.mapIndexedNotNull { i, b ->
            if (b.w <= 0 || b.h <= 0) return@mapIndexedNotNull null
            val s = minOf(scale.coerceAtLeast(0.05f), size.toFloat() / b.w, size.toFloat() / b.h)
            val w = maxOf(1, minOf(size, Math.round(b.w * s))); val h = maxOf(1, minOf(size, Math.round(b.h * s)))
            fun canvas(n: Int) = minOf(size, ((n + 2 * margin + quantum - 1) / quantum) * quantum)
            val cw = canvas(w); val ch = canvas(h)
            Tight(i, b, cw, ch, minOf(margin, cw - w), minOf(margin, ch - h), w, h)
        }

    /** CHW input in [0,1] for one tight canvas; the frame is `pad`. */
    fun tightInput(img: RgbImage, t: Tight, pad: Int = 0): FloatArray {
        val plane = t.canvasW * t.canvasH
        val out = FloatArray(3 * plane) { pad / 255f }
        var crop = img.crop(t.crop.x1, t.crop.y1, t.crop.x2, t.crop.y2)
        if (crop.width != t.w || crop.height != t.h) crop = crop.resize(t.w, t.h)
        for (y in 0 until t.h) for (x in 0 until t.w) {
            val s = (y * t.w + x) * 3
            val d = (t.y + y) * t.canvasW + t.x + x
            out[d] = (crop.data[s].toInt() and 0xff) / 255f
            out[plane + d] = (crop.data[s + 1].toInt() and 0xff) / 255f
            out[2 * plane + d] = (crop.data[s + 2].toInt() and 0xff) / 255f
        }
        return out
    }

    /** Source-sized probabilities for one tight canvas output (`canvasH` rows × `canvasW`). */
    fun tightExtract(t: Tight, output: Array<FloatArray>): FloatArray {
        val sub = Array(t.h) { y -> output[t.y + y].copyOfRange(t.x, t.x + t.w) }
        return if (t.w == t.crop.w && t.h == t.crop.h) {
            FloatArray(t.w * t.h).also { flat -> for (y in 0 until t.h) System.arraycopy(sub[y], 0, flat, y * t.w, t.w) }
        } else CtdSegMapper.map(sub, t.w, t.h, t.crop.w, t.crop.h)
    }

    /**
     * Scale at which the validated reference sees this page: the full-width CTD tile
     * maps the page width to 1024 (`GlyphSegmenter.probabilities`, Python reference).
     * Packing crops at this scale keeps glyph size identical to the reference.
     * Bounded so a narrow page cannot blow the atlas up.
     */
    fun referenceScale(pageWidth: Int, size: Int = SIZE): Float = (size.toFloat() / maxOf(1, pageWidth)).coerceIn(0.25f, 2f)

    /**
     * Full-width square stripes (the reference tiling) that touch any crop. When a
     * dense page needs no more stripes than atlases, the stripe path is both
     * cheaper-or-equal and exactly the reference geometry.
     */
    fun stripes(width: Int, height: Int, crops: List<Box>): List<Pair<Int, Int>> =
        verticalTiles(height, width, (width * .12).toInt()).filter { (y0, y1) -> crops.any { it.y1 < y1 && it.y2 > y0 } }

    /**
     * Stripe path with an injected model (`infer`: strip RGB → strip-sized plane).
     * Overlapping stripes are averaged per pixel exactly like the reference; only
     * crop-local buffers are allocated.
     */
    fun stripeProbabilities(img: RgbImage, crops: List<Box>, spans: List<Pair<Int, Int>>, infer: (RgbImage) -> FloatArray): List<FloatArray> {
        val sums = crops.map { FloatArray(maxOf(0, it.area)) }
        val counts = crops.map { IntArray(maxOf(0, it.area)) }
        for ((y0, y1) in spans) {
            val touched = crops.indices.filter { crops[it].y1 < y1 && crops[it].y2 > y0 }
            if (touched.isEmpty()) continue
            val plane = infer(img.crop(0, y0, img.width, y1))
            for (i in touched) {
                val b = crops[i]
                val sum = sums[i]; val cnt = counts[i]
                for (y in maxOf(b.y1, y0) until minOf(b.y2, y1)) for (x in maxOf(0, b.x1) until minOf(img.width, b.x2)) {
                    val k = (y - b.y1) * b.w + (x - b.x1)
                    sum[k] += plane[(y - y0) * img.width + x]
                    cnt[k]++
                }
            }
        }
        return crops.indices.map { i ->
            val sum = sums[i]; val cnt = counts[i]
            FloatArray(sum.size) { k -> if (cnt[k] > 0) sum[k] / cnt[k] else 0f }
        }
    }

    /** CHW float input in [0,1] for one atlas; unused canvas and gutters are `pad`. */
    fun input(img: RgbImage, plan: Plan, atlas: Int, pad: Int = 0): FloatArray {
        val size = plan.size
        val plane = size * size
        val out = FloatArray(3 * plane) { pad / 255f }
        for (p in plan.placements) {
            if (p.atlas != atlas) continue
            var crop = img.crop(p.crop.x1, p.crop.y1, p.crop.x2, p.crop.y2)
            if (crop.width != p.w || crop.height != p.h) crop = crop.resize(p.w, p.h)
            for (y in 0 until p.h) for (x in 0 until p.w) {
                val s = (y * p.w + x) * 3
                val d = (p.y + y) * size + p.x + x
                out[d] = (crop.data[s].toInt() and 0xff) / 255f
                out[plane + d] = (crop.data[s + 1].toInt() and 0xff) / 255f
                out[2 * plane + d] = (crop.data[s + 2].toInt() and 0xff) / 255f
            }
        }
        return out
    }

    /** Reads every placement of `atlas` out of a size×size output plane, at its source crop size. */
    fun extract(plan: Plan, atlas: Int, output: Array<FloatArray>, into: Array<FloatArray?>) {
        for (p in plan.placements) {
            if (p.atlas != atlas) continue
            val sub = Array(p.h) { y -> output[p.y + y].copyOfRange(p.x, p.x + p.w) }
            into[p.index] = if (p.w == p.crop.w && p.h == p.crop.h) {
                val flat = FloatArray(p.w * p.h)
                for (y in 0 until p.h) System.arraycopy(sub[y], 0, flat, y * p.w, p.w)
                flat
            } else CtdSegMapper.map(sub, p.w, p.h, p.crop.w, p.crop.h)
        }
    }

    /**
     * Full ROI → probability path with an injected model (`infer`: CHW input →
     * size×size plane). Returns one source-sized plane per crop, aligned with `crops`.
     */
    fun probabilities(img: RgbImage, crops: List<Box>, plan: Plan = plan(crops), infer: (FloatArray) -> Array<FloatArray>): List<FloatArray> {
        val out = arrayOfNulls<FloatArray>(crops.size)
        for (a in 0 until plan.atlases) extract(plan, a, infer(input(img, plan, a)), out)
        return crops.indices.map { out[it] ?: FloatArray(maxOf(0, crops[it].area)) }
    }
}
