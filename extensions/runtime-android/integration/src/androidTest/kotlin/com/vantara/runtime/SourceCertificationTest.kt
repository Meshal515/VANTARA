package com.vantara.runtime

import android.app.Application
import android.os.SystemClock
import android.util.Log
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.platform.app.InstrumentationRegistry
import com.getcapacitor.JSObject
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.AnimeAdapter
import com.vantara.anime.adapters.Listing
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.bridge.AnimeEnginePlugin
import com.vantara.anime.player.PlayerActivity
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.RouteState
import com.vantara.plugins.ensureEngineInjekt
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.junit.Assume.assumeTrue
import org.junit.Test
import uy.kohesive.injekt.api.get
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * اعتماد مصدر واحد من الألف إلى الياء، بمسار التطبيق نفسه (تثبيت ← كتالوج ← تفاصيل ← حلقات ←
 * تجهيز السيرفرات بالفحص ← المشغّل الأصلي):
 *
 * - التغطية: 30 عملًا موجودة فعلًا في كتالوج المصدر، 10 مشهورة و10 متوسطة و10 نادرة. الشهرة من
 *   AniList للأنمي (عدد المتابعين)، وللسينما من موضع العمل في قوائم المصدر نفسه (أول الرائج ← أعمق الصفحات).
 * - الاحتياط: كم سيرفرًا للحلقة، وكم منها جاهز.
 * - الصدق: كل سيرفر «جاهز» يُفتح في المشغّل الأصلي؛ لا يُعدّ ناجحًا إلا بأول إطار مفكوك وتقدّم
 *   الوقت دون خطأ ودون انتقال المشغّل لسيرفر آخر. «جاهز» فشل = FALSE_READY (أخطر حكم).
 * - الإطارات: المفكوكة والساقطة لكل سيرفر كما يعدّها Media3. على المحاكي (فك برمجي) تُسجَّل ولا تُعتمد
 *   شهادةَ سلاسة؛ السلاسة تُعتمد على جهاز فعلي.
 *
 * تقرير فقط (`-e vantaraCertify true`): سطر JSON لكل عمل ولكل مصدر بوسم VANTARA_CERT.
 */
@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
class SourceCertificationTest {
    private val arb = "https://raw.githubusercontent.com/Abodabodd/re-3arabi/refs/heads/main/repo.json"
    private val yuzono = "https://raw.githubusercontent.com/yuzono/anime-repo/repo"
    private val tiers = listOf("popular", "mid", "obscure")

    private fun reason(error: Throwable): String {
        val chain = generateSequence(error) { it.cause }.take(6).toList()
        val code = chain.mapNotNull { it.message }.firstOrNull { it.matches(Regex("[A-Z][A-Z0-9_]{2,80}(:.*)?")) }
        return (code ?: (chain.last().javaClass.simpleName + ": " + (chain.last().message ?: "")))
            .replace(Regex("https?://\\S+"), "<url>").take(200)
    }

    private fun emit(obj: JsonObject) = Log.i("VANTARA_CERT", obj.toString())

    private val http by lazy {
        uy.kohesive.injekt.Injekt.get<eu.kanade.tachiyomi.network.NetworkHelper>().client.newBuilder()
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(30, TimeUnit.SECONDS).build()
    }

    /** شهرة العناوين من AniList (popularity = عدد من أضافه لقائمته). null = لم يُعرف. */
    private fun aniListPopularity(titles: List<String>): Map<String, Int?> {
        val out = mutableMapOf<String, Int?>()
        for (chunk in titles.chunked(20)) {
            val query = chunk.mapIndexed { i, t ->
                val safe = t.replace("\\", " ").replace("\"", " ").take(100)
                "q$i: Media(search: \"$safe\", type: ANIME) { popularity }"
            }.joinToString(" ", "{ ", " }")
            val body = buildJsonObject { put("query", query) }.toString()
                .toRequestBody("application/json".toMediaType())
            val parsed = runCatching {
                http.newCall(okhttp3.Request.Builder().url("https://graphql.anilist.co").post(body)
                    .header("Accept", "application/json").build()).execute().use { r ->
                    Json.parseToJsonElement(r.body?.string().orEmpty()).jsonObject["data"]?.jsonObject
                }
            }.getOrNull()
            chunk.forEachIndexed { i, t ->
                out[t] = (parsed?.get("q$i") as? JsonObject)?.get("popularity")?.jsonPrimitive?.intOrNull
            }
            Thread.sleep(700) // حد AniList: 90 طلبًا في الدقيقة
        }
        return out
    }

