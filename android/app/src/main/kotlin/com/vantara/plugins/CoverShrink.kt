package com.vantara.plugins

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream

/**
 * غلافٌ يُحفظ بحجم البطاقة لا بحجم الطباعة. بعض المصادر (Team-X) تنشر أغلفة
 * أصلية بميغابايتين؛ الملف المحفوظ كما هو يبطئ فكّه في كل شبكة ويتجاوز مهلة
 * العرض، فيظهر الحرف مكان غلافٍ نزل فعلًا. ما فوق [LIMIT_BYTES] وأعرض من
 * [TARGET_WIDTH] يُصغَّر مرة واحدة عند الحفظ.
 */
object CoverShrink {
    const val TARGET_WIDTH = 600
    const val LIMIT_BYTES = 300_000

    /** أكبر قوة لاثنين تُبقي العرض ≥ [target]. 1 = بلا تصغير. */
    fun sampleFor(width: Int, target: Int = TARGET_WIDTH): Int {
        var sample = 1
        while (width / (sample * 2) >= target) sample *= 2
        return sample
    }

    /** `null` = احفظ الأصل كما هو (صغير، أو لا يُفكّ، أو لا يربح التصغير شيئًا). */
    fun shrink(bytes: ByteArray): Pair<ByteArray, String>? {
        if (bytes.size <= LIMIT_BYTES) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val sample = sampleFor(bounds.outWidth)
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
        val scaled = if (decoded.width > TARGET_WIDTH * 3 / 2) {
            Bitmap.createScaledBitmap(decoded, TARGET_WIDTH, decoded.height * TARGET_WIDTH / decoded.width, true).also { if (it !== decoded) decoded.recycle() }
        } else decoded
        return try {
            val out = ByteArrayOutputStream()
            val alpha = scaled.hasAlpha()
            @Suppress("DEPRECATION")
            val format = if (alpha) Bitmap.CompressFormat.WEBP else Bitmap.CompressFormat.JPEG
            scaled.compress(format, 85, out)
            val small = out.toByteArray()
            if (small.size in 1 until bytes.size) small to (if (alpha) "image/webp" else "image/jpeg") else null
        } finally {
            scaled.recycle()
        }
    }
}
