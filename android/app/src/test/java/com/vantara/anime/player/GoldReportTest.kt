package com.vantara.anime.player

import com.vantara.addons.torrent.ReadWait
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** تقرير الذهب لأندرويد بأشكال عينات المالك: الساعة elapsedRealtime، والضغط عند 10_000. */
class GoldReportTest {
    private val GB = 1L shl 30
    private val MB = 1L shl 20

    private fun read(openedAt: Long, firstByteAt: Long, position: Long, bytes: Long = MB) = GoldReport.Read(openedAt, openedAt, firstByteAt, position, bytes)
    private fun wait(piece: Int, ms: Long, endAt: Long, engine: Int, known: Int = engine, blocks: Int = 128, early: Boolean = false, tail: Boolean = false, atOffset: Boolean = false) =
        ReadWait(piece = piece, block = 0, blocks = blocks, known = known, engine = engine, atOffset = atOffset, ms = ms, early = early, tail = tail, endAt = endAt)

    @Test fun `عينة AV1 - طلب الفهرس من ذيل الملف 4 ث - الكتلة لم تصل - مدعوم بقوة لا مؤكد لأن الانتظار أطول من ثانيتين`() {
        val input = GoldReport.Input(
            tapAt = 10_000, openAt = 10_300, preparationMs = 200,
            reads = listOf(read(10_900, 11_000, 0), read(11_100, 15_200, 2 * GB - 3 * MB)),
            tracksAt = 15_400, readyAt = 15_900, frameAt = 16_000,
            torrent = GoldReport.Torrent(addedAt = 10_310, firstKnownAt = 10_400, firstPeerAt = 10_600, metadataAt = 10_800, firstPayloadAt = 10_850, firstPieceAt = 10_950,
                fileBytes = 2 * GB, pieceBytes = 8 * MB.toInt(), waits = listOf(wait(255, 4_000, 15_150, engine = 60, blocks = 512, tail = true)),
                mkvSkipped = 614 * 1024L, turbo = true, hintsSent = 3, patched = true, criticalPieces = 2),
            build = "0.4.92 · Debug · 92 · native abc", now = 17_000,
        )
        val a = GoldReport.analyze(input)
        assertEquals("container", a.bottleneck!!.id)
        assertEquals("WAIT_BLOCK_RESPONSE", a.bottleneck!!.cause!!.code)
        assertEquals("STRONGLY_SUPPORTED", a.bottleneck!!.cause!!.confidence)
        assertTrue(a.bottleneck!!.cause!!.where!!.contains("NativeReadHint.kt"))
        val text = GoldReport.text(input)
        assertTrue(text, text.contains("طلب قراءة من ذيل الملف (الفهرس)"))
        assertTrue(text, text.contains("أول بايت بعد 4100ms"))
        assertTrue(text, text.contains("القطعة 255 (ذيل الملف): 4000ms"))
        assertTrue(text, text.contains("تقسيم الانتظار الطويل بعيّنات دورية"))
        assertTrue(text, text.contains("تخطّى بلا تنزيل 614KB"))
        assertTrue(text, text.contains("المجموع (حتى أول صورة معروضة): 6.00 ث"))
        assertTrue(text, text.contains("أول صورة معروضة: مقاسة (onRenderedFirstFrame)"))
        assertTrue(text, text.contains("[الحكم] مدعوم بقوة: قراءة الحاوية"))
    }

    @Test fun `Metadata باردة 9 ث - اكتشاف أول مشارك أغلبها - مؤكد بمكان القرار`() {
        val input = GoldReport.Input(
            tapAt = 10_000, openAt = 10_100, reads = listOf(read(19_300, 19_500, 0)), tracksAt = 19_800, readyAt = 20_000, frameAt = 20_100,
            torrent = GoldReport.Torrent(addedAt = 10_150, firstKnownAt = 17_500, firstPeerAt = 18_200, metadataAt = 19_100, firstPayloadAt = 19_300, firstPieceAt = 19_450),
            now = 21_000,
        )
        val b = GoldReport.analyze(input).bottleneck!!
        assertEquals("metadata", b.id)
        assertEquals("WAIT_PEER_DISCOVERY", b.cause!!.code)
        assertEquals("CONFIRMED", b.cause!!.confidence)
        assertTrue(b.cause!!.where!!.contains("resumeAnnounced"))
        assertTrue(b.evidence.toString(), b.evidence.first().startsWith("اكتشاف أول مشارك (متتبعات وDHT) 7350ms"))
    }

