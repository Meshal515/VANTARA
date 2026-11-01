package com.vantara.anime

import androidx.test.platform.app.InstrumentationRegistry
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.vantara.anime.bridge.AnimeEnginePlugin
import com.vantara.anime.adapters.Listing
import com.vantara.anime.registry.UserAnimeStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Opt-in on a fresh ephemeral Debug app. Calls the real native repository manager, not a loader fixture. */
class AniyomiVideoJourneyDeviceTest {
    @Test fun repositoryInstallMetadataNativePlaybackAndQualities() = runBlocking {
        val ins = InstrumentationRegistry.getInstrumentation()
        val args = InstrumentationRegistry.getArguments()
        require(args.getString("vantaraEphemeralVideo") == "true") { "EPHEMERAL_DEBUG_REQUIRED" }
        require(ins.targetContext.packageName.endsWith(".debug")) { "DEBUG_ONLY" }
        val stateFile = File(ins.targetContext.filesDir, "anime-extensions/user-repos.json")
        require(UserAnimeStore(stateFile).state.extensions.isEmpty()) { "EXISTING_USER_INSTALLATIONS_REFUSED" }
        val activity = ins.startActivitySync(android.content.Intent(ins.targetContext, com.vantara.app.MainActivity::class.java)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as com.vantara.app.MainActivity
        val plugin = activity.bridge.getPlugin("AnimeEngine").instance as AnimeEnginePlugin
        fun invoke(method: String, data: JSObject): JSObject {
            val completed = CompletableFuture<JSObject>()
            val call = object : PluginCall(null, "AnimeEngine", "real-video-qa", method, data) {
                override fun resolve(result: JSObject?) { completed.complete(result ?: JSObject()) }
                override fun resolve() { completed.complete(JSObject()) }
                override fun reject(msg: String?, code: String?, error: Exception?, details: JSObject?) {
                    completed.completeExceptionally(IllegalStateException(code ?: "NATIVE_OPERATION_REJECTED", error))
                }
            }
            plugin.javaClass.getMethod(method, PluginCall::class.java).invoke(plugin, call)
            return completed.get(150, TimeUnit.SECONDS)
        }
        val repository = "https://raw.githubusercontent.com/yuzono/anime-repo/repo"
        var passed = 0
        try {
            invoke("addRepo", JSObject().put("url", repository))
            val index = invoke("repoIndex", JSObject().put("url", repository)).getJSONArray("extensions")
            val engine = AnimeEngine.get(ins.targetContext)
            for (suffix in listOf("okanime", "anime4up", "witanime")) {
                var stage = "discovery"
                try {
                    val entry = (0 until index.length()).map { index.getJSONObject(it) }
                        .single { it.getString("pkg").endsWith(".$suffix") }
                    val pkg = entry.getString("pkg")
                    stage = "install"
                    val installed = invoke("installExtension", JSObject().put("repo", repository).put("pkg", pkg).put("content", "anime"))
                    stage = "durable-reconstruction"
                    assertTrue(UserAnimeStore(stateFile).state.extensions.any { it.pkg == pkg })
                    val id = installed.getString("id")!!
                    val adapter = engine.adapter(id) ?: error("INSTALLED_SOURCE_NOT_ROUTED")
                    stage = "catalogue"
                    val work = adapter.page(Listing.POPULAR, 1).items.firstOrNull() ?: error("EMPTY_CATALOGUE")
                    stage = "search"
                    // A failed mandatory search remains a failed journey, but must not hide
                    // independent video diagnostics for an otherwise accessible catalogue work.
                    val search = runCatching { adapter.page(Listing.SEARCH, 1, work.title) }
                    val searchMatches = search.getOrNull()?.items?.any { it.url.trimEnd('/') == work.url.trimEnd('/') } == true
                    android.util.Log.i("VANTARA_ANIYOMI_REAL", "OPERATION source=$suffix;operation=search;result=${if(searchMatches) "PASS" else "FAIL"};query=${work.title.take(120)};expectedPath=${work.url.substringBefore('?').take(180)};resultCount=${search.getOrNull()?.items?.size ?: -1}")
                    stage = "details"
                    var detail = adapter.details(work)
                    if (detail.hasSeasons) {
                        stage = "seasons"
                        val season = adapter.seasons(detail).firstOrNull() ?: error("EMPTY_SEASONS")
                        detail = adapter.details(season)
                    }
                    stage = "episodes"
                    val episode = adapter.episodes(detail).firstOrNull() ?: error("EMPTY_EPISODES")
                    stage = "native-preparation-playback-qualities"
                    val facts = DebugVideoPlaybackProbe.run(ins, engine, detail, episode.number)
                    android.util.Log.i("VANTARA_ANIYOMI_REAL", "PLAYBACK_PASS source=$suffix;version=${entry.getString("version")};$facts")
                    if (searchMatches) {
                        android.util.Log.i("VANTARA_ANIYOMI_REAL", "JOURNEY_PASS source=$suffix;version=${entry.getString("version")};$facts")
                        passed++
                    } else {
                        android.util.Log.i("VANTARA_ANIYOMI_REAL", "JOURNEY_FAIL source=$suffix;stage=search;code=SEARCH_MISSING_EXPECTED_WORK;upstreamComparison=NOT_TESTED")
                    }
                } catch (failure: Throwable) {
                    val chain = generateSequence(failure) { it.cause }.take(6).toList()
                    val code = chain.mapNotNull { it.message }.firstOrNull { it.matches(Regex("[A-Z][A-Z0-9_]{2,80}")) }
                        ?: chain.last().javaClass.simpleName
                    val httpStatus = chain.filterIsInstance<eu.kanade.tachiyomi.network.HttpException>().firstOrNull()?.let { it.message?.take(60) }.orEmpty()
                    android.util.Log.i("VANTARA_ANIYOMI_REAL", "JOURNEY_FAIL source=$suffix;stage=$stage;code=$code;http=$httpStatus;upstreamComparison=NOT_TESTED")
                }
            }
            assertTrue("No real Aniyomi repository source completed decoded playback; inspect every JOURNEY_FAIL", passed > 0)
        } finally { ins.runOnMainSync { activity.finish() } }
    }
}
