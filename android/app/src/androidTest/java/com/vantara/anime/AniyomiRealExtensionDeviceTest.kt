package com.vantara.anime

import android.app.Application
import androidx.test.platform.app.InstrumentationRegistry
import com.vantara.anime.loader.AnimeExtensionLoader
import com.vantara.anime.registry.ExtensionRef
import com.vantara.anime.registry.UserAnimeExtension
import com.vantara.anime.registry.InstalledAnimeSource
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import org.junit.Assert.assertNotNull
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
            ?: "https://raw.githubusercontent.com/yuzono/anime-repo/repo"
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val http = Injekt.get<NetworkHelper>().client
        val repo = RepoClient(context, http)
        val (meta, index) = withTimeout(60_000) { repo.read(base) }
        // Publicly published, signed Yuzono multi-source factory: nine language variants.
        val entry = index.firstOrNull { it.pkg.endsWith(".animeworldindia") && it.anime && !it.nsfw && it.sources.size > 1 }
            ?: error("ANIYOMI_REPO_NO_SIGNED_MULTI_SOURCE_FACTORY")
        val bytes = withTimeout(90_000) { repo.downloadSigned(entry.apkUrl, meta.fingerprint) }
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        val loader = AnimeExtensionLoader(context, http)
        val reference = ExtensionRef(entry.pkg, entry.apkUrl, sha, version = entry.version)
        val factory = loader.inspect(reference, bytes)
        val factoryIds = factory.map { it.id.toString() }
        assertTrue("A real multi-source Aniyomi factory must expose multiple sources", factory.size > 1)
        assertEquals("Factory source IDs must be unique", factoryIds.size, factoryIds.toSet().size)
        for (source in factory) {
            val selected = loader.load(reference.copy(sourceId = source.id.toString()), bytes)
            assertEquals(source.id.toString(), selected.id.toString())
        }
        assertTrue("Publisher-declared source IDs should exist in actual APK",
            entry.sources.all { it.id in factoryIds })
        val first = factory.first()
        val baseUrls = entry.sources.associateBy { it.id }
        val profile = UserAnimeExtension(
            repoUrl = base, name = entry.name, pkg = entry.pkg, apkUrl = entry.apkUrl,
            sha256 = sha, version = entry.version, content = "anime",
            sourceName = first.name,
            baseUrl = (first as? AnimeHttpSource)?.baseUrl
                ?: baseUrls[first.id.toString()]?.baseUrl.orEmpty().ifBlank { "https://unknown.invalid" },
            stableId = "user-${entry.pkg}", sourceLang = first.lang,
            primarySourceId = first.id.toString(),
            additionalSources = factory.drop(1).map { source ->
                InstalledAnimeSource(
                    sourceId = source.id.toString(), id = "user-${entry.pkg}#${source.id}",
                    name = source.name, lang = source.lang,
                    baseUrl = (source as? AnimeHttpSource)?.baseUrl
                        ?: baseUrls[source.id.toString()]?.baseUrl.orEmpty().ifBlank { "https://unknown.invalid" },
                )
            },
        )
        val entries = profile.entries()
        assertEquals("Every real factory source must get a distinct stable VANTARA ID",
            factory.size, entries.map { it.id }.toSet().size)
        val engine = AnimeEngine.get(context)
        try {
            engine.setUserSources(entries)
            for (source in entries) {
                assertTrue("Source missing from engine registry: ${source.id}",
                    engine.sources().any { it.id == source.id })
                val routed = withTimeout(30_000) { engine.adapter(source.id) }
                assertNotNull("Actual APK factory source cannot be routed: ${source.id}", routed)
            }
        } finally {
            engine.setUserSources(emptyList())
        }
        android.util.Log.i("VANTARA_ANIYOMI_REAL",
            "PASS package=${entry.pkg} sources=${factoryIds.size} verified_sha256=$sha")
    }
}
