package com.vantara.anime

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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

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

    @Test fun `a probed route outranks an unprobed one and a failed probe sinks`() {
        val p = prepared()
        p.report(ready("a", cand("a1", "a.cdn", 1080)))
        p.report(ready("b", cand("b1", "b.cdn", 720)))
        assertEquals("a1", p.best()?.id)
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
}
