package com.vantara.plugins

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Rect
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** Real icons from local pinned APKs or bundled assets; never downloads or loads extension code. */
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
        // مخزن الإضافات المستمر (vault/<pkg>/<sha256>.apk) أولًا، ثم ملف ما قبل المخزن
        val local = File(context.filesDir, "$directory/vault/$pkg/${sha256.lowercase()}.apk").takeIf { it.isFile }
            ?: File(context.filesDir, "$directory/$pkg.apk")
        if (local.isFile && local.length() !in 1..MAX_APK_BYTES) return null
        val key = if (local.isFile) "${local.absolutePath}:${local.length()}:${local.lastModified()}:$sha256"
            else "bundled:${context.packageName}:$directory/$pkg:$sha256"
        return cache.getOrPut(key) {
            // Only PNGs produced after archive digest/package verification enter this cache.
            // Its stable identity also keeps an installed icon available across process restarts.
            val pngCache = NativeIconPngStore(File(context.cacheDir, "extension-icons/png"))
            val imageKey = "$directory:$pkg:${sha256.lowercase()}"
            pngCache.read(imageKey)?.let { return@getOrPut pngDataUrl(it) }
            // Assets need a path for PackageManager. Stage only our own verified temporary
            // copy; source APKs/user files stay untouched and no source is prepared.
            val staged = if (!local.isFile) NativeIconArchive.stage(
                File(context.cacheDir, "extension-icons"), sha256, MAX_APK_BYTES,
            ) { context.assets.open("$directory/$pkg.apk") } else null
            val apk = if (local.isFile) local else staged ?: return@getOrPut null
            try {
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
                            drawable.bounds = boundsFor(drawable.intrinsicWidth, drawable.intrinsicHeight)
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
                            try { canvas.drawBitmap(raster, null, boundsFor(raster.width, raster.height), null) } finally { raster.recycle() }
                        }
                        val out = ByteArrayOutputStream()
                        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) || out.size() > MAX_PNG_BYTES) return@runCatching null
                        val png = out.toByteArray()
                        pngCache.write(imageKey, png)
                        pngDataUrl(png)
                    } finally { bitmap.recycle() }
                }.getOrNull()
            } finally { staged?.delete() }
        }
    }

    private fun pngDataUrl(png: ByteArray) = "data:image/png;base64," + Base64.encodeToString(png, Base64.NO_WRAP)

    private fun boundsFor(width: Int, height: Int): Rect = NativeIconBounds.fit(width, height, SIZE)
        .let { Rect(it[0], it[1], it[2], it[3]) }
}

internal object NativeIconBounds {
    fun fit(width: Int, height: Int, size: Int): IntArray {
        val w = width.takeIf { it > 0 } ?: size
        val h = height.takeIf { it > 0 } ?: size
        val scale = size.toDouble() / maxOf(w, h)
        val targetW = (w * scale).toInt().coerceIn(1, size)
        val targetH = (h * scale).toInt().coerceIn(1, size)
        val left = (size - targetW) / 2
        val top = (size - targetH) / 2
        return intArrayOf(left, top, left + targetW, top + targetH)
    }
}

/** Bounded asset staging only; the caller must delete the verified temporary after use. */
internal object NativeIconArchive {
    fun stage(directory: File, sha256: String, maxBytes: Long, open: () -> InputStream): File? {
        var staged: File? = null
        var verified = false
        return try {
            require(maxBytes > 0 && Regex("^[a-fA-F0-9]{64}$").matches(sha256))
            require(directory.isDirectory || directory.mkdirs())
            val file = File.createTempFile("icon-", ".apk", directory).also { staged = it }
            val digest = MessageDigest.getInstance("SHA-256")
            var total = 0L
            open().use { input ->
                file.outputStream().buffered().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer, 0, minOf(buffer.size.toLong(), maxBytes - total + 1).toInt())
                        if (count < 0) break
                        total += count
                        require(total <= maxBytes)
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                }
            }
            require(total > 0)
            require(digest.digest().joinToString("") { "%02x".format(it) }.equals(sha256, true))
            verified = true
            file
        } catch (_: Exception) {
            null
        } finally {
            if (!verified) staged?.delete()
        }
    }
}

/** Private, bounded cache of already verified archive icons; never accepts a network image. */
internal class NativeIconPngStore(
    private val directory: File,
    private val maxEntries: Int = 64,
    private val maxBytes: Long = 4L * 1024 * 1024,
) {
    companion object {
        private const val MAX_PNG_BYTES = 64 * 1024
        private val names = Regex("^[a-f0-9]{64}\\.png$")
        private val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 13, 10, 26, 10)
        private val lock = Any()
    }

    private fun file(key: String): File = File(directory,
        MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) } + ".png")

    fun read(key: String): ByteArray? = synchronized(lock) {
        val file = file(key)
        runCatching {
            if (!file.isFile || file.length() !in 33..MAX_PNG_BYTES.toLong()) return@synchronized null
            // Length checks alone are racy; cap the read itself as well.
            val bytes = file.inputStream().use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer, 0, minOf(buffer.size, MAX_PNG_BYTES + 1 - out.size()))
                    if (count < 0) break
                    out.write(buffer, 0, count)
                    require(out.size() <= MAX_PNG_BYTES)
                }
                out.toByteArray()
            }
            if (!valid(bytes)) { file.delete(); return@synchronized null }
            file.setLastModified(System.currentTimeMillis())
            bytes
        }.getOrNull()
    }

    fun write(key: String, png: ByteArray) = synchronized(lock) {
        if (!valid(png) || maxEntries < 1 || maxBytes < png.size) return@synchronized
        var temporary: File? = null
        try {
            if (!directory.isDirectory && !directory.mkdirs()) return@synchronized
            val target = file(key)
            temporary = File.createTempFile("icon-", ".tmp", directory)
            temporary.writeBytes(png)
            if (!temporary.renameTo(target)) return@synchronized
            val entries = directory.listFiles().orEmpty().filter { it.isFile && names.matches(it.name) }.sortedBy { it.lastModified() }
            var bytes = entries.sumOf { it.length() }
            var count = entries.size
            for (entry in entries) {
                if (count <= maxEntries && bytes <= maxBytes) break
                val length = entry.length()
                if (entry.delete()) { count--; bytes -= length }
            }
        } catch (_: Exception) {
            // Icon caching must not change an install/list operation's outcome.
        } finally { temporary?.delete() }
    }

    private fun valid(png: ByteArray): Boolean {
        if (png.size !in 33..MAX_PNG_BYTES || !png.copyOfRange(0, 8).contentEquals(signature)) return false
        if (!png.copyOfRange(8, 16).contentEquals(byteArrayOf(0, 0, 0, 13, 73, 72, 68, 82))) return false
        val dimensions = java.nio.ByteBuffer.wrap(png, 16, 8)
        return dimensions.int in 1..96 && dimensions.int in 1..96
    }
}
