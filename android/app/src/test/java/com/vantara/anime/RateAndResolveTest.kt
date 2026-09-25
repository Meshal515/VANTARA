package com.vantara.anime

import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.ResolveTrace
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourceEpisode
import com.vantara.anime.adapters.SourcePage
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.net.DomainPlan
import com.vantara.anime.net.RateGate
import com.vantara.anime.net.RateLimit
import com.vantara.anime.net.RateLimitedException
import com.vantara.anime.registry.ManifestParser
import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/** حدود الطلبات، 429، وقوائم الحلقات الفارغة (Issue #81). */
class RateAndResolveTest {

    // ── بوابة الحدود ──

    @Test fun `a per-minute rule makes the next caller wait for the window, not burst`() {
        var now = 0L
        val slept = mutableListOf<Long>()
        val gate = RateGate(listOf(RateGate.Rule(Regex("^/api/"), 2)), clock = { now }, sleep = { slept += it; now += it })
        gate.acquire("/api/a", 120_000)
        gate.acquire("/api/b", 120_000)
        gate.acquire("/page", 120_000) // مسار خارج القاعدة لا ينتظر
        assertTrue(slept.isEmpty())
        gate.acquire("/api/c", 120_000)
        assertEquals(60_000L, slept.sum())
    }

    @Test fun `a wait longer than allowed is refused with its reason instead of hanging`() {
        val gate = RateGate(listOf(RateGate.Rule(Regex("^/api/"), 1)), clock = { 0L }, sleep = { fail("must not sleep") })
        gate.acquire("/api/a", 20_000)
        try {
            gate.acquire("/api/b", 20_000)
            fail("expected RateLimitedException")
        } catch (e: RateLimitedException) {
            assertTrue(e.message!!, e.message!!.contains("/api/b"))
        }
    }

    @Test fun `Retry-After closes the whole source for every caller`() {
        var now = 0L
        val gate = RateGate(emptyList(), clock = { now }, sleep = { now += it })
        gate.onRateLimited(3_000)
        gate.acquire("/anything", 20_000)
        assertEquals(3_000L, now)
    }

    @Test fun `Retry-After is read as seconds or a date, bounded`() {
        assertEquals(42_000L, RateGate.parseRetryAfter("42"))
        assertEquals(RateGate.DEFAULT_RETRY_AFTER_MS, RateGate.parseRetryAfter(null))
        assertEquals(RateGate.MAX_RETRY_AFTER_MS, RateGate.parseRetryAfter("9999"))
        // 1_758_000_000_000 = Tue, 16 Sep 2025 05:20:00 GMT
        assertEquals(10_000L, RateGate.parseRetryAfter("Tue, 16 Sep 2025 05:20:10 GMT", now = 1_758_000_000_000L))
    }

    // ── 429 عبر الموجّه ──

    private fun sourceClient(codes: MutableList<Int>, retryAfter: String?, calls: MutableList<String>): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(AnimeHostRouter)
            .addInterceptor { chain ->
                calls += chain.request().url.encodedPath
                val code = if (codes.isEmpty()) 200 else codes.removeAt(0)
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("x")
                    .apply { if (code == 429 && retryAfter != null) header("Retry-After", retryAfter) }.build()
            }.build()

    @Test fun `a 429 with a short Retry-After waits and retries once`() {
        AnimeHostRouter.health = HealthStore(null)
        AnimeHostRouter.register("rl-short", DomainPlan("https://rl-short.test"))
        val calls = mutableListOf<String>()
        val client = sourceClient(mutableListOf(429), "1", calls)
        val started = System.currentTimeMillis()
        val r = client.newCall(Request.Builder().url("https://rl-short.test/watch/x/1/sources").build()).execute()
        assertEquals(200, r.code)
        assertEquals(2, calls.size)
        assertTrue(System.currentTimeMillis() - started >= 900)
    }

    @Test fun `a 429 with a long Retry-After fails with its reason and holds back the next request`() {
        AnimeHostRouter.health = HealthStore(null)
        AnimeHostRouter.register("rl-long", DomainPlan("https://rl-long.test"))
        val calls = mutableListOf<String>()
        val client = sourceClient(mutableListOf(429), "60", calls)
        try {
            client.newCall(Request.Builder().url("https://rl-long.test/watch/stream-gate/a").build()).execute()
            fail("expected RateLimitedException")
        } catch (e: RateLimitedException) {
            assertTrue(e.message!!, e.message!!.contains("/watch/stream-gate/a"))
        }
        // الطلب التالي لا يصل الموقع أصلًا خلال فترة التهدئة
        runCatching { client.newCall(Request.Builder().url("https://rl-long.test/anime/x").build()).execute() }
        assertEquals(1, calls.size)
    }

