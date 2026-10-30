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

    @Test fun onlyExposesDeclaredHttpsLogosAndNeverGuessesAnIconUrl() {
        val fingerprint = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"
        fun meta(logo: String) = RepoIndex.parseMeta("""{"meta":{"name":"Example","signingKeyFingerprint":"$fingerprint","logo":"$logo"}}""")
        assertEquals("https://example.com/logo.png", meta("https://example.com/logo.png").iconUrl)
        assertNull(meta("http://example.com/logo.png").iconUrl)
        assertNull(meta("https://user:secret@example.com/logo.png").iconUrl)
        assertNull(meta("/logo.png").iconUrl)
        assertNull(meta("").iconUrl)
        assertNull(RepoIndex.parseMeta("""{"meta":{"name":"Example","signingKeyFingerprint":"$fingerprint","logo":{"url":"https://example.com/logo.png"}}}""").iconUrl)
        assertNull(RepoIndex.parseIndex(index, base)[0].iconUrl)
        assertEquals("https://example.com/icon.png", RepoIndex.parseIndex(index.replace("\"nsfw\":0,", "\"nsfw\":0,\"iconUrl\":\"https://example.com/icon.png\","), base)[0].iconUrl)
    }

    @Test fun addingRepoLogosPreservesLegacyInstalledPackagesAndSourceIds() {
        val directory = java.nio.file.Files.createTempDirectory("repo-icons-test").toFile()
        try {
            val file = java.io.File(directory, "user-repos.json")
            file.writeText("""{
              "repos":[{"url":"$base","name":"Example","fingerprint":"pinned"}],
              "extensions":[{"repoUrl":"$base","name":"Installed","pkg":"example.extension",
                "apkUrl":"$base/apk/installed.apk","sha256":"retained-sha","versionName":"1.4.1",
                "lib":1.4,"lang":"ar","nsfw":false,"sources":[{"id":"-123","name":"Source","lang":"ar"}]}]
            }""")
            val store = UserExtensionStore(file)
            val old = store.state
            assertEquals(1, old.extensions.size)
            assertNull(old.repos.single().iconUrl)
            store.update { it.copy(repos = it.repos.map { repo -> repo.copy(iconUrl = "https://example.com/logo.png") }) }
            val reloaded = UserExtensionStore(file).state
            assertEquals(old.extensions, reloaded.extensions)
            assertEquals(old.repos.single().url, reloaded.repos.single().url)
            assertEquals("-123", reloaded.extensions.single().sources.single().id)
            assertEquals("pinned", reloaded.repos.single().fingerprint)
            assertEquals("https://example.com/logo.png", reloaded.repos.single().iconUrl)
        } finally { directory.deleteRecursively() }
    }

    private val fp = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"

    @Test fun readsTheDeclaredVersionCodeInsteadOfGuessingItFromTheName() {
        // Keiyoushi: «1.6.4» رقمه 106004 في الفهرس الحالي، فلا يُستنتج الرقم من الاسم
        val (_, list) = RepoIndex.parseIndexV2(field(1, "K") + field(3, fp) + field(101, ext("Azora", "eu.kanade.tachiyomi.extension.ar.azora", 1, source(1, "Azora", "ar"))))
        assertEquals(106004L, list.single().versionCode)
        // الفهرس القديم index.min.json: الحقل code إن وُجد، وإلا 0 (لا مقارنة)
        val v1 = RepoIndex.parseIndex(index, base)
        assertEquals(59L, v1[0].versionCode)
        assertEquals(0L, v1[1].versionCode)
    }

    @Test fun anIndexMayMoveItsListToASeparateFileFollowedOnce() {
        val (meta, list) = RepoIndex.parseIndexV2(field(1, "K") + field(3, fp) + field(102, "https://example.com/list.pb"))
        assertEquals("https://example.com/list.pb", meta.extensionListUrl)
        assertTrue(list.isEmpty())
        val separate = RepoIndex.parseExtensionList(ext("Azora", "eu.kanade.tachiyomi.extension.ar.azora", 1, source(7, "Azora", "ar")))
        assertEquals(listOf("eu.kanade.tachiyomi.extension.ar.azora"), separate.map { it.pkg })
        // رابط غير آمن لا يُتبع
        assertNull(RepoIndex.parseIndexV2(field(1, "K") + field(3, fp) + field(102, "http://example.com/list.pb")).first.extensionListUrl)
    }

    @Test fun aPackageNameThatCouldEscapeTheVaultIsDropped() {
        val (_, list) = RepoIndex.parseIndexV2(
            field(1, "K") + field(3, fp) + field(101, ext("Evil", "..", 1, source(1, "x", "ar")) + ext("Evil2", "a..b", 1, source(2, "x", "ar")) +
                ext("Evil3", ".hidden.pkg", 1, source(3, "x", "ar")) + ext("Ok", "eu.kanade.tachiyomi.extension.ar.ok", 1, source(4, "x", "ar"))),
        )
        assertEquals(listOf("Ok"), list.map { it.name })
    }
}
