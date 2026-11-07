package com.vantara.runtime

import android.app.Application
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.ResolveTrace
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.plugins.ensureEngineInjekt
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.*
import uy.kohesive.injekt.api.get
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.UUID

/**
 * VANTARA's side of the reference comparison (measurement plan, phase 1, small): the same published .cs3 and the
 * same episode `data` the original CloudStream ran, through VANTARA's real adapter (worker + its extractors +
 * VANTARA's embed resolver + media policy). Each episode is written the moment it finishes, in the reference's own
 * shape (embeds with links, direct links), so one checker (ffprobe on the host) judges both engines.
 *
 * Opt-in: -e vantaraRefCompare true. Input: /data/local/tmp/ref-episodes.json, read with the test's shell permission
 * (a file adb pushes into the app's own folder is not the app's: EACCES on Android 15, round of Nov 6)
 *   {"repo": "...", "plugins": [{"name","content","sha256","episodes":[{"data","label"}]}]}
 * Output: <external files>/reference-vantara/<name>.vep<N>.json and <name>.vantara.json.
 */
class ReferenceCompareTest {
    private companion object {
        const val BROWSER_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"
        const val ARB = "https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json"
    }

    private fun normal(url: String) = url.toHttpUrlOrNull()?.toString() ?: url

    private fun link(c: Candidate, now: Long) = buildJsonObject {
        put("url", c.url); put("referer", c.headers["Referer"] ?: c.headers["referer"] ?: "")
        put("headers", JsonObject(c.headers.mapValues { JsonPrimitive(it.value) }))
        put("type", c.container.name); put("quality", c.quality ?: 0); put("at", now)
    }

    private fun readShellFile(path: String): String {
        val pipe = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cat $path")
        return android.os.ParcelFileDescriptor.AutoCloseInputStream(pipe).use { it.readBytes().toString(Charsets.UTF_8) }
            .also { require(it.isNotBlank()) { "REFERENCE_EPISODES_MISSING $path" } }
    }

    private suspend fun <T> retry(block: suspend () -> T): T {
        repeat(2) { runCatching { return block() }; delay(5_000) }
        return block()
    }

