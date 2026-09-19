package dev.vantara.spike

import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import dalvik.system.DexClassLoader
import eu.kanade.tachiyomi.source.CatalogueSource
import eu.kanade.tachiyomi.source.Source
import eu.kanade.tachiyomi.source.SourceFactory
import java.io.File
import java.security.MessageDigest

/**
 * تحميل إضافة من **ملف** في تخزين التطبيق الخاص، لا من حزمة مثبَّتة.
 *
 * هذا هو الفرق الجوهري عن Mihon. Mihon يمسح الحزم المثبَّتة
 * (`getInstalledPackages`)، فكل إضافة تحتاج نافذة تثبيت يضغطها المستخدم —
 * ولهذا وُجد Shizuku. ونحن نريد ٤٣ مصدرًا جاهزًا من أول تشغيل بلا ضغطة، فلا
 * نستطيع أن نقلّده.
 *
 * والمسار هنا: ننزّل الـAPK إلى مجلدنا الخاص، نتحقق من بصمته، نجعله
 * للقراءة فقط، ثم نحمّله بـ`DexClassLoader`. ولا نحتاج تثبيتًا ولا صلاحية.
 *
 * ثلاث حقائق منصّة تحكم هذا الملف:
 *
 * 1. **أندرويد ١٤ (API 34) يرفض تحميل كود من ملف قابل للكتابة.** لا مجال
 *    للاختيار: الملف يُجعل read-only **قبل** التحميل، ويُتحقق من ذلك فعلًا —
 *    لأن `setWritable` ترجع منطقيًّا ويمكن أن تفشل بصمت.
 *
 * 2. **`getPackageArchiveInfo` يعمل على مسار ملف** ويعطي `metaData`، ومنه
 *    نقرأ `tachiyomi.extension.class` وإصدار المكتبة. لكنه **لا يعطي
 *    التوقيع** لأرشيف غير مثبَّت. فالتحقق هنا بـSHA‑256 للملف نفسه مقابل
 *    بصمة مثبَّتة عندنا — وهو أقوى من تثبيت الشهادة: يثبّت البايتات ذاتها.
 *
 * 3. **الإضافة تشير إلى أسماء المستضيف الكاملة** (`eu.kanade.tachiyomi.*`)
 *    ولا تشحنها. فالمحمِّل يجب أن يرى أصنافنا: نمرّر `classLoader` الخاص بنا
 *    كأب. والعكس — أن نمنعه — يعني `NoClassDefFoundError` فورًا.
 */
class FileExtensionLoader(private val context: Context) {

    data class Loaded(
        val pkg: String,
        val libVersion: Double,
        val sources: List<Source>,
    )

    sealed class Result {
        data class Ok(val loaded: Loaded) : Result()
        /** `stage` يقول أين سقط بالضبط، فالتشخيص لا يحتاج تخمينًا. */
        data class Fail(val stage: String, val reason: String, val cause: Throwable? = null) :
            Result()
    }

    private val dir: File by lazy {
        File(context.filesDir, "extensions").apply { mkdirs() }
    }

    /** مجلد التحسين الذي يطلبه `DexClassLoader`. لا يجوز أن يكون مشتركًا. */
    private val optDir: File by lazy {
        File(context.codeCacheDir, "ext-opt").apply { mkdirs() }
    }

    /**
     * يرجع APK المحلي فقط إذا بقيت بايتاته مطابقة للبصمة المثبّتة.
     * بذلك لا نعتمد على GitHub في كل تشغيل، ولا نثق بملف cache لمجرد وجوده.
     */
    fun readVerifiedCache(spec: SourceSpec): ByteArray? {
        val apk = File(dir, "${spec.pkg}.apk")
        if (!apk.isFile) return null
        val bytes = runCatching { apk.readBytes() }.getOrNull() ?: return null
        return bytes.takeIf {
            spec.sha256.equals(sha256(it), ignoreCase = true)
        }
    }

