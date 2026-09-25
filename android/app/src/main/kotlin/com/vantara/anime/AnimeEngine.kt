package com.vantara.anime

import android.content.Context
import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.ExtensionAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourcePage
import com.vantara.anime.catalog.CatalogCrawler
import com.vantara.anime.catalog.CatalogCursor
import com.vantara.anime.catalog.CatalogStore
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.loader.AnimeExtensionLoader
import com.vantara.anime.matching.WorkMatcher
import com.vantara.anime.matching.WorkSignals
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.registry.Manifest
import com.vantara.anime.registry.ManifestParser
import com.vantara.anime.registry.SourceEntry
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * منسّق محرك الأنمي. لا منطق مصدر هنا: يربط الطبقات فقط.
 *
 *   البيان ← [AnimeHostRouter] (دومينات/صحة لكل مصدر)
 *   المصدر يُحمَّل عند أول حاجة ← [ExtensionAdapter]
 *   البحث الموحّد ← كل المصادر بالتوازي ← دمج النسخ ([WorkMatcher])
 *   الحلقة ← [EpisodeResolver] ← [PlaybackSession] (تبديل تلقائي)
 *   الكتالوج ← [CatalogCrawler] (حلب كامل بنقطة استئناف)
 */
class AnimeEngine(context: Context) {

    private val appContext = context.applicationContext
    private val network: NetworkHelper by lazy { Injekt.get<NetworkHelper>() }
    val health = HealthStore(File(appContext.filesDir, "anime-health.json"))
    private val loader by lazy { AnimeExtensionLoader(appContext, network.client) }
    private val catalogStore = CatalogStore(File(appContext.filesDir, "anime-catalog"))
    private val crawler = CatalogCrawler(catalogStore)

    @Volatile private var manifest = Manifest()
    private val adapters = ConcurrentHashMap<String, AnimeAdapter>()
    private val loadErrors = ConcurrentHashMap<String, String>()
    private val locks = ConcurrentHashMap<String, Mutex>()
    private val sessions = ConcurrentHashMap<String, PlaybackSession>()

    val resolver = EpisodeResolver(::adapter, health)

    init {
        AnimeHostRouter.health = health
        // نقطة الربط العامة في جذر الشبكة: المحرك يسجّل نفسه، والشبكة لا تعرفه
        eu.kanade.tachiyomi.network.HostRouting.delegate = AnimeHostRouter
        eu.kanade.tachiyomi.network.HostRouting.hiddenOnly = AnimeHostRouter::isHiddenOnly
    }

    /** يُنادى من الواجهة عند الإقلاع وكلما وصل بيان أحدث. */
    fun configure(text: String): List<String> {
        val parsed = ManifestParser.parse(text)
        val errors = ManifestParser.validate(parsed)
        if (errors.isNotEmpty()) return errors
        manifest = parsed
        for (s in parsed.sources) AnimeHostRouter.register(s.id, s.domains.plan(null))
        // مصدر تغيّر ملفه أو دومينه يُعاد تحميله عند أول طلب
        adapters.keys.retainAll(parsed.sources.filter { it.enabled }.map { it.id }.toSet())
        return emptyList()
    }

    fun sources(): List<SourceEntry> = manifest.sources

    private fun entry(id: String): SourceEntry? = manifest.sources.firstOrNull { it.id == id }

    /** المصدر جاهزًا للعمل، أو null مع سبب في [loadErrors]. */
    suspend fun adapter(id: String): AnimeAdapter? {
        adapters[id]?.let { return it }
        val e = entry(id) ?: return null
        if (!e.enabled || e.disabledReason != null) return null
        val ext = e.extension ?: return null
        return locks.getOrPut(id) { Mutex() }.withLock {
            adapters[id] ?: runCatching {
                val source = loader.obtain(ext)
                ExtensionAdapter(id, source).also { a ->
                    // مضيف `baseUrl` المكتوب في الإضافة صار «قديمًا» يُعاد توجيهه
                    AnimeHostRouter.register(id, e.domains.plan(a.extensionBaseUrl))
                    adapters[id] = a
                    loadErrors.remove(id)
                }
            }.onFailure {
                loadErrors[id] = it.message ?: it.javaClass.simpleName
                health.fail(HealthStore.sourceKey(id), "تحميل الإضافة: ${it.message}")
            }.getOrNull()
        }
    }

    fun loadError(id: String): String? = loadErrors[id]

