package com.vantara.plugins.translation

/** إعادة موضعية محدودة؛ لا يتغير صندوق النص أو قناع مسحه بسبب هامش OCR. */
internal object OcrRecovery {
    private const val MAX_RETRY_LINES = 4

    fun read(boxes: List<Box>, pad: Int = 4, minimumConfidence: Float = Regions.MIN_OCR_CONF,
             recognize: (Box, Int) -> Pair<String, Float>): OcrResult {
        var retried = 0
        val lines = boxes.map { box ->
            var result = recognize(box, pad)
            if (!trusted(result, minimumConfidence) && retried < MAX_RETRY_LINES) {
                retried++
                val retry = recognize(box, maxOf(8, pad * 2))
                // لا يستبدل نصًا غير موثوق بنص آخر لمجرد أن ثقته أعلى قليلًا.
                if (trusted(retry, minimumConfidence)) result = retry
            }
            OcrLine(box, result.first.trim(), result.second)
        }
        val failed = lines.count { !trusted(it.text to it.confidence, minimumConfidence) }
        // إبقاء الأسطر الفارغة يمنع اختفاء كلمة/سطر من متوسط المنطقة بصمت.
        val confidence = if (lines.isEmpty() || failed > 0) 0f else lines.map { it.confidence }.average().toFloat()
        return OcrResult(lines.filter { it.text.isNotEmpty() }.joinToString(" ") { it.text }, confidence, lines, failed, retried)
    }

    private fun trusted(result: Pair<String, Float>, minimum: Float): Boolean =
        result.first.isNotBlank() && result.second.isFinite() && result.second >= minimum
}
