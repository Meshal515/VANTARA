package com.vantara.plugins.translation

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.nio.FloatBuffer

/**
 * جلسات ONNX Runtime: واحدة لكل نموذج، تُفتح عند أول استعمال وتبقى.
 *
 * CPU مع XNNPACK حين يتوفر (ARM يستفيد منه في الالتفافات)؛ NNAPI لا يُفعَّل
 * افتراضيًا لأن دقة ConvTranspose وResize فيه تختلف بين الأجهزة، وناتج
 * مختلف بين جوالين لنفس الصفحة أسوأ من ثوانٍ أكثر.
 */
object Ort {
    val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }

    fun open(file: File, threads: Int = 4): OrtSession {
        val opts = OrtSession.SessionOptions()
        opts.setIntraOpNumThreads(threads)
        opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        runCatching { opts.addXnnpack(mapOf("intra_op_num_threads" to threads.toString())) }
        return env.createSession(file.absolutePath, opts)
    }

    /** مصفوفة NCHW عائمة → موتّر. */
    fun tensor(data: FloatArray, vararg shape: Long): OnnxTensor =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), shape)

    fun tensor(data: LongArray, vararg shape: Long): OnnxTensor =
        OnnxTensor.createTensor(env, java.nio.LongBuffer.wrap(data), shape)
}

/**
 * صورة RGB في ذاكرة مسطّحة (بايت لكل قناة)، مع تحويلات إلى موتّرات النماذج.
 * `Bitmap` أندرويد يبقى عند الحواف (فكّ، ترميز، رسم)؛ الحسابات هنا على المصفوفات.
 */
class RgbImage(val width: Int, val height: Int, val data: ByteArray) {
    init {
        require(data.size == width * height * 3) { "rgb size mismatch" }
    }

    fun r(x: Int, y: Int): Int = data[(y * width + x) * 3].toInt() and 0xff
    fun g(x: Int, y: Int): Int = data[(y * width + x) * 3 + 1].toInt() and 0xff
    fun b(x: Int, y: Int): Int = data[(y * width + x) * 3 + 2].toInt() and 0xff

    fun copy(): RgbImage = RgbImage(width, height, data.copyOf())

    fun crop(x0: Int, y0: Int, x1: Int, y1: Int): RgbImage {
        val w = x1 - x0
        val h = y1 - y0
        val out = ByteArray(w * h * 3)
        for (y in 0 until h) System.arraycopy(data, ((y0 + y) * width + x0) * 3, out, y * w * 3, w * 3)
        return RgbImage(w, h, out)
    }

    fun paste(sub: RgbImage, x0: Int, y0: Int, where: ByteMask? = null) {
        for (y in 0 until sub.height) {
            val yy = y0 + y
            if (yy < 0 || yy >= height) continue
            for (x in 0 until sub.width) {
                val xx = x0 + x
                if (xx < 0 || xx >= width) continue
                if (where != null && where[xx, yy] == 0.toByte()) continue
                val s = (y * sub.width + x) * 3
                val d = (yy * width + xx) * 3
                data[d] = sub.data[s]
                data[d + 1] = sub.data[s + 1]
                data[d + 2] = sub.data[s + 2]
            }
        }
    }

    /** إعادة تحجيم ثنائية الخطية. */
    fun resize(w: Int, h: Int): RgbImage {
        if (w == width && h == height) return copy()
        val out = ByteArray(w * h * 3)
        val sx = width.toFloat() / w
        val sy = height.toFloat() / h
        for (y in 0 until h) {
            val fy = (y + 0.5f) * sy - 0.5f
            val y0 = fy.toInt().coerceIn(0, height - 1)
            val y1 = (y0 + 1).coerceAtMost(height - 1)
            val wy = (fy - y0).coerceIn(0f, 1f)
            for (x in 0 until w) {
                val fx = (x + 0.5f) * sx - 0.5f
                val x0 = fx.toInt().coerceIn(0, width - 1)
                val x1 = (x0 + 1).coerceAtMost(width - 1)
                val wx = (fx - x0).coerceIn(0f, 1f)
                for (c in 0 until 3) {
                    val a = data[(y0 * width + x0) * 3 + c].toInt() and 0xff
                    val b = data[(y0 * width + x1) * 3 + c].toInt() and 0xff
                    val cc = data[(y1 * width + x0) * 3 + c].toInt() and 0xff
                    val d = data[(y1 * width + x1) * 3 + c].toInt() and 0xff
                    val v = (a * (1 - wx) + b * wx) * (1 - wy) + (cc * (1 - wx) + d * wx) * wy
                    out[(y * w + x) * 3 + c] = (v + 0.5f).toInt().coerceIn(0, 255).toByte()
                }
            }
        }
        return RgbImage(w, h, out)
    }

    /** CHW عائم في [0,1]، داخل لوحة `size×size` (تبقى الحواف بلون `pad`). */
    fun toChwPadded(size: Int, pad: Int = 0): Pair<FloatArray, Float> {
        val r = minOf(size.toFloat() / width, size.toFloat() / height)
        val nw = Math.round(width * r)
        val nh = Math.round(height * r)
        val small = resize(nw, nh)
        val out = FloatArray(3 * size * size) { pad / 255f }
        val plane = size * size
        for (y in 0 until nh) for (x in 0 until nw) {
            val s = (y * nw + x) * 3
            val d = y * size + x
            out[d] = (small.data[s].toInt() and 0xff) / 255f
            out[plane + d] = (small.data[s + 1].toInt() and 0xff) / 255f
            out[2 * plane + d] = (small.data[s + 2].toInt() and 0xff) / 255f
        }
        return out to r
    }

    /** CHW عائم في [0,1] بأبعاد الصورة نفسها. */
    fun toChw(): FloatArray {
        val plane = width * height
        val out = FloatArray(3 * plane)
        for (i in 0 until plane) {
            out[i] = (data[i * 3].toInt() and 0xff) / 255f
            out[plane + i] = (data[i * 3 + 1].toInt() and 0xff) / 255f
            out[2 * plane + i] = (data[i * 3 + 2].toInt() and 0xff) / 255f
        }
        return out
    }

    fun gray(): ByteArray {
        val out = ByteArray(width * height)
        for (i in out.indices) {
            val r = data[i * 3].toInt() and 0xff
            val g = data[i * 3 + 1].toInt() and 0xff
            val b = data[i * 3 + 2].toInt() and 0xff
            out[i] = ((299 * r + 587 * g + 114 * b) / 1000).toByte()
        }
        return out
    }

    companion object {
        fun fromChw(chw: FloatArray, width: Int, height: Int): RgbImage {
            val plane = width * height
            val out = ByteArray(plane * 3)
            for (i in 0 until plane) {
                out[i * 3] = (chw[i] * 255f + 0.5f).toInt().coerceIn(0, 255).toByte()
                out[i * 3 + 1] = (chw[plane + i] * 255f + 0.5f).toInt().coerceIn(0, 255).toByte()
                out[i * 3 + 2] = (chw[2 * plane + i] * 255f + 0.5f).toInt().coerceIn(0, 255).toByte()
            }
            return RgbImage(width, height, out)
        }
    }
}
