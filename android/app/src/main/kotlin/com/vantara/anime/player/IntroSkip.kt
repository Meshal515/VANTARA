package com.vantara.anime.player

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** AniSkip timings are tied to the MAL title, episode and actual video duration. */
internal object IntroSkip {
    data class Interval(val startMs: Long, val endMs: Long)

    fun parse(body: String, durationMs: Long): Interval? {
        if (durationMs <= 0) return null
        val result = runCatching { JSONObject(body) }.getOrNull() ?: return null
        if (!result.optBoolean("found")) return null
        val rows = result.optJSONArray("results") ?: return null
        for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optString("skipType") !in setOf("op", "mixed-op")) continue
            val length = row.optDouble("episodeLength", Double.NaN)
            if (length.isFinite() && kotlin.math.abs(length * 1000 - durationMs) > durationMs * 0.08) continue
            val interval = row.optJSONObject("interval") ?: continue
            val start = interval.optDouble("startTime", Double.NaN)
            val end = interval.optDouble("endTime", Double.NaN)
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
