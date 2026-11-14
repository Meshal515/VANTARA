package com.vantara.anime.adapters

import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.registry.PageEmbeds
import com.vantara.anime.registry.PageEpisodes
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.RouteReport
import com.vantara.anime.stream.RouteState
import com.vantara.anime.stream.Variant
import kotlinx.coroutines.CancellationException
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
    /** Cinema asks for a season independently of the episode number. */
    val requestedSeason: Int? = null,
    /**
     * موسم العمل من هويته الرسمية (AniList) حين لا يختاره المستخدم (البطاقة العامة). يُستعمل فقط إذا جمع
     * المصدر المواسم في صفحة واحدة؛ كان المصدر كله يسقط هنا (SEASON_SELECTION_REQUIRED) فلا يظهر له سيرفر.
     */
    val seasonHint: Int? = null,
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

/** قسم كما يعلنه المصدر نفسه (`key` يُمرَّر لـ`page`)، يُعرف بلا طلب شبكة. */
@Serializable
data class SourceSection(val key: String, val name: String)

enum class Listing { POPULAR, LATEST, SEARCH }

interface AnimeAdapter {
    val id: String
    val name: String

    suspend fun page(listing: Listing, page: Int, query: String = ""): SourcePage
    suspend fun details(anime: SourceAnime): SourceAnime
    suspend fun seasons(anime: SourceAnime): List<SourceAnime>
    suspend fun episodes(anime: SourceAnime): List<SourceEpisode>

    /**
     * كل طرق تشغيل الحلقة من هذا المصدر: كل سيرفر، كل جودة، روابط محلولة الآن.
     * [trace] يسجّل سبب فشل كل سيرفر لمن يريد أن يعرف (التشخيص).
     */
    suspend fun candidates(
        episode: SourceEpisode,
        now: Long = System.currentTimeMillis(),
        trace: ResolveTrace? = null,
        /** توقف مبكر حين تتوفر روابط من هذا العدد من المضيفات المختلفة. */
        enough: Int = Int.MAX_VALUE,
    ): List<Candidate>

