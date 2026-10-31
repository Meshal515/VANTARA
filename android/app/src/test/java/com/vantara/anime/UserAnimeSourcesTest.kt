package com.vantara.anime

import com.vantara.anime.registry.UserAnimeExtension
import com.vantara.anime.registry.UserAnimeSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class UserAnimeSourcesTest {
    private fun extension(sources: List<UserAnimeSource> = emptyList(), sourceName: String? = null) =
        UserAnimeExtension(
            repoUrl = "https://repo.example", name = "Anime package", pkg = "eu.kanade.tachiyomi.animeextension.ar.sample",
            apkUrl = "https://repo.example/sample.apk", sha256 = "a".repeat(64),
            version = "14.26", content = "anime", sourceName = sourceName,
            baseUrl = "https://anime.example", sources = sources,
        )

    @Test fun legacyIdSurvivesMigration() {
        val old = extension()
        val migrated = extension(listOf(
            UserAnimeSource("123", "First", "ar", "https://a.example"),
            UserAnimeSource("456", "Second", "en", "https://b.example"),
        ))
        assertEquals(old.id, migrated.entries().first().id)
        assertEquals(2, migrated.entries().size)
        assertEquals("123", migrated.entries()[0].extension?.sourceId)
        assertEquals("456", migrated.entries()[1].extension?.sourceId)
        assertNotEquals(migrated.entries()[0].id, migrated.entries()[1].id)
    }

    @Test fun previousPrimarySourceRetainsItsIdAfterReordering() {
        val sources = listOf(
            UserAnimeSource("123", "First", "ar", "https://a.example"),
            UserAnimeSource("456", "Second", "en", "https://b.example"),
        )
        val entries = extension(sources, sourceName = "Second").entries()
        assertEquals("Second", entries[0].name)
        assertEquals("456", entries[0].extension?.sourceId)
        assertEquals("First", entries[1].name)
    }

    @Test fun legacySingleSourceRecordStillHasOneEntry() {
        val entries = extension().entries()
        assertEquals(1, entries.size)
        assertEquals("user-sample", entries[0].id)
        assertEquals(null, entries[0].extension?.sourceId)
    }
}
