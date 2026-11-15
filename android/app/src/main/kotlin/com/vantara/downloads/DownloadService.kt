package com.vantara.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
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
 * بإشعار تقدّم واحد لكل التنزيلات. الطابور وقرار التوازي في الواجهة (manager.js)؛ هنا التنفيذ فقط.
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
        promote()
        drainPending()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        promote()
        drainPending()
        return START_NOT_STICKY
    }

    private fun promote() {
        val n = notification(this)
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(ONGOING_ID, n)
            foreground = true
        } else (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ONGOING_ID, n)
    }

    private fun drainPending() {
        while (true) {
            val job = pending.poll() ?: break
            launch(job)
        }
    }

    private fun launch(job: DownloadJob) {
        if (running.containsKey(job.id)) return
        val store = store(this)
        val transfers = Transfers { url, headers -> clientFor(job, url, headers) }
        val runner = DownloadRunner(store, transfers)
        val handle = Running(transfers)
        running[job.id] = handle
        handle.job = scope.launch {
            try {
                runner.run(job) { emit(it) }
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
                val saved = (store.read(job.id) ?: job).copy(state = if (e.code == "EXPIRED") "expired" else "failed", error = e.code, message = e.message)
                store.write(saved)
                emit(saved)
            } catch (t: Throwable) {
                val saved = (store.read(job.id) ?: job).copy(state = "failed", error = "UNKNOWN", message = t.message ?: t.javaClass.simpleName)
                runCatching { store.write(saved) }
                emit(saved)
            } finally {
                running.remove(job.id)
                if (running.isEmpty() && pending.isEmpty()) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    foreground = false
                    stopSelf()
                } else updateNotification()
            }
        }
    }

    private fun emit(job: DownloadJob) {
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
        if (instance === this) instance = null
        running.values.forEach { it.reason = "pause"; it.transfers.cancel() }
        wakeLock?.takeIf { it.isHeld }?.release()
        super.onDestroy()
    }

    private class Running(val transfers: Transfers) {
        @Volatile var reason: String = "pause"
        var job: Job? = null
    }

    companion object {
        private const val CHANNEL = "vantara.downloads.progress"
        private const val ONGOING_ID = 7401
        @Volatile private var instance: DownloadService? = null
        private val running = ConcurrentHashMap<String, Running>()
        private val pending = java.util.concurrent.ConcurrentLinkedQueue<DownloadJob>()
        private val progress = ConcurrentHashMap<String, DownloadJob>()
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

        fun start(context: Context, job: DownloadJob) {
            store(context).write(job)
            pending.add(job)
            val service = instance
            if (service != null) service.drainPending()
            else ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
        }

        /** إيقاف مؤقت (يبقى الجزئي) أو إلغاء (يُحذف). */
        fun stop(id: String, reason: String) {
            pending.removeAll { it.id == id }
            running[id]?.let { it.reason = reason; it.transfers.cancel() }
        }

        private fun channels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "التنزيلات", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        }

        private fun notification(context: Context): Notification {
            val active = running.keys.mapNotNull { progress[it] }
            val title = when (active.size) {
                0 -> "يجهّز التنزيل"
                1 -> active[0].let { listOf(it.title, it.label).filter(String::isNotBlank).joinToString(" — ") }
                else -> "${active.size} تنزيلات جارية"
            }
            val done = active.sumOf { it.bytes }
            val total = active.sumOf { if (it.total > 0) it.total else 0 }
            val known = active.isNotEmpty() && active.all { it.total > 0 }
            val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?.let { PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
            return NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(if (known) "${done * 100 / total.coerceAtLeast(1)}%" else "VANTARA")
                .setOnlyAlertOnce(true).setOngoing(true).setSilent(true)
                .setProgress(100, if (known) (done * 100 / total.coerceAtLeast(1)).toInt() else 0, !known)
                .setContentIntent(open)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build()
        }
    }
}
