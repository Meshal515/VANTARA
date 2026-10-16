package com.vantara.plugins

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RepoIndexTest {
    private val base = "https://raw.githubusercontent.com/keiyoushi/extensions/repo"
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

    // protobuf صغير بنفس حقول index.pb لدى Keiyoushi
    private fun varint(v: Long): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        var x = v
        while (true) {
            if ((x and 0x7fL.inv()) == 0L) { out.write(x.toInt()); break }
            out.write(((x and 0x7f) or 0x80).toInt()); x = x ushr 7
        }
        return out.toByteArray()
    }
    private fun field(f: Int, bytes: ByteArray) = varint((f.toLong() shl 3) or 2) + varint(bytes.size.toLong()) + bytes
    private fun field(f: Int, text: String) = field(f, text.toByteArray())
    private fun num(f: Int, v: Long) = varint(f.toLong() shl 3) + varint(v)
    private fun source(id: Long, name: String, lang: String) = field(8, num(1, id) + field(2, name) + field(3, lang))
    private fun ext(name: String, pkg: String, warning: Long, vararg sources: ByteArray) =
        field(1, field(1, name) + field(2, pkg) + field(3, field(1, "https://github.com/keiyoushi/extensions/releases/download/x/$pkg.apk")) +
            field(4, "1.6") + num(5, 106004) + field(6, "1.6.4") + num(7, warning) + sources.fold(ByteArray(0)) { a, b -> a + b })

    @Test fun acceptsTheRepoOrAnyOfItsFiles() {
        assertEquals(base, RepoIndex.base(base))
        assertEquals(base, RepoIndex.base("$base/index.min.json"))
        assertEquals(base, RepoIndex.base("$base/repo.json/"))
        assertThrows(IllegalArgumentException::class.java) { RepoIndex.base("http://example.com/repo") }
        assertThrows(IllegalArgumentException::class.java) { RepoIndex.base("https://example.com:8443/repo") }
    }

    @Test fun parsesTheJsonIndexAndRejectsUnsafeFileNames() {
        val list = RepoIndex.parseIndex(index, base)
        assertEquals(listOf("3asq", "MangaDex", "Asura"), list.map { it.name })
        assertEquals("$base/apk/tachiyomi-ar.manga3asq-v1.4.59.apk", list[0].apkUrl)
        assertEquals(1.4, list[0].lib, 0.0)
        assertTrue(list[1].nsfw)
    }

    @Test fun showsArabicSourcesFirstOtherwiseTheExtensionLanguage() {
        val list = RepoIndex.parseIndex(index, base)
        assertEquals(listOf("2"), RepoIndex.visibleSources(list[1]).map { it.id })
        assertEquals(listOf("9"), RepoIndex.visibleSources(list[2]).map { it.id })
    }

    @Test fun readsTheGzippedProtobufIndexKeiyoushiPublishesToday() {
        val fp = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"
        val raw = field(1, "Keiyoushi") + field(2, "KEI") + field(3, fp) + field(
            101,
            ext("Azora", "eu.kanade.tachiyomi.extension.ar.azora", 1, source(2482399499047903203, "Azora", "ar")) +
                ext("MangaDex", "eu.kanade.tachiyomi.extension.all.mangadex", 2, source(1, "MangaDex", "en"), source(-3339599426223341161, "MangaDex", "ar")) +
                ext("Adult", "eu.kanade.tachiyomi.extension.ar.adult", 3, source(5, "X", "ar")),
        )
        val gz = java.io.ByteArrayOutputStream().also { java.util.zip.GZIPOutputStream(it).use { z -> z.write(raw) } }.toByteArray()
        val (meta, list) = RepoIndex.parseIndexV2(gz)
        assertEquals("Keiyoushi", meta.name)
        assertEquals(fp, meta.fingerprint)
        assertEquals(listOf("Azora", "MangaDex", "Adult"), list.map { it.name })
        assertEquals("https://github.com/keiyoushi/extensions/releases/download/x/eu.kanade.tachiyomi.extension.ar.azora.apk", list[0].apkUrl)
        assertEquals(1.6, list[0].lib, 0.0)
        assertEquals("ar", list[0].lang)
        assertEquals("all", list[1].lang)
        // معرّف المصدر Long بإشارته كما يعطيه source.id في الإضافة
        assertEquals(listOf("-3339599426223341161"), RepoIndex.visibleSources(list[1]).map { it.id })
        assertTrue(list[2].nsfw)
        assertTrue(!list[1].nsfw)
    }

    @Test fun repoJsonPointsToTheV2Index() {
        assertEquals(
            "https://github.com/keiyoushi/extensions/raw/repo/index.pb",
            RepoIndex.indexV2("{\"index_v2\":\"https://github.com/keiyoushi/extensions/raw/repo/index.pb\",\"meta\":{}}"),
        )
        assertNull(RepoIndex.indexV2("{\"index_v2\":\"http://x.com/index.pb\",\"meta\":{}}"))
        assertNull(RepoIndex.indexV2("{\"meta\":{}}"))
    }

    @Test fun aRepoWithoutASigningKeyIsRefused() {
        val ok = RepoIndex.parseMeta("{\"meta\":{\"name\":\"Keiyoushi\",\"signingKeyFingerprint\":\"9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2\"}}")
        assertEquals("Keiyoushi", ok.name)
        assertThrows(IllegalArgumentException::class.java) { RepoIndex.parseMeta("{\"meta\":{\"name\":\"X\"}}") }
    }
}
