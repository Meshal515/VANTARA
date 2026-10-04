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
    fun videoId(raw: String?, episode: Float): Pair<String, String>? = runCatching {
        val context = json.parseToJsonElement(raw ?: "{}").jsonObject
        val imdb = context["externalIds"]?.jsonObject?.get("imdb")?.jsonPrimitive?.contentOrNull ?: return null
        if (!Regex("tt\\d+").matches(imdb)) return null
        val type = if (context["kind"]?.jsonPrimitive?.contentOrNull == "movie") "movie" else if (context["kind"]?.jsonPrimitive?.contentOrNull in listOf("series", "anime")) "series" else return null
        if (type == "movie") return type to imdb
        val season = context["season"]?.jsonPrimitive?.intOrNull ?: return null
        if (season < 0 || episode < 1 || episode.toInt().toFloat() != episode) return null
        type to "$imdb:$season:${episode.toInt()}"
    }.getOrNull()
    fun discover(client: RemoteAddonClient, provider: AddonSubtitleProvider, context: String?, episode: Float, requestId: String): List<AddonSubtitle> {
        val (type, id) = videoId(context, episode) ?: return emptyList()
        if (provider.types.isNotEmpty() && type !in provider.types || provider.idPrefixes.isNotEmpty() && provider.idPrefixes.none { id.startsWith(it) }) return emptyList()
        val base = RemoteAddonClient.publicUrl(provider.manifestUrl)
        require(base.encodedPath.endsWith("/manifest.json"))
        val path = base.encodedPath.removeSuffix("/manifest.json") + "/subtitles/$type/" + java.net.URLEncoder.encode(id, "UTF-8") + ".json"
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