    /** يرجّح السيرفر السابق في ترتيب التجهيز، مع إبقاء جميع الخيارات متاحة. */
    suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long = System.currentTimeMillis(), trace: ResolveTrace? = null): List<Candidate> =
        candidates(episode, now, trace, enough = Int.MAX_VALUE)

    /**
     * أقسام صفحة المصدر بترتيبه هو (طلب المالك 13 نوفمبر): أقسامه الخاصة أولًا، و«آخر التحديثات» فقط إن أعلنه.
     * لا طلب شبكة هنا: صفحة المصدر تبني ألسنتها منه ثم تطلب القسم المختار وحده.
     */
    fun sections(): List<SourceSection> = listOf(SourceSection("popular", "الرائج"))

    /** قسم بعينه من [sections] (المفتاح `section:N`). */
    suspend fun section(index: Int, page: Int): SourcePage = throw UnsupportedOperationException("SECTION_UNSUPPORTED")
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
    /** قاعدة البيان لحلقات صفحة العمل، حين لا تجد الإضافة أي حلقة. */
    private val pageEpisodes: () -> PageEpisodes? = { null },
) : AnimeAdapter {

    override val name: String get() = source.name
    val extensionBaseUrl: String? get() = (source as? AnimeHttpSource)?.baseUrl

    /** إضافة Aniyomi: «الرائج» دائمًا، و«آخر التحديثات» فقط إن أعلنته الإضافة (supportsLatest). */
    override fun sections(): List<SourceSection> = buildList {
        add(SourceSection("popular", "الرائج"))
        if (source.supportsLatest) add(SourceSection("latest", "آخر التحديثات"))
    }

    override suspend fun page(listing: Listing, page: Int, query: String): SourcePage {
        val result = when (listing) {
            Listing.POPULAR -> source.getPopularAnime(page)
            // Many Aniyomi extensions declare supportsLatest = false and throw from latestUpdatesRequest; the
            // source page asked for it first and showed the whole source as failed. Say so without a request.
            Listing.LATEST -> if (source.supportsLatest) source.getLatestUpdates(page)
                else throw UnsupportedOperationException("LATEST_UNSUPPORTED: المصدر لا يقدّم آخر التحديثات")
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

    override suspend fun episodes(anime: SourceAnime): List<SourceEpisode> {
        val fromExtension = try {
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // بلا قاعدة بديلة يبقى خطأ الإضافة هو الجواب (لا قائمة فارغة صامتة)
            if (pageEpisodes() == null) throw e
            emptyList()
        }
        if (fromExtension.isNotEmpty()) return fromExtension
        val rule = pageEpisodes() ?: return fromExtension
        val (finalUrl, html) = fetchPage(anime.url)
        return rule.extract(html, finalUrl).map { item ->
            val n = if (item.number % 1f == 0f) item.number.toInt().toString() else item.number.toString()
            SourceEpisode(sourceId = id, url = item.path, name = "الحلقة $n", number = item.number)
        }
    }

    /** صفحة من الموقع عبر عميل الإضافة (ترويساتها وكوكيزها وموجّه الدومين). */
    private suspend fun fetchPage(path: String, form: Map<String, String> = emptyMap()): Pair<String, String> {
        val http = source as? AnimeHttpSource ?: error("المصدر ليس HTTP")
        val url = if (path.startsWith("http")) path else http.baseUrl.trimEnd('/') + path
        val post = { target: String ->
            okhttp3.Request.Builder().url(target).headers(http.headers).header("Referer", target)
                .post(okhttp3.FormBody.Builder().apply { form.forEach { (k, v) -> add(k, v) } }.build()).build()
        }
        val request = if (form.isEmpty()) GET(url, http.headers) else post(url)
        val (finalUrl, body, redirected) = http.client.newCall(request).awaitOk().use {
            Triple(it.request.url.toString(), it.body.string(), it.priorResponse != null)
        }
        // تحويلة 301/302 (نطاق قديم أو مرآة ← الحالي) تجعل POST طلب GET بلا النموذج:
        // صفحة EgyDead بلا «View=1» لا تحمل قائمة السيرفرات، فيبدو الفيلم بلا سيرفر.
        // النموذج يُرسل ثانيةً إلى العنوان الذي انتهت إليه التحويلة.
        if (form.isNotEmpty() && redirected) {
            return http.client.newCall(post(finalUrl)).awaitOk().use { it.request.url.toString() to it.body.string() }
        }
        return finalUrl to body
    }

    override suspend fun candidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, enough: Int): List<Candidate> {
        val primary = pageEmbeds()?.takeIf { it.primary }
        if (primary != null && resolver != null) {
            val fromPage = try { pageCandidates(episode, primary, resolver, now, trace, enough) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { trace?.note("صفحة الحلقة", e.brief()); emptyList() }
            if (fromPage.isNotEmpty()) return fromPage
        }
        val fromExtension = try {
            extensionCandidates(episode, now, trace)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            trace?.note("الإضافة", e.brief())
            emptyList()
        }
        if (fromExtension.isNotEmpty()) return fromExtension
        trace?.note("الإضافة", "لا سيرفرات")
        if (primary != null) return fromExtension
        val rule = pageEmbeds() ?: return fromExtension
        val r = resolver ?: return fromExtension
        return pageCandidates(episode, rule, r, now, trace, enough)
    }

    override suspend fun preferredCandidates(episode: SourceEpisode, server: String, now: Long, trace: ResolveTrace?): List<Candidate> {
        val primary = pageEmbeds()?.takeIf { it.primary }
        if (primary != null && resolver != null) {
            val fromPage = try { pageCandidates(episode, primary, resolver, now, trace, Int.MAX_VALUE, server) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { trace?.note("صفحة الحلقة", e.brief()); emptyList() }
            if (fromPage.isNotEmpty()) return fromPage
        }
        val fromExtension = try { extensionCandidates(episode, now, trace, server) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { trace?.note("الإضافة", e.brief()); emptyList() }
        if (fromExtension.isNotEmpty()) return fromExtension
        if (primary != null) return fromExtension
        val rule = pageEmbeds()
        val r = resolver
        if (rule != null && r != null) {
            val fromPage = try { pageCandidates(episode, rule, r, now, trace, Int.MAX_VALUE, server) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { trace?.note("صفحة الحلقة", e.brief()); emptyList() }
            if (fromPage.isNotEmpty()) return fromPage
        }
        return emptyList()
    }

    private fun report(trace: ResolveTrace?, key: String, server: String, quality: Int?, variant: Variant, state: RouteState, list: List<Candidate> = emptyList(), reason: String? = null) =
        trace?.route(RouteReport(id, key, server, quality, variant, state, list, reason))

    /** صفحة الحلقة ← روابط صفحات المشغّل بقاعدة البيان ← [EmbedResolver] بالتوازي. */
    private suspend fun pageCandidates(episode: SourceEpisode, rule: PageEmbeds, r: EmbedResolver, now: Long, trace: ResolveTrace?, enough: Int, preferredServer: String? = null): List<Candidate> {
        val (finalUrl, html) = fetchPage(episode.url, rule.form)
        // المشغّلات تتحقق من الصفحة الأم نفسها لا من جذر الموقع
        val referer = finalUrl
        val allEmbeds = rule.extract(html, finalUrl)
        val embeds = if (preferredServer == null) allEmbeds else allEmbeds.sortedByDescending { it.name.equals(preferredServer, ignoreCase = true) }
        if (embeds.isEmpty()) trace?.note("صفحة الحلقة", "لا روابط سيرفرات بقاعدة البيان")
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        val keyOf = { e: PageEmbeds.Embed -> "p" + Integer.toHexString(e.url.hashCode()) }
        embeds.forEach { report(trace, keyOf(it), it.name, it.quality, variant, RouteState.RESOLVING) }
        return gatherUntil(
            embeds.map { embed ->
                suspend {
                    fun convert(streams: List<com.vantara.anime.hosts.Stream>) = streams.map { st ->
                        Candidate(
                            id = "$id|${episode.url}|${st.url.hashCode()}", sourceId = id, sourceName = name,
                            server = embed.name, host = StreamClassifier.host(st.url), url = st.url, headers = st.headers,
                            quality = st.quality ?: embed.quality, label = st.label.ifBlank { embed.name }, variant = variant,
                            container = st.container ?: StreamClassifier.container(st.url), resolvedAt = now,
                            expiresAt = StreamClassifier.expiresAt(st.url, now),
                        )
                    }
                    val earlyFound = mutableListOf<Candidate>()
                    val got = withTimeoutOrNull(pageEmbedTimeoutMs) {
                        try {
                            convert(r.resolve(embed.url, referer) { streams ->
                                val early = convert(streams)
                                earlyFound += early
                                if (early.isNotEmpty()) report(trace, keyOf(embed), embed.name, early.maxOfOrNull { it.quality ?: 0 }?.takeIf { it > 0 } ?: embed.quality, variant, RouteState.READY, early)
                            })
                        } catch (e: kotlinx.coroutines.CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            if (earlyFound.isEmpty()) report(trace, keyOf(embed), embed.name, embed.quality, variant, RouteState.UNAVAILABLE, reason = e.brief())
                            earlyFound.toList()
                        }
                    } ?: earlyFound.toList().takeIf { it.isNotEmpty() }
                    when {
                        got == null -> emptyList<Candidate>().also {
                            report(trace, keyOf(embed), embed.name, embed.quality, variant, RouteState.UNAVAILABLE, reason = "لم يرد خلال ${pageEmbedTimeoutMs / 1000} ثانية")
                        }
                        got.isEmpty() -> got.also { report(trace, keyOf(embed), embed.name, embed.quality, variant, RouteState.UNAVAILABLE, reason = "لم يُستخرج رابط فيديو") }
                        else -> got.also { report(trace, keyOf(embed), embed.name, it.maxOfOrNull { c -> c.quality ?: 0 }?.takeIf { q -> q > 0 } ?: embed.quality, variant, RouteState.READY, it) }
                    }
                }
            },
            enough,
        )
    }

    private suspend fun extensionCandidates(episode: SourceEpisode, now: Long, trace: ResolveTrace?, preferredServer: String? = null): List<Candidate> {
        val sEpisode = SEpisode.create().apply {
            url = episode.url
            name = episode.name
            episode_number = episode.number
        }
        val allHosters = source.getHosterList(sEpisode)
        val nameOf = { h: Hoster -> h.hosterName.takeUnless { it == Hoster.NO_HOSTER_LIST || it.isBlank() } ?: name }
        val hosters = if (preferredServer == null) allHosters else allHosters.sortedByDescending { nameOf(it).equals(preferredServer, ignoreCase = true) }
        val variant = StreamClassifier.variant(episode.name).takeUnless { it == Variant.UNKNOWN } ?: Variant.SUB
        hosters.forEachIndexed { i, h -> report(trace, "h$i", nameOf(h), null, variant, RouteState.RESOLVING) }
        return coroutineScope {
            hosters.mapIndexed { i, hoster ->
                async {
                    // «لا رابط فيديو» وحده كان يغطي أربع حالات: مهلة، خطأ الإضافة، رابط رفضه فانتارا، وقائمة فارغة.
                    // كل سيرفر يحمل الآن سببه الحقيقي، فتعرف الورقة والاعتماد من يملك العطل.
                    var why = "لا رابط فيديو"
                    val got = withTimeoutOrNull(hosterTimeoutMs) {
                        val videos = try { videosOf(hoster) }
                        catch (e: CancellationException) { throw e }
                        catch (e: Throwable) { why = "الإضافة: ${e.brief()}"; emptyList() }
                        val accepted = videos.mapNotNull { video -> runCatching { toCandidate(hoster, video, episode, now) }.getOrNull() }
                        if (accepted.isEmpty() && videos.isNotEmpty()) {
                            val scheme = videos.first().videoUrl.substringBefore(':', "").take(12).ifBlank { "بلا مخطط" }
                            why = "رابط غير قابل للتشغيل ($scheme)"
                        }
                        accepted
                    } ?: run { why = "انتهت مهلة السيرفر (${hosterTimeoutMs / 1000} ث)"; emptyList() }
                    if (got.isEmpty()) report(trace, "h$i", nameOf(hoster), null, variant, RouteState.UNAVAILABLE, reason = why)
                    else report(trace, "h$i", nameOf(hoster), got.maxOfOrNull { it.quality ?: 0 }?.takeIf { it > 0 }, variant, RouteState.READY, got)
                    got
                }
            }.awaitAll().flatten().distinctBy { it.url }
        }
    }

    private suspend fun videosOf(hoster: Hoster): List<Video> {
        val listed = hoster.videoList ?: source.getVideoList(hoster)
        val http = source as? AnimeHttpSource ?: return listed
        // initialized governs resolution: a nonblank URL can still be an embed or token placeholder.
        // Resolve each listed video once; the result need not set initialized (legacy default is identity).
        // Keep this request-local so a later playback request can refresh expiring links.
        return listed.mapNotNull { video ->
            if (video.initialized) video else try { http.resolveVideo(video) }
            catch (e: CancellationException) { throw e }
            catch (e: Throwable) { null }
        }
    }

    private fun toCandidate(hoster: Hoster, video: Video, episode: SourceEpisode, now: Long): Candidate? {
        // magnet من إضافات التورنت (Torrentio Anime): يصير تذكرة في محرك التورنت عند التجهيز (MagnetLinks)
        val url = video.videoUrl.takeIf { it.startsWith("http") || com.vantara.anime.stream.MagnetLinks.isMagnet(it) } ?: return null
        val magnet = com.vantara.anime.stream.MagnetLinks.isMagnet(url)
        val serverName = hoster.hosterName.takeUnless { it == Hoster.NO_HOSTER_LIST || it.isBlank() } ?: video.videoTitle
        val headers = if (magnet) emptyMap() else (video.headers ?: (source as? AnimeHttpSource)?.headers)
            ?.let { h -> h.names().associateWith { h[it].orEmpty() } }.orEmpty()
        return Candidate(
            id = "$id|${episode.url}|${url.hashCode()}",
            sourceId = id,
            sourceName = name,
            server = serverName,
            host = if (magnet) "torrent" else StreamClassifier.host(url),
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
