package com.vantara.runtime

import android.app.Application
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime
import com.vantara.plugins.ensureEngineInjekt
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.UUID

/**
 * Live journey of every plugin in a real CloudStream repository through the actual app host:
 * install from the repository → catalogue → details → (season) → episodes → video links.
 *
 * Opt-in only (`-e vantaraLiveSweep true`): it contacts the sources' real sites, so its outcome depends on
 * those sites and on the runner's network. Every step is recorded as PASS/FAIL with its reason; nothing is
 * retried or filtered. The report is the evidence, not a pass/fail gate of this test.
 */
class LiveRepositorySweepTest {
    private val arb="https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json"

    private fun reason(error: Throwable): String {
        val code=error.message?.takeIf { it.matches(Regex("[A-Z_]{3,60}(:.*)?")) }
        return (code ?: (error.javaClass.simpleName+": "+(error.message ?: ""))).replace(Regex("https?://\\S+"),"<url>").take(220)
    }
    private suspend fun <T> step(out: JsonObjectBuilder,name: String,ms: Long,block: suspend ()->T): T? {
        val started=System.nanoTime()
        return try {
            val value=withTimeout(ms) { block() }
            out.put(name,buildJsonObject { put("result","PASS");put("ms",(System.nanoTime()-started)/1_000_000) })
            value
        } catch (error: Throwable) {
            out.put(name,buildJsonObject { put("result","FAIL");put("reason",reason(error));put("ms",(System.nanoTime()-started)/1_000_000) })
            null
        }
    }

    @Test fun repositoryJourneyReport() = runBlocking {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue("Live sweep is opt-in",args.getString("vantaraLiveSweep")=="true")
        val repo=args.getString("vantaraRepo") ?: arb
        val only=args.getString("vantaraOnly")?.split(',')?.map { it.trim().lowercase() }?.toSet()
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine=AnimeEngine.get(context)
        val host=RuntimeHost(context,engine,"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")
        val reports=mutableListOf<JsonObject>()
        val output=File(context.getExternalFilesDir(null),"live-sweep").apply { mkdirs() }
        try {
            host.setProfile("live-sweep-"+UUID.randomUUID())
            host.addRepository(repo)
            val packages=host.extensions(repo).map { it.jsonObject }
            for (row in packages) {
                val name=row["name"]?.jsonPrimitive?.contentOrNull ?: row["pkg"]?.jsonPrimitive?.content ?: "?"
                if (only!=null && name.lowercase() !in only) continue
                val types=(row["tvTypes"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
                val content=if (types.any { it.equals("Anime",true) || it.equals("AnimeMovie",true) || it.equals("OVA",true) }) "anime" else "cinema"
                val report=buildJsonObject {
                    put("plugin",name);put("content",content)
                    val installed=step(this,"install",90_000) { host.install(repo,row.getValue("pkg").jsonPrimitive.content,content) }
                    val ids=installed?.get("sourceIds")?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
                    put("sources",JsonArray(ids.map { id -> buildJsonObject {
                        put("id",id)
                        val adapter=engine.adapter(id)
                        if (adapter==null) { put("catalogue",buildJsonObject { put("result","FAIL");put("reason","SOURCE_NOT_ROUTED") });return@buildJsonObject }
                        val page=step(this,"catalogue",45_000) { adapter.page(Listing.POPULAR,1) }
                        put("catalogueItems",page?.items?.size ?: 0)
                        val first=page?.items?.firstOrNull() ?: return@buildJsonObject
                        put("sampleTitle",first.title.take(80))
                        var work:SourceAnime=step(this,"details",45_000) { adapter.details(first) } ?: first
                        if (work.hasSeasons) step(this,"seasons",45_000) { host.seasons(work) }?.firstOrNull()?.let { work=it }
                        val episodes=step(this,"episodes",45_000) { adapter.episodes(work) }
                        put("episodeCount",episodes?.size ?: 0)
                        val episode=episodes?.firstOrNull() ?: return@buildJsonObject
                        val links=step(this,"videoLinks",60_000) { host.diagnose(id,"videoLinks",buildJsonObject { put("data",episode.url) }) }
                        put("links",links?.get("items")?.jsonArray?.size ?: 0)
                        put("linkHosts",JsonArray(links?.get("items")?.jsonArray.orEmpty().mapNotNull { runCatching { java.net.URI(it.jsonObject["url"]!!.jsonPrimitive.content).host }.getOrNull() }.distinct().map(::JsonPrimitive)))
                        put("missingExtractors",links?.get("missingExtractors") ?: JsonArray(emptyList()))
                        put("subtitles",links?.get("subtitles")?.jsonArray?.size ?: 0)
                    } }))
                }
                reports+=report
                Log.i("VANTARA_SWEEP",report.toString())
                File(output,"report.json").writeText(JsonArray(reports).toString())
            }
        } finally { host.close();engine.setRuntimeSources(emptyList()) }
    }
}
