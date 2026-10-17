package com.vantara.addons

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
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
    fun videoId(raw: String?, episode: Float, preferImdb: Boolean = false): Pair<String, String>? =
        videoIds(raw, episode).firstOrNull { !preferImdb || !it.second.startsWith("kitsu:") }

    /**
     * عناوين حلقة الأنمي في IMDb من خريطة ani.zip التي تحملها الهوية (imdbEpisodes: رقمنا ← [الموسم، رقمها فيه، المطلق]):
     * موسم TVDB أولًا ثم الترقيم المطلق في الموسم 1 (OpenSubtitles يفهرس One Piece هكذا). حلقة لم تصل الخريطة بعد
     * تكمل من آخر حلقة معروفة قبلها (حتى 30). نفس قاعدة animeImdbAddresses في الويب.
     */
    fun animeImdbAddresses(map: JsonObject?, episode: Int): List<Pair<Int, Int>> {
        if (map == null || episode < 1) return emptyList()
        fun entry(k: Int): List<Int?>? = runCatching {
            val a = map[k.toString()]?.jsonArray ?: return@runCatching null
            val s = a[0].jsonPrimitive.intOrNull; val e = a[1].jsonPrimitive.intOrNull
            if (s == null || s < 0 || e == null || e < 1) null else listOf(s, e, a.getOrNull(2)?.jsonPrimitive?.intOrNull)
        }.getOrNull()
        var hit = entry(episode)
        if (hit == null) {
            val k = map.keys.mapNotNull { it.toIntOrNull() }.filter { it in 1 until episode && entry(it) != null }.maxOrNull()
            if (k != null && episode - k <= 30) { val (s, e, a) = entry(k)!!; hit = listOf(s, e!! + episode - k, a?.let { it + episode - k }) }
        }
        val (season, number, absolute) = hit ?: return emptyList()
        return listOfNotNull(season!! to number!!, absolute?.takeIf { it > 0 && !(season == 1 && number == it) }?.let { 1 to it })
    }

    /** كل المعرّفات الممكنة بالترتيب: Kitsu لإضافات تعرفه، ثم IMDb كما في المسلسلات. */
    fun videoIds(raw: String?, episode: Float): List<Pair<String, String>> = runCatching {
        val context = json.parseToJsonElement(raw ?: "{}").jsonObject
        val externalIds = context["externalIds"]?.jsonObject
        val kind = context["kind"]?.jsonPrimitive?.contentOrNull
        val movie = kind == "movie" || kind == "anime" && context["format"]?.jsonPrimitive?.contentOrNull == "MOVIE"
        val whole = episode >= 1 && episode.toInt().toFloat() == episode
        val out = mutableListOf<Pair<String, String>>()
        val kitsu = externalIds?.get("kitsu")?.jsonPrimitive?.contentOrNull?.takeIf { Regex("[0-9]+").matches(it) && it.toLongOrNull()?.let { n -> n > 0 } == true }
        if (kind == "anime" && kitsu != null) {
            if (movie) out += "movie" to "kitsu:$kitsu" else if (whole) out += "series" to "kitsu:$kitsu:${episode.toInt()}"
        }
        val imdb = externalIds?.get("imdb")?.jsonPrimitive?.contentOrNull?.takeIf { Regex("tt\\d+").matches(it) } ?: return@runCatching out
        if (movie) return@runCatching out + ("movie" to imdb)
        if (kind !in listOf("series", "anime") || !whole) return@runCatching out
        val mapped = if (kind == "anime") animeImdbAddresses(context["imdbEpisodes"] as? JsonObject, episode.toInt()) else emptyList()
        val season = context["season"]?.jsonPrimitive?.intOrNull
        val addresses = mapped.ifEmpty { if (season != null && season >= 0) listOf(season to episode.toInt()) else emptyList() }
        out + addresses.map { (s, e) -> "series" to "$imdb:$s:$e" }
    }.getOrDefault(emptyList())

    fun discover(client: RemoteAddonClient, provider: AddonSubtitleProvider, context: String?, episode: Float, requestId: String, stream: com.vantara.anime.stream.Candidate? = null): List<AddonSubtitle> {
        // معرّف يرجع فارغًا أو يفشل لا ينهي البحث: نجرّب التالي (Kitsu ← IMDb بموسم TVDB ← المطلق)
        val accepted = videoIds(context, episode).filter { (type, id) ->
            (provider.types.isEmpty() || type in provider.types) && (provider.idPrefixes.isEmpty() || provider.idPrefixes.any { id.startsWith(it) })
        }.take(3)
        var failure: Throwable? = null
        var answered = false
        for ((type, id) in accepted) {
            val found = runCatching { discoverOne(client, provider, type, id, requestId, stream) }
            val tracks = found.getOrNull()
            if (tracks == null) { failure = found.exceptionOrNull(); continue }
            if (tracks.isNotEmpty()) return tracks
            answered = true
        }
        if (!answered) failure?.let { throw it }
        return emptyList()
    }

    private fun discoverOne(client: RemoteAddonClient, provider: AddonSubtitleProvider, type: String, id: String, requestId: String, stream: com.vantara.anime.stream.Candidate?): List<AddonSubtitle> {
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
