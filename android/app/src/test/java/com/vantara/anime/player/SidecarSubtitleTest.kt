package com.vantara.anime.player

import com.vantara.anime.stream.TrackRef
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SidecarSubtitleTest {
    private val ar1 = TrackRef("https://subs.example/a1.srt", "ar", "مصدر أ")
    private val ar2 = TrackRef("https://subs.example/a2.srt", "ar", "مصدر أ")
    private val en = TrackRef("https://subs.example/e.vtt", "en", null)

    @Test fun selectedSourceSubtitleIsFoundByItsOwnLabelEvenWhenLanguagesRepeat() {
        val list = listOf(ar1, ar2, en)
        val labels = SubtitleLabels.of(list, "سيرفر")
        assertEquals(ar2, SidecarSubtitle.of(list, "سيرفر", labels[1], "ar"))
        assertEquals(en, SidecarSubtitle.of(list, "سيرفر", labels[2], "en"))
    }

    @Test fun embeddedTrackWithoutAMatchingFileIsNotTakenOver() {
        assertNull(SidecarSubtitle.of(listOf(ar1), "سيرفر", "Arabic (embedded)", "ar"))
        assertNull(SidecarSubtitle.of(emptyList(), "سيرفر", "العربية", "ar"))
        assertNull(SidecarSubtitle.of(listOf(ar1), "سيرفر", null, "ar"))
    }

    @Test fun arabicFilesDecodeFromUtf8BomOrWindows1256() {
        val text = "مرحبا"
        assertEquals(text, SidecarSubtitle.decode(byteArrayOf(0xef.toByte(), 0xbb.toByte(), 0xbf.toByte()) + text.toByteArray(), null, arabic = true))
        assertEquals(text, SidecarSubtitle.decode(text.toByteArray(), null, arabic = true))
        assertEquals(text, SidecarSubtitle.decode(text.toByteArray(charset("windows-1256")), null, arabic = true))
    }
}
