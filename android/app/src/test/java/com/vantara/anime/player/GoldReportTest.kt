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

    private fun read(openedAt: Long, firstByteAt: Long, position: Long, bytes: Long = MB, endAt: Long = if (firstByteAt > 0) firstByteAt + 100 else 0L) =
        GoldReport.Read(openedAt, openedAt, firstByteAt, position, bytes, endAt)
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
        assertTrue(text, text.contains("قراءة من ذيل الملف (الفهرس) (2.00GB): 1.0MB في 4200ms"))
        assertTrue(text, text.contains("أول بايت بعد 4100ms · منها 4200ms في هذه المرحلة"))
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

    @Test fun `عينة المالك 2 (AV1 متابعة 5_30، 27 نوفمبر) - الحاوية 4_75 ث كانت قراءة الفهرس من ذيل الملف لا «غير معروف»`() {
        // الأرقام من التقرير الخام: فتح بعد 0.9 ث، الرأس 625KB، الذيل 1.6MB في 4.2 ث، المسارات +6.85، أول صورة +8.1، READY +8.86
        val input = GoldReport.Input(
            tapAt = 9_770, openAt = 10_000, preparationMs = 1_600,
            reads = listOf(
                read(10_900, 12_100, 0, 625 * 1024L, endAt = 12_400),
                read(12_500, 13_370, 293_500_000L, 1_677_722L, endAt = 16_700),
                read(16_700, 0, 625 * 1024L, 0L, endAt = 16_800),
                read(16_800, 17_366, 62_100_000L, 4_800_000L, endAt = 0L),
            ),
            tracksAt = 16_850, readyAt = 18_860, frameAt = 18_100,
            torrent = GoldReport.Torrent(firstPeerAt = 9_000, metadataAt = 10_890, firstPayloadAt = 11_100, fileBytes = 295_000_000L, pieceBytes = 2 * MB.toInt(),
                waits = listOf(wait(12575, 1_147, 12_090, engine = 9, blocks = 128, early = true)), peers = 41, downloadBps = 27_600_000L / 8,
                turbo = true, earlyBytes = 5_200_000L, hintsSent = 98, mkvSkipped = 1_228_800L, patched = true, criticalPieces = 2),
            now = 19_000,
        )
        val a = GoldReport.analyze(input)
        val b = a.bottleneck!!
        assertEquals("container", b.id)
        assertEquals(4_750L, b.ms)
        assertEquals("WAIT_INDEX_READ", b.cause!!.code)
        assertEquals("CONFIRMED", b.cause!!.confidence)
        assertTrue(b.cause!!.needs!!.contains("لماذا بطؤت القراءة"))
        // أول صورة قبل READY: المسار بترتيب الوقوع
        assertEquals(listOf("source", "metadata", "first-byte", "container", "rendered", "ready"), a.phases.map { it.id })
        val text = GoldReport.text(input)
        assertTrue(text, text.contains("قراءة من ذيل الملف (الفهرس) (279.9MB): 1.6MB في 4200ms بمعدل 0.38MB/ث"))
        assertTrue(text, text.contains("التحميل الآن 3.29MB/ث"))
        assertTrue(text, text.contains("من الضغط حتى أول صورة معروضة: 8.33 ث · حتى التشغيل (READY): 9.09 ث"))
    }

    @Test fun `عينة المالك 1 (HEVC من البداية) - أول صورة قبل READY لا تُحسب مرحلة صفرية`() {
        val a = GoldReport.analyze(GoldReport.Input(
            tapAt = 9_930, openAt = 10_000, reads = listOf(read(10_000, 11_874, 0, 3 * MB, endAt = 0L)),
            tracksAt = 11_900, frameAt = 12_100, readyAt = 12_180,
            torrent = GoldReport.Torrent(metadataAt = 10_030, firstPeerAt = 10_500, firstPayloadAt = 11_551, fileBytes = 156_000_000L, pieceBytes = 16 * MB.toInt(),
                waits = listOf(wait(1108, 1_872, 11_872, engine = 0, blocks = 1024, early = true))),
            now = 12_500,
        ))
        assertEquals("first-byte", a.bottleneck!!.id)
        assertEquals("WAIT_PIECE_NOT_STARTED", a.bottleneck!!.cause!!.code)
        val rendered = a.phases.first { it.id == "rendered" }
        assertEquals(200L, rendered.ms)
        assertEquals("ready", a.phases.last().id)
    }
}

