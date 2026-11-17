package com.vantara.downloads

import android.os.StatFs
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

/**
 * نقل البايتات إلى القرص: ملف مباشر يُستأنف بـRange، وHLS يُستأنف بالمقطع.
 *
 * - الاستئناف لا يعيد بيانات صالحة: الملف الجزئي (.part) يكمل من طوله الحالي، ومع ETag/
 *   Last-Modified يُرسل If-Range، فإن تغيّر الملف عند المصدر يبدأ من الصفر بدل لصق نسختين.
 * - مصدر يتجاهل Range (يرد 200 لطلب جزئي) ⇒ يُبدأ من الصفر صراحة، لا تُلصق بايتات من أول الملف.
 * - 401/403/410 من رابط موقّع = انتهت صلاحيته: يُجدَّد من السيرفر نفسه ويكمل.
 * - المساحة تُفحص قبل البدء وكل 8 MB: نفاد المساحة حالة واضحة لا ملف تالف.
 */
class Transfers(private val client: (url: String, headers: Map<String, String>) -> OkHttpClient) {

    fun interface Progress { fun update(bytes: Long, total: Long) }

    class Cancelled : IOException("cancelled")

    @Volatile private var cancelled = false
    @Volatile private var call: okhttp3.Call? = null

    fun cancel() {
        cancelled = true
        call?.cancel()
    }

    private fun check() { if (cancelled) throw Cancelled() }

    private fun execute(request: Request, headers: Map<String, String>): Response {
        check()
        val c = client(request.url.toString(), headers).newCall(request)
        call = c
        val response = try { c.execute() } catch (e: IOException) { if (cancelled) throw Cancelled(); throw DownloadFailure("NETWORK", e.message ?: "انقطع الاتصال") }
        when (response.code) {
            in 200..299 -> return response
            401, 403, 410 -> { response.close(); throw DownloadFailure("EXPIRED", "HTTP ${response.code}") }
            404 -> { response.close(); throw DownloadFailure("SOURCE", "HTTP 404") }
            416 -> return response
            429, in 500..599 -> { response.close(); throw DownloadFailure("NETWORK", "HTTP ${response.code}") }
            else -> { response.close(); throw DownloadFailure("SOURCE", "HTTP ${response.code}") }
        }
    }

    private fun request(url: String, headers: Map<String, String>, range: String? = null, ifRange: String? = null): Request =
        Request.Builder().url(url).apply {
            headers.forEach { (k, v) -> if (!k.equals("Range", true)) header(k, v) }
            range?.let { header("Range", it) }
            ifRange?.let { header("If-Range", it) }
        }.build()

    /** الحجم الكلي من Content-Range («bytes 0-0/12345») أو Content-Length. */
    private fun totalOf(response: Response, offset: Long): Long {
        val cr = response.header("Content-Range")
        val fromRange = cr?.substringAfter('/')?.trim()?.toLongOrNull()
        if (fromRange != null && fromRange > 0) return fromRange
        val len = response.body?.contentLength() ?: -1
        return if (len > 0) len + offset else -1
    }

    private fun rangeOf(response: Response): LongRange? {
        val match = Regex("""bytes (\d+)-(\d+)/(?:\d+|\*)""").matchEntire(response.header("Content-Range").orEmpty())
            ?: return null
        val start = match.groupValues[1].toLongOrNull() ?: return null
        val end = match.groupValues[2].toLongOrNull() ?: return null
        return (start..end).takeUnless { it.isEmpty() }
    }

    data class Head(val container: String, val total: Long, val ranges: Boolean, val etag: String?, val lastModified: String?, val contentType: String?)

    /** فحص قبل الحفظ: أول 16 بايت تكشف الحاوية، وContent-Range يكشف الحجم ودعم الاستئناف. */
    fun head(url: String, headers: Map<String, String>): Head {
        execute(request(url, headers, range = "bytes=0-15"), headers).use { r ->
            val bytes = r.body?.byteStream()?.use { s -> ByteArray(16).let { b -> val n = s.read(b); if (n > 0) b.copyOf(n) else ByteArray(0) } } ?: ByteArray(0)
            val ranges = r.code == 206 || r.header("Accept-Ranges").equals("bytes", true)
            return Head(Signatures.sniff(bytes, r.header("Content-Type")), totalOf(r, 0), ranges, r.header("ETag"), r.header("Last-Modified"), r.header("Content-Type"))
        }
    }

