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

    /** «high»: الصفحة أمام القارئ. غيرها (الترجمة المقدّمة، الإكمال) بعدها. */
    private fun high(call: PluginCall) = call.getString("priority", "high") != "low"
    private val http by lazy { OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS).build() }
    private val store by lazy { ModelStore(context) }
    private val pipeline by lazy { Pipeline(context, store) }
    private val outDir by lazy { File(context.cacheDir, "translated-pages") }

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
            withContext(Dispatchers.IO) { store.remove() }
            call.resolve(status())
        }
    }

    @PluginMethod
    fun analyzePage(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path required")
        scope.launch {
            try {
                val file = File(path)
                require(file.exists()) { "page file missing" }
                val perf = Perf()
                val thermalWait = coolDown(perf)
                val done = gate.run(PriorityGate.DETECT, perf) { pipeline.detectStage(file, perf) }
                val (a, thumb) = if (done != null) {
                    done to ""
                } else {
                    gate.run(if (high(call)) PriorityGate.ANALYZE_READER else PriorityGate.ANALYZE_JOB, perf) { pipeline.finishForLuna(file, perf) }
                }
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
                if (thumb.isNotEmpty() && !pipeline.inpainterReady()) {
                    scope.launch(Dispatchers.IO) { runCatching { pipeline.warmInpainter(Perf()) } }
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
        scope.launch {
            try {
                val byId = HashMap<String, String>()
                for (i in 0 until regions.length()) {
                    val o = regions.getJSONObject(i)
                    val id = o.optString("id", "")
                    val ar = o.optString("arabic", "")
                    if (id.isNotEmpty() && ar.isNotEmpty()) byId[id] = ar
                }
                // ما قالت Luna إنه مؤثر أو حقوق أو لافتة: يبقى أصله عمدًا، وليس نقصًا في فقاعته
                val leave = HashSet<String>()
                call.getArray("leave")?.let { for (i in 0 until it.length()) leave.add(it.getString(i)) }
                val perf = Perf()
                val thermalWait = coolDown(perf)
                val (out, translated) = gate.run(if (high(call)) PriorityGate.RENDER_READER else PriorityGate.RENDER_JOB, perf) {
                    pipeline.render(File(path), byId, outDir, perf, leave)
                }
                call.resolve(JSObject().put("path", out.absolutePath).put("translated", translated).put("perf", perfJs(perf, thermalWait)))
            } catch (t: Throwable) {
                call.reject(t.message ?: "render failed", t.javaClass.simpleName)
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
                            .put("glyphDiff", r.glyphDiff).put("glyphPixels", r.glyphPixels).put("bubblesSame", r.bubblesSame).put("bubbles", r.bubbles),
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
        return JSObject()
            .put("stages", stages)
            .put("counts", counts)
            .put("ctd", runCatching { pipeline.ctdVariant() }.getOrDefault("?"))
            .put("thermal", thermal())
            .put("thermalWaitMs", thermalWait)
            .put("busyPct", gate.busyPercent())
            .put("lowMemory", mem.lowMemory)
            .put("heapMb", (Runtime.getRuntime().totalMemory() - Runtime.getRuntime().freeMemory()) / (1024 * 1024))
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
