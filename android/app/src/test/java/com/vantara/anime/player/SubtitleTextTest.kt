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

    @Test fun parsesAssDeclaredFieldsEscapesAndKeepsDialogueCommas() {
        val ass = """
            [Script Info]
            [Events]
            Format: Layer, End, Start, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            Comment: 0,0:00:05.00,0:00:01.00,Default,,0,0,0,,تعليق
            Dialogue: 0,0:00:04.50,0:00:01.23,Default,,0,0,0,,{\an8\i1}مرحبا، بالعالم, welcome{\i0}\Nالسطر الثاني\nالسطر الثالث\hهنا
            [Fonts]
            Dialogue: 0,0:00:05.00,0:00:01.00,Default,,0,0,0,,ليس حوارا
        """.trimIndent()
        assertEquals(listOf(TimedCue(1230, 4500, "مرحبا، بالعالم, welcome\nالسطر الثاني\nالسطر الثالث\u00a0هنا")), SubtitleText.parse(ass))
    }

    @Test fun parsesSsaAndSkipsVectorDrawingsIncludingMixedEvents() {
        val ssa = """
            [Script Info]
            [V4 Styles]
            Format: Name, Fontname, Fontsize
            Style: Default,Arial,28
            [Events]
            Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            Dialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\p1}m 0 0 l 100 0 100 100
            Dialogue: Marked=0,0:00:02.00,0:00:03.00,Default,,0,0,0,,قبل{\p1\an7}m 0 0 l 10 10{\p0\i1}بعد
            Dialogue: Marked=0,1:02:03.04,1:02:05.60,Default,,0,0,0,,<i>النص</i> & الباقي
        """.trimIndent()
        assertEquals(listOf(TimedCue(2000, 3000, "قبلبعد"), TimedCue(3723040, 3725600, "النص & الباقي")), SubtitleText.parse(ssa))
    }

    @Test fun assDoesNotInventTimesOrRenderStyleRecords() {
        val malformed = """
            [Events]
            Format: Start, End, Text
            Dialogue: 0:00:99.00,0:00:01.00,ثوان غير صالحة
            Dialogue: 0:00:03.00,0:00:01.00,مقلوب
            Comment: 0:00:01.00,0:00:02.00,تعليق
        """.trimIndent()
        assertEquals(emptyList<TimedCue>(), SubtitleText.parse(malformed))
    }
}
