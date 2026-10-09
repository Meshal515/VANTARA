package com.vantara.addons

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.contentOrNull

@Serializable
data class AddonSubtitleProvider(val key: String, val name: String, val manifestUrl: String, val types: List<String> = emptyList(), val idPrefixes: List<String> = emptyList())
data class AddonSubtitle(val id: String, val provider: String, val lang: String, val url: String)

object SubtitleProviders {
    private val json = Json { ignoreUnknownKeys = true }
    fun providers(raw: String?): List<AddonSubtitleProvider> = runCatching { json.decodeFromString<List<AddonSubtitleProvider>>(raw ?: "[]").take(100) }.getOrDefault(emptyList())
    fun videoId(raw: String?, episode: Float, preferImdb: Boolean = false): Pair<String, String>? = runCatching {
        val context = json.parseToJsonElement(raw ?: "{}").jsonObject
        val externalIds = context["externalIds"]?.jsonObject
        val kind = context["kind"]?.jsonPrimitive?.contentOrNull
        val kitsu = if (preferImdb) null else externalIds?.get("kitsu")?.jsonPrimitive?.contentOrNull
        if (kind == "anime" && context["format"]?.jsonPrimitive?.contentOrNull == "MOVIE" && kitsu != null && Regex("[0-9]+").matches(kitsu) && kitsu.toLongOrNull()?.let { it > 0 } == true) return "movie" to "kitsu:$kitsu"
        if (kind == "anime" && kitsu != null && Regex("[0-9]+").matches(kitsu) && kitsu.toLongOrNull()?.let { it > 0 } == true && episode >= 1 && episode.toInt().toFloat() == episode) {
            return "series" to "kitsu:$kitsu:${episode.toInt()}"
        }
        val imdb = externalIds?.get("imdb")?.jsonPrimitive?.contentOrNull ?: return null
        if (!Regex("tt\\d+").matches(imdb)) return null
        val type = if (kind == "movie" || kind == "anime" && context["format"]?.jsonPrimitive?.contentOrNull == "MOVIE") "movie" else if (context["kind"]?.jsonPrimitive?.contentOrNull in listOf("series", "anime")) "series" else return null
        if (type == "movie") return type to imdb
        val season = context["season"]?.jsonPrimitive?.intOrNull ?: return null
        if (season < 0 || episode < 1 || episode.toInt().toFloat() != episode) return null
        type to "$imdb:$season:${episode.toInt()}"
    }.getOrNull()
    fun discover(client: RemoteAddonClient, provider: AddonSubtitleProvider, context: String?, episode: Float, requestId: String, stream: com.vantara.anime.stream.Candidate? = null): List<AddonSubtitle> {
        val (type, id) = listOfNotNull(videoId(context, episode), videoId(context, episode, preferImdb = true)).firstOrNull { (type, id) ->
            (provider.types.isEmpty() || type in provider.types) && (provider.idPrefixes.isEmpty() || provider.idPrefixes.any { id.startsWith(it) })
        } ?: return emptyList()
        val base = RemoteAddonClient.publicUrl(provider.manifestUrl)
        require(base.encodedPath.endsWith("/manifest.json"))
        val extras = listOfNotNull(
            stream?.filename?.let { "filename" to it },
            stream?.videoHash?.let { "videoHash" to it },
            stream?.videoSize?.let { "videoSize" to it.toString() },
        ).joinToString("&") { (key, value) -> "$key=${java.net.URLEncoder.encode(value, "UTF-8")}" }
        val path = base.encodedPath.removeSuffix("/manifest.json") + "/subtitles/$type/" + java.net.URLEncoder.encode(id, "UTF-8") +
            (if (extras.isEmpty()) "" else "/$extras") + ".json"
        val endpoint = base.newBuilder().encodedPath(path).build()
        val raw = json.parseToJsonElement(client.request(endpoint.toString(), requestId)).jsonObject["subtitles"]?.jsonArray ?: return emptyList()
        require(raw.size <= 1000)
        return raw.mapIndexedNotNull { i, element -> runCatching {
            val obj = element.jsonObject
            val url = RemoteAddonClient.publicUrl(obj.getValue("url").jsonPrimitive.content).toString()
            val lang = obj["lang"]?.jsonPrimitive?.contentOrNull ?: "und"
            AddonSubtitle("${provider.key}|$i", provider.name, if (lang == "ara") "ar" else if (lang == "eng") "en" else lang, url)
        }.getOrNull() }.sortedBy { if (it.lang == "ar") 0 else 1 }
    }
}
