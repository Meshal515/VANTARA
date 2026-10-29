package com.vantara.runtime

import com.vantara.anime.adapters.*
import com.vantara.anime.stream.Candidate
import com.vantara.addons.NativeAddonCandidates
import kotlinx.serialization.json.*

/** Only maps public results to existing VANTARA contracts; it never extracts source HTML. */
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
    override suspend fun details(anime: SourceAnime): SourceAnime {
        require(anime.sourceId==id)
        return work(execute("details",input("url" to JsonPrimitive(anime.url))).getValue("item").jsonObject,anime)
    }
    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> {
        require(anime.sourceId==id)
        val items=execute("episodes",input("url" to JsonPrimitive(anime.url))).getValue("items").jsonArray
        return items.mapNotNull { it.jsonObject["season"]?.jsonPrimitive?.intOrNull }.distinct().sorted().map { season ->
            anime.copy(title="${anime.title} · الموسم $season",hasSeasons=false,seasonNumber=season.toDouble(),requestedSeason=season)
        }
    }
    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        require(anime.sourceId==id)
        val result=execute("episodes",input("url" to JsonPrimitive(anime.url))).getValue("items").jsonArray
        val rows=result.map { it.jsonObject }
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
                put("url",link.text("url"));put("name",link.text("name"));put("title",link.text("name"))
                put("quality",link["quality"] ?: JsonNull);put("headers",JsonObject(headers))
                put("type",when(link.text("type")) { "M3U8"->"hls";"DASH"->"dash";else->"direct" })
            }
        })
        // Reuses existing direct-media validation and public DNS policy. No torrent/subtitle changes.
        return NativeAddonCandidates.parse("cs3-${now}",id,name,streams,now)
    }
}
