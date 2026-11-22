package com.vantara.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * خدمة التنزيل الأمامية: تنقل البايتات خارج الـWebView، فتستمر والشاشة مطفأة أو التطبيق في الخلفية،
 * بإشعار تقدّم واحد لكل التنزيلات. الواجهة (manager.js) تجهّز السيرفر وتسلّم؛ طابور الجهاز هنا يكمل ما سُلِّم
 * بالتوازي و«Wi-Fi فقط» من إعداداتها، ولو أُغلق التطبيق أو قتل النظام العملية (START_STICKY + restoreQueue).
 *
 * المجلد: `Android/data/<app>/files/VANTARA/Downloads` — تخزين التطبيق الدائم (لا مجلد الكاش):
 * لا يُخليه النظام عند ضيق المساحة، ويُحذف فقط بحذف المستخدم أو إزالة التطبيق.
 */
class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null
    private var foreground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        channels(this)
        wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vantara:downloads")
            .apply { setReferenceCounted(false); acquire(6L * 60 * 60 * 1000) }
        // إعادة تشغيل النظام للخدمة (START_STICKY) من الخلفية قد يُرفض فيها الإشعار الأمامي (Android 12+،
        // ForegroundServiceStartNotAllowedException): لا انهيار؛ الطابور محفوظ ويكمل عند فتح التطبيق
        if (!runCatching { promote() }.isSuccess) { stopSelf(); return }
        restoreQueue()
        watchNetwork()
        drainPending()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!runCatching { promote() }.isSuccess) { stopSelf(); return START_NOT_STICKY }
        drainPending()
        // النظام قتل العملية وطابور الجهاز لم يكتمل: يعيد إنشاء الخدمة فيكمل من المحفوظ (restoreQueue)
        return START_STICKY
    }

    /**
     * طابور الجهاز من القرص: ما سُلِّم ولم يكتمل (في الانتظار، أو كان يعمل لحظة قُتلت العملية) يُكمل بلا واجهة.
     * المتوقف والفاشل والمكتمل لا يُمس: قرار المستخدم أو سبب ظاهر.
     */
    private fun restoreQueue() {
        val now = System.currentTimeMillis()
        val saved = runCatching { store(this).all() }.getOrDefault(emptyList())
            .filter { needsResume(it, now) }
            .sortedBy { it.createdAt }
        for (job in saved) enqueue(if (job.state == "ready") job else job.copy(state = "queued"))
    }

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** «Wi-Fi فقط»: الطابور ينتظر شبكة غير محدودة، ويكمل وحده لحظة تعود. */
    private fun watchNetwork() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) { drainPending() }
            override fun onCapabilitiesChanged(network: android.net.Network, caps: NetworkCapabilities) { drainPending() }
        }
        runCatching { cm.registerDefaultNetworkCallback(cb) }.onSuccess { networkCallback = cb }
    }

    private fun networkAllows(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        if (!caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false
        return !(wifiOnly && cm.isActiveNetworkMetered)
    }

    private fun promote() {
        val n = notification(this)
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(ONGOING_ID, n)
            foreground = true
        } else (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ONGOING_ID, n)
    }

    /** يملأ خانات التوازي من رأس طابور الجهاز؛ الباقي يُعلن «في الانتظار» فتعرف الواجهة أنه سُلِّم. */
    @Synchronized private fun drainPending() {
        while (running.size < maxParallel && networkAllows()) {
            val job = pending.poll() ?: break
            if (running.containsKey(job.id)) continue
            launch(job)
        }
        for (job in pending) if (progress[job.id]?.state != "queued") emit(job.copy(state = "queued"))
        if (running.isEmpty() && pending.isEmpty() && holds.isEmpty()) idle()
        else if (holds.isNotEmpty()) runCatching { promote() }
    }

    /**
     * خمول: لا يُغلق فورًا (DS1). «نزّل الموسم» يسلّم حلقة بعد تجهيزها في الواجهة (عشرات الثواني)، فإن أُغلقت الخدمة
     * بين حلقتين جاء التسليم التالي والتطبيق في الخلفية، فيرفض Android 12+ بدء خدمة أمامية ويسقط التطبيق. تبقى
     * الخدمة دقيقتين بعد آخر عمل، ثم تُغلق إن بقيت خاملة.
     */
    private fun idle() {
        if (!foreground) return
        // DN1: الإشعار «اكتمل» فورًا (بلا أيقونة متحركة ولا شريط)، والخدمة تبقى خاملة دقيقتين كما كانت (DS1)
        runCatching { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ONGOING_ID, notification(this)) }
        main.removeCallbacks(lingerStop)
        main.postDelayed(lingerStop, IDLE_LINGER_MS)
    }
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private val lingerStop = Runnable {
        synchronized(this@DownloadService) {
            if (!foreground || running.isNotEmpty() || pending.isNotEmpty() || holds.isNotEmpty()) return@Runnable
            stopForeground(STOP_FOREGROUND_REMOVE)
            foreground = false
            stopSelf()
        }
    }

    private fun launch(job: DownloadJob) {
        if (running.containsKey(job.id)) return
        val store = store(this)
        val transfers = Transfers { url, headers -> clientFor(job, url, headers) }
        val handle = Running(transfers)
        val runner = DownloadRunner(store, transfers, torrent = { j, dest, onProgress -> torrentDownload(j, dest, handle, onProgress) },
            addonSubtitles = { j -> addonSubtitles(j) })
        running[job.id] = handle
        handle.job = scope.launch {
            try {
                if (job.state == "ready" && job.verified && !job.resourcesComplete)
                    runner.retrySidecars(job) { emit(it) }
                else runner.run(job) { emit(it) }
            } catch (e: Transfers.Cancelled) {
                val reason = handle.reason
                if (reason == "cancel") {
                    store.delete(job.id)
                    emit(job.copy(state = "canceled"))
                } else {
                    val saved = store.read(job.id) ?: job
                    val paused = saved.copy(state = "paused", bytes = File(store.dir(job.id), "video.part").takeIf { it.isFile }?.length() ?: saved.bytes)
                    store.write(paused)
                    emit(paused)
                }
            } catch (e: DownloadFailure) {
                val old = store.read(job.id) ?: job
                val saved = if (job.state == "ready" && job.verified)
                    old.copy(state = "ready", resourcesComplete = false, resourcesRetryAt = System.currentTimeMillis() + 30 * 60_000L, message = "تعذّر استئناف الموارد الخارجية")
                else old.copy(state = if (e.code == "EXPIRED") "expired" else "failed", error = e.code, message = e.message)
                store.write(saved)
                emit(saved)
            } catch (t: Throwable) {
                val saved = (store.read(job.id) ?: job).copy(state = "failed", error = "UNKNOWN", message = t.message ?: t.javaClass.simpleName)
                runCatching { store.write(saved) }
                emit(saved)
            } finally {
                running.remove(job.id)
                // التالي في طابور الجهاز يبدأ هنا، لا عند فتح التطبيق
                drainPending()
                if (running.isNotEmpty() || pending.isNotEmpty()) updateNotification()
            }
        }
    }

    /** تنزيل تورنت دائم بمحرك التطبيق نفسه، وإيقافه بإشارة الإلغاء نفسها. */
    private fun torrentDownload(job: DownloadJob, dest: java.io.File, handle: Running, onProgress: (DownloadJob) -> Unit): java.io.File {
        val hash = job.torrentHash ?: throw DownloadFailure("SOURCE", "تورنت بلا بصمة")
        val request = com.vantara.addons.torrent.TorrentRequest(hash, job.torrentFile, emptyList(), job.torrentMagnet,
            episode = job.episode.takeIf { it > 0f && it % 1f == 0f }?.toInt())
        val engine = com.vantara.addons.torrent.TorrentEngine.get(this)
        if (!com.vantara.addons.torrent.TorrentEngine.nativeAvailable()) throw DownloadFailure("UNSUPPORTED", "محرك التورنت غير متاح لمعمارية هذا الجهاز")
        var current = job
        try {
            return engine.downloadPermanent(request, dest, cancelled = { handle.cancelled }) { p ->
                current = current.copy(bytes = p.done, total = p.total, peers = p.peers, segmentsDone = p.pieces, segmentsTotal = p.piecesTotal)
                onProgress(current)
            }
        } catch (e: java.io.InterruptedIOException) {
            throw Transfers.Cancelled()
        } catch (e: java.io.IOException) {
            throw when (e.message) {
                // المشغّل مفتوح عليه الآن: مؤقت لا رفض من المصدر، فيُعاد تلقائيًا بعد إغلاقه
                "TORRENT_BUSY" -> DownloadFailure("NETWORK", "هذا الإصدار مفتوح في المشغّل الآن؛ يبدأ تنزيله بعد إغلاقه")
                "NO_PEERS" -> DownloadFailure("NETWORK", "لا مشاركين في التورنت الآن")
                "EPISODE_NOT_IN_TORRENT" -> DownloadFailure("SOURCE", "هذا التورنت لا يحتوي الحلقة المطلوبة")
                "TORRENT_INCOMPLETE" -> DownloadFailure("VERIFY", "ملف الحلقة لم يكتمل؛ يُعاد تنزيله")
                else -> DownloadFailure("NETWORK", e.message ?: "انقطع التورنت")
            }
        }
    }

    /**
     * ترجمات الإضافات المثبتة بنفس مسار المشغّل (SubtitleProviders.discover + RemoteAddonClient): العربية وحدها، حتى 20. النص يُقرأ بفك ترميز العربية القديم (windows-1256) ويُحفظ UTF-8، والتوقيت كما هو.
     */
    private fun addonSubtitles(job: DownloadJob): List<SavedSubtitle> {
        val providers = com.vantara.addons.SubtitleProviders.providers(job.subtitleProviders)
        if (providers.isEmpty() || com.vantara.addons.SubtitleProviders.videoId(job.subtitleIdentity, job.episode) == null) return emptyList()
        val client = com.vantara.addons.nativeAddonClient(this)
        // مهلة كلية: الترجمات إضافة على حلقة اكتملت، فلا تُبقيها «تتحقق» دقائق بسبب إضافة بطيئة
        val deadline = System.currentTimeMillis() + SUBTITLE_BUDGET_MS
        val found = providers.flatMap { p ->
            if (System.currentTimeMillis() > deadline) emptyList()
            else runCatching { com.vantara.addons.SubtitleProviders.discover(client, p, job.subtitleIdentity, job.episode, "download-${job.id}-${p.key}") }.getOrDefault(emptyList())
        }
        // العربية وحدها (قرار المالك): إضافة واحدة قد ترجع مئات الترجمات بكل اللغات؛ نحفظ حتى 20 عربية فقط
        val chosen = found.filter { it.lang == "ar" }.distinctBy { it.url }.take(20)
        return chosen.mapIndexedNotNull { i, t ->
            if (System.currentTimeMillis() > deadline) return@mapIndexedNotNull null
            val text = runCatching { client.request(t.url, "download-${job.id}-sub-$i", fallbackCharset = if (t.lang == "ar") "windows-1256" else null) }.getOrNull()
            if (text.isNullOrBlank()) return@mapIndexedNotNull null
            val head = text.trimStart().take(40)
            val ext = when {
                head.startsWith("WEBVTT") -> "vtt"
                head.startsWith("[Script Info]", true) -> "ass"
                else -> "srt"
            }
            SavedSubtitle(t.lang, text, ext, t.provider)
        }
    }

    internal fun emit(job: DownloadJob) {
        if (job.state == "ready" && progress[job.id]?.state != "ready") noteCompleted()
        progress[job.id] = job
        listeners.forEach { runCatching { it(job) } }
        updateNotification()
    }

    private var notifiedAt = 0L
    private fun updateNotification() {
        val now = System.currentTimeMillis()
        if (now - notifiedAt < 1000) return
        notifiedAt = now
        if (foreground) (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ONGOING_ID, notification(this))
    }

    override fun onDestroy() {
        main.removeCallbacks(lingerStop)
        networkCallback?.let { cb -> runCatching { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(cb) } }
        if (instance === this) instance = null
        running.values.forEach { it.reason = "pause"; it.cancelled = true; it.transfers.cancel() }
        wakeLock?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    private class Running(val transfers: Transfers) {
        @Volatile var cancelled = false
        @Volatile var reason: String = "pause"
        var job: Job? = null
    }

    companion object {
        private const val CHANNEL = "vantara.downloads.progress"
        private const val ONGOING_ID = 7401
        private const val IDLE_LINGER_MS = 120_000L
        private const val SUBTITLE_BUDGET_MS = 30_000L
        @Volatile private var instance: DownloadService? = null
        private val running = ConcurrentHashMap<String, Running>()
        private val pending = java.util.concurrent.ConcurrentLinkedQueue<DownloadJob>()
        private val progress = ConcurrentHashMap<String, DownloadJob>()
        /** مسكات الواجهة (تنزيل المانجا): المفتاح ← سطر الإشعار. الخدمة لا تتوقف ما بقيت مسكة. */
        private val holds = ConcurrentHashMap<String, String>()

        fun hold(context: Context, key: String, label: String) {
            holds[key] = label
            val service = instance
            if (service != null) service.drainPending()
            // من الواجهة والتطبيق ظاهر؛ رفض النظام (خلفية) لا يُسقط التنزيل نفسه
            else runCatching { ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java)) }
        }

        fun release(key: String) {
            if (holds.remove(key) != null) instance?.drainPending()
        }
        /** التوازي و«Wi-Fi فقط» من إعدادات الواجهة (manager.js)، يصلان مع كل تسليم. */
        @Volatile var maxParallel = 2
        @Volatile var wifiOnly = false
        val listeners = java.util.concurrent.CopyOnWriteArraySet<(DownloadJob) -> Unit>()

        fun root(context: Context): File =
            File(context.getExternalFilesDir(null) ?: context.filesDir, "VANTARA/Downloads")

        fun store(context: Context) = JobStore(root(context))

        fun isRunning(id: String) = running.containsKey(id)

        /** نفس عميل المشغّل للمصدر نفسه: سياسة الشبكة وحجب العناوين الداخلية كما في التشغيل. */
        fun clientFor(job: DownloadJob, url: String, headers: Map<String, String>): OkHttpClient {
            val base = Injekt.get<NetworkHelper>().client
            return if (job.sourceId.startsWith("addon|")) com.vantara.addons.nativeAddonMediaClient(base, url, headers,
                plainMedia = job.sourceId.startsWith(com.vantara.anime.AnimeEngine.RUNTIME_SOURCE_PREFIX)) else base
        }

        /** تُعاد الموارد الخارجية عند استئناف التطبيق، ولا يدخل الفيديو المكتمل تنزيلًا ثانيًا. */
        private fun needsResume(job: DownloadJob, now: Long): Boolean =
            job.state in setOf("queued", "downloading", "verifying", "reconnecting") ||
                (job.state == "ready" && job.verified && !job.resourcesComplete && job.resourcesRetryAt <= now)

        private fun enqueue(job: DownloadJob) {
            if (running.containsKey(job.id) || pending.any { it.id == job.id }) return
            pending.add(job)
        }

        fun isQueued(id: String) = pending.any { it.id == id }

        fun start(context: Context, job: DownloadJob) {
            store(context).write(job)
            enqueue(job)
            val service = instance
            if (service != null) service.drainPending()
            // التطبيق في الخلفية (Android 12+) يرفض بدء خدمة أمامية: كان الرفض يُسقط التطبيق (DS1). العنصر محفوظ
            // «في الطابور» على القرص، ويُستأنف عند عودة التطبيق (resumeQueued) أو بأي بدء لاحق للخدمة (restoreQueue)
            else runCatching { ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java)) }
        }

        /** عودة التطبيق للمقدمة: يكمل ما سُلِّم والخدمة متوقفة (رفض بدئها من الخلفية، أو قُتلت العملية). */
        fun resumeQueued(context: Context) {
            val now = System.currentTimeMillis()
            val service = instance
            if (service != null) {
                for (job in runCatching { store(context).all().filter { needsResume(it, now) } }.getOrDefault(emptyList()))
                    enqueue(job)
                service.drainPending()
                return
            }
            val waiting = pending.isNotEmpty() || runCatching { store(context).all().any { needsResume(it, now) } }.getOrDefault(false)
            if (waiting) runCatching { ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java)) }
        }

        fun configure(parallel: Int?, wifi: Boolean?) {
            parallel?.let { maxParallel = it.coerceIn(1, 4) }
            wifi?.let { wifiOnly = it }
            instance?.drainPending()
        }

        /** إيقاف مؤقت (يبقى الجزئي) أو إلغاء (يُحذف). */
        fun stop(id: String, reason: String) {
            // في طابور الجهاز ولم يبدأ: يُكتب متوقفًا، وإلا أعاده restoreQueue بعد إعادة تشغيل العملية
            pending.firstOrNull { it.id == id }?.let { queued ->
                pending.removeAll { it.id == id }
                instance?.let { svc ->
                    if (reason == "cancel") runCatching { store(svc).delete(id) }
                    else runCatching { store(svc).write(queued.copy(state = "paused")) }
                    svc.emit(queued.copy(state = if (reason == "cancel") "canceled" else "paused"))
                }
            }
            running[id]?.let { it.reason = reason; it.cancelled = true; it.transfers.cancel() }
        }

        private fun channels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "التنزيلات", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        }

        /** آخر عيّنة لكل عنصر لحساب السرعة (بايت، وقت). */
        private val samples = ConcurrentHashMap<String, Pair<Long, Long>>()
        /** عدد ما اكتمل منذ آخر خمول: «اكتمل تنزيل 3 عناصر». */
        @Volatile private var completedSinceIdle = 0
        fun noteCompleted() { completedSinceIdle++ }

        private fun speedOf(job: DownloadJob, now: Long): Long? {
            val prev = samples.put(job.id, job.bytes to now) ?: return null
            val dt = now - prev.second
            return if (dt in 500..60_000 && job.bytes >= prev.first) (job.bytes - prev.first) * 1000 / dt else null
        }

        private fun notification(context: Context): Notification {
            val now = android.os.SystemClock.elapsedRealtime()
            val active = running.keys.mapNotNull { progress[it] }.map { NoticeItem(it.title, it.label, it.bytes, it.total, speedOf(it, now)) }
            samples.keys.retainAll(running.keys)
            val c = DownloadNotice.of(active, pending.size, holds.values.toList(), wifiOnly, completedSinceIdle)
            if (!c.done && active.isEmpty() && pending.isEmpty()) completedSinceIdle = 0
            val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
            val b = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(if (c.done) android.R.drawable.stat_sys_download_done else android.R.drawable.stat_sys_download)
                .setContentTitle(c.title)
                .setContentText(c.text)
                .setOnlyAlertOnce(true).setOngoing(c.ongoing).setSilent(true).setAutoCancel(c.done)
                .setContentIntent(open)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            if (c.percent != null || c.indeterminate && !c.done) b.setProgress(100, c.percent ?: 0, c.indeterminate)
            if (c.lines.isNotEmpty()) b.setStyle(NotificationCompat.InboxStyle().also { s -> c.lines.forEach(s::addLine) })
            return b.build()
        }
    }
}
