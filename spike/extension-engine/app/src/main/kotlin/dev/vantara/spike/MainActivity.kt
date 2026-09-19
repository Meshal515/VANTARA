package dev.vantara.spike

import android.app.Application
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import java.io.IOException
import eu.kanade.tachiyomi.network.NetworkHelper
import eu.kanade.tachiyomi.network.interceptor.WebViewActivityHolder
import eu.kanade.tachiyomi.source.CatalogueSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request
import uy.kohesive.injekt.Injekt
import uy.kohesive.injekt.api.InjektModule
import uy.kohesive.injekt.api.InjektRegistrar
import uy.kohesive.injekt.api.addSingleton
import uy.kohesive.injekt.api.addSingletonFactory
import uy.kohesive.injekt.api.get

/**
 * شاشة واحدة، وغرضها واحد: هل المحرك المحلي يعمل على جهاز حقيقي؟
 *
 * لكل مصدر: تنزيل ⇒ تحقّق بصمة ⇒ تحميل من ملف ⇒ بحث ⇒ تفاصيل ⇒ فصول ⇒
 * صفحات ⇒ **صورة تُعرض فعلًا** ⇒ قياس الكتالوج.
 *
 * والصورة تُرسم على الشاشة بقصد. رابطٌ في سجل لا يُثبت شيئًا: قد يرجع
 * HTML أو صفحة حجب بحجم معقول. أما `BitmapFactory` فترفض ما ليس صورة،
 * فرؤيتها هي الإثبات.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var log: LinearLayout
    private val network by lazy { Injekt.get<NetworkHelper>() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // حلّ تحدّي Cloudflare يفتح WebView، وWebView يحتاج Activity حيًّا.
        // بلا هذا السطر يسقط الاعتراض عند أول 403 ويبدو كأن المصدر محجوب.
        WebViewActivityHolder.set(this)

        // الإضافات تطلب اعتمادياتها بـ`injectLazy()`، فلا بد من تسجيلها
        // قبل أول تحميل. بلا هذا يسقط أول مصدر بـIllegalStateException من
        // injekt، ويبدو كأنه عطل مصدر.
        Injekt.importModule(SpikeModule(this))

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
        }
        val run = Button(this).apply {
            text = "شغّل الخمسة"
            setOnClickListener { it.isEnabled = false; runAll(this) }
        }
        // العدّ الكامل منفصل بقصد: مصدرٌ بآلاف الأعمال يحتاج مئات الصفحات
        // ودقائق طويلة، ودمجُه في فحص السلسلة كان يجعل أربعة مصادر تنتظر
        // خلف واحد — والمالك يريد الاثنين، كلًّا في وقته.
        val crawl = Button(this).apply {
            text = "احصِ كل الأعمال (يطول)"
            setOnClickListener { it.isEnabled = false; crawlAll(this) }
        }
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(run)
        root.addView(crawl)
        root.addView(ScrollView(this).apply { addView(log) })
        setContentView(root)

        line("VANTARA — محرك الإضافات المحلي", bold = true)
        line("بلا Suwayomi · بلا سيرفر · بلا تثبيت إضافات يدويًّا")
    }

    /**
     * شريط الحالة الحيّ: سطر واحد يقول ما ننتظره الآن، لا ما مضى.
     *
     * بلا هذا السطر كانت الشاشة تقف عند آخر نجاح دقائقَ كاملة بلا حرف،
     * فتُقرأ كأن التطبيق مات — وهو يعمل.
     */
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
     * من بيانٍ مثبَّت إلى مصدرٍ حيّ: كاش موثَّق ببصمته، وإلا تنزيل، ثم تحميل
     * من ملف. يطبع كل خطوة، ويرجع `null` بدل أن يرمي — فالزرّان يمشيان على
     * هذا المسار نفسه ولا يجوز أن يُسقِط أحدَهما مصدرٌ واحد.
     */
    private suspend fun obtainSource(
        spec: SourceSpec,
        loader: FileExtensionLoader,
        waiting: (String?) -> Unit,
    ): CatalogueSource? {
        line("")
        line("═══ ${spec.label} ═══", bold = true)
        line("الحزمة ${spec.pkg} · lib ${spec.expectedLib}")

        // النسخة المحلية الموثّقة أولًا: انقطاع DNS عن github.com لا يجب أن
        // يعطّل مصدرًا سبق تنزيله والتحقق من بصمته.
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
                return null
            }.also { line("✓ download — ${it.size} بايت") }
        }

        // لا نسمح لخطأ غير متوقّع داخل المحمّل بإسقاط التطبيق كله: التشخيص
        // يجب أن يعرض الخطأ على الشاشة ويكمل للمصدر التالي.
        waiting("${spec.label} · تحميل من ملف")
        val loaded = try {
            withContext(Dispatchers.IO) { loader.load(spec, apk) }
        } catch (t: Throwable) {
            line("✗ loader-fatal — ${t.javaClass.name}: ${t.message?.take(300)}", bad = true)
            return null
        }

        return when (loaded) {
            is FileExtensionLoader.Result.Fail -> {
                line("✗ ${loaded.stage} — ${loaded.reason}", bad = true)
                loaded.cause?.let { line("   ${it.javaClass.simpleName}: ${it.message}") }
                null
            }
            is FileExtensionLoader.Result.Ok -> {
                val sources = loaded.loaded.sources.filterIsInstance<CatalogueSource>()
                line("✓ load — ${sources.size} مصدرًا · lib ${loaded.loaded.libVersion}")
                // حزمةٌ حُمّلت بلا مصدرٍ قابل للتصفّح ليست حالة مستحيلة،
                // و`first()` عليها ترمي خارج كل حراسة.
                val first = sources.firstOrNull()
                if (first == null) line("✗ load — الحزمة بلا CatalogueSource", bad = true)
                first
            }
        }
    }

    /** فحص السلسلة: بحث ⇐ تفاصيل ⇐ فصول ⇐ صفحات ⇐ صورة، لكل المصادر. */
    private fun runAll(button: Button) = lifecycleScope.launch {
        val loader = FileExtensionLoader(this@MainActivity)
        val probe = SourceProbe(network.client)
        val waiting = statusLine()

        try {
            for (spec in SPIKE_SOURCES) {
                val source = obtainSource(spec, loader, waiting) ?: continue
                val report = try {
                    withContext(Dispatchers.IO) {
                        probe.run(spec.label, source) { stepName ->
                            withContext(Dispatchers.Main) { waiting("${spec.label} · $stepName") }
                        }
                    }
                } catch (t: Throwable) {
                    line("✗ probe-fatal — ${t.javaClass.name}: ${t.message?.take(300)}", bad = true)
                    continue
                }
                render(report)
            }
        } finally {
            // ينتهي التشغيل دائمًا بخبر، ويعود الزر دائمًا صالحًا — حتى إذا
            // خرج شيء من كل الحراسات. شاشةٌ بزرٍّ ميت بلا «انتهى» لا تقول
            // للمالك أسقَطَ التطبيقُ أم ما زال يعمل، ولا تدعه يعيد المحاولة.
            waiting(null)
            line("")
            line("انتهى.", bold = true)
            button.isEnabled = true
        }
    }

    /**
     * الإحصاء الكامل: كم عملًا يكشفه كل مصدر **حتى نهايته**؟
     *
     * لا سقف صفحات هنا. يمشي حتى يقول المصدر `hasNextPage = false`، وعندها
     * وحدها تُعلن النهاية مُثبَتة. وكل توقّف آخر — تكرار، أو خطأ، أو حاجز
     * أمان — يُسمّى بسببه، فلا يُقرأ رقمٌ ناقص كأنه الكتالوج كله.
     */
    private fun crawlAll(button: Button) = lifecycleScope.launch {
        val loader = FileExtensionLoader(this@MainActivity)
        val probe = SourceProbe(network.client)
        val waiting = statusLine()

        line("")
        line("── إحصاء كامل: نمشي حتى يقول المصدر «لا مزيد» ──", bold = true)

        try {
            for (spec in SPIKE_SOURCES) {
                val source = obtainSource(spec, loader, waiting) ?: continue
                val started = System.currentTimeMillis()
                val reach = try {
                    withContext(Dispatchers.IO) {
                        probe.crawlCatalogue(source) { page, found ->
                            withContext(Dispatchers.Main) {
                                waiting("${spec.label} · صفحة $page · $found عملًا")
                            }
                        }
                    }
                } catch (t: Throwable) {
                    line("✗ crawl-fatal — ${t.javaClass.name}: ${t.message?.take(300)}", bad = true)
                    continue
                }
                val seconds = (System.currentTimeMillis() - started) / 1000
                line("أعمال فريدة: ${reach.uniqueWorks} · صفحات: ${reach.pagesFetched} · ${seconds}ث")
                line(
                    if (reach.reachedEnd) {
                        "✓ بلغنا نهاية الكتالوج — المصدر قال لا مزيد"
                    } else {
                        "⚠ لم نُثبت النهاية — توقفنا لأن: ${reach.stoppedBecause}"
                    },
                    bad = !reach.reachedEnd,
                )
            }
        } finally {
            waiting(null)
            line("")
            line("انتهى الإحصاء.", bold = true)
            button.isEnabled = true
        }
    }

    private suspend fun render(report: SourceProbe.Report) {
        for (step in report.steps) {
            line(
                "${if (step.ok) "✓" else "✗"} ${step.name} — ${step.detail} (${step.millis}ms)",
                bad = !step.ok,
            )
            // الدليل ثم الفرضية، ولا حكم. التصنيف لقارئ التقرير لا للكود:
            // موقعٌ يردّ 200 لا يُبرّئ المحرك ولا يُجرّمه.
            step.live?.let { line("   ${it.describe()}") }
            step.hypothesis?.let { line("   ${it}") }
        }
        report.baseUrl?.let { line("   المضيف: $it") }
        // العدد وحده لا يقول إن كانت القائمة كاملة؛ طرفاها يقولان المدى
        report.chapterSpan?.let { line("   الفصول: $it") }
        report.imageFromChapter?.let { line("   الصورة من فصل: ${it.take(60)}") }
        report.imageUrl?.let { line("   الصورة: ${it.take(90)}") }

        // الصورة على الشاشة: `BitmapFactory` ترفض ما ليس صورة، فهي الحَكَم.
        //
        // وتُفكَّك من بايتات المسبار نفسها، لا بتنزيلٍ ثانٍ: التنزيل الثاني
        // كان يخرج بعميل المستضيف بلا ترويسات المصدر — و`Referer` خاصةً —
        // فيردّه مضيف الصور 403، فتُعرض صورةٌ صحيحة أثبتها المسبار على أنها
        // «ليست صورة حقيقية». الحَكَم يجب أن يحكم على ما أُثبت لا على شيء آخر.
        report.imageData?.let { bytes ->
            // ننتظر فك الصورة قبل الانتقال للمصدر التالي؛ التشغيل السابق
            // كان يفكها في Coroutine منفصلة، فظهرت صورة المصدر السابق تحت
            // عنوان المصدر التالي وأصبح التقرير مضللًا بصريًا.
            val bmp = withContext(Dispatchers.Default) {
                runCatching { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) }.getOrNull()
            }
            if (bmp == null) {
                line("✗ الصورة لم تُفكَّك — ليست صورة حقيقية", bad = true)
            } else {
                log.addView(
                    ImageView(this@MainActivity).apply {
                        setImageBitmap(bmp)
                        adjustViewBounds = true
                        layoutParams = LinearLayout.LayoutParams(600, LinearLayout.LayoutParams.WRAP_CONTENT)
                    },
                )
                line("✓ الصورة ظهرت — ${bmp.width}×${bmp.height}")
            }
        }

        // عيّنة، وتُسمّى عيّنة. الرقم هنا يثبت أن التصفّح يعمل ولا يدّعي عدًّا،
        // فلا يُعرض بحُمرة «لم نُثبت النهاية»: نهايةُ الكتالوج ليست سؤال هذا
        // الزر أصلًا، وجوابها عند «احصِ كل الأعمال».
        report.reach?.let { reach ->
            val more = if (reach.reachedEnd) " — وهذا كل ما عنده" else " · للعدّ الكامل: «احصِ كل الأعمال»"
            line("   عيّنة تصفّح: ${reach.uniqueWorks} عملًا في ${reach.pagesFetched} صفحات$more")
        }
    }

    override fun onDestroy() {
        // مرجع ضعيف، لكن التنظيف الصريح يمنع تسريب نشاط في التدوير
        WebViewActivityHolder.set(null)
        super.onDestroy()
    }

    private fun line(text: String, bold: Boolean = false, bad: Boolean = false) {
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
}

/**
 * ما تطلبه الإضافات من المستضيف عبر injekt.
 *
 * `NetworkHelper` هو الأهم: الإضافة تأخذ منه `client` فيمرّ كل طلبها
 * باعتراضاتنا — ومنها اعتراض Cloudflare الذي يحلّ التحدّي بـWebView الجهاز.
 */
class SpikeModule(private val activity: MainActivity) : InjektModule {
    override fun InjektRegistrar.registerInjectables() {
        // Keiyoushi core نفسه يعتمد على Application عبر Injekt (مثل
        // Generated.getBaseUrl للمرايا والتفضيلات). Mangalek أثبت هذا
        // Runtime على الجهاز، لذلك هذا جزء من عقد المستضيف لا workaround.
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
