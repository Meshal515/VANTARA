package com.vantara.addons.torrent

import org.junit.Assert.*
import org.junit.Test

/** بدء التورنت السريع: المتتبّعات العامة، مواعيد القطع الأولى، واختيار التجهيز المسبق. */
class TorrentStartupTest {
    private val hash = "0123456789abcdef0123456789abcdef01234567"

    @Test fun addonWithoutTrackersStillAnnouncesToPublicTrackers() {
        val request = TorrentRequest(hash, sources = listOf("dht:$hash"))
        assertTrue(request.trackers.isEmpty())
        assertEquals(TorrentPolicy.PUBLIC_TRACKERS, request.announce)
        assertTrue(request.magnetUri().contains("tracker.opentrackr.org"))
    }

    @Test fun addonTrackersComeFirstAndDuplicatesCollapse() {
        val request = TorrentRequest(hash, sources = listOf("tracker:udp://tracker.example.org:6969/announce", "tracker:udp://Tracker.OpenTrackr.org:1337/announce/"))
        assertEquals("udp://tracker.example.org:6969/announce", request.announce.first())
        assertEquals(1, request.announce.count { it.contains("opentrackr.org:1337", ignoreCase = true) && it.startsWith("udp") })
        assertEquals(TorrentPolicy.PUBLIC_TRACKERS.size + 1, request.announce.size)
    }

    @Test fun privateAddonTrackerNeverReachesAnnounceList() {
        val request = TorrentRequest(hash, sources = listOf("tracker:http://127.0.0.1:9999/announce", "tracker:udp://192.168.1.1:80/announce"))
        assertTrue(request.announce.none { "127.0.0.1" in it || "192.168." in it })
        assertFalse(request.magnetUri().contains("127.0.0.1"))
    }

    @Test fun publicTrackerListIsItselfPublicAndBounded() {
        // القائمة الثابتة تمرّ بالفلتر نفسه الذي يمرّ به متتبّع الإضافة
        val request = TorrentRequest(hash, sources = TorrentPolicy.PUBLIC_TRACKERS.map { "tracker:$it" })
        assertEquals(TorrentPolicy.PUBLIC_TRACKERS, request.trackers)
        val many = (1..60).map { "udp://t$it.example.org:80/announce" }
        assertEquals(TorrentPolicy.MAX_ANNOUNCE, TorrentPolicy.mergeTrackers(many).size)
    }

    @Test fun currentPieceFirstThenUnfinishedEdgesThenWideningRamp() {
        val plan = TorrentPolicy.deadlines((5..10).toList(), listOf(20, 21))
        assertEquals(listOf(5 to 0, 20 to 250, 21 to 500, 6 to 750, 7 to 1000, 8 to 1250, 9 to 2250, 10 to 3000), plan)
        val times = plan.map { it.second }
        assertEquals(times.sorted(), times)
        assertEquals(1, times.count { it == 0 })
    }

    @Test fun edgeAlreadyInWindowIsNotScheduledTwice() {
        val plan = TorrentPolicy.deadlines(listOf(3, 4), listOf(4))
        assertEquals(listOf(3 to 0, 4 to 250), plan)
        assertTrue(TorrentPolicy.deadlines(emptyList()).isEmpty())
    }

    @Test fun startupEdgesHeadFirstThenTail() {
        val edges = TorrentPolicy.edges(TorrentFile(0, "movie.mkv", 450, 30), 100)
        assertEquals(listOf(0 to 0, 3 to 250, 4 to 500), TorrentPolicy.deadlines(edges.take(1), edges.drop(1)))
    }

    @Test fun seedersAreReadFromAddonTitles() {
        assertEquals(42, TorrentPrefetch.seeders("Show S01E02 1080p\n👤 42 💾 1.2 GB ⚙️ ThePirateBay"))
        assertEquals(0, TorrentPrefetch.seeders("👤0"))
        assertNull(TorrentPrefetch.seeders("Show S01E02 1080p"))
        assertNull(TorrentPrefetch.seeders(null))
    }

    @Test fun prefetchTakesTopTwoLiveSwarmsAndEdgesOnlyForTheFirst() {
        val ranked = listOf(
            "a" to "4K 👤 0",
            "b" to "1080p 👤 15",
            "b" to "duplicate",
            "c" to "720p (no seeders shown)",
            "d" to "👤 900",
        )
        assertEquals(listOf("b" to true, "c" to false), TorrentPrefetch.pick(ranked))
        assertEquals(listOf("b" to false, "c" to false), TorrentPrefetch.pick(ranked, background = true))
        assertTrue(TorrentPrefetch.pick(listOf("a" to "👤 0")).isEmpty())
        assertTrue(TorrentPrefetch.pick(emptyList()).isEmpty())
    }

    @Test fun warmUpFetchesTheFirstPieceEvenWhenLargeButOnlyOnUnmeteredNetworks() {
        val mb = 1024 * 1024
        // 256KB: أول قطعة والذيل كله
        assertEquals(listOf(0, 1240, 1239), TorrentPrefetch.warmPieces(listOf(0, 1239, 1240), 256 * 1024, unmetered = true))
        // 8MB (Spider-Man): كانت «الأطراف ≤12MB» تُسقطه كله؛ الآن أول قطعة + آخر قطعة = 16MB
        assertEquals(listOf(0, 1175), TorrentPrefetch.warmPieces(listOf(0, 1174, 1175), 8 * mb, unmetered = true))
        // 16MB: أول قطعة وحدها تملأ الميزانية
        assertEquals(listOf(0), TorrentPrefetch.warmPieces(listOf(0, 586, 587), 16 * mb, unmetered = true))
        // أكبر من الميزانية: لا شيء
        assertTrue(TorrentPrefetch.warmPieces(listOf(0, 9, 10), 32 * mb, unmetered = true).isEmpty())
        // باقة الجوال: بيانات واتصالات فقط
        assertTrue(TorrentPrefetch.warmPieces(listOf(0, 1239, 1240), 256 * 1024, unmetered = false).isEmpty())
    }

    @Test fun edgePrefetchIsCappedForMobileData() {
        assertTrue(TorrentPrefetch.edgesFit(4 * 1024 * 1024, 3))
        assertFalse(TorrentPrefetch.edgesFit(8 * 1024 * 1024, 3))
        assertTrue(TorrentPrefetch.edgesFit(1024 * 1024, 3))
        assertFalse(TorrentPrefetch.edgesFit(16 * 1024 * 1024, 3))
        assertFalse(TorrentPrefetch.edgesFit(0, 3))
    }
}
