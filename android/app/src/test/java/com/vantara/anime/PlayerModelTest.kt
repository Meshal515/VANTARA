package com.vantara.anime

import com.vantara.anime.health.HealthStore
import com.vantara.anime.player.ClipMath
import com.vantara.anime.player.RouteGroups
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.PreparedEpisode
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.ServerCodes
import com.vantara.anime.stream.Variant
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** نماذج المشغّل: المقطع، رموز السيرفرات، تجهيز الحلقة وترتيب «الأفضل». */
class PlayerModelTest {

    private var now = 1_758_000_000_000L
    private val min = 60_000L

    // ── المقطع ──

    @Test fun `default clip is five seconds each side of the moment`() {
        val r = ClipMath.initial(12 * min, 24 * min)
        assertEquals(12 * min - 5_000, r.startMs)
        assertEquals(12 * min + 5_000, r.endMs)
        assertEquals(10_000, r.durationMs)
        assertEquals(12 * min, r.momentMs)
    }

    @Test fun `each side extends independently up to thirty more seconds`() {
        val d = 24 * min
        var r = ClipMath.initial(12 * min, d)
        r = ClipMath.moveStart(r, 12 * min - 20_000, d)
        assertEquals(12 * min - 20_000, r.startMs)
        assertEquals(12 * min + 5_000, r.endMs) // الطرف الآخر لم يتحرك
        r = ClipMath.moveStart(r, 0, d)
        assertEquals(12 * min - 35_000, r.startMs) // سقف 35 ث قبل اللحظة
        r = ClipMath.moveEnd(r, d, d)
        assertEquals(12 * min + 35_000, r.endMs)
        assertEquals(ClipMath.MAX_TOTAL_MS, r.durationMs) // 70 ث
    }

    @Test fun `handles never cross the original moment`() {
        val d = 24 * min
        var r = ClipMath.initial(12 * min, d)
        r = ClipMath.moveStart(r, 12 * min + 3_000, d)
        assertEquals(12 * min, r.startMs)
        r = ClipMath.moveEnd(r, 12 * min - 3_000, d)
        assertTrue(r.endMs >= 12 * min + ClipMath.MIN_TOTAL_MS)
        assertTrue(r.momentMs in r.startMs..r.endMs)
    }

    @Test fun `clip is clamped to the episode`() {
        val d = 24 * min
        val atStart = ClipMath.initial(2_000, d)
        assertEquals(0, atStart.startMs)
        assertEquals(7_000, atStart.endMs)
        assertEquals(0, ClipMath.moveStart(atStart, -50_000, d).startMs)
        val atEnd = ClipMath.initial(d - 1_000, d)
        assertEquals(d, atEnd.endMs)
        assertEquals(d, ClipMath.moveEnd(atEnd, d + 60_000, d).endMs)
        val (lo, hi) = ClipMath.bounds(d - 1_000, d)
        assertEquals(d - 36_000, lo)
        assertEquals(d, hi)
    }

    @Test fun `moment at the very end still yields a playable second`() {
        val r = ClipMath.initial(5_000, 5_000)
        assertTrue(r.durationMs >= ClipMath.MIN_TOTAL_MS)
        assertEquals(5_000, r.endMs)
    }

    @Test fun `direct remux starts at the hls segment holding the clip start`() {
        val starts = listOf(0L, 6_000, 12_000, 18_000)
        assertEquals(12_000L, ClipMath.snapDown(starts, 14_500))
        assertEquals(12_000L, ClipMath.snapDown(starts, 12_000))
        assertEquals(18_000L, ClipMath.snapDown(starts, 60_000))
        assertNull(ClipMath.snapDown(emptyList(), 5_000))
    }

    @Test fun `clock and length use latin digits`() {
        assertEquals("12:05", ClipMath.clock(12 * min + 5_000))
        assertEquals("1:02:05", ClipMath.clock(62 * min + 5_000))
        assertEquals("10 ث", ClipMath.length(10_000))
        assertEquals("1:10 د", ClipMath.length(70_000))
    }

    // ── رموز السيرفرات ──

    @Test fun `server codes are short, stable and never the host name`() {
        assertEquals("HGC", ServerCodes.code("hgcloud"))
        assertEquals("HGC", ServerCodes.code("StreamHG"))
        assertEquals("MPU", ServerCodes.code("mp4upload"))
        assertEquals("OKR", ServerCodes.code("ok.ru"))
        assertEquals("GDR", ServerCodes.code("Google Drive"))
        val unknown = ServerCodes.code("zanzibarvid")
        assertEquals(3, unknown.length)
        assertEquals(unknown, ServerCodes.code("zanzibarvid"))
        assertFalse(unknown.equals("zan", ignoreCase = true))
    }

    // ── تجهيز الحلقة ──

    private fun cand(id: String, host: String, q: Int?, source: String = "s1", v: Variant = Variant.SUB) = Candidate(
        id = id, sourceId = source, sourceName = source, server = host, host = host, url = "https://$host/$id.m3u8",
        quality = q, variant = v, container = Container.HLS, resolvedAt = now, expiresAt = now + 60_000,
    )

