package com.vantara.anime.player.together

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.Drawable
import android.graphics.drawable.LayerDrawable
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.LruCache
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * صور الغرفة في المشغّل الأصلي: الأفاتارات الحقيقية (لا حرف فقط) والبنر والشعار.
 *
 * مفتاح الأفاتار كما في الويب (`avatarNode` يضعه src مباشرة):
 *   `/avatars/meshal.webp` ← أصول التطبيق `public/avatars/meshal.webp` (نفس ملفات الواجهة)
 *   `https://…`            ← من الشبكة
 *   `data:image/…;base64,` ← مضمّن
 * فشل التحميل؟ يبقى الحرف الملوّن — لا شيء ينكسر.
 */
class TogetherImages(private val context: Context, http: OkHttpClient) {
    private val client = http.newBuilder().callTimeout(12, TimeUnit.SECONDS).build()
    private val cache = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val main = Handler(Looper.getMainLooper())
    private val jobs = RoomImageJobs<Bitmap>({ main.post(it) })
    private val missing = HashSet<String>()
    private var closed = false

    /** [done] على الخيط الرئيسي؛ null إن تعذّر. [maxPx] يحدّ الحجم المفكوك. */
    fun load(key: String?, maxPx: Int, done: (Bitmap?) -> Unit) {
        if (closed) return
        if (key.isNullOrBlank()) return done(null)
        val id = "$key@$maxPx"
        cache.get(id)?.let { return done(it) }
        if (id in missing) return done(null)
        jobs.load({ decode(bytesOf(key), maxPx) }) { bmp ->
            if (bmp != null) cache.put(id, bmp) else missing += id
            done(bmp)
        }
    }

    private fun bytesOf(key: String): ByteArray? = when {
        key.startsWith("data:") -> Base64.decode(key.substringAfter(','), Base64.DEFAULT)
        key.startsWith("http://") || key.startsWith("https://") ->
            client.newCall(Request.Builder().url(key).build()).execute().use { r -> if (r.isSuccessful) r.body.bytes().takeIf { it.size <= MAX_BYTES } else null }
        key.startsWith("/") && !key.contains("..") -> context.assets.open("public$key").use { it.readBytes() }
        else -> null
    }

    private fun decode(bytes: ByteArray?, maxPx: Int): Bitmap? {
        bytes ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxPx && bounds.outHeight / (sample * 2) >= maxPx) sample *= 2
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    /** صورة دائرية فوقها حلقة الحالة (نفس GradientDrawable الحرف). */
    fun circle(bmp: Bitmap, ring: Drawable?): Drawable {
        val round = RoundedBitmapDrawableFactory.create(context.resources, bmp).apply { isCircular = true; setAntiAlias(true) }
        return if (ring == null) round else LayerDrawable(arrayOf(round, ring))
    }

    fun close() { closed = true; jobs.close(); cache.evictAll(); missing.clear() }

    companion object {
        private const val MAX_BYTES = 4 * 1024 * 1024
    }
}
