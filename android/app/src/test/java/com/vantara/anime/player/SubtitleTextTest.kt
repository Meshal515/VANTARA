package com.vantara.anime.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SubtitleTextTest {
    private val srt = """
        1
        00:00:01,000 --> 00:00:03,500
        <i>وكانت الطريقة الوحيدة لإيقافها</i>
        هي أن ينساني الجميع.

        2
        00:00:04,000 --> 00:00:05,000
        {\an8}سطر ثانٍ
    """.trimIndent()

    @Test fun parsesSrtStripsTagsAndKeepsLines() {
        val cues = SubtitleText.parse(srt)
        assertEquals(2, cues.size)
        assertEquals(TimedCue(1000, 3500, "وكانت الطريقة الوحيدة لإيقافها\nهي أن ينساني الجميع."), cues[0])
        assertEquals("سطر ثانٍ", cues[1].text)
    }

    @Test fun parsesWebVttShortTimesAndSkipsHeaderAndNotes() {
        val vtt = "WEBVTT\n\nNOTE هذا تعليق\n\n00:01.200 --> 00:02.000 align:middle\nمرحبا\n\n01:00:00.000 --> 01:00:01.000\nبعد ساعة\n"
        val cues = SubtitleText.parse(vtt)
        assertEquals(listOf(TimedCue(1200, 2000, "مرحبا"), TimedCue(3_600_000, 3_601_000, "بعد ساعة")), cues)
    }

    @Test fun activeTextAtTimeIncludingOverlaps() {
        val cues = listOf(TimedCue(0, 5000, "أ"), TimedCue(2000, 3000, "ب"), TimedCue(6000, 7000, "ج"))
        assertEquals("", SubtitleText.at(cues, -1))
        assertEquals("أ\nب", SubtitleText.at(cues, 2500))
        assertEquals("أ", SubtitleText.at(cues, 4000))
        assertEquals("", SubtitleText.at(cues, 5500))
        assertEquals("ج", SubtitleText.at(cues, 6000))
        assertEquals("", SubtitleText.at(cues, 7000))
    }

    @Test fun delayWorksBothWays() {
        val cues = SubtitleText.parse(srt)
        // الترجمة متأخرة عن الكلام: نقدّمها 0.5 ث (إزاحة سالبة) فيظهر السطر عند 0.5 ث من الفيديو
        assertEquals("", SubtitleText.at(cues, SubtitleText.fileTime(400, 0)))
        assert(SubtitleText.at(cues, SubtitleText.fileTime(600, -500)).startsWith("وكانت"))
        // سابقة للكلام: نؤخّرها ثانية فلا تظهر عند 1.5 ث
        assertEquals("", SubtitleText.at(cues, SubtitleText.fileTime(1500, 1000)))
        assertEquals("تتأخر 0.3 ث", SubtitleText.delayLabel(300))
        assertEquals("أبكر 1.5 ث", SubtitleText.delayLabel(-1500))
    }

    @Test fun rejectsBrokenTimes() {
        assertNull(SubtitleText.time("00:61:00,000"))
        assertEquals(0, SubtitleText.parse("00:00:05,000 --> 00:00:01,000\nمقلوب").size)
    }
}
