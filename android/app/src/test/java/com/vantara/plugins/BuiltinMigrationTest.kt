package com.vantara.plugins

import dev.vantara.spike.SPIKE_SOURCES
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * المرحلة 2 من «صفر مصادر مدمجة»: الحزمة المدمجة تصير إضافة مثبّتة بالنسخة نفسها، بمصادرها نفسها، مرة واحدة، ولا
 * يُحفظ مستودع Keiyoushi إلا للحساب القديم و«بلا حساب».
 */
class BuiltinMigrationTest {
    private val teamx = SPIKE_SOURCES.single { it.pkg.endsWith(".teamx") }
    private val mangadex = SPIKE_SOURCES.single { it.pkg.endsWith(".mangadex") }
    private val mangafire = FILLER_PACKAGES.single { it.pkg.endsWith(".mangafire") }
    private val keiyoushi = BuiltinSourceRefresh.KEIYOUSHI_BASE

    private fun recordOf(base: dev.vantara.spike.SourceSpec, loaded: List<UserSource>? = null) =
        BuiltinMigration.record(base, base, null, BuiltinMigration.sourcesOf(base.pkg, loaded))

    @Test fun theRecordPointsAtTheSameCopyOnTheDeviceAndKeepsTheSourcesTheAccountSaw() {
        val current = teamx.copy(sha256 = "a".repeat(64), apkUrl = "https://example.invalid/teamx-new.apk", versionName = "1.6.40")
        val previous = teamx.copy(sha256 = "b".repeat(64), versionName = "1.6.35")
        val rec = BuiltinMigration.record(teamx, current, previous, BuiltinMigration.sourcesOf(teamx.pkg))
        assertEquals(keiyoushi, rec.repoUrl)
        assertEquals(teamx.pkg, rec.pkg)
        assertEquals("a".repeat(64), rec.sha256)
        assertEquals("https://example.invalid/teamx-new.apk", rec.apkUrl)
        assertEquals("1.6.40", rec.versionName)
        assertEquals("ar", rec.lang)
        assertEquals(listOf(UserSource(teamx.arabicSourceIds.single(), teamx.arabicSourceNames.first(), "ar")), rec.sources)
        assertEquals("b".repeat(64), rec.previous?.sha256)
        // آخر سليم بنفس البصمة ليس إصدارًا سابقًا
        assertNull(BuiltinMigration.record(teamx, current, current, rec.sources).previous)
        // ومعرّفه الظاهر يبقى القديم
        val entries = rec.sources.map { LegacySourceIds.Entry(it.id, it.lang) }
        assertEquals(teamx.pkg, LegacySourceIds.visibleId(teamx.pkg, entries.single(), entries))
    }

    @Test fun mangadexKeepsArabicAndItsEnglishFillerWhenThePackageIsLoaded() {
        val arabic = mangadex.arabicSourceIds.single()
        val loaded = listOf(UserSource("555", "MangaDex", "fr"), UserSource("777", "MangaDex", "en"), UserSource(arabic, "MangaDex", "ar"))
        assertEquals(listOf(arabic, "777"), BuiltinMigration.sourcesOf(mangadex.pkg, loaded).map { it.id })
        // بلا تحميل: العربي وحده، والمعرّف القديم للتكملة يصل لها عند الطلب (LegacySourceIds.sourceIdFor)
        assertEquals(listOf(arabic), BuiltinMigration.sourcesOf(mangadex.pkg).map { it.id })
        assertEquals("all", recordOf(mangadex).lang)
    }

    @Test fun anEnglishOnlyPackageMigratesItsPinnedFillerSource() {
        val rec = recordOf(mangafire)
        assertEquals(listOf(UserSource("6084907896154116083", "MangaFire", "en")), rec.sources)
        assertEquals("all", rec.lang)
        assertTrue("MangaFire is mixed content", rec.nsfw)
    }

