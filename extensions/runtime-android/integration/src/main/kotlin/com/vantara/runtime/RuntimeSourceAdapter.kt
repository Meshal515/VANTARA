package com.vantara.runtime

import com.vantara.anime.adapters.*
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.addons.NativeAddonCandidates
import kotlinx.serialization.json.*

/** Only maps public results to existing VANTARA contracts; it never extracts source HTML. */
/** CloudStream's INFERRED links name no type; the URL decides, as in the original player. */
internal fun mediaType(declared:String,url:String):String = when(declared) {
    "M3U8"->"hls"
    "DASH"->"dash"
    "VIDEO"->"direct"
    else -> {
        val path=runCatching{java.net.URI(url).path.orEmpty().lowercase()}.getOrDefault("")
        when { path.endsWith(".m3u8")||path.contains(".m3u8")->"hls"; path.endsWith(".mpd")->"dash"; else->"direct" }
    }
}
class RuntimeSourceAdapter(
    override val id: String,
    override val name: String,
    private val execute: suspend (String,JsonObject)->JsonObject,
) : AnimeAdapter {
    private fun input(vararg rows: Pair<String,JsonElement>)=JsonObject(mapOf(*rows))
    private fun work(item: JsonObject,previous: SourceAnime?=null): SourceAnime {
        val url=item.text("url").ifBlank { previous?.url.orEmpty() }
        val title=item.text("name").ifBlank { previous?.title.orEmpty() }
        require(url.isNotBlank() && title.isNotBlank()) { "INVALID_WORK_RESULT" }
        val episodes=item["episodes"]
        val list=when(episodes) { is JsonArray -> episodes;is JsonObject -> JsonArray(episodes.values.flatMap { (it as? JsonArray).orEmpty() });else -> JsonArray(emptyList()) }
        val seasons=list.mapNotNull { (it as? JsonObject)?.get("season")?.jsonPrimitive?.intOrNull }.distinct()
        return SourceAnime(id,url,title,item.text("posterUrl").ifBlank { previous?.thumbnail },
            item.text("plot").ifBlank { previous?.description },
            (item["tags"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: previous?.genres.orEmpty(),
            when(item.text("showStatus")) { "Ongoing" -> 1;"Completed" -> 2;else -> previous?.status ?: 0 },
            hasSeasons=seasons.size>1 && previous?.requestedSeason==null && (previous?.seasonNumber ?: -1.0)<0,
            seasonNumber=previous?.seasonNumber ?: -1.0,requestedSeason=previous?.requestedSeason)
    }
    override suspend fun page(listing: Listing,page: Int,query: String): SourcePage {
        require(page>0)
        val result=if(listing==Listing.SEARCH) execute("search",input("query" to JsonPrimitive(query),"page" to JsonPrimitive(page)))
            else execute("catalogue",input("page" to JsonPrimitive(page)))
        val items=result["items"] as? JsonArray ?: error("INVALID_CATALOGUE_RESULT")
        val flat=if(listing==Listing.SEARCH)items else JsonArray(items.flatMap { (it.jsonObject["list"] as? JsonArray) ?: error("INVALID_CATALOGUE_SECTION") })
        return SourcePage(flat.map { work(it.jsonObject) }.distinctBy { it.url },result["hasNext"]?.jsonPrimitive?.booleanOrNull ?: false)
    }
    /**
     * CloudStream's load() answers details AND episodes at once; CloudStream itself calls it once per work.
     * The "episodes" operation repeats load(): another isolated worker and another page fetch. A details
     * answer from the last two minutes serves the same rows (the worker flattens them identically).
     */
    private val recent=object:LinkedHashMap<String,Pair<Long,JsonArray>>(16,0.75f,true) {
        override fun removeEldestEntry(eldest:MutableMap.MutableEntry<String,Pair<Long,JsonArray>>?)=size>32
    }
    private fun rowsOf(item: JsonObject): JsonArray? = when(val episodes=item["episodes"]) {
        is JsonArray -> episodes
        is JsonObject -> JsonArray(episodes.values.flatMap { (it as? JsonArray).orEmpty() })
        // A movie or live channel: one playable item whose data is loadLinks' input, as the worker builds it.
        else -> item.text("dataUrl").takeIf { it.isNotBlank() }?.let { JsonArray(listOf(buildJsonObject { put("data",it);put("name",item.text("name")) })) }
    }
    private suspend fun episodeRows(url: String): JsonArray {
        synchronized(recent) { recent[url]?.takeIf { System.currentTimeMillis()-it.first<RECENT_MS }?.let { return it.second } }
        return execute("episodes",input("url" to JsonPrimitive(url))).getValue("items").jsonArray
    }
    override suspend fun details(anime: SourceAnime): SourceAnime {
        require(anime.sourceId==id)
        val item=execute("details",input("url" to JsonPrimitive(anime.url))).getValue("item").jsonObject
        rowsOf(item)?.let { rows -> synchronized(recent) { recent[anime.url]=System.currentTimeMillis() to rows } }
        return work(item,anime)
    }
    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> {
        require(anime.sourceId==id)
        val items=episodeRows(anime.url)
        return items.mapNotNull { it.jsonObject["season"]?.jsonPrimitive?.intOrNull }.distinct().sorted().map { season ->
            anime.copy(title="${anime.title} · الموسم $season",hasSeasons=false,seasonNumber=season.toDouble(),requestedSeason=season)
        }
    }
    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        require(anime.sourceId==id)
        val rows=episodeRows(anime.url).map { it.jsonObject }
        val wanted=anime.requestedSeason ?: anime.seasonNumber.takeIf { it>=0 }?.toInt()
        require(wanted!=null || rows.mapNotNull { it["season"]?.jsonPrimitive?.intOrNull }.distinct().size<=1) { "SEASON_SELECTION_REQUIRED" }
        return rows.filter { wanted==null || it["season"]?.jsonPrimitive?.intOrNull==wanted }.map { row ->
            val data=row.text("data");require(data.isNotBlank()) { "INVALID_EPISODE_DATA" }
            val number=row["episode"]?.jsonPrimitive?.floatOrNull?.takeIf { it.isFinite() && it>=0 }
                ?: Regex("(?:الحلقة|episode|ep)\\s*[:#-]?\\s*(\\d+(?:\\.\\d+)?)",RegexOption.IGNORE_CASE).find(row.text("name"))?.groupValues?.get(1)?.toFloatOrNull()
                ?: -1f // Unknown stays unknown. List position is never an episode number.
            SourceEpisode(id,data,row.text("name").ifBlank { if(number>=0) "الحلقة $number" else "حلقة دون رقم" },number,preview=row.text("posterUrl").ifBlank { null })
        }.distinctBy { it.url }
    }
    override suspend fun candidates(episode: SourceEpisode,now: Long,trace: ResolveTrace?,enough: Int): List<Candidate> {
        require(episode.sourceId==id)
        val links=execute("videoLinks",input("data" to JsonPrimitive(episode.url))).getValue("items").jsonArray
        val streams=JsonArray(links.map { raw ->
            val link=raw.jsonObject
            val headers=(link["headers"] as? JsonObject).orEmpty().toMutableMap()
            if(link.text("referer").isNotBlank())headers.putIfAbsent("Referer",JsonPrimitive(link.text("referer")))
            buildJsonObject {
                put("url",runCatching { runtimeMediaUrl(link.text("url")) }.getOrDefault(link.text("url")));put("name",link.text("name"));put("title",link.text("name"))
                put("quality",link["quality"] ?: JsonNull);put("headers",JsonObject(headers))
                put("type",mediaType(link.text("type"),link.text("url")))
            }
        })
        // Reuses existing direct-media validation and public DNS policy. No torrent/subtitle changes.
        val candidates=NativeAddonCandidates.parse("cs3-${now}",id,name,streams,now)
        // Native preparation schedules media probes from route reports. Returning
        // a list alone only adopts the links, leaving probe-gated sessions unusable.
        candidates.groupBy { it.server }.forEach { (server,links) ->
            trace?.route(RouteReport(id,"x"+Integer.toHexString(server.hashCode()),server,
                links.mapNotNull { it.quality }.maxOrNull(),links.first().variant,RouteState.READY,links))
        }
        return candidates
    }
    private companion object { const val RECENT_MS=120_000L }
}
