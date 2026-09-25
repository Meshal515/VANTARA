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
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val byId = LinkedHashMap<String, Route>()
    private val candidates = LinkedHashMap<String, Candidate>()
    private val routeOfCandidate = HashMap<String, String>()
    private val listeners = CopyOnWriteArrayList<(Route?) -> Unit>()

    @Volatile var job: Job? = null
    @Volatile var done = false
        private set

    fun routes(): List<Route> = synchronized(this) { byId.values.map(::withPlaybackState) }

    fun routeOf(candidateId: String): Route? = synchronized(this) { routeOfCandidate[candidateId]?.let(byId::get)?.let(::withPlaybackState) }

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

    fun finish() {
        done = true
        session.changes.value = session.changes.value + 1
        listeners.forEach { runCatching { it(null) } }
    }

    /** نفس السيرفر مرتين في نفس الجودة (من مصدرين): «MPU» ثم «MPU2». */
    private fun uniqueCode(base: String, quality: Int?, rid: String): String {
        val taken = byId.values.filter { it.id != rid && it.quality == quality }.map { it.code }.toSet()
        if (base !in taken) return base
        var n = 2
        while ("$base$n" in taken) n++
        return "$base$n"
    }

    private fun withPlaybackState(r: Route): Route =
        if (r.state == RouteState.READY && r.candidates.isNotEmpty() && r.candidates.all(session::isFailed)) r.copy(state = RouteState.FAILED) else r

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
        val preferred = if (preferCode != null && synchronized(this) { routeOfCandidate[c.id]?.let(byId::get)?.code } == preferCode) 0.35 else 0.0
        return base + speed + preferred
    }

    fun best(preferCode: String? = null): Candidate? = rank(synchronized(this) { candidates.values.toList() }, preferCode).firstOrNull()

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
