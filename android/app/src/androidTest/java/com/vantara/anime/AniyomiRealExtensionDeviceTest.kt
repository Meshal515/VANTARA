package com.vantara.anime

import android.app.Application
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.loader.AnimeExtensionLoader
import com.vantara.anime.registry.ExtensionRef
import com.vantara.plugins.RepoClient
import com.vantara.plugins.ensureEngineInjekt
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.security.MessageDigest

/** Real third-party Aniyomi APK, verified against its repository signing key. No fake sources. */
class AniyomiRealExtensionDeviceTest {
    @Test fun publisherApkExposesAllSourceFactoryIdentities() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Live Aniyomi APK test is explicitly opt-in", args.getString("vantaraAniyomiReal") == "true")
        val base = args.getString("vantaraAniyomiRepository")
            ?: "https://raw.githubusercontent.com/msrofficial/anime-repo/repo"
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val http = Injekt.get<NetworkHelper>().client
        val repo = RepoClient(context, http)
        val (meta, index) = withTimeout(60_000) { repo.read(base) }
        val entry = index.firstOrNull { it.anime && !it.nsfw && it.sources.isNotEmpty() }
            ?: error("ANIYOMI_REPO_NO_SAFE_SOURCES")
        val bytes = withTimeout(90_000) { repo.downloadSigned(entry.apkUrl, meta.fingerprint) }
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        val loader = AnimeExtensionLoader(context, http)
        val reference = ExtensionRef(entry.pkg, entry.apkUrl, sha, version = entry.version)
        val factory = loader.inspect(reference, bytes)
        val factoryIds = factory.map { it.id.toString() }
        assertTrue("Actual Aniyomi APK must expose real sources", factory.isNotEmpty())
        assertEquals("Factory source IDs must be unique", factoryIds.size, factoryIds.toSet().size)
        for (source in factory) {
            val selected = loader.load(reference.copy(sourceId = source.id.toString()), bytes)
            assertEquals(source.id.toString(), selected.id.toString())
        }
        assertTrue("Publisher-declared source IDs should exist in actual APK",
            entry.sources.all { it.id in factoryIds })
        android.util.Log.i("VANTARA_ANIYOMI_REAL",
            "PASS package=${entry.pkg} sources=${factoryIds.size} verified_sha256=$sha")
    }
}
