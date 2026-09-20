package dev.vantara.spike

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.Gravity
import android.view.View
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
 * BLOCKED ولا تُنزّل ولا تُشغّل. NSFW له زر منفصل وإقرار صريح، ولا تُعرض
 * صوره على الشاشة حتى أثناء الفحص.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var log: LinearLayout
    private val network by lazy { Injekt.get<NetworkHelper>() }
    private val reportText = StringBuilder()
    private var running = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebViewActivityHolder.set(this)
        Injekt.importModule(SpikeModule(this))

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }

        val runRegular = Button(this).apply {
            text = "اختبر SAFE + MIXED"
            setOnClickListener {
                runSelected(
                    button = this,
                    warnings = setOf(ContentWarning.SAFE, ContentWarning.MIXED),
                )
            }
        }

        val runNsfw = Button(this).apply {
            text = "اختبر NSFW (يتطلب إقرار)"
            setOnClickListener {
                if (running) return@setOnClickListener
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("فحص مصادر NSFW")
                    .setMessage(
                        "هذا فحص هندسي للمصدر فقط. لن يعرض صور الصفحات، " +
                            "لكن التطبيق سيطلب البحث والفصول والصفحات ويتحقق من بايتات الصورة. " +
                            "المصادر BL/GL المحظورة لن تُشغّل مهما كان هذا الإقرار.",
                    )
                    .setNegativeButton("إلغاء", null)
                    .setPositiveButton("أقر وأختبر") { _, _ ->
                        runSelected(
                            button = this,
                            warnings = setOf(ContentWarning.NSFW),
                        )
                    }
                    .show()
            }
        }

        val crawl = Button(this).apply {
            text = "احصِ كتالوج SAFE فقط (يطول)"
            setOnClickListener { crawlSafe(this) }
        }

        val copy = Button(this).apply {
            text = "نسخ التقرير"
            setOnClickListener {
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("VANTARA Arabic sources spike", reportText.toString()))
                text = "تم نسخ التقرير"
                postDelayed({ text = "نسخ التقرير" }, 1500)
            }
        }

        val clear = Button(this).apply {
            text = "مسح التقرير"
            setOnClickListener {
                if (running) return@setOnClickListener
                log.removeAllViews()
                reportText.clear()
                printHeader()
            }
        }

        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(runRegular)
        root.addView(runNsfw)
        root.addView(crawl)
        root.addView(copy)
        root.addView(clear)
        root.addView(ScrollView(this).apply { addView(log) })
        setContentView(root)

        printHeader()
    }

    private fun printHeader() {
        line("VANTARA — Arabic Sources Spike", bold = true)
        line("لقطة Keiyoushi: ${SPIKE_INDEX_COMMIT.take(12)}")
        line(SPIKE_SNAPSHOT_NOTE)
        line("المصادر المتخصصة BL/GL: تظهر BLOCKED في التقرير ولا تُشغّل.")
        line("MIXED وNSFW: تُفك صورة الاختبار للتحقق فقط، بلا عرضها على الشاشة.")
    }

    private fun statusLine(): (String?) -> Unit {
        val view = TextView(this).apply {
            textSize = 13f
            gravity = Gravity.START
            textDirection = View.TEXT_DIRECTION_LOCALE
            setTextColor(0xFF8899AA.toInt())
        }
        log.addView(view)
        return { what -> view.text = if (what == null) "" else "⟳ $what — جارٍ…" }
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

    private fun runSelected(
        button: Button,
        warnings: Set<ContentWarning>,
    ) {
        if (running) return
        running = true
        button.isEnabled = false

        lifecycleScope.launch {
            val loader = FileExtensionLoader(this@MainActivity)
            val probe = SourceProbe(network.client)
            val waiting = statusLine()
            val selected = SPIKE_SOURCES.filter { it.warning in warnings }

            var packagesOk = 0
            var packagesFailed = 0
            var policyBlocked = 0
            var sourcesPassed = 0
            var sourcesFailed = 0

            line("")
            line(
                "── بدء الفحص: ${warnings.joinToString()} · ${selected.size} حزمة في اللقطة ──",
                bold = true,
            )

            try {
                for (spec in selected) {
                    if (spec.blockedReason != null) {
                        policyBlocked += 1
                        obtainArabicSources(spec, loader, waiting)
                        continue
                    }

                    val sources = obtainArabicSources(spec, loader, waiting)
                    if (sources.isEmpty()) {
                        packagesFailed += 1
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
                                                "$label · $stepName · " +
                                                    "نجح $sourcesPassed / فشل $sourcesFailed",
                                            )
                                        }
                                    }
                                }
                            }
                        } catch (t: Throwable) {
                            val detail = if (t is TimeoutCancellationException) {
                                "تجاوز ميزانية المصدر ${SOURCE_BUDGET_MS / 60_000} دقائق"
                            } else {
                                "${t.javaClass.name}: ${t.message?.take(300)}"
                            }
                            line("✗ probe-fatal — $label — $detail", bad = true)
                            sourcesFailed += 1
                            continue
                        }

                        val showPreview = spec.warning == ContentWarning.SAFE
                        render(report, showPreview)
                        if (report.passed) sourcesPassed += 1 else sourcesFailed += 1
                    }
                }
            } finally {
                waiting(null)
                line("")
                line(
                    "النتيجة — حزم حُمّلت: $packagesOk · حزم فشلت قبل المسبار: $packagesFailed · " +
                        "مصادر مرت بالسلسلة: $sourcesPassed · مصادر فشلت: $sourcesFailed · " +
                        "BLOCKED بالسياسة: $policyBlocked",
                    bold = true,
                )
                line("انتهى.", bold = true)
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

            line("")
            line("── إحصاء كامل لمصادر SAFE حتى يقول المصدر «لا مزيد» ──", bold = true)

            try {
                for (spec in safe) {
                    val sources = obtainArabicSources(spec, loader, waiting)
                    for (source in sources) {
                        val label = "${spec.label} / ${source.name}"
                        val started = System.currentTimeMillis()
                        val reach = try {
                            withContext(Dispatchers.IO) {
                                probe.crawlCatalogue(source) { page, found ->
                                    withContext(Dispatchers.Main) {
                                        waiting("$label · صفحة $page · $found عملًا")
                                    }
                                }
                            }
                        } catch (t: Throwable) {
                            line(
                                "✗ crawl-fatal — $label — ${t.javaClass.name}: ${t.message?.take(300)}",
                                bad = true,
                            )
                            continue
                        }
                        val seconds = (System.currentTimeMillis() - started) / 1000
                        line(
                            "$label — أعمال فريدة: ${reach.uniqueWorks} · " +
                                "صفحات: ${reach.pagesFetched} · ${seconds}ث",
                        )
                        line(
                            if (reach.reachedEnd) {
                                "✓ بلغنا نهاية الكتالوج — المصدر قال لا مزيد"
                            } else {
                                "⚠ لم نُثبت النهاية — توقفنا لأن: ${reach.stoppedBecause}"
                            },
                            bad = !reach.reachedEnd,
                        )
                    }
                }
            } finally {
                waiting(null)
                line("")
                line("انتهى الإحصاء.", bold = true)
                running = false
                button.isEnabled = true
            }
        }
    }

    private suspend fun render(report: SourceProbe.Report, showPreview: Boolean) {
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
                runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
            }
            if (bmp == null) {
                line("✗ الصورة لم تُفكَّك — ليست صورة حقيقية", bad = true)
            } else if (showPreview) {
                log.addView(
                    ImageView(this@MainActivity).apply {
                        setImageBitmap(bmp)
                        adjustViewBounds = true
                        layoutParams = LinearLayout.LayoutParams(
                            600,
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                        )
                    },
                )
                line("✓ الصورة ظهرت — ${bmp.width}×${bmp.height}")
            } else {
                line("✓ الصورة فُكّت — ${bmp.width}×${bmp.height} · المعاينة مخفية بالسياسة")
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

    override fun onDestroy() {
        WebViewActivityHolder.set(null)
        super.onDestroy()
    }

    private fun line(text: String, bold: Boolean = false, bad: Boolean = false) {
        reportText.appendLine(text)
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
    }

    private companion object {
        /** حدّ أعلى للمصدر كله؛ يمنع مصدرًا واحدًا من حجز فحص عشرات المصادر. */
        const val SOURCE_BUDGET_MS = 6L * 60L * 1000L
    }
}

class SpikeModule(private val activity: MainActivity) : InjektModule {
    override fun InjektRegistrar.registerInjectables() {
        addSingleton<Application>(activity.application)
        addSingletonFactory { NetworkHelper(activity.application) }
        addSingletonFactory {
            kotlinx.serialization.json.Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
        }
    }
}