    fun load(spec: SourceSpec, apkBytes: ByteArray): Result {
        // ١) البصمة قبل أي شيء: لا نكتب بايتًا لم نتحقق منه في مكان نُحمّل منه
        val actual = sha256(apkBytes)
        if (!spec.sha256.equals(actual, ignoreCase = true)) {
            return Result.Fail(
                "verify",
                "sha256 mismatch: expected ${spec.sha256.take(16)}… got ${actual.take(16)}…",
            )
        }

        val apk = File(dir, "${spec.pkg}.apk")
        try {
            // ملفٌ قديم قد يكون read-only من تحميل سابق، فالكتابة عليه تفشل
            if (apk.exists()) {
                apk.setWritable(true, true)
                apk.delete()
            }
            apk.writeBytes(apkBytes)
        } catch (t: Throwable) {
            return Result.Fail("write", "cannot write apk into private storage", t)
        }

        // ٢) للقراءة فقط، ويُتحقق. أندرويد ١٤+ يرمي عند التحميل لو بقي قابلًا
        //    للكتابة، و`setWritable` قد ترجع false بلا أن ترمي.
        apk.setWritable(false, false)
        if (apk.canWrite()) {
            return Result.Fail(
                "readonly",
                "apk is still writable; Android 14+ refuses to load writable dex",
            )
        }

        // ٣) البيانات الوصفية من الأرشيف نفسه، بلا تثبيت
        val meta: Bundle = try {
            @Suppress("DEPRECATION")
            val info = context.packageManager.getPackageArchiveInfo(
                apk.absolutePath,
                PackageManager.GET_META_DATA,
            ) ?: return Result.Fail("parse", "getPackageArchiveInfo returned null")
            @Suppress("DEPRECATION")
            info.applicationInfo?.metaData
                ?: return Result.Fail("parse", "apk carries no application metaData")
        } catch (t: Throwable) {
            return Result.Fail("parse", "cannot parse apk archive", t)
        }

        val libVersion = readLibVersion(meta)
            ?: return Result.Fail("lib", "no extension lib version in metaData")
        if (libVersion !in LIB_MIN..LIB_MAX) {
            return Result.Fail("lib", "unsupported extension lib $libVersion")
        }

        val classNames = meta.getString(METADATA_CLASS)
            ?: meta.getString(METADATA_FACTORY)
            ?: return Result.Fail("lib", "no $METADATA_CLASS in metaData")

        // ٤) المحمِّل. أبوه محمِّلنا، فترى الإضافة أصناف `eu.kanade.tachiyomi.*`
        val loader = try {
            DexClassLoader(apk.absolutePath, optDir.absolutePath, null, javaClass.classLoader)
        } catch (t: Throwable) {
            return Result.Fail("classloader", "DexClassLoader refused the apk", t)
        }

        // ٥) الإنشاء. الأسماء مفصولة بفاصلة عند مصدرٍ متعدّد.
        val sources = mutableListOf<Source>()
        for (name in classNames.split(";", ",").map { it.trim() }.filter { it.isNotEmpty() }) {
            val fq = if (name.startsWith(".")) spec.pkg + name else name
            val instance = try {
                loader.loadClass(fq).getDeclaredConstructor().newInstance()
            } catch (t: Throwable) {
                return Result.Fail("instantiate", "cannot construct $fq", t)
            }
            when (instance) {
                is SourceFactory -> sources += instance.createSources()
                is Source -> sources += instance
                else -> return Result.Fail("instantiate", "$fq is neither Source nor SourceFactory")
            }
        }

        val catalogue = sources.filterIsInstance<CatalogueSource>()
        if (catalogue.isEmpty()) {
            return Result.Fail("instantiate", "extension exposed no CatalogueSource")
        }
        return Result.Ok(Loaded(spec.pkg, libVersion, sources))
    }

    /**
     * إصدار المكتبة.
     *
     * الحقل الصريح أولًا، وإلا فمن `versionName`: آخر جزء يُقطع فيبقى
     * `1.4.65` → `1.4`. وهذه قاعدة Mihon نفسها، لا اجتهاد.
     */
    private fun readLibVersion(meta: Bundle): Double? {
        val explicit = meta.get(METADATA_LIB)
        when (explicit) {
            is Double -> return explicit
            // Android يخزّن tachiyomix.extensionLib كـ Float في هذه الإضافات.
            // تحويل Float مباشرةً إلى Double يكشف خطأ التمثيل الثنائي:
            // 1.4f -> 1.399999976158142 و 1.6f -> 1.600000023841858،
            // فيرفضهما فحص النطاق رغم أنهما 1.4/1.6 فعلًا.
            // Float.toString() يعيد التمثيل العشري المقصود ثم نقرأه Double.
            is Float -> return explicit.toString().toDoubleOrNull()
            is String -> explicit.toDoubleOrNull()?.let { return it }
        }
        return null
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    private companion object {
        const val METADATA_CLASS = "tachiyomi.extension.class"
        const val METADATA_FACTORY = "tachiyomi.extension.factory"
        const val METADATA_LIB = "tachiyomix.extensionLib"
        const val LIB_MIN = 1.4
        const val LIB_MAX = 1.6
    }
}
