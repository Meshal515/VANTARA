package com.vantara.anime.player.together

/**
 * تعتيم الجهة اليسرى من بنر الغرفة بقدر إضاءتها. بنر Cinemeta لأعمال مثل أركين أبيض ناصع في نصفه الأيسر فيضيع عليه
 * زر الخروج والبطاقة والشريط؛ أما البنر الغامق فلا يُلمس (لا تعتيم ثابت على كل الأعمال).
 */
object LobbyDim {
    /** متوسط الإضاءة (0..1) لأعمدة اليسار [leftShare] من صورة [w]×[h] بكسلاتها ARGB. */
    fun leftLuma(pixels: IntArray, w: Int, h: Int, leftShare: Float = 0.45f): Float {
        if (w <= 0 || h <= 0 || pixels.size < w * h) return Float.NaN
        val cols = (w * leftShare).toInt().coerceIn(1, w)
        var sum = 0.0
        for (y in 0 until h) for (x in 0 until cols) {
            val p = pixels[y * w + x]
            sum += (0.2126 * ((p shr 16) and 0xFF) + 0.7152 * ((p shr 8) and 0xFF) + 0.0722 * (p and 0xFF)) / 255.0
        }
        return (sum / (cols * h)).toFloat()
    }

    /** قوة التعتيم 0..1: لا شيء تحت 0.45، وكاملًا من 0.70. */
    fun strength(luma: Float): Float = if (luma.isNaN()) 0f else ((luma - 0.45f) / 0.25f).coerceIn(0f, 1f)
}
