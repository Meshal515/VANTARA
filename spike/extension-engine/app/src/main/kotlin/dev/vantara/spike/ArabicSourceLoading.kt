package dev.vantara.spike

import eu.kanade.tachiyomi.source.CatalogueSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** سطرٌ في التقرير. الشاشة تعرضه، والخدمة تحفظ آخر خطأ منه لتفسّر الفشل. */
fun interface SourceLoadLog {
    fun line(text: String, bold: Boolean, bad: Boolean)
}

/**
 * تنزيل الحزمة الموثقة وتحميلها ثم استخراج المصادر العربية المقصودة.
 *
 * خرجت من الشاشة لأن خدمة الزحف تحتاجها بلا شاشة. والسلوك نفسه حرفيًّا:
 * نفس الخطوات ونفس الأسطر ونفس القائمة الفارغة عند الفشل.
 *
 * الأهم هنا أننا لا نستعمل `first()`: الإضافة متعددة اللغات قد يكون
 * أول CatalogueSource فيها إنجليزيًا. نطابق source.id الذي جاء من
 * index.json، ثم نستعمل lang=ar fallback فقط للـfallback الخماسي المحلي.
 */
suspend fun loadArabicSources(
    spec: SourceSpec,
    loader: FileExtensionLoader,
    client: OkHttpClient,
    log: SourceLoadLog,
    waiting: (String?) -> Unit,
): List<CatalogueSource> {
    fun line(text: String, bold: Boolean = false, bad: Boolean = false) = log.line(text, bold, bad)

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
                // Extension APK delivery is infrastructure, not source health.
                // A short Android DNS outage must not permanently condemn the
                // next source (the previous run lost Hijala while github.com
                // itself temporarily failed to resolve).
                retryTransientNetwork(maxAttempts = 5, delayMs = 1_000) {
                    client
                        .newCall(Request.Builder().url(spec.apkUrl).build())
                        .execute().use { res ->
                            require(res.isSuccessful) {
                                "HTTP ${res.code} ← ${spec.apkUrl}"
                            }
                            res.body.bytes()
                        }
                }
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

/**
 * لقطة المصادر التي تُربط بها نقاط حفظ الكتالوج.
 *
 * الشاشة والخدمة تحسبانها من نفس المكان: لو اختلفتا لمحت إحداهما نقاط حفظ
 * الأخرى عند أول `ensureSnapshot`.
 */
fun catalogueSnapshotKey(): String = "${spikeBatchFingerprint()}|$CATALOGUE_LISTING_SCHEMA"

fun spikeBatchFingerprint(): String = buildString {
    append(SPIKE_INDEX_COMMIT)
    SPIKE_SOURCES.forEach { append('|').append(it.pkg).append(':').append(it.sha256) }
}
