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
}
