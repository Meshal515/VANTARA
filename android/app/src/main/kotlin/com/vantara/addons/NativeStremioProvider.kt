package com.vantara.addons

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.net.URLEncoder

@Serializable
data class NativeAddonEpisode(val number: Float, val id: String, val season: Int? = null)

/** Immutable source context; a new episode requires an external identity or explicit provider ID. */
@Serializable
data class NativeStremioProvider(
    val sourceId: String, val name: String, val manifestUrl: String, val type: String, val videoId: String,
    val season: Int? = null, val episodes: List<NativeAddonEpisode> = emptyList(),
) {
    fun valid(): Boolean = sourceId.startsWith("addon|") && sourceId.length <= 4096 &&
        type.matches(Regex("[a-zA-Z][a-zA-Z0-9_-]{0,63}")) && videoId.length in 1..512 && episodes.size <= 10000 &&
        runCatching { RemoteAddonClient.publicUrl(manifestUrl).encodedPath.endsWith("/manifest.json") }.getOrDefault(false)

    fun idAt(number: Float): String? {
        if (!valid()) return null
        if (type == "movie") return videoId.takeIf { number < 0 }
        if (number < 1 || number.toInt().toFloat() != number) return null
        val kitsu = Regex("kitsu:([0-9]+):([0-9]+)").matchEntire(videoId)
        if (type == "series" && kitsu != null) return "kitsu:${kitsu.groupValues[1]}:${number.toInt()}"
        val match = Regex("(tt[0-9]+):([0-9]+):([0-9]+)").matchEntire(videoId)
        val currentSeason = season ?: match?.groupValues?.get(2)?.toIntOrNull()
        // Explicit private/catalog episode IDs take precedence and are scoped to the season.
        episodes.firstOrNull { it.number == number && (it.season == null || it.season == currentSeason) }
            ?.id?.takeIf { it.length in 1..512 }?.let { return it }
        return if (type == "series" && match != null) "${match.groupValues[1]}:${match.groupValues[2]}:${number.toInt()}" else null
    }
    fun endpoint(number: Float): String? {
        val id = idAt(number) ?: return null
        val base = RemoteAddonClient.publicUrl(manifestUrl)
        val path = base.encodedPath.removeSuffix("/manifest.json") + "/stream/" + URLEncoder.encode(type, "UTF-8").replace("+", "%20") + "/" + URLEncoder.encode(id, "UTF-8").replace("+", "%20") + ".json"
        return base.newBuilder().encodedPath(path).build().toString()
    }
    fun streams(client: RemoteAddonClient, number: Float, requestId: String): JsonArray {
        val target = endpoint(number) ?: return JsonArray(emptyList())
        val response = Json.parseToJsonElement(client.request(target, requestId, timeoutMs = 45_000)) as? JsonObject ?: return JsonArray(emptyList())
        if (response["error"] != null) return JsonArray(emptyList())
        return response["streams"] as? JsonArray ?: JsonArray(emptyList())
    }
}
