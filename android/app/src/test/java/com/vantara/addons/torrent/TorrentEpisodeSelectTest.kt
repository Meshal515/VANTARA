package com.vantara.addons.torrent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** TR1/TR2: حزمة موسم بلا fileIdx تشغّل ملف الحلقة المطلوبة، لا أكبر ملف. */
class TorrentEpisodeSelectTest {
    private fun pack(vararg names: Pair<String, Long>): List<TorrentFile> {
        var offset = 0L
        return names.mapIndexed { i, (path, size) -> TorrentFile(i, path, size, offset).also { offset += size } }
    }

    @Test fun episodeNumbersFromCommonReleaseNames() {
        val cases = mapOf(
            "Frieren/[SubsPlease] Sousou no Frieren - 05 (1080p) [A1B2C3D4].mkv" to 5,
            "Show.S01E07.1080p.WEB.x264-GRP.mkv" to 7,
            "Show_S02E11_720p.mp4" to 11,
            "Show 1x03 HDTV.avi" to 3,
            "Mob Psycho 100 - 12v2 [1080p].mkv" to 12,
            "[Group] Title [08][1080p][HEVC].mkv" to 8,
            "Title EP09 2023 1080p.mkv" to 9,
            "One Piece Episode 1071 1080p.mkv" to 1071,
            "الحلقة 04 - العنوان.mp4" to 4,
            "03 - Opening Night.mkv" to 3,
        )
        for ((name, ep) in cases) assertEquals(name, ep, EpisodeNames.episode(name))
        assertNull(EpisodeNames.episode("Movie.Title.2019.2160p.x265.mkv"))
        assertNull(EpisodeNames.episode("Title [1080p] [ABCDEF12].mkv"))
    }

    @Test fun seasonPackWithoutFileIdxPlaysRequestedEpisodeNotLargest() {
        val files = pack(
            "S/Show - 01 [1080p].mkv" to 1_400_000_000,   // الأكبر: كانت تُختار دائمًا
            "S/Show - 02 [1080p].mkv" to 1_100_000_000,
            "S/Show - 03 [1080p].mkv" to 1_200_000_000,
            "S/extras/NCOP.mkv" to 90_000_000,
        )
        assertEquals("S/Show - 02 [1080p].mkv", TorrentPolicy.selectFile(files, null, episode = 2).path)
        assertEquals("S/Show - 03 [1080p].mkv", TorrentPolicy.selectFile(files, null, episode = 3).path)
        // بلا حلقة مطلوبة (فيلم/طلب قديم): السلوك السابق كما هو
        assertEquals("S/Show - 01 [1080p].mkv", TorrentPolicy.selectFile(files, null).path)
    }

    @Test fun missingEpisodeInNumberedPackIsAnErrorNotAnotherEpisode() {
        val files = pack("Show - 01.mkv" to 10, "Show - 02.mkv" to 20)
        val e = assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(files, null, episode = 7) }
        assertEquals("EPISODE_NOT_IN_TORRENT", e.message)
    }

    @Test fun announcedFilenameWinsAndSingleFileTorrentStillPlays() {
        val files = pack("a/Show.S01E01.mkv" to 30, "a/Show.S01E02.mkv" to 10)
        assertEquals("a/Show.S01E02.mkv", TorrentPolicy.selectFile(files, null, episode = 1, filename = "Show.S01E02.mkv").path)
        assertEquals("only.mkv", TorrentPolicy.selectFile(pack("only.mkv" to 5, "readme.txt" to 1), null, episode = 4).path)
    }

    @Test fun nonVideoFileIdxFallsBackToEpisodeMatchInsteadOfHardFailure() {
        val files = pack("Show - 05.nfo" to 1, "Show - 05.mkv" to 900, "Show - 06.mkv" to 950)
        assertEquals("Show - 05.mkv", TorrentPolicy.selectFile(files, 0, episode = 5).path)
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(files, 0) }
        // fileIdx صالح يبقى الحكم حتى لو اختلف رقم الحلقة في الاسم (الإضافة أدرى بترقيمها)
        assertEquals("Show - 06.mkv", TorrentPolicy.selectFile(files, 2, episode = 5).path)
    }

    // ───── TO1-TO6 (جرد الأنمي، 19 نوفمبر): الجدول نفسه الذي أُثبت بالتشغيل ─────
    private fun named(vararg names: String, size: (String) -> Long = { 1_000_000_000L }) = pack(*names.map { it to size(it) }.toTypedArray())

    @Test fun to2LongRunningPackWithBareNumbersPlaysTheRequestedEpisode() {
        val files = named(*(1..24).map { "Naruto Shippuden/Naruto Shippuden %03d.mkv".format(it) }.toTypedArray()) { if (it.contains("014")) 2_000_000_000L else 1_000_000_000L }
        assertEquals("Naruto Shippuden/Naruto Shippuden 005.mkv", TorrentPolicy.selectFile(files, null, episode = 5).path)
    }

    @Test fun to5ANumberInTheTitleIsNotTheEpisode() {
        val files = named(*(1..12).map { "86/86 Eighty Six %02d.mkv".format(it) }.toTypedArray())
        assertEquals("86/86 Eighty Six 05.mkv", TorrentPolicy.selectFile(files, null, episode = 5).path)
    }

    @Test fun to4ARecapHalfEpisodeNeverWinsOverTheEpisode() {
        val files = named("S/Show - 04.mkv", "S/Show - 05.mkv", "S/Show - 05.5 Recap.mkv", "S/Show - 06.mkv") { if (it.contains("05.5")) 3_000_000_000L else 1_000_000_000L }
        assertEquals("S/Show - 05.mkv", TorrentPolicy.selectFile(files, null, episode = 5).path)
    }

    @Test fun to1SpecialsNeverCompeteAndAnAmbiguousMultiSeasonPackIsNotGuessed() {
        val specials = named("Show/Season 1/Show S01E04.mkv", "Show/Season 1/Show S01E05.mkv", "Show/Specials/Show S00E05 OVA.mkv") { if (it.contains("S00")) 3_000_000_000L else 1_000_000_000L }
        assertEquals("Show/Season 1/Show S01E05.mkv", TorrentPolicy.selectFile(specials, null, episode = 5).path)
        val twoSeasons = named("Show/Season 1/Show S01E05.mkv", "Show/Season 2/Show S02E05.mkv", "Show/Season 2/Show S02E06.mkv")
        // بلا تلميح موسم: حلقة 5 في موسمين = لا تخمين (يُجرَّب مصدر آخر بدل حلقة موسم آخر)
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(twoSeasons, null, episode = 5) }
        // بتلميح الموسم: حلقته
        assertEquals("Show/Season 2/Show S02E05.mkv", TorrentPolicy.selectFile(twoSeasons, null, episode = 5, season = 2).path)
    }

    @Test fun to3AbsoluteNumberingInASecondSeasonPack() {
        val files = named(*(13..24).map { "S2/Show - %02d.mkv".format(it) }.toTypedArray())
        assertEquals("S2/Show - 13.mkv", TorrentPolicy.selectFile(files, null, episode = 1).path)
        assertEquals("S2/Show - 24.mkv", TorrentPolicy.selectFile(files, null, episode = 12).path)
    }

    @Test fun to6JapaneseEpisodeNaming() {
        assertEquals(5, EpisodeNames.episode("作品/作品 第05話.mkv"))
    }
}
