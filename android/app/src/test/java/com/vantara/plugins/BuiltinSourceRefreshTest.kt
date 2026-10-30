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

class BuiltinVisibilityTest {
    @Test fun `no report yet is distinct from an empty account`() {
        val dir = Files.createTempDirectory("visible").toFile()
        val store = BuiltinVisibility(File(dir, "builtin-visible.json"))
        assertEquals(null, store.read())
        store.write(emptySet())
        assertEquals(emptySet<String>(), store.read())
        store.write(setOf("b.pkg", "a.pkg"))
        assertEquals(setOf("a.pkg", "b.pkg"), BuiltinVisibility(File(dir, "builtin-visible.json")).read())
    }

    @Test fun `a corrupt file reads as not reported`() {
        val dir = Files.createTempDirectory("visible").toFile()
        val file = File(dir, "builtin-visible.json").apply { writeText("[broken") }
        assertEquals(null, BuiltinVisibility(file).read())
    }
}

class BuiltinRefreshConfirmTest {
    @Test fun `a downloaded version is pinned only when confirmed`() {
        val dir = Files.createTempDirectory("confirm").toFile()
        val file = File(dir, "builtin-refresh.json")
        val base = SourceSpec(
            label = "Dilar", pkg = "eu.kanade.tachiyomi.extension.ar.dilar", expectedLib = 1.6,
            apkUrl = "https://old/dilar.apk", sha256 = "a".repeat(64), versionName = "1.6.1", warning = ContentWarning.SAFE,
            arabicSourceIds = setOf("1"), arabicSourceNames = listOf("ديلار"), blockedReason = null,
        )
        val refresh = BuiltinSourceRefresh(file)
        assertSame(base, refresh.current(base))
        val next = base.copy(sha256 = "c".repeat(64), apkUrl = "https://new/dilar.apk", versionName = "1.6.9")
        refresh.confirm(next)
        assertEquals("c".repeat(64), BuiltinSourceRefresh(file).current(base).sha256)
        assertEquals(base.pkg, BuiltinSourceRefresh(file).current(base).pkg)
    }
}
