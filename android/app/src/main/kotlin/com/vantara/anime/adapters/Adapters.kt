package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.registry.PageEmbeds
import com.vantara.anime.stream.Candidate
import kotlinx.coroutines.CancellationException
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import com.vantara.anime.stream.StreamClassifier
import com.vantara.anime.stream.TrackRef
import eu.kanade.tachiyomi.animesource.AnimeCatalogueSource
import eu.kanade.tachiyomi.animesource.model.AnimeFilterList
import eu.kanade.tachiyomi.animesource.model.FetchType
import eu.kanade.tachiyomi.animesource.model.Hoster
import eu.kanade.tachiyomi.animesource.model.SAnime
import eu.kanade.tachiyomi.animesource.model.SEpisode
import eu.kanade.tachiyomi.animesource.model.Video
import eu.kanade.tachiyomi.animesource.online.AnimeHttpSource
import eu.kanade.tachiyomi.animesource.model.AnimesPage
import eu.kanade.tachiyomi.network.GET
import eu.kanade.tachiyomi.network.awaitSuccess
import okhttp3.Response
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable

/*
 * عقد VANTARA للمصدر. بقية المحرك (الكتالوج، الحلقات، التشغيل، الصحة) لا
 * ترى إلا هذا العقد: لا SAnime ولا Hoster ولا أي نوع من Aniyomi. فمصدرٌ نكتبه
 * بأنفسنا غدًا (NativeAdapter) يدخل بلا تعديل في أي طبقة أخرى.
 */

@Serializable
data class SourceAnime(
    val sourceId: String,
    val url: String,
    val title: String,
    val thumbnail: String? = null,
    val description: String? = null,
    val genres: List<String> = emptyList(),
    /** 0 مجهول، 1 يُعرض، 2 مكتمل… (قيم SAnime نفسها). */
    val status: Int = 0,
    /** المصدر يقسّم العمل مواسم بدل حلقات مباشرة. */
    val hasSeasons: Boolean = false,
    val seasonNumber: Double = -1.0,
)

@Serializable
data class SourceEpisode(
    val sourceId: String,
    val url: String,
    val name: String,
    val number: Float,
    val date: Long = 0,
    val preview: String? = null,
    val summary: String? = null,
    val filler: Boolean = false,
)

@Serializable
data class SourcePage(val items: List<SourceAnime>, val hasNext: Boolean)

enum class Listing { POPULAR, LATEST, SEARCH }

interface AnimeAdapter {
    val id: String
    val name: String

    suspend fun page(listing: Listing, page: Int, query: String = ""): SourcePage
    suspend fun details(anime: SourceAnime): SourceAnime
    suspend fun seasons(anime: SourceAnime): List<SourceAnime>
    suspend fun episodes(anime: SourceAnime): List<SourceEpisode>

    /** كل طرق تشغيل الحلقة من هذا المصدر: كل سيرفر، كل جودة، روابط محلولة الآن. */
    suspend fun candidates(episode: SourceEpisode, now: Long = System.currentTimeMillis()): List<Candidate>
}

/**
 * مصدر من إضافة Aniyomi كما هي. يترجم بين عالمها وعقد VANTARA، ويجمع كل
 * السيرفرات بالتوازي مع مهلة لكل سيرفر: سيرفر بطيء لا يؤخّر الباقي.
 */
