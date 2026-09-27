package com.vantara.anime.player

import okhttp3.OkHttpClient
import okhttp3.Request
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.TimeUnit

/** AniSkip timings are tied to the MAL title, episode and actual video duration. */
internal object IntroSkip {
    data class Interval(val startMs: Long, val endMs: Long)

    fun parse(body: String, durationMs: Long): Interval? {
        if (durationMs <= 0) return null
        val result = runCatching { Json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
        if (result["found"]?.jsonPrimitive?.booleanOrNull != true) return null
        val rows = result["results"]?.let { runCatching { it.jsonArray }.getOrNull() } ?: return null
        for (element in rows) {
            val row = runCatching { element.jsonObject }.getOrNull() ?: continue
            if (row["skipType"]?.jsonPrimitive?.content !in setOf("op", "mixed-op")) continue
            val length = row["episodeLength"]?.jsonPrimitive?.doubleOrNull ?: Double.NaN
            if (length.isFinite() && kotlin.math.abs(length * 1000 - durationMs) > durationMs * 0.01) continue
            val interval = row["interval"]?.let { runCatching { it.jsonObject }.getOrNull() } ?: continue
            val start = interval["startTime"]?.jsonPrimitive?.doubleOrNull ?: Double.NaN
            val end = interval["endTime"]?.jsonPrimitive?.doubleOrNull ?: Double.NaN
            if (!start.isFinite() || !end.isFinite()) continue
            val from = (start * 1000).toLong()
            val to = (end * 1000).toLong()
            if (from < 0 || from > durationMs / 2 || to - from !in 10_000L..240_000L || to > durationMs) continue
            return Interval(from, to)
        }
        return null
    }

    fun fetch(client: OkHttpClient, malId: Int, episode: Int, durationMs: Long): Interval? {
        if (malId <= 0 || episode <= 0 || durationMs <= 0) return null
        val url = "https://api.aniskip.com/v1/skip-times/$malId/$episode" +
            "?types%5B%5D=op&types%5B%5D=mixed-op&episodeLength=${durationMs / 1000.0}"
        val request = Request.Builder().url(url).get().build()
        return runCatching {
            client.newBuilder().callTimeout(5, TimeUnit.SECONDS).build().newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                parse(response.body?.string().orEmpty(), durationMs)
            }
        }.getOrNull()
    }

    fun visible(interval: Interval?, positionMs: Long): Boolean =
        interval != null && positionMs >= interval.startMs && positionMs < interval.endMs - 1000
}
