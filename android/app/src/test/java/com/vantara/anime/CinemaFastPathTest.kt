package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourcePage
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.ResolveTrace
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.StreamProbe
import com.vantara.anime.stream.Variant
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** مسار السينما السريع: فحص الرابط، الفيلم بلا رقم، والجلسة التي تكبر. */
class CinemaFastPathTest {
    private val now = 1_000_000L

    private fun cand(id: String, host: String, q: Int?, container: Container = Container.HLS) = Candidate(
        id = id, sourceId = "s1", sourceName = "s1", server = host, host = host, url = "https://$host/$id",
        quality = q, variant = Variant.SUB, container = container, resolvedAt = now, expiresAt = now + 60_000,
    )

    private fun prepared(): PreparedEpisode {
        val h = HealthStore(null) { now }
        return PreparedEpisode("s", emptyList(), -1f, Preferences(1080, Variant.SUB), PlaybackSession(emptyList(), h), h, probe = true) { now }
            .also { it.job = Job() }
    }

    private fun ready(key: String, vararg c: Candidate) = RouteReport("s1", key, c.first().host, c.first().quality, Variant.SUB, RouteState.READY, c.toList())

    @Test fun `HLS must answer with a playlist`() {
        assertTrue(StreamProbe.verdict(Container.HLS, "application/vnd.apple.mpegurl", "#EXTM3U\n#EXT-X-VERSION:3"))
        assertTrue(StreamProbe.verdict(Container.UNKNOWN, "text/plain", "﻿#EXTM3U"))
        assertFalse(StreamProbe.verdict(Container.HLS, "text/html", "<!DOCTYPE html><title>404</title>"))
        assertFalse(StreamProbe.verdict(Container.HLS, "application/octet-stream", "garbage"))
    }

    @Test fun `MP4 is accepted unless the host answers with a page`() {
        assertTrue(StreamProbe.verdict(Container.MP4, "video/mp4", "\u0000\u0000\u0000 ftypisom"))
        assertTrue(StreamProbe.verdict(Container.UNKNOWN, "application/octet-stream", "\u0000\u0000"))
        assertFalse(StreamProbe.verdict(Container.MP4, "text/html; charset=utf-8", "<html>blocked</html>"))
        assertFalse(StreamProbe.verdict(Container.MP4, null, "<!doctype html>"))
        assertFalse(StreamProbe.verdict(Container.MP4, "application/json", "{\"error\":\"expired\"}"))
    }

    @Test fun `plain error responses cannot be mistaken for MP4`() {
        assertFalse(StreamProbe.verdict(Container.MP4, "text/plain", "File expired"))
        assertFalse(StreamProbe.verdict(Container.UNKNOWN, null, ""))
        assertFalse(StreamProbe.verdict(Container.UNKNOWN, null, "{\"error\":\"expired\"}"))
    }

    @Test fun `a movie asks for its only episode whatever the source numbers it`() {
        val r = EpisodeResolver({ null }, HealthStore(null) { now })
        val zero = listOf(SourceEpisode("s1", "/m", "فيلم", 0f))
        val one = listOf(SourceEpisode("s2", "/m", "Movie", 1f))
        assertEquals("/m", r.pick(zero, -1f)?.url)
        assertEquals("/m", r.pick(one, -1f)?.url)
        assertNull(r.pick(emptyList(), -1f))
        // الأنمي لا يتأثر: الرقم الموجب يطابق كما كان
        assertNull(r.pick(zero, 1f))
    }

