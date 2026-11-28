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
        // بلا موضع Cues من SeekHead: مكان القراءة فقط («ذيل الملف»)، لا «الفهرس» بلا دليل
        assertTrue(text, text.contains("قراءة من ذيل الملف (من 2.00GB): 4200ms في هذه المرحلة · أول بايت بعد 4100ms · مجموعها حتى لحظة التقرير 1.0MB في 4200ms"))
        assertTrue(text, text.contains("القطعة 255 (ذيل الملف): 4000ms في هذه المرحلة"))
        assertTrue(text, text.contains("حالة القطعة أثناء الانتظار الطويل"))
        assertTrue(text, text.contains("السبب المحتمل (غير مثبت):"))
        assertTrue(text, text.contains("تخطّى بلا تنزيل 614KB"))
        assertTrue(text, text.contains("المجموع (حتى أول صورة معروضة): 6.00 ث"))
        assertTrue(text, text.contains("أول صورة معروضة: مقاسة (onRenderedFirstFrame)"))
        assertTrue(text, text.contains("[الحكم] مدعوم بقوة: قراءة الحاوية (المسارات معروفة) — انتظار كتلة القراءة في قطعة بدأ تنزيلها · السبب غير مثبت"))
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
                turbo = true, earlyBytes = 5_200_000L, hintsSent = 98, mkvSkipped = 1_228_800L, patched = true, criticalPieces = 2,
                // SeekHead أعلن Cues داخل طلب الذيل، وأول Cluster بعد الرأس
                clusterAt = 640 * 1024L, cuesAt = 293_600_000L),
            now = 19_000, container = "video/x-matroska",
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
        assertTrue(text, text.contains("قراءة فهرس Cues (موضعه من SeekHead) (من 279.9MB): 4200ms في هذه المرحلة"))
        assertTrue(text, text.contains("Media3 MatroskaExtractor"))
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

    // ───── عيوب تقرير الذهب من اختبارات المالك الإحدى عشرة (Debug 3492، S23 Ultra، بيانات الهاتف) ─────

    @Test fun `CloudStream MP4 عبر HTTP - لا Matroska ولا تورنت، والقراءة المتصلة من البداية محتملة لا مؤكدة`() {
        // التقرير 1: فتح بعد 1.3 ث، قراءة واحدة من البداية 48.6MB جارية حتى 7.8 ث، المسارات +2.9، صورة +3.2، جاهز +3.3
        val input = GoldReport.Input(
            tapAt = 0, intentAt = 9_800, openAt = 10_000,
            reads = listOf(GoldReport.Read(10_000, 11_330, 11_355, 0, 48_600_000L, 0L)),
            tracksAt = 12_920, frameAt = 13_190, readyAt = 13_330, now = 17_800, container = "video/mp4",
        )
        val a = GoldReport.analyze(input)
        val b = a.bottleneck!!
        assertEquals("container", b.id)
        assertEquals("WAIT_START_READ", b.cause!!.code)
        assertEquals("POSSIBLE", b.cause!!.confidence)
        assertTrue(b.cause!!.where!!, b.cause!!.where!!.contains("Mp4Extractor"))
        assertFalse(b.cause!!.where!!, b.cause!!.where!!.contains("Matroska"))
        assertFalse(b.cause!!.where!!, b.cause!!.where!!.contains("Torrent"))
        assertTrue(a.integrity.any { it.startsWith("لا تورنت") })
        // أول بايت عبر HTTP: فتح الاتصال بالخادم مقاس، لا «غير معروف»
        val first = a.phases.first { it.id == "first-byte" }
        assertEquals("HTTP_CONNECT", first.cause!!.code)
        val text = GoldReport.text(input)
        assertTrue(text, text.contains("(يشمل ما بعد البدء)"))
        assertTrue(text, text.contains("[المسار الحرج من نية فتح المشغّل · الضغطة لم تُقس]"))
        assertFalse(text, text.contains("TorrentDataSource"))
    }

    @Test fun `انتظارات تشغيل سابق للتورنت نفسه لا تدخل هذه الجلسة`() {
        // التقريران 3 و4: قائمة القطعة 6 نفسها في «بلا كاش» و«مع كاش» — السجل لكل تورنت لا لكل تشغيل
        val old = listOf(wait(6, 1_100, 4_000, engine = 0, blocks = 64), wait(7, 600, 5_000, engine = 57, blocks = 64))
        val mine = wait(75, 130, 10_200, engine = 41, blocks = 64)
        val input = GoldReport.Input(tapAt = 9_910, openAt = 10_000, reads = listOf(read(10_010, 10_020, 0, 6 * MB, endAt = 10_030)),
            tracksAt = 10_090, frameAt = 10_220, readyAt = 10_290,
            torrent = GoldReport.Torrent(metadataAt = 2_000, fileBytes = 1_340 * MB, pieceBytes = MB.toInt(), waits = old + mine), now = 11_000)
        val a = GoldReport.analyze(input)
        assertTrue(a.integrity.toString(), a.integrity.any { it.startsWith("استُبعد 2 انتظارًا من تشغيل سابق") })
        assertTrue(a.phases.flatMap { it.evidence }.none { it.startsWith("القطعة 6:") || it.startsWith("القطعة 7:") })
        assertEquals(listOf(mine), GoldReport.sessionWaits(old + mine, 10_000))
    }

    @Test fun `الانتظار الواحد في مرحلتين - كل مرحلة بنصيبها لا بالانتظار كله`() {
        // التقرير 7 (أنمي 518MB): انتظار القطعة 1 مدته 437ms ظهر كاملًا داخل مرحلة 170ms وأخرى 130ms
        val input = GoldReport.Input(tapAt = 9_890, openAt = 10_000, reads = listOf(read(10_000, 10_014, 0, 27 * MB, endAt = 0L)),
            tracksAt = 10_190, frameAt = 10_360, readyAt = 10_490,
            torrent = GoldReport.Torrent(metadataAt = 5_000, fileBytes = 518 * MB, pieceBytes = MB.toInt(), waits = listOf(wait(1, 437, 10_490, engine = 0, blocks = 64))), now = 18_300)
        val a = GoldReport.analyze(input)
        val rendered = a.phases.first { it.id == "rendered" }
        assertTrue(rendered.evidence.toString(), rendered.evidence.any { it.startsWith("القطعة 1: 170ms في هذه المرحلة من انتظار 437ms") })
        val ready = a.phases.first { it.id == "ready" }
        assertTrue(ready.evidence.toString(), ready.evidence.any { it.startsWith("القطعة 1: 130ms في هذه المرحلة من انتظار 437ms") })
        // «لم تبدأ» حقيقة اللقطة الأولى؛ لماذا (لم تُطلب/لم يرد المشارك) غير مثبت
        assertTrue(rendered.cause!!.hypothesis!!.contains("لم تُطلب بعد"))
    }

    @Test fun `التسخين المجدول ليس جاهزًا - 95GB بصفر قطع مستهدفة وبلا إشارة جاهزية`() {
        // التقرير 6: «التسخين: جاهز قبل الفتح بـ0 قطعة» ثم انتظر أول بايت 12 ث. warmedAt لحظة الجدولة لا الجاهزية
        val input = GoldReport.Input(tapAt = 9_940, openAt = 10_000, reads = listOf(read(10_000, 22_030, 0, 537 * 1024L, endAt = 22_740)),
            tracksAt = 32_900, frameAt = 37_850, readyAt = 42_150,
            torrent = GoldReport.Torrent(metadataAt = 1_000, warmedAt = 4_900, warmedPieces = 0, fileBytes = 95_630 * MB, pieceBytes = 16 * MB.toInt(),
                waits = listOf(wait(0, 12_019, 22_020, engine = 0, blocks = 1024, early = true)), clusterAt = 537 * 1024L), now = 48_000)
        val text = GoldReport.text(input)
        assertFalse(text, text.contains("جاهز قبل الفتح بـ0 قطعة"))
        assertTrue(text, text.contains("جُدول قبل الفتح بـ5.10 ث · مستهدف 0 قطعة · إشارة الجاهزية (بداية الملف على القرص): لم تُرَ · Metadata جاهزة قبل الفتح"))
        val b = GoldReport.analyze(input).bottleneck!!
        assertEquals("first-byte", b.id)
        // انتظار 12 ث من لقطة أولى: لا «مؤكد»
        assertEquals("STRONGLY_SUPPORTED", b.cause!!.confidence)
    }

    @Test fun `من الضغطة الحقيقية - pick ونداء play ونية المشغّل مراحل مقاسة قبل فتح المصدر`() {
        val input = GoldReport.Input(tapAt = 5_000, pickedAt = 7_400, uiOpenAt = 7_450, intentAt = 7_480, openAt = 7_560,
            reads = listOf(read(7_600, 7_700, 0)), tracksAt = 7_800, frameAt = 7_900, readyAt = 8_000, now = 9_000, container = "video/mp4")
        val a = GoldReport.analyze(input)
        assertEquals(listOf("pick", "ui-open", "bridge", "source"), a.phases.take(4).map { it.id })
        assertEquals(2_400L, a.phases.first().ms)
        assertEquals("pick", a.bottleneck!!.id)
        assertEquals("UI_PICK", a.bottleneck!!.cause!!.code)
        assertEquals(5_000L, a.origin)
        assertTrue(GoldReport.text(input).contains("[المسار الحرج من الضغطة]"))
    }

    @Test fun `ذيل الملف بلا موضع Cues - المكان مقاس ونوع البيانات محتمل`() {
        val a = GoldReport.analyze(GoldReport.Input(tapAt = 9_900, openAt = 10_000,
            reads = listOf(read(10_000, 10_100, 0, 9 * 1024L, endAt = 10_200), read(10_300, 10_400, 33 * GB, 329 * 1024L, endAt = 11_500)),
            tracksAt = 11_600, frameAt = 11_700, readyAt = 11_800,
            torrent = GoldReport.Torrent(metadataAt = 9_000, fileBytes = 33 * GB + MB, pieceBytes = 8 * MB.toInt(), clusterAt = 8 * 1024L), now = 12_000, container = "video/x-matroska"))
        val c = a.phases.first { it.id == "container" }.cause!!
        assertEquals("WAIT_TAIL_READ", c.code)
        assertEquals("POSSIBLE", c.confidence)
        assertTrue(c.hypothesis!!.contains("Cues"))
    }
}
