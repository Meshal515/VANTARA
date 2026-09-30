package com.vantara.anime.player

import okhttp3.OkHttpClient
import okhttp3.Request
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.concurrent.TimeUnit

/** Opening and ending timings must match the MAL episode and this video cut. */
internal object IntroSkip {
    data class Interval(val startMs: Long, val endMs: Long)
    data class Timings(val opening: Interval? = null, val ending: Interval? = null)
    data class Segment(val opening: Boolean, val interval: Interval)

    fun parse(body: String, durationMs: Long): Interval? = parseTimings(body, durationMs).opening

    fun parseTimings(body: String, durationMs: Long): Timings {
        if (durationMs <= 0) return Timings()
        val result = runCatching { Json.parseToJsonElement(body) as? JsonObject }.getOrNull() ?: return Timings()
        if ((result["found"] as? JsonPrimitive)?.booleanOrNull != true) return Timings()
        val rows = result["results"] as? JsonArray ?: return Timings()
        var opening: Interval? = null
        var ending: Interval? = null
        val duration = durationMs / 1000.0
        for (element in rows) {
            val row = element as? JsonObject ?: continue
            val type = (row["skipType"] as? JsonPrimitive)?.content ?: continue
            val isOpening = type in setOf("op", "mixed-op")
            if (!isOpening && type !in setOf("ed", "mixed-ed")) continue
            val length = (row["episodeLength"] as? JsonPrimitive)?.doubleOrNull ?: continue
            if (!length.isFinite() || length <= 0 || kotlin.math.abs(length - duration) > duration * 0.01) continue
            val interval = row["interval"] as? JsonObject ?: continue
            val start = (interval["startTime"] as? JsonPrimitive)?.doubleOrNull ?: continue
            val end = (interval["endTime"] as? JsonPrimitive)?.doubleOrNull ?: continue
            if (!start.isFinite() || !end.isFinite() || start < 0 || end > duration || end - start !in 10.0..240.0) continue
            if (isOpening && start > duration / 2 || !isOpening && start < duration / 2) continue
            val timing = Interval((start * 1000).toLong(), (end * 1000).toLong().coerceAtMost(durationMs))
            if (isOpening && opening == null) opening = timing
            if (!isOpening && ending == null) ending = timing
        }
        if (opening != null && ending != null && opening.endMs > ending.startMs) ending = null
        return Timings(opening, ending)
    }

    fun fetch(client: OkHttpClient, malId: Int, episode: Int, durationMs: Long): Interval? =
        fetchTimings(client, malId, episode, durationMs).opening

    fun fetchTimings(client: OkHttpClient, malId: Int, episode: Int, durationMs: Long): Timings {
        if (malId <= 0 || episode <= 0 || durationMs <= 0) return Timings()
        val url = "https://api.aniskip.com/v2/skip-times/$malId/$episode" +
            "?types%5B%5D=op&types%5B%5D=mixed-op&types%5B%5D=ed&types%5B%5D=mixed-ed&episodeLength=${durationMs / 1000.0}"
        val request = Request.Builder().url(url).get().build()
        return runCatching {
            client.newBuilder().callTimeout(5, TimeUnit.SECONDS).build().newCall(request).execute().use { response ->
                if (!response.isSuccessful) return Timings()
                parseTimings(response.body.string(), durationMs)
            }
        }.getOrDefault(Timings())
    }

    fun visible(interval: Interval?, positionMs: Long): Boolean =
        interval != null && positionMs >= interval.startMs && positionMs < interval.endMs - 1000

    fun active(timings: Timings, positionMs: Long): Segment? = when {
        visible(timings.opening, positionMs) -> Segment(true, requireNotNull(timings.opening))
        visible(timings.ending, positionMs) -> Segment(false, requireNotNull(timings.ending))
        else -> null
    }
}
