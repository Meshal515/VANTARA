package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.StreamClassifier
import com.vantara.anime.stream.Variant
import eu.kanade.tachiyomi.network.GET
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.jsoup.Jsoup
import eu.kanade.tachiyomi.network.await

/**
 * WitAnime على منصته الجديدة (witanime.site، Laravel + Livewire). إضافة Aniyomi
 * مكتوبة للموقع القديم ولا تقرؤه، فهذا محوّل VANTARA أصلي:
 *
 *   بحث       /search?q=…&page=N           بطاقات `a.group` ← /anime/… أو /movie/…
 *   الكتالوج  /sitemap-anime.xml + movies  (1900+ عمل؛ صفحة «تصفّح» تحمّل بالتمرير)
 *   الحلقات   صفحة العمل: كل روابط /watch/<slug>/<n> (One Piece: 1200 في صفحة واحدة)
 *   السيرفرات POST /watch/…/sources (رمز CSRF من الصفحة) ← لكل سيرفر رمز ←
 *             GET /watch/stream-gate/<t> (بكوكيز الجلسة) ← 302 إلى صفحة المشغّل
 *             (ok.ru، hgcloud، mega…) ← [EmbedResolver].
 *
 * حدود الموقع (`X-RateLimit-Limit: 20` في الدقيقة): سطل لـ`sources` و`stream-source`
 * معًا، وسطل لـ`stream-gate`. البوابة تعمل بلا `stream-source` فلا نطلبه؛ والحدود
 * نفسها في البيان يطبّقها [com.vantara.anime.net.RateGate] على كل طلبات المصدر.
 */
