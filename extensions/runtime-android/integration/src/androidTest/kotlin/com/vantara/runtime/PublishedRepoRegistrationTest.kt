package com.vantara.runtime

import android.app.Application
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.plugins.ensureEngineInjekt
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/**
 * Package/ABI compatibility sweep of an entire real published CloudStream repository.
 * No source-site catalogue, movies, anime, streaming or user account data are accessed.
 * Every publisher plugin is installed from its repository URL, registered and routed in
 * an isolated ephemeral profile. Real source-site playback has a separate strict suite.
 */
class PublishedRepoRegistrationTest {
    @Test fun registerEveryPublishedPluginInThisShard() = runBlocking {
        val ins=InstrumentationRegistry.getInstrumentation()
        val args=InstrumentationRegistry.getArguments()
        assumeTrue("Opt-in public repository sweep", args.getString("vantaraRegistrationSweep")=="true")
        val repo=args.getString("vantaraRepo") ?:
            "https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json"
        val count=args.getString("vantaraShardCount")?.toIntOrNull() ?: 2
        val shard=args.getString("vantaraShard")?.toIntOrNull() ?: 0
        require(count in 1..16 && shard in 0 until count) { "INVALID_REGISTRATION_SHARD" }
        val context=ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine=AnimeEngine.get(context)
        val host=RuntimeHost(context,engine,"VANTARA registration matrix")
        try {
            host.setProfile("registration-matrix-$shard-"+UUID.randomUUID())
            host.addRepository(repo)
            val all=host.extensions(repo).map { it.jsonObject }
            assertTrue("Published repository was empty",all.isNotEmpty())
            val selected=all.filterIndexed { index, _ -> index % count == shard }
            assertTrue("No plugins for registration shard $shard",selected.isNotEmpty())
            for((ordinal,row) in selected.withIndex()) {
                val name=row.text("name").ifBlank { row.text("pkg") }
                val content=if ((row["tvTypes"] as? JsonArray).orEmpty().any {
                    it.jsonPrimitive.content.equals("Anime",true) || it.jsonPrimitive.content.equals("AnimeMovie",true)
                }) "anime" else "cinema"
                val pkg=row.text("pkg")
                val started=android.os.SystemClock.elapsedRealtime()
                val outcome=runCatching {
                    withTimeout(45_000) {
                        val installed=host.install(repo,pkg,content)
                        val ids=(installed["sourceIds"] as? JsonArray).orEmpty().map { it.jsonPrimitive.content }
                        check(ids.isNotEmpty()) { "NO_SOURCE_IDS" }
                        check(ids.distinct().size==ids.size) { "DUPLICATE_SOURCE_ID" }
                        check(ids.all { engine.runtimeSource(it)?.entry?.content==content }) { "SOURCE_NOT_ROUTED_TO_CONTENT" }
                        ids.size
                    }
                }
                val report=buildJsonObject {
                    put("plugin",name);put("pkg",pkg);put("content",content)
                    put("shard",shard);put("ordinal",ordinal)
                    put("result",if(outcome.isSuccess)"PASS" else "FAIL")
                    put("sources",outcome.getOrDefault(0))
                    put("ms",android.os.SystemClock.elapsedRealtime()-started)
                    outcome.exceptionOrNull()?.let { put("failure",it.message.orEmpty().take(140).replace(Regex("https?://\\S+"),"<url>")) }
                }
                Log.i("VANTARA_REGISTRATION",report.toString())
            }
        } finally {
            host.close();engine.setRuntimeSources(emptyList())
        }
    }
}