    @Test fun oldAccountKeepsTheRepositoryAsItsOwnDataNewAccountNever() {
        val records = listOf(recordOf(teamx), recordOf(mangafire))
        val legacy = BuiltinMigration.apply(UserExtensionState(), records, keepRepository = true)
        assertEquals(listOf(teamx.pkg, mangafire.pkg), legacy.migrated)
        assertEquals(listOf(UserRepo(keiyoushi, "Keiyoushi", BuiltinSourceRefresh.KEIYOUSHI_KEY)), legacy.state.repos)
        assertEquals(setOf(teamx.pkg, mangafire.pkg), legacy.state.formerBuiltins.toSet())

        val clean = BuiltinMigration.apply(UserExtensionState(), listOf(recordOf(teamx)), keepRepository = false)
        assertEquals(listOf(teamx.pkg), clean.migrated)
        assertTrue("a new account never gets the repository", clean.state.repos.isEmpty())
    }

    @Test fun repeatedMigrationChangesNothingAndNeverRevivesADeletedPackage() {
        val once = BuiltinMigration.apply(UserExtensionState(), listOf(recordOf(teamx)), keepRepository = true).state
        val twice = BuiltinMigration.apply(once, listOf(recordOf(teamx)), keepRepository = true)
        assertEquals(once, twice.state)
        assertEquals(listOf(teamx.pkg), twice.skipped)
        // المستخدم حذفها بعد الترحيل: تبقى محذوفة
        val deleted = once.copy(extensions = emptyList())
        val again = BuiltinMigration.apply(deleted, listOf(recordOf(teamx)), keepRepository = true)
        assertTrue(again.state.extensions.isEmpty())
        assertEquals(listOf(teamx.pkg), again.skipped)
    }

    @Test fun anExtensionAlreadyInstalledFromARepositoryIsKeptAsIsAndAnExistingRepositoryIsNotDuplicated() {
        val mine = recordOf(teamx).copy(repoUrl = "https://my.repo.invalid", versionName = "9.9.9")
        val start = UserExtensionState(repos = listOf(UserRepo(keiyoushi, "My name for it", BuiltinSourceRefresh.KEIYOUSHI_KEY)), extensions = listOf(mine))
        val out = BuiltinMigration.apply(start, listOf(recordOf(teamx), recordOf(mangafire)), keepRepository = true)
        assertEquals(listOf(mangafire.pkg), out.migrated)
        assertEquals(mine, out.state.extensions.single { it.pkg == teamx.pkg })
        assertEquals(1, out.state.repos.size)
        assertEquals("My name for it", out.state.repos.single().name)
        assertTrue(teamx.pkg in out.state.formerBuiltins)
    }

    @Test fun nothingMigratedMeansNoRepository() {
        val out = BuiltinMigration.apply(UserExtensionState(), emptyList(), keepRepository = true)
        assertTrue(out.state.repos.isEmpty())
        assertTrue(out.migrated.isEmpty())
    }

    @Test fun theNewFieldIsSavedAndOlderStateFilesStillRead() {
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
        val old = json.decodeFromString(UserExtensionState.serializer(), """{"repos":[],"extensions":[]}""")
        assertTrue(old.formerBuiltins.isEmpty())
        val state = BuiltinMigration.apply(UserExtensionState(), listOf(recordOf(teamx)), keepRepository = true).state
        val back = json.decodeFromString(UserExtensionState.serializer(), json.encodeToString(UserExtensionState.serializer(), state))
        assertEquals(state, back)
        assertFalse(back.formerBuiltins.isEmpty())
    }

    @Test fun languageComesFromThePackageName() {
        assertEquals("ar", BuiltinMigration.langOf("eu.kanade.tachiyomi.extension.ar.teamx"))
        assertEquals("en", BuiltinMigration.langOf("eu.kanade.tachiyomi.extension.en.weebcentral"))
        assertEquals("all", BuiltinMigration.langOf("eu.kanade.tachiyomi.extension.all.mangadex"))
    }
}
