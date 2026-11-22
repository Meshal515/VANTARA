package com.vantara.downloads

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** DN1 وDN2: «اكتمل» فور الانتهاء، وكل عنصر بسطره ونسبته وسرعته (حتى 4). */
class DownloadNoticeTest {
    @Test fun nothingLeftIsDoneAtOnceNotAnOngoingDownload() {
        val c = DownloadNotice.of(emptyList(), pending = 0, holds = emptyList(), wifiOnly = false, completed = 3)
        assertTrue(c.done)
        assertFalse(c.ongoing)
        assertNull(c.percent)
        assertEquals("اكتمل تنزيل 3 عناصر", c.title)
    }

    @Test fun everyItemHasItsOwnLineWithProgressAndSpeedUpToFour() {
        val items = (1..5).map { NoticeItem("Frieren", "الحلقة $it", 50L * it, 500, 2_097_152) }
        val c = DownloadNotice.of(items.take(4), pending = 2, holds = listOf("Solo Leveling — الفصل 3 · 5/20"), wifiOnly = false, completed = 0)
        assertTrue(c.ongoing)
        assertEquals(4, c.lines.size)
        assertEquals("Frieren — الحلقة 1 · 10% · 2.0 MB/s", c.lines[0])
        assertTrue(c.text, c.text.contains("8.0 MB/s") && c.text.contains("2 في الانتظار") && c.text.contains("و1 غيرها"))
    }

    @Test fun oneItemShowsItsNameAndNoInboxLines() {
        val c = DownloadNotice.of(listOf(NoticeItem("Dune", "", 100, 1000, null)), 0, emptyList(), false, 0)
        assertEquals("Dune", c.title)
        assertEquals(10, c.percent)
        assertTrue(c.lines.isEmpty())
    }

    @Test fun mangaChaptersFromTheWebLayerAreOneLineEach() {
        val c = DownloadNotice.of(emptyList(), 0, listOf("A — الفصل 1 · 3/20\nA — الفصل 2 · 0/18"), false, 0)
        assertEquals("2 تنزيلات جارية", c.title)
        assertEquals(listOf("A — الفصل 1 · 3/20", "A — الفصل 2 · 0/18"), c.lines)
    }
}
