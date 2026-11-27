package com.vantara.addons.torrent

import org.junit.Assert.*
import org.junit.Test

class TorrentPolicyTest {
    private val hash = "0123456789abcdef0123456789abcdef01234567"
    @Test fun edgesGetADeadlineOnTheFirstOpenOnlyWhileRequestedCuesAlwaysDo() {
        val edges = listOf(0, 13, 14)
        // أول فتح: الرأس بموعد النافذة، والذيل بعده
        assertEquals(listOf(13, 14), TorrentPolicy.pendingEdges(true, edges, emptyList(), listOf(0, 1)) { false })
        // متابعة من المنتصف بعد الفتح الأول: الطرفان لا يزاحمان موضعها، وقطعة الفهرس التي طُلبت للقفز تبقى
        assertEquals(emptyList<Int>(), TorrentPolicy.pendingEdges(false, edges, emptyList(), listOf(6, 7)) { false })
        assertEquals(listOf(14), TorrentPolicy.pendingEdges(false, edges, listOf(14), listOf(6, 7)) { false })
        assertEquals(emptyList<Int>(), TorrentPolicy.pendingEdges(true, edges, listOf(14), listOf(0)) { it != 0 })
    }
    @Test fun hashIdentityCannotBeChangedByMagnet() {
        assertEquals(hash, TorrentRequest(hash.uppercase()).infoHash)
        assertThrows(IllegalArgumentException::class.java) { TorrentRequest(hash, magnet = "magnet:?xt=urn:btih:${"a".repeat(40)}") }
        assertThrows(IllegalArgumentException::class.java) { TorrentRequest(hash, fileIdx = -1) }
    }
    @Test fun base32MagnetPreservesCanonicalTorrentIdentity() {
        val encoded = "AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH"
        assertEquals(hash, TorrentRequest(encoded).infoHash)
        assertEquals(hash, TorrentRequest(hash, magnet = "magnet:?xt=urn:btih:$encoded").infoHash)
    }
    @Test fun publicNumericTrackersAreCompatibleButPrivateOnesAreFiltered() {
        val request = TorrentRequest(hash, sources = listOf("tracker:udp://8.8.8.8:1337/announce", "tracker:udp://10.0.0.1:1337/announce", "tracker:udp://100.64.1.1:1337/announce", "tracker:udp://[2001:4860:4860::8888]:1337/announce"))
        assertEquals(2, request.trackers.size)
    }
    @Test fun trackersCannotPointAtLocalServices() {
        val request = TorrentRequest(hash, sources = listOf("tracker:udp://tracker.opentrackr.org:1337/announce", "tracker:http://127.0.0.1:9999", "tracker:https://example.com/announce", "dht:$hash"))
        assertEquals(2, request.trackers.size)
        assertFalse(request.magnetUri().contains("127.0.0.1"))
        assertTrue(request.magnetUri().contains("xt=urn:btih:$hash"))
    }
    @Test fun explicitFileIndexNeverFallsBackToWrongEpisode() {
        val files = listOf(TorrentFile(0, "sample.mp4", 10, 0), TorrentFile(1, "episode.mkv", 1000, 10))
        assertEquals(0, TorrentPolicy.selectFile(files, 0).index)
        assertEquals(1, TorrentPolicy.selectFile(files, null).index)
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(files, 3) }
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(listOf(TorrentFile(0, "sub.srt", 100, 0)), null) }
    }
    @Test fun byteMappingHandlesFileBoundaryAndEof() {
        val file = TorrentFile(1, "episode.mkv", 300, 190)
        assertEquals(PieceRead(1, 90, 10), TorrentPolicy.readAt(file, 0, 100, 100))
        assertEquals(PieceRead(4, 80, 10), TorrentPolicy.readAt(file, 290, 100, 100))
        assertNull(TorrentPolicy.readAt(file, 300, 100, 100))
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.readAt(file, 301, 100, 100) }
    }
    @Test fun seeksReplaceOldWindowAndNeverReadAdjacentFile() {
        val file = TorrentFile(0, "episode.mp4", 400, 30)
        assertEquals(listOf(0, 1, 2), TorrentPolicy.window(file, 0, 100, 3))
        assertEquals(listOf(3, 4), TorrentPolicy.window(file, 350, 100, 3))
    }
    @Test fun noTraversalOrExecutableCanBecomeVideo() {
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(listOf(TorrentFile(0, "../escape.mp4", 100, 0)), null) }
        assertThrows(IllegalArgumentException::class.java) { TorrentPolicy.selectFile(listOf(TorrentFile(0, "video.mp4.exe", 100, 0)), 0) }
    }
    @Test fun containerEdgesAreFetchedFirst() {
        // MP4 moov / MKV cues / AVI idx1 at the tail: the extractor's first seek must not wait for a cold piece
        assertEquals(listOf(0, 3, 4), TorrentPolicy.edges(TorrentFile(0, "movie.mkv", 450, 30), 100))
        assertEquals(listOf(2), TorrentPolicy.edges(TorrentFile(1, "tiny.mp4", 10, 250), 100))
        assertEquals(emptyList<Int>(), TorrentPolicy.edges(TorrentFile(1, "empty.mp4", 0, 250), 100))
        // قطع 8MB لملف 2.24GB (عينة الجهاز): الفهرس في آخر 2MB، فقطعة الذيل الأخيرة وحدها لا قطعتان (16MB)
        val mb = 1024 * 1024
        val big = TorrentFile(0, "remux.mkv", 2_405_181_440L, 0)
        val lastBig = ((big.size - 1) / (8 * mb)).toInt()
        assertEquals(listOf(0, lastBig), TorrentPolicy.edges(big, 8 * mb))
        // الملف ينتهي بعد حد القطعة بـ1MB: آخر 2MB تقع في قطعتين، فكلتاهما
        val straddle = TorrentFile(0, "straddle.mkv", 10L * 8 * mb + mb, 0)
        assertEquals(listOf(0, 9, 10), TorrentPolicy.edges(straddle, 8 * mb))
    }
    @Test fun startFocusOnlyUntilTheAwaitedPieceArrives() {
        val full = (0..11).toList()
        // أول نافذة والقطعة 0 لم تكتمل: تركيز
        assertTrue(TorrentPolicy.focusStart(full, emptyList(), focused = false, haveHead = false))
        // ما زالت تنتظر 0 والتركيز قائم: يبقى
        assertTrue(TorrentPolicy.focusStart(full, listOf(0, 1), focused = true, haveHead = false))
        // اكتملت 0: تُفتح النافذة
        assertFalse(TorrentPolicy.focusStart(full, listOf(0, 1), focused = true, haveHead = true))
        // تخطي المرفقات من 0 إلى 3 بعد فتح النافذة: قفزة خارج القطع ذات الموعد، تركيز
        assertTrue(TorrentPolicy.focusStart((3..14).toList(), full, focused = false, haveHead = false))
        // تشغيل مستمر: القطعة التالية من القطع ذات الموعد، فلا تركيز ولو لم تكتمل
        assertFalse(TorrentPolicy.focusStart((1..12).toList(), full, focused = false, haveHead = false))
        // قفزة إلى موضع بعيد لم يُنزَّل: تركيز
        assertTrue(TorrentPolicy.focusStart((500..511).toList(), (1..12).toList(), focused = false, haveHead = false))
        assertFalse(TorrentPolicy.focusStart(emptyList(), full, focused = false, haveHead = false))
    }
    @Test fun largePiecesFocusOnTheAwaitedPieceAlone() {
        val mb = 1024 * 1024
        assertEquals(2, TorrentPolicy.focusPieces(mb))
        assertEquals(2, TorrentPolicy.focusPieces(2 * mb))
        assertEquals(1, TorrentPolicy.focusPieces(4 * mb))
        assertEquals(1, TorrentPolicy.focusPieces(16 * mb))
    }
    @Test fun turboReadsOnlyContiguousWrittenBlocksInsideThePiece() {
        val b = TurboRead.BLOCK_BYTES
        val bits = java.util.BitSet().apply { set(0); set(1); set(3) }
        // الكتلتان 0 و1 مكتوبتان، والثالثة (2) لا: يتوقف عند حدها
        assertEquals(2 * b, TurboRead.writtenSpan(bits, 0, 10 * b, 16 * b))
        assertEquals(2 * b - 100, TurboRead.writtenSpan(bits, 100, 10 * b, 16 * b))
        // بحد الطول المطلوب
        assertEquals(500, TurboRead.writtenSpan(bits, 100, 500, 16 * b))
        // كتلة الموضع غير مكتوبة: لا شيء، ولو كُتب ما بعدها
        assertEquals(0, TurboRead.writtenSpan(bits, 2 * b, b, 16 * b))
        // آخر قطعة أقصر من حجم القطع، وكتلتها الأخيرة ناقصة
        val tail = java.util.BitSet().apply { set(0, 3) }
        assertEquals(2 * b + 10, TurboRead.writtenSpan(tail, 0, 100 * b, 2 * b + 10))
        // مدخلات خارج الحدود
        assertEquals(0, TurboRead.writtenSpan(null, 0, b, 16 * b))
        assertEquals(0, TurboRead.writtenSpan(bits, -1, b, 16 * b))
        assertEquals(0, TurboRead.writtenSpan(bits, 16 * b, b, 16 * b))
        assertEquals(0, TurboRead.writtenSpan(bits, 0, 0, 16 * b))
    }
    @Test fun turboSpanFuzzNeverCrossesAnUnwrittenBlockOrThePieceEnd() {
        // اختبار عشوائي ببذرة ثابتة: الخصائص الأربع تحدد الدالة تمامًا
        val random = java.util.Random(20261127)
        val b = TurboRead.BLOCK_BYTES
        repeat(20_000) {
            val pieceSize = 1 + random.nextInt(32 * 1024 * 1024)
            val blocks = (pieceSize + b - 1) / b
            val bits = java.util.BitSet()
            val density = random.nextDouble()
            for (i in 0 until blocks) if (random.nextDouble() < density) bits.set(i)
            val offset = random.nextInt(pieceSize + b) - b / 2
            val length = random.nextInt(4 * 1024 * 1024) - 1024
            val n = TurboRead.writtenSpan(bits, offset, length, pieceSize)
            assertTrue(n >= 0)
            if (offset < 0 || length <= 0 || offset >= pieceSize) { assertEquals(0, n); return@repeat }
            assertTrue("within the request", n <= length)
            assertTrue("within the piece", offset.toLong() + n <= pieceSize)
            if (n > 0) for (block in offset / b..(offset + n - 1) / b) assertTrue("block $block written", bits.get(block))
            if (n < length && offset + n < pieceSize) assertFalse("maximal: next block unwritten", bits.get((offset + n) / b))
        }
    }
    @Test fun turboRejectsBlocksOutsideThePiece() {
        val b = TurboRead.BLOCK_BYTES
        assertTrue(TurboRead.validBlock(0, 16 * b))
        assertTrue(TurboRead.validBlock(15, 16 * b))
        assertFalse(TurboRead.validBlock(16, 16 * b))
        assertFalse(TurboRead.validBlock(-1, 16 * b))
        assertFalse(TurboRead.validBlock(0, 0))
        // أكبر رقم كتلة لا يفيض
        assertFalse(TurboRead.validBlock(Int.MAX_VALUE, 16 * b))
    }
    @Test fun turboCoversTheSameBytesWhateverThePieceSize() {
        val mb = 1024 * 1024
        // سقف 32MB: قطعتان من 16MB، وثمانٍ من 4MB (كانت قطعتين = 8MB فيقف عند الثالثة بعد الاستئناف)
        assertEquals(2, TurboRead.piecesPerOpen(16 * mb))
        assertEquals(8, TurboRead.piecesPerOpen(4 * mb))
        assertEquals(32, TurboRead.piecesPerOpen(mb))
        // لا أقل من قطعتين (الرأس وما بعد المرفقات)، ولا أكثر من 64 مهما صغرت القطعة
        assertEquals(2, TurboRead.piecesPerOpen(32 * mb))
        assertEquals(64, TurboRead.piecesPerOpen(16 * 1024))
        assertEquals(2, TurboRead.piecesPerOpen(0))
    }
}