    private fun prepared(health: HealthStore = HealthStore(null) { now }): PreparedEpisode {
        val session = PlaybackSession(emptyList(), health)
        return PreparedEpisode("s", emptyList(), 1f, Preferences(1080, Variant.SUB), session, health) { now }
    }

    private fun report(key: String, server: String, state: RouteState, q: Int?, vararg c: Candidate, source: String = "s1") =
        RouteReport(source, key, server, q, Variant.SUB, state, c.toList(), null)

    @Test fun `routes move from resolving to ready and fill the session`() {
        val p = prepared()
        p.report(report("a", "hgcloud", RouteState.RESOLVING, 720))
        assertEquals(RouteState.RESOLVING, p.routes().single().state)
        assertEquals(0, p.session.remaining)
        p.report(report("a", "hgcloud", RouteState.READY, 720, cand("c1", "hg.cdn", 720)))
        val r = p.routes().single()
        assertEquals(RouteState.READY, r.state)
        assertEquals("HGC", r.code)
        assertEquals(1, p.session.remaining)
        // إعادة إبلاغ «يتجهّز» لا تُرجع سيرفرًا جاهزًا للخلف
        p.report(report("a", "hgcloud", RouteState.RESOLVING, 720))
        assertEquals(RouteState.READY, p.routes().single().state)
    }

    @Test fun `same server from two sources gets distinct codes`() {
        val p = prepared()
        p.report(report("a", "mp4upload", RouteState.READY, 720, cand("c1", "mp4.a", 720), source = "s1"))
        p.report(report("b", "mp4upload", RouteState.READY, 720, cand("c2", "mp4.b", 720), source = "s2"))
        val codes = p.routes().map { it.code }
        assertEquals(listOf("MPU", "MPU2"), codes)
    }

    @Test fun `a route whose links all failed shows playback failed`() {
        val p = prepared()
        val c = cand("c1", "hg.cdn", 720)
        p.report(report("a", "hgcloud", RouteState.READY, 720, c))
        val taken = p.session.take("c1")!!
        p.session.failed(taken, "403")
        assertEquals(RouteState.FAILED, p.routes().single().state)
        assertNull(p.best())
    }

    @Test fun `best weighs health and the remembered server without locking to it`() {
        val health = HealthStore(null) { now }
        val p = prepared(health)
        p.report(report("a", "hgcloud", RouteState.READY, 1080, cand("fast", "good.cdn", 1080)))
        p.report(report("b", "uqload", RouteState.READY, 1080, cand("slow", "bad.cdn", 1080)))
        repeat(5) { health.ok(HealthStore.hostKey("good.cdn"), 400) }
        repeat(5) { health.fail(HealthStore.hostKey("bad.cdn"), "timeout") }
        assertEquals("fast", p.best()?.id)
        // تفضيل سيرفر ميت لا يغلب صحة سيرفر يعمل
        assertEquals("fast", p.best(preferCode = "UQL")?.id)
        // بين سيرفرين متقاربين، المفضّل يرجح
        val q = prepared()
        q.report(report("a", "hgcloud", RouteState.READY, 1080, cand("x", "one.cdn", 1080)))
        q.report(report("b", "mp4upload", RouteState.READY, 1080, cand("y", "two.cdn", 1080)))
        assertEquals("y", q.best(preferCode = "MPU")?.id)
        assertEquals("x", q.best(preferCode = "HGC")?.id)
    }

    @Test fun `player waits for the next route while preparation runs`() = runBlocking {
        val p = prepared()
        val waiting = async { p.awaitNext(5_000) }
        yield()
        p.report(report("a", "hgcloud", RouteState.READY, 720, cand("late", "hg.cdn", 720)))
        assertEquals("late", waiting.await()?.id)
        val none = async { p.awaitNext(5_000) }
        yield()
        p.finish()
        assertNull(none.await())
    }

    @Test fun `unreported candidates are adopted as ready routes`() {
        val p = prepared()
        p.adopt("s1", listOf(cand("a1", "vid.x", 720), cand("a2", "vid.x", 480)))
        val r = p.routes().single()
        assertEquals(RouteState.READY, r.state)
        assertEquals(2, r.candidates.size)
        assertEquals(720, r.quality)
        p.adopt("s1", listOf(cand("a1", "vid.x", 720)))
        assertEquals(1, p.routes().size)
    }

    @Test fun `sheet groups by quality with unavailable last`() {
        val p = prepared()
        p.report(report("a", "hgcloud", RouteState.READY, 720, cand("1", "a.x", 720)))
        p.report(report("b", "mp4upload", RouteState.READY, 1080, cand("2", "b.x", 1080)))
        p.report(report("c", "mega", RouteState.UNAVAILABLE, null))
        p.report(report("d", "videa", RouteState.RESOLVING, null))
        val groups = RouteGroups.group(p.routes())
        assertEquals(listOf("1080p", "720p", "جودة غير محددة", "غير متاح"), groups.map { it.first })
        assertNotEquals("mega", groups.last().second.single().code.lowercase())
    }
}
