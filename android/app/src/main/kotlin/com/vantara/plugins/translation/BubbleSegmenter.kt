package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File
import kotlin.math.exp

data class Bubble(val box: Box, val score: Float, val mask: ByteMask)

/**
 * مضلّع الفقاعة بكسلًا بكسلًا: YOLOv8m-seg (`kitsumed/yolov8m_seg-speech-bubble`).
 * الخرج: `output0` [1, 37, anchors] (cx,cy,w,h,conf + 32 معاملات) و`output1`
 * [1, 32, mh, mw] بروتوتايبات القناع. القناع = sigmoid(coef · proto).
 */
class BubbleSegmenter(file: File) {
    private val session: OrtSession = Ort.open(file)
    var conf = 0.35f
    var iouThr = 0.5f
    private val size = 1024

    private fun infer(img: RgbImage): List<Bubble> {
        val (chw, r) = img.toChwPadded(size, 114)
        val nw = Math.round(img.width * r)
        val nh = Math.round(img.height * r)
        val input = Ort.tensor(chw, 1, 3, size.toLong(), size.toLong())
        val out = ArrayList<Bubble>()
        session.run(mapOf("images" to input)).use { res ->
            @Suppress("UNCHECKED_CAST")
            val o0 = (res[0].value as Array<Array<FloatArray>>)[0] // 37 × anchors
            @Suppress("UNCHECKED_CAST")
            val protos = (res[1].value as Array<Array<Array<FloatArray>>>)[0] // 32 × mh × mw
            val anchors = o0[0].size
            val mh = protos[0].size
            val mw = protos[0][0].size
            val cand = ArrayList<Int>()
            for (a in 0 until anchors) if (o0[4][a] > conf) cand.add(a)
            if (cand.isEmpty()) return emptyList()
            val boxes = cand.map { a ->
                val cx = o0[0][a]; val cy = o0[1][a]; val w = o0[2][a]; val h = o0[3][a]
                Box(Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(cx + w / 2), Math.round(cy + h / 2))
            }
            val scores = cand.map { o0[4][it] }.toFloatArray()
            for (k in nms(boxes, scores, iouThr)) {
                val a = cand[k]
                val bx = boxes[k]
                // قناع بدقة البروتو ثم يُكبَّر إلى الصورة
                val small = FloatArray(mh * mw)
                for (y in 0 until mh) for (x in 0 until mw) {
                    var s = 0f
                    for (c in 0 until 32) s += o0[5 + c][a] * protos[c][y][x]
                    small[y * mw + x] = 1f / (1f + exp(-s))
                }
                val sx = mw.toFloat() / size
                val sy = mh.toFloat() / size
                val mask = ByteMask(img.width, img.height)
                // الصفوف والأعمدة التي يقع مركزها داخل صندوق المرشّح وحدها (خارجها يُتخطى أصلًا)
                val ys = if (ByteMask.windowed) maxOf(0, Math.floor(bx.y1 / r.toDouble()).toInt() - 1) else 0
                val ye = if (ByteMask.windowed) minOf(img.height, Math.ceil(bx.y2 / r.toDouble()).toInt() + 2) else img.height
                val xs = if (ByteMask.windowed) maxOf(0, Math.floor(bx.x1 / r.toDouble()).toInt() - 1) else 0
                val xe = if (ByteMask.windowed) minOf(img.width, Math.ceil(bx.x2 / r.toDouble()).toInt() + 2) else img.width
                for (y in ys until ye) {
                    val py = y * r // في فضاء 1024
                    if (py >= nh) break
                    val my = (py * sy).toInt().coerceIn(0, mh - 1)
                    for (x in xs until xe) {
                        val px = x * r
                        if (px >= nw) break
                        if (px < bx.x1 || px > bx.x2 || py < bx.y1 || py > bx.y2) continue
                        val mx = (px * sx).toInt().coerceIn(0, mw - 1)
                        if (small[my * mw + mx] > 0.5f) mask[x, y] = 1
                    }
                }
                val one = mask.largestComponent()
                if (one.count() < 200) continue
                val b = one.bounds() ?: continue
                out.add(Bubble(Box(b[0], b[1], b[2], b[3]), scores[k], one))
            }
        }
        input.close()
        return out
    }

    /** عدد المربعات في آخر صفحة (للقياس). */
    var tiles = 0
        private set

    fun segment(img: RgbImage): List<Bubble> {
        if (img.height <= img.width * 2.6) {
            tiles = 1
            return infer(img)
        }
        val tile = (img.width * 2.2).toInt()
        val overlap = (img.width * 0.4).toInt()
        val found = ArrayList<Bubble>()
        val spans = verticalTiles(img.height, tile, overlap)
        tiles = spans.size
        for ((y0, y1) in spans) {
            for (b in infer(img.crop(0, y0, img.width, y1))) {
                val mask = ByteMask(img.width, img.height)
                System.arraycopy(b.mask.data, 0, mask.data, y0 * img.width, b.mask.data.size)
                found.add(Bubble(Box(b.box.x1, b.box.y1 + y0, b.box.x2, b.box.y2 + y0), b.score, mask))
            }
        }
        val kept = ArrayList<Bubble>()
        for (b in found.sortedByDescending { it.score }) {
            if (kept.any { it.box.iou(b.box) > 0.5f }) continue
            kept.add(b)
        }
        return kept
    }

    fun close() = session.close()
}
