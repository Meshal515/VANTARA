package com.vantara.anime.player

import androidx.media3.common.Player
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackDiagnosticsTest {
    private var clock = 1_000_000L
    private val diag = PlaybackDiagnostics { clock }
    private fun at(ms: Long) { clock = 1_000_000L + ms }
    private val mb = 1024L * 1024
    private fun torrent(waiting: Int = -1, since: Long = 0, blocks: Pair<Int, Int>? = null) = PlaybackDiagnostics.TorrentFacts(
        peers = 49, seeds = 38, downloadBps = 2_000_000, fileBytes = 318 * mb, pieceBytes = (1 * mb).toInt(),
        metadataAt = 1_000_000L + 1_200, firstPieceAt = 1_000_000L + 4_600, waitingPiece = waiting, waitingSince = since, waitingBlocks = blocks,
    )
    private fun player(state: Int = Player.STATE_READY) = PlaybackDiagnostics.PlayerFacts(state, 4_000, 40_000, 1_437_000, "video/x-matroska", "video/av01 1920x1080", "c2.qti.av1.decoder", 3, 1)

    /** خط البدء الكامل: من الضغط، وأول مشارك وأول بيانات، وما جُهّز قبل فتح المشغّل يُكتب «قبل الفتح». */
    @Test fun timelineStartsAtTheTapAndMarksWarmStagesBeforeOpen() {
        diag.launchedAt = 1_000_000L - 1_500
        at(0); diag.start()
        val head = Any()
        at(100); diag.initializing(head); at(2_000); diag.opened(head, 0); diag.transferred(head, mb.toInt())
        at(2_400); diag.state(Player.STATE_READY, 0, 3_000); diag.firstFrame()
        val warm = PlaybackDiagnostics.TorrentFacts(
            peers = 20, seeds = 10, downloadBps = 2_000_000, fileBytes = 318 * mb, pieceBytes = (1 * mb).toInt(),
            metadataAt = 1_000_000L - 30_000, firstPieceAt = 1_000_000L + 1_900, waitingPiece = -1, waitingSince = 0, waitingBlocks = null,
            firstPeerAt = 1_000_000L - 29_000, firstPayloadAt = 1_000_000L + 700,
        )
        val report = diag.report(warm, player(), clock)
        assertTrue(report, report.contains("من الضغط حتى فتح المصدر: 1.5 ث · من الضغط حتى أول صورة: 3.9 ث"))
        assertTrue(report, report.contains("خط البدء: بيانات التورنت قبل الفتح · أول مشارك قبل الفتح · أول بيانات +0.7 · أول قطعة +1.9"))
    }

    /** لقطة المستخدم (Steins;Gate): أول بايت +4.6 والجاهزية +19.9 — التقرير يقول أين ذهبت المدة بأرقامها. */
    @Test fun reportsWhereTheTimeBetweenFirstByteAndReadyWent() {
        at(0); diag.start()
        val head = Any(); val tail = Any(); val back = Any()
        at(100); diag.initializing(head); at(4_600); diag.opened(head, 0); diag.transferred(head, (10.4 * mb).toInt()); at(14_400); diag.ended(head)
        diag.initializing(tail); diag.opened(tail, 317 * mb); diag.transferred(tail, mb.toInt()); at(15_500); diag.ended(tail)
        diag.initializing(back); diag.opened(back, (10.4 * mb).toLong()); diag.transferred(back, (2 * mb).toInt())
        at(19_900); diag.state(Player.STATE_READY, 0, 3_000); diag.firstFrame()

        val verdict = diag.verdict(torrent(), player(), clock)
        assertTrue(verdict, verdict.startsWith("أطول مرحلة: من أول بايت إلى الجاهزية 15.3 ث"))
        assertTrue(verdict, verdict.contains("من البداية 10.4MB") && verdict.contains("من آخر الملف"))
        val report = diag.report(torrent(), player(), clock)
        assertTrue(report, report.contains("خط البدء: بيانات التورنت +1.2 · أول مشارك — · أول بيانات — · أول قطعة +4.6 · أول بايت +4.6 · جاهز +19.9 · أول صورة +19.9"))
        assertTrue(report, report.contains("1) +0.1 من البداية → 10.4MB · فتح بعد 4.5 ث · أول بايت بعد 0.0 ث · مدة 9.8 ث"))
        assertTrue(report, report.contains("المفكك c2.qti.av1.decoder") && report.contains("ترجمة 3"))
        // لا عنوان ولا رابط ولا هوية في التقرير المنسوخ
        assertFalse(report.contains("vantara-torrent"))
    }

    /**
     * لقطة المالك (Reacher، متابعة عند 5:29): فهرس آخر الملف 168KB أخذ 10.4 ث. السطر الجديد يفصل الجذور: كتل على القرص لا
     * يعرفها المحرك، أو كتلة الموضع لم تُنزَّل، أو تلميح لا يصل libtorrent.
     */
    @Test fun reportsHintDeliveryAndHowEachLongWaitEnded() {
        at(0); diag.start()
        val waits = listOf(
            com.vantara.addons.torrent.ReadWait(piece = 122, block = 1010, blocks = 1024, known = 3, engine = 900, atOffset = false, ms = 10_400, early = false, tail = true),
            com.vantara.addons.torrent.ReadWait(piece = 13, block = 0, blocks = 1024, known = 40, engine = 41, atOffset = false, ms = 1_300, early = true, tail = false),
        )
        val facts = PlaybackDiagnostics.TorrentFacts(
            peers = 62, seeds = 38, downloadBps = 3_700_000, fileBytes = 1966 * mb, pieceBytes = (16 * mb).toInt(),
            metadataAt = 1_000_000L, firstPieceAt = 0, waitingPiece = -1, waitingSince = 0, waitingBlocks = null,
            hintsSent = 37, waits = waits,
        )
        val report = diag.report(facts, player(), clock)
        assertTrue(report, report.contains("· تلميح القراءة: وصل 37"))
        assertTrue(report, report.contains("القطعة 122 (آخر الملف) عند الكتلة 1010: 10.4 ث · مكتوب عندنا 3 وفي libtorrent 900 من 1024 · كتلة الموضع غير معروفة · انتهى بالقطعة الموثقة · فجوة: كتل على القرص لا يعرفها المحرك"))
        assertTrue(report, report.contains("القطعة 13 عند الكتلة 0: 1.3 ث · مكتوب عندنا 40 وفي libtorrent 41 من 1024 · كتلة الموضع غير معروفة · انتهى بقراءة قبل التحقق · كتلة الموضع لم تُنزَّل بعد"))
        val unpatched = diag.report(PlaybackDiagnostics.TorrentFacts(1, 1, 1, mb, mb.toInt(), 0, 0, -1, 0, null, hintsFailed = 4), player(), clock)
        assertTrue(unpatched, unpatched.contains("تلميح القراءة: لا يصل (فشل 4، المكتبة بلا 0004)"))
        assertFalse(unpatched, unpatched.contains("انتظار القطع"))
    }

    @Test fun namesThePieceThePlayerIsWaitingFor() {
        at(0); diag.start()
        at(30_000)
        val verdict = diag.verdict(torrent(waiting = 812, since = 1_000_000L + 26_800, blocks = 450 to 1024), player(Player.STATE_BUFFERING), clock)
        assertEquals("المشغّل ينتظر القطعة 812 منذ 3.2 ث، وصل منها 450 من 1024 كتلة", verdict)
    }

    @Test fun seekInsideLoadedDataIsReadyAtOnceAndFarSeekWaitsForReady() {
        at(0); diag.start()
        at(20_000); diag.seek(140_000, 150_000, readyNow = true)
        at(21_000); diag.seek(150_000, 720_000)
        at(26_000); diag.state(Player.STATE_READY, 720_000, 3_000)
        val report = diag.report(null, player(), clock)
        assertTrue(report, report.contains("1) 2:20 ← 2:30: جاهز بعد 0.0 ث"))
        assertTrue(report, report.contains("2) 2:30 ← 12:00: جاهز بعد 5.0 ث"))
    }

    @Test fun keepsOnlyTheLatestReadsSoTheLogStaysSmall() {
        at(0); diag.start()
        repeat(PlaybackDiagnostics.MAX_READS + 25) { i -> val k = Any(); diag.opened(k, i * 1000L); diag.ended(k) }
        val report = diag.report(null, player(), clock)
        assertTrue(report, report.contains("طلبات القراءة (${PlaybackDiagnostics.MAX_READS})"))
        assertFalse(report.contains("  1) "))
    }

    @Test fun torrentVerdictNeverBlamesAServer() {
        assertEquals("الشبكة جيدة", NetStats.verdict(2400, 3_000_000, 8_000_000, 2_000, torrentPeers = 40, torrent = true))
    }
    @Test fun readyWithoutFrameReportsTheMissingVideoEvidence() {
        at(0); diag.start()
        val source = Any()
        at(100); diag.opened(source, 0); diag.transferred(source, 1024)
        at(200); diag.state(Player.STATE_READY, 0, 10000)
        at(5000)
        assertTrue(diag.verdict(null, player(), clock).contains("أول صورة"))
    }

    @Test fun copiedFailureRetainsCauseCodeButRedactsUrlsAndHeaders() {
        at(0); diag.start()
        diag.error("ROOT HTTP 403 https://media.test/a?token=secret Cookie: session=secret")
        val report = diag.report(null, player(), clock)
        assertTrue(report.contains("ROOT HTTP 403"))
        assertFalse(report.contains("secret")); assertFalse(report.contains("media.test"))
    }

}