    @Test fun `a parent series resolves the requested season and caches each season independently`() = runBlocking {
        val seen = mutableListOf<String>()
        val adapter = object : AnimeAdapter {
            override val id = "egydead"
            override val name = "EgyDead"
            override suspend fun page(listing: Listing, page: Int, query: String) = SourcePage(emptyList(), false)
            override suspend fun details(anime: SourceAnime) = anime
            override suspend fun seasons(anime: SourceAnime) = listOf(
                SourceAnime(id, "/season/s02", "The Gentlemen الموسم الثاني", seasonNumber = 2.0),
                SourceAnime(id, "/season/s01", "The Gentlemen الموسم الاول", seasonNumber = 1.0),
            )
            override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
                seen += anime.url
                return listOf(SourceEpisode(id, "${anime.url}/episode1", "1", 1f))
            }
            override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) = emptyList<Candidate>()
        }
        val r = EpisodeResolver({ adapter }, HealthStore(null))
        val parent = SourceAnime("egydead", "/serie/gentlemen", "The Gentlemen", hasSeasons = true)
        val first = r.episodes(EpisodeResolver.Copy("egydead", parent.copy(requestedSeason = 1)))
        val second = r.episodes(EpisodeResolver.Copy("egydead", parent.copy(requestedSeason = 2)))
        assertEquals("/season/s01/episode1", first.single().url)
        assertEquals("/season/s02/episode1", second.single().url)
        assertEquals(listOf("/season/s01", "/season/s02"), seen)
        assertTrue(r.episodes(EpisodeResolver.Copy("egydead", parent.copy(requestedSeason = 3))).isEmpty())
    }

    @Test fun `a probed route outranks an unprobed one and a failed probe sinks`() {
        val p = prepared()
        p.report(ready("a", cand("a1", "a.cdn", 1080)))
        p.report(ready("b", cand("b1", "b.cdn", 720)))
        assertNull(p.best()) // Extracted links are not yet playable streams.
        p.markProbe("s1|a", ok = false, ms = 900)
        p.markProbe("s1|b", ok = true, ms = 300)
        assertEquals("b1", p.best()?.id)
        val routes = p.routes().associateBy { it.id }
        assertEquals(false, routes["s1|a"]?.probed)
        assertEquals(true, routes["s1|b"]?.probed)
        assertEquals(300L, routes["s1|b"]?.probeMs)
        // تقرير لاحق للسيرفر نفسه لا يمحو نتيجة فحصه
        p.report(ready("b", cand("b2", "b.cdn", 720)))
        assertEquals(true, p.routes().first { it.id == "s1|b" }.probed)
    }

    @Test fun `failed probes are never offered as best and an unprobed link cannot win`() {
        val p = prepared()
        p.report(ready("bad", cand("bad", "bad.cdn", 1080)))
        p.markProbe("s1|bad", ok = false, ms = 30)
        p.report(ready("waiting", cand("waiting", "waiting.cdn", 720)))
        assertNull(p.best())
    }

    @Test fun `a successful probe wakes best immediately while other servers still resolve`() = runBlocking {
        val p = prepared()
        p.report(ready("a", cand("a", "a.cdn", 720)))
        val waiting = async { p.awaitBest(null, 5_000) }
        delay(20)
        p.markProbe("s1|a", true, 20)
        assertEquals("a", withTimeout(200) { waiting.await() }?.id)
        assertFalse(p.done)
    }

    @Test fun `automatic fallback also waits for a probed candidate without discarding pending links`() {
        val p = prepared()
        p.report(ready("bad", cand("bad", "bad.cdn", 1080)))
        p.report(ready("pending", cand("pending", "pending.cdn", 720)))
        p.markProbe("s1|bad", false, 10)
        assertNull(p.session.next())
        p.markProbe("s1|pending", true, 10)
        assertEquals("pending", p.session.next()?.id)
    }

    @Test fun `a late batch reopens a finished preparation`() {
        val p = prepared()
        var ends = 0
        p.listen { if (it == null) ends++ }
        p.finish()
        assertTrue(p.done)
        assertTrue(p.beginBatch())
        assertFalse(p.done)
        p.finish()
        assertTrue(p.done)
        assertEquals(2, ends)
    }

    @Test fun `a closed session takes no more batches`() {
        val p = prepared()
        p.job?.cancel()
        assertFalse(p.beginBatch())
    }
    @Test fun `external addon reservation survives immediate empty native completion`() {
        val p = prepared()
        p.reserveAddonBatches(listOf("addon|one", "addon|two", "addon|one"))
        p.finish()
        assertFalse(p.done)
        assertFalse(p.claimAddonBatch("addon|foreign"))
        assertTrue(p.claimAddonBatch("addon|one"))
        assertFalse(p.claimAddonBatch("addon|one"))
        p.finish()
        assertFalse(p.done)
        assertTrue(p.claimAddonBatch("addon|two"))
        p.finish()
        assertTrue(p.done)
    }

    @Test fun `external addon results are refused after session closes`() {
        val p = prepared()
        p.reserveAddonBatches(listOf("addon|one"))
        p.job?.cancel()
        assertFalse(p.claimAddonBatch("addon|one"))
    }

    @Test fun `native torrent ticket becomes selectable without claiming an HTTP probe`() {
        val p = prepared()
        val c = cand("torrent", "torrent", 2160).copy(url = "vantara-torrent://ticket/file")
        p.allowRuntimeCandidate(c.id)
        p.report(ready("torrent", c))
        assertEquals(c, p.best())
        assertEquals(c, p.session.next())
        assertNull(p.routeOf(c.id)?.probed)
        val route = requireNotNull(p.routeOf(c.id))
        val wire = Json.encodeToJsonElement(com.vantara.anime.stream.Route.serializer(), route).jsonObject
        assertEquals(true, wire["runtimeReady"]?.jsonPrimitive?.booleanOrNull)
        assertEquals("s1", wire["sourceName"]?.jsonPrimitive?.content)
        assertEquals(true, Json.encodeToJsonElement(com.vantara.anime.stream.Route.serializer(), p.routes().single()).jsonObject["runtimeReady"]?.jsonPrimitive?.booleanOrNull)
        p.session.failed(c, "test failure")
        assertEquals(RouteState.FAILED, p.routeOf(c.id)?.state)
        assertEquals(false, Json.encodeToJsonElement(com.vantara.anime.stream.Route.serializer(), requireNotNull(p.routeOf(c.id))).jsonObject["runtimeReady"]?.jsonPrimitive?.booleanOrNull ?: false)
    }

    @Test fun `late provider reservation does not restart native preparation or repeat an addon`() {
        val p = prepared()
        p.finish()
        assertTrue(p.done)
        assertEquals(1, p.reserveAddonBatches(listOf("addon|one")))
        assertFalse(p.done)
        assertEquals(0, p.reserveAddonBatches(listOf("addon|one")))
        assertTrue(p.claimAddonBatch("addon|one"))
        p.finish()
        assertTrue(p.done)
        assertEquals(0, p.reserveAddonBatches(listOf("addon|one")))
    }

    @Test fun `old addon generation cannot claim or reserve batches in reused session`() {
        val p = prepared()
        p.reserveAddonBatches(listOf("addon|one"))
        assertFalse(p.claimAddonBatch("addon|one", "old-generation"))
        assertEquals(0, p.reserveAddonBatches(listOf("addon|two"), "old-generation"))
        assertTrue(p.claimAddonBatch("addon|one", p.addonGeneration))
    }

    @Test fun `concurrent session selection and route snapshots avoid reversed locks`() {
        val p = prepared()
        val c = cand("concurrent", "video.cdn", 1080)
        p.report(ready("concurrent", c)); p.allowRuntimeCandidate(c.id)
        val start = java.util.concurrent.CountDownLatch(1)
        val workers = java.util.concurrent.Executors.newFixedThreadPool(2) { action -> Thread(action).apply { isDaemon = true } }
        try {
            val routes = workers.submit { start.await(); repeat(10_000) { p.routes(); p.routeOf(c.id) } }
            val selection = workers.submit { start.await(); repeat(10_000) { p.session.remaining; p.session.reorder { p.rank(it) } } }
            start.countDown()
            routes.get(5, java.util.concurrent.TimeUnit.SECONDS); selection.get(5, java.util.concurrent.TimeUnit.SECONDS)
        } finally { workers.shutdownNow() }
    }

    @Test fun `session owns unreported torrent choices and refuses late registration after close`() {
        val p = prepared()
        assertTrue(p.ownTorrentTicket("vantara-torrent://unreported/file"))
        p.job?.cancel()
        assertEquals(listOf("vantara-torrent://unreported/file"), p.takeTorrentTickets())
        assertTrue(p.takeTorrentTickets().isEmpty())
        assertFalse(p.ownTorrentTicket("vantara-torrent://late/file"))
    }

}
