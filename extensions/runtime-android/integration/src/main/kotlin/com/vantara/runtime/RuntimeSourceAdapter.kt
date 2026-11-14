package com.vantara.runtime

import com.vantara.anime.adapters.*
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.addons.NativeAddonCandidates
import kotlinx.serialization.json.*
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.sync.withPermit

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
    /**
     * The browser User-Agent the provider's own requests carried. CloudStream's player sends one with every link;
     * VANTARA's sent OkHttp's default when the link named none, and hosts such as mixdrop answered 403 to the very
     * URL that played with a browser agent (source certification round 17).
     */
    private val userAgent: String? = null,
    /**
     * VANTARA's own embed resolver (named extractors, the generic player reader, the hidden WebView): it resolves
     * the servers no extractor in the CloudStream runtime handles. That runtime ships a handful of extractors where
     * CloudStream ships over a hundred, so most Arabic providers' servers came back as "no video link".
     */
    private val embeds: com.vantara.anime.hosts.EmbedResolver? = null,
    /**
     * Section names the provider declares (MainAPI.mainPage, from its registration): null = no home page at all,
     * empty = a home page without declared sections (older providers build all sections themselves).
     */
    private val mainPages: List<String>? = emptyList(),
    private val execute: suspend (String,JsonObject)->JsonObject,
) : AnimeAdapter {
    /** The provider's own home sections, in its order, as CloudStream shows them. No request. */
    override fun sections(): List<SourceSection> = when {
        mainPages == null -> emptyList()
        mainPages.isEmpty() -> listOf(SourceSection("section:0", "الرئيسية"))
        else -> mainPages.mapIndexed { i, name -> SourceSection("section:$i", name.trim().ifBlank { "القسم ${i + 1}" }) }
    }
    /** One section only: the merged home page asked every section of the site for one tab. */
    override suspend fun section(index: Int, page: Int): SourcePage {
        require(page>0 && index>=0)
        val result=execute("catalogue",input("page" to JsonPrimitive(page),"section" to JsonPrimitive(index)))
        val items=result["items"] as? JsonArray ?: error("INVALID_CATALOGUE_RESULT")
        val flat=JsonArray(items.flatMap { (it.jsonObject["list"] as? JsonArray) ?: error("INVALID_CATALOGUE_SECTION") })
        return SourcePage(flat.map { work(it.jsonObject) }.distinctBy { it.url },result["hasNext"]?.jsonPrimitive?.booleanOrNull ?: false)
    }
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
     * answer from the last two minutes serves the same rows (the worker flattens them identically) to the first
     * episodes request only: a later refresh asks the provider again, so a newly published episode appears.
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
    private suspend fun episodeRows(url: String, consume: Boolean): JsonArray {
        synchronized(recent) {
            recent[url]?.takeIf { System.currentTimeMillis()-it.first<RECENT_MS }?.let { if(consume)recent.remove(url);return it.second }
        }
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
        val items=episodeRows(anime.url,consume=false) // المواسم ثم الحلقات من الرد نفسه
        return items.mapNotNull { it.jsonObject["season"]?.jsonPrimitive?.intOrNull }.distinct().sorted().map { season ->
            anime.copy(title="${anime.title} · الموسم $season",hasSeasons=false,seasonNumber=season.toDouble(),requestedSeason=season)
        }
    }
    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        require(anime.sourceId==id)
        val rows=episodeRows(anime.url,consume=true).map { it.jsonObject }
        val seasons=rows.mapNotNull { it["season"]?.jsonPrimitive?.intOrNull }.distinct()
        // تلميح موسم الهوية (البطاقة العامة) فقط لمصدر يجمع المواسم في صفحة واحدة: صفحة موسم منفصلة لا تُرشَّح به
        val wanted=anime.requestedSeason ?: anime.seasonNumber.takeIf { it>=0 }?.toInt()
            ?: anime.seasonHint?.takeIf { seasons.size>1 && it in seasons }
        require(wanted!=null || seasons.size<=1) { "SEASON_SELECTION_REQUIRED" }
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
        val session="cs3-${now}"
        // روابط الدفعات بترتيب وصولها: معرّف الرابط من موضعه، فالقائمة المتراكمة نفسها تعطي المعرّفات نفسها في كل دفعة وفي النهاية
        val streamed=mutableListOf<JsonElement>()
        return kotlinx.coroutines.coroutineScope {
            val embedsLater=EmbedJobs(this,now,trace)
            val answer=kotlinx.coroutines.withContext(RuntimeLinkStream { stage ->
                val items=(stage["items"] as? JsonArray).orEmpty()
                if(items.isNotEmpty()) synchronized(streamed) { streamed.addAll(items);report(RuntimeCandidates.parse(session,id,name,streams(JsonArray(streamed.toList())),now),trace) }
                embedsLater.add(stage["missingEmbeds"] as? JsonArray)
            }) { execute("videoLinks",input("data" to JsonPrimitive(episode.url))) }
            RuntimeLinkObserver.onAnswer?.let { runCatching { it(id,episode.url,answer) } }
            val all=synchronized(streamed) { JsonArray(streamed+answer.getValue("items").jsonArray) }
            // Reuses existing direct-media validation and public DNS policy. No torrent/subtitle changes.
            // CloudStream links as the original engine plays them: http and any port allowed (addonMediaUrl (NativeAddonMediaNetwork.kt))
            val candidates=RuntimeCandidates.parse(session,id,name,streams(all),now)
            // Native preparation schedules media probes from route reports. Returning
            // a list alone only adopts the links, leaving probe-gated sessions unusable.
            report(candidates,trace)
            embedsLater.add(answer["missingEmbeds"] as? JsonArray)
            candidates+embedsLater.await()
        }
    }

    /** One route per server with every link it has so far; a later stage re-reports it with more (no duplicate rows). */
    private fun report(candidates: List<Candidate>,trace: ResolveTrace?) {
        candidates.groupBy { it.server }.forEach { (server,links) ->
            trace?.route(RouteReport(id,"x"+Integer.toHexString(server.hashCode()),server,
                links.mapNotNull { it.quality }.maxOrNull(),links.first().variant,RouteState.READY,links))
        }
    }

    private fun streams(links: JsonArray): JsonArray {
        // سيرفرات الفيديو قد يحجبها المزوّد كما يحجب المواقع: DoH أولًا وتجزئة SNI للمشغّل كما في Aniyomi (Embeds)
        for(raw in links) runCatching { java.net.URI((raw as? JsonObject)?.text("url").orEmpty()).host }.getOrNull()?.takeIf { it.isNotBlank() }
            ?.let { com.vantara.anime.net.AnimeHostRouter.markVideoHost(it) }
        return JsonArray(links.mapNotNull { it as? JsonObject }.map { link ->
            val headers=(link["headers"] as? JsonObject).orEmpty().toMutableMap()
            if(link.text("referer").isNotBlank())headers.putIfAbsent("Referer",JsonPrimitive(link.text("referer")))
            if(userAgent!=null && headers.keys.none { it.equals("User-Agent",true) })headers["User-Agent"]=JsonPrimitive(userAgent)
            buildJsonObject {
                put("url",runCatching { runtimeMediaUrl(link.text("url")) }.getOrDefault(link.text("url")));put("name",link.text("name"));put("title",link.text("name"))
                put("quality",link["quality"] ?: JsonNull);put("headers",JsonObject(headers))
                put("type",mediaType(link.text("type"),link.text("url")))
            }
        })
    }

    /**
     * Servers the runtime could not extract, resolved by VANTARA's mechanism; each reported the moment it is ready.
     * They start as soon as the worker names them (a staged answer), not after its slowest extractor; each page once.
     */
    private inner class EmbedJobs(private val scope: kotlinx.coroutines.CoroutineScope,private val now: Long,private val trace: ResolveTrace?) {
        private val gate=kotlinx.coroutines.sync.Semaphore(EMBED_PARALLEL)
        private val seen=HashSet<String>()
        private val jobs=mutableListOf<kotlinx.coroutines.Deferred<List<Candidate>>>()
        fun add(missing: JsonArray?) {
            val resolver=embeds ?: return
            val pages=missing.orEmpty().mapNotNull { it as? JsonObject }.mapNotNull { e ->
                val url=e.text("url").takeIf { it.startsWith("http") } ?: return@mapNotNull null
                Triple(url,e.text("referer").ifBlank { null },e.text("host").ifBlank { runCatching { java.net.URI(url).host }.getOrNull().orEmpty() })
            }.filterNot { (_,_,host) -> UNPLAYABLE.any { host==it || host.endsWith(".$it") } }
            synchronized(this) {
                for((url,referer,host) in pages) {
                    if(seen.size>=MAX_EMBEDS || !seen.add(url)) continue
                    jobs+=scope.async { resolve(resolver,url,referer,host) }
                }
            }
        }
        suspend fun await(): List<Candidate> = synchronized(this) { jobs.toList() }.awaitAll().flatten()
        private suspend fun resolve(resolver: com.vantara.anime.hosts.EmbedResolver,url: String,referer: String?,host: String): List<Candidate> {
            val key="e"+Integer.toHexString(url.hashCode())
            val server=host.removePrefix("www.").substringBefore('.').ifBlank { host }
            trace?.route(RouteReport(id,key,server,null,com.vantara.anime.stream.Variant.SUB,RouteState.RESOLVING))
            com.vantara.anime.net.AnimeHostRouter.markVideoHost(host)
            val streams=gate.withPermit {
                kotlinx.coroutines.withTimeoutOrNull(EMBED_TIMEOUT_MS) { runCatching { resolver.resolve(url,referer) }.getOrNull() }
            }.orEmpty()
            val json=JsonArray(streams.map { st ->
                com.vantara.anime.net.AnimeHostRouter.markVideoHost(runCatching { java.net.URI(st.url).host }.getOrNull().orEmpty())
                val headers=st.headers.toMutableMap()
                if(userAgent!=null && headers.keys.none { it.equals("User-Agent",true) })headers["User-Agent"]=userAgent
                buildJsonObject {
                    put("url",st.url);put("name",server);put("title",st.label.ifBlank { server })
                    put("quality",st.quality?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("headers",JsonObject(headers.mapValues { JsonPrimitive(it.value) }))
                    put("type",mediaType("",st.url))
                }
            })
            val found=RuntimeCandidates.parse("cs3e-$now",id,name,json,now)
            trace?.route(RouteReport(id,key,server,found.mapNotNull { it.quality }.maxOrNull(),
                found.firstOrNull()?.variant ?: com.vantara.anime.stream.Variant.SUB,
                if(found.isEmpty())RouteState.UNAVAILABLE else RouteState.READY,found,
                if(found.isEmpty())"لم يُستخرج رابط من $host" else null))
            return found
        }
    }
    private companion object {
        const val RECENT_MS=120_000L
        /** Servers per episode handed to VANTARA's resolver, how many at once, and each one's ceiling. */
        const val MAX_EMBEDS=24
        const val EMBED_PARALLEL=4
        const val EMBED_TIMEOUT_MS=25_000L
        /** ملفات مشفّرة على المتصفح (MEGA): لا رابط بث يُستخرج منها، فلا تُعرض صفوفًا «تعذّرت» ولا تحجز مستخرجًا. */
        val UNPLAYABLE=setOf("mega.nz","mega.co.nz","mega.io")
    }
}

/**
 * Measurement only (VANTARA's comparison with the original CloudStream, androidTest): the worker's raw answer for each
 * episode the adapter resolves, including which server each link came from (linkEmbeds). Always null in the app.
 */
/**
 * Receives each stage of a staged videoLinks as the worker hands it over (RuntimeHost.stagedLinks). Carried in the
 * coroutine context of one adapter call, so only that call's episode sees its stages; any other caller (diagnostics,
 * the live sweep) gets the one-shot operation unchanged.
 */
class RuntimeLinkStream(val onStage: (JsonObject)->Unit): kotlin.coroutines.AbstractCoroutineContextElement(Key) {
    companion object Key: kotlin.coroutines.CoroutineContext.Key<RuntimeLinkStream>
}

object RuntimeLinkObserver {
    @Volatile var onAnswer: ((sourceId: String, data: String, answer: JsonObject) -> Unit)? = null
}
