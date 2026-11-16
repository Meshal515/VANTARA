package eu.kanade.tachiyomi.network

import eu.kanade.tachiyomi.network.interceptor.HostBreaker
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HostBreakerTest {
    @Test fun `three throttles in a row pause the host, then back off exponentially`() {
        val b = HostBreaker()
        repeat(2) { b.record("site.example", 429, null, 0) }
        assertNull("two failures do not stop the host", b.waitMs("site.example", 0))
        b.record("site.example", 502, null, 0)
        assertEquals(30_000L, b.waitMs("site.example", 0))
        assertNull(b.waitMs("site.example", 30_000))
        // نصف مفتوح: فشل واحد بعد المهلة يعيد التوقف بضعف المدة
        b.record("site.example", 503, null, 30_000)
        assertEquals(60_000L, b.waitMs("site.example", 30_000))
    }

    @Test fun `retry-after is honoured immediately and capped at six hours`() {
        val b = HostBreaker()
        b.record("a.example", 429, 120_000, 0)
        assertEquals(120_000L, b.waitMs("a.example", 0))
        b.record("b.example", 503, 999L * 60 * 60 * 1000, 0)
        assertEquals(HostBreaker.MAX_MS, b.waitMs("b.example", 0))
    }

    @Test fun `a healthy response resets the host and other hosts are unaffected`() {
        val b = HostBreaker()
        repeat(2) { b.record("a.example", 500, null, 0) }
        b.record("a.example", 200, null, 0)
        b.record("a.example", 500, null, 0)
        assertNull(b.waitMs("a.example", 0))
        // فشل واحد بعد الرد السليم، ثم اثنان آخران يكملان الثلاثة (المضيف بلا اعتبار لحالة الأحرف)
        repeat(2) { b.record("A.EXAMPLE", 500, null, 0) }
        assertEquals(30_000L, b.waitMs("a.example", 0))
        assertNull(b.waitMs("other.example", 0))
    }

    @Test fun `client errors other than 429 never pause a host`() {
        val b = HostBreaker()
        repeat(10) { b.record("a.example", 404, null, 0) }
        repeat(10) { b.record("a.example", 403, null, 0) }
        assertNull(b.waitMs("a.example", 0))
    }

    @Test fun `retry-after parses seconds and http dates`() {
        assertEquals(5_000L, HostBreaker.retryAfterMs("5", 0))
        assertNull(HostBreaker.retryAfterMs("-1", 0))
        assertNull(HostBreaker.retryAfterMs("soon", 0))
        val now = java.time.ZonedDateTime.parse("Fri, 30 Oct 2026 12:00:00 GMT", java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()
        assertEquals(90_000L, HostBreaker.retryAfterMs("Fri, 30 Oct 2026 12:01:30 GMT", now))
    }
}
