package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.Generic
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.StreamClassifier
import com.vantara.anime.stream.Variant
import eu.kanade.tachiyomi.network.GET
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.FormBody
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup

/**
 * ArabSeed (MySeed) على قالبه الجديد. إضافة Aniyomi مكتوبة للقالب القديم فبحثها
 * يرجع فارغًا، فهذا محوّل VANTARA أصلي بطلبات HTTP عادية بلا متصفح:
 *
 *   بحث      /find/?word=…              بطاقات `.item__contents a.movie__block[title]`
 *            المسلسل يظهر حلقةً حلقة؛ تُجمع حلقات الموسم الواحد في بطاقة واحدة.
 *   الحلقات  صفحة أي حلقة: `ul.episodes__list a` لكل حلقات موسمها.
 *   الجودات  <رابط العمل>/watch/: `li[data-quality]` (480/720/1080) ورمز CSRF.
 *   السيرفرات POST /get__quality__servers/ لكل جودة ← قائمة السيرفرات؛ رابط كل سيرفر
 *            في `data-link` أو من POST /get__watch__server/.
 *   المباشر  /vids.php?t=… ← iframe بوابة d.myseed.tv ← رابط mp4 في الصفحة (Cloudflare، سريع).
 *            سيرفرات `/vid/?id=<base64>` تحمل رابط المشغّل نفسه مرمّزًا ← [EmbedResolver].
 */
