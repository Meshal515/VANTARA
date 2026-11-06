package com.vantara.anime.stream

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * A bounded admission check. For HLS it follows the playlist to the first media segment, as the player will:
 * an opening playlist whose segments fail (Eshek, round 11: «جاهز» then the player left before any frame) is not
 * ready. It still does not prove codecs; the player's first frame does.
 */
object StreamProbe {
    private const val MAX_PREFIX_BYTES = 8 * 1024L
    private const val SEGMENT_PREFIX_BYTES = 1024L
    private const val DASH_NAMESPACE = "urn:mpeg:dash:schema:mpd:2011"
    private enum class Result { ACCEPT, REJECT, RETRY_WITHOUT_RANGE }
    private class Inspected(val result: Result, val url: String, val prefix: String)

    fun check(client: OkHttpClient, c: Candidate): Boolean {
        var first = client.newCall(request(c, range = true)).execute().use { inspect(c, it, range = true) }
        if (first.result == Result.RETRY_WITHOUT_RANGE) first = client.newCall(request(c, range = false)).execute().use { inspect(c, it, range = false) }
        if (first.result != Result.ACCEPT) return false
        return hlsPlayable(c, first) { url, limit, playlist ->
            val ranged = client.newCall(follow(c, url, limit, range = true)).execute().use { ranged(it, limit, playlist) }
            if (ranged !== RANGE_REFUSED) ranged
            else client.newCall(follow(c, url, limit, range = false)).execute().use { fetched(it, limit, playlist) }
        }
    }

    /** Cancellation cancels the physical call, including a read stalled after response headers. */
    suspend fun checkCancellable(client: OkHttpClient, c: Candidate): Boolean {
        var first = inspectCancellable(client, c, range = true)
        if (first.result == Result.RETRY_WITHOUT_RANGE) first = inspectCancellable(client, c, range = false)
        if (first.result != Result.ACCEPT) return false
        return hlsPlayableCancellable(client, c, first)
    }

    /** One hop of the HLS walk: [playlist] reads text, otherwise the segment's leading bytes. Null = unreachable. */
    private class Hop(val url: String, val text: String?, val bytes: ByteArray?)

    private fun follow(c: Candidate, url: String, limit: Long, range: Boolean = true): Request = Request.Builder().url(url).apply {
        for ((key, value) in c.headers) runCatching { header(key, value) }
        if (range) header("Range", "bytes=0-${limit - 1}")
    }.build()

    /**
     * A server that refuses byte ranges (416 / 501) on a variant or segment still plays without one, as the
     * first request already allows (RETRY_WITHOUT_RANGE). Its refusal is not evidence against the stream.
     */
    private val RANGE_REFUSED = Hop("", null, null)
    private fun ranged(response: Response, limit: Long, playlist: Boolean): Hop? =
        if (response.code == 416 || response.code == 501) RANGE_REFUSED else fetched(response, limit, playlist)

    private fun fetched(response: Response, limit: Long, playlist: Boolean): Hop? {
        if (response.code !in 200..299) return null
        val body = response.peekBody(limit).bytes()
        return Hop(response.request.url.toString(), if (playlist) String(body, Charsets.UTF_8) else null, body)
    }

    /** First URI after a tag line (a variant after #EXT-X-STREAM-INF, a segment after #EXTINF), resolved. */
    internal fun firstUri(playlist: String, base: String, after: String): String? {
        val lines = playlist.lineSequence().map { it.trim() }.toList()
        val at = lines.indexOfFirst { it.startsWith(after) }.takeIf { it >= 0 } ?: return null
        val uri = lines.drop(at + 1).firstOrNull { it.isNotEmpty() && !it.startsWith("#") } ?: return null
        return base.toHttpUrlOrNull()?.resolve(uri)?.toString()
    }

    /** Media bytes the player can demux: MPEG-TS, fragmented MP4, ID3/ADTS audio. Images and pages are not. */
    internal fun segmentLooksPlayable(head: ByteArray, encrypted: Boolean): Boolean {
        if (head.isEmpty()) return false
        val text = String(head, 0, minOf(head.size, 64), Charsets.ISO_8859_1).trimStart()
        if (text.startsWith("<") || text.startsWith("{") || text.startsWith("[")) return false
        // A segment disguised as an image (PNG/JPEG/GIF wrapper) is refused by the player's demuxers.
        val png = head.size >= 4 && head[0] == 0x89.toByte() && head[1] == 'P'.code.toByte() && head[2] == 'N'.code.toByte()
        val jpeg = head.size >= 3 && head[0] == 0xFF.toByte() && head[1] == 0xD8.toByte() && head[2] == 0xFF.toByte()
        val gif = text.startsWith("GIF8")
        if (png || jpeg || gif) return false
        if (encrypted) return true // AES-128 ciphertext has no signature; reachable 2xx bytes are the evidence
        // As the player's TS extractor sniffs: a sync byte within the first packet, repeated one packet later.
        val ts = (0 until minOf(188, head.size)).any { i -> head[i] == 0x47.toByte() && (i + 188 >= head.size || head[i + 188] == 0x47.toByte()) }
        val box = head.size >= 8 && String(head, 4, 4, Charsets.ISO_8859_1) in setOf("ftyp", "styp", "moof", "sidx", "emsg", "prft", "moov")
        val id3 = text.startsWith("ID3")
        val adts = head.size >= 2 && head[0] == 0xFF.toByte() && (head[1].toInt() and 0xF0) == 0xF0
        return ts || box || id3 || adts
    }

