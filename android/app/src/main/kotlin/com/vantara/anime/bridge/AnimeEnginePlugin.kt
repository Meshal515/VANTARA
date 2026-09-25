package com.vantara.anime.bridge

import android.app.Application
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.anime.AnimeEngine
import com.vantara.anime.adapters.SourceAnime
import com.vantara.anime.health.HealthStore
import com.vantara.anime.stream.Preferences
import com.vantara.anime.stream.Variant
import com.vantara.plugins.ensureEngineInjekt
import eu.kanade.tachiyomi.network.interceptor.WebViewActivityHolder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * جسر الواجهة إلى محرك الأنمي. رقيق عمدًا: كل منطق في [AnimeEngine] وطبقاته.
 *
 * الأنواع تعبر كـJSON (kotlinx) لا كحقول يدوية: نفس الشكل الذي تُحفظ به في
 * المحرك، فلا ينحرف حقل بين الطرفين.
 */
@CapacitorPlugin(name = "AnimeEngine")
class AnimeEnginePlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val crawls = ConcurrentHashMap<String, Job>()
    private lateinit var engine: AnimeEngine

    override fun load() {
        WebViewActivityHolder.set(activity)
        ensureEngineInjekt(context.applicationContext as Application)
        engine = AnimeEngine.get(context)
        // تقدّم المشاهدة من المشغّل الأصلي إلى الواجهة (سجل المشاهدة/الاستئناف)
        com.vantara.anime.player.PlaybackEvents.listener = { p ->
            notifyListeners(
                "playback",
                JSObject()
                    .put("session", p.session).put("candidate", p.candidateId).put("sourceId", p.sourceId)
                    .put("position", p.positionMs).put("duration", p.durationMs).put("final", p.final),
            )
        }
    }

    /** يفتح المشغّل الأصلي لجلسة فتحتها [streams]. */
    @PluginMethod
    fun play(call: PluginCall) {
        val session = call.getString("session") ?: return call.reject("session مطلوب")
        if (engine.session(session) == null) return call.reject("الجلسة انتهت، افتحها من جديد")
        val intent = com.vantara.anime.player.PlayerActivity.intent(
            context,
            session,
            call.getString("title").orEmpty(),
            (call.getDouble("position") ?: 0.0).toLong(),
        )
        activity.startActivity(intent)
        call.resolve()
    }

    override fun handleOnPause() {
        engine.health.flush()
    }

    override fun handleOnDestroy() {
        scope.cancel()
        engine.health.flush()
    }

    private fun run(call: PluginCall, block: suspend () -> JSObject) {
        scope.launch {
            try {
                call.resolve(block())
            } catch (t: Throwable) {
                call.reject(t.message ?: t.javaClass.simpleName)
            }
        }
    }

    private inline fun <reified T> JSObject.put(key: String, value: T, serializer: kotlinx.serialization.KSerializer<T>): JSObject {
        val text = json.encodeToString(serializer, value)
        put(key, if (text.startsWith("[")) JSONArray(text) else JSONObject(text))
        return this
    }

    private fun animeFrom(obj: JSONObject?): SourceAnime =
        json.decodeFromString(SourceAnime.serializer(), obj?.toString() ?: error("anime مطلوب"))

    /** البيان من الواجهة (حزمة الويب أو خادم المزامنة). */
    @PluginMethod
    fun configure(call: PluginCall) {
        val manifest = call.getObject("manifest") ?: return call.reject("manifest مطلوب")
        val errors = engine.configure(manifest.toString())
        call.resolve(JSObject().put("ok", errors.isEmpty()).put("errors", JSArray(errors)))
    }

    @PluginMethod
    fun sources(call: PluginCall) {
        val list = JSArray()
        for (s in engine.sources()) {
            val rec = engine.health.get(HealthStore.sourceKey(s.id))
            list.put(
                JSObject()
                    .put("id", s.id).put("name", s.name).put("content", s.content)
                    .put("enabled", s.enabled && s.disabledReason == null)
                    .put("disabledReason", s.disabledReason)
                    .put("loadError", engine.loadError(s.id))
                    .put("domain", rec?.domain ?: s.domains.current)
                    .put("catalog", engine.catalogCursor(s.id)?.let { JSONObject(json.encodeToString(com.vantara.anime.catalog.CatalogCursor.serializer(), it)) }),
            )
        }
        call.resolve(JSObject().put("sources", list))
    }

    /** صحة كل مصدر وسيرفر: النجاح، آخر نجاح/فشل، الزمن، الدومين الحالي. */
    @PluginMethod
    fun health(call: PluginCall) {
        call.resolve(JSObject().put("records", engine.health.all(), ListSerializer(com.vantara.anime.health.Record.serializer())))
    }

    @PluginMethod
    fun unblock(call: PluginCall) {
        val key = call.getString("key") ?: return call.reject("key مطلوب")
        engine.health.unblock(key)
        call.resolve()
    }

    /** فحص مصدر خطوة خطوة (DNS، الاتصال، Cloudflare، البصمة، الإضافة، البحث). */
    @PluginMethod
    fun diagnose(call: PluginCall) = run(call) {
        val id = call.getString("sourceId") ?: error("sourceId مطلوب")
        val steps = engine.diagnose(id, call.getString("query") ?: "naruto")
        JSObject().put("steps", steps, ListSerializer(AnimeEngine.Step.serializer()))
    }

    /** بحث موحّد في كل المصادر، والنتيجة أعمال مدموجة كل منها بنسخه. */
    @PluginMethod
    fun search(call: PluginCall) = run(call) {
        val works = engine.search(call.getString("query").orEmpty(), call.getString("content") ?: "anime")
        JSObject().put("works", works, ListSerializer(AnimeEngine.Work.serializer()))
    }

    @PluginMethod
    fun page(call: PluginCall) = run(call) {
        val id = call.getString("sourceId") ?: error("sourceId مطلوب")
        val page = engine.page(id, call.getString("listing") ?: "popular", call.getInt("page") ?: 1, call.getString("query").orEmpty())
            ?: error(engine.loadError(id) ?: "المصدر غير متاح")
        JSObject().put("page", page, com.vantara.anime.adapters.SourcePage.serializer())
    }

    @PluginMethod
    fun details(call: PluginCall) = run(call) {
        val anime = animeFrom(call.getObject("anime"))
        val a = engine.adapter(anime.sourceId) ?: error(engine.loadError(anime.sourceId) ?: "المصدر غير متاح")
        JSObject().put("anime", a.details(anime), SourceAnime.serializer())
    }

    @PluginMethod
    fun episodes(call: PluginCall) = run(call) {
        val anime = animeFrom(call.getObject("anime"))
        val list = engine.resolver.episodes(com.vantara.anime.episodes.EpisodeResolver.Copy(anime.sourceId, anime))
        JSObject().put("episodes", list, ListSerializer(com.vantara.anime.adapters.SourceEpisode.serializer()))
    }

    /**
     * يفتح جلسة تشغيل لحلقة: كل النسخ ← كل السيرفرات ← قائمة مرتّبة.
     * المشغّل يبلّغ بعدها بـ[played]/[failed] فيأخذ المرشّح التالي.
     */
    @PluginMethod
    fun streams(call: PluginCall) = run(call) {
        val copiesJson = call.getArray("copies") ?: error("copies مطلوب")
        val copies = (0 until copiesJson.length()).map { animeFrom(copiesJson.getJSONObject(it)) }
        val number = (call.getDouble("episode") ?: error("episode مطلوب")).toFloat()
        val prefs = Preferences(
            quality = call.getInt("quality") ?: 1080,
            variant = runCatching { Variant.valueOf(call.getString("variant") ?: "SUB") }.getOrDefault(Variant.SUB),
        )
        val session = call.getString("session") ?: "s-${System.nanoTime()}"
        val list = engine.openSession(session, copies, number, prefs)
        JSObject().put("session", session).put("candidates", list, ListSerializer(com.vantara.anime.stream.Candidate.serializer()))
    }

    @PluginMethod
    fun played(call: PluginCall) {
        val s = engine.session(call.getString("session") ?: "") ?: return call.resolve()
        val id = call.getString("candidate") ?: return call.resolve()
        val startup = (call.getInt("startupMs") ?: 0).toLong()
        engine.sessionCandidate(s, id)?.let { s.started(it, startup) }
        call.resolve()
    }

    @PluginMethod
    fun failed(call: PluginCall) {
        val s = engine.session(call.getString("session") ?: "") ?: return call.resolve(JSObject().put("next", null))
        val c = engine.sessionCandidate(s, call.getString("candidate") ?: "")
        val next = c?.let { s.failed(it, call.getString("error") ?: "playback error") }
        call.resolve(JSObject().apply {
            if (next != null) put("next", next, com.vantara.anime.stream.Candidate.serializer()) else put("next", null)
        })
    }

    @PluginMethod
    fun closeSession(call: PluginCall) {
        engine.closeSession(call.getString("session") ?: "")
        call.resolve()
    }

    /** حلب الكتالوج كاملًا في الخلفية؛ التقدّم يصل بحدث `catalog`. */
    @PluginMethod
    fun crawl(call: PluginCall) {
        val id = call.getString("sourceId") ?: return call.reject("sourceId مطلوب")
        if (crawls[id]?.isActive == true) return call.resolve(JSObject().put("running", true))
        crawls[id] = scope.launch {
            runCatching {
                engine.crawl(id) { cursor ->
                    notifyListeners("catalog", JSObject().put("cursor", cursor, com.vantara.anime.catalog.CatalogCursor.serializer()))
                }
            }.onFailure { notifyListeners("catalog", JSObject().put("sourceId", id).put("error", it.message)) }
        }
        call.resolve(JSObject().put("running", true))
    }

    @PluginMethod
    fun stopCrawl(call: PluginCall) {
        crawls.remove(call.getString("sourceId") ?: "")?.cancel()
        call.resolve()
    }

    @PluginMethod
    fun catalog(call: PluginCall) = run(call) {
        val id = call.getString("sourceId") ?: error("sourceId مطلوب")
        JSObject().put("items", engine.catalogItems(id), ListSerializer(SourceAnime.serializer()))
    }
}