    @Test fun compare() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Reference comparison is opt-in", args.getString("vantaraRefCompare") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine = AnimeEngine.get(context)
        androidx.test.core.app.ActivityScenario.launch(com.vantara.app.MainActivity::class.java)
        val root = context.getExternalFilesDir(null)!!
        val out = File(root, "reference-vantara").apply { mkdirs() }
        val plan = Json.parseToJsonElement(readShellFile("/data/local/tmp/ref-episodes.json")).jsonObject
        val repo = plan["repo"]?.jsonPrimitive?.contentOrNull ?: ARB
        val host = RuntimeHost(context, engine, BROWSER_UA,
            silentClearance = { url, agent ->
                val solver = eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.current
                    ?: run { uy.kohesive.injekt.Injekt.get<eu.kanade.tachiyomi.network.NetworkHelper>().client; eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.current }
                solver?.silentClearance(url, agent)
            })
        host.setProfile("ref-" + UUID.randomUUID())
        retry { host.addRepository(repo) }
        val index = retry { host.extensions(repo) }.map { it.jsonObject }
        var episodeNo = 0
        for (p in plan.getValue("plugins").jsonArray.map { it.jsonObject }) {
            val name = p.getValue("name").jsonPrimitive.content
            val summary = buildJsonObject {
                put("plugin", name)
                runCatching {
                    val row = index.firstOrNull { (it["name"]?.jsonPrimitive?.contentOrNull ?: "").equals(name, true) } ?: error("PLUGIN_NOT_IN_REPOSITORY")
                    val declared = row["sha256"]?.jsonPrimitive?.contentOrNull?.lowercase()
                    put("declaredSha256", declared ?: "")
                    // Same input or no verdict: a different package build is NOT_COMPARABLE, never a VANTARA fault.
                    put("comparable", declared != null && declared == p["sha256"]?.jsonPrimitive?.contentOrNull?.lowercase())
                    val installed = retry { host.install(repo, row.getValue("pkg").jsonPrimitive.content, p["content"]?.jsonPrimitive?.contentOrNull ?: "anime") }
                    val id = installed["sourceIds"]?.jsonArray?.firstOrNull()?.jsonPrimitive?.content ?: error("NO_SOURCE_REGISTERED")
                    put("sourceId", id)
                    val adapter = engine.adapter(id) ?: error("SOURCE_NOT_ROUTED")
                    for (ep in p.getValue("episodes").jsonArray.map { it.jsonObject }) {
                        val data = ep.getValue("data").jsonPrimitive.content
                        var answer: JsonObject? = null
                        val reports = mutableListOf<RouteReport>()
                        RuntimeLinkObserver.onAnswer = { sid, d, a -> if (sid == id && d == data) answer = a }
                        val t0 = System.currentTimeMillis()
                        val result = runCatching {
                            withTimeoutOrNull(120_000) {
                                adapter.candidates(SourceEpisode(id, data, ep["label"]?.jsonPrimitive?.contentOrNull ?: "", 1f),
                                    trace = ResolveTrace { reports += it }, enough = Int.MAX_VALUE)
                            } ?: error("TIMEOUT 120s")
                        }
                        RuntimeLinkObserver.onAnswer = null
                        val now = System.currentTimeMillis()
                        val got = result.getOrDefault(emptyList())
                        val byUrl = got.associateBy { normal(it.url) }
                        val a = answer
                        val linkEmbeds = (a?.get("linkEmbeds") as? JsonObject).orEmpty().mapValues { it.value.jsonPrimitive.content }
                        val items = (a?.get("items") as? JsonArray).orEmpty().map { it.jsonObject }
                        val embeds = linkedMapOf<String, MutableList<JsonObject>>()
                        val direct = mutableListOf<JsonObject>()
                        val dropped = mutableListOf<JsonObject>()
                        for (item in items) {
                            val url = item["url"]?.jsonPrimitive?.contentOrNull ?: continue
                            val c = byUrl[normal(url)]
                            if (c == null) { dropped += buildJsonObject { put("host", url.toHttpUrlOrNull()?.host ?: "?"); put("scheme", url.substringBefore(':')); put("port", url.toHttpUrlOrNull()?.port ?: -1) }; continue }
                            val embed = linkEmbeds[url]
                            if (embed == null) direct += link(c, now) else embeds.getOrPut(embed) { mutableListOf() } += link(c, now)
                        }
                        // Servers the worker could not extract, resolved by VANTARA's embed resolver (route key e<hash>)
                        val missing = (a?.get("missingEmbeds") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.get("url")?.jsonPrimitive?.contentOrNull }
                        val reasons = mutableMapOf<String, String>()
                        for (m in missing) {
                            val key = "e" + Integer.toHexString(m.hashCode())
                            val last = reports.lastOrNull { it.key == key }
                            embeds.getOrPut(m) { mutableListOf() } += last?.candidates.orEmpty().map { link(it, now) }
                            last?.reason?.let { reasons[m] = it }
                        }
                        val row = buildJsonObject {
                            put("data", data); put("label", ep["label"] ?: JsonNull); put("linksMs", now - t0)
                            put("error", result.exceptionOrNull()?.let { "${it.javaClass.simpleName}: ${it.message?.take(200)}" } ?: "")
                            put("embeds", JsonArray(embeds.map { (e, ls) -> buildJsonObject { put("embed", e); put("links", JsonArray(ls)); reasons[e]?.let { put("reason", it) } } }))
                            put("direct", JsonArray(direct))
                            put("dropped", JsonArray(dropped))
                            put("routes", JsonArray(reports.map { r -> buildJsonObject { put("server", r.server); put("state", r.state.name); put("reason", r.reason ?: ""); put("links", r.candidates.size) } }))
                        }
                        File(out, "$name.vep${++episodeNo}.json").writeText(row.toString())
                    }
                }.onFailure { put("error", "${it.javaClass.simpleName}: ${it.message?.take(200)}") }
            }
            File(out, "$name.vantara.json").writeText(summary.toString())
        }
    }
}
