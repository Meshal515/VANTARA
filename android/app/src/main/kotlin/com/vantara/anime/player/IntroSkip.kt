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
import kotlin.math.abs
import kotlin.math.min

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
        val duration = durationMs / 1000.0
        data class Match(val opening: Boolean, val mixed: Boolean, val difference: Double, val interval: Interval)
        val matches = mutableListOf<Match>()
        for (element in rows) {
            val row = element as? JsonObject ?: continue
            val type = ((row["skipType"] ?: row["skip_type"]) as? JsonPrimitive)?.content ?: continue
            val isOpening = type in setOf("op", "mixed-op")
            if (!isOpening && type !in setOf("ed", "mixed-ed")) continue
            val length = ((row["episodeLength"] ?: row["episode_length"]) as? JsonPrimitive)?.doubleOrNull ?: continue
            // AniSkip filters by a 20-second cut difference. Bound shorter episodes too.
            if (!length.isFinite() || length <= 0 || abs(length - duration) > min(20.0, duration * 0.025)) continue
            val interval = row["interval"] as? JsonObject ?: continue
            val start = ((interval["startTime"] ?: interval["start_time"]) as? JsonPrimitive)?.doubleOrNull ?: continue
            val end = ((interval["endTime"] ?: interval["end_time"]) as? JsonPrimitive)?.doubleOrNull ?: continue
            if (!start.isFinite() || !end.isFinite() || start < 0 || end > length || end - start !in 10.0..240.0) continue
            // Same correction used by AniSkip's player: align the reference cut to this cut.
            val offset = duration - length
            val timing = Interval(((start + offset) * 1000).toLong().coerceAtLeast(0), ((end + offset) * 1000).toLong().coerceAtMost(durationMs))
            if (timing.endMs - timing.startMs < 10_000 || timing.startMs >= durationMs) continue
            if (isOpening && timing.startMs > durationMs / 2 || !isOpening && timing.startMs < durationMs / 2) continue
            matches += Match(isOpening, type.startsWith("mixed-"), abs(offset), timing)
        }
        val sorted = matches.sortedWith(compareBy<Match> { it.difference }.thenBy { it.mixed })
        val opening = sorted.firstOrNull { it.opening }?.interval
        var ending = sorted.firstOrNull { !it.opening }?.interval
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