    /** كتالوج المصدر نفسه: الرائج ثم الأحدث، صفحات حتى تتوفر عينة كافية. الموضع يُحفظ للسينما. */
    private suspend fun crawl(adapter: AnimeAdapter, out: JsonObjectBuilder): List<SourceAnime> {
        val seen = LinkedHashMap<String, SourceAnime>()
        var pages = 0
        for (listing in listOf(Listing.POPULAR, Listing.LATEST)) {
            for (page in 1..12) {
                val got = runCatching { withTimeout(40_000) { adapter.page(listing, page) } }.getOrNull() ?: break
                pages++
                got.items.forEach { seen.putIfAbsent(it.url.trimEnd('/'), it) }
                if (!got.hasNext || got.items.isEmpty() || seen.size >= 400) break
            }
            if (seen.size >= 400) break
        }
        out.put("cataloguePages", pages)
        out.put("catalogueWorks", seen.size)
        return seen.values.toList()
    }

    /** يقسّم ما في الكتالوج فعلًا إلى ثلاث طبقات شهرة، عشرة لكل طبقة إن وُجدت. */
    private fun sample(works: List<SourceAnime>, content: String, perTier: Int, out: JsonObjectBuilder): Map<String, List<SourceAnime>> {
        if (works.isEmpty()) return tiers.associateWith { emptyList() }
        if (content == "anime") {
            val pop = aniListPopularity(works.map { it.title }.distinct().take(240))
            val known = works.mapNotNull { w -> pop[w.title]?.let { w to it } }
            val unknown = works.filter { pop[it.title] == null }
            out.put("popularitySource", "anilist")
            out.put("popularityKnown", known.size)
            val popular = known.filter { it.second >= 100_000 }.sortedByDescending { it.second }.map { it.first }
            val mid = known.filter { it.second in 15_000 until 100_000 }.sortedByDescending { it.second }.map { it.first }
            // النادر: أقل متابعة على AniList، ثم ما لا يعرفه AniList أصلًا
            val obscure = known.filter { it.second < 15_000 }.sortedBy { it.second }.map { it.first } + unknown.reversed()
            return mapOf("popular" to popular.take(perTier), "mid" to mid.take(perTier), "obscure" to obscure.take(perTier))
        }
        out.put("popularitySource", "source-position")
        val n = works.size
        val third = maxOf(1, n / 3)
        return mapOf(
            "popular" to works.take(minOf(perTier, third)),
            "mid" to works.drop(third).take(perTier),
            "obscure" to works.takeLast(minOf(perTier, maxOf(0, n - 2 * third))).reversed(),
        )
    }

    private fun <T> onMain(read: () -> T): T {
        val v = AtomicReference<T>()
        InstrumentationRegistry.getInstrumentation().runOnMainSync { v.set(read()) }
        return v.get()
    }