    @Test fun `manifest limits stop a burst before the site answers 429`() {
        AnimeHostRouter.health = HealthStore(null)
        AnimeHostRouter.register("rl-burst", DomainPlan("https://rl-burst.test", limits = listOf(RateLimit("^/watch/stream-gate/", 2))))
        val calls = mutableListOf<String>()
        val client = sourceClient(mutableListOf(), null, calls)
        repeat(2) { client.newCall(Request.Builder().url("https://rl-burst.test/watch/stream-gate/$it").build()).execute().close() }
        val third = runCatching { client.newCall(Request.Builder().url("https://rl-burst.test/watch/stream-gate/3").build()).execute() }
        assertTrue(third.exceptionOrNull() is RateLimitedException)
        // صفحات الموقع العادية لا تخضع لقاعدة البوابة
        client.newCall(Request.Builder().url("https://rl-burst.test/anime/x").build()).execute().close()
        assertEquals(3, calls.size)
    }

    @Test fun `a host dropped from a source loses its hidden-only treatment`() {
        AnimeHostRouter.register("moved", DomainPlan("https://old-home.test"))
        assertTrue(AnimeHostRouter.isHiddenOnly("old-home.test"))
        AnimeHostRouter.register("moved", DomainPlan("https://new-home.test"))
        assertFalse(AnimeHostRouter.isHiddenOnly("old-home.test"))
        assertTrue(AnimeHostRouter.isHiddenOnly("new-home.test"))
    }

    // ── الحلقات ──

    private class FlakyEpisodes(var lists: MutableList<List<SourceEpisode>>) : AnimeAdapter {
        override val id = "flaky"
        override val name = "Flaky"
        var asked = 0
        override suspend fun page(listing: Listing, page: Int, query: String) = SourcePage(emptyList(), false)
        override suspend fun details(anime: SourceAnime) = anime
        override suspend fun seasons(anime: SourceAnime) = emptyList<SourceAnime>()
        override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> { asked++; return lists.removeAt(0) }
        override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int) = emptyList<Candidate>()
    }

    @Test fun `an empty episode list is not cached as the answer`() = runBlocking {
        val ep = SourceEpisode("flaky", "/e/1", "1", 1f)
        val adapter = FlakyEpisodes(mutableListOf(emptyList(), listOf(ep), listOf(ep)))
        val resolver = EpisodeResolver({ adapter }, HealthStore(null))
        val copy = EpisodeResolver.Copy("flaky", SourceAnime("flaky", "/a", "A"))
        assertTrue(resolver.episodes(copy).isEmpty())
        assertEquals(listOf(ep), resolver.episodes(copy))
        assertEquals(listOf(ep), resolver.episodes(copy)) // الآن مخبّأة
        assertEquals(2, adapter.asked)
    }

    @Test fun `source priority breaks a health tie`() {
        val h = HealthStore(null)
        val ranked = h.rank(listOf("okanime", "witanime"), { if (it == "witanime") 80 else 70 }) { HealthStore.sourceKey(it) }
        assertEquals(listOf("witanime", "okanime"), ranked)
    }

    @Test fun `OkAnime's shipped episode rule reads the redesigned work page`() {
        val file = generateSequence(File("").absoluteFile) { it.parentFile }.map { File(it, "apps/web/anime/sources.json") }.first { it.isFile }
        val rule = ManifestParser.parse(file.readText()).sources.first { it.id == "okanime" }.episodes!!
        val html = """
            <div class="ep-compact-grid">
              <a href="https://ww3.okanime.xyz/episode/boruto-naruto-next-generations-episode-1" class="ep-compact-btn " title="الحلقة 1">1</a>
              <a href="https://ww3.okanime.xyz/episode/boruto-naruto-next-generations-episode-10" class="ep-compact-btn " title="الحلقة 10">10</a>
              <a href="https://ww3.okanime.xyz/episode/boruto-naruto-next-generations-episode-2" class="ep-compact-btn " title="الحلقة 2">2</a>
            </div>
            <a class="sidebar-schedule-card" href="https://ww3.okanime.xyz/episode/yani-neko-episode-1">جدول</a>"""
        val eps = rule.extract(html, "https://ww3.okanime.xyz/anime/boruto-naruto-next-generations")
        assertEquals(listOf(1f, 2f, 10f), eps.map { it.number })
        assertEquals("/episode/boruto-naruto-next-generations-episode-2", eps[1].path)
    }
}