    /**
     * ينزّل `url` إلى `part` مكملًا من طوله الحالي. يرجع الحجم النهائي والمعرّفات المحدّثة.
     * `validator`: ETag أو Last-Modified من محاولة سابقة (للتأكد أن الملف عند المصدر لم يتغير).
     */
    fun file(url: String, headers: Map<String, String>, part: File, validator: String?, progress: Progress): Triple<Long, String?, String?> {
        part.parentFile?.mkdirs()
        var offset = if (part.exists()) part.length() else 0L
        val response = execute(request(url, headers, range = "bytes=$offset-", ifRange = if (offset > 0) validator else null), headers)
        response.use { r ->
            if (r.code == 416) {
                // الجزئي بطول الملف كاملًا أو أطول: الحجم الحقيقي يُعرف من Content-Range
                val total = r.header("Content-Range")?.substringAfter('/')?.trim()?.toLongOrNull() ?: -1
                if (total > 0 && offset == total) return Triple(total, r.header("ETag"), r.header("Last-Modified"))
                part.delete()
                throw DownloadFailure("VERIFY", "الجزئي لا يطابق الملف عند المصدر")
            }
            if (r.code == 200 && offset > 0) {
                // المصدر تجاهل الاستئناف أو تغيّر الملف (If-Range): من الصفر صراحة
                offset = 0
                part.delete()
            }
            if (r.code == 206 && rangeOf(r)?.first != offset)
                throw DownloadFailure("VERIFY", "بداية الجزء المستلم لا تطابق موضع الاستئناف")
            val total = totalOf(r, offset)
            ensureSpace(part, if (total > 0) total - offset else 64L * 1024 * 1024)
            val body = r.body ?: throw DownloadFailure("NETWORK", "رد بلا جسم")
            RandomAccessFile(part, "rw").use { out ->
                out.setLength(offset)
                out.seek(offset)
                val buffer = ByteArray(128 * 1024)
                var done = offset
                var sinceSpace = 0L
                body.byteStream().use { input ->
                    while (true) {
                        check()
                        val n = try { input.read(buffer) } catch (e: IOException) { if (cancelled) throw Cancelled(); throw DownloadFailure("NETWORK", e.message ?: "انقطع الاتصال") }
                        if (n < 0) break
                        try { out.write(buffer, 0, n) } catch (e: IOException) { throw storageFailure(e) }
                        done += n
                        sinceSpace += n
                        if (sinceSpace >= 8L * 1024 * 1024) { ensureSpace(part, 16L * 1024 * 1024); sinceSpace = 0 }
                        progress.update(done, total)
                    }
                }
                if (total > 0 && done != total) throw DownloadFailure("NETWORK", "انقطع قبل اكتمال الملف ($done من $total)")
                return Triple(done, r.header("ETag"), r.header("Last-Modified"))
            }
        }
    }

    /** نص صغير (قائمة HLS، ترجمة): بحد أقصى حتى لا يُحمَّل ملف ضخم في الذاكرة. */
    fun text(url: String, headers: Map<String, String>, max: Int = 8 * 1024 * 1024): String =
        execute(request(url, headers), headers).use { r ->
            val bytes = r.body?.byteStream()?.use { it.readNBytesCompat(max + 1) } ?: ByteArray(0)
            if (bytes.size > max) throw DownloadFailure("SOURCE", "القائمة أكبر من المتوقع")
            String(bytes, Charsets.UTF_8)
        }

    /** مقطع أو مفتاح كامل إلى ملف (مع مدى بايتات اختياري). يكتب إلى .tmp ثم يعيد التسمية: لا مقطع نصف مكتوب. */
    fun whole(url: String, headers: Map<String, String>, dest: File, range: LongRange? = null): Long {
        val tmp = File(dest.parentFile, dest.name + ".tmp")
        dest.parentFile?.mkdirs()
        execute(request(url, headers, range = range?.let { "bytes=${it.first}-${it.last}" }), headers).use { r ->
            if (range != null && (r.code != 206 || rangeOf(r) != range))
                throw DownloadFailure("VERIFY", "المصدر لم يرجع نطاق المقطع المطلوب")
            if (range == null && r.code != 200)
                throw DownloadFailure("VERIFY", "المصدر لم يرجع الملف المساعد كاملًا")
            val body = r.body ?: throw DownloadFailure("NETWORK", "رد بلا جسم")
            var n = 0L
            try {
                tmp.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            check()
                            val k = try { input.read(buffer) } catch (e: IOException) { if (cancelled) throw Cancelled(); throw DownloadFailure("NETWORK", e.message ?: "انقطع الاتصال") }
                            if (k < 0) break
                            out.write(buffer, 0, k)
                            n += k
                        }
                    }
                }
            } catch (e: IOException) {
                if (e is Cancelled) throw e
                throw storageFailure(e)
            }
            val expected = range?.let { it.last - it.first + 1 } ?: body.contentLength()
            if (n <= 0 || (expected > 0 && n != expected)) { tmp.delete(); throw DownloadFailure("NETWORK", "مقطع ناقص") }
            if (!tmp.renameTo(dest)) { dest.delete(); if (!tmp.renameTo(dest)) throw DownloadFailure("STORAGE", "تعذّرت كتابة المقطع") }
            return n
        }
    }

    companion object {
        fun freeBytes(dir: File): Long = runCatching { StatFs(dir.absolutePath).availableBytes }.getOrDefault(Long.MAX_VALUE)

        /** يُبقي هامشًا 200 MB للنظام: ملء القرص حتى آخر بايت يعطّل الجهاز لا التنزيل وحده. */
        fun ensureSpace(file: File, needed: Long) {
            val dir = file.parentFile ?: return
            if (freeBytes(dir) - needed.coerceAtLeast(0) < 200L * 1024 * 1024) throw DownloadFailure("NO_SPACE", "المساحة المتاحة لا تكفي")
        }

        fun storageFailure(e: IOException): DownloadFailure =
            if ((e.message ?: "").contains("ENOSPC") || (e.message ?: "").contains("No space", true)) DownloadFailure("NO_SPACE", "المساحة نفدت أثناء الكتابة")
            else DownloadFailure("STORAGE", e.message ?: "تعذّرت الكتابة")

        private fun java.io.InputStream.readNBytesCompat(max: Int): ByteArray {
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            var total = 0
            while (total < max) {
                val n = read(buffer, 0, minOf(buffer.size, max - total))
                if (n < 0) break
                out.write(buffer, 0, n)
                total += n
            }
            return out.toByteArray()
        }
    }
}
