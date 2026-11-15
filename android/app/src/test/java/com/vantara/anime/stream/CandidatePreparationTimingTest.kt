package com.vantara.anime.stream

import com.vantara.anime.health.HealthStore
import kotlinx.coroutines.Job
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class CandidatePreparationTimingTest {
    private var monotonicMs = 1_000L
    private var wallMs = 100_000L

    private fun prepared(): PreparedEpisode {
        val health = HealthStore(null) { wallMs }
        return PreparedEpisode(
            "fixture", emptyList(), 1f, Preferences(), PlaybackSession(emptyList(), health), health,
            monotonicClock = { monotonicMs }, clock = { wallMs },
        )
    }

    private fun candidate(id: String = "one", source: String = "native") = Candidate(
        id, source, "Fixture", "Host", "cdn.test", "https://cdn.test/$id.m3u8",
        headers = mapOf("Referer" to "https://source.test/episode"), quality = 1080,
        label = "1080p", variant = Variant.SUB, container = Container.HLS,
        subtitles = listOf(TrackRef("https://cdn.test/ar.vtt", "ar")),
        audio = listOf(TrackRef("https://cdn.test/en.m4a", "en")),
        resolvedAt = 1, expiresAt = Long.MAX_VALUE, filename = "episode.mkv", videoHash = "abc",
        videoSize = 1234, duration = 1400, fps = 23.976,
    )

    private fun ready(c: Candidate) = RouteReport(c.sourceId, c.id, c.server, c.quality, c.variant, RouteState.READY, listOf(c))

    @Test fun `first ready measures elapsed preparation independently of wall clock and player wait`() {
        val p = prepared()
        val original = candidate()
        p.report(ready(original).copy(state = RouteState.RESOLVING, candidates = emptyList()))
        monotonicMs = 1_575
        wallMs = 5 // A wall-clock correction cannot change elapsed preparation.
        p.report(ready(original))
        monotonicMs = 8_000 // Waiting to select/prepare a player is outside this measurement.

        val expected = original.copy(preparationMs = 575)
        assertEquals(expected, p.candidate(original.id))
        assertEquals(expected, p.candidatesOf(requireNotNull(p.routeOf(original.id)).id).single())
        assertEquals(expected, p.best())
        assertEquals(expected, p.session.take(original.id))
        assertNull("The adapter's immutable candidate remains untouched", original.preparationMs)
    }

    @Test fun `legacy adoption stamps each source family at availability`() {
        val p = prepared()
        val families = listOf("native", "user-anime#42", "runtime.cloudstream.1", "addon|https://stremio.test")
        for ((index, source) in families.withIndex()) {
            monotonicMs = 1_200L + index * 100L
            val original = candidate("candidate-$index", source)
            p.adopt(source, listOf(original))
            val expected = original.copy(preparationMs = 200L + index * 100L)
            assertEquals(expected, p.candidate(original.id))
            assertEquals(expected, p.session.find(original.id))
        }
    }

    @Test fun `repeat reports preserve first measurement while retaining updated metadata`() {
        val p = prepared()
        val original = candidate()
        monotonicMs = 1_100
        p.report(ready(original))
        monotonicMs = 4_000
        val refreshed = original.copy(headers = mapOf("Referer" to "https://source.test/refreshed"), label = "Updated")
        p.report(ready(refreshed))
        p.adopt(original.sourceId, listOf(original))

        assertEquals(refreshed.copy(preparationMs = 100), p.candidate(original.id))
        assertEquals(original.copy(preparationMs = 100), p.session.find(original.id))
        assertEquals(1, p.session.remaining)
    }

    @Test fun `candidate timings are measured per prepared session`() {
        val first = prepared()
        monotonicMs = 1_300
        first.report(ready(candidate()))
        val reused = requireNotNull(first.candidate("one"))
        val second = prepared()
        monotonicMs = 1_350
        second.adopt(reused.sourceId, listOf(reused))

        assertEquals(300L, first.candidate("one")?.preparationMs)
        assertEquals(50L, second.candidate("one")?.preparationMs)
    }

    @Test fun `legacy serialized candidate has unknown timing rather than zero`() {
        val legacy = Json.decodeFromString<Candidate>("""{
            "id":"legacy","sourceId":"source","sourceName":"Source","server":"Host",
            "host":"cdn.test","url":"https://cdn.test/legacy.mp4","resolvedAt":1,"expiresAt":10000
        }""")

        assertNull(legacy.preparationMs)
    }

    @Test fun `zero elapsed is a measured value`() {
        val p = prepared()
        p.report(ready(candidate()))

        assertEquals(0L, p.candidate("one")?.preparationMs)
    }

    @Test fun `terminal session refuses late reports without replacing recorded timing`() {
        val p = prepared()
        monotonicMs = 1_125
        val original = candidate()
        p.report(ready(original))
        p.forceComplete()
        monotonicMs = 2_000
        p.report(ready(original.copy(label = "Late")))
        p.adopt("native", listOf(candidate("late")))

        assertEquals(original.copy(preparationMs = 125), p.candidate("one"))
        assertNull(p.candidate("late"))
        assertEquals(1, p.session.remaining)
    }

    @Test fun `cancelled preparation does not publish or time late candidate`() {
        val p = prepared()
        val preparation = Job()
        p.job = preparation
        preparation.cancel()
        monotonicMs = 2_000
        p.report(ready(candidate()))
        p.adopt("native", listOf(candidate("late")))

        assertNull(p.candidate("one"))
        assertNull(p.candidate("late"))
        assertTrue(p.routes().isEmpty())
        assertEquals(0, p.session.remaining)
    }
}
