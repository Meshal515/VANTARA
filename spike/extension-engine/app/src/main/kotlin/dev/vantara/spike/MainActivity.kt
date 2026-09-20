package dev.vantara.spike

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
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
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.Request
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
 * المصادر المتخصصة BL/GL موجودة في اللقطة لأجل اكتمال التقرير فقط لكنها
 * BLOCKED ولا تُنزّل ولا تُشغّل. بقية SAFE/MIXED/NSFW تُفحص في تشغيل واحد،
 * وبعد إقرار NSFW تظهر صورة اختبار مصغّرة لكل مصدر يمرّ حتى الصورة.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var log: LinearLayout
    private lateinit var status: TextView
    private val network by lazy { Injekt.get<NetworkHelper>() }
    private val checkpoint by lazy { ProbeCheckpointStore(filesDir) }
    private val catalogueCheckpoint by lazy { CatalogueCrawlCheckpointStore(filesDir) }
    private var running = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WebViewActivityHolder.set(this)
        synchronized(INJEKT_LOCK) {
            if (!injektReady) {
                Injekt.importModule(SpikeModule(application))
                injektReady = true
            }
        }
        // The process may die after recording the last package but before finish().
        // Preserve the report and only remove the now-empty resume plan.
        if (checkpoint.hasPlan() && checkpoint.remaining().isEmpty()) checkpoint.finish()
        val hasPendingCheckpoint = checkpoint.hasCheckpoint()
        val hasCatalogueProgress = catalogueCheckpoint.hasAnyProgress()
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
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("فحص الدفعة الحالية")
                    .setMessage(
                        "هذه الدفعة تحتوي $batchSize حزم ($contentLabel). " +
                            "ستظهر صورة اختبار مصغّرة للمصدر إذا وصلت السلسلة إلى صورة فصل. " +
                            "لا توجد حزم NSFW في هذه الدفعة.",
                    )
                    .setNegativeButton("إلغاء", null)
                    .setPositiveButton("ابدأ الفحص") { _, _ -> runUnified(this) }
                    .show()
            }
        }

        val crawl = Button(this).apply {
            text =
                if (hasCatalogueProgress) {
                    "استأنف إحصاء كتالوج SAFE"
                } else {
                    "احصِ كتالوج SAFE فقط (يطول)"
                }
            setOnClickListener { crawlSafe(this) }
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
                log.removeAllViews()
                checkpoint.clear()
                catalogueCheckpoint.clear()
                printHeader()
                runUnified.text = "اختبر كل المصادر — SAFE + MIXED + NSFW"
                crawl.text = "احصِ كتالوج SAFE فقط (يطول)"
            }
        }

        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        status = TextView(this).apply {
            textSize = 13f
            gravity = Gravity.START
            textDirection = View.TEXT_DIRECTION_LOCALE
            setTextColor(0xFF8899AA.toInt())
        }
        root.addView(runUnified)
        root.addView(crawl)
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

    /**
     * تنزيل الحزمة الموثقة وتحميلها ثم استخراج المصادر العربية المقصودة.
     *
     * الأهم هنا أننا لا نستعمل `first()`: الإضافة متعددة اللغات قد يكون
     * أول CatalogueSource فيها إنجليزيًا. نطابق source.id الذي جاء من
     * index.json، ثم نستعمل lang=ar fallback فقط للـfallback الخماسي المحلي.
     */
    private suspend fun obtainArabicSources(
        spec: SourceSpec,
        loader: FileExtensionLoader,
        waiting: (String?) -> Unit,
    ): List<CatalogueSource> {
        line("")
        line("═══ ${spec.label} ═══", bold = true)
        line(
            "الحزمة ${spec.pkg} · v${spec.versionName} · lib ${spec.expectedLib} · " +
                "${spec.warning}",
        )

        spec.blockedReason?.let { reason ->
            line("⊘ BLOCKED — $reason", bad = true)
            return emptyList()
        }

        waiting("${spec.label} · تنزيل")
        val cached = withContext(Dispatchers.IO) { loader.readVerifiedCache(spec) }
        val apk = if (cached != null) {
            line("✓ cache — ${cached.size} بايت · SHA-256 مطابق")
            cached
        } else {
            val downloaded: Result<ByteArray> = withContext(Dispatchers.IO) {
                runCatching {
                    var lastIo: IOException? = null
                    repeat(3) { attempt ->
                        try {
                            return@runCatching network.client
                                .newCall(Request.Builder().url(spec.apkUrl).build())
                                .execute().use { res ->
                                    require(res.isSuccessful) {
                                        "HTTP ${res.code} ← ${spec.apkUrl}"
                                    }
                                    res.body.bytes()
                                }
                        } catch (io: IOException) {
                            lastIo = io
                            if (attempt < 2) Thread.sleep(800L * (attempt + 1))
                        }
                    }
                    throw lastIo ?: IOException("download failed without an I/O cause")
                }
            }
            downloaded.getOrElse {
                line("✗ download — ${it.javaClass.simpleName}: ${it.message}", bad = true)
                return emptyList()
            }.also { line("✓ download — ${it.size} بايت") }
        }

        waiting("${spec.label} · تحميل من ملف")
        val loaded = try {
            withContext(Dispatchers.IO) { loader.load(spec, apk) }
        } catch (t: Throwable) {
            line("✗ loader-fatal — ${t.javaClass.name}: ${t.message?.take(300)}", bad = true)
            return emptyList()
        }

        return when (loaded) {
            is FileExtensionLoader.Result.Fail -> {
                line("✗ ${loaded.stage} — ${loaded.reason}", bad = true)
                loaded.cause?.let { line("   ${it.javaClass.simpleName}: ${it.message}") }
                emptyList()
            }

            is FileExtensionLoader.Result.Ok -> {
                val all = loaded.loaded.sources.filterIsInstance<CatalogueSource>()
                val exact = if (spec.arabicSourceIds.isNotEmpty()) {
                    all.filter { it.id.toString() in spec.arabicSourceIds }
                } else {
                    emptyList()
                }
                val arabic = if (exact.isNotEmpty()) exact else all.filter { it.lang.equals("ar", true) }

                if (arabic.isEmpty()) {
                    line(
                        "✗ source-select — الحزمة حُمّلت لكن لم نجد source.id عربيًا مطابقًا " +
                            "(catalogue=${all.size})",
                        bad = true,
                    )
                    emptyList()
                } else {
                    line(
                        "✓ load — ${all.size} CatalogueSource · عربي مطابق ${arabic.size} · " +
                            "lib ${loaded.loaded.libVersion}",
                    )
                    arabic.forEach { line("   ↳ ${it.name} · id=${it.id} · lang=${it.lang}") }
                    arabic
                }
            }
        }
    }

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

    /**
     * العدّ الكامل بقي منفصلًا عن فحص الصحة. تشغيله على عشرات المصادر دفعة
     * واحدة قد يأخذ ساعات؛ لذلك هو SAFE فقط ولا يخلط «هل المصدر يعمل؟» مع
     * «كم عملًا في كتالوجه؟».
     */
    private fun crawlSafe(button: Button) {
        if (running) return
        running = true
        button.isEnabled = false

        lifecycleScope.launch {
            val loader = FileExtensionLoader(this@MainActivity)
            val probe = SourceProbe(network.client)
            val waiting = statusLine()
            val safe = SPIKE_SOURCES.filter {
                it.warning == ContentWarning.SAFE && it.blockedReason == null
            }
            val resumed = catalogueCheckpoint.hasAnyProgress()
            var allComplete = true

            line("")
            line(
                if (resumed) {
                    "── استئناف إحصاء SAFE من آخر صفحة محفوظة ──"
                } else {
                    "── إحصاء كامل لمصادر SAFE حتى يقول المصدر «لا مزيد» ──"
                },
                bold = true,
            )
            line("الحفظ الآن صفحة بصفحة؛ موت التطبيق لا يعيد المصدر إلى الصفحة 1.")

            try {
                for (spec in safe) {
                    val sources = try {
                        obtainArabicSources(spec, loader, waiting)
                    } catch (t: Throwable) {
                        line(
                            "✗ source-load-fatal — ${spec.label} — ${t.javaClass.name}: ${t.message?.take(300)}",
                            bad = true,
                        )
                        allComplete = false
                        continue
                    }

                    if (sources.isEmpty()) {
                        allComplete = false
                        continue
                    }

                    for (source in sources) {
                        val key = "${spec.pkg}|${source.id}"
                        val label = "${spec.label} / ${source.name}"

                        if (catalogueCheckpoint.isComplete(key)) {
                            line("✓ $label — مكتمل من جلسة سابقة؛ لن نعيده.")
                            continue
                        }

                        val resume = catalogueCheckpoint.load(key)
                        if (resume != null) {
                            line(
                                "↻ $label — استئناف من صفحة ${resume.nextPage} · " +
                                    "محفوظ ${resume.seenKeys.size} عملًا",
                                bold = true,
                            )
                        }

                        val started = System.currentTimeMillis()
                        val reach = try {
                            withContext(Dispatchers.IO) {
                                probe.crawlCatalogue(
                                    source = source,
                                    startPage = resume?.nextPage ?: 1,
                                    initialSeen = resume?.seenKeys.orEmpty(),
                                    onPageCommitted = { page, nextPage, newKeys, totalSeen ->
                                        catalogueCheckpoint.savePage(
                                            key = key,
                                            nextPage = nextPage,
                                            newKeys = newKeys,
                                        )
                                        if (page == 1 || page % CRAWL_REPORT_EVERY_PAGES == 0) {
                                            withContext(Dispatchers.Main) {
                                                line(
                                                    "↳ $label — حُفظت الصفحة $page · " +
                                                        "$totalSeen عملًا حتى الآن",
                                                )
                                            }
                                        }
                                    },
                                ) { page, found ->
                                    withContext(Dispatchers.Main) {
                                        waiting("$label · صفحة $page · $found عملًا")
                                    }
                                }
                            }
                        } catch (t: Throwable) {
                            if (t is CancellationException && t !is TimeoutCancellationException) throw t
                            line(
                                "✗ crawl-fatal — $label — ${t.javaClass.name}: ${t.message?.take(300)}",
                                bad = true,
                            )
                            allComplete = false
                            continue
                        }

                        val seconds = (System.currentTimeMillis() - started) / 1000
                        val countText =
                            if (reach.reachedEnd) {
                                "${reach.uniqueWorks}"
                            } else {
                                "على الأقل ${reach.uniqueWorks}"
                            }
                        line(
                            "$label — أعمال فريدة: $countText · " +
                                "صفحات ناجحة هذه الجلسة: ${reach.pagesFetched} · " +
                                "آخر صفحة محاولة: ${reach.lastPageAttempted} · ${seconds}ث",
                        )
                        if (reach.skippedPages.isNotEmpty()) {
                            line(
                                "↳ تجاوز آمن لصفحات Iken الخالية من المانجا: " +
                                    reach.skippedPages.joinToString(),
                            )
                        }

                        if (reach.reachedEnd) {
                            catalogueCheckpoint.markComplete(key)
                            line("✓ COMPLETE — بلغنا نهاية الكتالوج فعلًا")
                        } else {
                            allComplete = false
                            line(
                                "⚠ ${catalogueStopLabel(reach.stopKind)} — العدد جزئي ومحفوظ للاستئناف · " +
                                    "السبب: ${reach.stoppedBecause}",
                                bad = true,
                            )
                        }
                    }
                }
            } finally {
                waiting(null)
                line("")
                if (allComplete) {
                    catalogueCheckpoint.clear()
                    line("انتهى الإحصاء الكامل لكل مصادر SAFE.", bold = true)
                    button.text = "احصِ كتالوج SAFE فقط (يطول)"
                } else {
                    line(
                        "انتهت هذه الجولة. غير المكتمل محفوظ صفحة بصفحة؛ اضغط استئناف لإكماله.",
                        bold = true,
                    )
                    button.text = "استأنف إحصاء كتالوج SAFE"
                }
                running = false
                button.isEnabled = true
            }
        }
    }

    private fun catalogueStopLabel(kind: SourceProbe.CatalogueStopKind): String = when (kind) {
        SourceProbe.CatalogueStopKind.COMPLETE -> "COMPLETE"
        SourceProbe.CatalogueStopKind.REPEAT_SUSPECTED -> "LOOP_SUSPECTED"
        SourceProbe.CatalogueStopKind.CLOUDFLARE -> "CLOUDFLARE"
        SourceProbe.CatalogueStopKind.DEAD_HOST -> "DEAD_HOST"
        SourceProbe.CatalogueStopKind.TIMEOUT -> "TIMEOUT"
        SourceProbe.CatalogueStopKind.SOURCE_ERROR -> "SOURCE_ERROR"
        SourceProbe.CatalogueStopKind.TIME_BUDGET -> "TIME_BUDGET"
        SourceProbe.CatalogueStopKind.PAGE_CAP -> "PAGE_CAP"
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
        const val CRAWL_REPORT_EVERY_PAGES = 10

        val INJEKT_LOCK = Any()
        var injektReady = false
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
