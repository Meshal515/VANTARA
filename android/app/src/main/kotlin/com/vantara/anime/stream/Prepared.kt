package com.vantara.anime.stream

import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.health.HealthStore
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.CopyOnWriteArrayList

/**
 * حلقة تتجهّز: كل سيرفراتها من كل المصادر بحالتها الآن، والجلسة تمتلئ كلما
 * جهز واحد. ورقة السيرفرات (الواجهة والمشغّل) تقرأ [routes]، و«شغّل الأفضل»
 * يسأل [best]، والمشغّل ينتظر [awaitNext] إن فرغت قائمته والحل ما زال يعمل.
 */
class PreparedEpisode(
    val id: String,
    val copies: List<SourceAnime>,
    val number: Float,
    val prefs: Preferences,
    val session: PlaybackSession,
    private val health: HealthStore,
    val limitedSourceId: String? = null,
    /** يُفحص كل سيرفر جاهز بطلب قصير (السينما). الأنمي بلا فحص كما كان. */
    val probe: Boolean = false,
    val addonGeneration: String = java.util.UUID.randomUUID().toString(),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val primaryQuality = HashMap<String, Int?>()
    private val byId = LinkedHashMap<String, Route>()
    private val candidates = LinkedHashMap<String, Candidate>()
    private val routeOfCandidate = HashMap<String, String>()
    private val candidateProbes = java.util.concurrent.ConcurrentHashMap<String, Boolean>()
    private val probing = HashSet<String>()
    private val listeners = CopyOnWriteArrayList<(Route?) -> Unit>()
    private val torrentTickets = HashSet<String>()
    private val pendingAddons = HashSet<String>()
    private val completedAddons = HashSet<String>()
    private val runtimeCandidates = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    private var pendingBatches = 1
    private var fullPreparation = limitedSourceId == null

    @Volatile var job: Job? = null
    @Volatile var done = false
        private set

    init { if (probe) session.acceptsCandidate = { candidateProbes[it.id] == true || it.id in runtimeCandidates } }

    fun routes(): List<Route> = synchronized(this) { byId.values.toList() }.map(::withPlaybackState)

    fun routeOf(candidateId: String): Route? = synchronized(this) { routeOfCandidate[candidateId]?.let(byId::get) }?.let(::withPlaybackState)

    fun candidate(id: String): Candidate? = synchronized(this) { candidates[id] }

    fun candidatesOf(routeId: String): List<Candidate> = synchronized(this) {
        byId[routeId]?.candidates.orEmpty().mapNotNull(candidates::get)
    }

    /** `null` = انتهى التجهيز. يُنادى على خيط الحل: المستمع يحوّل لخيطه. */
    fun listen(l: (Route?) -> Unit): () -> Unit {
        listeners += l
        return { listeners -= l }
    }

    fun report(r: RouteReport) {
        if (r.state != RouteState.READY || r.candidates.isEmpty()) {
            reportQuality(r)
            return
        }
        val groups = r.candidates.groupBy { it.quality ?: r.quality }
        val primary = synchronized(this) {
            val id = "${r.sourceId}|${r.key}"
            if (!primaryQuality.containsKey(id)) primaryQuality[id] = groups.keys.first()
            primaryQuality[id]
        }
        for ((quality, list) in groups) reportQuality(r.copy(
            key = if (quality == primary) r.key else "${r.key}|q${quality ?: "auto"}",
            quality = quality,
            candidates = list,
        ))
    }

    private fun reportQuality(r: RouteReport) {
        val route: Route
        val fresh: List<Candidate>
        synchronized(this) {
            val rid = "${r.sourceId}|${r.key}"
            val old = byId[rid]
            val code = old?.code ?: uniqueCode(ServerCodes.code(r.server), r.quality, rid)
            fresh = r.candidates.filter { it.id !in candidates }
            for (c in r.candidates) {
                candidates[c.id] = c
                routeOfCandidate[c.id] = rid
            }
            route = Route(
                id = rid,
                sourceId = r.sourceId,
                server = r.server,
                code = code,
                quality = r.quality ?: old?.quality,
                variant = r.variant,
                // سيرفر جهز لا يرجع «يتجهّز» لأن محوّلًا أعاد الإبلاغ
                state = if (old?.state == RouteState.READY && r.state == RouteState.RESOLVING) RouteState.READY else r.state,
                candidates = (old?.candidates.orEmpty() + r.candidates.map { it.id }).distinct(),
                reason = r.reason,
                probed = old?.probed,
                probeMs = old?.probeMs,
                swarm = old?.swarm,
                swarmPeers = old?.swarmPeers,
                swarmSeeds = old?.swarmSeeds,
                swarmMs = old?.swarmMs,
                sourceName = r.candidates.firstOrNull()?.sourceName ?: old?.sourceName,
                label = r.candidates.firstOrNull()?.label?.takeIf { it.isNotBlank() } ?: old?.label,
            )
            byId[rid] = route
        }
        if (fresh.isNotEmpty()) {
            session.append(fresh)
            session.reorder { rank(it) }
        }
        val shown = withPlaybackState(route)
        listeners.forEach { runCatching { it(shown) } }
    }

    /**
     * مرشّحات رجعت من محوّل دون أن يُبلَّغ طريقها (مسار قديم أو إضافة لا
     * تعرف التقارير): تُجمع بسيرفرها في طريق جاهز، فلا يضيع رابط يعمل.
     */
    fun adopt(sourceId: String, list: List<Candidate>) {
        val unknown = synchronized(this) { list.filter { it.id !in candidates } }
        unknown.groupBy { it.server }.forEach { (server, cs) ->
            report(
                RouteReport(
                    sourceId = sourceId,
                    key = "x" + Integer.toHexString(server.hashCode()),
                    server = server,
                    quality = cs.mapNotNull { it.quality }.maxOrNull(),
                    variant = cs.first().variant,
                    state = RouteState.READY,
                    candidates = cs,
                ),
            )
        }
    }

    /** نتيجة فحص الرابط السريع: تُرسل للواجهة وتؤثر في ترتيب «شغّل الأفضل». */
    /** Each candidate is probed once, even if an adapter reports it twice. */
    fun claimProbe(candidateId: String): Boolean = synchronized(this) {
        !candidateProbes.containsKey(candidateId) && probing.add(candidateId)
    }

    /** حالة فحص السرب الحي لسيرفر تورنت (checking ثم النتيجة) تصل للواجهة كأي تغيّر. */
    fun markSwarm(routeId: String, state: String, peers: Int? = null, seeds: Int? = null, ms: Long? = null) {
        synchronized(this) {
            val old = byId[routeId] ?: return
            byId[routeId] = old.copy(swarm = state, swarmPeers = peers ?: old.swarmPeers, swarmSeeds = seeds ?: old.swarmSeeds, swarmMs = ms ?: old.swarmMs)
        }
        session.changes.value = session.changes.value + 1
    }

    fun markProbe(routeId: String, ok: Boolean, ms: Long, candidateId: String? = null) {
        val route = synchronized(this) {
            val old = byId[routeId] ?: return
            val ids = candidateId?.let(::listOf) ?: old.candidates
            for (id in ids) { candidateProbes[id] = ok; probing.remove(id) }
            val verdict = when {
                old.candidates.any { candidateProbes[it] == true } -> true
                old.candidates.all { candidateProbes[it] == false } -> false
                else -> null
            }
            old.copy(probed = verdict, probeMs = ms).also { byId[routeId] = it }
        }
        session.reorder { rank(it) }
        session.changes.value = session.changes.value + 1
        val shown = withPlaybackState(route)
        listeners.forEach { runCatching { it(shown) } }
    }

    /**
     * دفعة نسخ إضافية (مصدر رد متأخرًا بعد بدء التجهيز): الجلسة نفسها تكبر، ولا
     * يتوقف ما يعمل. يرجع false إن أُغلقت الجلسة.
     */
    fun beginBatch(): Boolean = synchronized(this) {
        if (job?.isActive != true) return@synchronized false
        pendingBatches++
        done = false
        true
    }

    /** Reserve before native preparation launches, including an empty native source batch. */
    fun reserveAddonBatches(sourceIds: List<String>, generation: String = addonGeneration): Int = synchronized(this) {
        if (generation != addonGeneration || job?.isActive != true) return@synchronized 0
        val fresh = sourceIds.asSequence().filter { it.startsWith("addon|") && it.length <= 4096 }
            .distinct().filter { it !in pendingAddons && it !in completedAddons }.take(128).toList()
        pendingAddons.addAll(fresh)
        pendingBatches += fresh.size
        if (fresh.isNotEmpty()) done = false
        fresh.size
    }

    /** A provider can complete once; foreign/duplicate/closed-session results are ignored. */
    fun claimAddonBatch(sourceId: String, generation: String = addonGeneration): Boolean = synchronized(this) {
        if (generation != addonGeneration || job?.isActive != true || !pendingAddons.remove(sourceId)) return@synchronized false
        completedAddons.add(sourceId)
        true
    }

    /** Own choices before they are reported, so cancellation cannot leak unselected tickets. */
    fun ownTorrentTicket(uri: String): Boolean = synchronized(this) {
        if (job?.isActive != true) return@synchronized false
        torrentTickets.add(uri)
        true
    }

    fun takeTorrentTickets(): List<String> = synchronized(this) {
        torrentTickets.toList().also { torrentTickets.clear() }
    }

    /** A native torrent ticket is preparable; it is not an HTTP probe or a first frame. */
    fun allowRuntimeCandidate(candidateId: String) {
        runtimeCandidates.add(candidateId)
        session.changes.value = session.changes.value + 1
    }

    /** Promote a warm session once; its existing candidates and player remain intact. */
    fun beginFullPreparation(): Boolean = synchronized(this) {
        if (fullPreparation) return@synchronized false
        fullPreparation = true
        pendingBatches++
        done = false
        true
    }

    fun finish() {
        val completed = synchronized(this) {
            if (pendingBatches <= 0) return@synchronized false
            pendingBatches--
            if (pendingBatches != 0) return@synchronized false
            done = true
            true
        }
        if (completed) {
            session.changes.value = session.changes.value + 1
            listeners.forEach { runCatching { it(null) } }
        }
    }

    /** نفس السيرفر مرتين في نفس الجودة (من مصدرين): «MPU» ثم «MPU2». */
    private fun uniqueCode(base: String, quality: Int?, rid: String): String {
        val taken = byId.values.filter { it.id != rid && it.quality == quality }.map { it.code }.toSet()
        if (base !in taken) return base
        var n = 2
        while ("$base$n" in taken) n++
        return "$base$n"
    }

    private fun withPlaybackState(r: Route): Route {
        val failed = r.state == RouteState.READY && r.candidates.isNotEmpty() && r.candidates.all(session::isFailed)
        return r.copy(
            state = if (failed) RouteState.FAILED else r.state,
            runtimeReady = !failed && r.state == RouteState.READY && r.candidates.any { it in runtimeCandidates && !session.isFailed(it) },
        )
    }

    /**
     * «شغّل الأفضل»: ليس أعلى جودة فقط. الموثوقية (نجاح المضيف والمصدر)،
     * سرعة البدء (زمن المضيف)، قرب الجودة من المفضّلة، الفشل الأخير، والسيرفر
     * الذي اخترته سابقًا لهذا الأنمي (ترجيح لا قفل).
     */
    fun rank(list: List<Candidate>, preferCode: String? = null): List<Candidate> {
        val now = clock()
        val live = list.filter { it.expiresAt > now && !session.isFailed(it.id) }
        return live.sortedWith(
            compareBy<Candidate> { if (health.skip(HealthStore.hostKey(it.host)) || health.skip(HealthStore.sourceKey(it.sourceId))) 1 else 0 }
                .thenByDescending { score(it, preferCode) },
        )
    }

    fun score(c: Candidate, preferCode: String? = null): Double {
        val base = StreamRanker.score(c, health, prefs)
        val latency = health.get(HealthStore.hostKey(c.host))?.latencyMs?.takeIf { it > 0 }
        val speed = latency?.let { 0.3 * (1 - it.coerceAtMost(8_000.0) / 8_000.0) } ?: 0.1
        val route = synchronized(this) { routeOfCandidate[c.id]?.let(byId::get) }
        val preferred = if (preferCode != null && route?.code == preferCode) 0.35 else 0.0
        // رابط ردّ فعلًا بفيديو يتقدّم؛ رابط ردّ بصفحة أو خطأ يتأخر (لا يُحذف: قد يعمل في المشغّل)
        val probed = when (route?.probed) { true -> 0.4; false -> -0.5; null -> 0.0 }
        return base + speed + preferred + probed
    }

    /** Cinema's search/extraction result is not a playable stream until its probe succeeds. */
    fun playable(list: List<Candidate>): List<Candidate> = if (!probe) list else synchronized(this) {
        list.filter { candidateProbes[it.id] == true || it.id in runtimeCandidates }
    }

    fun best(preferCode: String? = null): Candidate? = rank(playable(synchronized(this) { candidates.values.toList() }), preferCode).firstOrNull()

    /** أفضل مرشّح، منتظرًا أول سيرفر يجهز إن لم يجهز شيء بعد. */
    suspend fun awaitBest(preferCode: String?, timeoutMs: Long): Candidate? =
        best(preferCode) ?: withTimeoutOrNull(timeoutMs) {
            session.changes.first { best(preferCode) != null || done }
            best(preferCode)
        }

    /** المشغّل فرغت قائمته: التالي حين يجهز، أو null إن انتهى التجهيز بلا شيء. */
    suspend fun awaitNext(timeoutMs: Long): Candidate? =
        session.next() ?: withTimeoutOrNull(timeoutMs) {
            session.changes.first { session.remaining > 0 || done }
            session.next()
        }
}
