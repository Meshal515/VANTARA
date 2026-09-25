package com.vantara.anime

import com.vantara.anime.health.HealthPolicy
import com.vantara.anime.health.HealthStore
import com.vantara.anime.matching.TitleNormalizer
import com.vantara.anime.matching.WorkMatcher
import com.vantara.anime.matching.WorkSignals
import com.vantara.anime.net.DomainPlan
import com.vantara.anime.net.DomainPolicy
import com.vantara.anime.registry.ManifestParser
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.StreamClassifier
import com.vantara.anime.stream.StreamRanker
import com.vantara.anime.stream.Variant
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AnimeEngineCoreTest {

    private var now = 1_758_000_000_000L
    private fun store() = HealthStore(null) { now }

    // ── الصحة ──

    @Test fun `three failures in a row trip the breaker, then it cools down`() {
        val h = store()
        repeat(3) { h.fail("host:dood.to", "403") }
        assertTrue(h.skip("host:dood.to"))
        now += HealthPolicy.BASE_COOLDOWN_MS + 1
        assertFalse(h.skip("host:dood.to"))
    }

    @Test fun `a success resets the streak and records latency and domain`() {
        val h = store()
        h.fail("source:ok", "timeout")
        h.ok("source:ok", 400, "https://ww3.okanime.xyz")
        val r = h.get("source:ok")!!
        assertEquals(0, r.streak)
        assertEquals(400.0, r.latencyMs, 0.1)
        assertEquals("https://ww3.okanime.xyz", r.domain)
    }

    @Test fun `ranking puts healthy targets first and tripped ones last`() {
        val h = store()
        repeat(5) { h.ok("host:a", 300) }
        repeat(3) { h.fail("host:b", "x") }
        val ranked = h.rank(listOf("host:b", "host:new", "host:a")) { it }
        assertEquals(listOf("host:a", "host:new", "host:b"), ranked)
    }

    @Test fun `blocked needs an explicit unblock`() {
        val h = store()
        h.fail("source:w", "cf", blocked = "cloudflare_interactive")
        now += HealthPolicy.MAX_COOLDOWN_MS * 2
        assertTrue(h.skip("source:w"))
        h.unblock("source:w")
        assertFalse(h.skip("source:w"))
    }

    // ── الدومينات ──

    private val wit = DomainPlan(
        current = "https://witanime.com",
        legacy = setOf("https://witanime.cyou"),
        fingerprint = "anime-card-poster",
    )

    @Test fun `legacy host is rewritten to the current one`() {
        val url = DomainPolicy.rewrite("https://witanime.cyou/episode/x/".toHttpUrl(), wit, null)
        assertEquals("https://witanime.com/episode/x/", url.toString())
        assertNull(DomainPolicy.rewrite("https://dood.to/e/1".toHttpUrl(), wit, null))
    }

    @Test fun `a redirect to a fake site without the fingerprint is rejected`() {
        val v = DomainPolicy.judge("https://witanime.com/".toHttpUrl(), "https://www.witanime.net/".toHttpUrl(), wit, "<html>blogger</html>")
        assertEquals(DomainPolicy.Verdict.FOREIGN, v)
    }

    @Test fun `a new domain carrying the fingerprint is accepted`() {
        val v = DomainPolicy.judge("https://witanime.com/".toHttpUrl(), "https://witanime.life/".toHttpUrl(), wit, "<div class=\"anime-card-poster\">")
        assertEquals(DomainPolicy.Verdict.FINGERPRINT_OK, v)
    }

    @Test fun `subdomain rotation on the same site is accepted`() {
        val plan = DomainPlan(current = "https://zeta.animerco.org")
        val v = DomainPolicy.judge("https://zeta.animerco.org/".toHttpUrl(), "https://det.animerco.org/".toHttpUrl(), plan, null)
        assertEquals(DomainPolicy.Verdict.SAME_SITE, v)
    }

    // ── التشغيل ──

    private fun cand(id: String, host: String, q: Int?, v: Variant = Variant.SUB, source: String = "s1") = Candidate(
        id = id, sourceId = source, sourceName = source, server = host, host = host, url = "https://$host/$id.m3u8",
        quality = q, variant = v, container = Container.HLS, resolvedAt = now, expiresAt = now + 60_000,
    )

    @Test fun `classifier reads variant, quality, container and host`() {
        assertEquals(Variant.DUB, StreamClassifier.variant("سيرفر 2 - مدبلج"))
        assertEquals(Variant.SUB, StreamClassifier.variant("Dood 720p مترجم"))
        assertEquals(720, StreamClassifier.quality("okru 720p"))
        assertEquals(Container.HLS, StreamClassifier.container("https://x.com/a/master.m3u8?t=1"))
        assertEquals("ok.ru", StreamClassifier.host("https://www.ok.ru/videoembed/1"))
    }

    @Test fun `signed url expiry is honoured`() {
        val exp = (now / 1000) + 120
        val at = StreamClassifier.expiresAt("https://cdn.x/v.mp4?expires=$exp", now)
        assertTrue(at < now + 120_000)
    }

    @Test fun `ranking prefers healthy host over higher quality`() {
        val h = store()
        repeat(3) { h.fail("host:bad.to", "404") }
        val ranked = StreamRanker.rank(listOf(cand("a", "bad.to", 1080), cand("b", "good.to", 720)), h, Preferences(), now)
        assertEquals("b", ranked.first().id)
    }

    @Test fun `expired candidates are dropped and preferred variant wins ties`() {
        val h = store()
        val old = cand("old", "x.to", 1080).copy(expiresAt = now - 1)
        val ranked = StreamRanker.rank(listOf(old, cand("dub", "y.to", 1080, Variant.DUB), cand("sub", "z.to", 1080, Variant.SUB)), h, Preferences(variant = Variant.SUB), now)
        assertEquals(listOf("sub", "dub"), ranked.map { it.id })
    }

    @Test fun `session fails over and blames the source only when all its servers die`() {
        val h = store()
        val s = PlaybackSession(listOf(cand("1", "a.to", 720), cand("2", "b.to", 720)), h)
        val first = s.next()!!
        val second = s.failed(first, "403")!!
        assertEquals("2", second.id)
        assertNull(h.get("source:s1"))
        assertNull(s.failed(second, "timeout"))
        assertEquals(1, h.get("source:s1")!!.fail)
    }

    @Test fun `site of a host keeps country second-level suffixes`() {
        assertEquals("animerco.org", com.vantara.anime.net.siteOf("det.animerco.org"))
        assertEquals("site.com.sa", com.vantara.anime.net.siteOf("www.site.com.sa"))
    }

    // ── الدمج ──

    @Test fun `normalizer folds arabic letters and digits`() {
        assertEquals(TitleNormalizer.fold("أنمي ٣"), TitleNormalizer.fold("انمي 3"))
    }

    @Test fun `seasons are extracted in english and arabic`() {
        assertEquals(2, TitleNormalizer.key("Jujutsu Kaisen Season 2").season)
        assertEquals(2, TitleNormalizer.key("Jujutsu Kaisen 2nd Season").season)
        assertEquals(3, TitleNormalizer.key("شينجكي نو كيوجين الموسم الثالث").season)
        assertEquals(2, TitleNormalizer.key("Mushoku Tensei II").season)
        assertEquals(1, TitleNormalizer.key("Kaiju No. 8").season)
    }

    @Test fun `same anime across sources merges, different seasons do not`() {
        val a = WorkSignals(listOf("One Piece"))
        val b = WorkSignals(listOf("ONE PIECE انمي مترجم"))
        assertEquals(WorkMatcher.Match.SAME, WorkMatcher.compare(a, b))
        assertEquals(
            WorkMatcher.Match.DIFFERENT,
            WorkMatcher.compare(WorkSignals(listOf("Jujutsu Kaisen")), WorkSignals(listOf("Jujutsu Kaisen Season 2"))),
        )
    }

    @Test fun `naruto is not naruto shippuden, and a movie is not the series`() {
        assertEquals(WorkMatcher.Match.DIFFERENT, WorkMatcher.compare(WorkSignals(listOf("Naruto")), WorkSignals(listOf("Naruto Shippuden"))))
        assertEquals(
            WorkMatcher.Match.DIFFERENT,
            WorkMatcher.compare(WorkSignals(listOf("Demon Slayer")), WorkSignals(listOf("Demon Slayer Movie"))),
        )
    }

    @Test fun `external ids decide when both sides have them`() {
        assertEquals(WorkMatcher.Match.SAME, WorkMatcher.compare(WorkSignals(listOf("x"), malId = 21), WorkSignals(listOf("y"), malId = 21)))
        assertEquals(WorkMatcher.Match.DIFFERENT, WorkMatcher.compare(WorkSignals(listOf("One Piece"), malId = 21), WorkSignals(listOf("One Piece"), malId = 22)))
    }

    // ── البيان ──

    @Test fun `manifest validation rejects bad hashes and duplicate ids`() {
        val m = ManifestParser.parse(
            """{"sources":[
              {"id":"a","name":"A","domains":{"current":"https://a.com"},"extension":{"pkg":"p","apk":"https://x/a.apk","sha256":"zz"}},
              {"id":"a","name":"A2","domains":{"current":"a.com"}}
            ]}""",
        )
        val errors = ManifestParser.validate(m)
        assertTrue(errors.any { "sha256" in it })
        assertTrue(errors.any { "مكرر" in it })
        assertTrue(errors.any { "current" in it })
    }
}
