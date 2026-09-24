package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File

data class Box(val x1: Int, val y1: Int, val x2: Int, val y2: Int) {
    val w get() = x2 - x1
    val h get() = y2 - y1
    val area get() = maxOf(0, w) * maxOf(0, h)
    fun iou(o: Box): Float {
        val ix = maxOf(0, minOf(x2, o.x2) - maxOf(x1, o.x1))
        val iy = maxOf(0, minOf(y2, o.y2) - maxOf(y1, o.y1))
        val inter = ix * iy
        val ua = area + o.area - inter
        return if (ua > 0) inter.toFloat() / ua else 0f
    }
    /** أي جزء من `inner` يقع داخلي. */
    fun contains(inner: Box): Float {
        val ix = maxOf(0, minOf(x2, inner.x2) - maxOf(x1, inner.x1))
        val iy = maxOf(0, minOf(y2, inner.y2) - maxOf(y1, inner.y1))
        return if (inner.area > 0) (ix * iy).toFloat() / inner.area else 0f
    }
    fun union(o: Box) = Box(minOf(x1, o.x1), minOf(y1, o.y1), maxOf(x2, o.x2), maxOf(y2, o.y2))
}

data class Detection(val box: Box, val score: Float, val label: String)

/** Non-maximum suppression على صناديق بدرجاتها؛ يرجع فهارس المحتفظ بها. */
fun nms(boxes: List<Box>, scores: FloatArray, iouThr: Float): List<Int> {
    val order = boxes.indices.sortedByDescending { scores[it] }.toMutableList()
    val keep = ArrayList<Int>()
    while (order.isNotEmpty()) {
        val i = order.removeAt(0)
        keep.add(i)
        order.removeAll { boxes[i].iou(boxes[it]) >= iouThr }
    }
    return keep
}

/**
 * كشف الفقاعات وصناديق النص: RT-DETR-v2 int8 (`ogkalu/comic-text-and-bubble-detector`).
 * ثلاث فئات: bubble / text_bubble / text_free. الصفحة الطويلة تُقسَّم شرائح
 * بنسبة ≤ 2.2 مع تداخل، لأن النموذج يرى 640×640 مشوَّهة.
 */
class Detector(file: File) {
    private val session: OrtSession = Ort.open(file)
    private val labels = mapOf(0L to "bubble", 1L to "text_bubble", 2L to "text_free")
    var conf = 0.3f

    private fun tile(img: RgbImage): List<Detection> {
        val small = img.resize(640, 640)
        val input = Ort.tensor(small.toChw(), 1, 3, 640, 640)
        val sizes = Ort.tensor(longArrayOf(img.width.toLong(), img.height.toLong()), 1, 2)
        val out = ArrayList<Detection>()
        session.run(mapOf("images" to input, "orig_target_sizes" to sizes)).use { res ->
            @Suppress("UNCHECKED_CAST")
            val lab = (res[0].value as Array<LongArray>)[0]
            @Suppress("UNCHECKED_CAST")
            val boxes = (res[1].value as Array<Array<FloatArray>>)[0]
            @Suppress("UNCHECKED_CAST")
            val scores = (res[2].value as Array<FloatArray>)[0]
            for (i in lab.indices) {
                if (scores[i] < conf) continue
                val b = boxes[i]
                val x1 = Math.round(b[0]).coerceIn(0, img.width)
                val y1 = Math.round(b[1]).coerceIn(0, img.height)
                val x2 = Math.round(b[2]).coerceIn(0, img.width)
                val y2 = Math.round(b[3]).coerceIn(0, img.height)
                if (x2 - x1 < 4 || y2 - y1 < 4) continue
                out.add(Detection(Box(x1, y1, x2, y2), scores[i], labels[lab[i]] ?: "text_free"))
            }
        }
        input.close(); sizes.close()
        return out
    }

    /** عدد المربعات في آخر صفحة (للقياس). */
    var tiles = 0
        private set

    fun detect(img: RgbImage): List<Detection> {
        val tileH = (img.width * 2.2).toInt()
        val overlap = (img.width * 0.35).toInt()
        val all = ArrayList<Detection>()
        val spans = verticalTiles(img.height, tileH, overlap)
        tiles = spans.size
        for ((y0, y1) in spans) {
            for (d in tile(img.crop(0, y0, img.width, y1))) {
                all.add(Detection(Box(d.box.x1, d.box.y1 + y0, d.box.x2, d.box.y2 + y0), d.score, d.label))
            }
        }
        val merged = ArrayList<Detection>()
        for (label in all.map { it.label }.distinct()) {
            val same = all.filter { it.label == label }
            val keep = nms(same.map { it.box }, same.map { it.score }.toFloatArray(), 0.5f)
            merged.addAll(keep.map { same[it] })
        }
        return merged
    }

    fun close() = session.close()
}

/** شرائح رأسية متداخلة؛ الأخيرة تُسحب لأعلى لتبقى كاملة. */
fun verticalTiles(height: Int, tile: Int, overlap: Int): List<Pair<Int, Int>> {
    if (height <= tile) return listOf(0 to height)
    val out = ArrayList<Pair<Int, Int>>()
    var y = 0
    while (true) {
        val y0 = minOf(y, height - tile)
        out.add(y0 to y0 + tile)
        if (y0 + tile >= height) break
        y = y0 + tile - overlap
    }
    return out
}