    @Test fun `مسخّن قبل الفتح - Metadata تُعلن قبل الفتح ولا تُحسب اختناقًا`() {
        val a = GoldReport.analyze(GoldReport.Input(
            tapAt = 10_000, openAt = 10_200, reads = listOf(read(10_300, 10_500, 0)), tracksAt = 10_700, readyAt = 11_000, frameAt = 11_050,
            torrent = GoldReport.Torrent(metadataAt = 8_000, warmedAt = 9_000, warmedPieces = 2), now = 12_000,
        ))
        val meta = a.phases.first { it.id == "metadata" }
        assertEquals(0L, meta.ms)
        assertTrue(meta.beforeTap)
        assertEquals("PREWARM", meta.cause!!.code)
        assertNotEquals("metadata", a.bottleneck!!.id)
    }

    @Test fun `بعد الجاهزية - تهيئة المفكك تغطي المرحلة - مؤكد، وبلا دليل غير معروف ويُسمّى الناقص`() {
        val base = GoldReport.Input(tapAt = 10_000, openAt = 10_100, reads = listOf(read(10_200, 10_300, 0)), tracksAt = 10_400, readyAt = 10_500, frameAt = 12_500,
            decoder = "c2.android.av1.decoder", decoderInitAt = 12_400, decoderInitMs = 1_800, now = 13_000)
        val rendered = GoldReport.analyze(base).bottleneck!!
        assertEquals("rendered", rendered.id)
        assertEquals("DECODER_INIT", rendered.cause!!.code)
        assertEquals("CONFIRMED", rendered.cause!!.confidence)
        val bare = GoldReport.analyze(GoldReport.Input(tapAt = 10_000, openAt = 10_100, reads = listOf(read(10_200, 10_300, 0)), tracksAt = 10_400, readyAt = 10_500, frameAt = 12_500, now = 13_000)).bottleneck!!
        assertEquals("UNKNOWN", bare.cause!!.confidence)
        assertTrue(bare.cause!!.needs!!.contains("المفكك"))
    }

    @Test fun `فجوة تتبع الكتل - خلل فانتارا يُسمّى باسمه`() {
        val b = GoldReport.analyze(GoldReport.Input(tapAt = 10_000, openAt = 10_100, reads = listOf(read(10_200, 11_800, 0)), tracksAt = 11_900, readyAt = 12_000, frameAt = 12_050,
            torrent = GoldReport.Torrent(metadataAt = 10_150, waits = listOf(wait(0, 1_600, 11_790, engine = 100, known = 10))), now = 13_000)).bottleneck!!
        assertEquals("first-byte", b.id)
        assertEquals("VANTARA_BLOCK_TRACKING_GAP", b.cause!!.code)
        assertEquals("CONFIRMED", b.cause!!.confidence)
    }

    @Test fun `سلامة الأدلة - بلا زمن ضغط، ومرحلة جارية بالقطعة المنتظرة الآن`() {
        val a = GoldReport.analyze(GoldReport.Input(tapAt = 0, openAt = 10_000, reads = listOf(read(10_100, 0, 0)),
            torrent = GoldReport.Torrent(metadataAt = 10_050, waitingPiece = 0, waitingSince = 10_200, waitingBlocks = 0 to 64), now = 18_000))
        assertTrue(a.integrity.contains("زمن الضغط غير معروف: المدد من فتح المصدر لا من الضغط"))
        assertTrue(a.integrity.any { it.startsWith("البدء لم يكتمل: مرحلة «أول بايت للمشغّل» جارية") })
        val ongoing = a.phases.last()
        assertTrue(ongoing.ongoing)
        assertEquals("WAIT_PIECE_NOT_STARTED", ongoing.cause!!.code)
        assertTrue(a.integrity.contains("أول صورة معروضة: لم تُعرض بعد"))
        assertFalse(GoldReport.analyze(GoldReport.Input(tapAt = 0, openAt = 0)).integrity.isEmpty())
    }
}
