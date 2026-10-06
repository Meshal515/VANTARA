package com.vantara.plugins.translation

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * الترجمة على الجوال — الجسر إلى JavaScript (`lib/translation-native.js`).
 *
 *   models / downloadModels (+ أحداث modelsProgress) / cancelDownload / removeModels
 *   analyzePage({ path, sourceLang }) → { pageHash, width, height, thumbnail, regions, perf }
 *   renderPage({ path, regions: [{ id, arabic }] }) → { path, translated, perf }
 *   benchmarkPage({ path, regions }) → { legacy: perf, current: perf, identical }
 *   perf = { stages: {مرحلة: ms}, counts, ctd, thermal, thermalWaitMs, lowMemory, heapMb }
 *
 *   jobProgress({ title, text, done, total }) / jobFinished({ title, text }) / jobStop()
 *   notificationPermission() → { granted }
 *
 * الرؤية والتبييض والرسم كلها هنا؛ Luna من JavaScript عبر sync-worker.
 */
@CapacitorPlugin(name = "Translation")
class TranslationPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val gate = PriorityGate()
    private val detectGate = PriorityGate()
    private val renderGate = PriorityGate()
    private val routedPages = object:LinkedHashMap<String,Pipeline.Routed>(32,.75f,true) { override fun removeEldestEntry(e:MutableMap.MutableEntry<String,Pipeline.Routed>?)=size>24 }
    private val snapshots = AnalysisHandoff<Pipeline.Analysis>(24) {it.revision}
    // Render OCR is confirmation only; it must not queue behind CTD/BubbleSeg.
    // JS admission already prevents two foreground native stages from overlapping.
    private val renderPipeline by lazy {Pipeline(context,store,InferenceWork.CONFIRM,renderOnly=true)}
    private data class Refinement(val path: String, val byId: Map<String, String>, val leave: Set<String>, val page: PriorityGate.Page?, val output: File, val version: Long, val lettering: Map<String, LetteringStyle>)
    private val pendingRefinement = java.util.concurrent.atomic.AtomicReference<Refinement?>()
    private val renderVersion = java.util.concurrent.atomic.AtomicLong()
    private val activeRefinement = java.util.concurrent.atomic.AtomicReference<InferenceBudget?>()
    private val refinementRunning = java.util.concurrent.atomic.AtomicBoolean()

    /** At most one active + one pending request; never retain 100 decoded pages or publish stale work. */
    private fun refine(request: Refinement) {
        pendingRefinement.set(request)
        if (!refinementRunning.compareAndSet(false, true)) return
        scope.launch {
            try {
                while (true) {
                    val next = pendingRefinement.getAndSet(null) ?: break
                    val budget = InferenceBudget(2000)
                    activeRefinement.set(budget)
                    try {
                        val perf = Perf()
                        renderGate.run(PriorityGate.BACKGROUND, perf, next.page) {
                            if (renderVersion.get() != next.version) return@run
                            Ort.withBudget(budget) {
                                val tempDir = File(context.cacheDir, "translation-refinement")
                                val (refined, count) = renderPipeline.render(File(next.path), next.byId, tempDir, perf, next.leave, refinement = true, lettering = next.lettering)
                                budget.check()
                                if (count == next.byId.size && renderVersion.get() == next.version) {
                                    // Same filesystem, atomic replacement; failure never downgrades the accepted preview.
                                    val destination=File(outDir,refined.name)
                                    java.nio.file.Files.move(refined.toPath(), destination.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
                                    notifyListeners("refinementReady", JSObject().put("path", destination.absolutePath).put("previewPath",next.output.absolutePath).put("perf", perfJs(perf, 0)))
                                } else refined.delete()
                            }
                        }
                    } catch (_: Throwable) { /* The visible accepted page remains. */ }
                    finally { activeRefinement.compareAndSet(budget, null) }
                }
            } finally {
                refinementRunning.set(false)
                pendingRefinement.getAndSet(null)?.let { refine(it) }
            }
        }
    }

    /** «high»: الصفحة أمام القارئ. غيرها (الترجمة المقدّمة، الإكمال) بعدها. */
    private fun high(call: PluginCall) = call.getString("priority", "high") != "low"

    /** موضع الصفحة في فصلها (من القارئ): دورها بالمسافة من صفحتك الآن. */
    private fun pageOf(call: PluginCall): PriorityGate.Page? {
        val chapter = call.getString("chapterKey") ?: return null
        val index = call.getInt("pageIndex") ?: return null
        return PriorityGate.Page(chapter, index)
    }

    /** القارئ على هذه الصفحة الآن: ما أمامها يتقدّم في الدور. */
    @PluginMethod
    fun focusPage(call: PluginCall) {
        val chapter = call.getString("chapterKey")
        val index = call.getInt("pageIndex")
        activeRefinement.get()?.cancel()
        val page=if (chapter != null && index != null) PriorityGate.Page(chapter,index) else null
        val count = call.getInt("pageCount")
        gate.focus(page,count); detectGate.focus(page,count); renderGate.focus(page,count)
        call.resolve()
    }

    /** Luna لم تُنتج Render لهذه الصفحة؛ حرّر حجزها حتى لا يتوقف Analyze التالي. */
    @PluginMethod
    fun releasePageReservation(call: PluginCall) {
        gate.cancelExpectedRender(pageOf(call))
        call.resolve()
    }
    private val http by lazy { OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build() }
    private val store by lazy { ModelStore(context) }
    private val pipeline by lazy { Pipeline(context, store) }
    /** Detector owner is independent; at most one detector request executes at once. */
    private val probePipeline by lazy { Pipeline(context, store,InferenceWork.CONFIRM) }
    // في مجلد الملفات لا الكاش: «تحسين الجهاز» في سامسونج يفرغ الكاش، فتعود الصفحات إنجليزية
    // وتُترجم من جديد. الحجم مسقوف في [Pipeline.publish]
    private val outDir by lazy { File(context.filesDir, "translated-pages") }
    private val diagnosticDir by lazy { File(context.cacheDir, "translation-diagnostics") }

    private fun status(): JSObject {
        val files = JSArray()
        for (f in store.files()) files.put(JSObject().put("name", f.name).put("bytes", f.bytes).put("present", f.present))
        return JSObject()
            .put("installed", store.isInstalled())
            .put("version", store.installedVersion())
            .put("latestVersion", ModelStore.VERSION)
            .put("bytes", store.installedBytes())
            .put("expectedBytes", ModelStore.EXPECTED_BYTES)
            .put("files", files)
    }

    @PluginMethod
    fun models(call: PluginCall) = call.resolve(status())

    @PluginMethod
    fun downloadModels(call: PluginCall) {
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    store.download(http) { received, total, file ->
                        notifyListeners("modelsProgress", JSObject().put("received", received).put("total", total).put("file", file))
                    }
                }
                call.resolve(status())
            } catch (t: Throwable) {
                call.reject(t.message ?: "download failed", t.javaClass.simpleName)
            }
        }
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        store.cancel()
        call.resolve()
    }

    @PluginMethod
    fun removeModels(call: PluginCall) {
        scope.launch {
            pipeline.unload()
            probePipeline.unload(); renderPipeline.unload()
            synchronized(routedPages) {routedPages.clear()};snapshots.clear()
            withContext(Dispatchers.IO) { store.remove() }
            call.resolve(status())
        }
    }

    @PluginMethod
    fun routePage(call:PluginCall) {
        val path=call.getString("path") ?: return call.reject("path required")
        scope.launch {
            try {
                val perf=Perf()
                val a=detectGate.run(PriorityGate.DETECT,perf,pageOf(call)) {probePipeline.route(File(path),perf)}
                synchronized(routedPages) {routedPages[a.pageHash]=a}
                call.resolve(JSObject().put("pageHash",a.pageHash).put("width",a.width).put("height",a.height).put("textless",a.textless).put("perf",perfJs(perf,0)))
            } catch(t:Throwable) {call.reject(t.message ?: "route failed")}
        }
    }

    @PluginMethod
    fun analyzePage(call: PluginCall) {
        if (high(call)) activeRefinement.get()?.cancel()
        val path = call.getString("path") ?: return call.reject("path required")
        scope.launch {
            try {
                val file = File(path)
                require(file.exists()) { "page file missing" }
                val perf = Perf()
                val thermalWait = coolDown(perf)
                val page = pageOf(call)

                val supplied=call.getString("routeHash")?.let { synchronized(routedPages) {routedPages.remove(it)} }
                    ?.takeIf { it.pageHash==perf.time("routeHash") {ModelStore.sha256Hex(file.readBytes())} }
                val routed=supplied ?: detectGate.run(PriorityGate.DETECT,perf,page) {probePipeline.route(file,perf)}
                perf.count(if(supplied!=null) "detectReused" else "detectLane")
                val (a,thumb)=if(routed.textless) {
                    perf.count("textless")
                    Pipeline.Analysis(routed.pageHash,routed.width,routed.height,emptyList(),emptyList()) to ""
                } else gate.run(if(high(call)) PriorityGate.ANALYZE_READER else PriorityGate.ANALYZE_JOB,perf,page) {
                    synchronized(snapshots) {snapshots[routed.pageHash]}?.let {pipeline.acceptAnalysis(it)}
                    pipeline.finishForLuna(file,perf,routed)
                }
                // Snapshot is compressed/immutable; rendering has its own owner and model sessions.
                synchronized(snapshots) {snapshots[a.pageHash]=a}
                val regions = JSArray()
                for (r in a.regions) {
                    regions.put(
                        JSObject()
                            .put("id", r.id)
                            .put("box", JSArray().put(r.box.x1).put(r.box.y1).put(r.box.x2).put(r.box.y2))
                            .put("score", r.score.toDouble())
                            .put("kind", r.kind)
                            .put("source", r.source)
                            .put("status", r.status)
                            .put("ocrConfidence", (r.ocr?.confidence ?: 0f).toDouble())
                            .put("inkLight", r.inkLight),
                    )
                }
                // صفحة فيها ما يُسأل عنه: نموذج التبييض يُحمَّل الآن في الخلفية (دور منخفض) فيجهز
                // قبل أن يعود رد Luna، لا حين تنتظره الصفحة
                if (thumb.isNotEmpty() && !renderPipeline.inpainterReady()) {
                    scope.launch(Dispatchers.IO) { runCatching { renderPipeline.warmInpainter(Perf()) } }
                }
                call.resolve(
                    JSObject()
                        .put("pageHash", a.pageHash)
                        .put("width", a.width)
                        .put("height", a.height)
                        .put("thumbnail", thumb)
                        .put("regions", regions)
                        .put("perf", perfJs(perf, thermalWait)),
                )
            } catch (t: Throwable) {
                call.reject(t.message ?: "analyze failed", t.javaClass.simpleName)
            }
        }
    }

    @PluginMethod
    fun renderPage(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val regions = call.getArray("regions") ?: return call.reject("regions required")
        val version = renderVersion.incrementAndGet()
        activeRefinement.get()?.cancel()
        scope.launch {
            try {
                val byId = HashMap<String, String>()
                val lettering = HashMap<String, LetteringStyle>()
                for (i in 0 until regions.length()) {
                    val o = regions.getJSONObject(i)
                    val id = o.optString("id", "")
                    val ar = o.optString("arabic", "")
                    if (id.isNotEmpty() && ar.isNotEmpty()) {
                        byId[id] = ar
                        val style = o.optJSONObject("lettering")
                        val spans = style?.optJSONArray("emphasis")
                        lettering[id] = LetteringStyle.normalize(style?.optString("role"),style?.optString("ink"),style?.optString("intensity"),
                            if (spans == null) emptyList() else (0 until minOf(3,spans.length())).map { spans.optString(it) },ar)
                    }
                }
                // ما قالت Luna إنه مؤثر أو حقوق أو لافتة: يبقى أصله عمدًا، وليس نقصًا في فقاعته
                val leave = HashSet<String>()
                call.getArray("leave")?.let { for (i in 0 until it.length()) leave.add(it.getString(i)) }
                val perf = Perf()
                val thermalWait = coolDown(perf)
                val file=File(path)
                val hash=perf.time("handoffHash") {ModelStore.sha256Hex(file.readBytes())}
                // Pin this compressed snapshot while awaiting render. Cache eviction never starts CTD in the renderer.
                val snapshot=snapshots[hash] ?: gate.run(if(high(call)) PriorityGate.ANALYZE_READER else PriorityGate.ANALYZE_JOB,perf,pageOf(call)) {
                    pipeline.finishForLuna(file,perf).first
                }
                val (out, translated) = renderGate.run(if (high(call)) PriorityGate.RENDER_READER else PriorityGate.RENDER_JOB, perf, pageOf(call)) {
                    renderPipeline.acceptAnalysis(snapshot)
                    val result=renderPipeline.render(file, byId, outDir, perf, leave, lettering = lettering)
                    // Heavy residual promotion must survive the next retry and owner handoff.
                    renderPipeline.analysisSnapshot(hash)?.let { synchronized(snapshots) {snapshots[hash]=it} }
                    result
                }
                call.resolve(JSObject().put("path", out.absolutePath).put("translated", translated).put("perf", perfJs(perf, thermalWait)))
                if ((perf.counts["refinementPending"] ?: 0) > 0) refine(Refinement(path, byId.toMap(), leave.toSet(), pageOf(call), out, version, lettering.toMap()))
            } catch (t: Throwable) {
                call.reject(t.message ?: "render failed", t.javaClass.simpleName)
            }
        }
    }

    /**
     * تشخيص التبييض على الصفحة نفسها: يعيد تشغيل نماذج أندرويد الحالية ثم
     * يحفظ صورة بعد المسح وقبل العربي. لا يمس كاش القارئ.
     */
    @PluginMethod
    fun diagnoseCleaning(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val regions = call.getArray("regions") ?: return call.reject("regions required")
        scope.launch {
            try {
                val file = File(path)
                require(file.exists()) { "page file missing" }
                val byId = HashMap<String, String>()
                for (i in 0 until regions.length()) {
                    val o = regions.getJSONObject(i)
                    val id = o.optString("id", "")
                    val ar = o.optString("arabic", "")
                    if (id.isNotEmpty() && ar.isNotEmpty()) byId[id] = ar
                }
                val leave = HashSet<String>()
                call.getArray("leave")?.let { for (i in 0 until it.length()) leave.add(it.getString(i)) }
                val perf = Perf()
                val thermalWait = coolDown(perf)
                val probe = gate.run(PriorityGate.BACKGROUND, perf, pageOf(call)) {
                    pipeline.diagnoseCleaning(file, byId, diagnosticDir, perf, leave)
                }
                call.resolve(
                    JSObject()
                        .put("path", probe.file.absolutePath)
                        .put("width", probe.width)
                        .put("height", probe.height)
                        .put("fullWidth", probe.fullWidth)
                        .put("fullHeight", probe.fullHeight)
                        .put("cleanedRegions", probe.cleanedRegions)
                        .put("perf", perfJs(perf, thermalWait)),
                )
            } catch (t: Throwable) {
                call.reject(t.message ?: "cleaning diagnostic failed", t.javaClass.simpleName)
            }
        }
    }

    /**
     * القديم مقابل الجديد على هذا الجوال: الصفحة نفسها بالطريقين من الصفر، زمن كل
     * مرحلة لكلٍّ منهما، وهل الناتج متطابق بكسلًا بكسلًا.
     */
    @PluginMethod
    fun benchmarkPage(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        val regions = call.getArray("regions") ?: JSArray()
        scope.launch {
            try {
                val file = File(path)
                require(file.exists()) { "page file missing" }
                val byId = HashMap<String, String>()
                for (i in 0 until regions.length()) {
                    val o = regions.getJSONObject(i)
                    val id = o.optString("id", "")
                    val ar = o.optString("arabic", "")
                    if (id.isNotEmpty() && ar.isNotEmpty()) byId[id] = ar
                }
                val b = gate.run(PriorityGate.BACKGROUND, Perf()) { pipeline.benchmark(file, byId) }
                call.resolve(JSObject().put("legacy", perfJs(b.legacy, 0)).put("current", perfJs(b.current, 0)).put("identical", b.identical))
            } catch (t: Throwable) {
                call.reject(t.message ?: "benchmark failed", t.javaClass.simpleName)
            }
        }
    }

    /** إعدادات المحرك على هذا الجوال: الزمن ومطابقة الناتج لكل إعداد (انظر [Pipeline.engineBenchmark]). */
    @PluginMethod
    fun benchmarkEngines(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        scope.launch {
            try {
                val file = File(path)
                require(file.exists()) { "page file missing" }
                val results = gate.run(PriorityGate.BACKGROUND, Perf()) { pipeline.engineBenchmark(file) }
                val arr = JSArray()
                for (r in results) {
                    arr.put(
                        JSObject().put("name", r.name).put("loadMs", r.loadMs).put("glyphsMs", r.glyphsMs).put("bubblesMs", r.bubblesMs)
                            .put("glyphDiff", r.glyphDiff).put("glyphPixels", r.glyphPixels).put("bubblesSame", r.bubblesSame).put("bubbles", r.bubbles).put("error", r.error),
                    )
                }
                call.resolve(JSObject().put("engines", arr).put("cores", Runtime.getRuntime().availableProcessors()).put("thermal", thermal()))
            } catch (t: Throwable) {
                call.reject(t.message ?: "benchmark failed", t.javaClass.simpleName)
            }
        }
    }

    /** حرارة الجوال (0 لا شيء … 6 إيقاف). */
    private fun thermal(): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1
        val pm = context.getSystemService(android.content.Context.POWER_SERVICE) as? android.os.PowerManager ?: return -1
        return pm.currentThermalStatus
    }

    /**
     * الجوال ساخن جدًا (SEVERE فأعلى): مهلة قصيرة قبل الصفحة بدل خنقه حتى يبطئ
     * كل شيء. يرجع زمن الانتظار.
     */
    private suspend fun coolDown(perf: Perf): Long {
        var waited = 0L
        while (waited < 6_000 && thermal() >= 3) {
            kotlinx.coroutines.delay(1_500)
            waited += 1_500
        }
        if (waited > 0) perf.add("thermalWait", waited * 1_000_000)
        return waited
    }

    private fun perfJs(perf: Perf, thermalWait: Long): JSObject {
        val stages = JSObject()
        for ((k, v) in perf.millis()) stages.put(k, v)
        val counts = JSObject()
        for ((k, v) in perf.counts) counts.put(k, v)
        val mem = android.app.ActivityManager.MemoryInfo()
        (context.getSystemService(android.content.Context.ACTIVITY_SERVICE) as? android.app.ActivityManager)?.getMemoryInfo(mem)
        val gcCount = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) runCatching { android.os.Debug.getRuntimeStat("art.gc.gc-count")?.toLongOrNull() }.getOrNull() else null
        val gcTimeMs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) runCatching { android.os.Debug.getRuntimeStat("art.gc.gc-time")?.toLongOrNull() }.getOrNull() else null
        val blockingGcCount = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) runCatching { android.os.Debug.getRuntimeStat("art.gc.blocking-gc-count")?.toLongOrNull() }.getOrNull() else null
        val blockingGcTimeMs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) runCatching { android.os.Debug.getRuntimeStat("art.gc.blocking-gc-time")?.toLongOrNull() }.getOrNull() else null
        return JSObject()
            .put("stages", stages)
            .put("counts", counts)
            .put("ctd", runCatching { pipeline.ctdVariant() }.getOrDefault("?"))
            .put("thermal", thermal())
            .put("thermalWaitMs", thermalWait)
            .put("busyPct", gate.busyPercent())
            .put("laneBusy",JSObject().put("detect",detectGate.busyPercent()).put("analyze",gate.busyPercent()).put("render",renderGate.busyPercent()))
            .put("lowMemory", mem.lowMemory)
            .put("availMemMb", mem.availMem / (1024 * 1024))
            .put("totalMemMb", mem.totalMem / (1024 * 1024))
            .put("heapMb", (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / (1024 * 1024))
            .put("heapLimitMb", Runtime.getRuntime().maxMemory() / (1024 * 1024))
            .put("gcCount", gcCount)
            .put("gcTimeMs", gcTimeMs)
            .put("blockingGcCount", blockingGcCount)
            .put("blockingGcTimeMs", blockingGcTimeMs)
    }

    /** الترجمة المقدّمة: يبدأ الخدمة الأمامية أو يحدّث إشعار التقدّم. */
    @PluginMethod
    fun jobProgress(call: PluginCall) {
        TranslationJobService.update(context, call.getString("title") ?: "VANTARA", call.getString("text") ?: "", call.getInt("done") ?: 0, call.getInt("total") ?: 0)
        call.resolve()
    }

    @PluginMethod
    fun jobFinished(call: PluginCall) {
        TranslationJobService.finished(context, call.getString("title") ?: "VANTARA", call.getString("text") ?: "")
        call.resolve()
    }

    @PluginMethod
    fun jobStop(call: PluginCall) {
        TranslationJobService.stop(context)
        call.resolve()
    }

    /** أندرويد 13+: الإشعارات تحتاج إذنًا. يطلبه مرة ويرجع الحالة الحالية. */
    @PluginMethod
    fun notificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return call.resolve(JSObject().put("granted", true))
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        if (!granted) activity?.let { ActivityCompat.requestPermissions(it, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7303) }
        call.resolve(JSObject().put("granted", granted))
    }
}
