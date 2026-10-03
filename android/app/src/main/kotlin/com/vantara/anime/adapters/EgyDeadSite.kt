package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.StreamClassifier
import com.vantara.anime.stream.Variant
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.POST
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.jsoup.Jsoup

/**
 * EgyDead (egydead.live). نفس `pwa/sources/engines/egydead.js`:
 *
 *   بحث      /?s=…  `li.movieItem > a[title]`: الفيلم بسنته، والمسلسل صفحة لكل موسم
 *            /season/…؛ الحلقات المفردة تُطوى في موسمها، وصفحات التجميع (/serie/
 *            «جميع مواسم»، /assembly/ «سلسلة أفلام») ليست عملًا واحدًا فتُترك
 *   الحلقات  صفحة الموسم: `.EpsList a` («حلقه N»)
 *   السيرفرات POST `View=1` على صفحة الفيلم/الحلقة ← `ul.serversList li[data-link]`
 *            (أو `.mob-servers`) ← مضيفات مستقلة ← [EmbedResolver]
 */
class EgyDeadSiteAdapter(
    override val id: String,
    override val name: String,
    private val client: OkHttpClient,
    private val base: () -> String,
    private val embeds: EmbedResolver,
    private val serverTimeoutMs: Long = 45_000,
) : AnimeAdapter {

    private fun abs(path: String) = if (path.startsWith("http")) path else base().trimEnd('/') + path

    private suspend fun html(url: String): Pair<String, String> =
        client.newCall(GET(abs(url))).awaitOk().use { it.request.url.toString() to it.body.string() }

    private suspend fun watchPage(url: String): Pair<String, String> {
        val page = abs(url)
        val h = Headers.Builder().add("Referer", page).build()
        return client.newCall(POST(page, h, FormBody.Builder().add("View", "1").build())).awaitOk().use { it.request.url.toString() to it.body.string() }
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage = when (listing) {
        Listing.SEARCH -> {
            val url = abs("/").toHttpUrl().newBuilder().addQueryParameter("s", query.trim()).build().toString()
            val (finalUrl, body) = html(url)
            SourcePage(Parse.cards(body, finalUrl, id), hasNext = false)
        }
        Listing.LATEST, Listing.POPULAR -> if (page == 1) html("/").let { (u, b) -> SourcePage(Parse.cards(b, u, id), hasNext = false) } else SourcePage(emptyList(), hasNext = false)
    }

    override suspend fun details(anime: SourceAnime): SourceAnime = anime

    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> = emptyList()

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        if (Parse.kindOfPath(anime.url) != "series") return listOf(SourceEpisode(id, anime.url, anime.title, 1f))
        val (finalUrl, body) = html(anime.url)
        return Parse.episodes(body, finalUrl, id).ifEmpty {
            listOfNotNull(SiteCards.episodeNumber(anime.title)?.let { SourceEpisode(id, anime.url, "الحلقة ${it.toInt()}", it) })
        }
    }

    override suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long, trace: ResolveTrace?): List<Candidate> =
        candidatesFor(episode, now, trace, Int.MAX_VALUE, server)

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> =
        candidatesFor(episode, now, trace, enough, null)

    private suspend fun candidatesFor(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int, preferredServer: String?): List<Candidate> {
        val (pageUrl, body) = watchPage(episode.url)
        val servers = Parse.servers(body, pageUrl).sortedByDescending { preferredServer != null && it.name.equals(preferredServer, ignoreCase = true) }
        if (servers.isEmpty()) trace?.note("السيرفرات", "الصفحة بلا سيرفرات مشاهدة")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        fun key(s: Parse.Server) = "e" + Integer.toHexString(s.url.hashCode())
        fun report(s: Parse.Server, state: RouteState, list: List<Candidate> = emptyList(), reason: String? = null) =
            trace?.route(RouteReport(id, key(s), s.name, list.maxOfOrNull { it.quality ?: 0 }?.takeIf { it > 0 }, variant, state, list, reason))
        servers.forEach { report(it, RouteState.RESOLVING) }
        return gatherUntil(
            servers.map { s ->
                suspend {
                    var failure: String? = null
                    val got = withTimeoutOrNull(serverTimeoutMs) {
                        try {
                            embeds.resolve(s.url, pageUrl).map { st ->
                                Candidate(
                                    id = "$id|${episode.url}|${st.url.hashCode()}",
                                    sourceId = id,
                                    sourceName = name,
                                    server = s.name,
                                    host = StreamClassifier.host(st.url),
                                    url = st.url,
                                    headers = st.headers,
                                    quality = st.quality,
                                    label = s.name,
                                    variant = variant,
                                    container = st.container ?: StreamClassifier.container(st.url),
                                    resolvedAt = now,
                                    expiresAt = StreamClassifier.expiresAt(st.url, now),
                                )
                            }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { failure = e.brief(); emptyList() }
                    }
                    when {
                        got == null -> emptyList<Candidate>().also { report(s, RouteState.UNAVAILABLE, reason = "لم يرد خلال ${serverTimeoutMs / 1000} ثانية") }
                        got.isEmpty() -> got.also { report(s, RouteState.UNAVAILABLE, reason = failure ?: "لم يُستخرج رابط فيديو") }
                        else -> got.also { report(s, RouteState.READY, it) }
                    }
                }
            },
            enough,
        )
    }

    internal object Parse {
        data class Server(val name: String, val url: String)

        private val EPISODE = Regex("""\s*(?:الحلقة|حلقة|حلقه)\s*\d+.*$""")
        private val COMPLETE = Regex("""\s*مترجم(?:ة)?\s*كامل(?:ة)?\s*$""")

        fun kindOfPath(path: String): String = if (Regex("""^/(?:season|episode)/""").containsMatchIn(path)) "series" else "movie"

        fun cards(html: String, pageUrl: String, sourceId: String): List<SourceAnime> {
            val doc = Jsoup.parse(html, pageUrl)
            val out = LinkedHashMap<String, SourceAnime>()
            val folded = LinkedHashMap<String, SourceAnime>()
            for (a in doc.select("li.movieItem > a[href]")) {
                val path = SiteCards.pathOf(a.absUrl("href")) ?: continue
                val title = a.attr("title").ifBlank { a.selectFirst(".BottomTitle, h1")?.text().orEmpty() }.trim()
                if (title.isBlank() || Regex("""^/(?:serie|assembly)/""").containsMatchIn(path) || Regex("""^جميع\s+مواسم|سلسلة\s+افلام""").containsMatchIn(title)) continue
                val thumb = a.selectFirst("img")?.let { it.absUrl("data-src").ifBlank { it.absUrl("src") } }?.ifBlank { null }
                if (path.startsWith("/episode/")) {
                    val series = title.replace(EPISODE, "").trim()
                    if (series.isNotBlank() && series !in folded) folded[series] = SourceAnime(sourceId, path, series, thumb)
                    continue
                }
                if (path !in out) out[path] = SourceAnime(sourceId, path, title, thumb)
            }
            val seasons = out.values.map { it.title.replace(COMPLETE, "").trim() }.toSet()
            for ((series, c) in folded) if (series !in seasons) out[c.url] = c
            return out.values.toList()
        }

        fun episodes(html: String, pageUrl: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select(".EpsList a[href], .episodes-list a[href*=/episode/]").mapNotNull { a ->
                val path = SiteCards.pathOf(a.absUrl("href")) ?: return@mapNotNull null
                val n = Regex("""(\d+(?:\.\d+)?)""").find(a.text())?.value?.toFloatOrNull()
                    ?: SiteCards.episodeNumber(a.attr("title"))
                    ?: return@mapNotNull null
                if (n <= 0f) return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${if (n % 1f == 0f) n.toInt().toString() else n.toString()}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        fun servers(html: String, pageUrl: String): List<Server> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select("ul.serversList li[data-link], .mob-servers li[data-link]").mapNotNull { li ->
                val url = li.absUrl("data-link").ifBlank { null } ?: return@mapNotNull null
                Server((li.selectFirst("p")?.text() ?: li.text()).trim().ifBlank { "EgyDead" }, url)
            }.distinctBy { it.url }
        }
    }

    companion object {
        const val KIND = "egydead-site"
    }
}
