package com.vantara.anime.player

import okhttp3.OkHttpClient
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal class SkipRepository(private val client: OkHttpClient, private val directory: File, private val clock: () -> Long = System::currentTimeMillis, private val pause: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) }) {
    enum class Status { READY, NOT_FOUND, UNMATCHED, MISSING_ID, FAILED, SPECIAL }
    data class Result(val timings: IntroSkip.Timings = IntroSkip.Timings(), val status: Status, val cached: Boolean = false, val retryAfterMs: Long = 0)
    private val http = client.newBuilder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS).build()
    private data class Payload(val code: Int, val body: String = "", val retryAfterMs: Long = 0)
    private val json = Json

    suspend fun load(anilistId: Int?, malId: Int?, episode: Float, durationMs: Long, force: Boolean = false): Result = withContext(Dispatchers.IO) {
        if (!episode.isFinite() || episode <= 0 || episode % 1f != 0f) return@withContext Result(status = Status.SPECIAL)
        if (durationMs <= 0) return@withContext Result(status = Status.UNMATCHED)
        val knownId = malId?.takeIf { it > 0 }
        val resolvedId = knownId ?: anilistId?.takeIf { it > 0 }?.let { id ->
            val key = "mapping-$id"
            val cached = read(key)?.toIntOrNull()?.takeIf { it > 0 }
            if (cached != null) return@let cached
            val response = request("https://api.ani.zip/mappings?anilist_id=$id")
            if (response.code == 0 || response.code == 429 || response.code >= 500) return@withContext Result(status = Status.FAILED, retryAfterMs = response.retryAfterMs)
            val mapping = objectOf(response.body)?.get("mappings") as? JsonObject
            val matches = (mapping?.get("anilist_id") as? JsonPrimitive)?.intOrNull == id
            val value = (mapping?.get("mal_id") as? JsonPrimitive)?.intOrNull?.takeIf { matches && it > 0 }
            if (value != null) write(key, value.toString())
            value
        } ?: return@withContext Result(status = Status.MISSING_ID)
        val number = episode.toInt()
        val key = "timing-$resolvedId-$number-${durationMs / 1_000}"
        if (!force) read(key)?.let { body ->
            val timings = IntroSkip.parseTimings(body, durationMs)
            if (timings.opening != null || timings.ending != null) return@withContext Result(timings, Status.READY, cached = true)
        }
        var unmatched = false
        var failed = false
        for (version in listOf(2, 1)) {
            val types = if (version == 2) "op&types%5B%5D=ed&types%5B%5D=mixed-op&types%5B%5D=mixed-ed" else "op&types%5B%5D=ed"
            val length = if (version == 2) "episodeLength" else "episode_length"
            val response = request("https://api.aniskip.com/v$version/skip-times/$resolvedId/$number?types%5B%5D=$types&$length=${durationMs / 1000.0}")
            if (response.code == 429) return@withContext Result(status = Status.FAILED, retryAfterMs = response.retryAfterMs)
            if (response.code == 404) continue
            if (response.code !in 200..299) { failed = true; continue }
            val parsed = objectOf(response.body)
            if (parsed == null || (parsed["found"] as? JsonPrimitive)?.booleanOrNull == null) { failed = true; continue }
            if ((parsed["found"] as? JsonPrimitive)?.booleanOrNull != true) continue
            val timings = IntroSkip.parseTimings(response.body, durationMs)
            if (timings.opening != null || timings.ending != null) {
                write(key, response.body)
                return@withContext Result(timings, Status.READY)
            }
            unmatched = true
        }
        Result(status = when { unmatched -> Status.UNMATCHED; failed -> Status.FAILED; else -> Status.NOT_FOUND })
    }

    private suspend fun request(url: String): Payload {
        repeat(3) { attempt ->
            val payload = try {
                http.newCall(Request.Builder().url(url).header("Accept", "application/json").get().build()).awaitPayload()
            } catch (canceled: CancellationException) { throw canceled }
            catch (_: IOException) { Payload(0) }
            if (payload.code == 429 || payload.code in 1..499 || attempt == 2) return payload
            pause(500L * (attempt + 1))
        }
        return Payload(0)
    }

    private suspend fun Call.awaitPayload(): Payload = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) {
                try {
                    val payload = response.use { r ->
                        val retry = if (r.code == 429) com.vantara.anime.net.RateGate.parseRetryAfter(r.header("Retry-After"), clock()) else 0L
                        val body = r.peekBody(MAX_RESPONSE.toLong() + 1).string()
                        if (body.length > MAX_RESPONSE) Payload(0) else Payload(r.code, body, retry)
                    }
                    if (continuation.isActive) continuation.resume(payload)
                } catch (e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }
            }
        })
    }

    private fun objectOf(body: String): JsonObject? = runCatching { json.parseToJsonElement(body) as? JsonObject }.getOrNull()

    private fun read(key: String): String? = runCatching {
        val file = File(directory, "$key.json")
        if (!file.exists() || file.length() > MAX_BODY + 1_000) return null
        val data = objectOf(file.readText()) ?: return null
        val savedAt = (data["at"] as? JsonPrimitive)?.longOrNull ?: return null
        if (clock() - savedAt !in 0..CACHE_TTL_MS) return null
        (data["body"] as? JsonPrimitive)?.content
    }.getOrNull()

    private fun write(key: String, body: String) {
        runCatching {
            directory.mkdirs()
            val file = File(directory, "$key.json")
            val temporary = File.createTempFile("$key-", ".tmp", directory)
            try {
                temporary.writeText(buildJsonObject { put("at", clock()); put("body", body) }.toString())
                temporary.renameTo(file)
            } finally { temporary.delete() }
            directory.listFiles()?.filter { it.extension == "json" }?.sortedByDescending { it.lastModified() }?.drop(128)?.forEach { it.delete() }
        }
    }

    companion object {
        private const val MAX_BODY = 64 * 1024
        private const val MAX_RESPONSE = 4 * 1024 * 1024
        private const val CACHE_TTL_MS = 7 * 24 * 60 * 60_000L
    }
}