    // ── البحث الموحّد ──

    @Serializable
    data class Work(
        val key: String,
        val title: String,
        val thumbnail: String?,
        val copies: List<SourceAnime>,
    )

    suspend fun search(query: String, content: String = "anime", timeoutMs: Long = 15_000): List<Work> {
        val ids = manifest.sources.filter { it.enabled && it.disabledReason == null && it.content == content }.map { it.id }
        val results = coroutineScope {
            ids.map { id ->
                async {
                    withTimeoutOrNull(timeoutMs) {
                        runCatching { adapter(id)?.page(Listing.SEARCH, 1, query)?.items }.getOrNull()
                    }.orEmpty()
                }
            }.awaitAll().flatten()
        }
        return merge(results)
    }

    /**
     * دمج نسخ نفس الأنمي: تجميع سريع بالمفتاح ثم مقارنة دقيقة داخل المجموعة.
     * ترتيب النسخ داخل العمل بصحة مصادرها.
     */
    fun merge(items: List<SourceAnime>): List<Work> {
        val works = mutableListOf<MutableList<SourceAnime>>()
        for (item in items) {
            val signals = WorkSignals(listOf(item.title))
            val home = works.firstOrNull { group -> WorkMatcher.compare(WorkSignals(listOf(group.first().title)), signals) == WorkMatcher.Match.SAME }
            if (home != null) home += item else works += mutableListOf(item)
        }
        return works.map { group ->
            val ranked = health.rank(group) { HealthStore.sourceKey(it.sourceId) }
            val lead = ranked.first()
            Work(
                key = WorkMatcher.bucket(lead.title),
                title = lead.title,
                thumbnail = ranked.firstNotNullOfOrNull { it.thumbnail },
                copies = ranked,
            )
        }
    }

    // ── التشغيل ──

    /** يبني جلسة تشغيل للحلقة من كل النسخ؛ المشغّل يطلب «التالي» عند العطل. */
    suspend fun openSession(sessionId: String, copies: List<SourceAnime>, number: Float, prefs: Preferences): List<Candidate> {
        val list = resolver.candidates(copies.map { EpisodeResolver.Copy(it.sourceId, it) }, number, prefs)
        sessions[sessionId] = PlaybackSession(list, health)
        return list
    }

    fun session(id: String): PlaybackSession? = sessions[id]

    fun sessionCandidate(session: PlaybackSession, id: String): Candidate? = session.find(id)

    fun closeSession(id: String) {
        sessions.remove(id)
        health.flush()
    }

    // ── الكتالوج ──

    suspend fun crawl(id: String, onPage: (CatalogCursor) -> Unit = {}): CatalogCursor {
        val e = entry(id) ?: error("مصدر غير معروف: $id")
        val a = adapter(id) as? ExtensionAdapter ?: error(loadErrors[id] ?: "المصدر غير متاح")
        val hint = e.catalog
        val template = hint.urlTemplate
        val fetcher = CatalogCrawler.PageFetcher { page ->
            if (template != null) {
                val base = AnimeHostRouter.activeBase(id) ?: e.domains.current
                val path = template.replace("{page}", page.toString())
                val url = if (path.startsWith("http")) path else base.trimEnd('/') + path
                hint.cards?.let { a.pageFromCards(url, it) } ?: a.pageFromUrl(url, hint.parseWith)
            } else {
                a.page(listingOf(hint.listing), page)
            }
        }
        val minInterval = (1000.0 / hint.ratePerSecond.coerceIn(0.2, 10.0)).toLong()
        return crawler.run(id, fetcher, hint.maxPages, minInterval, trustHasNext = template == null, onPage = onPage).also { health.flush() }
    }

    fun catalogCursor(id: String): CatalogCursor? = catalogStore.cursor(id)

    fun catalogItems(id: String): List<SourceAnime> = catalogStore.items(id)

    suspend fun page(id: String, listing: String, page: Int, query: String = ""): SourcePage? =
        adapter(id)?.page(listingOf(listing), page, query)

    private fun listingOf(s: String) = when (s) {
        "latest" -> Listing.LATEST
        "search" -> Listing.SEARCH
        else -> Listing.POPULAR
    }

    companion object {
        @Volatile private var instance: AnimeEngine? = null
        fun get(context: Context): AnimeEngine =
            instance ?: synchronized(this) { instance ?: AnimeEngine(context).also { instance = it } }
    }
}
