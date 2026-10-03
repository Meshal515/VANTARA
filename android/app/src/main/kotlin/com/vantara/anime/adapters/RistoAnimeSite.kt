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
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.jsoup.Jsoup

/**
 * RistoAnime (ristoanime.me، قالب TopAnime). نفس `pwa/sources/engines/ristoanime.js`:
 *
 *   بحث      /?s=…  `.MovieItem > a` (رابط /series/… وعنوان `h4`)
 *   المواسم  صفحة المسلسل: `.SeasonsList a[data-season]` + `post_id` في السكربت؛
 *            المسلسل متعدد المواسم نسخةٌ لكل موسم (هوية AniList موسمٌ لكل عمل):
 *            الأول بالاسم وحده، والتالي «<الاسم> Season N»
 *   الحلقات  الموسم النشط في `.EpisodesList a`، وغيره POST Ajaxt/Single/Episodes.php
 *   السيرفرات <الحلقة>/watch/ ← `ul#watch li[data-watch]` (حتى ثمانية مضيفات) ← [EmbedResolver]
 */
class RistoAnimeSiteAdapter(
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

    private suspend fun expand(card: Parse.Card): List<SourceAnime> {
        val one = SourceAnime(id, card.url, card.title, card.thumb)
        val page = try { html(card.url).second } catch (e: CancellationException) { throw e } catch (_: Exception) { return listOf(one) }
        val (post, seasons) = Parse.seasons(page)
        if (seasons.size <= 1 || post == null) return listOf(one)
        return seasons.map { s ->
            one.copy(url = "${card.url}#s=${s.id}&p=$post", title = if (s.n == 1) card.title else "${card.title} Season ${s.n}")
        }
    }

    private suspend fun search(body: String): List<SourceAnime> = coroutineScope {
        val cards = Parse.cards(body, base())
        val head = cards.take(4).map { async { expand(it) } }.awaitAll().flatten()
        head + cards.drop(4).map { SourceAnime(id, it.url, it.title, it.thumb) }
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage = when (listing) {
        Listing.SEARCH -> {
            val url = abs("/").toHttpUrl().newBuilder().addQueryParameter("s", query.trim()).build().toString()
            SourcePage(search(html(url).second), hasNext = false)
        }
        Listing.LATEST, Listing.POPULAR -> SourcePage(if (page == 1) search(html("/series/").second) else emptyList(), hasNext = false)
    }

    override suspend fun details(anime: SourceAnime): SourceAnime = anime

    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> = emptyList()

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        val path = anime.url.substringBefore('#')
        val hash = anime.url.substringAfter('#', "")
        val params = hash.split('&').mapNotNull { p -> p.split('=', limit = 2).takeIf { it.size == 2 }?.let { it[0] to it[1] } }.toMap()
        val season = params["s"]
        val post = params["p"]
        if (season != null && post != null) {
            val h = Headers.Builder().add("Referer", abs(path)).add("X-Requested-With", "XMLHttpRequest").build()
            val body = FormBody.Builder().add("season", season).add("post_id", post).build()
            val text = client.newCall(POST(abs(AJAX), h, body)).awaitOk().use { it.body.string() }
            return Parse.episodes(text, base(), id)
        }
        val text = html(path).second
        return Parse.episodes(text.substring(text.indexOf("EpisodesList").coerceAtLeast(0)), base(), id)
    }

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> {
        val watch = abs(episode.url).trimEnd('/') + "/watch/"
        val (pageUrl, body) = html(watch, referer = abs(episode.url))
        val servers = Parse.servers(body)
        if (servers.isEmpty()) trace?.note("السيرفرات", "صفحة المشاهدة بلا سيرفرات")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        val referer = base().trimEnd('/') + "/"
        fun key(s: Parse.Server) = "r" + Integer.toHexString(s.url.hashCode())
        fun report(s: Parse.Server, state: RouteState, list: List<Candidate> = emptyList(), reason: String? = null) =
            trace?.route(RouteReport(id, key(s), s.name, list.maxOfOrNull { it.quality ?: 0 }?.takeIf { it > 0 }, variant, state, list, reason))
        servers.forEach { report(it, RouteState.RESOLVING) }
        return gatherUntil(
            servers.map { s ->
                suspend {
                    var failure: String? = null
                    val got = withTimeoutOrNull(serverTimeoutMs) {
                        try {
                            embeds.resolve(s.url, referer).map { st ->
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
        data class Card(val url: String, val title: String, val thumb: String?)
        data class Season(val id: String, val n: Int, val label: String)
        data class Server(val name: String, val url: String)

        private val SEASON = Regex("""الموسم\s*(\d+)""")
        private val LATIN = Regex("""[A-Za-z0-9][A-Za-z0-9 :;'’!?.,&\-()]*[A-Za-z0-9!?)]""")
        private val NOISE = Regex("""(^|\s)(أنمي|انمي|مترجم|مترجمة|اون لاين|أون لاين|اونلاين|مدبلج|جميع حلقات)(?=\s|$)""")

        /** نفس `cleanTitle` في shahiid.js: أطول اسم لاتيني، وإلا العربي بلا كلمات الحشو. */
        fun cleanTitle(raw: String): String {
            val latin = LATIN.findAll(raw).map { it.value.trim() }.filter { s -> s.any { it.isLetter() } }.maxByOrNull { it.length }
            if (latin != null && latin.length >= 2) return latin
            return raw.replace(NOISE, " ").replace(Regex("""\s+"""), " ").trim().ifBlank { raw.trim() }
        }

        /** رابط المضيف كما يضعه الموقع: يلحق `.html` بكل رابط، وهو صالح فقط في صيغة embed-xxx.html. */
        fun embedUrl(raw: String): String? {
            val url = raw.trim()
            if (!url.startsWith("http")) return null
            return if (Regex("""/embed-[^/]+\.html$""", RegexOption.IGNORE_CASE).containsMatchIn(url)) url
            else url.replace(Regex("""\.html$""", RegexOption.IGNORE_CASE), "")
        }

        fun cards(html: String, base: String): List<Card> {
            val doc = Jsoup.parse(html, base)
            return doc.select(".MovieItem > a[href]").mapNotNull { a ->
                val path = SiteCards.pathOf(a.absUrl("href")) ?: return@mapNotNull null
                val raw = a.selectFirst("h4")?.text()?.ifBlank { null } ?: a.selectFirst(".title p")?.text() ?: return@mapNotNull null
                val thumb = Regex("""url\(([^)]+)\)""").find(a.selectFirst(".poster")?.attr("style").orEmpty())?.groupValues?.get(1)
                Card(path, cleanTitle(raw), thumb)
            }.distinctBy { it.url }
        }

        fun seasons(html: String): Pair<String?, List<Season>> {
            val post = Regex("""post_id:\s*'(\d+)'""").find(html)?.groupValues?.get(1)
            val list = Jsoup.parse(html).select(".SeasonsList a[data-season]").mapIndexed { i, a ->
                Season(a.attr("data-season"), SEASON.find(a.text())?.groupValues?.get(1)?.toIntOrNull() ?: (i + 1), a.text())
            }
            return post to list
        }

        fun episodes(html: String, base: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, base)
            return doc.select("a[href]").mapNotNull { a ->
                val em = a.selectFirst("em") ?: return@mapNotNull null
                if (!a.text().contains("الحلقة")) return@mapNotNull null
                val n = em.text().trim().toFloatOrNull()?.takeIf { it > 0f } ?: return@mapNotNull null
                val path = SiteCards.pathOf(a.absUrl("href")) ?: return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${if (n % 1f == 0f) n.toInt().toString() else n.toString()}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        /** بلا MEGA: الفيديو مشفّر داخل صفحته فلا رابط يُستخرج. */
        fun servers(html: String): List<Server> =
            Jsoup.parse(html).select("ul#watch li[data-watch]").mapNotNull { li ->
                val url = embedUrl(li.attr("data-watch")) ?: return@mapNotNull null
                if (url.contains("mega.nz", ignoreCase = true)) return@mapNotNull null
                Server(li.text().replace(Regex("""^\d+\s*"""), "").trim().ifBlank { "RistoAnime" }, url)
            }.distinctBy { it.url }
    }

    companion object {
        const val KIND = "ristoanime-site"
        private const val AJAX = "/wp-content/themes/TopAnime/Ajaxt/Single/Episodes.php"
    }
}
