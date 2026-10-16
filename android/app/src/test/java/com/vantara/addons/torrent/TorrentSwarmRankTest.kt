package com.vantara.addons.torrent

import com.vantara.anime.health.HealthStore
import com.vantara.anime.health.Record
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.StreamRanker
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** ترتيب خيارات التورنت بالسرب، وفشل تورنت ميت لا يدفن بقية التورنتات. */
class TorrentSwarmRankTest {
    private fun torrent(id: String, label: String, quality: Int = 1080, size: Long? = null) = Candidate(
        id = id, sourceId = "addon|torrentio", sourceName = "Torrentio", server = "Torrentio", host = "torrent",
        url = "vantara-torrent://$id/file", quality = quality, label = label, resolvedAt = 0, expiresAt = Long.MAX_VALUE, videoSize = size,
    )

    @Test fun sizeAndSeedersAreReadFromAddonLabels() {
        assertEquals(1503238553L, TorrentSwarm.size("Movie 1080p\n👤 42 💾 1.4 GB ⚙️ TPB"))
        assertEquals(700L * 1024 * 1024, TorrentSwarm.size("💾 700 MB"))
        assertNull(TorrentSwarm.size("no size"))
        assertEquals(42, TorrentPrefetch.seeders("👤 42 💾 1.4 GB"))
    }

    @Test fun wellSeededReasonableTorrentOutranksFewSeedsAndHugeRemux() {
        val health = HealthStore(null) { 1_000L }
        val prefs = Preferences()
        val weak = torrent("weak", "1080p WEB\n👤 3 💾 2.1 GB")
        val remux = torrent("remux", "1080p REMUX\n👤 900 💾 38 GB")
        val good = torrent("good", "1080p WEB-DL\n👤 850 💾 2.4 GB")
        val dead = torrent("dead", "1080p\n👤 0 💾 1.9 GB")
        val ranked = StreamRanker.rank(listOf(dead, weak, remux, good), health, prefs, 0)
        assertEquals(listOf("good", "remux", "weak", "dead"), ranked.map { it.id })
    }

    @Test fun deadTorrentsDoNotTripTheSharedTorrentHost() {
        val health = HealthStore(null) { 1_000L }
        val list = (1..5).map { torrent("t$it", "👤 0") }
        val session = PlaybackSession(list, health)
        var c = session.next()
        repeat(4) { c = session.failed(c!!, "Torrent buffer timed out; try another source") }
        assertFalse(health.skip(HealthStore.hostKey("torrent")))
        assertFalse(health.skip(HealthStore.sourceKey("addon|torrentio")))
        assertNull(health.get(HealthStore.hostKey("torrent")))
    }

    @Test fun recordsPoisonedByOldTorrentFailuresAreDroppedOnLoad() {
        val file = File.createTempFile("health", ".json")
        file.writeText("""[{"key":"host:torrent","fail":9,"streak":9,"lastFailAt":1},
            {"key":"source:addon|torrentio","fail":4,"streak":4,"lastFailAt":1,"lastError":"كل سيرفرات الحلقة فشلت: لم يبدأ خلال 90 ثانية"},
            {"key":"host:example.com","fail":4,"streak":4,"lastFailAt":1,"lastError":"HTTP 500"}]""")
        val health = HealthStore(file) { 2L }
        assertNull(health.get("host:torrent"))
        assertNull(health.get("source:addon|torrentio"))
        assertNotNull(health.get("host:example.com"))
        file.delete()
    }
}
