package com.vantara.plugins.translation

import ai.onnxruntime.OrtSession
import java.io.File
import kotlin.math.ceil

data class OcrLine(val box: Box, val text: String, val confidence: Float)
data class OcrResult(val text: String, val confidence: Float, val lines: List<OcrLine>, val failedLines: Int = 0, val retriedLines: Int = 0)

/**
 * قراءة النص اللاتيني سطرًا سطرًا: PP-OCRv5 mobile rec (CTC).
 * الأسطر تُشتق من الإسقاط الأفقي لقناع الحروف داخل صندوق النص.
 */
class LatinOcr(model: File, dict: File, private val work:InferenceWork=InferenceWork.HEAVY) {
    private val session: OrtSession = Ort.open(model, threads = 2, engine=if(work==InferenceWork.CONFIRM) Ort.Engine("confirm-lane",1,2,spin=false) else null)
    private val chars: List<String> = dict.readLines(Charsets.UTF_8)
    private val inputName = session.inputNames.first()
    private val height = 48

    /** أسطر النص من الإسقاط الأفقي لقناع الحروف داخل الصندوق. */
    fun splitLines(glyph: ByteMask, box: Box, minGap: Int = 3): List<Box> {
        val rows = IntArray(box.h)
        for (y in 0 until box.h) {
            var n = 0
            val yy = box.y1 + y
            if (yy < 0 || yy >= glyph.height) continue
            for (x in maxOf(0, box.x1) until minOf(glyph.width, box.x2)) if (glyph[x, yy].toInt() != 0) n++
            rows[y] = n
        }
        val spans = ArrayList<IntArray>()
        var inside = false; var start = 0; var gap = 0
        for (y in rows.indices) {
            if (rows[y] > 0) { if (!inside) { inside = true; start = y }; gap = 0 }
            else if (inside) { gap++; if (gap >= minGap) { spans.add(intArrayOf(start, y - gap + 1)); inside = false } }
        }
        if (inside) spans.add(intArrayOf(start, rows.size))
        val heights = spans.map { it[1] - it[0] }.sorted()
        val typical = if (heights.isEmpty()) 0 else heights[heights.size / 2]
        val out = ArrayList<Box>()
        for ((a, b) in spans.map { it[0] to it[1] }) {
            if (b - a < maxOf(4, (typical * 0.35).toInt())) continue
            var x0 = Int.MAX_VALUE; var x1 = -1
            for (y in a until b) for (x in maxOf(0, box.x1) until minOf(glyph.width, box.x2)) if (glyph[x, box.y1 + y].toInt() != 0) { if (x < x0) x0 = x; if (x > x1) x1 = x }
            if (x1 < 0) continue
            out.add(Box(x0, box.y1 + a, x1 + 1, box.y1 + b))
        }
        return out
    }

    /** يقرأ سطرًا واحدًا (قطعة RGB). يرجع النص ومتوسط ثقة الحروف. */
    fun recognize(line: RgbImage): Pair<String, Float> {
        if (line.width < 4 || line.height < 4) return "" to 0f
        val w = maxOf(16, ceil(height * line.width.toFloat() / line.height).toInt())
        val small = line.resize(w, height)
        // BGR وتطبيع إلى [-1,1]: النموذج مدرَّب على ترتيب OpenCV
        val plane = w * height
        val x = FloatArray(3 * plane)
        for (i in 0 until plane) {
            val r = (small.data[i * 3].toInt() and 0xff) / 255f
            val g = (small.data[i * 3 + 1].toInt() and 0xff) / 255f
            val b = (small.data[i * 3 + 2].toInt() and 0xff) / 255f
            x[i] = (b - 0.5f) / 0.5f; x[plane + i] = (g - 0.5f) / 0.5f; x[2 * plane + i] = (r - 0.5f) / 0.5f
        }
        val input = Ort.tensor(x, 1, 3, height.toLong(), w.toLong())
        val sb = StringBuilder()
        val confs = ArrayList<Float>()
        Ort.run(session, mapOf(inputName to input),work=work).use { res ->
            @Suppress("UNCHECKED_CAST")
            val logits = (res[0].value as Array<Array<FloatArray>>)[0] // T × C
            val c = logits[0].size
            val vocab = if (c == chars.size + 2) listOf("") + chars + listOf(" ") else listOf("") + chars
            var last = -1
            for (t in logits.indices) {
                val row = logits[t]
                var best = 0; var bestV = row[0]
                for (i in 1 until row.size) if (row[i] > bestV) { bestV = row[i]; best = i }
                if (best != 0 && best != last && best < vocab.size) {
                    // softmax للثقة إن كانت لوغاريتمية
                    var maxV = row[0]; for (v in row) if (v > maxV) maxV = v
                    var sum = 0.0; for (v in row) sum += Math.exp((v - maxV).toDouble())
                    val p = if (row.any { it > 1f || it < 0f }) (Math.exp((bestV - maxV).toDouble()) / sum).toFloat() else bestV
                    sb.append(vocab[best]); confs.add(p)
                }
                last = best
            }
        }

        return sb.toString().trim() to (if (confs.isEmpty()) 0f else confs.average().toFloat())
    }

    fun read(img: RgbImage, glyph: ByteMask, box: Box, pad: Int = 4): OcrResult =
        OcrRecovery.read(splitLines(glyph, box), pad) { line, margin ->
            recognize(img.crop(maxOf(0, line.x1 - margin), maxOf(0, line.y1 - margin),
                minOf(img.width, line.x2 + margin), minOf(img.height, line.y2 + margin)))
        }

    fun close() = session.close()
}