class WitAnimeSiteAdapter(
    override val id: String,
    override val name: String,
    private val client: OkHttpClient,
    private val base: () -> String,
    private val embeds: EmbedResolver,
    /** يشمل انتظار دوره في المتصفح المخفي (3 معًا). */
    private val serverTimeoutMs: Long = 45_000,
) : AnimeAdapter {

    private val noRedirect by lazy { client.newBuilder().followRedirects(false).followSslRedirects(false).build() }
    private val catalogLock = Mutex()
    @Volatile private var catalog: List<SourceAnime>? = null

    private fun abs(path: String) = if (path.startsWith("http")) path else base().trimEnd('/') + path

    private suspend fun html(path: String, referer: String? = null): String {
        val h = Headers.Builder().apply { referer?.let { add("Referer", it) } }.build()
        return client.newCall(GET(abs(path), h)).awaitOk().use { it.body.string() }
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage = when (listing) {
        Listing.SEARCH -> {
            val q = query.trim()
            val url = abs("/search").toHttpUrl().newBuilder().addQueryParameter("q", q).apply {
                if (page > 1) addQueryParameter("page", page.toString())
            }.build().toString()
            val body = html(url)
            SourcePage(Parse.cards(body, id), hasNext = Parse.hasPage(body, page + 1))
        }
        Listing.LATEST -> SourcePage(if (page == 1) Parse.cards(html("/"), id) else emptyList(), hasNext = false)
        Listing.POPULAR -> {
            val all = catalog()
            val from = (page - 1) * PAGE_SIZE
            SourcePage(all.drop(from).take(PAGE_SIZE), hasNext = from + PAGE_SIZE < all.size)
        }
    }

    private suspend fun catalog(): List<SourceAnime> = catalog ?: catalogLock.withLock {
        catalog ?: coroutineScope {
            listOf("/sitemap-anime.xml", "/sitemap-movies.xml")
                .map { async { runCatching { Parse.sitemap(html(it), id) }.getOrDefault(emptyList()) } }
                .awaitAll().flatten()
        }.also { if (it.isNotEmpty()) catalog = it }
    }

    override suspend fun details(anime: SourceAnime): SourceAnime = Parse.details(html(anime.url), anime)

    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> = emptyList()

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        val slug = anime.url.trimEnd('/').substringAfterLast('/')
        if (anime.url.startsWith("/movie/")) {
            return listOf(SourceEpisode(id, "/watch/movie/$slug", anime.title, 1f))
        }
        return Parse.episodes(html(anime.url), slug, id)
    }

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?): List<Candidate> {
        val watch = abs(episode.url)
        val page = html(episode.url)
        val csrf = Parse.csrf(page) ?: error("لا رمز CSRF في صفحة الحلقة")
        val sourcesPath = Parse.sourcesUrl(page) ?: "${episode.url.trimEnd('/')}/sources"
        val all = Parse.servers(post(sourcesPath, csrf, watch))
        val (skipped, servers) = all.partition { it.label.lowercase() in EmbedResolver.UNSUPPORTED }
        skipped.map { it.label }.distinct().forEach { trace?.note(it, "غير مدعوم بعد (فيديو مشفّر)") }
        if (all.isEmpty()) trace?.note("السيرفرات", "الموقع لم يُرجع أي سيرفر")

        return coroutineScope {
            servers.map { s ->
                async {
                    val label = "${s.label} ${s.quality}"
                    withTimeoutOrNull(serverTimeoutMs) {
                        runCatching { streamsOf(s, watch, episode, now, trace) }
                            .fold({ it }, { trace?.note(label, it.brief()); emptyList() })
                    } ?: emptyList<Candidate>().also { trace?.note(label, "لم يرد خلال ${serverTimeoutMs / 1000} ثانية") }
                }
            }.awaitAll().flatten().distinctBy { it.url }
        }
    }

    private suspend fun streamsOf(s: Parse.Server, watch: String, episode: SourceEpisode, now: Long, trace: ResolveTrace?): List<Candidate> {
        val label = "${s.label} ${s.quality}"
        val embed = gate(s.token, watch) ?: return emptyList<Candidate>().also { trace?.note(label, "البوابة لم تحوّل إلى مشغّل") }
        // المشغّل يتحقق من الصفحة الأم نفسها: صفحة الحلقة، لا جذر الموقع
        val streams = embeds.resolve(embed, watch)
        if (streams.isEmpty()) trace?.note(label, "لم يُستخرج رابط فيديو من ${embed.substringAfter("://").substringBefore('/')}")
        return streams.map { st ->
            Candidate(
                id = "$id|${episode.url}|${st.url.hashCode()}",
                sourceId = id,
                sourceName = name,
                server = s.label,
                host = StreamClassifier.host(st.url),
                url = st.url,
                headers = st.headers,
                quality = st.quality ?: Parse.quality(s.quality),
                label = "${s.label} ${s.quality}".trim(),
                variant = if (s.version == "dub") Variant.DUB else Variant.SUB,
                container = StreamClassifier.container(st.url),
                resolvedAt = now,
                expiresAt = StreamClassifier.expiresAt(st.url, now),
            )
        }
    }

    private suspend fun post(path: String, csrf: String, referer: String): String {
        val req = Request.Builder().url(abs(path))
            .post(ByteArray(0).toRequestBody())
            .header("Accept", "application/json")
            .header("X-CSRF-TOKEN", csrf)
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Referer", referer)
            .build()
        return client.newCall(req).awaitOk().use { it.body.string() }
    }

    /** البوابة تحوّل (302) إلى صفحة المشغّل؛ وإن أعادت صفحة فمنها `meta refresh`. */
    private suspend fun gate(token: String, referer: String): String? {
        val req = Request.Builder().url(abs("/watch/stream-gate/$token")).header("Referer", referer).build()
        return noRedirect.newCall(req).await().use { r ->
            r.header("Location")?.takeIf { it.startsWith("http") } ?: Parse.metaRefresh(r.body.string())
        }
    }

    internal object Parse {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }

        data class Server(val token: String, val label: String, val quality: String, val version: String, val lang: String)

        fun cards(html: String, sourceId: String): List<SourceAnime> {
            val doc = Jsoup.parse(html, "https://witanime.site/")
            return doc.select("a[href]").mapNotNull { a ->
                val href = a.absUrl("href").ifBlank { return@mapNotNull null }
                val path = runCatching { href.toHttpUrl().encodedPath }.getOrNull() ?: return@mapNotNull null
                if (!WORK.matches(path)) return@mapNotNull null
                val img = a.selectFirst("img") ?: return@mapNotNull null
                val title = a.selectFirst("h3")?.text()?.trim().takeUnless { it.isNullOrEmpty() }
                    ?: img.attr("alt").trim().ifEmpty { return@mapNotNull null }
                SourceAnime(sourceId, path, title, img.absUrl("src").ifBlank { null })
            }.distinctBy { it.url }
        }

        /** روابط الصفحات في HTML مرمّزة: `?q=x&amp;page=2`. */
        fun hasPage(html: String, page: Int): Boolean = Regex("""(\?|&|&amp;)page=$page\b""").containsMatchIn(html)

        fun sitemap(xml: String, sourceId: String): List<SourceAnime> =
            Regex("""<loc>\s*([^<\s]+)\s*</loc>""").findAll(xml).mapNotNull { m ->
                val path = runCatching { m.groupValues[1].toHttpUrl().encodedPath }.getOrNull() ?: return@mapNotNull null
                if (!WORK.matches(path)) return@mapNotNull null
                SourceAnime(sourceId, path, titleFromSlug(path.substringAfterLast('/')))
            }.distinctBy { it.url }.toList()

        /** `one-piece-film-red` ← «One Piece Film Red»: عنوان مؤقت إلى أن تُفتح صفحة العمل. */
        fun titleFromSlug(slug: String): String =
            slug.split('-').filter { it.isNotEmpty() }.joinToString(" ") { w -> w.replaceFirstChar { it.uppercase() } }

        fun details(html: String, fallback: SourceAnime): SourceAnime {
            val doc = Jsoup.parse(html, "https://witanime.site/")
            return fallback.copy(
                title = doc.selectFirst("h1")?.text()?.trim()?.ifEmpty { null } ?: fallback.title,
                thumbnail = doc.selectFirst("img[src*=/posters/]")?.absUrl("src")?.ifBlank { null } ?: fallback.thumbnail,
                description = doc.selectFirst("p.leading-relaxed")?.text()?.trim()?.ifEmpty { null }
                    ?: doc.selectFirst("meta[name=description]")?.attr("content")?.ifEmpty { null }
                    ?: fallback.description,
            )
        }

        fun episodes(html: String, slug: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, "https://witanime.site/")
            val prefix = "/watch/$slug/"
            return doc.select("a[href*=$prefix]").mapNotNull { a ->
                val path = runCatching { a.absUrl("href").toHttpUrl().encodedPath }.getOrNull() ?: return@mapNotNull null
                if (!path.startsWith(prefix)) return@mapNotNull null
                val n = path.removePrefix(prefix).trimEnd('/').toFloatOrNull() ?: return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${formatNumber(n)}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        private fun formatNumber(n: Float) = if (n % 1f == 0f) n.toInt().toString() else n.toString()

        fun csrf(html: String): String? = Jsoup.parse(html).selectFirst("meta[name=csrf-token]")?.attr("content")?.ifBlank { null }

        fun sourcesUrl(html: String): String? =
            Regex("""sourcesUrl:\s*'([^']+)'""").find(html)?.groupValues?.get(1)?.replace("\\/", "/")

        fun servers(body: String): List<Server> {
            val players = runCatching { json.parseToJsonElement(body).jsonObject["players"]?.jsonObject }.getOrNull() ?: return emptyList()
            return players.entries.sortedBy { QUALITY_ORDER.indexOf(it.key).let { i -> if (i < 0) 99 else i } }.flatMap { (quality, list) ->
                list.jsonArray.mapNotNull { e ->
                    val o = e.jsonObject
                    val token = o["token"]?.jsonPrimitive?.content?.takeIf { TOKEN.matches(it) } ?: return@mapNotNull null
                    Server(
                        token = token,
                        label = o["label"]?.jsonPrimitive?.content.orEmpty(),
                        quality = quality,
                        version = o["version"]?.jsonPrimitive?.content.orEmpty(),
                        lang = o["lang"]?.jsonPrimitive?.content.orEmpty(),
                    )
                }
            }
        }

        fun quality(label: String): Int? = when (label.uppercase()) {
            "4K" -> 2160
            "FHD" -> 1080
            "HD" -> 720
            "SD" -> 480
            else -> StreamClassifier.quality(label)
        }

        fun metaRefresh(html: String): String? =
            Regex("""http-equiv=["']refresh["'][^>]*url=['"]?([^'">\s]+)""", RegexOption.IGNORE_CASE).find(html)?.groupValues?.get(1)

        private val WORK = Regex("""^/(anime|movie)/[^/]+/?$""")
        private val TOKEN = Regex("^[a-f0-9]{64}$")
        private val QUALITY_ORDER = listOf("4K", "FHD", "HD", "SD")
    }

    companion object {
        const val KIND = "witanime-site"
        private const val PAGE_SIZE = 60
    }
}