    /** يفتح السيرفر في المشغّل الأصلي ويقيس: أول إطار، تقدّم الوقت، المفكوك والساقط، الخطأ، والانتقال. */
    private fun play(engineSession: String, chosen: Candidate, seconds: Int): JsonObject {
        val ins = InstrumentationRegistry.getInstrumentation()
        var activity: PlayerActivity? = null
        val started = SystemClock.elapsedRealtime()
        return try {
            activity = ins.startActivitySync(PlayerActivity.intent(ins.targetContext,
                PlayerActivity.Launch(session = engineSession, title = "VANTARA certification", candidate = chosen.id))
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) as PlayerActivity
            val act = activity
            val playerField = PlayerActivity::class.java.getDeclaredField("player").apply { isAccessible = true }
            val currentField = PlayerActivity::class.java.getDeclaredField("current").apply { isAccessible = true }
            fun player() = playerField.get(act) as ExoPlayer
            onMain { player().volume = 0f }
            var ttff = -1L
            var error: String? = null
            while (SystemClock.elapsedRealtime() - started < 25_000) {
                error = onMain { player().playerError?.errorCodeName }
                if (error != null) break
                if (onMain { (player().videoDecoderCounters?.renderedOutputBufferCount ?: 0) > 0 }) { ttff = SystemClock.elapsedRealtime() - started; break }
                Thread.sleep(100)
            }
            val switched = onMain { (currentField.get(act) as? Candidate)?.id }?.let { it != chosen.id } == true
            if (ttff < 0) return buildJsonObject {
                put("verdict", "FALSE_READY"); put("code", error ?: if (switched) "SWITCHED_BEFORE_FRAME" else "NO_FIRST_FRAME")
                put("waitedMs", SystemClock.elapsedRealtime() - started)
            }
            val pos0 = onMain { player().currentPosition }
            val r0 = onMain { player().videoDecoderCounters?.renderedOutputBufferCount ?: 0 }
            val d0 = onMain { player().videoDecoderCounters?.droppedBufferCount ?: 0 }
            var stalls = 0
            val t0 = SystemClock.elapsedRealtime()
            while (SystemClock.elapsedRealtime() - t0 < seconds * 1000L) {
                error = onMain { player().playerError?.errorCodeName }
                if (error != null) break
                if (onMain { player().playbackState == androidx.media3.common.Player.STATE_BUFFERING }) stalls++
                Thread.sleep(250)
            }
            val advanced = onMain { player().currentPosition } - pos0
            val rendered = onMain { player().videoDecoderCounters?.renderedOutputBufferCount ?: 0 } - r0
            val dropped = onMain { player().videoDecoderCounters?.droppedBufferCount ?: 0 } - d0
            val size = onMain { player().videoFormat?.let { "${it.width}x${it.height}" } ?: "?" }
            val switchedLate = onMain { (currentField.get(act) as? Candidate)?.id }?.let { it != chosen.id } == true
            val ok = error == null && !switchedLate && advanced >= (seconds * 1000L * 0.6).toLong() && rendered > 0
            buildJsonObject {
                put("verdict", if (ok) "PLAYS" else "FALSE_READY")
                if (!ok) put("code", error ?: if (switchedLate) "SWITCHED_SERVER" else if (rendered <= 0) "NO_FRAMES" else "CLOCK_STALLED")
                put("ttffMs", ttff); put("advancedMs", advanced); put("decoded", rendered); put("dropped", dropped)
                put("stallSamples", stalls); put("size", size)
            }
        } catch (e: Throwable) {
            buildJsonObject { put("verdict", "FALSE_READY"); put("code", "PLAYER_" + reason(e)) }
        } finally {
            activity?.let { a -> onMain { a.finish() } }
            Thread.sleep(800)
        }
    }