class ExtensionAdapter(
    override val id: String,
    private val source: AnimeCatalogueSource,
    private val hosterTimeoutMs: Long = 20_000,
    /** سيرفر من الصفحة قد ينتظر دوره في المتصفح المخفي قبل مهلته هو. */
    private val pageEmbedTimeoutMs: Long = 45_000,
    /** قاعدة البيان الحالية لسيرفرات الصفحة (تُقرأ عند كل طلب فتتحدّث بلا إعادة تحميل). */
    private val pageEmbeds: () -> PageEmbeds? = { null },
    private val resolver: EmbedResolver? = null,
) : AnimeAdapter {

    override val name: String get() = source.name
    val extensionBaseUrl: String? get() = (source as? AnimeHttpSource)?.baseUrl

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage {
        val result = when (listing) {
            Listing.POPULAR -> source.getPopularAnime(page)
            Listing.LATEST -> source.getLatestUpdates(page)
            Listing.SEARCH -> source.getSearchAnime(page, query, AnimeFilterList())
        }
        return SourcePage(result.animes.map { it.toVantara() }, result.hasNextPage)
    }

    /**
     * صفحة من قائمة الموقع الكاملة (من البيان) بمحلّل الإضافة نفسه. محلّلات
     * الإضافة `protected`، فالنداء بالانعكاس: أصنافها أصناف تطبيقنا لا SDK.
     */
    /**
     * صفحة من قائمة الموقع بمحدِّدات البيان: تُحلَّل هنا بـJsoup، ولا تحتاج
     * الإضافة إلا عميلها (بترويساته وكوكيزه).
     */
    suspend fun pageFromCards(url: String, sel: com.vantara.anime.registry.CardSelectors): SourcePage {
        val http = source as? AnimeHttpSource ?: error("المصدر ليس HTTP")
        val doc = http.client.newCall(GET(url, http.headers)).awaitSuccess().use { r ->
            org.jsoup.Jsoup.parse(r.body.string(), r.request.url.toString())
        }
        val items = doc.select(sel.card).mapNotNull { card ->
            val link = card.selectFirst(sel.link) ?: return@mapNotNull null
            val href = link.absUrl("href").ifBlank { link.attr("href") }.ifBlank { return@mapNotNull null }
            val title = (sel.title?.let { card.selectFirst(it)?.text() } ?: link.text()).trim().ifBlank { return@mapNotNull null }
            val image = sel.image?.let { card.selectFirst(it) }?.let { img -> img.absUrl(sel.imageAttr).ifBlank { img.attr(sel.imageAttr) } }
            SourceAnime(sourceId = id, url = pathOf(href), title = title, thumbnail = image?.ifBlank { null })
        }
        // hasNext لا يُعرف من البطاقات: الحلّاب يكمل حتى صفحة فارغة أو بلا جديد
        return SourcePage(items, hasNext = items.isNotEmpty())
    }

    /** مثل `setUrlWithoutDomain` في الإضافات: المسار فقط، فيبقى صالحًا بعد تغيّر الدومين. */
    private fun pathOf(url: String): String = runCatching {
        val u = java.net.URI(url)
        buildString {
            append(u.rawPath ?: "/")
            u.rawQuery?.let { append('?').append(it) }
        }
    }.getOrDefault(url)

    suspend fun pageFromUrl(url: String, parseWith: String): SourcePage {
        val http = source as? AnimeHttpSource ?: error("المصدر ليس HTTP")
        val methodName = when (parseWith) {
            "latest" -> "latestUpdatesParse"
            "search" -> "searchAnimeParse"
            else -> "popularAnimeParse"
        }
        val method = generateSequence<Class<*>>(http.javaClass) { it.superclass }
            .firstNotNullOfOrNull { c -> runCatching { c.getDeclaredMethod(methodName, Response::class.java) }.getOrNull() }
            ?: error("لا $methodName في الإضافة")
        method.isAccessible = true
        val result = http.client.newCall(GET(url, http.headers)).awaitSuccess().use { method.invoke(http, it) as AnimesPage }
        return SourcePage(result.animes.map { it.toVantara() }, result.hasNextPage)
    }

    override suspend fun details(anime: SourceAnime): SourceAnime =
        source.getAnimeDetails(anime.toAniyomi()).toVantara(fallback = anime)

    override suspend fun seasons(anime: SourceAnime): List<SourceAnime> =
        if (!anime.hasSeasons) emptyList() else source.getSeasonList(anime.toAniyomi()).map { it.toVantara() }

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> =
        source.getEpisodeList(anime.toAniyomi()).map { e ->
            SourceEpisode(
                sourceId = id,
                url = e.url,
                name = e.name,
                number = e.episode_number,
                date = e.date_upload,
                preview = e.preview_url,
                summary = e.summary,
                filler = e.fillermark,
            )
        }.sortedBy { it.number }

    override suspend fun candidates(episode: SourceEpisode, now: Long): List<Candidate> {
        val fromExtension = try {
            extensionCandidates(episode, now)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            emptyList()
        }
        if (fromExtension.isNotEmpty()) return fromExtension
        val rule = pageEmbeds() ?: return fromExtension
        val r = resolver ?: return fromExtension
        return pageCandidates(episode, rule, r, now)
    }

    /** صفحة الحلقة ← روابط صفحات المشغّل بقاعدة البيان ← [EmbedResolver] بالتوازي. */
    private suspend fun pageCandidates(episode: SourceEpisode, rule: PageEmbeds, r: EmbedResolver, now: Long): List<Candidate> {
        val http = source as? AnimeHttpSource ?: return emptyList()
        val pageUrl = if (episode.url.startsWith("http")) episode.url else http.baseUrl.trimEnd('/') + episode.url
        val (finalUrl, html) = http.client.newCall(GET(pageUrl, http.headers)).awaitSuccess().use { it.request.url.toString() to it.body.string() }
        val referer = finalUrl.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}/" }
        return coroutineScope {
            rule.extract(html, finalUrl).map { embed ->
                async {
                    withTimeoutOrNull(pageEmbedTimeoutMs) {
                        runCatching { r.resolve(embed.url, referer) }.getOrDefault(emptyList()).map { st ->
                            Candidate(
                                id = "$id|${episode.url}|${st.url.hashCode()}",
                                sourceId = id,
                                sourceName = name,
                                server = embed.name,
                                host = StreamClassifier.host(st.url),
                                url = st.url,
                                headers = st.headers,
                                quality = st.quality ?: embed.quality,
                                label = embed.name,
                                variant = StreamClassifier.variant(embed.name, episode.name),
                                container = StreamClassifier.container(st.url),
                                resolvedAt = now,
                                expiresAt = StreamClassifier.expiresAt(st.url, now),
                            )
                        }
                    }.orEmpty()
                }
            }.awaitAll().flatten().distinctBy { it.url }
        }
    }

    private suspend fun extensionCandidates(episode: SourceEpisode, now: Long): List<Candidate> {
        val sEpisode = SEpisode.create().apply {
            url = episode.url
            name = episode.name
            episode_number = episode.number
        }
        val hosters = source.getHosterList(sEpisode)
        return coroutineScope {
            hosters.map { hoster ->
                async {
                    withTimeoutOrNull(hosterTimeoutMs) {
                        runCatching { videosOf(hoster) }.getOrDefault(emptyList())
                            .mapNotNull { video -> runCatching { toCandidate(hoster, video, episode, now) }.getOrNull() }
                    }.orEmpty()
                }
            }.awaitAll().flatten().distinctBy { it.url }
        }
    }

    private suspend fun videosOf(hoster: Hoster): List<Video> {
        val listed = hoster.videoList ?: source.getVideoList(hoster)
        val http = source as? AnimeHttpSource ?: return listed
        // الفيديو الكسول يُحل الآن (قبل التشغيل مباشرة)، والفاشل يسقط وحده
        return listed.mapNotNull { v -> if (v.initialized || v.videoUrl.isNotBlank()) v else runCatching { http.resolveVideo(v) }.getOrNull() }
    }

    private fun toCandidate(hoster: Hoster, video: Video, episode: SourceEpisode, now: Long): Candidate? {
        val url = video.videoUrl.takeIf { it.startsWith("http") } ?: return null
        val serverName = hoster.hosterName.takeUnless { it == Hoster.NO_HOSTER_LIST || it.isBlank() } ?: video.videoTitle
        val headers = (video.headers ?: (source as? AnimeHttpSource)?.headers)
            ?.let { h -> h.names().associateWith { h[it].orEmpty() } }.orEmpty()
        return Candidate(
            id = "$id|${episode.url}|${url.hashCode()}",
            sourceId = id,
            sourceName = name,
            server = serverName,
            host = StreamClassifier.host(url),
            url = url,
            headers = headers,
            quality = video.resolution ?: StreamClassifier.quality(video.videoTitle, serverName),
            label = video.videoTitle,
            variant = StreamClassifier.variant(video.videoTitle, serverName, episode.name),
            container = StreamClassifier.container(url),
            subtitles = video.subtitleTracks.map { TrackRef(it.url, it.lang) },
            audio = video.audioTracks.map { TrackRef(it.url, it.lang) },
            resolvedAt = now,
            expiresAt = StreamClassifier.expiresAt(url, now),
        )
    }

    private fun SAnime.toVantara(fallback: SourceAnime? = null) = SourceAnime(
        sourceId = id,
        url = runCatching { url }.getOrNull() ?: fallback?.url.orEmpty(),
        title = runCatching { title }.getOrNull() ?: fallback?.title.orEmpty(),
        thumbnail = thumbnail_url ?: fallback?.thumbnail,
        description = description ?: fallback?.description,
        genres = genre?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: fallback?.genres.orEmpty(),
        status = status,
        hasSeasons = fetch_type == FetchType.Seasons,
        seasonNumber = season_number,
    )

    private fun SourceAnime.toAniyomi(): SAnime = SAnime.create().also { a ->
        a.url = url
        a.title = title
        a.thumbnail_url = thumbnail
        a.fetch_type = if (hasSeasons) FetchType.Seasons else FetchType.Episodes
    }
}
