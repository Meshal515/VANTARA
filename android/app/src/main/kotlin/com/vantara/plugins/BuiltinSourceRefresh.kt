package com.vantara.plugins

import dev.vantara.spike.SourceSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import java.io.File

/**
 * فصل مصادر المانجا المدمجة عن التطبيق دون أن يشعر أحد: المصدر يبقى بمعرّفه نفسه (`pkg` أو `pkg:lang`)
 * في المكتبة والتقدّم والإعدادات، لكن ملفه لا يلزم أن يكون داخل التطبيق.
 *
 * حين لا توجد نسخة صالحة في الجهاز ولا في التطبيق، يُقرأ فهرس Keiyoushi الرسمي (مصدر هذه الإضافات
 * نفسها) ويُنزَّل إصدارها الحالي، ويُقبل فقط إن:
 *  - وقّعه مفتاح Keiyoushi المثبّت هنا (لا يُقبل مفتاح يعلنه المستودع إن تغيّر)،
 *  - وكان للحزمة نفسها وبواجهة الإضافات نفسها التي يدعمها التطبيق.
 * ويُحفظ إصداره (البصمة والرابط) على الجهاز فيُحمَّل من ذاكرة الجهاز في المرات التالية بلا شبكة.
 */
class BuiltinSourceRefresh(private val file: File) {
    /** إصدار مثبّت، ومعه آخر إصدار سليم قبله (Last Known Good) ليُرجع إليه إن تعطّل هذا على الجهاز. */
    @Serializable
    data class Pinned(val sha256: String, val apkUrl: String, val versionName: String, val lib: Double, val previous: Pinned? = null, val code: Long = 0)

    private val json = Json { ignoreUnknownKeys = true }
    private val codec = MapSerializer(String.serializer(), Pinned.serializer())
    @Volatile private var pins: Map<String, Pinned> =
        runCatching { json.decodeFromString(codec, file.readText()) }.getOrDefault(emptyMap())

    /** المواصفة الفعلية: آخر إصدار رسمي نُزّل لهذه الحزمة إن وُجد، وإلا المضمّنة كما هي. */
    fun current(base: SourceSpec): SourceSpec = pins[base.pkg]?.let { base.with(it) } ?: base

    /** آخر إصدار سليم قبل الحالي إن وُجد (ملفه في مخزن الجهاز)، وإلا null. */
    fun previousOf(base: SourceSpec): SourceSpec? = pins[base.pkg]?.previous?.let { base.with(it) }

    private fun SourceSpec.with(pin: Pinned) = copy(sha256 = pin.sha256, apkUrl = pin.apkUrl, versionName = pin.versionName, expectedLib = pin.lib)

    /**
     * الإصدار الحالي من مستودع Keiyoushi موقّعًا بمفتاحه، أو null (شبكة، حزمة أُزيلت، واجهة غير مدعومة).
     * لا يرمي ولا يحفظ شيئًا: الإصدار يُثبَّت بـ[confirm] فقط بعد أن تُحمَّل الحزمة وتُخرج مصادرها، فحزمة
     * تالفة أو غير متوافقة لا تحلّ محلّ نسخة الجهاز العاملة (فشل التنزيل يترك الحالة السابقة كما هي).
     */
    fun fromRepository(
        base: SourceSpec,
        repo: RepoClient,
        index: Pair<RepoIndex.Meta, List<RepoIndex.Extension>>? = null,
        onlyIfNewer: Boolean = false,
    ): Pair<SourceSpec, ByteArray>? = runCatching {
        // فهرس قُرئ مرة لكل المدمجة (التحقق اليومي) أو يُقرأ هنا لحزمة واحدة
        val (meta, list) = index ?: repo.read(KEIYOUSHI_BASE)
        // المفتاح المثبّت هنا هو المرجع، لا ما يعلنه المستودع: تغيّر المفتاح يوقف التنزيل
        require(meta.fingerprint == KEIYOUSHI_KEY) { "Keiyoushi signing key changed" }
        val ext = list.firstOrNull { it.pkg == base.pkg } ?: return null
        // الإصدار نفسه المثبّت لا يُنزَّل من جديد: لا تغيير يُنتظر منه
        if (onlyIfNewer && ext.version == current(base).versionName) return null
        // أي واجهة يحمّلها المحرك، لا واجهة الإصدار المثبّت وحدها: Mangalek وMangaSpark مثبّتان على 1.4 والرسمي
        // صار 1.6 (يقرأ حتى صورة في الفحص الحي). اشتراط 1.4 تركهما بلا نسخة بعد فصل المدمجة، وجمّدهما قبله
        if (!acceptsLib(ext.lib)) return null
        // لا رجوع لإصدار أقدم من المثبّت على الجهاز: فهرس قديم أو متلاعب به لا يعيد إصدارًا مُستبدلًا
        val have = pins[base.pkg]?.code ?: 0
        if (ext.versionCode in 1 until have) return null
        val bytes = repo.downloadSigned(ext.apkUrl, KEIYOUSHI_KEY)
        val sha = sha256Hex(bytes)
        if (ext.versionCode > 0) codes[sha] = ext.versionCode
        base.copy(sha256 = sha, apkUrl = ext.apkUrl, versionName = ext.version, expectedLib = ext.lib) to bytes
    }.getOrNull()

