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
import uy.kohesive.injekt.api.get
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

    private val http=okhttp3.OkHttpClient.Builder().connectTimeout(15,java.util.concurrent.TimeUnit.SECONDS).readTimeout(20,java.util.concurrent.TimeUnit.SECONDS).build()
    private fun head(url: String,headers: Map<String,String>): Pair<okhttp3.Response,ByteArray> {
        val request=okhttp3.Request.Builder().url(url).header("Range","bytes=0-4095").apply { headers.forEach { (k,v) -> header(k,v) } }
            .header("User-Agent",headers["User-Agent"] ?: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36").build()
        val response=http.newCall(request).execute()
        return response to response.use { r ->
            val input=r.body?.byteStream() ?: return@use ByteArray(0)
            val out=java.io.ByteArrayOutputStream();val buf=ByteArray(4096)
            while (out.size()<4096) { val n=input.read(buf,0,4096-out.size());if (n<0)break;out.write(buf,0,n) }
            out.toByteArray()
        }
    }
    /** MEDIA لفيديو حقيقي (MP4/WebM/MKV/TS) أو لقائمة HLS وصل أول مقطع منها؛ وإلا السبب. */
    private fun playable(url: String,headers: Map<String,String>,depth: Int=0): String {
        val (response,bytes)=head(url,headers)
        if (!response.isSuccessful) {
            // فرضية تُختبر قبل تغيير المشغّل: CDN يرفض المقطع بلا Origin الذي يرسله المتصفح مع HLS
            val referer=headers["Referer"] ?: return "HTTP ${response.code}"
            val origin=runCatching { java.net.URI(referer).let { "${it.scheme}://${it.host}" } }.getOrNull() ?: return "HTTP ${response.code}"
            if (response.code!=403 || headers.containsKey("Origin")) return "HTTP ${response.code}"
            val retry=playable(url,headers+("Origin" to origin),depth)
            return if (retry.startsWith("MEDIA")) "$retry (Origin)" else "HTTP 403"
        }
        val text=bytes.toString(Charsets.ISO_8859_1)
        if (text.startsWith("#EXTM3U")) {
            if (depth>2) return "HLS_TOO_DEEP"
            val next=text.lines().map { it.trim() }.firstOrNull { it.isNotEmpty() && !it.startsWith("#") } ?: return "HLS_EMPTY"
            val absolute=java.net.URI(response.request.url.toString()).resolve(next).toString()
            // مقاطع مشفّرة (AES-128): بايتاتها عشوائية؛ نزولها بنجاح يكفي، والمشغّل يفكّها بالمفتاح
            if (Regex("#EXT-X-KEY:METHOD=(AES-128|SAMPLE-AES)").containsMatchIn(text))
                return head(absolute,headers).first.let { if (it.isSuccessful) "MEDIA hls-encrypted" else "HLS→HTTP ${it.code}" }
            val inner=playable(absolute,headers,depth+1)
            return if (inner.startsWith("MEDIA")) "MEDIA hls" else "HLS→$inner"
        }
        val video=bytes.size>=8 && (text.substring(4,8)=="ftyp" || bytes[0]==0x47.toByte() || (bytes[0]==0x1A.toByte() && bytes[1]==0x45.toByte()) || text.substring(4,8)=="moof" || text.substring(4,8)=="styp")
        return if (video) "MEDIA ${response.header("Content-Type") ?: ""}".trim() else "NOT_MEDIA ${response.header("Content-Type") ?: "?"}"
    }

    @Test fun repositoryJourneyReport() = runBlocking {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue("Live sweep is opt-in",args.getString("vantaraLiveSweep")=="true")
        val repo=args.getString("vantaraRepo") ?: arb
        val only=args.getString("vantaraOnly")?.split(',')?.map { it.trim().lowercase() }?.toSet()
        val maxPackages=args.getString("vantaraMaxPackages")?.toIntOrNull()?.coerceIn(1, 5000) ?: 5000
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine=AnimeEngine.get(context)
        // نافذة التطبيق أمامية كما عند المستخدم: المتصفح المخفي للحل الصامت لـCloudflare يحتاجها
        val window=androidx.test.core.app.ActivityScenario.launch(com.vantara.app.MainActivity::class.java)
        val host=RuntimeHost(context,engine,"Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
            silentClearance={ url,agent ->
                val solver=eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.current
                    ?: run { uy.kohesive.injekt.Injekt.get<eu.kanade.tachiyomi.network.NetworkHelper>().client;eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.current }
                solver?.silentClearance(url,agent)
            })
        val reports=mutableListOf<JsonObject>()
        val output=File(context.getExternalFilesDir(null),"live-sweep").apply { mkdirs() }
        try {
            host.setProfile("live-sweep-"+UUID.randomUUID())
            host.addRepository(repo)
            val packages=host.extensions(repo).map { it.jsonObject }
            for (row in packages.take(maxPackages)) {
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
                        // كتالوج «ناجح» فارغ: جواب المزوّد الخام (الأقسام وأحجامها) يحسم من المسؤول
                        if (page!=null && page.items.isEmpty()) runCatching { host.diagnose(id,"catalogue",buildJsonObject { put("page",1) }) }.fold({ raw ->
                            put("rawSections",JsonArray((raw["items"] as? JsonArray).orEmpty().map { sec -> buildJsonObject {
                                put("name",(sec as? JsonObject)?.get("name")?.jsonPrimitive?.contentOrNull?.take(60) ?: "?")
                                put("size",((sec as? JsonObject)?.get("list") as? JsonArray)?.size ?: -1)
                            } }))
                        },{ put("rawSections",JsonPrimitive("ERR "+reason(it))) })
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
                        put("missingSamples",links?.get("missingSamples") ?: JsonObject(emptyMap()))
                        put("subtitles",links?.get("subtitles")?.jsonArray?.size ?: 0)
                        // التشغيل لا الرابط: أول بايتات كل رابط بترويساته؛ HLS حتى أول مقطع فيديو فعلي
                        val checked=links?.get("items")?.jsonArray.orEmpty().take(6).map { raw ->
                            val link=raw.jsonObject
                            val headers=(link["headers"] as? JsonObject).orEmpty().mapValues { it.value.jsonPrimitive.content }.toMutableMap()
                            link["referer"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }?.let { headers.putIfAbsent("Referer",it) }
                            val verdict=runCatching { playable(link.getValue("url").jsonPrimitive.content,headers) }.getOrElse { "ERR "+it.javaClass.simpleName }
                            buildJsonObject { put("quality",link["quality"] ?: JsonNull);put("host",runCatching { java.net.URI(link.getValue("url").jsonPrimitive.content).host }.getOrNull() ?: "?");put("verdict",verdict) }
                        }
                        put("playable",checked.count { it["verdict"]?.jsonPrimitive?.content?.startsWith("MEDIA")==true })
                        put("playback",JsonArray(checked))
                    } }))
                }
                reports+=report
                Log.i("VANTARA_SWEEP",report.toString())
                File(output,"report.json").writeText(JsonArray(reports).toString())
            }
        } finally { host.close();engine.setRuntimeSources(emptyList());window.close() }
    }
}
