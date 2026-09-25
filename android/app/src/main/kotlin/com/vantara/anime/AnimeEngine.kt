package com.vantara.anime

import android.content.Context
import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.ExtensionAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.adapters.SourcePage
import com.vantara.anime.adapters.WitAnimeSiteAdapter
import com.vantara.anime.hosts.EmbedResolver
import com.vantara.anime.hosts.WebViewSniffer
import com.vantara.anime.catalog.CatalogCrawler
import com.vantara.anime.catalog.CatalogCursor
import com.vantara.anime.catalog.CatalogStore
import com.vantara.anime.episodes.EpisodeResolver
import com.vantara.anime.health.HealthStore
import com.vantara.anime.loader.AnimeExtensionLoader
import com.vantara.anime.matching.WorkMatcher
import com.vantara.anime.matching.WorkSignals
import com.vantara.anime.net.AnimeDns
import com.vantara.anime.net.AnimeHostRouter
import com.vantara.anime.registry.Manifest
import com.vantara.anime.registry.ManifestParser
import com.vantara.anime.registry.SourceEntry
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.PlaybackSession
import com.vantara.anime.stream.Preferences
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import okhttp3.Request
import java.io.File
import java.io.IOException
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

    /** عمل خلفي لا يخص طلبًا (تحميل الإضافات مسبقًا). */
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val dns = AnimeDns(AnimeHostRouter::isHiddenOnly)

    init {
        AnimeHostRouter.health = health
        // نقطة الربط العامة في جذر الشبكة: المحرك يسجّل نفسه، والشبكة لا تعرفه
        eu.kanade.tachiyomi.network.HostRouting.delegate = AnimeHostRouter
        eu.kanade.tachiyomi.network.HostRouting.hiddenOnly = AnimeHostRouter::isHiddenOnly
        eu.kanade.tachiyomi.network.HostRouting.dns = dns
        // نفس عميل الشبكة إلا مصنع المقبس؛ تُستخدم فقط عند مصافحة TLS تنقطع فجأة
        AnimeHostRouter.fragmentClient = network.client.newBuilder()
            .socketFactory(com.vantara.anime.net.SniFragmentingSocketFactory())
            .build()
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
        preload()
        return emptyList()
    }

    /**
     * تنزيل الإضافات وتحميلها الآن في الخلفية، لا أثناء أول بحث: أول تنزيل على
     * شبكة بطيئة كان يأكل مهلة البحث كلها فيُلغى الطلب («Canceled»).
     */
    private fun preload() {
        for (s in manifest.sources) {
            if (!s.enabled || s.disabledReason != null || (s.extension == null && s.adapter == null)) continue
            background.launch { adapter(s.id) }
        }
    }

    fun sources(): List<SourceEntry> = manifest.sources

    private fun entry(id: String): SourceEntry? = manifest.sources.firstOrNull { it.id == id }

    /** المصدر جاهزًا للعمل، أو null مع سبب في [loadErrors]. */
    suspend fun adapter(id: String): AnimeAdapter? {
        adapters[id]?.let { return it }
        val e = entry(id) ?: return null
        if (!e.enabled || e.disabledReason != null) return null
        e.adapter?.let { kind -> return native(e, kind).also { adapters[id] = it } }
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

    /** سيرفرات الفيديو المضمّنة، والمتصفح المخفي لما لا نستخرجه مباشرة. */
    private val embeds by lazy {
        EmbedResolver(network.client, WebViewSniffer(appContext, network::defaultUserAgentProvider))
    }

    /** محوّل VANTARA أصلي: لا تنزيل ولا تحميل كود، فيُبنى فورًا. */
    private fun native(e: SourceEntry, kind: String): AnimeAdapter = when (kind) {
        WitAnimeSiteAdapter.KIND -> WitAnimeSiteAdapter(
            id = e.id,
            name = e.name,
            client = network.client,
            base = { AnimeHostRouter.activeBase(e.id) ?: e.domains.current },
            embeds = embeds,
        )
        else -> error("محوّل غير معروف: $kind")
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

    /**
     * بحث في كل المصادر بالتوازي. المهلتان منفصلتان: تحميل الإضافة (تنزيل APK
     * مرة واحدة) له مهلته، والبحث نفسه له مهلته. انتهاء مهلة البحث يُسجَّل على
     * المصدر بسببه («لم يرد خلال …») لا كـ«Canceled».
     */
    suspend fun search(
        query: String,
        content: String = "anime",
        timeoutMs: Long = SEARCH_TIMEOUT_MS,
        loadTimeoutMs: Long = LOAD_TIMEOUT_MS,
    ): List<Work> {
        val ids = manifest.sources.filter { it.enabled && it.disabledReason == null && it.content == content }.map { it.id }
        val results = coroutineScope {
            ids.map { id ->
                async {
                    val a = withTimeoutOrNull(loadTimeoutMs) { adapter(id) } ?: return@async emptyList()
                    guarded(id, timeoutMs) { a.page(Listing.SEARCH, 1, query) }?.items.orEmpty()
                }
            }.awaitAll().flatten()
        }
        return merge(results)
    }

    /**
     * ينفّذ طلبًا لمصدر بمهلة، ويسجّل ما لا يراه موجّه الشبكة: المهلة نفسها،
     * وأعطال القراءة (محلّل تغيّر موقعه). أعطال الشبكة سجّلها الموجّه أصلًا.
     */
    private suspend fun <T> guarded(id: String, timeoutMs: Long, block: suspend () -> T): T? {
        val key = HealthStore.sourceKey(id)
        return try {
            withTimeout(timeoutMs) { block() }
        } catch (e: TimeoutCancellationException) {
            health.fail(key, "لم يرد خلال ${timeoutMs / 1000} ثانية")
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            null
        } catch (e: Throwable) {
            health.fail(key, "خطأ في قراءة الصفحة: ${AnimeHostRouter.describe(e)}")
            null
        }
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
        val a = adapter(id) ?: error(loadErrors[id] ?: "المصدر غير متاح")
        val hint = e.catalog
        val template = hint.urlTemplate.takeIf { a is ExtensionAdapter }
        val fetcher = CatalogCrawler.PageFetcher { page ->
            if (template != null && a is ExtensionAdapter) {
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

    // ── التشخيص ──

    @Serializable
    data class Step(val label: String, val state: String, val detail: String)

    /**
     * فحص مصدر خطوة خطوة، ليعرف المستخدم (ونعرف نحن) أين ينكسر بالضبط:
     * الـDNS، الاتصال، Cloudflare، الدومين، الإضافة، البحث.
     */
    suspend fun diagnose(id: String, query: String = "naruto"): List<Step> {
        val e = entry(id) ?: error("مصدر غير معروف: $id")
        val steps = mutableListOf<Step>()
        fun add(label: String, state: String, detail: String) { steps += Step(label, state, detail) }
        val base = AnimeHostRouter.activeBase(id) ?: e.domains.current
        val host = base.substringAfter("://").substringBefore('/')

        val (sys, doh) = dns.compare(host)
        val sysText = sys.fold({ it.joinToString { a -> a.hostAddress.orEmpty() } }, { AnimeHostRouter.describe(it) })
        val sysBad = sys.isFailure || AnimeDns.isSinkhole(sys.getOrNull().orEmpty())
        add("DNS الجوال", if (sysBad) "fail" else "ok", "$host ← $sysText")
        add(
            "DNS عبر HTTPS",
            if (doh.isSuccess) "ok" else "fail",
            doh.fold({ it.joinToString { a -> a.hostAddress.orEmpty() } }, { AnimeHostRouter.describe(it) }) +
                if (sysBad && doh.isSuccess) " — الشبكة تحجب الاسم، والمحرك يتجاوزه" else "",
        )

        add("IPv6 في الجوال", "ok", if (AnimeDns.deviceHasIpv6()) "موجود" else "غير موجود — نستخدم IPv4 فقط")
        val v4 = (doh.getOrNull().orEmpty() + sys.getOrNull().orEmpty()).firstOrNull { it is java.net.Inet4Address }
        if (v4 != null) {
            probeTls(host, v4, java.net.Socket(), "مصافحة TLS", showConnect = true, add = ::add)
            // فشلت المصافحة العادية؟ جرّب بتجزئة ClientHello (نمط حجب SNI الشائع)
            if (steps.lastOrNull { it.label == "مصافحة TLS" }?.state == "fail") {
                probeTls(host, v4, com.vantara.anime.net.FragmentingSocket(), "تجزئة SNI", showConnect = false, add = ::add)
            }
        }

        val started = System.nanoTime()
        runCatching {
            network.client.newCall(Request.Builder().url(base).build()).execute().use { r ->
                val ms = (System.nanoTime() - started) / 1_000_000
                val body = runCatching { r.peekBody(400_000).string() }.getOrDefault("")
                val title = Regex("<title[^>]*>([^<]{0,120})", RegexOption.IGNORE_CASE).find(body)?.groupValues?.get(1)?.trim().orEmpty()
                val cf = r.header("cf-mitigated") != null || (r.code in setOf(403, 503) && body.contains("challenge-platform"))
                val finalHost = r.request.url.host
                add(
                    "فتح الموقع",
                    if (r.isSuccessful) "ok" else "fail",
                    "HTTP ${r.code} · ${ms}ms · $finalHost" + (if (title.isNotEmpty()) " · «$title»" else ""),
                )
                if (cf) add("Cloudflare", "fail", "تحقق يحتاج متصفحًا؛ الحل المخفي لم يكفِ")
                e.domains.fingerprint?.let { fp ->
                    val match = Regex(fp, RegexOption.IGNORE_CASE).containsMatchIn(body)
                    add("بصمة المصدر", if (match) "ok" else "warn", if (match) "الصفحة هي الموقع الحقيقي" else "الصفحة لا تشبه ${e.name} (دومين تغيّر أو صفحة حجب)")
                }
            }
        }.onFailure { add("فتح الموقع", "fail", AnimeHostRouter.describe(it)) }

        val a = withTimeoutOrNull(LOAD_TIMEOUT_MS) { adapter(id) }
        if (a == null) {
            add("الإضافة", "fail", loadErrors[id] ?: "لم تُحمَّل خلال ${LOAD_TIMEOUT_MS / 1000} ثانية")
            return steps
        }
        if (e.adapter != null) add("المحوّل", "ok", "محوّل VANTARA أصلي (${e.adapter})")
        else add("الإضافة", "ok", "محمّلة (${e.extension?.version ?: "?"})")

        val t0 = System.nanoTime()
        val found = runCatching { withTimeout(SEARCH_TIMEOUT_MS) { a.page(Listing.SEARCH, 1, query) } }
        val ms = (System.nanoTime() - t0) / 1_000_000
        found.fold(
            { p -> add("بحث «$query»", if (p.items.isNotEmpty()) "ok" else "warn", "${p.items.size} نتيجة · ${ms}ms") },
            { t ->
                val why = if (t is TimeoutCancellationException) "لم يرد خلال ${SEARCH_TIMEOUT_MS / 1000} ثانية" else AnimeHostRouter.describe(t)
                add("بحث «$query»", "fail", why)
            },
        )

        // السلسلة كاملة على أول نتيجة: الحلقات ← روابط تشغيل أول حلقة
        found.getOrNull()?.items?.firstOrNull()?.let { first ->
            val t1 = System.nanoTime()
            runCatching {
                withTimeout(PLAY_PROBE_TIMEOUT_MS) {
                    val eps = a.episodes(first)
                    val ep = eps.firstOrNull() ?: return@withTimeout Triple(0, null, emptyList<Candidate>())
                    Triple(eps.size, ep, a.candidates(ep))
                }
            }.fold(
                { (count, ep, found) ->
                    val took = (System.nanoTime() - t1) / 1_000_000
                    val servers = found.map { it.server }.distinct().joinToString("، ")
                    add(
                        "تشغيل «${first.title}»",
                        if (found.isNotEmpty()) "ok" else "warn",
                        if (ep == null) "لا حلقات" else "$count حلقة · ${ep.name}: ${found.size} رابط" +
                            (if (servers.isNotEmpty()) " ($servers)" else "") + " · ${took}ms",
                    )
                },
                { t ->
                    val why = if (t is TimeoutCancellationException) "لم يكتمل خلال ${PLAY_PROBE_TIMEOUT_MS / 1000} ثانية" else AnimeHostRouter.describe(t)
                    add("تشغيل «${first.title}»", "fail", why)
                },
            )
        }
        health.flush()
        return steps
    }

    /**
     * اتصال خام بعنوان IPv4 ثم مصافحة TLS باسم الموقع، عبر [socket] (عادي أو
     * مجزِّئ ClientHello): يفرّق بين «العنوان محجوب» (فشل TCP) و«الاسم محجوب
     * داخل TLS» (TCP ينجح والمصافحة تنقطع = حجب SNI). [showConnect] يمنع تكرار
     * سطر «اتصال مباشر» عند إعادة المحاولة بالتجزئة على نفس الاتصال الناجح.
     */
    private fun probeTls(
        host: String,
        ip: java.net.InetAddress,
        socket: java.net.Socket,
        label: String,
        showConnect: Boolean,
        add: (String, String, String) -> Unit,
    ) {
        val t0 = System.nanoTime()
        try {
            socket.connect(java.net.InetSocketAddress(ip, 443), 8_000)
            if (showConnect) add("اتصال مباشر", "ok", "${ip.hostAddress}:443 · ${(System.nanoTime() - t0) / 1_000_000}ms")
        } catch (e: Exception) {
            if (showConnect) add("اتصال مباشر", "fail", "${ip.hostAddress}:443 — ${AnimeHostRouter.describe(e)}")
            runCatching { socket.close() }
            return
        }
        try {
            socket.soTimeout = 8_000
            val factory = javax.net.ssl.SSLSocketFactory.getDefault() as javax.net.ssl.SSLSocketFactory
            (factory.createSocket(socket, host, 443, true) as javax.net.ssl.SSLSocket).use { tls ->
                val t1 = System.nanoTime()
                tls.startHandshake()
                add(label, "ok", "${tls.session.protocol} · ${(System.nanoTime() - t1) / 1_000_000}ms")
            }
        } catch (e: Exception) {
            val hint = if (showConnect) " — غالبًا الشبكة تحجب اسم الموقع داخل الاتصال (SNI)" else " — لا تكفي؛ الحاجب يعيد تجميع التدفق"
            add(label, "fail", AnimeHostRouter.describe(e) + hint)
        } finally {
            runCatching { socket.close() }
        }
    }

    companion object {
        /** مهل تناسب الشبكات البطيئة (ping 600–1000ms شائع على الجوال). */
        const val SEARCH_TIMEOUT_MS = 30_000L
        const val LOAD_TIMEOUT_MS = 90_000L
        const val PLAY_PROBE_TIMEOUT_MS = 75_000L

        @Volatile private var instance: AnimeEngine? = null
        fun get(context: Context): AnimeEngine =
            instance ?: synchronized(this) { instance ?: AnimeEngine(context).also { instance = it } }
    }
}
