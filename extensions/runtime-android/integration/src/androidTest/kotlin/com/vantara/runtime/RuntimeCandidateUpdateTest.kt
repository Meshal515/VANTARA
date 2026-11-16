package com.vantara.runtime

import android.app.Application
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.AnimeEngine
import com.vantara.plugins.ensureEngineInjekt
import dev.vantara.runtime.android.AndroidRuntimeClient
import dev.vantara.runtime.api.RuntimeHttpAccess
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

/**
 * Synthetic publisher revision of a real pinned CloudStream APK-compatible DEX.
 * Does not imply the source website is healthy; proves a failed candidate probe
 * leaves the last known installed revision and unrelated user bytes intact.
 */
class RuntimeCandidateUpdateTest {
    @Test fun brokenCandidateNeverReplacesLastInstalledRuntimeRevision() = runBlocking {
        val ins = InstrumentationRegistry.getInstrumentation()
        val context = ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine = AnimeEngine.get(context)
        val probes = AtomicInteger(0)
        val host = RuntimeHost(context, engine, "VANTARA candidate safety test", sourceTransport = { scope, _ ->
            object : AndroidRuntimeClient.HostHttpTransport {
                override fun exchange(caller: AndroidRuntimeClient.Scope, request: RuntimeHttpAccess.Request): RuntimeHttpAccess.Response {
                    if (scope.sourceId().contains("|candidate|")) {
                        probes.incrementAndGet()
                        throw IOException("SYNTHETIC_CANDIDATE_CATALOGUE_UNREACHABLE")
                    }
                    throw IOException("Unexpected current-source network request")
                }
            }
        })
        val original = File.createTempFile("runtime-good-", ".cs3", context.cacheDir)
        val updated = File.createTempFile("runtime-bad-update-", ".cs3", context.cacheDir)
        val sentinel = File.createTempFile("runtime-unrelated-user-data-", ".json", context.filesDir)
        val pkg = RuntimeHost.packageId("https://repo.example/update-preflight", "Animewitcher")
        try {
            host.setProfile("candidate-regression-" + UUID.randomUUID())
            ins.context.assets.open("Animewitcher.cs3").use { input -> original.outputStream().use { input.copyTo(it) } }
            val pin = ins.context.assets.open("Animewitcher.json").bufferedReader().use { RuntimeJson.parse(it.readText()).jsonObject }
            val first = host.installFile(original, pin.text("packageSha256"), pkg, buildJsonObject {
                put("internalName", "Animewitcher"); put("content", "anime"); put("enabled", true)
                put("description", "last-known-installed")
            })
            assertEquals(3, first.getValue("version").jsonPrimitive.int)
            val existing = host.list().getValue("installed").jsonArray.single().jsonObject
            sentinel.writeText("""{"progress":42,"watchlist":["work-1"]}""")
            val before = sentinel.readBytes()

            // Repackage the exact same genuine DEX with a higher *test* manifest
            // version. This is a failure-injection fixture, not a publisher update.
            ZipFile(original).use { zip ->
                ZipOutputStream(updated.outputStream()).use { output ->
                    zip.entries().asSequence().forEach { entry ->
                        val bytes = zip.getInputStream(entry).use { it.readBytes() }
                        val payload = if (entry.name == "manifest.json") {
                            val manifest = RuntimeJson.parse(bytes.decodeToString()).jsonObject
                            JsonObject(manifest + mapOf("version" to JsonPrimitive(4))).toString().toByteArray()
                        } else bytes
                        output.putNextEntry(ZipEntry(entry.name))
                        output.write(payload)
                        output.closeEntry()
                    }
                }
            }
            val failure = runCatching {
                host.installFile(updated, RuntimeHost.digest(updated.readBytes()), pkg, buildJsonObject {
                    put("internalName", "Animewitcher"); put("content", "anime"); put("enabled", true)
                    put("description", "reject-this-broken-update")
                })
            }.exceptionOrNull()
            assertNotNull("Broken candidate silently replaced a working plugin", failure)
            assertTrue("Candidate catalogue was never actually probed", probes.get() > 0)
            assertEquals("Candidate failure changed installed plugin version", 3,
                host.list().getValue("installed").jsonArray.single().jsonObject.getValue("version").jsonPrimitive.int)
            assertEquals("The entire installed metadata changed", existing, host.list().getValue("installed").jsonArray.single().jsonObject)
            assertArrayEquals("A plugin update modified unrelated saved user data", before, sentinel.readBytes())
        } finally {
            host.close(); engine.setRuntimeSources(emptyList())
            original.delete(); updated.delete(); sentinel.delete()
        }
    }
}
