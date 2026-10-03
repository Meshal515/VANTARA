package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.StreamClassifier
import com.vantara.anime.stream.Variant
import eu.kanade.tachiyomi.network.GET
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.jsoup.Jsoup

/**
 * Shahiid Anime (shahiid-anime.net، ووردبريس بلا حماية Cloudflare). مصدر أنمي
 * احتياطي بطلبات HTTP عادية:
 *
 *   بحث      /?s=…                     `.one-poster .wrap-poster` (عنوانه `h2 a`)
 *   الحلقات  صفحة الموسم: روابط `/episodes/…` ورقمها «الحلقة N» في نصها؛
 *            صفحة المسلسل تشير لمواسمها، فيُفتح أول موسم.
 *   السيرفرات `a.buttosn[data-frameserver]` ← GET admin-ajax?action=codecanal_ajax_request
 *            يرجع iframe المشغّل (ok.ru، share4max/MegaMax، sendvid…) ← [EmbedResolver].
 */
class ShahiidSiteAdapter(
    override val id: String,
    override val name: String,
    private val client: OkHttpClient,
    private val base: () -> String,
    private val embeds: EmbedResolver,
    private val serverTimeoutMs: Long = 45_000,
) : AnimeAdapter {

    private fun abs(path: String) = if (path.startsWith("http")) path else base().trimEnd('/') + path

    private suspend fun html(url: String, referer: String? = null): Pair<String, String> {
        val h = Headers.Builder().apply { referer?.let { add("Referer", it) } }.build()
        return client.newCall(GET(abs(url), h)).awaitOk().use { it.request.url.toString() to it.body.string() }
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage = when (listing) {
        Listing.SEARCH -> {
            val url = abs("/").toHttpUrl().newBuilder().addQueryParameter("s", query.trim()).build().toString()
            SourcePage(Parse.search(html(url).second, id), hasNext = false)
        }
        Listing.LATEST, Listing.POPULAR -> SourcePage(if (page == 1) Parse.search(html("/").second, id) else emptyList(), hasNext = false)
    }

    override suspend fun details(anime: SourceAnime): SourceAnime = anime

    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> = emptyList()

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        val (finalUrl, body) = html(anime.url)
        Parse.episodes(body, finalUrl, id).takeIf { it.isNotEmpty() }?.let { return it }
        // صفحة مسلسل: حلقاته في صفحة موسمه
        Parse.firstSeason(body, finalUrl)?.let { season ->
            val (seasonUrl, seasonBody) = html(season, finalUrl)
            Parse.episodes(seasonBody, seasonUrl, id).takeIf { it.isNotEmpty() }?.let { return it }
        }
        // فيلم أو حلقة خاصة: الصفحة نفسها فيها السيرفرات
        return if (Parse.hasServers(body)) listOf(SourceEpisode(id, anime.url, anime.title, 1f)) else emptyList()
    }

    override suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long, trace: ResolveTrace?): List<Candidate> =
        candidatesFor(episode, now, trace, Int.MAX_VALUE, server)

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> =
        candidatesFor(episode, now, trace, enough, null)

    private suspend fun candidatesFor(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int, preferredServer: String?): List<Candidate> {
        val (pageUrl, body) = html(episode.url)
        val servers = Parse.servers(body).sortedByDescending { preferredServer != null && it.name.equals(preferredServer, ignoreCase = true) }
        if (servers.isEmpty()) trace?.note("السيرفرات", "الصفحة بلا سيرفرات مشاهدة")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        fun key(s: Parse.Server) = "s${s.post}"
        fun report(s: Parse.Server, state: RouteState, list: List<Candidate> = emptyList(), reason: String? = null) =
            trace?.route(RouteReport(id, key(s), s.name, list.maxOfOrNull { it.quality ?: 0 }?.takeIf { it > 0 }, variant, state, list, reason))
        servers.forEach { report(it, RouteState.RESOLVING) }
        return gatherUntil(
            servers.map { s ->
                suspend {
                    var failure: String? = null
                    val earlyFound = mutableListOf<Candidate>()
                    fun convert(streams: List<com.vantara.anime.hosts.Stream>) = streams.map { st ->
                        Candidate(
                            id = "$id|${episode.url}|${st.url.hashCode()}", sourceId = id, sourceName = name,
                            server = s.name, host = StreamClassifier.host(st.url), url = st.url, headers = st.headers,
                            quality = st.quality, label = s.name, variant = variant,
                            container = st.container ?: StreamClassifier.container(st.url), resolvedAt = now,
                            expiresAt = StreamClassifier.expiresAt(st.url, now),
                        )
                    }
                    val got = withTimeoutOrNull(serverTimeoutMs) {
                        try {
                            val ajax = abs("/wp-admin/admin-ajax.php").toHttpUrl().newBuilder()
                                .addQueryParameter("action", "codecanal_ajax_request")
                                .addQueryParameter("post", s.post)
                                .addQueryParameter("frameserver", s.frame)
                                .addQueryParameter("serv", s.serv)
                                .build().toString()
                            val embed = Parse.iframe(html(ajax, pageUrl).second) ?: error("الموقع لم يُرجع مشغّلًا")
                            convert(embeds.resolve(embed, pageUrl) { streams ->
                                val early = convert(streams)
                                earlyFound += early
                                if (early.isNotEmpty()) report(s, RouteState.READY, early)
                            })
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { failure = e.brief(); earlyFound.toList() }
                    }
                    val available = got ?: earlyFound.toList().takeIf { it.isNotEmpty() }
                    when {
                        available == null -> emptyList<Candidate>().also { report(s, RouteState.UNAVAILABLE, reason = "لم يرد خلال ${serverTimeoutMs / 1000} ثانية") }
                        available.isEmpty() -> available.also { report(s, RouteState.UNAVAILABLE, reason = failure ?: "لم يُستخرج رابط فيديو") }
                        else -> available.also { report(s, RouteState.READY, it) }
                    }
                }
            },
            enough,
        )
    }

    internal object Parse {
        data class Server(val name: String, val post: String, val frame: String, val serv: String)

        /** سيرفرات انتهت (TunePk أُغلق): لا تُعرض كخيار ميت دائمًا. */
        private val DEAD = setOf("tunepk")
        private val EPISODE = Regex("""(?:الحلقة|حلقة)\s*(\d+(?:\.\d+)?)""")
        private val LATIN = Regex("""[A-Za-z0-9][A-Za-z0-9 :;'’!?.,&\-()]*[A-Za-z0-9!?)]""")
        private val NOISE = Regex("""(^|\s)(أنمي|انمي|مترجم|مترجمة|اون لاين|أون لاين|مدبلج|الملصق الرسمي ل)(?=\s|$)""")

        /**
         * عنوان المطابقة: «أنمي One Piece ون بيس مترجم» ← «One Piece». الاسم اللاتيني
         * هو ما يطابق عناوين AniList؛ وإن لم يوجد يبقى العربي بلا الحشو.
         */
        fun cleanTitle(raw: String): String {
            val latin = LATIN.findAll(raw).map { it.value.trim() }.filter { it.any(Char::isLetter) }.maxByOrNull { it.length }
            if (latin != null && latin.length >= 2) return latin
            return NOISE.replace(raw, " ").replace(Regex("""\s+"""), " ").trim().ifBlank { raw.trim() }
        }

        fun search(html: String, sourceId: String): List<SourceAnime> {
            val doc = Jsoup.parse(html, "https://shahiid-anime.net/")
            return doc.select(".one-poster .wrap-poster").mapNotNull { card ->
                val link = card.selectFirst("h2 a[href]") ?: card.selectFirst("a[href]") ?: return@mapNotNull null
                val path = SiteCards.pathOf(link.absUrl("href")) ?: return@mapNotNull null
                val raw = card.selectFirst("h2")?.text()?.trim().takeUnless { it.isNullOrBlank() }
                    ?: card.selectFirst("img")?.attr("alt").orEmpty()
                if (raw.isBlank()) return@mapNotNull null
                val img = card.selectFirst("img")
                SourceAnime(sourceId, path, cleanTitle(raw), img?.absUrl("src")?.ifBlank { null })
            }.distinctBy { it.url }
        }

        fun episodes(html: String, pageUrl: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select("a[href*=/episodes/]").mapNotNull { a ->
                val n = EPISODE.find(a.text())?.groupValues?.get(1)?.toFloatOrNull() ?: return@mapNotNull null
                val path = SiteCards.pathOf(a.absUrl("href")) ?: return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${if (n % 1f == 0f) n.toInt().toString() else n.toString()}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        fun firstSeason(html: String, pageUrl: String): String? {
            val doc = Jsoup.parse(html, pageUrl)
            val options = doc.select("option[value*=/seasons/]").map { it.absUrl("value") }
            val links = doc.select("a[href*=/seasons/]").map { it.absUrl("href") }
            // موسم بعينه: `/seasons/<slug>/` لا أرشيف المواسم (`/seasons/`) ولا صفحاته وخلاصته
            return (options + links).firstOrNull { u ->
                val segs = runCatching { u.toHttpUrl().pathSegments.filter { it.isNotEmpty() } }.getOrNull() ?: return@firstOrNull false
                segs.size == 2 && segs[0] == "seasons" && segs[1] != "page" && segs[1] != "feed"
            }
        }

        fun hasServers(html: String): Boolean = html.contains("data-frameserver")

        fun servers(html: String): List<Server> =
            Jsoup.parse(html).select("a.buttosn[data-frameserver][data-post]").mapNotNull { a ->
                val name = a.text().trim().ifBlank { "Shahiid" }
                if (name.lowercase().replace(" ", "") in DEAD) return@mapNotNull null
                Server(name, a.attr("data-post"), a.attr("data-frameserver"), a.attr("data-serv"))
            }.distinctBy { it.post }

        fun iframe(html: String): String? =
            Jsoup.parse(html).selectFirst("iframe[src]")?.attr("src")?.trim()
                ?.let { if (it.startsWith("//")) "https:$it" else it }
                ?.takeIf { it.startsWith("http") }
    }

    companion object {
        const val KIND = "shahiid-site"
    }
}
