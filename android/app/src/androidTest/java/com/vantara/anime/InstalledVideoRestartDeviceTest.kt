package com.vantara.anime

import androidx.test.platform.app.InstrumentationRegistry
import com.getcapacitor.JSObject
import com.vantara.anime.bridge.AnimeEnginePlugin
import com.vantara.anime.registry.UserAnimeStore
import com.vantara.anime.registry.UserAnimeState
import com.vantara.anime.adapters.SourceAnime
import com.vantara.plugins.sha256Hex
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
import java.io.File

/** Second instrumentation process on the same APK/data, after explicit am force-stop. */
class InstalledVideoRestartDeviceTest {
    @Test fun persistedInstallationsAndPlaybackSurviveProcessDeath() = runBlocking {
        val ins=InstrumentationRegistry.getInstrumentation()
        val context=ins.targetContext
        require(context.packageName.endsWith(".debug") &&
            InstrumentationRegistry.getArguments().getString("vantaraEphemeralVideo")=="true") { "EPHEMERAL_DEBUG_REQUIRED" }
        val checkpoint=JSONObject(File(context.filesDir,"debug-video-qa/checkpoint.json").readText())
        assertNotEquals("This must be a genuinely new app process",checkpoint.getInt("pid"),android.os.Process.myPid())
        val stateFile=File(context.filesDir,"anime-extensions/user-repos.json")
        val expected=Json.decodeFromString(UserAnimeState.serializer(),checkpoint.getJSONObject("state").toString())
        assertEquals(checkpoint.getString("stateSha"),sha256Hex(stateFile.readBytes()))
        assertEquals(expected,UserAnimeStore(stateFile).state)
        assertTrue("No installed extensions were saved",expected.extensions.isNotEmpty())
        val activity=ins.startActivitySync(android.content.Intent(context,com.vantara.app.MainActivity::class.java)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as com.vantara.app.MainActivity
        try {
            val engine=AnimeEngine.get(context)
            val plugin=activity.bridge.getPlugin("AnimeEngine").instance as AnimeEnginePlugin
            val installed=invokeVideoEngine(plugin,"repos",JSObject()).getJSONArray("installed")
            assertEquals(expected.extensions.size,installed.length())
            for(extension in expected.extensions) {
                val row=(0 until installed.length()).map { installed.getJSONObject(it) }.single { it.getString("pkg")==extension.pkg }
                assertEquals(extension.version,row.getString("version"))
                val archive=File(context.filesDir,"anime-extensions/vault/${extension.pkg}/${extension.sha256.lowercase()}.apk")
                assertTrue("Previously installed APK disappeared",archive.isFile)
                assertEquals(extension.sha256,sha256Hex(archive.readBytes()))
                for(entry in extension.entries()) {
                    assertTrue("Installed source vanished from registry",engine.sources().any { it.id==entry.id })
                    assertNotNull("Persisted signed APK cannot be loaded after restart",engine.adapter(entry.id))
                }
            }
            assertEquals(checkpoint.getString("stateSha"),sha256Hex(stateFile.readBytes()))
            android.util.Log.i("VANTARA_ANIYOMI_REAL","RESTART_METADATA_PASS extensions=${expected.extensions.size};newProcess=true;stateBytesUnchanged=true;apkHashesUnchanged=true")
            if(checkpoint.has("work")) {
                val work=Json.decodeFromString(SourceAnime.serializer(),checkpoint.getString("work"))
                val facts=DebugVideoPlaybackProbe.run(ins,engine,work,checkpoint.getDouble("episode").toFloat())
                    .replace("processRestart=NOT_TESTED","processRestart=PASS")
                android.util.Log.i("VANTARA_ANIYOMI_REAL","RESTART_NATIVE_PASS source=${work.sourceId};$facts")
            } else {
                android.util.Log.i("VANTARA_ANIYOMI_REAL","RESTART_NATIVE_NOT_TESTED: no prior successful content journey")
            }
        } finally { ins.runOnMainSync { activity.finish() } }
    }
}