    private suspend fun certifyWork(engine: AnimeEngine, adapter: AnimeAdapter, work: SourceAnime, servers: Int, seconds: Int): JsonObject = buildJsonObject {
        put("title", work.title.take(90))
        var detail = runCatching { withTimeout(40_000) { adapter.details(work) } }.getOrElse { put("details", reason(it)); work }
        if (detail.hasSeasons) {
            val season = runCatching { withTimeout(40_000) { adapter.seasons(detail) } }.getOrNull()?.firstOrNull()
            if (season != null) detail = runCatching { withTimeout(40_000) { adapter.details(season) } }.getOrDefault(season)
        }
        val episodes = runCatching { withTimeout(45_000) { adapter.episodes(detail) } }.getOrElse { put("stage", "episodes"); put("code", reason(it)); return@buildJsonObject }
        put("episodes", episodes.size)
        val episode = episodes.filter { it.number >= 1f }.minByOrNull { it.number } ?: episodes.firstOrNull()
            ?: run { put("stage", "episodes"); put("code", "EMPTY_EPISODES"); return@buildJsonObject }
        put("episode", episode.number.toDouble())
        val session = "cert-" + UUID.randomUUID()
        val started = SystemClock.elapsedRealtime()
        val prep = engine.prepare(session, listOf(detail), episode.number, Preferences(quality = 720), probe = true)
        try {
            // التجهيز كما في ورقة السيرفرات: ننتظر انتهاءه (حتى 90 ثانية) ثم فحوص الروابط الجارية (حتى 20 ثانية)
            while (!prep.done && SystemClock.elapsedRealtime() - started < 90_000) delay(500)
            val probeEnd = SystemClock.elapsedRealtime() + 20_000
            while (SystemClock.elapsedRealtime() < probeEnd && prep.routes().any { it.state == RouteState.READY && it.probed == null }) delay(500)
            val routes = prep.routes()
            val ready = routes.filter { it.state == RouteState.READY && it.probed == true }
            put("prepareMs", SystemClock.elapsedRealtime() - started)
            put("servers", routes.map { it.server.lowercase() }.distinct().size)
            put("routes", routes.size)
            put("ready", ready.size)
            put("probeFailed", routes.count { it.state == RouteState.READY && it.probed == false })
            put("unavailable", routes.count { it.state != RouteState.READY })
            put("unavailableReasons", JsonArray(routes.filter { it.state != RouteState.READY }.mapNotNull { it.reason?.take(60) }.distinct().take(6).map(::JsonPrimitive)))
            // كل سيرفر جاهز (حتى [servers] سيرفرات مختلفة) يُفتح في المشغّل الأصلي
            val toPlay = ready.distinctBy { it.server.lowercase() }.take(servers)
            val plays = toPlay.mapNotNull { route ->
                val cand = route.candidates.firstNotNullOfOrNull { prep.candidate(it) } ?: return@mapNotNull null
                buildJsonObject {
                    put("server", route.server.take(40)); put("host", cand.host.take(60)); put("quality", route.quality ?: -1)
                    play(session, cand, seconds).forEach { (k, v) -> put(k, v) }
                }
            }
            put("played", JsonArray(plays))
            put("plays", plays.count { it["verdict"]?.jsonPrimitive?.content == "PLAYS" })
            put("falseReady", plays.count { it["verdict"]?.jsonPrimitive?.content == "FALSE_READY" })
        } finally {
            engine.closeSession(session)
        }
    }