class ArabSeedSiteAdapter(
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

    private suspend fun post(path: String, form: Map<String, String>, referer: String): String {
        val req = Request.Builder().url(abs(path))
            .post(FormBody.Builder().apply { form.forEach { (k, v) -> add(k, v) } }.build())
            .header("Accept", "application/json")
            .header("X-Requested-With", "XMLHttpRequest")
            .header("Referer", referer)
            .build()
        return client.newCall(req).awaitOk().use { it.body.string() }
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage = when (listing) {
        Listing.SEARCH -> {
            val url = abs("/find/").toHttpUrl().newBuilder().addQueryParameter("word", query.trim()).apply {
                if (page > 1) addQueryParameter("offset", page.toString())
            }.build().toString()
            SourcePage(Parse.search(html(url).second, id), hasNext = false)
        }
        Listing.LATEST, Listing.POPULAR -> SourcePage(if (page == 1) Parse.search(html("/").second, id) else emptyList(), hasNext = false)
    }

    override suspend fun details(anime: SourceAnime): SourceAnime = anime

    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> = emptyList()

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        if (Parse.kindOf(anime.title) != "series") return listOf(SourceEpisode(id, anime.url, anime.title, 1f))
        val (finalUrl, body) = html(anime.url)
        return Parse.episodes(body, finalUrl, id).ifEmpty {
            // صفحة بلا قائمة (حلقة وحيدة): الحلقة نفسها
            listOfNotNull(Parse.episodeNumber(anime.title)?.let { SourceEpisode(id, anime.url, "الحلقة ${it.toInt()}", it) })
        }
    }

    override suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long, trace: ResolveTrace?): List<Candidate> =
        candidatesFor(episode, now, trace, Int.MAX_VALUE, server)

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> =
        candidatesFor(episode, now, trace, enough, null)

    private suspend fun candidatesFor(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int, preferredServer: String?): List<Candidate> {
        val watch = abs(episode.url).trimEnd('/') + "/watch/"
        val (watchUrl, page) = html(watch, abs(episode.url))
        val info = Parse.watchPage(page) ?: error("صفحة المشاهدة بلا رمز أو معرّف")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        // سيرفرات الجودة الظاهرة في الصفحة، والباقية بطلب لكل جودة (بالتوازي)
        val servers = coroutineScope {
            info.qualities.map { q ->
                async {
                    if (q == info.activeQuality && info.servers.isNotEmpty()) info.servers
                    else runCatching {
                        Parse.qualityServers(post("/get__quality__servers/", mapOf("post_id" to info.postId, "quality" to q.toString(), "csrf_token" to info.csrf), watchUrl), q)
                    }.onFailure { if (it is CancellationException) throw it; trace?.note("${q}p", it.brief()) }.getOrDefault(emptyList())
                }
            }.awaitAll().flatten()
        }
        if (servers.isEmpty()) trace?.note("السيرفرات", "الموقع لم يُرجع أي سيرفر")
        // المباشر أولًا (بلا متصفح، الأسرع)، والأعلى جودة قبل الأدنى
        val ordered = servers.sortedWith(
            compareByDescending<Parse.Server> { preferredServer != null && it.label.equals(preferredServer, ignoreCase = true) }
                .thenByDescending { it.direct }
                .thenByDescending { it.quality },
        )
        fun key(s: Parse.Server) = "q${s.quality}s${s.index}"
        fun report(s: Parse.Server, state: RouteState, list: List<Candidate> = emptyList(), reason: String? = null) =
            trace?.route(RouteReport(id, key(s), s.label, s.quality, variant, state, list, reason))
        ordered.forEach { report(it, RouteState.RESOLVING) }
        return gatherUntil(
            ordered.map { s ->
                suspend {
                    var failure: String? = null
                    val got = withTimeoutOrNull(serverTimeoutMs) {
                        try { streamsOf(s, info, watchUrl, episode, variant, now) }
                        catch (e: CancellationException) { throw e }
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

    private suspend fun streamsOf(s: Parse.Server, info: Parse.Watch, watchUrl: String, episode: SourceEpisode, variant: Variant, now: Long): List<Candidate> {
        val link = s.link ?: runCatching {
            Parse.serverUrl(post("/get__watch__server/", mapOf("post_id" to info.postId, "quality" to s.quality.toString(), "server" to s.index.toString(), "csrf_token" to info.csrf), watchUrl))
        }.getOrNull() ?: error("الموقع لم يُرجع رابط السيرفر")
        val target = Parse.unwrap(abs(link))
        val streams = if (Parse.isDirect(target)) direct(target, watchUrl) else embeds.resolve(target, watchUrl)
        return streams.map { st ->
            Candidate(
                id = "$id|${episode.url}|${st.url.hashCode()}",
                sourceId = id,
                sourceName = name,
                server = s.label,
                host = StreamClassifier.host(st.url),
                url = st.url,
                headers = st.headers,
                quality = s.quality,
                label = "${s.label} ${s.quality}p",
                variant = variant,
                container = st.container ?: StreamClassifier.container(st.url),
                resolvedAt = now,
                expiresAt = StreamClassifier.expiresAt(st.url, now),
            )
        }
    }

    /** `/vids.php` ← iframe البوابة ← رابط الملف. البوابة تتحقق من الصفحة الأم (Referer). */
    private suspend fun direct(url: String, referer: String): List<com.vantara.anime.hosts.Stream> {
        val (_, shell) = html(url, referer)
        val gate = Parse.iframe(shell, url) ?: return embeds.resolve(url, referer)
        val (gateUrl, body) = html(gate, base().trimEnd('/') + "/")
        val origin = gateUrl.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}/" } ?: gateUrl
        val found = Generic.streams(body, gateUrl)
        if (found.isEmpty()) return embeds.resolve(gate, base().trimEnd('/') + "/")
        return found.take(2).map { com.vantara.anime.hosts.Stream(it, mapOf("Referer" to origin), null, "MySeed") }
    }

    internal object Parse {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }

        data class Server(val index: Int, val quality: Int, val label: String, val link: String?, val direct: Boolean)
        data class Watch(val csrf: String, val postId: String, val qualities: List<Int>, val activeQuality: Int?, val servers: List<Server>)

        private val EPISODE = Regex("""\s*(?:الحلقة|حلقة)\s*(\d+(?:\.\d+)?).*$""")

        fun kindOf(title: String): String =
            if (Regex("""(^|\s)(مسلسل|برنامج|انمي|أنمي|الموسم|الحلقة)(\s|$)""").containsMatchIn(title)) "series" else "movie"

        fun episodeNumber(title: String): Float? = EPISODE.find(title)?.groupValues?.get(1)?.toFloatOrNull()

        /**
         * بطاقات البحث. حلقات المسلسل تُجمع: «مسلسل X الموسم الثاني الحلقة 8 …» و«… الحلقة 7 …»
         * عملٌ واحد «مسلسل X الموسم الثاني» رابطه أحدث حلقة (صفحتها تسرد حلقات الموسم كلها).
         */
        fun search(html: String, sourceId: String): List<SourceAnime> {
            val doc = Jsoup.parse(html, "https://m.myseed.pics/")
            val seen = LinkedHashMap<String, SourceAnime>()
            for (a in doc.select(".item__contents a.movie__block[href], .item__contents > a[href]")) {
                val href = a.absUrl("href")
                val raw = a.attr("title").ifBlank { a.selectFirst("h3")?.text().orEmpty() }.trim()
                if (href.isBlank() || raw.isBlank()) continue
                val img = a.selectFirst("img")
                val thumb = img?.let { it.absUrl("data-src").ifBlank { it.absUrl("src") } }?.ifBlank { null }
                val path = runCatching { href.toHttpUrl().let { u -> u.encodedPath + (u.encodedQuery?.let { "?$it" } ?: "") } }.getOrNull() ?: continue
                val series = kindOf(raw) == "series"
                val title = if (series) raw.replace(EPISODE, "").trim().ifBlank { raw } else raw
                val key = if (series) title else path
                if (key !in seen) seen[key] = SourceAnime(sourceId, path, title, thumb)
            }
            return seen.values.toList()
        }

        fun episodes(html: String, pageUrl: String, sourceId: String): List<SourceEpisode> {
            val doc = Jsoup.parse(html, pageUrl)
            return doc.select("ul.episodes__list a[href]").mapNotNull { a ->
                val n = a.selectFirst(".epi__num b")?.text()?.trim()?.toFloatOrNull()
                    ?: Regex("""(\d+(?:\.\d+)?)""").find(a.text())?.value?.toFloatOrNull() ?: return@mapNotNull null
                val path = runCatching { a.absUrl("href").toHttpUrl().encodedPath }.getOrNull() ?: return@mapNotNull null
                SourceEpisode(sourceId, path, "الحلقة ${if (n % 1f == 0f) n.toInt().toString() else n.toString()}", n)
            }.distinctBy { it.url }.sortedBy { it.number }
        }

        fun watchPage(html: String): Watch? {
            val csrf = Regex("""['"]csrf__token['"]\s*:\s*['"]([A-Za-z0-9]+)['"]""").find(html)?.groupValues?.get(1) ?: return null
            val doc = Jsoup.parse(html, "https://m.myseed.pics/")
            val servers = doc.select("li[data-post][data-server]").mapNotNull { server(it) }
            val postId = doc.selectFirst("li[data-post][data-server]")?.attr("data-post")?.ifBlank { null }
                ?: Regex("""psot_id['"]?\s*:\s*['"]?(\d+)""").find(html)?.groupValues?.get(1)
                ?: doc.selectFirst("[data-post-id]")?.attr("data-post-id")
                ?: return null
            val qualities = doc.select("li[data-quality]").mapNotNull { it.attr("data-quality").toIntOrNull() }.distinct()
            val active = doc.selectFirst("li.active[data-quality]")?.attr("data-quality")?.toIntOrNull() ?: servers.firstOrNull()?.quality
            return Watch(csrf, postId, qualities.ifEmpty { listOfNotNull(active) }, active, servers)
        }

        private fun server(li: org.jsoup.nodes.Element, fallbackQuality: Int? = null): Server? {
            val index = li.attr("data-server").toIntOrNull() ?: return null
            val quality = li.attr("data-qu").toIntOrNull() ?: fallbackQuality ?: return null
            val name = li.attr("data-server-name").ifBlank { li.text() }.trim()
            val direct = li.attr("data-direct-arabseed") == "1"
            return Server(index, quality, if (direct) "MySeed" else name.ifBlank { "سيرفر $index" }, li.attr("data-link").ifBlank { null }, direct)
        }

        /** رد `get__quality__servers`: HTML القائمة، و`server` رابط السيرفر الأول (المباشر غالبًا). */
        fun qualityServers(body: String, quality: Int): List<Server> {
            val o = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return emptyList()
            if (o["type"]?.jsonPrimitive?.content != "success") return emptyList()
            val list = Jsoup.parse(o["html"]?.jsonPrimitive?.content.orEmpty()).select("li[data-server]").mapNotNull { server(it, quality) }
            // `server` رابط السيرفر النشط في القائمة (الأول إن لم يُعلَّم)
            val first = o["server"]?.jsonPrimitive?.content?.ifBlank { null } ?: return list
            val activeIndex = Jsoup.parse(o["html"]?.jsonPrimitive?.content.orEmpty()).selectFirst("li.active[data-server]")?.attr("data-server")?.toIntOrNull()
                ?: list.firstOrNull()?.index
            return list.map { if (it.link == null && it.index == activeIndex) it.copy(link = first) else it }
        }

        fun serverUrl(body: String): String? = runCatching {
            val o = json.parseToJsonElement(body).jsonObject
            if (o["type"]?.jsonPrimitive?.content != "success") null else o["server"]?.jsonPrimitive?.content?.ifBlank { null }
        }.getOrNull()

        /** `/vid/?id=<base64>` يحمل رابط المشغّل مرمّزًا: نذهب إليه مباشرة. */
        fun unwrap(url: String): String {
            val u = url.toHttpUrlOrNull() ?: return url
            if (!u.encodedPath.trimEnd('/').endsWith("/vid")) return url
            val id = u.queryParameter("id") ?: return url
            val decoded = runCatching { String(java.util.Base64.getDecoder().decode(id.padEnd((id.length + 3) / 4 * 4, '='))) }.getOrNull()
            return decoded?.trim()?.takeIf { it.startsWith("http") } ?: url
        }

        fun isDirect(url: String): Boolean = url.toHttpUrlOrNull()?.encodedPath?.endsWith("/vids.php") == true

        fun iframe(html: String, pageUrl: String): String? =
            Jsoup.parse(html, pageUrl).selectFirst("iframe[src]")?.absUrl("src")?.takeIf { it.startsWith("http") }
    }

    companion object {
        const val KIND = "arabseed-site"
    }
}