    /** رقم الإصدار المعلن لكل ما نُزّل (بالبصمة)، يُحفظ مع تثبيته فيُمنع لاحقًا الرجوع لما قبله. */
    private val codes = java.util.concurrent.ConcurrentHashMap<String, Long>()

    /** يثبّت إصدارًا نُزّل بعد نجاح تحميله فعلًا. الكتابة ذرّية: ملف مؤقت ثم إعادة تسمية. */
    @Synchronized fun confirm(spec: SourceSpec) {
        val old = pins[spec.pkg]
        if (old?.sha256.equals(spec.sha256, ignoreCase = true)) return
        // السابق يُحفظ بلا سابقه: سجل من خطوة واحدة يكفي ولا ينمو بلا حد
        val code = codes.remove(spec.sha256) ?: 0
        write(pins + (spec.pkg to Pinned(spec.sha256, spec.apkUrl, spec.versionName, spec.expectedLib, old?.copy(previous = null), code)))
    }

    /**
     * الإصدار الحالي تعطّل على هذا الجهاز: يُرجع إلى آخر سليم قبله، أو إلى النسخة المضمّنة إن لم يوجد.
     * @return البصمات التي بقيت مرجعًا (لتنظيف المخزن مما عداها)
     */
    @Synchronized fun rollback(pkg: String): Set<String> {
        val prev = pins[pkg]?.previous
        write(if (prev != null) pins + (pkg to prev) else pins - pkg)
        return setOfNotNull(prev?.sha256)
    }

    /** النسخة المضمّنة في التطبيق هي المرجع من جديد (كل إصدار نُزّل بعدها تعطّل على الجهاز). */
    @Synchronized fun reset(pkg: String) { if (pkg in pins) write(pins - pkg) }

    /** البصمات التي يجب أن تبقى في المخزن لهذه الحزمة: الحالي وآخر سليم قبله. */
    fun keep(pkg: String): Set<String> = pins[pkg]?.let { setOfNotNull(it.sha256, it.previous?.sha256) }.orEmpty()

    @Synchronized private fun write(next: Map<String, Pinned>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(codec, next))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        pins = next
    }

    companion object {
        /** واجهات الإضافات التي يحمّلها FileExtensionLoader (LIB_MIN..LIB_MAX فيه، والتحقق النهائي عنده بعد التنزيل). */
        fun acceptsLib(lib: Double): Boolean = lib >= 1.4 - 0.0001 && lib <= 1.6 + 0.0001

        const val KEIYOUSHI_BASE = "https://raw.githubusercontent.com/keiyoushi/extensions/repo"
        /** signingKeyFingerprint من repo.json الرسمي لـKeiyoushi (30 أكتوبر 2026). */
        const val KEIYOUSHI_KEY = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"
    }
}

/**
 * آخر ما بلّغته الواجهة من الحزم المدمجة سابقًا الظاهرة للحساب الحالي. null = لم تُبلّغ بعد (أول إقلاع
 * بعد التحديث): عندها يُحمَّل مسبقًا ما له نسخة على الجهاز فقط. ملف تالف يُعامل كأنه غير موجود.
 */
class BuiltinVisibility(private val file: File) {
    private val json = Json { ignoreUnknownKeys = true }
    private val codec = kotlinx.serialization.builtins.ListSerializer(String.serializer())

    fun read(): Set<String>? = runCatching { json.decodeFromString(codec, file.readText()).toSet() }.getOrNull()

    @Synchronized fun write(pkgs: Set<String>) {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(codec, pkgs.sorted()))
        if (!tmp.renameTo(file)) { file.delete(); check(tmp.renameTo(file)) { "تعذر حفظ قائمة المصادر" } }
    }
}
