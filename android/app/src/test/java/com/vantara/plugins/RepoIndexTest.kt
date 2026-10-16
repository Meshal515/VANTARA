package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class RepoIndexTest {
    private val index = """
        [
          {"name":"Tachiyomi: 3asq","pkg":"eu.kanade.tachiyomi.extension.ar.manga3asq","apk":"tachiyomi-ar.manga3asq-v1.4.59.apk","lang":"ar","code":59,"version":"1.4.59","nsfw":0,
           "sources":[{"name":"مانجا العاشق","lang":"ar","id":"1073624495230267708","baseUrl":"https://3asq.org"}]},
          {"name":"Tachiyomi: MangaDex","pkg":"eu.kanade.tachiyomi.extension.all.mangadex","apk":"tachiyomi-all.mangadex-v1.4.200.apk","lang":"all","version":"1.4.200","nsfw":1,
           "sources":[{"name":"MangaDex","lang":"en","id":"1"},{"name":"MangaDex","lang":"ar","id":"2"}]},
          {"name":"Tachiyomi: Asura","pkg":"eu.kanade.tachiyomi.extension.en.asura","apk":"tachiyomi-en.asura-v1.4.5.apk","lang":"en","version":"1.4.5","nsfw":0,
           "sources":[{"name":"Asura Scans","lang":"en","id":"9"}]},
          {"name":"bad","pkg":"x","apk":"../evil.apk","version":"1.4.1"}
        ]
    """.trimIndent()

    @Test fun acceptsTheRepoOrAnyOfItsFiles() {
        val base = "https://raw.githubusercontent.com/keiyoushi/extensions/repo"
        assertEquals(base, RepoIndex.base(base))
        assertEquals(base, RepoIndex.base("$base/index.min.json"))
        assertEquals(base, RepoIndex.base("$base/repo.json/"))
        assertThrows(IllegalArgumentException::class.java) { RepoIndex.base("http://example.com/repo") }
        assertThrows(IllegalArgumentException::class.java) { RepoIndex.base("https://example.com:8443/repo") }
    }

    @Test fun parsesExtensionsAndRejectsUnsafeFileNames() {
        val list = RepoIndex.parseIndex(index)
        assertEquals(listOf("3asq", "MangaDex", "Asura"), list.map { it.name })
        assertEquals(1.4, list[0].lib, 0.0)
        assertTrue(list[1].nsfw)
    }

    @Test fun showsArabicSourcesFirstOtherwiseTheExtensionLanguage() {
        val list = RepoIndex.parseIndex(index)
        assertEquals(listOf("2"), RepoIndex.visibleSources(list[1]).map { it.id })
        assertEquals(listOf("9"), RepoIndex.visibleSources(list[2]).map { it.id })
    }

    @Test fun aRepoWithoutASigningKeyIsRefused() {
        val ok = RepoIndex.parseMeta("""{"meta":{"name":"Keiyoushi","signingKeyFingerprint":"9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"}}""")
        assertEquals("Keiyoushi", ok.name)
        assertThrows(IllegalArgumentException::class.java) { RepoIndex.parseMeta("""{"meta":{"name":"X"}}""") }
    }
}
