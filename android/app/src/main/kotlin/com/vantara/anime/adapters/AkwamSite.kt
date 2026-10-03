package com.vantara.anime.adapters

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
 * Akwam (akwam.ss): ملفات mp4 مباشرة على downet.net بجودات 1080/720/480، بلا
 * مضيف وسيط. نفس `pwa/sources/engines/akwam.js`:
 *
 *   بحث      /search?q=…   `.entry-box` (الاسم + سنة الشارة)؛ الفيلم /movie/…،
 *            والمسلسل صفحة لكل موسم /series/… («Shameless الموسم الثالث»)
 *   الحلقات  صفحة الموسم: روابط /episode/<id>/…/الحلقة-N
 *   الجودات  صفحة الفيلم/الحلقة: تبويب لكل جودة (`a[href^="#tab-"]`) فيه رابط /watch/…
 *   الملف    صفحة المشاهدة: `<video><source src size="1080">`
 *
 * عنوان النسخة يحمل نوعها وسنتها («فيلم Dune 2021») لأن مطابقة السينما تحسمهما
 * من العنوان (`cinema-match.js`).
 */
class AkwamSiteAdapter(
    override val id: String,
    override val name: String,
    private val client: OkHttpClient,
    private val base: () -> String,
    private val serverTimeoutMs: Long = 20_000,
) : AnimeAdapter {

    private fun abs(path: String) = if (path.startsWith("http")) path else base().trimEnd('/') + path

    private suspend fun html(url: String, referer: String? = null): Pair<String, String> {
        val h = Headers.Builder().apply { referer?.let { add("Referer", it) } }.build()
        return client.newCall(GET(abs(url), h)).awaitOk().use { it.request.url.toString() to it.body.string() }
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage = when (listing) {
        Listing.SEARCH -> {
            val url = abs("/search").toHttpUrl().newBuilder().addQueryParameter("q", query.trim()).build().toString()
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
        return Parse.episodes(body, finalUrl, id)
    }

    override suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long, trace: ResolveTrace?): List<Candidate> =
        candidates(episode, now, trace, Int.MAX_VALUE)

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> {
        val (pageUrl, body) = html(episode.url)
        val tabs = Parse.tabs(body, pageUrl)
        if (tabs.isEmpty()) trace?.note("الجودات", "صفحة العمل بلا روابط مشاهدة")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        fun key(t: Parse.Tab) = "q${t.quality ?: 0}"
        fun report(t: Parse.Tab, state: RouteState, list: List<Candidate> = emptyList(), reason: String? = null) =
            trace?.route(RouteReport(id, key(t), name, t.quality, variant, state, list, reason))
        tabs.forEach { report(it, RouteState.RESOLVING) }
        return gatherUntil(
            tabs.map { t ->
                suspend {
                    var failure: String? = null
                    val got = withTimeoutOrNull(serverTimeoutMs) {
                        try {
                            val (watchUrl, watch) = html(t.watch, referer = pageUrl)
                            // كل صفحة مشاهدة تذكر الجودات كلها؛ السيرفر يحمل جودة تبويبه وحدها
                            val files = Parse.sources(watch, watchUrl)
                            val own = files.filter { it.quality == t.quality }.ifEmpty { files }
                            own.map { f ->
                                Candidate(
                                    id = "$id|${episode.url}|${f.url.hashCode()}",
                                    sourceId = id,
                                    sourceName = name,
                                    server = name,
                                    host = StreamClassifier.host(f.url),
                                    url = f.url,
                                    quality = f.quality ?: t.quality,
                                    label = name,
                                    variant = variant,
                                    container = StreamClassifier.container(f.url),
                                    resolvedAt = now,
                                    expiresAt = StreamClassifier.expiresAt(f.url, now),
                                )
                            }
                        } catch (e: CancellationException) { throw e }
                        catch (e: Exception) { failure = e.brief(); emptyList() }
                    }
                    when {
                        got == null -> emptyList<Candidate>().also { report(t, RouteState.UNAVAILABLE, reason = "لم يرد خلال ${serverTimeoutMs / 1000} ثانية") }
                        got.isEmpty() -> got.also { report(t, RouteState.UNAVAILABLE, reason = failure ?: "صفحة المشاهدة بلا ملف") }
                        else -> got.also { report(t, RouteState.READY, it) }
                    }
                }
            },
            enough,
        )
    }

    internal object Parse {
        data class Tab(val quality: Int?, val watch: String)
        data class File(val url: String, val quality: Int?)

        private val QUALITY = Regex("""(2160|1440|1080|720|576|480|360|240)""")

        fun kindOfPath(path: String): String = if (Regex("""^/(?:series|episode)/""").containsMatchIn(path)) "series" else "movie"

        fun quality(text: String): Int? = QUALITY.find(text)?.value?.toInt()

        fun cards(html: String, pageUrl: String, sourceId: String): List<SourceAnime> {
            val doc = Jsoup.parse(html, pageUrl)
            val out = LinkedHashMap<String, SourceAnime>()
            for (box in doc.select(".entry-box")) {
                val a = box.selectFirst(".entry-title a[href]") ?: box.selectFirst(".entry-image a[href]") ?: continue
                val path = SiteCards.pathOf(a.absUrl("href")) ?: continue
                if (!Regex("""^/(?:movie|series)/""").containsMatchIn(path) || path in out) continue
                val img = box.selectFirst("img")
                val label = a.text().trim().ifBlank { img?.attr("alt")?.trim().orEmpty() }
                if (label.isBlank()) continue
                val year = box.selectFirst(".badge-secondary")?.text()?.trim()?.toIntOrNull()
                val kind = if (kindOfPath(path) == "series") "مسلسل" else "فيلم"
                val title = "$kind $label" + (year?.takeIf { !label.contains(it.toString()) }?.let { " $it" } ?: "")
                out[path] = SourceAnime(sourceId, path, title, img?.let { it.absUrl("data-src").ifBlank { it.absUrl("src") } }?.ifBlank { null })
            }
            return out.values.toList()
        }

        fun episodes(html: String, pageUrl: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select("a[href*=/episode/]").mapNotNull { a ->
                val path = SiteCards.pathOf(a.absUrl("href")) ?: return@mapNotNull null
                val slug = runCatching { java.net.URLDecoder.decode(path.substringAfterLast('/'), "UTF-8") }.getOrDefault("")
                val n = Regex("""(\d+(?:\.\d+)?)\s*$""").find(slug)?.groupValues?.get(1)?.toFloatOrNull()
                    ?: Regex("""حلقة\s*(\d+(?:\.\d+)?)""").find(a.text())?.groupValues?.get(1)?.toFloatOrNull()
                    ?: return@mapNotNull null
                if (n <= 0f) return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${if (n % 1f == 0f) n.toInt().toString() else n.toString()}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        fun tabs(html: String, pageUrl: String): List<Tab> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select("a[href^=#tab-]").mapNotNull { tab ->
                val pane = doc.getElementById(tab.attr("href").removePrefix("#")) ?: return@mapNotNull null
                val watch = pane.selectFirst("a.link-show[href], a[href*=/watch/]")?.absUrl("href")?.ifBlank { null } ?: return@mapNotNull null
                Tab(quality(tab.text()), watch)
            }.distinctBy { it.watch }.sortedByDescending { it.quality ?: 0 }
        }

        fun sources(html: String, pageUrl: String): List<File> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select("video source[src]").mapNotNull { s ->
                val url = s.absUrl("src").ifBlank { null } ?: return@mapNotNull null
                File(url, s.attr("size").toIntOrNull() ?: quality(url))
            }.distinctBy { it.url }.sortedByDescending { it.quality ?: 0 }
        }
    }

    companion object {
        const val KIND = "akwam-site"
    }
}
