package com.vantara.downloads

import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.content.Context
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.vantara.anime.AnimeEngine
import com.vantara.anime.stream.Candidate
import com.vantara.anime.stream.Container
import com.vantara.anime.stream.TrackRef
import com.vantara.plugins.ensureEngineInjekt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.io.File

/**
 * جسر التنزيلات الأصلي (`VantaraDownloads`): الواجهة تقرر ماذا ومتى، وهنا الفحص والنقل والتشغيل المحلي.
 *
 *   inspect  : فحص المرشّح قبل الحفظ (الحاوية، الحجم، الاستئناف، الحماية) — لا يبدأ تنزيلًا.
 *   start    : يبدأ أو يستأنف عملًا في الخدمة الأمامية. رابط جديد من السيرفر نفسه يكمل الجزئي؛
 *              من سيرفر آخر يبدأ ملفًا جديدًا (لا خلط بايتات مصدرين).
 *   pause / cancel / remove : إيقاف يحفظ الجزئي / إلغاء يحذفه / حذف ما على الجهاز.
 *   play     : تشغيل الملف المحفوظ بالمشغّل نفسه، بلا شبكة ولا مصدر.
 *   حدث progress : {id, state, bytes, total, ...} لكل تغيّر.
 */
@CapacitorPlugin(name = "VantaraDownloads")
class DownloadsPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var engine: AnimeEngine
    private val forward: (DownloadJob) -> Unit = { job -> notifyListeners("progress", event(job)) }
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    override fun load() {
        ensureEngineInjekt(context.applicationContext as Application)
        engine = AnimeEngine.get(context)
        DownloadService.listeners.add(forward)
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                notifyListeners("network", networkInfo())
            }
            override fun onLost(network: Network) { notifyListeners("network", networkInfo()) }
        }.also { runCatching { cm.registerDefaultNetworkCallback(it) } }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        DownloadService.resumeQueued(context)
    }

    override fun handleOnDestroy() {
        DownloadService.listeners.remove(forward)
        networkCallback?.let { cb -> runCatching { (context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb) } }
        scope.cancel()
    }

    private fun event(job: DownloadJob) = JSObject()
        .put("id", job.id).put("state", job.state).put("bytes", job.bytes).put("total", job.total)
        .put("segmentsDone", job.segmentsDone).put("segmentsTotal", job.segmentsTotal)
        .put("code", job.error).put("message", job.message).put("verified", job.verified).put("peers", job.peers)
        .put("packageComplete", job.resourcesComplete).put("resourcesRetryAt", job.resourcesRetryAt)
        .apply {
            if (job.state == "ready") {
                val dir = DownloadService.store(context).dir(job.id)
                put("path", job.main?.let { File(dir, it).absolutePath })
                put("location", "Android/data/${context.packageName}/files/VANTARA/Downloads")
                put("media", JSObject()
                    .put("container", job.container)
                    .put("packageComplete", job.resourcesComplete)
                    .put("subtitles", JSArray(job.subtitles.map { JSObject().put("lang", it.lang).put("label", it.label).put("saved", it.file != null) }))
                    .put("audio", JSArray(job.audio.map { JSObject().put("lang", it.lang).put("label", it.label).put("saved", it.file != null) })))
            }
        }

    private fun networkInfo(): JSObject {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        return JSObject()
            .put("online", caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true)
            .put("metered", cm.isActiveNetworkMetered)
    }

    @PluginMethod
    fun network(call: PluginCall) = call.resolve(networkInfo())

    @PluginMethod
    fun capabilities(call: PluginCall) {
        val root = DownloadService.root(context).apply { mkdirs() }
        call.resolve(JSObject().put("video", true).put("torrent", com.vantara.addons.torrent.TorrentEngine.nativeAvailable())
            .put("freeBytes", Transfers.freeBytes(root)).put("location", "Android/data/${context.packageName}/files/VANTARA/Downloads"))
    }

    private fun candidateOf(session: String, id: String): Candidate? =
        engine.prepared(session)?.candidate(id) ?: engine.session(session)?.let { engine.sessionCandidate(it, id) }

    private fun isTorrent(c: Candidate) = c.url.startsWith("vantara-torrent:") || c.url.startsWith("magnet:")

    /** طلب التورنت من المرشّح: تذكرة البث (من الإضافة) أو رابط magnet مباشر. */
    private fun torrentRequest(c: Candidate): com.vantara.addons.torrent.TorrentRequest? = runCatching {
        if (c.url.startsWith("magnet:")) com.vantara.anime.stream.MagnetLinks.request(c.url)
        else com.vantara.addons.torrent.TorrentEngine.get(context).requestOf(android.net.Uri.parse(c.url))
    }.getOrNull()

    /** فحص المرشّح قبل التنزيل. لا يكتب شيئًا على القرص. */
    @PluginMethod
    fun inspect(call: PluginCall) {
        val session = call.getString("session") ?: return call.reject("session مطلوب")
        val id = call.getString("candidate") ?: return call.reject("candidate مطلوب")
        scope.launch {
            try {
                val c = candidateOf(session, id) ?: return@launch call.reject("انتهت جلسة السيرفر")
                val out = JSObject().put("quality", c.quality).put("sourceId", c.sourceId)
                    .put("subtitles", JSArray(c.subtitles.map { it.lang })).put("audio", JSArray(c.audio.map { it.lang }))
                if (isTorrent(c)) {
                    val request = torrentRequest(c)
                    if (request == null || !com.vantara.addons.torrent.TorrentEngine.nativeAvailable()) {
                        call.resolve(out.put("container", "UNKNOWN").put("error", "UNSUPPORTED").put("reason", "محرك التورنت غير متاح لهذا الاختيار على هذا الجهاز"))
                        return@launch
                    }
                    // الحجم يُعرف من بيانات التورنت عند البدء؛ القطع يُتحقق منها ويُستأنف منها
                    call.resolve(out.put("container", "TORRENT").put("transport", "torrent").put("resumable", true).put("size", c.videoSize ?: -1))
                    return@launch
                }
                val transfers = Transfers { url, headers -> DownloadService.clientFor(job(c, "inspect"), url, headers) }
                if (c.container == Container.DASH) {
                    call.resolve(out.put("container", "DASH").put("reason", "DASH غير مدعوم للحفظ بعد"))
                    return@launch
                }
                if (c.container == Container.HLS) {
                    val text = transfers.text(c.url, c.headers)
                    val mediaText: String
                    var codec: String? = null
                    var height: Int? = c.quality
                    val audio = mutableListOf<String>()
                    val subs = mutableListOf<String>()
                    if (HlsPlaylist.isMaster(text)) {
                        val m = HlsPlaylist.parseMaster(text, c.url)
                        val v = HlsPlaylist.chooseVariant(m, c.quality) ?: return@launch call.resolve(out.put("container", "HLS").put("reason", "قائمة بلا نسخ").put("supported", false))
                        codec = v.codecs
                        height = v.height ?: height
                        m.renditions.filter { it.groupId == v.audioGroup && it.type == "AUDIO" }.forEach { audio += it.language ?: it.name ?: "?" }
                        m.renditions.filter { it.groupId == v.subtitleGroup && it.type == "SUBTITLES" }.forEach { subs += it.language ?: it.name ?: "?" }
                        mediaText = transfers.text(v.uri, c.headers)
                    } else mediaText = text
                    val media = HlsPlaylist.parseMedia(mediaText, c.url)
                    call.resolve(out.put("container", "HLS").put("transport", "hls").put("resumable", true)
                        .put("drm", media.drm).put("codec", codec).put("quality", height)
                        .put("live", !media.endList).put("duration", media.duration)
                        .put("audio", JSArray(audio + c.audio.map { it.lang })).put("subtitles", JSArray(subs + c.subtitles.map { it.lang }))
                        .apply { if (!media.endList) put("container", "PAGE").put("reason", "بث مباشر لا ملف") })
                    return@launch
                }
                val head = transfers.head(c.url, c.headers)
                call.resolve(out.put("container", head.container).put("transport", "http").put("size", head.total)
                    .put("resumable", head.ranges).put("contentType", head.contentType)
                    .apply { if (head.container == "PAGE") put("reason", "الرابط صفحة ويب لا ملف فيديو") })
            } catch (e: DownloadFailure) {
                call.resolve(JSObject().put("container", "UNKNOWN").put("error", e.code).put("reason", e.message))
            } catch (t: Throwable) {
                call.reject(t.message ?: t.javaClass.simpleName)
            }
        }
    }

    private fun job(c: Candidate, id: String, sourceKey: String = "", title: String = "", label: String = "", section: String = "anime") = DownloadJob(
        id = id, sourceKey = sourceKey, url = c.url, headers = c.headers,
        kind = if (c.container == Container.HLS) "HLS" else "FILE", sourceId = c.sourceId, quality = c.quality,
        title = title, label = label, section = section,
        subtitles = c.subtitles.map { Sidecar(it.url, it.lang, label = it.label ?: c.sourceName) },
        audio = c.audio.map { Sidecar(it.url, it.lang, kind = "audio", label = it.label ?: c.sourceName) },
    )

    /**
     * يبدأ عملًا أو يستأنفه. نفس `sourceKey` ⇒ يكمل الجزئي (بالرابط الجديد إن جُدّد)؛
     * غيره ⇒ يُحذف الجزئي القديم ويبدأ ملف جديد كامل من المصدر الجديد.
     */
    @PluginMethod
    fun start(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id مطلوب")
        val session = call.getString("session") ?: return call.reject("session مطلوب")
        val candidateId = call.getString("candidate") ?: return call.reject("candidate مطلوب")
        val sourceKey = call.getString("sourceKey") ?: return call.reject("sourceKey مطلوب")
        val c = candidateOf(session, candidateId) ?: return call.reject("انتهت جلسة السيرفر")
        val store = DownloadService.store(context)
        var fresh = job(c, id, sourceKey, call.getString("title").orEmpty(), call.getString("label").orEmpty(), call.getString("section") ?: "anime")
        fresh = fresh.copy(
            subtitleIdentity = call.getObject("subtitleIdentity")?.toString(),
            subtitleProviders = call.getArray("addonSubtitleProviders")?.toString(),
            episode = (call.getDouble("episode") ?: 1.0).toFloat(),
        )
        if (isTorrent(c)) {
            val request = torrentRequest(c) ?: return call.reject("تعذّر قراءة التورنت من هذا الاختيار", "SOURCE")
            fresh = fresh.copy(kind = "TORRENT", url = request.magnetUri(), headers = emptyMap(), torrentHash = request.infoHash,
                torrentFile = request.fileIdx, torrentMagnet = request.magnetUri())
        }
        if (DownloadService.isRunning(id) || DownloadService.isQueued(id)) return call.resolve(JSObject().put("started", false).put("running", true))
        val previous = runCatching { store.read(id) }.getOrNull()
        val next = when {
            previous == null -> fresh
            previous.sourceKey != sourceKey || previous.kind != fresh.kind -> { store.delete(id); fresh }
            // تورنت آخر بالمفتاح نفسه (رمز السيرفر يتكرر بين الجلسات): ملف جديد كامل. كان يُكمل بهوية التورنت السابق
            // فيُنزَّل إصدار غير الذي اختاره المستخدم (200MB المختار ← 1.1GB السابق)
            fresh.kind == "TORRENT" && (previous.torrentHash != fresh.torrentHash || previous.torrentFile != fresh.torrentFile) -> { store.delete(id); fresh }
            // نفس السيرفر: الرابط والترويسات الجديدة، والتقدّم ومعرّفات الملف من السابق
            else -> previous.copy(url = fresh.url, headers = fresh.headers, subtitles = previous.subtitles.ifEmpty { fresh.subtitles },
                subtitleIdentity = previous.subtitleIdentity ?: fresh.subtitleIdentity, subtitleProviders = previous.subtitleProviders ?: fresh.subtitleProviders,
                audio = previous.audio.ifEmpty { fresh.audio }, state = "queued", error = null, message = null)
        }
        DownloadService.configure(call.getInt("parallel"), call.getBoolean("wifiOnly"))
        DownloadService.start(context, next)
        call.resolve(JSObject().put("started", true).put("resumedFrom", next.bytes))
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        DownloadService.stop(call.getString("id") ?: return call.reject("id مطلوب"), "pause")
        call.resolve()
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id مطلوب")
        if (DownloadService.isRunning(id) || DownloadService.isQueued(id)) DownloadService.stop(id, "cancel")
        runCatching { if (!DownloadService.isRunning(id)) DownloadService.store(context).delete(id) }
        call.resolve()
    }

    /** حذف ما على الجهاز بطلب المستخدم: مجلد العنصر وحده. */
    @PluginMethod
    fun remove(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id مطلوب")
        DownloadService.stop(id, "cancel")
        val store = DownloadService.store(context)
        val freed = runCatching { store.sizeOnDisk(id) }.getOrDefault(0L)
        runCatching { store.delete(id) }
        call.resolve(JSObject().put("freed", freed))
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id مطلوب")
        val job = runCatching { DownloadService.store(context).read(id) }.getOrNull() ?: return call.resolve(JSObject().put("exists", false))
        call.resolve(event(job).put("exists", true).put("running", DownloadService.isRunning(id)).put("queued", DownloadService.isQueued(id)))
    }

    /** إعدادات طابور الجهاز (التوازي و«Wi-Fi فقط») حين تتغير في الواجهة. */
    @PluginMethod
    fun configure(call: PluginCall) {
        DownloadService.configure(call.getInt("parallel"), call.getBoolean("wifiOnly"))
        call.resolve()
    }

    /**
     * تنزيل المانجا يجري في الواجهة (صفحات بمحرك الإضافات نفسه)، فتجميد النظام للعملية بعد الخروج من التطبيق
     * كان يوقفه بلا كلمة. مسكة على الخدمة الأمامية نفسها تبقي العملية حية بإشعار تقدّم ما دام فصل يُنزَّل.
     */
    @PluginMethod
    fun keepAlive(call: PluginCall) {
        val key = call.getString("key") ?: "manga"
        if (call.getBoolean("on", true) == true) DownloadService.hold(context, key, call.getString("label") ?: "تنزيل فصول المانجا")
        else DownloadService.release(key)
        call.resolve()
    }

    /**
     * تشغيل ملف محفوظ بالمشغّل نفسه: جلسة محلية بمرشّح file:// وترجماته وصوته المحفوظين.
     * لا مصدر ولا شبكة ولا «مشاهدة معًا» (ميزة مستقبلية منفصلة).
     */
    @PluginMethod
    fun play(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id مطلوب")
        val store = DownloadService.store(context)
        val job = runCatching { store.read(id) }.getOrNull() ?: return call.reject("الملف غير موجود على الجهاز")
        if (job.state != "ready" || job.main == null) return call.reject("التنزيل لم يكتمل بعد")
        val dir = store.dir(id)
        val main = File(dir, job.main)
        if (!main.isFile) return call.reject("الملف حُذف من الجهاز")
        val now = System.currentTimeMillis()
        val candidate = Candidate(
            id = "local-$id", sourceId = "local", sourceName = "على الجهاز", server = "local", host = "local",
            url = android.net.Uri.fromFile(main).toString(), quality = job.quality, label = "على الجهاز",
            container = if (job.kind == "HLS") Container.HLS else Container.MP4,
            subtitles = job.subtitles.mapNotNull { s -> s.file?.let { File(dir, it) }?.takeIf { it.isFile }?.let { TrackRef(android.net.Uri.fromFile(it).toString(), s.lang, s.label) } },
            audio = job.audio.mapNotNull { a -> a.file?.let { File(dir, it) }?.takeIf { it.isFile }?.let { TrackRef(android.net.Uri.fromFile(it).toString(), a.lang, a.label) } },
            resolvedAt = now, expiresAt = Long.MAX_VALUE,
        )
        val session = "local-$id-$now"
        engine.openLocal(session, candidate)
        // الشعار والبنر ملفان بجانب الحلقة (مرة، ثم يُعاد استعمالهما): يُمرَّر مسارهما لا محتواهما، فلا يقترب
        // Intent من حده (~1MB) ولا ينهار التشغيل، ويبقيان مع التحميل نفسه بلا إنترنت (بلاغ المالك، 20 نوفمبر)
        fun stageArt(kind: String): String? {
            val given = call.getString(kind)?.takeIf { it.isNotBlank() } ?: return null
            if (!given.startsWith("data:")) return given.takeIf { it.startsWith("https://") || it.startsWith("http://") }
            val file = File(dir, "art-$kind")
            return runCatching {
                val bytes = android.util.Base64.decode(given.substringAfter(','), android.util.Base64.DEFAULT)
                if (bytes.isEmpty() || bytes.size > 4 * 1024 * 1024) return null
                if (!file.isFile || file.length() != bytes.size.toLong()) {
                    val tmp = File(dir, "art-$kind.tmp")
                    tmp.writeBytes(bytes)
                    if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
                }
                android.net.Uri.fromFile(file).toString()
            }.getOrNull()
        }
        val launch = com.vantara.anime.player.PlayerActivity.Launch(
            session = session,
            title = call.getString("title") ?: job.title,
            animeId = call.getString("animeId").orEmpty(),
            section = call.getString("section")?.takeIf { it == "cinema" } ?: "anime",
            episode = (call.getDouble("episode") ?: 1.0).toFloat(),
            total = call.getInt("total") ?: 0,
            format = call.getString("format"),
            positionMs = (call.getDouble("position") ?: 0.0).toLong(),
            candidate = candidate.id,
            poster = call.getString("poster"),
            // شعار العمل وبنره لشاشة التشغيل من نسخة التحميل نفسها (data:)، فيظهر الشعار لا اسم العمل ولو بلا إنترنت
            backdrop = stageArt("backdrop"),
            logo = stageArt("logo"),
            usageUserId = call.getString("usageUserId"),
            material = call.getString("material")?.takeIf { it == "glass" },
        )
        activity.startActivity(com.vantara.anime.player.PlayerActivity.intent(context, launch))
        call.resolve(JSObject().put("session", session))
    }
}
