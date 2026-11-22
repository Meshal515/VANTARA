package com.vantara.plugins

import com.vantara.plugins.LegacySourceIds.Entry
import dev.vantara.spike.SPIKE_SOURCES
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * المرحلة 1 من «صفر مصادر مدمجة»: كل معرّف قديم محفوظ (مكتبة، تقدّم، تنزيلات) يصل لنفس المصدر بعد أن تصير حزمته
 * إضافة مثبّتة، والعكس. البيانات هي الحزم المدمجة نفسها، فأي حزمة تُضاف لاحقًا تدخل الاختبار وحدها.
 */
class LegacySourceIdsTest {
    private val mangadex = "eu.kanade.tachiyomi.extension.all.mangadex"
    private val mangafire = "eu.kanade.tachiyomi.extension.all.mangafire"

    @Test fun everyBuiltinArabicSourceKeepsItsOldIdAndTheOldIdFindsIt() {
        for (spec in SPIKE_SOURCES) {
            val arabic = spec.arabicSourceIds.single()
            // مصادر بلغات أخرى قبله: الترتيب لا يغيّر القرار
            val all = listOf(Entry("111", "en"), Entry("222", "ar-decoy"), Entry(arabic, "ar"), Entry("333", "ar"))
            assertEquals(spec.pkg, spec.pkg, LegacySourceIds.visibleId(spec.pkg, Entry(arabic, "ar"), all))
            assertEquals(spec.pkg, arabic, LegacySourceIds.sourceIdFor(spec.pkg, all))
            // مصدر عربي آخر في الحزمة نفسها ليس «المصدر القديم»: يبقى بمعرّف الإضافة
            assertEquals("${spec.pkg}#333", LegacySourceIds.visibleId(spec.pkg, Entry("333", "ar"), all))
        }
    }

    @Test fun fillersWithAPinnedIdMatchThatIdEvenWhenAnotherSourceSharesTheLanguage() {
        for (filler in FILLER_SOURCES.filter { it.sourceId != null }) {
            val all = listOf(Entry("999", filler.lang), Entry(filler.sourceId!!, filler.lang))
            assertEquals("${filler.pkg}@${filler.lang}", LegacySourceIds.visibleId(filler.pkg, Entry(filler.sourceId!!, filler.lang), all))
            assertEquals(filler.sourceId, LegacySourceIds.sourceIdFor("${filler.pkg}@${filler.lang}", all))
            assertEquals("${filler.pkg}#999", LegacySourceIds.visibleId(filler.pkg, Entry("999", filler.lang), all))
        }
        // MangaFire: عشر لغات، والإنجليزية بمعرّفها المثبّت لا بترتيبها
        val fire = listOf(Entry("1", "es"), Entry("2", "en"), Entry("6084907896154116083", "en"), Entry("3", "fr"))
        assertEquals("6084907896154116083", LegacySourceIds.sourceIdFor("$mangafire@en", fire))
        assertEquals("$mangafire#3", LegacySourceIds.visibleId(mangafire, Entry("3", "fr"), fire))
    }

    @Test fun mangadexArabicAndEnglishFillerKeepOldIdsOtherLanguagesUseTheExtensionId() {
        val arabic = SPIKE_SOURCES.single { it.pkg == mangadex }.arabicSourceIds.single()
        val all = listOf(Entry("2499283573021220255", "en"), Entry("5", "fr"), Entry(arabic, "ar"), Entry("6", "en"))
        assertEquals(mangadex, LegacySourceIds.visibleId(mangadex, Entry(arabic, "ar"), all))
        assertEquals("$mangadex@en", LegacySourceIds.visibleId(mangadex, Entry("2499283573021220255", "en"), all))
        assertEquals("only the first English source is the old filler", "$mangadex#6", LegacySourceIds.visibleId(mangadex, Entry("6", "en"), all))
        assertEquals("$mangadex#5", LegacySourceIds.visibleId(mangadex, Entry("5", "fr"), all))
        assertEquals("2499283573021220255", LegacySourceIds.sourceIdFor("$mangadex@en", all))
    }

    @Test fun extensionsThatWereNeverBuiltInAreUntouched() {
        val pkg = "eu.kanade.tachiyomi.extension.ar.someothersite"
        val all = listOf(Entry("42", "ar"))
        assertEquals("$pkg#42", LegacySourceIds.visibleId(pkg, Entry("42", "ar"), all))
        assertNull(LegacySourceIds.sourceIdFor(pkg, all))
        assertNull(LegacySourceIds.sourceIdFor("$pkg@en", all))
    }

    @Test fun onlyOldFormsAreTranslatedAndUnknownFillerLanguagesAreRefused() {
        val teamx = SPIKE_SOURCES.single { it.pkg.endsWith(".teamx") }
        val all = listOf(Entry(teamx.arabicSourceIds.single(), "ar"))
        assertNull(LegacySourceIds.sourceIdFor("${teamx.pkg}#${teamx.arabicSourceIds.single()}", all))
        assertNull("Team X never had an English filler", LegacySourceIds.sourceIdFor("${teamx.pkg}@en", all))
        assertNull("no Arabic source in the package: no match, never a wrong source", LegacySourceIds.sourceIdFor(teamx.pkg, listOf(Entry("7", "en"))))
    }

    @Test fun roundTripForEveryOldIdTheAppEverWrote() {
        val ids = SPIKE_SOURCES.map { it.pkg } + FILLER_SOURCES.map { "${it.pkg}@${it.lang}" }
        for (old in ids) {
            val (pkg, lang) = splitSourceId(old)
            val spike = SPIKE_SOURCES.firstOrNull { it.pkg == pkg }
            val filler = FILLER_SOURCES.firstOrNull { it.pkg == pkg && it.lang == lang }
            val own = if (lang == null) Entry(spike!!.arabicSourceIds.single(), "ar") else Entry(filler!!.sourceId ?: "first-$lang", lang)
            val all = listOfNotNull(own, spike?.let { Entry(it.arabicSourceIds.single(), "ar") }).distinct() + Entry("other", "xx")
            val sid = LegacySourceIds.sourceIdFor(old, all)
            assertEquals(old, own.id, sid)
            assertEquals(old, old, LegacySourceIds.visibleId(pkg, Entry(sid!!, own.lang), all))
            assertTrue(LegacySourceIds.isFormerBuiltin(pkg))
        }
    }
}
