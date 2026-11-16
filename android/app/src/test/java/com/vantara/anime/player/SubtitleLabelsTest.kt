package com.vantara.anime.player

import com.vantara.anime.stream.TrackRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SubtitleLabelsTest {
    @Test
    fun `repeated ar tracks carry their source and a number, not ar ar ar`() {
        val tracks = listOf(
            TrackRef("u1", "ar", "OpenSubtitles"),
            TrackRef("u2", "ar", "OpenSubtitles"),
            TrackRef("u3", "ar", "Subsource"),
            TrackRef("u4", "ar"),
        )
        val labels = SubtitleLabels.of(tracks, fallbackSource = "Anime4up")
        assertEquals(4, labels.toSet().size)
        labels.forEach { assertNotEquals("ar", it) }
        assertEquals(true, labels[2].endsWith("· Subsource"))
        // بلا اسم إضافة: اسم المصدر الذي جاء منه الرابط
        assertEquals(true, labels[3].endsWith("· Anime4up"))
    }

    @Test
    fun `a single track keeps a clean name and free text stays as written`() {
        assertEquals(listOf("عربي مدمج · Witanime"), SubtitleLabels.of(listOf(TrackRef("u", "عربي مدمج")), "Witanime"))
        // الملف المحلي: «local» ليس اسم مصدر يُعرض
        assertEquals(false, SubtitleLabels.of(listOf(TrackRef("u", "en")), "local").single().contains("local"))
    }
}
