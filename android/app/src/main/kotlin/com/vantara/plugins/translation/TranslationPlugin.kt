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
 *   analyzePage({ path, sourceLang }) → { pageHash, width, height, thumbnail, regions }
 *   renderPage({ path, regions: [{ id, arabic }] }) → { path, translated }
 *
 *   jobProgress({ title, text, done, total }) / jobFinished({ title, text }) / jobStop()
 *   notificationPermission() → { granted }
 *
 * الرؤية والتبييض والرسم كلها هنا؛ Luna من JavaScript عبر sync-worker.
 */
@CapacitorPlugin(name = "Translation")
class TranslationPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
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
                val a = pipeline.analyze(file)
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
                call.resolve(
                    JSObject()
                        .put("pageHash", a.pageHash)
                        .put("width", a.width)
                        .put("height", a.height)
                        .put("thumbnail", pipeline.thumbnail(file))
                        .put("regions", regions),
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
                val (out, translated) = pipeline.render(File(path), byId, outDir)
                call.resolve(JSObject().put("path", out.absolutePath).put("translated", translated))
            } catch (t: Throwable) {
                call.reject(t.message ?: "render failed", t.javaClass.simpleName)
            }
        }
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
