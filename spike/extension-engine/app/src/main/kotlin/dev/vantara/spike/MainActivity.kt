package dev.vantara.spike

import android.Manifest
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.interceptor.WebViewActivityHolder
import eu.kanade.tachiyomi.source.CatalogueSource
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.cancellation.CancellationException
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.InjektModule
import uy.kohesive.injekt.api.InjektRegistrar
import uy.kohesive.injekt.api.addSingleton
import uy.kohesive.injekt.api.addSingletonFactory
import uy.kohesive.injekt.api.get

/**
 * Spike شامل للمصادر العربية في لقطة Keiyoushi المثبّتة عند البناء.
 *
 * لا يغيّر قائمة مصادر VANTARA الإنتاجية. الغرض أن نثبت، على جهاز حقيقي،
 * أي حزم عربية تمر بالسلسلة كاملة:
 *
 * APK exact URL -> SHA-256 -> package/version/lib -> Arabic source id ->
 * search -> details -> chapters -> pages -> image bytes/bitmap.
 *
 * كل حزمة مستقلة عن غيرها. سقوط مصدر لا يوقف التالي، وكل خطوة لها مهلة.
 * المصادر المتخصصة BL/GL وكل حزم NSFW محظورة ولا تُنزّل ولا تُشغّل.
 * SAFE وMIXED تُفحص في تشغيل واحد، وبعد إقرار صريح تظهر صورة اختبار مصغّرة لكل مصدر
 * يمرّ حتى الصورة.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var log: LinearLayout
    private lateinit var status: TextView
    private val network by lazy { Injekt.get<NetworkHelper>() }
    private val checkpoint by lazy { ProbeCheckpointStore(filesDir) }
    private val catalogueCheckpoint by lazy { CatalogueCrawlCheckpointStore(filesDir) }
    private val crawlState by lazy { CatalogueCrawlStateStore(filesDir) }
    private var running = false
    private lateinit var crawlButton: Button
    private lateinit var crawlStatus: TextView
    private lateinit var crawlResults: TextView
    private var crawlRender: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebViewActivityHolder.set(this)
        ensureSpikeInjekt(application)
        checkpoint.ensureSnapshot(spikeBatchFingerprint())
        // Page 19 from the former popularity feed is not page 19 of the full
        // catalogue. Bind resume data to both the source snapshot and traversal
        // contract so a routing fix can never inherit a false COMPLETE marker.
        catalogueCheckpoint.ensureSnapshot(catalogueSnapshotKey())
        // The process may die after recording the last package but before finish().
        // Preserve the report and only remove the now-empty resume plan.
        if (checkpoint.hasPlan() && checkpoint.remaining().isEmpty()) checkpoint.finish()
        val hasPendingCheckpoint = checkpoint.hasCheckpoint()
        val contentLabel = batchContentLabel(SPIKE_SOURCES.map { it.warning }.toSet())
        val batchSize = SPIKE_SOURCES.size

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }

        val runUnified = Button(this).apply {
            text = if (hasPendingCheckpoint) {
                "استأنف فحص الدفعة — $contentLabel"
            } else {
                "اختبر الدفعة ($batchSize) — $contentLabel"
            }
            setOnClickListener {
                if (running) return@setOnClickListener
                if (CatalogueCrawlExecutionGate.isRunning()) {
                    // الفحص والإحصاء على نفس المصادر في وقت واحد يضربان نفس المواقع
                    // ويخلطان الأعطال؛ واحدٌ في كل مرة
                    line("الإحصاء يجري في الخلفية — أوقفه أولًا ثم افحص.", bad = true)
                    return@setOnClickListener
                }
                val warnings = SPIKE_SOURCES.map { it.warning }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle(
                        if (requiresExplicitConsent(warnings)) {
                            "إقرار محتوى قبل الفحص"
                        } else {
                            "فحص الدفعة الحالية"
                        },
                    )
                    .setMessage(
                        "هذه الدفعة تحتوي $batchSize حزمة. " +
                            batchConsentCopy(warnings) + " " +
                            "ستظهر صورة اختبار مصغّرة للمصدر إذا وصلت السلسلة إلى صورة فصل. " +
                            "المتابعة تعني أنك توافق على فحص هذه المصادر داخل السبايك فقط.",
                    )
                    .setNegativeButton("إلغاء", null)
                    .setPositiveButton("أقر وأبدأ") { _, _ -> runUnified(this) }
                    .show()
            }
        }

        val crawl = Button(this).apply {
            setOnClickListener {
                if (running) return@setOnClickListener
                val state = crawlState.read()
                val live = CatalogueCrawlExecutionGate.isRunning()
                if (CatalogueCrawlUiPolicy.startAction(state, live) == CatalogueCrawlUiPolicy.StartAction.ATTACH) {
                    CatalogueCrawlService.stop(this@MainActivity)
                    renderCrawl()
                    return@setOnClickListener
                }
                val warnings = SPIKE_SOURCES.map { it.warning }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("إقرار إحصاء كل المصادر")
                    .setMessage(
                        "سيُحصى كتالوج كل مصادر الدفعة وعددها $batchSize. " +
                            batchConsentCopy(warnings) + " " +
                            "المتابعة تعني أنك توافق على الاتصال بهذه المصادر " +
                            "وحفظ التقدم صفحة بصفحة داخل السبايك.",
                    )
                    .setNegativeButton("إلغاء", null)
                    .setPositiveButton("أقر وابدأ الإحصاء") { _, _ -> startCrawl() }
                    .show()
                }
        }

        val copy = Button(this).apply {
            text = "نسخ التقرير"
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(
                    ClipData.newPlainText("VANTARA Arabic sources spike", checkpoint.readReport()),
                )
                text = "تم نسخ التقرير"
                postDelayed({ text = "نسخ التقرير" }, 1500)
            }
        }

        val clear = Button(this).apply {
            text = "مسح التقرير"
            setOnClickListener {
                if (running) return@setOnClickListener
                if (CatalogueCrawlExecutionGate.isRunning()) {
                    line("الإحصاء يجري — أوقفه قبل المسح؛ المسح تحته يمحو ما يكتبه.", bad = true)
                    return@setOnClickListener
                }
                log.removeAllViews()
                checkpoint.clear()
                catalogueCheckpoint.clear()
                crawlState.clear()
                printHeader()
                runUnified.text = "اختبر الدفعة ($batchSize) — $contentLabel"
                renderCrawl()
            }
        }

        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        status = TextView(this).apply {
            textSize = 13f
            gravity = Gravity.START
            textDirection = View.TEXT_DIRECTION_LOCALE
            setTextColor(0xFF8899AA.toInt())
        }
        crawlButton = crawl
        crawlStatus = TextView(this).apply {
            textSize = 13f
            gravity = Gravity.START
            textDirection = View.TEXT_DIRECTION_LOCALE
        }
        crawlResults = TextView(this).apply {
            textSize = 12f
            gravity = Gravity.START
            textDirection = View.TEXT_DIRECTION_LOCALE
            setTextIsSelectable(true)
        }
        root.addView(runUnified)
        root.addView(crawl)
        root.addView(crawlStatus)
        root.addView(crawlResults)
        root.addView(copy)
        root.addView(clear)
        root.addView(status)
        root.addView(ScrollView(this).apply { addView(log) })
        setContentView(root)

        val restored = checkpoint.readReport()
        if (restored.isBlank()) {
            printHeader()
        } else {
            restored.lineSequence().forEach { displayLine(it) }
            displayLine(
                if (hasPendingCheckpoint) {
                    "تم استرجاع التقرير المحفوظ — اضغط استئناف لإكمال الباقي."
                } else {
                    "تم استرجاع التقرير المكتمل المحفوظ."
                },
                bold = true,
            )
        }
    }

    private fun printHeader() {
        line("VANTARA — Arabic Sources Spike", bold = true)
        line("لقطة Keiyoushi: ${SPIKE_INDEX_COMMIT.take(12)}")
        line(SPIKE_SNAPSHOT_NOTE)
        line("المصادر المتخصصة BL/GL: تظهر BLOCKED في التقرير ولا تُشغّل.")
        line("محتوى الدفعة: ${batchContentLabel(SPIKE_SOURCES.map { it.warning }.toSet())} · ${SPIKE_SOURCES.size} حزم.")
    }

    private fun statusLine(): (String?) -> Unit {
        return { what -> status.text = if (what == null) "" else "⟳ $what — جارٍ…" }
    }

    private suspend fun obtainArabicSources(
        spec: SourceSpec,
        loader: FileExtensionLoader,
        waiting: (String?) -> Unit,
    ): List<CatalogueSource> =
        loadArabicSources(spec, loader, network.client, { text, bold, bad -> line(text, bold, bad) }, waiting)

    private fun runUnified(button: Button) {
        if (running) return
        running = true
        button.isEnabled = false

        lifecycleScope.launch {
            val loader = FileExtensionLoader(this@MainActivity)
            val probe = SourceProbe(network.client)
            val waiting = statusLine()
            val selected = SPIKE_SOURCES
            val resumed = checkpoint.hasCheckpoint()
            if (!checkpoint.hasPlan()) {
                checkpoint.reset(selected.map { it.pkg })
                log.removeAllViews()
                printHeader()
            }
            val remaining = checkpoint.remaining().toHashSet()
            val pending = selected.filter { it.pkg in remaining }

            var packagesOk = 0
            var packagesFailed = 0
            var packagesBlocked = 0
            var sourcesPassed = 0
            var sourcesPartial = 0
            var sourcesFailed = 0

            line("")
            line(
                "── الفحص الموحّد: متبقٍ ${pending.size} من ${selected.size} حزمة في التقرير ──",
                bold = true,
            )

            try {
                for ((packageIndex, spec) in pending.withIndex()) {
                    var packageFinished = false
                    try {
                        if (spec.blockedReason != null) {
                            obtainArabicSources(spec, loader, waiting)
                            packagesBlocked += 1
                            packageFinished = true
                            continue
                        }
                        val sources = obtainArabicSources(spec, loader, waiting)
                        if (sources.isEmpty()) {
                            packagesFailed += 1
                            packageFinished = true
                            continue
                        }
                        packagesOk += 1

                        for (source in sources) {
                            val label =
                                if (sources.size > 1 || source.name != spec.label) {
                                    "${spec.label} / ${source.name}"
                                } else {
                                    spec.label
                                }

                            val report = try {
                                withContext(Dispatchers.IO) {
                                    withTimeout(SOURCE_BUDGET_MS) {
                                        probe.run(label, source, spec.query) { stepName ->
                                            withContext(Dispatchers.Main) {
                                                waiting(
                                                    "${packageIndex + 1}/${pending.size} · $label · $stepName · " +
                                                        "كامل $sourcesPassed / جزئي $sourcesPartial / فشل $sourcesFailed",
                                                )
                                            }
                                        }
                                    }
                                }
                            } catch (t: Throwable) {
                                if (t is CancellationException && t !is TimeoutCancellationException) throw t
                                val detail = if (t is TimeoutCancellationException) {
                                    "تجاوز ميزانية المصدر ${SOURCE_BUDGET_MS / 60_000} دقائق"
                                } else {
                                    "${t.javaClass.name}: ${t.message?.take(300)}"
                                }
                                line("✗ probe-fatal — $label — $detail", bad = true)
                                sourcesFailed += 1
                                continue
                            }

                            render(report)
                            when {
                                report.passed -> sourcesPassed += 1
                                report.imageBytes != null -> sourcesPartial += 1
                                else -> sourcesFailed += 1
                            }
                        }
                        packageFinished = true
                    } finally {
                        // نجاحًا أو فشلًا: لا نعيد حجز التشغيل بالمصدر نفسه بعد
                        // إعادة تشغيل التطبيق. التقرير المحفوظ يحمل النتيجة.
                        if (packageFinished) checkpoint.markCompleted(spec.pkg)
                    }
                }
            } finally {
                waiting(null)
                line("")
                line(
                    "نتيجة ${if (resumed) "جلسة الاستئناف" else "هذه الجلسة"} — " +
                        "حزم حُمّلت: $packagesOk · BLOCKED: $packagesBlocked · " +
                        "حزم فشلت قبل المسبار: $packagesFailed · " +
                        "مصادر كاملة: $sourcesPassed · جزئية ووصلت للصورة: $sourcesPartial · " +
                        "مصادر فشلت: $sourcesFailed",
                    bold = true,
                )
                if (checkpoint.remaining().isEmpty()) {
                    checkpoint.finish()
                    line("انتهى الفحص الكامل.", bold = true)
                    button.text = "أعد فحص الدفعة"
                } else {
                    line("توقف التشغيل؛ التقرير محفوظ. اضغط استئناف لإكمال الباقي.", bold = true)
                    button.text = "استأنف فحص كل المصادر"
                }
                running = false
                button.isEnabled = true
            }
        }
    }

    override fun onStart() {
        super.onStart()
        // الشاشة نافذة على الخدمة: تقرأ الحالة الدائمة كل ثانية وهي ظاهرة فقط
        crawlRender = lifecycleScope.launch {
            while (true) {
                renderCrawl()
                delay(CRAWL_RENDER_EVERY_MS)
            }
        }
    }

    override fun onStop() {
        crawlRender?.cancel()
        crawlRender = null
        super.onStop()
    }

    /**
     * «احصِ» بعد إحصاءٍ اكتمل كله يعني إحصاءً جديدًا لا «لا شيء تبقّى». غير
     * ذلك يكمل من نقاط الحفظ: المكتمل لا يُعاد، والموقوف يُحاوَل من صفحته.
     */
    private fun startCrawl() {
        if (isFreshCrawl(crawlState.read())) {
            catalogueCheckpoint.clear()
            crawlState.clear()
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            // الرفض لا يوقف شيئًا: الخدمة تعمل، والإشعار وحده يختفي
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST)
        }
        try {
            CatalogueCrawlService.start(this)
        } catch (t: RuntimeException) {
            line("✗ تعذّر بدء خدمة الإحصاء — ${t.javaClass.simpleName}: ${t.message}", bad = true)
        }
        renderCrawl()
    }

    private fun isFreshCrawl(state: CatalogueCrawlState): Boolean {
        if (!catalogueCheckpoint.hasAnyProgress()) return true
        val pending = catalogueCheckpoint.hasResumeState() || crawlState.results().any { !it.complete }
        return state.finished && !pending
    }

    private fun renderCrawl() {
        val state = crawlState.read()
        val live = CatalogueCrawlExecutionGate.isRunning()
        crawlButton.text = CatalogueCrawlUiPolicy.buttonText(
            state,
            live,
            SPIKE_SOURCES.size,
            hasProgress = !isFreshCrawl(state),
        )
        crawlStatus.text = CatalogueCrawlUiPolicy.statusText(state, live).orEmpty()
        crawlResults.text = crawlResultsText(crawlState.results())
    }

    private fun crawlResultsText(results: List<CatalogueSourceResult>): String {
        if (results.isEmpty()) return ""
        return buildString {
            results.forEach { r ->
                if (r.complete) {
                    append("✓ ").append(r.label).append(" — ").append(r.uniqueWorks).append(" عملًا (كامل)")
                } else {
                    append("… ").append(r.label).append(" — على الأقل ").append(r.uniqueWorks)
                        .append(" · ").append(r.note.lineSequence().first().take(120))
                }
                append('\n')
            }
            val done = results.count { it.complete }
            // مجموعٌ قبل الدمج: نفس العمل في مصدرين يُعدّ مرّتين هنا
            append("المجموع: ").append(results.sumOf { it.uniqueWorks })
                .append(" عملًا في ").append(results.size).append(" مصدرًا · مكتمل ")
                .append(done).append('/').append(results.size)
                .append(" · قبل الدمج بين المصادر")
        }
    }

    private suspend fun render(report: SourceProbe.Report) {
        for (step in report.steps) {
            line(
                "${if (step.ok) "✓" else "✗"} ${step.name} — ${step.detail} (${step.millis}ms)",
                bad = !step.ok,
            )
            step.live?.let { line("   ${it.describe()}") }
            step.hypothesis?.let { line("   $it") }
        }
        report.baseUrl?.let { line("   المضيف: $it") }
        report.chapterSpan?.let { line("   الفصول: $it") }
        report.imageFromChapter?.let { line("   الصورة من فصل: ${it.take(60)}") }
        report.imageUrl?.let { line("   الصورة: ${it.take(90)}") }

        report.imageData?.let { bytes ->
            val bmp = withContext(Dispatchers.Default) {
                decodePreview(bytes)
            }
            if (bmp == null) {
                line("✗ الصورة لم تُفكَّك — ليست صورة حقيقية", bad = true)
            } else {
                log.addView(
                    ImageView(this@MainActivity).apply {
                        setImageBitmap(bmp)
                        adjustViewBounds = true
                        layoutParams = LinearLayout.LayoutParams(
                            PREVIEW_WIDTH_PX,
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                        )
                    },
                )
                trimLog()
                line("✓ الصورة ظهرت مصغّرة — ${bmp.width}×${bmp.height}")
            }
        }

        report.reach?.let { reach ->
            val more =
                if (reach.reachedEnd) {
                    " — وهذا كل ما عنده"
                } else {
                    " · للعدّ الكامل استخدم زر الإحصاء"
                }
            line(
                "   عيّنة تصفّح: ${reach.uniqueWorks} عملًا في " +
                    "${reach.pagesFetched} صفحات$more",
            )
        }
    }

    /** Decode a bounded RGB_565 thumbnail; never retain the full manga page bitmap. */
    private fun decodePreview(bytes: ByteArray): Bitmap? = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null

        val options = BitmapFactory.Options().apply {
            inSampleSize = ImagePayloadPolicy.sampleSize(
                bounds.outWidth,
                bounds.outHeight,
                PREVIEW_WIDTH_PX,
                PREVIEW_HEIGHT_PX,
            )
            inPreferredConfig = Bitmap.Config.RGB_565
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }.getOrNull()

    override fun onDestroy() {
        WebViewActivityHolder.set(null)
        super.onDestroy()
    }

    private fun line(text: String, bold: Boolean = false, bad: Boolean = false) {
        checkpoint.appendLine(text)
        displayLine(text, bold, bad)
    }

    private fun displayLine(text: String, bold: Boolean = false, bad: Boolean = false) {
        log.addView(
            TextView(this).apply {
                this.text = text
                textSize = if (bold) 15f else 13f
                gravity = Gravity.START
                if (bad) setTextColor(0xFFCC3344.toInt())
                if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
                textDirection = View.TEXT_DIRECTION_LOCALE
            },
        )
        trimLog()
    }

    /** The full report is on disk; the view keeps only a rolling window. */
    private fun trimLog() {
        while (log.childCount > MAX_ONSCREEN_ITEMS) {
            val oldest = log.getChildAt(0)
            if (oldest is ImageView) {
                (oldest.drawable as? android.graphics.drawable.BitmapDrawable)?.bitmap?.recycle()
            }
            log.removeViewAt(0)
        }
    }

    private companion object {
        /** حدّ أعلى للمصدر كله؛ يمنع مصدرًا واحدًا من حجز فحص عشرات المصادر. */
        const val SOURCE_BUDGET_MS = 6L * 60L * 1000L
        const val PREVIEW_WIDTH_PX = 320
        const val PREVIEW_HEIGHT_PX = 480
        const val MAX_ONSCREEN_ITEMS = 500
        const val CRAWL_RENDER_EVERY_MS = 1_000L
        const val NOTIFICATION_PERMISSION_REQUEST = 7
    }
}

private val INJEKT_LOCK = Any()
private var injektReady = false

/**
 * الشاشة والخدمة كلتاهما قد تكون أول ما يعمل في العملية: أندرويد يعيد إنشاء
 * خدمة `START_STICKY` بلا شاشة، والإضافات تطلب `NetworkHelper` من Injekt.
 */
fun ensureSpikeInjekt(application: Application) {
    synchronized(INJEKT_LOCK) {
        if (!injektReady) {
            Injekt.importModule(SpikeModule(application))
            injektReady = true
        }
    }
}

class SpikeModule(private val application: Application) : InjektModule {
    override fun InjektRegistrar.registerInjectables() {
        addSingleton<Application>(application)
        addSingletonFactory { NetworkHelper(application) }
        addSingletonFactory {
            kotlinx.serialization.json.Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
        }
    }
}
