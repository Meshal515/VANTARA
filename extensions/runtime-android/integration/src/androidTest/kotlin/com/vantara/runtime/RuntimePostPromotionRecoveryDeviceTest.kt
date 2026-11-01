package com.vantara.runtime

import android.app.Application
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.Listing
import com.vantara.plugins.ensureEngineInjekt
import dev.vantara.runtime.android.AndroidRuntimeClient
import dev.vantara.runtime.api.RuntimeHttpAccess
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.net.URI
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/** Real published AnimeWitcher DEX, actual worker and VANTARA host, deterministic
 * simulated site failure after a successful update. Only the candidate/old DEX
 * network responses are offline-authored; no watch state is opened or modified.
 */
class RuntimePostPromotionRecoveryDeviceTest {
    @Test fun threeRegressionsRecoverDurableLastGoodWithoutMutatingUserData()=runBlocking {
        val ins=InstrumentationRegistry.getInstrumentation()
        val context=ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine=AnimeEngine.get(context)
        val failures=AtomicInteger()
        val oldProbes=AtomicInteger()
        val candidateProbes=AtomicInteger()
        val host=RuntimeHost(context,engine,"VANTARA post-upgrade recovery test",sourceTransport={ scope,_ ->
            object:AndroidRuntimeClient.HostHttpTransport {
                override fun exchange(caller:AndroidRuntimeClient.Scope,request:RuntimeHttpAccess.Request):RuntimeHttpAccess.Response {
                    val id=scope.sourceId()
                    val canary=id.contains("|candidate|")
                    val recovery=id.contains("|recovery|")
                    if(!canary&&!recovery) {
                        failures.incrementAndGet()
                        throw IOException("SYNTHETIC_INSTALLED_REVISION_BROKEN")
                    }
                    if(canary) candidateProbes.incrementAndGet() else oldProbes.incrementAndGet()
                    val url=URI(request.url())
                    var status=200
                    val body=when(url.host) {
                        "d8lh9i7zl7-dsn.algolia.net", "tvnesh8ozy-dsn.algolia.net" ->
                            """{"hits":[{"objectID":"work-1","anime_id":"work-1","name":"Recovery Fixture","poster_uri":"https://images.example/work-1.jpg","doc_ref":"anime_list/work-1"}]}"""
                        "firestore.googleapis.com" -> when {
                            url.path.endsWith("/Settings/constants") ->
                                """{"fields":{"search_settings":{"mapValue":{"fields":{"app_id_v3":{"stringValue":"D8LH9I7ZL7"},"api_key":{"stringValue":"authored-key"}}}}}}"""
                            url.path.endsWith("/episodes_summery/summery") ->
                                """{"fields":{"episodes":{"arrayValue":{"values":[{"mapValue":{"fields":{"doc_id":{"stringValue":"ep-1"},"name":{"stringValue":"Episode 1"},"number":{"integerValue":"1"}}}}]}}}}"""
                            url.path.endsWith("/servers2/all_servers") ->
                                """{"fields":{"servers":{"arrayValue":{"values":[{"mapValue":{"fields":{"name":{"stringValue":"PD"},"quality":{"stringValue":"480p"},"link":{"stringValue":"https://pixeldrain.com/u/AbCd1234"}}}}]}}}}"""
                            url.path.contains("/Settings/servers/servers/") -> """{"fields":{}}"""
                            else -> throw IOException("UNEXPECTED_OFFLINE_FIRESTORE_REQUEST")
                        }
                        "pixeldrain.com" ->
                            """<html><meta property="og:video" content="https://pixeldrain.com/api/file/AbCd1234"></html>"""
                        else -> {status=404;"not-found"}
                    }
                    return RuntimeHttpAccess.Response(request.url(),status,mapOf("Content-Type" to listOf("application/json")),body.toByteArray())
                }
            }
        })
        val original=File.createTempFile("rollback-v3-", ".cs3",context.cacheDir)
        val updated=File.createTempFile("rollback-v4-", ".cs3",context.cacheDir)
        val sentinel=File.createTempFile("unrelated-playback-state-", ".json",context.filesDir)
        try {
            host.setProfile("auto-recovery-"+UUID.randomUUID())
            ins.context.assets.open("Animewitcher.cs3").use { input -> original.outputStream().use { input.copyTo(it) } }
            val pin=ins.context.assets.open("Animewitcher.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val pkg=RuntimeHost.packageId("https://repo.example/auto-recovery","Animewitcher")
            val meta=buildJsonObject {put("internalName","Animewitcher");put("content","anime");put("enabled",true)}
            host.installFile(original,pin.text("packageSha256"),pkg,meta)
            sentinel.writeText("""{"savedWorks":["one"],"progressMs":81234}""")
            val before=sentinel.readBytes()
            ZipFile(original).use { archive ->
                ZipOutputStream(updated.outputStream()).use { out ->
                    archive.entries().asSequence().forEach { file ->
                        val originalBytes=archive.getInputStream(file).use { it.readBytes() }
                        val payload=if(file.name=="manifest.json") {
                            val manifest=RuntimeJson.parse(originalBytes.decodeToString()).jsonObject
                            JsonObject(manifest+mapOf("version" to JsonPrimitive(4))).toString().toByteArray()
                        }else originalBytes
                        out.putNextEntry(ZipEntry(file.name));out.write(payload);out.closeEntry()
                    }
                }
            }
            host.installFile(updated,RuntimeHost.digest(updated.readBytes()),pkg,meta)
            assertTrue("Update candidate was promoted without live probes",candidateProbes.get()>0)
            assertEquals(4,host.list().getValue("installed").jsonArray.single().jsonObject.getValue("version").jsonPrimitive.int)
            val id=host.list().getValue("installed").jsonArray.single().jsonObject
                .getValue("sourceIds").jsonArray.single().jsonPrimitive.content
            repeat(3) {
                runCatching { engine.adapter(id)!!.page(Listing.POPULAR,1) }
                    .onSuccess { fail("Injected provider failure was ignored") }
            }
            val recovered=host.list().getValue("installed").jsonArray.single().jsonObject
            assertTrue("Three genuine source failures were not injected",failures.get()>=3)
            assertTrue("Old published DEX never completed a live health comparison",oldProbes.get()>0)
            assertEquals("Automatic recovery did not re-activate the previous version",3,recovered.getValue("version").jsonPrimitive.int)
            assertArrayEquals("Automatic recovery modified watchlist/history",before,sentinel.readBytes())
        }finally{
            host.close();engine.setRuntimeSources(emptyList())
            original.delete();updated.delete();sentinel.delete()
        }
    }
}
