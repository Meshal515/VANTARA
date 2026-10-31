package com.vantara.anime

import com.vantara.anime.registry.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Binary-package source federation; stable data identities survive app upgrades. */
class AniyomiMultiSourceTest {
    private val pkg = "eu.kanade.tachiyomi.animeextension.all.fixture"
    private val hash = "a".repeat(64)
    private fun installed() = UserAnimeExtension(
        repoUrl = "https://repo.example", name = "Fixture", pkg = pkg,
        apkUrl = "https://repo.example/fixture.apk", sha256 = hash, version = "14.26",
        content = "anime", sourceName = "Mirror", baseUrl = "https://first.example",
        stableId = "user-$pkg", sourceLang = "en", primarySourceId = "100",
        additionalSources = listOf(
            InstalledAnimeSource("200", "user-$pkg#200", "Mirror", "ar", "https://second.example"),
            InstalledAnimeSource("300", "user-$pkg#300", "Alternative", "fr", "https://third.example"),
        ),
    )

    @Test fun allFactorySourcesBecomeIndependentEngineSources() {
        val user = installed()
        val entries = user.entries()
        assertEquals(3, entries.size)
        assertEquals(listOf("100", "200", "300"), entries.map { it.extension?.sourceId })
        assertEquals(3, entries.map { it.id }.distinct().size)
        assertTrue(entries.all { it.extension?.pkg == pkg && it.extension?.sha256 == hash })
        assertEquals(listOf("en", "ar", "fr"), entries.map { it.lang })
        assertEquals("user-$pkg", entries.first().id)
        assertEquals("user-$pkg#200", entries[1].id)
    }

    @Test fun duplicateSourceNamesNeverCollapseDifferentSourceIds() {
        val entries = installed().entries()
        assertEquals("Mirror", entries.first().name)
        assertEquals("Mirror", entries[1].name)
        assertFalse(entries.first().extension?.sourceId == entries[1].extension?.sourceId)
        assertEquals(3, mergeUserSources(Manifest(), entries).sources.size)
    }

    @Test fun serializedStoreRestoresAllSourcesAndStableIdentity() {
        val encoded = Json.encodeToString(UserAnimeState(extensions = listOf(installed())))
        val restored = Json.decodeFromString<UserAnimeState>(encoded)
        assertEquals(installed().entries().map { it.id }, restored.extensions.single().entries().map { it.id })
        assertEquals(listOf("100", "200", "300"), restored.extensions.single().entries().map { it.extension?.sourceId })
    }

    @Test fun legacyUsersKeepHistoricalPrimaryIdentityAndRetainNewFieldsAsDefaults() {
        val legacy = UserAnimeExtension(
            repoUrl = "https://repo.example", name = "Legacy",
            pkg = "dev.first.anime", apkUrl = "https://repo.example/a.apk",
            sha256 = hash, version = "14.26", content = "anime",
            sourceName = null, baseUrl = "https://old.example",
        )
        val encoded = Json.encodeToString(legacy)
        val restored = Json.decodeFromString<UserAnimeExtension>(encoded)
        assertEquals("user-anime", restored.id)
        assertEquals(1, restored.entries().size)
        assertEquals(null, restored.entry().extension?.sourceId)
    }
}
