package com.vantara.plugins

import android.content.Intent
import androidx.test.platform.app.InstrumentationRegistry
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.vantara.app.MainActivity
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** Actual owner-supplied repositories, native bridge and private disk; no fixture catalogue. */
class OptionalMangaRepositoriesDeviceTest {
    private fun exercise(afterRestart: Boolean) {
        val ins = InstrumentationRegistry.getInstrumentation()
        val context = ins.targetContext
        require(context.packageName.endsWith(".debug") &&
            InstrumentationRegistry.getArguments().getString("vantaraEphemeralRepositories") == "true")
        val marker = File(context.filesDir, "optional-repository-process.txt")
        if (afterRestart) assertNotEquals(marker.readText().toInt(), android.os.Process.myPid())
        else require(!marker.exists()) { "FRESH_EPHEMERAL_DEVICE_REQUIRED" }
        val activity = ins.startActivitySync(Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
        try {
            val plugin = activity.bridge.getPlugin("ExtensionEngine").instance as ExtensionEnginePlugin
            fun invoke(method: String, data: JSObject = JSObject()): JSObject {
                val done = CompletableFuture<JSObject>()
                val call = object : PluginCall(null, "ExtensionEngine", "optional-repository-qa", method, data) {
                    override fun resolve(result: JSObject?) { done.complete(result ?: JSObject()) }
                    override fun resolve() { done.complete(JSObject()) }
                    override fun reject(msg: String?, code: String?, error: Exception?, details: JSObject?) {
                        done.completeExceptionally(IllegalStateException(code ?: msg ?: "NATIVE_REPOSITORY_REJECTED", error))
                    }
                }
                plugin.javaClass.getMethod(method, PluginCall::class.java).invoke(plugin, call)
                return done.get(150, TimeUnit.SECONDS)
            }
            val state = invoke("repos")
            assertEquals(0, state.getJSONArray("installed").length())
            assertEquals(0, state.getJSONArray("repos").length())
            if (afterRestart) {
                assertTrue(state.getBoolean("readyCatalogDismissed"))
                android.util.Log.i("VANTARA_REPOSITORY_QA", "REPOSITORY_RESTART_PASS newProcess=true;catalogueStillDismissed=true")
                return
            }
            for ((owner, name) in listOf("keiyoushi" to "extensions", "yuzono" to "manga-repo")) {
                val supplied = "https://github.com/$owner/$name/raw/repo/index.pb"
                val args = JSObject().put("url", supplied)
                val result = invoke("addRepo", args)
                assertTrue("Real repository returned no extensions", result.getInt("count") > 0)
                invoke("addRepo", args) // repeat registration must not create a duplicate
                val canonical = RepoIndex.base(supplied)
                val registered = invoke("repos").getJSONArray("repos")
                assertEquals(1, (0 until registered.length()).count {
                    registered.getJSONObject(it).getString("url") == canonical
                })
                invoke("removeRepo", args)
                assertEquals(0, invoke("repos").getJSONArray("repos").length())
                android.util.Log.i("VANTARA_REPOSITORY_QA", "REPOSITORY_PASS owner=$owner;index=protobuf;registeredTwice=true;unlinked=true")
            }
            invoke("removeReadySources")
            assertTrue(invoke("repos").getBoolean("readyCatalogDismissed"))
            marker.writeText(android.os.Process.myPid().toString())
        } finally { ins.runOnMainSync { activity.finish() } }
    }

    @Test fun addRemoveAndDismiss() { exercise(false) }
    @Test fun dismissalSurvivesProcessRestart() { exercise(true) }
}
