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
 * TukTuk Cinema على قالب TukTukCinema3. إضافة Aniyomi لا تقرأ بحثه الجديد،
 * فهذا محوّل VANTARA أصلي بطلبات HTTP عادية:
 *
 *   بحث      /?s=…                       `.Block--Item a[href][title]` (الحلقات تُجمع مواسم)
 *   الحلقات  صفحة أي حلقة: `.episodes--list--side a` بأرقام `<em>`
 *   السيرفرات `.watch--servers--list li.server--item[data-link]`، الرابط مرمّز:
 *            الجزء قبل `0REL0Y&` معكوسًا ثم base64 (نفس `decodeLink` في setup.js)
 *            ← مشغّل megatuktuk (MegaMax نفسه) وغيره ← [EmbedResolver].
 */
class TukTukSiteAdapter(
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
        if (SiteCards.kindOf(anime.title) != "series") return listOf(SourceEpisode(id, anime.url, anime.title, 1f))
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
        val (pageUrl, body) = html(episode.url)
        val servers = Parse.servers(body).sortedByDescending { preferredServer != null && it.name.equals(preferredServer, ignoreCase = true) }
        if (servers.isEmpty()) trace?.note("السيرفرات", "الصفحة بلا سيرفرات مشاهدة")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        fun key(s: Parse.Server) = "t" + Integer.toHexString(s.url.hashCode())
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

        fun search(html: String, sourceId: String): List<SourceAnime> {
            val doc = Jsoup.parse(html, "https://tuktukhd.com/")
            val cards = doc.select(".Block--Item > a[href]").map { a ->
                val img = a.selectFirst("img")
                SiteCards.Card(
                    href = a.absUrl("href"),
                    title = a.attr("title").ifBlank { a.selectFirst("h2, h3")?.text().orEmpty() },
                    thumb = img?.let { it.absUrl("data-src").ifBlank { it.absUrl("src") } }?.ifBlank { null },
                )
            }
            return SiteCards.fold(cards, sourceId)
        }

        fun episodes(html: String, pageUrl: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select(".episodes--list--side a[href]").mapNotNull { a ->
                val n = a.selectFirst("em")?.text()?.trim()?.toFloatOrNull()
                    ?: SiteCards.episodeNumber(a.attr("title"))
                    ?: return@mapNotNull null
                val path = SiteCards.pathOf(a.absUrl("href")) ?: return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${if (n % 1f == 0f) n.toInt().toString() else n.toString()}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        fun servers(html: String): List<Server> {
            val doc = Jsoup.parse(html, "https://tuktukhd.com/")
            val list = doc.select(".watch--servers--list li.server--item[data-link]").mapNotNull { li ->
                val url = decode(li.attr("data-link")) ?: return@mapNotNull null
                Server(li.text().replace("⭐", "").trim().ifBlank { "TukTuk" }, url)
            }
            // المشغّل الأول قد يكون في iframe مرمّزًا بـbase64 فقط (data-crypt)
            val crypt = doc.selectFirst("iframe[data-crypt]")?.attr("data-crypt")?.let { b64(it) }
            return (list + listOfNotNull(crypt?.takeIf { c -> list.none { it.url == c } }?.let { Server("TukTuk", it) })).distinctBy { it.url }
        }

        /** `decodeLink` في setup.js: ما قبل `0REL0Y&` معكوسًا ثم base64. */
        fun decode(value: String): String? {
            val part = value.replace("&amp;", "&").substringBefore("0REL0Y&")
            return b64(part.reversed())
        }

        private fun b64(s: String): String? = runCatching {
            String(java.util.Base64.getDecoder().decode(s.trim().padEnd((s.trim().length + 3) / 4 * 4, '=')))
        }.getOrNull()?.trim()?.takeIf { it.startsWith("http") }
    }

    companion object {
        const val KIND = "tuktuk-site"
    }
}
