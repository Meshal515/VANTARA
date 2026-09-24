package com.vantara.plugins.translation

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

/**
 * الترجمة المقدّمة تعمل والشاشة مطفأة: خدمة أمامية بإشعار تقدّم ثابت، وقفل
 * معالج جزئي. الطابور نفسه في JavaScript (نفس طريق القارئ)؛ هذه الخدمة تُبقي
 * العملية حيّة وتعرض التقدّم، ولا تترجم شيئًا بنفسها.
 */
class TranslationJobService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private var foreground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        channels(this)
        wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vantara:translation")
            .apply { setReferenceCounted(false); acquire(MAX_RUN_MS) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        show(
            intent?.getStringExtra(EXTRA_TITLE) ?: "VANTARA",
            intent?.getStringExtra(EXTRA_TEXT) ?: "",
            intent?.getIntExtra(EXTRA_DONE, 0) ?: 0,
            intent?.getIntExtra(EXTRA_TOTAL, 0) ?: 0,
        )
        // العملية إن قُتلت لا تُعاد وحدها: الطابور يُستأنف حين تفتح التطبيق
        return START_NOT_STICKY
    }

    fun show(title: String, text: String, done: Int, total: Int) {
        val n = progressNotification(this, title, text, done, total)
        if (!foreground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            else startForeground(ONGOING_ID, n)
            foreground = true
        } else {
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ONGOING_ID, n)
        }
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ONGOING = "vantara.translation.progress"
        private const val CHANNEL_DONE = "vantara.translation.done"
        private const val ONGOING_ID = 7301
        private const val DONE_ID = 7302
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_TEXT = "text"
        private const val EXTRA_DONE = "done"
        private const val EXTRA_TOTAL = "total"
        /** سقف أمان للقفل: لا يبقى المعالج مستيقظًا بلا نهاية إن نُسي الإيقاف. */
        private const val MAX_RUN_MS = 6L * 60 * 60 * 1000

        @Volatile private var instance: TranslationJobService? = null

        /** يبدأ الخدمة أو يحدّث إشعارها. */
        fun update(context: Context, title: String, text: String, done: Int, total: Int) {
            val running = instance
            if (running != null) {
                running.show(title, text, done, total)
                return
            }
            val intent = Intent(context, TranslationJobService::class.java)
                .putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text).putExtra(EXTRA_DONE, done).putExtra(EXTRA_TOTAL, total)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TranslationJobService::class.java))
        }

        /** انتهى (أو توقف لسبب يحتاجك): يوقف الخدمة ويترك إشعارًا عاديًا يُمسح. */
        fun finished(context: Context, title: String, text: String) {
            stop(context)
            channels(context)
            val n = NotificationCompat.Builder(context, CHANNEL_DONE)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .build()
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(DONE_ID, n)
        }

        private fun progressNotification(context: Context, title: String, text: String, done: Int, total: Int): Notification =
            NotificationCompat.Builder(context, CHANNEL_ONGOING)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(text)
                .setOnlyAlertOnce(true)
                .setOngoing(true)
                .setSilent(true)
                .setProgress(total.coerceAtLeast(0), done.coerceIn(0, total.coerceAtLeast(0)), total <= 0)
                .setContentIntent(openApp(context))
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build()

        private fun openApp(context: Context): PendingIntent? {
            val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }

        private fun channels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ONGOING, "ترجمة الفصول", NotificationManager.IMPORTANCE_LOW).apply {
                description = "تقدّم ترجمة الفصول في الخلفية"
            })
            nm.createNotificationChannel(NotificationChannel(CHANNEL_DONE, "اكتمال الترجمة", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "تنبيه حين تجهز الفصول المترجمة"
            })
        }
    }
}
