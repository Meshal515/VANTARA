package com.vantara.addons.torrent

import org.junit.Assert.*
import org.junit.Test

class TorrentPolicyTest {
    private val hash = "0123456789abcdef0123456789abcdef01234567"
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
    }
}
