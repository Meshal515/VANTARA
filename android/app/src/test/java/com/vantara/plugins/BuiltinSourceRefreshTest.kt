package com.vantara.plugins

import dev.vantara.spike.ContentWarning
import dev.vantara.spike.SourceSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    private fun refreshed(sha: Char, version: String) = base.copy(sha256 = sha.toString().repeat(64), versionName = version, apkUrl = "https://example.invalid/$version.apk")

    @Test fun `a newer official version keeps the previous one as last known good`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val pins = BuiltinSourceRefresh(File(dir, "builtin-refresh.json"))
        assertNull(pins.previousOf(base))
        pins.confirm(refreshed('b', "1.6.61"))
        assertNull("the bundled copy is the implicit fallback before the first refresh", pins.previousOf(base))
        pins.confirm(refreshed('c', "1.6.62"))
        assertEquals("c".repeat(64), pins.current(base).sha256)
        assertEquals("b".repeat(64), pins.previousOf(base)?.sha256)
        assertEquals(setOf("c".repeat(64), "b".repeat(64)), pins.keep(base.pkg))
        // يبقى بعد إعادة الفتح: الملف هو المرجع
        val reopened = BuiltinSourceRefresh(File(dir, "builtin-refresh.json"))
        assertEquals("b".repeat(64), reopened.previousOf(base)?.sha256)
    }

    @Test fun `confirming the same version again does not erase the last known good`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val pins = BuiltinSourceRefresh(File(dir, "builtin-refresh.json"))
        pins.confirm(refreshed('b', "1.6.61"))
        pins.confirm(refreshed('c', "1.6.62"))
        pins.confirm(refreshed('c', "1.6.62"))
        assertEquals("b".repeat(64), pins.previousOf(base)?.sha256)
    }

    @Test fun `a broken current version rolls back to the last known good, then to the bundled copy`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val pins = BuiltinSourceRefresh(File(dir, "builtin-refresh.json"))
        pins.confirm(refreshed('b', "1.6.61"))
        pins.confirm(refreshed('c', "1.6.62"))
        assertEquals(setOf("b".repeat(64)), pins.rollback(base.pkg))
        assertEquals("b".repeat(64), pins.current(base).sha256)
        assertNull(pins.previousOf(base))
        assertEquals(emptySet<String>(), pins.rollback(base.pkg))
        assertSame(base, pins.current(base))
    }

    @Test fun `reset returns to the bundled copy`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val pins = BuiltinSourceRefresh(File(dir, "builtin-refresh.json"))
        pins.confirm(refreshed('b', "1.6.61"))
        pins.reset(base.pkg)
        assertSame(base, pins.current(base))
    }

    @Test fun `a pin file from before last known good still reads`() {
        val dir = Files.createTempDirectory("refresh").toFile()
        val file = File(dir, "builtin-refresh.json")
        file.writeText("""{"${base.pkg}":{"sha256":"${"b".repeat(64)}","apkUrl":"https://x.invalid/a.apk","versionName":"1.6.61","lib":1.6}}""")
        val pins = BuiltinSourceRefresh(file)
        assertEquals("b".repeat(64), pins.current(base).sha256)
        assertNull(pins.previousOf(base))
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

    @Test fun `an official release on another supported lib is accepted, an unsupported one is not`() {
        // Mangalek المثبّت 1.4.65 والرسمي 1.6.70: يُقبل؛ واجهة لا يحمّلها المحرك تُرفض قبل التنزيل
        org.junit.Assert.assertTrue(BuiltinSourceRefresh.acceptsLib(1.4))
        org.junit.Assert.assertTrue(BuiltinSourceRefresh.acceptsLib(1.6))
        org.junit.Assert.assertTrue(BuiltinSourceRefresh.acceptsLib(1.600000023841858))
        org.junit.Assert.assertFalse(BuiltinSourceRefresh.acceptsLib(1.3))
        org.junit.Assert.assertFalse(BuiltinSourceRefresh.acceptsLib(1.7))
    }
}
