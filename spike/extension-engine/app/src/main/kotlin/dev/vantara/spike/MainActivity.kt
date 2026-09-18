package dev.vantara.spike

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
            setOnClickListener { it.isEnabled = false; runAll() }
        }
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(run)
        root.addView(ScrollView(this).apply { addView(log) })
        setContentView(root)

        line("VANTARA — محرك الإضافات المحلي", bold = true)
        line("بلا Suwayomi · بلا سيرفر · بلا تثبيت إضافات يدويًّا")
    }

    private fun runAll() = lifecycleScope.launch {
        val loader = FileExtensionLoader(this@MainActivity)
        val probe = SourceProbe(network.client)

        for (spec in SPIKE_SOURCES) {
            line("")
            line("═══ ${spec.label} ═══", bold = true)
            line("الحزمة ${spec.pkg} · lib ${spec.expectedLib}")

            // ١) التنزيل
            val downloaded: Result<ByteArray> = withContext(Dispatchers.IO) {
                runCatching {
                    network.client.newCall(Request.Builder().url(spec.apkUrl).build())
                        .execute().use { res ->
                            // الرابط في الرسالة: 404 بلا رابط لا يقول أي
                            // رابط سقط، وقد سقط أول تشغيل على هذا بالضبط.
                            require(res.isSuccessful) { "HTTP ${res.code} ← ${spec.apkUrl}" }
                            res.body.bytes()
                        }
                }
            }

            val apk = downloaded.getOrElse {
                line("✗ download — ${it.javaClass.simpleName}: ${it.message}", bad = true)
                continue
            }
            line("✓ download — ${apk.size} بايت")

            // ٢) التحقق والتحميل من ملف
            when (val loaded = withContext(Dispatchers.IO) { loader.load(spec, apk) }) {
                is FileExtensionLoader.Result.Fail -> {
                    line("✗ ${loaded.stage} — ${loaded.reason}", bad = true)
                    loaded.cause?.let { line("   ${it.javaClass.simpleName}: ${it.message}") }
                    continue
                }
                is FileExtensionLoader.Result.Ok -> {
                    val sources = loaded.loaded.sources.filterIsInstance<CatalogueSource>()
                    line("✓ load — ${sources.size} مصدرًا · lib ${loaded.loaded.libVersion}")

                    val source = sources.first()
                    val report = withContext(Dispatchers.IO) { probe.run(spec.label, source) }
                    render(report)
                }
            }
        }
        line("")
        line("انتهى.", bold = true)
    }

    private fun render(report: SourceProbe.Report) {
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
        report.imageUrl?.let { line("   الصورة: ${it.take(90)}") }

        // الصورة على الشاشة: `BitmapFactory` ترفض ما ليس صورة، فهي الحَكَم
        report.imageBytes?.let {
            val url = report.imageUrl ?: return@let
            lifecycleScope.launch {
                val bmp = withContext(Dispatchers.IO) {
                    runCatching {
                        network.client.newCall(Request.Builder().url(url).build())
                            .execute().use { res -> BitmapFactory.decodeStream(res.body.byteStream()) }
                    }.getOrNull()
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
        }

        report.reach?.let { reach ->
            line("── الكتالوج ──", bold = true)
            line("أعمال فريدة: ${reach.uniqueWorks} · صفحات: ${reach.pagesFetched}")
            line(
                if (reach.reachedEnd) {
                    "✓ بلغنا نهاية الكتالوج (${reach.stoppedBecause})"
                } else {
                    "⚠ لم نُثبت النهاية — توقفنا لأن: ${reach.stoppedBecause}"
                },
                bad = !reach.reachedEnd,
            )
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
        addSingletonFactory { NetworkHelper(activity) }
        addSingletonFactory {
            kotlinx.serialization.json.Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            }
        }
    }
}
