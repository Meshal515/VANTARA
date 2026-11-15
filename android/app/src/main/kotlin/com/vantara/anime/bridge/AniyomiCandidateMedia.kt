package com.vantara.anime.bridge

import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.MediaEvidenceProbe
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import okhttp3.Call
import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Same extension client/cookies/headers; bounded reads and physical cancellation on timeout. */
internal suspend fun verifyAniyomiCandidateMedia(client: OkHttpClient, candidates: List<Candidate>) = coroutineScope {
    val calls = mutableSetOf<Call>()
    var closed = false
    val bounded = client.newBuilder().callTimeout(10, TimeUnit.SECONDS).build()
    val probe = async(Dispatchers.IO) {
        try {
        MediaEvidenceProbe { url, headers ->
            val call = bounded.newCall(Request.Builder().url(url).headers(headers).build())
            synchronized(calls) {
                check(!closed) { "CANDIDATE_MEDIA_CANCELLED" }
                calls.add(call)
            }
            try {
                call.execute().use { response ->
                    MediaEvidenceProbe.Response(response.request.url.toString(), response.code, response.headers,
                        response.peekBody(MediaEvidenceProbe.MAX_PROBE_BYTES.toLong()).bytes())
                }
            } finally { synchronized(calls) { calls.remove(call) } }
        }.requirePlayable(candidates.take(3).map { candidate ->
            MediaEvidenceProbe.Link(candidate.url, Headers.Builder().apply {
                candidate.headers.forEach { (key, value) -> add(key, value) }
            }.build())
        })
        } catch (failure: Exception) {
            // A cancelled socket read throws IOException; never let format wrapping
            // replace the caller's cancellation with a provider failure.
            currentCoroutineContext().ensureActive()
            throw failure
        }
    }
    try { probe.await() } finally {
        synchronized(calls) { closed = true; calls.forEach { it.cancel() }; calls.clear() }
    }
}
