package dev.vantara.spike

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
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import eu.kanade.tachiyomi.network.NetworkHelper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.get

/**
 * الزحف على كتالوج كل المصادر، حيًّا بعد إغلاق الشاشة.
 *
 * كان الزحف في `lifecycleScope` الشاشة فيموت معها — والمصدر الكبير يحتاج
 * ساعات. هنا خدمة أمامية من نوع `dataSync` بإشعار دائم فيه زرّ «أوقف»، والشاشة
 * مجرّد نافذة عليها تقرأ الحالة الدائمة.
 *
 * ثلاث نهايات غير «اكتمل»، وكلها تحفظ ما جُمع:
 * - المستخدم ضغط «أوقف» (من الشاشة أو الإشعار).
 * - أندرويد ١٥ استدعى [onTimeout] بعد ست ساعات: أمامنا ثوانٍ لـ`stopSelf`.
 * - أندرويد رفض `startForeground` (بدء من الخلفية بعد إعادة إنشاء، أو حدّ
 *   يومي نفد). لا ننهار؛ نسجّل ونتوقّف.
 */
class CatalogueCrawlService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var crawl: Job? = null
    private var ownsGate = false
    private var pendingStop: CatalogueCrawlServiceContract.StopReason? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastNotifiedAt = 0L
    private var destroyed = false

    private val stateStore by lazy { CatalogueCrawlStateStore(filesDir) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            CatalogueCrawlServiceContract.ACTION_STOP -> {
                stopCrawl(CatalogueCrawlServiceContract.StopReason.USER)
                return START_NOT_STICKY
            }

            CatalogueCrawlServiceContract.ACTION_START -> Unit

            // `null`: أندرويد أعاد إنشاءنا بعد موت العملية (`START_STICKY`)
            else -> if (
                CatalogueCrawlServiceContract.onRecreated(stateStore.read().active) ==
                CatalogueCrawlServiceContract.Recreated.STOP_SELF
            ) {
                stopSelf()
                return START_NOT_STICKY
            }
        }

        // لا بدّ من `startForeground` خلال ثوانٍ من `startForegroundService`،
        // حتى لو كان زحفٌ جاريًا ولن نبدأ غيره
        if (!enterForeground()) {
            if (crawl == null) {
                stateStore.markStopped(
                    CatalogueCrawlServiceContract.stopMessage(CatalogueCrawlServiceContract.StopReason.START_NOT_ALLOWED),
                )
                stopSelf()
            }
            return START_NOT_STICKY
        }

        if (crawl == null) {
            if (!CatalogueCrawlExecutionGate.tryAcquire()) {
                // زحفٌ من نسخة سابقة ما زال يُنهي طلب شبكة بعد إلغائه — لا نبدأ
                // ثانيًا فوق نقاط حفظه، ولا نترك إشعارًا فارغًا
                finish()
                return START_NOT_STICKY
            }
            ownsGate = true
            crawl = scope.launch { runCrawl() }
        }
        return START_STICKY
    }

    /** أندرويد ١٥: انتهت الست ساعات. ثوانٍ فقط قبل أن ينهار التطبيق. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopCrawl(CatalogueCrawlServiceContract.StopReason.SYSTEM_TIME_LIMIT)
    }

    override fun onDestroy() {
        destroyed = true
        // العملية باقية والخدمة ذاهبة: لا نترك زحفًا يتيمًا يكتب نقاط الحفظ.
        // البوابة **لا** تُفرج هنا: الزحف الملغى قد يكون عالقًا في طلب شبكة
        // حتى مهلته، ويُفرجها `finally` حين ينتهي فعلًا
        scope.cancel()
        super.onDestroy()
    }

    /**
     * الإيقاف فوريّ في نظر أندرويد، ولو تأخّر الزحف في الانتهاء.
     *
     * `onTimeout` يعطي ثوانٍ، وطلب شبكة معلّق لا يسمع الإلغاء قبل مهلته
     * (خمس وأربعون ثانية). فلا ننتظر `finally`: نسجّل السبب ونُنهي الخدمة الآن،
     * والإلغاء يلحق بالزحف متى استطاع.
     */
    private fun stopCrawl(reason: CatalogueCrawlServiceContract.StopReason) {
        pendingStop = reason
        if (stateStore.read().active) stateStore.markStopped(CatalogueCrawlServiceContract.stopMessage(reason))
        crawl?.cancel()
        finish()
    }

    private suspend fun runCrawl() {
        acquireWakeLock()
        try {
            ensureSpikeInjekt(application)
            val network = Injekt.get<NetworkHelper>()
            val loader = FileExtensionLoader(this)
            val probe = SourceProbe(network.client)
            val snapshotKey = catalogueSnapshotKey()
            val checkpoint = CatalogueCrawlCheckpointStore(filesDir)
            checkpoint.ensureSnapshot(snapshotKey)

            CatalogueCrawlRunner(
                specs = SPIKE_SOURCES,
                snapshotKey = snapshotKey,
                checkpoint = checkpoint,
                stateStore = stateStore,
                loadSources = { spec ->
                    var lastBad: String? = null
                    val sources = loadArabicSources(
                        spec,
                        loader,
                        network.client,
                        { text, _, bad -> if (bad) lastBad = text },
                        { what -> what?.let { notifyProgress(it, force = true) } },
                    )
                    // قائمة فارغة فشلٌ له سبب؛ المنسّق يسجّله بدل أن يتجاوز المصدر صامتًا
                    if (sources.isEmpty()) error(lastBad ?: "لم يُرجع التحميل أي مصدر عربي")
                    sources
                },
                crawlSource = { _, source, resume, onPageCommitted, onProgress ->
                    withContext(Dispatchers.IO) {
                        probe.crawlCatalogue(
                            source = source,
                            startPage = resume?.nextPage ?: 1,
                            initialSeen = resume?.seenKeys.orEmpty(),
                            onPageCommitted = onPageCommitted,
                            onProgress = onProgress,
                        )
                    }
                },
                emit = { event ->
                    when (event) {
                        is CatalogueCrawlEvent.Progress ->
                            notifyProgress("${event.label} · صفحة ${event.page} · ${event.found} عملًا")
                        is CatalogueCrawlEvent.SourceStarted ->
                            notifyProgress(event.label, force = true)
                        else -> Unit
                    }
                },
            ).run()
        } catch (t: Throwable) {
            if (t is CancellationException) throw t
            // المنسّق يبتلع أعطال المصادر؛ ما يصل هنا عطلٌ حوله (قرص، Injekt).
            // استثناءٌ غير ملتقط في `launch` يُسقط التطبيق كله
            stateStore.markStopped(
                "تعطّل الإحصاء: ${t.javaClass.simpleName}: ${t.message?.take(300) ?: "—"}. " +
                    "ما جُمع محفوظ — اضغط استأنف.",
            )
        } finally {
            val reason = pendingStop
            // `markFinished` حصل داخل المنسّق إن اكتمل؛ غير ذلك توقّف له سبب
            if (stateStore.read().active) {
                stateStore.markStopped(
                    CatalogueCrawlServiceContract.stopMessage(reason ?: CatalogueCrawlServiceContract.StopReason.INTERRUPTED),
                )
            }
            crawl = null
            releaseGate()
            releaseWakeLock()
            // إيقافٌ مطلوب أنهى الخدمة سلفًا؛ و`stopSelf` على نسخة مُتلفة قد يصيب
            // نسخة جديدة بدأها المستخدم بعدها
            if (reason == null && !destroyed) finish()
        }
    }

    private fun finish() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun enterForeground(): Boolean = try {
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification("يحضّر المصادر…"),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
        )
        true
    } catch (t: RuntimeException) {
        // ForegroundServiceStartNotAllowedException (API 31+) أو حدّ الست ساعات
        // نفد قبل البدء. الصنف غير موجود قبل 31، فالالتقاط على الأب.
        false
    }

    private fun notifyProgress(text: String, force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastNotifiedAt < NOTIFY_EVERY_MS) return
        lastNotifiedAt = now
        runCatching {
            getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification(text))
        }
    }

    private fun notification(text: String): Notification {
        ensureChannel()
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, CatalogueCrawlService::class.java).setAction(CatalogueCrawlServiceContract.ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("إحصاء كتالوج المصادر")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setContentIntent(open)
            .addAction(0, "أوقف", stop)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "إحصاء الكتالوج", NotificationManager.IMPORTANCE_LOW),
        )
    }

    /**
     * الشاشة كانت تُبقي الجهاز صاحيًا بـ`FLAG_KEEP_SCREEN_ON`؛ الخدمة بلا شاشة.
     * قفل جزئي بمهلة الحدّ نفسه، فلا يبقى قفلٌ يتيم لو فات `finally`.
     */
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        wakeLock = runCatching {
            getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vantara-spike:catalogue-crawl")
                .apply {
                    setReferenceCounted(false)
                    acquire(WAKE_LOCK_TIMEOUT_MS)
                }
        }.getOrNull()
    }

    private fun releaseWakeLock() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
    }

    private fun releaseGate() {
        if (ownsGate) {
            ownsGate = false
            CatalogueCrawlExecutionGate.release()
        }
    }

    companion object {
        private const val CHANNEL_ID = "catalogue-crawl"
        private const val NOTIFICATION_ID = 4_101
        private const val NOTIFY_EVERY_MS = 2_000L
        private const val WAKE_LOCK_TIMEOUT_MS = 6L * 60L * 60L * 1000L

        fun start(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, CatalogueCrawlService::class.java).setAction(CatalogueCrawlServiceContract.ACTION_START),
            )
        }

        fun stop(context: Context) {
            // `startService` لا `startForegroundService`: طلب الإيقاف لا يلزمه إشعار
            context.startService(
                Intent(context, CatalogueCrawlService::class.java).setAction(CatalogueCrawlServiceContract.ACTION_STOP),
            )
        }
    }
}
