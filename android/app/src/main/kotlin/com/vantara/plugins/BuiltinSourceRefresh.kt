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
    @Serializable
    data class Pinned(val sha256: String, val apkUrl: String, val versionName: String, val lib: Double)

    private val json = Json { ignoreUnknownKeys = true }
    private val codec = MapSerializer(String.serializer(), Pinned.serializer())
    @Volatile private var pins: Map<String, Pinned> =
        runCatching { json.decodeFromString(codec, file.readText()) }.getOrDefault(emptyMap())

    /** المواصفة الفعلية: آخر إصدار رسمي نُزّل لهذه الحزمة إن وُجد، وإلا المضمّنة كما هي. */
    fun current(base: SourceSpec): SourceSpec = pins[base.pkg]?.let { base.copy(sha256 = it.sha256, apkUrl = it.apkUrl, versionName = it.versionName, expectedLib = it.lib) } ?: base

    /**
     * الإصدار الحالي من مستودع Keiyoushi موقّعًا بمفتاحه، أو null (شبكة، حزمة أُزيلت، واجهة غير مدعومة).
     * لا يرمي: فشله يترك المسار القديم كما هو.
     */
    fun fromRepository(base: SourceSpec, repo: RepoClient): Pair<SourceSpec, ByteArray>? = runCatching {
        val (meta, list) = repo.read(KEIYOUSHI_BASE)
        // المفتاح المثبّت هنا هو المرجع، لا ما يعلنه المستودع: تغيّر المفتاح يوقف التنزيل
        require(meta.fingerprint == KEIYOUSHI_KEY) { "Keiyoushi signing key changed" }
        val ext = list.firstOrNull { it.pkg == base.pkg } ?: return null
        if (kotlin.math.abs(ext.lib - base.expectedLib) > 0.0001) return null
        val bytes = repo.downloadSigned(ext.apkUrl, KEIYOUSHI_KEY)
        val pinned = Pinned(sha256Hex(bytes), ext.apkUrl, ext.version, ext.lib)
        remember(base.pkg, pinned)
        base.copy(sha256 = pinned.sha256, apkUrl = pinned.apkUrl, versionName = pinned.versionName, expectedLib = pinned.lib) to bytes
    }.getOrNull()

    @Synchronized private fun remember(pkg: String, pin: Pinned) {
        val next = pins + (pkg to pin)
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(json.encodeToString(codec, next))
        if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        pins = next
    }

    companion object {
        const val KEIYOUSHI_BASE = "https://raw.githubusercontent.com/keiyoushi/extensions/repo"
        /** signingKeyFingerprint من repo.json الرسمي لـKeiyoushi (30 أكتوبر 2026). */
        const val KEIYOUSHI_KEY = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2"
    }
}
