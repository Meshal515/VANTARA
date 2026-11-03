package com.vantara.anime.stream

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A bounded admission check, not proof that a manifest's segments or codecs can play. */
object StreamProbe {
    private const val MAX_PREFIX_BYTES = 8 * 1024L
    private const val DASH_NAMESPACE = "urn:mpeg:dash:schema:mpd:2011"
    private enum class Result { ACCEPT, REJECT, RETRY_WITHOUT_RANGE }

    fun check(client: OkHttpClient, c: Candidate): Boolean {
        val first = client.newCall(request(c, range = true)).execute().use { inspect(c, it, range = true) }
        if (first != Result.RETRY_WITHOUT_RANGE) return first == Result.ACCEPT
        return client.newCall(request(c, range = false)).execute().use { inspect(c, it, range = false) } == Result.ACCEPT
    }

    /** Cancellation cancels the physical call, including a read stalled after response headers. */
    suspend fun checkCancellable(client: OkHttpClient, c: Candidate): Boolean {
        val first = inspectCancellable(client, c, range = true)
        if (first != Result.RETRY_WITHOUT_RANGE) return first == Result.ACCEPT
        return inspectCancellable(client, c, range = false) == Result.ACCEPT
    }

    private suspend fun inspectCancellable(client: OkHttpClient, c: Candidate, range: Boolean): Result =
        suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request(c, range))
            val activeResponse = AtomicReference<Response?>(null)
            continuation.invokeOnCancellation {
                call.cancel()
                activeResponse.getAndSet(null)?.close()
            }
            // OkHttp.enqueue rethrows non-IO interceptor failures on its dispatcher
            // thread. Source URL/redirect rejection must reach this suspended caller,
            // not crash Android. Keep transport/read cancellation tied to this Call.
            Dispatchers.IO.dispatch(continuation.context, Runnable {
                if (!continuation.isActive) return@Runnable
                try {
                    val response = call.execute()
                    activeResponse.set(response)
                    val result = response.use {
                        if (continuation.isActive) inspect(c, it, range) else Result.REJECT
                    }
                    if (continuation.isActive) continuation.resume(result)
                } catch (failure: Throwable) {
                    if (continuation.isActive) continuation.resumeWithException(failure)
                } finally {
                    activeResponse.getAndSet(null)?.close()
                }
            })
        }

    private fun request(c: Candidate, range: Boolean): Request = Request.Builder().url(c.url).apply {
        for ((key, value) in c.headers) runCatching { header(key, value) }
        // Some otherwise playable servers reject Range. Retry only their explicit 416, once.
        if (range) header("Range", "bytes=0-${MAX_PREFIX_BYTES - 1}") else removeHeader("Range")
    }.build()

    private fun inspect(c: Candidate, response: Response, range: Boolean): Result {
        if (range && response.code == 416) return Result.RETRY_WITHOUT_RANGE
        if (response.code !in 200..299) return Result.REJECT
        // peekBody caps even a server that ignores Range; use/close cancels the remaining body.
        val prefix = response.peekBody(MAX_PREFIX_BYTES).string()
        return if (verdict(c.container, response.header("Content-Type"), prefix)) Result.ACCEPT else Result.REJECT
    }

    /** Body evidence wins over missing/incorrect MIME; manifest candidates require their format. */
    fun verdict(container: Container, contentType: String?, head: String): Boolean {
        val text = head.trimStart('\uFEFF', ' ', '\n', '\r', '\t')
        val hls = text.startsWith("#EXTM3U") && (text.length == 7 || text[7] in "\r\n \t")
        val dash = dashRoot(text)
        if (container == Container.HLS) return hls
        if (container == Container.DASH) return dash
        if (hls || dash) return true
        if (mp4Header(head)) return true

        val type = contentType.orEmpty().substringBefore(';').trim().lowercase(Locale.ROOT)
        if (type == "text/html" || type == "application/xhtml+xml" || type == "application/json" || type.endsWith("+json")) return false
        if (text.isEmpty() || text.startsWith('<') || text.startsWith('{') || text.startsWith('[')) return false
        // Keep support for other binary media (e.g. MKV/WebM) served as video/octet-stream,
        // while refusing prose/challenge/error bodies merely labelled as media.
        val binary = head.any { (it.code < 32 && it !in "\r\n\t") || it == '\uFFFD' }
        return binary && (type.startsWith("video/") || type == "application/octet-stream")
    }

    private fun mp4Header(head: String): Boolean {
        if (head.length < 12 || head.substring(4, 8) != "ftyp") return false
        val size = (0..3).fold(0L) { value, at -> (value shl 8) or (head[at].code.toLong() and 255) }
        // A real ftyp has a major brand/minor version and optional four-byte brands.
        // Bound its size too, so prose with "ftyp" at offset four is not evidence.
        return size in 16L..MAX_PREFIX_BYTES && size % 4 == 0L
    }

    /** Reads only the XML preamble/root start tag. No DTDs, entities or external resources. */
    private fun dashRoot(text: String): Boolean {
        var at = 0
        while (true) {
            while (at < text.length && text[at].isWhitespace()) at++
            at = when {
                text.startsWith("<?", at) -> text.indexOf("?>", at + 2).takeIf { it >= 0 }?.plus(2) ?: return false
                text.startsWith("<!--", at) -> text.indexOf("-->", at + 4).takeIf { it >= 0 }?.plus(3) ?: return false
                else -> break
            }
        }
        val root = ROOT.find(text.substring(at)) ?: return false
        val name = root.groupValues[1]
        at += root.value.length
        val attributes = HashMap<String, String>()
        while (at < text.length) {
            val start = at
            while (at < text.length && text[at].isWhitespace()) at++
            if (text.startsWith(">", at) || text.startsWith("/>", at)) {
                val prefix = name.substringBefore(':', "")
                val namespace = attributes[if (prefix.isEmpty()) "xmlns" else "xmlns:$prefix"]
                return if (prefix.isEmpty()) namespace == null || namespace == DASH_NAMESPACE else namespace == DASH_NAMESPACE
            }
            if (at == start) return false
            val attribute = ATTRIBUTE.find(text.substring(at)) ?: return false
            val key = attribute.groupValues[1]
            val value = attribute.groupValues[2].ifEmpty { attribute.groupValues[3] }
            if (attributes.put(key, value) != null) return false
            at += attribute.value.length
        }
        return false
    }

    private val ROOT = Regex("^<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?MPD)(?=[\\s/>])")
    private val ATTRIBUTE = Regex("^([A-Za-z_][A-Za-z0-9_.:-]*)\\s*=\\s*(?:\"([^\"<]*)\"|'([^'<]*)')")
}