    /**
     * Rejects only on evidence: a variant or segment that was fetched and is not playable. A playlist whose URIs
     * are absent from the prefix (or unparseable) keeps the previous verdict.
     */
    private inline fun hlsPlayable(c: Candidate, first: Inspected, get: (String, Long, Boolean) -> Hop?): Boolean {
        if (!isHls(first.prefix)) return true
        var playlist = first.prefix
        var base = first.url
        if (playlist.contains("#EXT-X-STREAM-INF")) {
            val variant = firstUri(playlist, base, "#EXT-X-STREAM-INF") ?: return true
            val hop = get(variant, MAX_PREFIX_BYTES, true) ?: return false
            if (!isHls(hop.text.orEmpty())) return false
            playlist = hop.text.orEmpty(); base = hop.url
        }
        val segment = firstUri(playlist, base, "#EXTINF") ?: return true
        val encrypted = Regex("#EXT-X-KEY:[^\\n]*METHOD=(?!NONE)").containsMatchIn(playlist)
        val hop = get(segment, SEGMENT_PREFIX_BYTES, false) ?: return false
        return segmentLooksPlayable(hop.bytes ?: ByteArray(0), encrypted)
    }

    private suspend fun hlsPlayableCancellable(client: OkHttpClient, c: Candidate, first: Inspected): Boolean {
        if (!isHls(first.prefix)) return true
        val hops = mutableMapOf<String, Hop?>()
        // Each hop is fetched cancellably first, then the shared walk reads the cached answers.
        var pending: Pair<String, Pair<Long, Boolean>>? = null
        while (true) {
            var missing: Pair<String, Pair<Long, Boolean>>? = null
            val verdict = hlsPlayable(c, first) { url, limit, playlist ->
                if (url in hops) hops[url] else { missing = url to (limit to playlist); null }
            }
            val need = missing ?: return verdict
            if (need == pending) return verdict // already fetched as unreachable
            pending = need
            val (url, spec) = need
            val first = fetchCancellable(client, follow(c, url, spec.first, range = true)) { ranged(it, spec.first, spec.second) }
            hops[url] = if (first !== RANGE_REFUSED) first
                else fetchCancellable(client, follow(c, url, spec.first, range = false)) { fetched(it, spec.first, spec.second) }
        }
    }

    private fun isHls(prefix: String): Boolean {
        val text = prefix.trimStart('\uFEFF', ' ', '\n', '\r', '\t')
        return text.startsWith("#EXTM3U") && (text.length == 7 || text[7] in "\r\n \t")
    }

    private suspend fun <T> fetchCancellable(client: OkHttpClient, request: Request, read: (Response) -> T?): T? =
        suspendCancellableCoroutine { continuation ->
            val call = client.newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            Dispatchers.IO.dispatch(continuation.context, Runnable {
                if (!continuation.isActive) return@Runnable
                // An unreachable hop is evidence (null), never a crash of the probe.
                val value = try { call.execute().use(read) } catch (_: Throwable) { null }
                if (continuation.isActive) continuation.resume(value)
            })
        }

    private suspend fun inspectCancellable(client: OkHttpClient, c: Candidate, range: Boolean): Inspected =
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
                        if (continuation.isActive) inspect(c, it, range) else Inspected(Result.REJECT, c.url, "")
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

    private fun inspect(c: Candidate, response: Response, range: Boolean): Inspected {
        val url = response.request.url.toString()
        if (range && response.code == 416) return Inspected(Result.RETRY_WITHOUT_RANGE, url, "")
        if (response.code !in 200..299) return Inspected(Result.REJECT, url, "")
        // peekBody caps even a server that ignores Range; use/close cancels the remaining body.
        val prefix = response.peekBody(MAX_PREFIX_BYTES).string()
        return Inspected(if (verdict(c.container, response.header("Content-Type"), prefix)) Result.ACCEPT else Result.REJECT, url, prefix)
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
