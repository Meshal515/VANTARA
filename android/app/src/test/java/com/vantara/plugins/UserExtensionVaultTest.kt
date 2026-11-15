package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** الإضافات المستمرة: آخر إصدار سليم وترحيل معرّفات المصادر (docs/addons/PERSISTENT_PLUGINS.md). */
class UserExtensionVaultTest {
    // ar.mangahub في Keiyoushi غيّر معرّف مصدره بين 2026-08-13 واليوم
    private val oldHub = UserSource("9160891278578525988", "MangaHub", "ar")
    private val newHub = UserSource("1214953877894211809", "MangaHub", "ar")

    private fun ext(sha: Char, version: String, sources: List<UserSource>) = UserExtension(
        repoUrl = "https://raw.githubusercontent.com/keiyoushi/extensions/repo", name = "MangaHub",
        pkg = "eu.kanade.tachiyomi.extension.ar.mangahub", apkUrl = "https://example.invalid/$version.apk",
        sha256 = sha.toString().repeat(64), versionName = version, lib = 1.6, lang = "ar", nsfw = false, sources = sources,
    )

    @Test fun `an update keeps the old version as last known good and migrates a changed source id`() {
        val v1 = ext('a', "1.6.1", listOf(oldHub))
        val v2 = v1.upgradedTo(ext('b', "1.6.2", listOf(newHub)))
        assertEquals("b".repeat(64), v2.sha256)
        assertEquals("a".repeat(64), v2.previous?.sha256)
        assertEquals("a".repeat(64), v2.previousSpec()?.sha256)
        assertEquals(setOf(oldHub.id), v2.previousSpec()?.arabicSourceIds)
        // المكتبة محفوظة بالمعرّف القديم وتصل للمصدر الجديد
        assertEquals(newHub.id, v2.resolve(oldHub.id))
        assertEquals(newHub.id, v2.resolve(newHub.id))
    }

    @Test fun `reinstalling the same bytes does not replace the last known good with itself`() {
        val v2 = ext('a', "1.6.1", listOf(oldHub)).upgradedTo(ext('b', "1.6.2", listOf(newHub)))
        val again = v2.upgradedTo(ext('b', "1.6.2", listOf(newHub)))
        assertEquals("a".repeat(64), again.previous?.sha256)
    }

    @Test fun `rolling back restores the previous version and keeps both ids reachable`() {
        val v2 = ext('a', "1.6.1", listOf(oldHub)).upgradedTo(ext('b', "1.6.2", listOf(newHub)))
        val back = v2.rolledBack()!!
        assertEquals("a".repeat(64), back.sha256)
        assertNull(back.previous)
        assertEquals(oldHub.id, back.resolve(newHub.id))
        assertEquals(oldHub.id, back.resolve(oldHub.id))
        assertNull(back.rolledBack())
    }

    @Test fun `an ambiguous match is never migrated automatically`() {
        val twins = listOf(UserSource("1", "MangaHub", "ar"), UserSource("2", "MangaHub", "ar"))
        assertEquals(emptyMap<String, String>(), sourceAliases(listOf(oldHub), twins))
        // اسم مختلف أو لغة مختلفة: لا ترحيل
        assertEquals(emptyMap<String, String>(), sourceAliases(listOf(oldHub), listOf(UserSource("3", "MangaHub", "en"))))
        assertEquals(emptyMap<String, String>(), sourceAliases(listOf(oldHub), listOf(UserSource("4", "Other", "ar"))))
    }

    @Test fun `an alias cycle cannot hang source resolution`() {
        val looping = ext('a', "1", listOf(UserSource("9", "X", "ar"))).copy(aliases = mapOf("1" to "2", "2" to "1"))
        assertEquals("1", looping.resolve("1"))
    }
}
