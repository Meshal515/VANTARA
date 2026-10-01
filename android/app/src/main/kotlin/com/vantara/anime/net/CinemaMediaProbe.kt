package com.vantara.anime.net

import java.io.IOException
import eu.kanade.tachiyomi.network.HostRouting
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrl

/** A bounded byte probe, not a claim that the Android decoder played the video. */
class CinemaMediaProbe(client: OkHttpClient) {
    private val client = client.newBuilder().connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS).callTimeout(12, TimeUnit.SECONDS).build()

    suspend fun probe(url: String, headers: Map<String, String>): Result<String> = withContext(Dispatchers.IO) {
        try {
            var current = url.toHttpUrl()
            repeat(4) {
                val request = Request.Builder().url(current).tag(HostRouting.NoBrowser::class.java, HostRouting.NoBrowser()).apply {
                    headers.forEach { (key, value) -> header(key, value) }
                    header("Range", "bytes=0-65535")
                }.build()
                var next: String? = null
                client.newCall(request).awaitResponse().use { response ->
                    if (!response.isSuccessful) throw IOException("HTTP ${response.code} ← ${current.host}${current.encodedPath}")
                    val source = response.body.source()
                    source.request(65_536)
                    val bytes = source.buffer.readByteArray(minOf(source.buffer.size, 65_536L))
                    if (bytes.isEmpty()) throw IOException("رد الفيديو فارغ ← ${current.host}")
                    val text = bytes.toString(Charsets.UTF_8).trimStart()
                    val type = response.header("Content-Type").orEmpty().lowercase()
                    if ("text/html" in type || text.startsWith("<html", true) || text.startsWith("<!doctype", true)) {
                        throw IOException("صفحة HTML أو تحقق بدل فيديو ← ${current.host}")
                    }
                    if (text.startsWith("#EXTM3U")) {
                        next = text.lineSequence().map(String::trim).firstOrNull { line -> line.isNotBlank() && !line.startsWith('#') }
                            ?: throw IOException("قائمة HLS بلا مقاطع ← ${current.host}")
                    } else {
                        val binary = bytes[0] == 0x47.toByte() ||
                            (bytes.size >= 8 && bytes.copyOfRange(4, 8).toString(Charsets.US_ASCII) in setOf("ftyp", "styp", "moof")) ||
                            (bytes.size >= 4 && bytes.take(4) == listOf(0x1a.toByte(), 0x45.toByte(), 0xdf.toByte(), 0xa3.toByte()))
                        if (!binary) throw IOException("لم تُثبت بايتات فيديو صالحة ← ${current.host}${current.encodedPath} ($type)")
                        return@withContext Result.success("بايتات فيديو وصلت من ${current.host}${current.encodedPath} — اختبار فك الترميز يحتاج المشغّل")
                    }
                    current = response.request.url
                }
                current = current.resolve(next!!) ?: throw IOException("رابط مقطع HLS غير صالح")
                if (current.scheme !in setOf("http", "https")) throw IOException("بروتوكول فيديو غير صالح")
            }
            Result.failure(IOException("قائمة HLS متداخلة بلا مقطع فيديو خلال أربع خطوات"))
        } catch (t: CancellationException) { throw t }
        catch (t: Exception) { Result.failure(t) }
    }

    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private suspend fun Call.awaitResponse(): Response = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resumeWith(Result.failure(e))
            }
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response) { response.close() }
            }
        })
    }
}
