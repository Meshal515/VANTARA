package com.vantara.plugins

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Rect
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest

/** Real icons from already downloaded, pinned APKs; never downloads an APK for its logo. */
object NativeExtensionIcons {
    private const val SIZE = 96
    private const val MAX_APK_BYTES = 40L * 1024 * 1024
    private const val MAX_PNG_BYTES = 64 * 1024
    private val cache = NativeIconCache()
    private val packageName = Regex("^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+$")
    private val digest = Regex("^[a-fA-F0-9]{64}$")

    /** Missing/invalid resources stay absent, allowing the caller to use its repo's declared logo. */
    fun iconUrl(context: Context, directory: String, pkg: String, sha256: String): String? {
        if (directory !in setOf("extensions", "anime-extensions") || !packageName.matches(pkg) || !digest.matches(sha256)) return null
        val apk = File(context.filesDir, "$directory/$pkg.apk")
        if (!apk.isFile || apk.length() !in 1..MAX_APK_BYTES) return null
        val key = "${apk.absolutePath}:${apk.length()}:${apk.lastModified()}:$sha256"
        return cache.getOrPut(key) {
            runCatching {
                val hasher = MessageDigest.getInstance("SHA-256")
                apk.inputStream().buffered().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        total += count
                        require(total <= MAX_APK_BYTES)
                        hasher.update(buffer, 0, count)
                    }
                }
                require(hasher.digest().joinToString("") { "%02x".format(it) }.equals(sha256, true))
                @Suppress("DEPRECATION")
                val info = context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0) ?: return@runCatching null
                if (info.packageName != pkg) return@runCatching null
                val app = info.applicationInfo ?: return@runCatching null
                // loadIcon() with icon == 0 invents the platform default icon; leave it absent.
                if (app.icon == 0) return@runCatching null
                app.sourceDir = apk.absolutePath
                app.publicSourceDir = apk.absolutePath
                val resources = context.packageManager.getResourcesForApplication(app)
                val resource = android.util.TypedValue()
                resources.getValue(app.icon, resource, true)
                val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
                try {
                    val canvas = Canvas(bitmap)
                    if (resource.string?.toString()?.endsWith(".xml", true) == true) {
                        // Only plain vectors: adaptive/layer XML can indirectly decode unbounded bitmaps.
                        resources.openRawResource(app.icon).use { input ->
                            val buffer = ByteArray(4096)
                            var total = 0
                            while (true) {
                                val count = input.read(buffer)
                                if (count < 0) break
                                total += count
                                require(total <= 256 * 1024)
                            }
                        }
                        resources.getXml(app.icon).use { parser ->
                            var event = parser.eventType
                            while (event != org.xmlpull.v1.XmlPullParser.START_TAG && event != org.xmlpull.v1.XmlPullParser.END_DOCUMENT) event = parser.next()
                            if (event != org.xmlpull.v1.XmlPullParser.START_TAG || parser.name != "vector") return@runCatching null
                        }
                        val drawable = resources.getDrawable(app.icon, context.theme)
                        drawable.setBounds(0, 0, SIZE, SIZE)
                        drawable.draw(canvas)
                    } else {
                        // Probe raster dimensions before decoding; don't allocate a full-size bitmap.
                        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        resources.openRawResource(app.icon).use { BitmapFactory.decodeStream(it, null, options) }
                        if (options.outWidth !in 1..4096 || options.outHeight !in 1..4096) return@runCatching null
                        options.inJustDecodeBounds = false
                        options.inScaled = false
                        options.inSampleSize = 1
                        while (maxOf(options.outWidth, options.outHeight) / options.inSampleSize > SIZE * 2) options.inSampleSize *= 2
                        val raster = resources.openRawResource(app.icon).use { BitmapFactory.decodeStream(it, null, options) } ?: return@runCatching null
                        try { canvas.drawBitmap(raster, null, Rect(0, 0, SIZE, SIZE), null) } finally { raster.recycle() }
                    }
                    val out = ByteArrayOutputStream()
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) || out.size() > MAX_PNG_BYTES) return@runCatching null
                    "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                } finally { bitmap.recycle() }
            }.getOrNull()
        }
    }
}