    @Test fun certifySource() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue("Source certification is opt-in", args.getString("vantaraCertify") == "true")
        val kind = args.getString("vantaraCertKind") ?: error("CERT_KIND_REQUIRED")
        val name = args.getString("vantaraCertName") ?: error("CERT_NAME_REQUIRED")
        val content = args.getString("vantaraCertContent")?.takeIf { it in setOf("anime", "cinema") } ?: "anime"
        val perTier = args.getString("vantaraCertPerTier")?.toIntOrNull()?.coerceIn(1, 20) ?: 10
        val servers = args.getString("vantaraCertServers")?.toIntOrNull()?.coerceIn(1, 6) ?: 3
        val seconds = args.getString("vantaraCertSeconds")?.toIntOrNull()?.coerceIn(4, 60) ?: 10
        val ins = InstrumentationRegistry.getInstrumentation()
        val context = ins.targetContext
        ensureEngineInjekt(context.applicationContext as Application)
        val engine = AnimeEngine.get(context)
        val window = androidx.test.core.app.ActivityScenario.launch(com.vantara.app.MainActivity::class.java)
        var host: RuntimeHost? = null
        try {
            val ids: List<String> = when (kind) {
                "cs3" -> {
                    val h = RuntimeHost(context, engine, "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
                        silentClearance = { url, agent ->
                            val solver = eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.current
                                ?: run { uy.kohesive.injekt.Injekt.get<eu.kanade.tachiyomi.network.NetworkHelper>().client; eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor.current }
                            solver?.silentClearance(url, agent)
                        }).also { host = it }
                    h.setProfile("cert-" + UUID.randomUUID())
                    val repo = args.getString("vantaraCertRepo") ?: arb
                    h.addRepository(repo)
                    val row = h.extensions(repo).map { it.jsonObject }.firstOrNull {
                        (it["name"]?.jsonPrimitive?.contentOrNull ?: "").equals(name, ignoreCase = true)
                    } ?: error("PLUGIN_NOT_IN_REPOSITORY")
                    val installed = withTimeout(120_000) { h.install(repo, row.getValue("pkg").jsonPrimitive.content, content) }
                    installed["sourceIds"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
                }
                "aniyomi" -> {
                    val plugin = AtomicReference<AnimeEnginePlugin>()
                    window.onActivity { plugin.set(it.bridge.getPlugin("AnimeEngine").instance as AnimeEnginePlugin) }
                    val repo = args.getString("vantaraCertRepo") ?: yuzono
                    com.vantara.anime.invokeVideoEngine(plugin.get(), "addRepo", JSObject().put("url", repo))
                    val index = com.vantara.anime.invokeVideoEngine(plugin.get(), "repoIndex", JSObject().put("url", repo)).getJSONArray("extensions")
                    val entry = (0 until index.length()).map { index.getJSONObject(it) }
                        .firstOrNull { it.getString("pkg").endsWith(".$name") } ?: error("PACKAGE_NOT_IN_REPOSITORY")
                    val installed = com.vantara.anime.invokeVideoEngine(plugin.get(), "installExtension",
                        JSObject().put("repo", repo).put("pkg", entry.getString("pkg")).put("content", content))
                    listOf(installed.getString("id")!!)
                }
                else -> error("CERT_KIND_UNKNOWN")
            }
            for (id in ids) {
                val adapter = engine.adapter(id) ?: run {
                    emit(buildJsonObject { put("type", "source"); put("kind", kind); put("name", name); put("id", id); put("code", "SOURCE_NOT_ROUTED") }); continue
                }
                val head = buildJsonObject {
                    put("type", "source"); put("kind", kind); put("name", name); put("id", id); put("content", content)
                    val catalogue = crawl(adapter, this)
                    val picked = sample(catalogue, content, perTier, this)
                    val results = mutableMapOf<String, MutableList<JsonObject>>()
                    for (tier in tiers) for (work in picked[tier].orEmpty()) {
                        val r = runCatching { certifyWork(engine, adapter, work, servers, seconds) }
                            .getOrElse { buildJsonObject { put("title", work.title.take(90)); put("code", reason(it)) } }
                        val line = buildJsonObject { put("type", "work"); put("name", name); put("tier", tier); r.forEach { (k, v) -> put(k, v) } }
                        emit(line)
                        results.getOrPut(tier) { mutableListOf() } += line
                    }
                    // الملخص: لكل طبقة كم وُجد وكم اشتغل، والاحتياط (سيرفران جاهزان فأكثر)، وصدق «جاهز»
                    val all = results.values.flatten()
                    put("tiers", buildJsonObject {
                        for (tier in tiers) {
                            val rs = results[tier].orEmpty()
                            put(tier, buildJsonObject {
                                put("found", picked[tier].orEmpty().size)
                                put("playable", rs.count { (it["plays"]?.jsonPrimitive?.intOrNull ?: 0) > 0 })
                                put("backup", rs.count { (it["ready"]?.jsonPrimitive?.intOrNull ?: 0) >= 2 })
                            })
                        }
                    })
                    val played = all.flatMap { (it["played"] as? JsonArray).orEmpty().map { p -> p.jsonObject } }
                    put("worksTested", all.size)
                    put("worksPlayable", all.count { (it["plays"]?.jsonPrimitive?.intOrNull ?: 0) > 0 })
                    put("worksWithBackup", all.count { (it["ready"]?.jsonPrimitive?.intOrNull ?: 0) >= 2 })
                    put("serversOpened", played.size)
                    put("falseReady", played.count { it["verdict"]?.jsonPrimitive?.content == "FALSE_READY" })
                    put("falseReadyCodes", JsonArray(played.mapNotNull { it["code"]?.jsonPrimitive?.contentOrNull }.groupingBy { it }.eachCount().map { (k, v) -> JsonPrimitive("$k×$v") }))
                    val ok = played.filter { it["verdict"]?.jsonPrimitive?.content == "PLAYS" }
                    put("ttffMedianMs", ok.mapNotNull { it["ttffMs"]?.jsonPrimitive?.longOrNull }.sorted().let { if (it.isEmpty()) -1 else it[it.size / 2] })
                    put("decodedFrames", ok.sumOf { it["decoded"]?.jsonPrimitive?.intOrNull ?: 0 })
                    put("droppedFrames", ok.sumOf { it["dropped"]?.jsonPrimitive?.intOrNull ?: 0 })
                    put("decoder", "emulator-software")
                }
                emit(head)
            }
        } catch (e: Throwable) {
            emit(buildJsonObject { put("type", "source"); put("kind", kind); put("name", name); put("code", reason(e)) })
        } finally {
            runCatching { host?.close() }
            runCatching { engine.setRuntimeSources(emptyList()) }
            window.close()
        }
    }
}
