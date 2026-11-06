package com.lagradost.cloudstream3

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.lagradost.cloudstream3.plugins.PluginData
import com.lagradost.cloudstream3.plugins.PluginManager
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ReferenceProbe
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * VANTARA reference run (CI only, never shipped): loads a published .cs3 exactly as the CloudStream app does
 * (PluginManager.loadPlugin → PathClassLoader → Plugin.load) and records, per work and episode, every server
 * (embed handed to loadExtractor) and every link CloudStream's own extractors produce.
 *
 * Instrumentation arguments:
 *   plugins   comma-separated internalName=https://…/x.cs3
 *   works     works per provider from its main page (default 3)
 *   episodes  episodes per work (default 2)
 * Output: <external files>/reference/<internalName>.json — one file per plugin, written even on failure.
 * Deadlines are the measurement plan's: main page 30 s, load 30 s, loadLinks 90 s per episode.
 */
@RunWith(AndroidJUnit4::class)
class ReferenceRunTest {
    private val now = { System.currentTimeMillis() }

    @Test
    fun run() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val works = args.getString("works")?.toIntOrNull() ?: 3
        val episodes = args.getString("episodes")?.toIntOrNull() ?: 2
        val out = File(context.getExternalFilesDir(null), "reference").apply { mkdirs() }
        val plugins = args.getString("plugins").orEmpty().split(',').mapNotNull { pair ->
            val name = pair.substringBefore('=').trim()
            val url = pair.substringAfter('=', "").trim()
            if (name.isEmpty() || !url.startsWith("https://")) null else name to url
        }
        require(plugins.isNotEmpty()) { "No plugins given (plugins=name=https://…/x.cs3)" }
        for ((name, url) in plugins) {
            val report = JSONObject().put("plugin", name).put("url", url).put("startedAt", now())
            try {
                val file = File(context.filesDir, "reference-plugins/$name.cs3").apply { parentFile?.mkdirs() }
                file.writeBytes(download(url))
                report.put("sha256", sha256(file.readBytes()))
                val before = APIHolder.allProviders.toSet()
                val loaded = PluginManager.loadPlugin(context, file, PluginData(name, url, true, file.absolutePath, 1))
                report.put("loaded", loaded)
                val providers = APIHolder.allProviders.filter { it !in before || it.sourcePlugin == file.absolutePath }
                report.put("providers", JSONArray(providers.map { runProvider(it, works, episodes) }))
            } catch (t: Throwable) {
                report.put("error", describe(t))
            } finally {
                report.put("finishedAt", now())
                File(out, "$name.json").writeText(report.toString(2))
                println("VANTARA_REF plugin=$name done")
            }
        }
    }

    private suspend fun runProvider(api: MainAPI, works: Int, episodes: Int): JSONObject {
        val row = JSONObject().put("name", api.name).put("mainUrl", api.mainUrl).put("lang", api.lang)
        val home = mutableListOf<SearchResponse>()
        val t0 = now()
        val homeError = runCatching {
            for (section in api.mainPage) {
                if (home.size >= works) break
                val page = withTimeoutOrNull(30_000) { api.getMainPage(1, MainPageRequest(section.name, section.data, section.horizontalImages)) }
                    ?: error("TIMEOUT main page 30s")
                page.items.flatMap { it.list }.forEach { if (home.size < works && home.none { h -> h.url == it.url }) home += it }
            }
        }.exceptionOrNull()
        row.put("mainPageMs", now() - t0).put("mainPageError", homeError?.let(::describe))
        row.put("works", JSONArray(home.map { runWork(api, it, episodes) }))
        return row
    }

    private suspend fun runWork(api: MainAPI, work: SearchResponse, episodes: Int): JSONObject {
        val row = JSONObject().put("title", work.name).put("url", work.url)
        val t0 = now()
        val load = runCatching { withTimeoutOrNull(30_000) { api.load(work.url) } ?: error("TIMEOUT load 30s") }
        row.put("loadMs", now() - t0)
        val response = load.getOrElse { return row.put("loadError", describe(it)) }
        val data: List<Pair<String, String?>> = when (response) {
            is AnimeLoadResponse -> response.episodes.entries.firstOrNull()?.value.orEmpty().take(episodes).map { it.data to (it.episode?.toString() ?: it.name) }
            is TvSeriesLoadResponse -> response.episodes.take(episodes).map { it.data to (it.episode?.toString() ?: it.name) }
            is MovieLoadResponse -> listOf(response.dataUrl to "movie")
            is LiveStreamLoadResponse -> listOf(response.dataUrl to "live")
            else -> emptyList()
        }
        row.put("type", response.type.name).put("episodeCount", data.size)
        row.put("episodes", JSONArray(data.map { (d, label) -> runEpisode(api, d, label) }))
        return row
    }

    private suspend fun runEpisode(api: MainAPI, data: String, label: String?): JSONObject {
        val embeds = linkedMapOf<String, JSONObject>()
        val direct = JSONArray()
        val listener = object : ReferenceProbe.Listener {
            override fun embed(url: String, referer: String?) {
                synchronized(embeds) { embeds.getOrPut(url) { JSONObject().put("embed", url).put("referer", referer).put("at", now()).put("links", JSONArray()) } }
            }
            override fun link(embed: String, referer: String?, link: ExtractorLink) {
                synchronized(embeds) { embeds[embed]?.getJSONArray("links")?.put(linkJson(link)) }
            }
        }
        val row = JSONObject().put("data", data).put("label", label)
        val t0 = now()
        ReferenceProbe.listener = listener
        val result = try {
            runCatching {
                withTimeoutOrNull(90_000) {
                    api.loadLinks(data, false, {}) { link ->
                        // A link the provider produced itself (not through an extractor) is its own unit.
                        val viaExtractor = synchronized(embeds) { embeds.values.any { e -> (0 until e.getJSONArray("links").length()).any { e.getJSONArray("links").getJSONObject(it).optString("url") == link.url } } }
                        if (!viaExtractor) synchronized(direct) { direct.put(linkJson(link)) }
                    }
                } ?: error("TIMEOUT loadLinks 90s")
            }
        } finally {
            ReferenceProbe.listener = null
        }
        row.put("linksMs", now() - t0).put("returned", result.getOrNull()).put("error", result.exceptionOrNull()?.let(::describe))
        row.put("embeds", JSONArray(synchronized(embeds) { embeds.values.toList() })).put("direct", direct)
        return row
    }

    private fun linkJson(link: ExtractorLink) = JSONObject()
        .put("source", link.source).put("name", link.name).put("url", link.url).put("referer", link.referer)
        .put("quality", link.quality).put("type", link.type.name).put("headerNames", JSONArray(link.headers.keys.toList()))
        .put("headers", JSONObject(link.headers)).put("at", now())

    private fun download(url: String): ByteArray {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20_000; c.readTimeout = 60_000; c.instanceFollowRedirects = true
        return c.inputStream.use { it.readBytes() }.also { c.disconnect() }
    }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun describe(t: Throwable) = "${t.javaClass.simpleName}: ${t.message?.take(300)}"
}
