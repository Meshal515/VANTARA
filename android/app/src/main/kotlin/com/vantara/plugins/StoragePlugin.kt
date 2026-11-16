package com.vantara.plugins

import android.content.Context
import android.os.StatFs
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.anime.player.MediaCache
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

/**
 * إدارة المساحة: كم يأخذ VANTARA من الجوال، مقسومًا بفئات مفهومة، وما يحدث لو حُذفت كل فئة. لا يُحذف شيء إلا
 * ما اختاره المستخدم بعد أن رأى اسمه وحجمه وأثره. ومعه تقليم تلقائي للكاش الذي كان بلا سقف:
 *
 *  - `cache/pages`: كل صفحة مانجا قُرئت من الإنترنت، بلا حد ولا تنظيف (كان يكبر بلا نهاية).
 *  - `cache/torrent-streams`: بقايا بث التورنت؛ تُنظَّف فقط والمحرك يعمل، فإغلاق التطبيق وسط حلقة كان يترك
 *    مجلدها (حتى 8GB) حتى يُشغَّل تورنت مرة أخرى.
 *
 * الفئات بمساراتها هنا وحدها؛ الواجهة تعرض ما يرجع ولا تعرف المسارات.
 */
@CapacitorPlugin(name = "VantaraStorage")
class StoragePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** فئة: مساراتها، وهل هي كاش يُعاد بناؤه، وما يحدث بحذفها. */
    private data class Kind(
        val id: String,
        val label: String,
        val effect: String,
        val cache: Boolean,
        val deletable: Boolean = true,
        /** يُحذف فقط وما من مشغّل مفتوح يقرأ منه. */
        val needsIdlePlayer: Boolean = false,
        val paths: (Context) -> List<File>,
    )

    private val kinds = listOf(
        Kind("torrentStreams", "بقايا بث التورنت", "أجزاء حلقات شاهدتها بالتورنت. لا تحتاجها؛ الحلقة تُبث من جديد إن فتحتها.", cache = true, needsIdlePlayer = true) { listOf(File(it.cacheDir, "torrent-streams")) },
        Kind("playerCache", "كاش المشغّل", "مقاطع الفيديو المؤقتة والمقاطع المقصوصة غير المحفوظة.", cache = true, needsIdlePlayer = true) { listOf(File(it.cacheDir, "anime-media"), File(it.cacheDir, "clips")) },
        Kind("mangaPages", "صفحات المانجا المؤقتة", "صور الفصول التي قرأتها من الإنترنت. تُجلب من جديد عند القراءة؛ الفصول المحمّلة لا تتأثر.", cache = true) { listOf(File(it.cacheDir, "pages")) },
        Kind("translatedPages", "صفحات الترجمة المحفوظة", "صفحات مانجا ترجمها جهازك. تُترجم من جديد إن فتحتها مرة أخرى.", cache = true) { listOf(File(it.filesDir, "translated-pages"), File(it.cacheDir, "translation-diagnostics"), File(it.cacheDir, "translation-refinement")) },
        Kind("webCache", "كاش الواجهة والصور", "أغلفة وصور الواجهة المؤقتة. حسابك ومكتبتك وتحميلاتك لا تتأثر.", cache = true) { ctx ->
            listOf(File(ctx.cacheDir, "WebView"), File(ctx.cacheDir, "network_cache"), File(ctx.cacheDir, "stage-art"), File(ctx.cacheDir, "extension-icons"), File(ctx.cacheDir, "anime-skip-times"),
                File(ctx.dataDir, "app_webview/Default/HTTP Cache"), File(ctx.dataDir, "app_webview/Default/Code Cache"), File(ctx.dataDir, "app_webview/Default/GPUCache"))
        },
        Kind("updates", "ملفات التحديث", "ملفات تحديث نُزّلت وثُبّتت. لا حاجة لها بعد التثبيت.", cache = true) { listOf(File(it.cacheDir, "updates")) },
        Kind("covers", "أغلفة المكتبة المحفوظة", "تُعرض بها مكتبتك بلا إنترنت. تُجلب من جديد عند الاتصال.", cache = false) { listOf(File(it.filesDir, "covers")) },
        Kind("translationModels", "نماذج الترجمة المحلية", "تشغّل الترجمة المرئية على الجهاز. بحذفها تتوقف حتى تُنزّلها من جديد (حجمها كبير).", cache = false) { listOf(File(it.filesDir, "translation-models")) },
        Kind("videoDownloads", "الحلقات والأفلام المحمّلة", "ما نزّلته لتشاهده بلا إنترنت. يُدار من «التحميلات».", cache = false, deletable = false) { ctx ->
            listOf(File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "VANTARA/Downloads"))
        },
        Kind("savedClips", "المقاطع المحفوظة", "مقاطع حفظتها من المشغّل.", cache = false, deletable = false) { ctx ->
            listOfNotNull(ctx.getExternalFilesDir(android.os.Environment.DIRECTORY_MOVIES)?.let { File(it, "VANTARA") })
        },
        Kind("extensions", "الإضافات والمصادر", "ملفات الإضافات المثبتة. تُدار من «الإضافات».", cache = false, deletable = false) { listOf(File(it.filesDir, "extensions"), File(it.filesDir, "anime-extensions")) },
    )

    override fun load() {
        // تقليم عند الإقلاع: العملية جديدة فلا بث تورنت قائم، فكل مجلد في torrent-streams بقايا جلسة انتهت
        scope.launch { runCatching { trim(context) } }
    }

    @PluginMethod
    fun report(call: PluginCall) {
        scope.launch {
            try {
                val ctx = context
                val list = JSArray()
                var known = 0L
                for (k in kinds) {
                    val bytes = k.paths(ctx).sumOf(::sizeOf)
                    known += bytes
                    list.put(JSObject().put("id", k.id).put("label", k.label).put("effect", k.effect).put("bytes", bytes)
                        .put("cache", k.cache).put("deletable", k.deletable).put("busy", k.needsIdlePlayer && MediaCache.inUse()))
                }
                val dataTotal = sizeOf(ctx.dataDir)
                val externalTotal = ctx.getExternalFilesDir(null)?.parentFile?.let(::sizeOf) ?: 0L
                val counted = listOf("videoDownloads", "savedClips").sumOf { id -> kinds.first { it.id == id }.paths(ctx).sumOf(::sizeOf) }
                // البقية: قاعدة بيانات الواجهة (المانجا المحمّلة والمكتبة دون اتصال)، والإعدادات، وحزمة الواجهة
                val other = (dataTotal + externalTotal - known).coerceAtLeast(0L)
                val stat = StatFs(ctx.filesDir.absolutePath)
                call.resolve(JSObject()
                    .put("deviceTotal", stat.totalBytes).put("deviceFree", stat.availableBytes)
                    .put("appTotal", dataTotal + externalTotal).put("apkBytes", runCatching { File(ctx.applicationInfo.sourceDir).length() }.getOrDefault(0L))
                    .put("other", other).put("kinds", list).put("countedExternal", counted))
            } catch (t: Throwable) {
                call.reject(t.message ?: t.javaClass.simpleName)
            }
        }
    }

    /** يحذف الفئات المختارة وحدها؛ ما لا يُحذف أو مشغوله يُتخطى بسببه. */
    @PluginMethod
    fun clear(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>().orEmpty().toSet()
        scope.launch {
            var freed = 0L
            val skipped = JSArray()
            for (k in kinds) {
                if (k.id !in ids) continue
                if (!k.deletable) { skipped.put(JSObject().put("id", k.id).put("reason", "يُدار من مكانه")); continue }
                if (k.needsIdlePlayer && MediaCache.inUse()) { skipped.put(JSObject().put("id", k.id).put("reason", "المشغّل مفتوح؛ أغلقه ثم احذف")); continue }
                for (dir in k.paths(context)) freed += clearDir(dir, keep = if (k.id == "torrentStreams") setOf(DHT_STATE) else emptySet())
            }
            if ("webCache" in ids) activity?.runOnUiThread { runCatching { bridge.webView.clearCache(true) } }
            call.resolve(JSObject().put("freed", freed).put("skipped", skipped))
        }
    }

    companion object {
        private const val DHT_STATE = "dht.state"
        /** سقف صفحات المانجا المؤقتة: الأقدم استعمالًا يُترك أولًا. */
        const val PAGE_CACHE_CAP = 600L * 1024 * 1024
        private const val TRANSLATED_CAP = 300L * 1024 * 1024

        fun sizeOf(f: File): Long = runCatching {
            if (!f.exists()) 0L else if (f.isFile) f.length() else f.walkTopDown().onFail { _, _ -> }.filter { it.isFile }.sumOf { it.length() }
        }.getOrDefault(0L)

        /** يفرغ المجلد (لا يحذفه: المحركات تتوقع وجوده). يرجع ما تحرّر. */
        fun clearDir(dir: File, keep: Set<String> = emptySet()): Long {
            var freed = 0L
            dir.listFiles()?.forEach { f ->
                if (f.name in keep) return@forEach
                val size = sizeOf(f)
                if (f.deleteRecursively()) freed += size
            }
            return freed
        }

        /** يُبقي أحدث الملفات حتى السقف ويحذف الأقدم (بتاريخ آخر تعديل/استعمال). */
        fun capDir(dir: File, cap: Long): Long {
            val files = dir.listFiles()?.filter { it.isFile }?.sortedByDescending { it.lastModified() } ?: return 0L
            var kept = 0L
            var freed = 0L
            for (f in files) {
                val n = f.length()
                if (kept + n <= cap) kept += n else if (f.delete()) freed += n
            }
            return freed
        }

        /** التقليم التلقائي: ما كان بلا سقف يُسقَّف، وبقايا بث تورنت من جلسة سابقة تُحذف. */
        fun trim(context: Context) {
            if (!MediaCache.inUse()) clearDir(File(context.cacheDir, "torrent-streams"), keep = setOf(DHT_STATE))
            capDir(File(context.cacheDir, "pages"), PAGE_CACHE_CAP)
            capDir(File(context.filesDir, "translated-pages"), TRANSLATED_CAP)
        }
    }
}
