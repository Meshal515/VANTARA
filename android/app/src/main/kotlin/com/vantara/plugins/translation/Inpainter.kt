package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File

/**
 * الترميم فوق الرسم: LaMa المدرَّب على الأنمي/المانجا (ONNX ديناميكي).
 * يُستدعى على قطعة حول المنطقة بهامش سياق، بأبعاد مضاعفات 8؛ ما خارج القناع
 * يُعاد من الأصل حرفيًّا.
 */
class Inpainter(file: File) {
    private val session: OrtSession = Ort.open(file)
    private val context = 96
    private val maxEdge = 1024

    private fun forward(rgb: RgbImage, mask: ByteMask): RgbImage {
        val w = rgb.width; val h = rgb.height
        val pw = (8 - w % 8) % 8; val ph = (8 - h % 8) % 8
        val W = w + pw; val H = h + ph
        // حشو بالانعكاس
        val padded = RgbImage(W, H, ByteArray(W * H * 3))
        for (y in 0 until H) {
            val sy = if (y < h) y else (2 * h - 2 - y).coerceIn(0, h - 1)
            for (x in 0 until W) {
                val sx = if (x < w) x else (2 * w - 2 - x).coerceIn(0, w - 1)
                val s = (sy * w + sx) * 3; val d = (y * W + x) * 3
                padded.data[d] = rgb.data[s]; padded.data[d + 1] = rgb.data[s + 1]; padded.data[d + 2] = rgb.data[s + 2]
            }
        }
        val m = FloatArray(W * H)
        for (y in 0 until h) for (x in 0 until w) if (mask[x, y].toInt() != 0) m[y * W + x] = 1f
        val imgT = Ort.tensor(padded.toChw(), 1, 3, H.toLong(), W.toLong())
        val maskT = Ort.tensor(m, 1, 1, H.toLong(), W.toLong())
        val out: RgbImage
        session.run(mapOf("image" to imgT, "mask" to maskT)).use { res ->
            @Suppress("UNCHECKED_CAST")
            val y = (res[0].value as Array<Array<Array<FloatArray>>>)[0] // 3 × H × W
            val chw = FloatArray(3 * W * H)
            for (c in 0 until 3) for (yy in 0 until H) System.arraycopy(y[c][yy], 0, chw, c * W * H + yy * W, W)
            out = RgbImage.fromChw(chw, W, H).crop(0, 0, w, h)
        }
        imgT.close(); maskT.close()
        return out
    }

    /** يرمّم ما داخل `mask` ضمن `box` (مع هامش) ويكتب في `img` مكانه. */
    fun inpaint(img: RgbImage, mask: ByteMask, box: Box) {
        val cx1 = maxOf(0, box.x1 - context); val cy1 = maxOf(0, box.y1 - context)
        val cx2 = minOf(img.width, box.x2 + context); val cy2 = minOf(img.height, box.y2 + context)
        val crop = img.crop(cx1, cy1, cx2, cy2)
        val cmask = ByteMask(crop.width, crop.height)
        var any = false
        for (y in 0 until crop.height) for (x in 0 until crop.width) if (mask[cx1 + x, cy1 + y].toInt() != 0) { cmask[x, y] = 1; any = true }
        if (!any) return
        val scale = minOf(1f, maxEdge.toFloat() / maxOf(crop.width, crop.height))
        val filled: RgbImage = if (scale < 1f) {
            val sw = (crop.width * scale).toInt(); val sh = (crop.height * scale).toInt()
            val smallMask = ByteMask(sw, sh)
            for (y in 0 until sh) for (x in 0 until sw) smallMask[x, y] = cmask[(x / scale).toInt().coerceIn(0, crop.width - 1), (y / scale).toInt().coerceIn(0, crop.height - 1)]
            forward(crop.resize(sw, sh), smallMask).resize(crop.width, crop.height)
        } else forward(crop, cmask)
        img.paste(filled, cx1, cy1, mask)
    }

    fun close() = session.close()
}
