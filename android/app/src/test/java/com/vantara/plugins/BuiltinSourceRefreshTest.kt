package com.vantara.plugins

import dev.vantara.spike.ContentWarning
import dev.vantara.spike.SourceSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import java.io.File
import java.nio.file.Files

class BuiltinSourceRefreshTest {
    private val base = SourceSpec(
        label = "MangaSwat", pkg = "eu.kanade.tachiyomi.extension.ar.mangaswat", expectedLib = 1.6,
        apkUrl = "https://github.com/keiyoushi/extensions/releases/download/old/swat-v1.6.1.apk",
        sha256 = "a".repeat(64), versionName = "1.6.1", warning = ContentWarning.SAFE,
        arabicSourceIds = setOf("123"), arabicSourceNames = listOf("مانجا سوات"), blockedReason = null,
    )

    @Test fun `without a refreshed version the bundled spec is used as is`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        assertSame(base, BuiltinSourceRefresh(File(dir, "builtin-refresh.json")).current(base))
    }

    @Test fun `a refreshed official version keeps the source identity and changes only the file`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val file = File(dir, "builtin-refresh.json")
        file.writeText("""{"eu.kanade.tachiyomi.extension.ar.mangaswat":{"sha256":"${"b".repeat(64)}","apkUrl":"https://github.com/keiyoushi/extensions/raw/repo/apk/swat-v1.6.61.apk","versionName":"1.6.61","lib":1.6}}""")
        val now = BuiltinSourceRefresh(file).current(base)
        assertEquals(base.pkg, now.pkg)
        assertEquals(base.arabicSourceIds, now.arabicSourceIds)
        assertEquals("b".repeat(64), now.sha256)
        assertEquals("1.6.61", now.versionName)
    }

    @Test fun `a corrupt refresh file falls back to the bundled spec`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val file = File(dir, "builtin-refresh.json").apply { writeText("{broken") }
        assertSame(base, BuiltinSourceRefresh(file).current(base))
    }
}
