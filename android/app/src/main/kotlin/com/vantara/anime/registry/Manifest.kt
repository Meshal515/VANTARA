package com.vantara.anime.registry

import com.vantara.anime.net.DomainPlan
import com.vantara.anime.net.UrlRewrite
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * بيان مصادر الأنمي — يصل من الواجهة (حزمة الويب تتحدّث بلا APK، وخادم
 * المزامنة يستطيع تجاوزه فورًا). لا دومين ولا بصمة ولا رابط APK مكتوب في كود
 * أندرويد: كلها هنا.
 */
@Serializable
data class Manifest(
    val version: Int = 1,
    val updatedAt: String? = null,
    val sources: List<SourceEntry> = emptyList(),
)

@Serializable
data class SourceEntry(
    /** معرّف VANTARA الثابت (لا يتغيّر مع الدومين ولا مع إصدار الإضافة). */
    val id: String,
    val name: String,
    val lang: String = "ar",
    val enabled: Boolean = true,
    /** أعلى = يُجرَّب أولًا عند التعادل في الصحة. */
    val priority: Int = 50,
    /** anime | cinema | drama — لتصفية المصادر حسب قسم الواجهة. */
    val content: String = "anime",
    val extension: ExtensionRef? = null,
    val domains: Domains,
    /** كيف يُحلب الكتالوج كاملًا. */
    val catalog: CatalogHint = CatalogHint(),
    /** سبب إيقاف معروف (دومين ميت…): يظهر في شاشة الصحة ولا يُحمَّل. */
    val disabledReason: String? = null,
)

@Serializable
data class ExtensionRef(
    /** حزمة APK الإضافة كما نشرها المستودع. */
    val pkg: String,
    val apk: String,
    val sha256: String,
    val version: String? = null,
    /** اسم المصدر داخل الحزمة إن كانت تحمل أكثر من مصدر. */
    val sourceName: String? = null,
)

@Serializable
data class Domains(
    val current: String,
    val legacy: List<String> = emptyList(),
    val mirrors: List<String> = emptyList(),
    val fingerprint: String? = null,
    val rewrites: List<UrlRewrite> = emptyList(),
) {
    fun plan(extensionBaseUrl: String?): DomainPlan = DomainPlan(
        current = current,
        // مضيف `baseUrl` في كود الإضافة قديم بالتعريف إن خالف الحالي
        legacy = (legacy + listOfNotNull(extensionBaseUrl)).toSet(),
        mirrors = mirrors.toSet(),
        fingerprint = fingerprint,
        rewrites = rewrites,
    )
}

@Serializable
data class CatalogHint(
    /** popular | latest | search — أي قائمة تغطي الكتالوج كله عند هذا المصدر. */
    val listing: String = "popular",
    /**
     * قائمة الموقع الكاملة إن لم تكشفها الإضافة، مثل `/anime-list?page={page}`
     * (نسبية للدومين النشط). تُحلَّل بمحلّل الإضافة نفسه ([parseWith]).
     */
    val urlTemplate: String? = null,
    /** popular | latest | search: أي محلّل من الإضافة يقرأ صفحات [urlTemplate]. */
    val parseWith: String = "popular",
    /**
     * محدِّدات CSS لبطاقات قائمة الموقع، حين لا يطابقها محلّل الإضافة (محلّلها
     * كُتب لصفحة أخرى). إن وُجدت تُقدَّم على [parseWith].
     */
    val cards: CardSelectors? = null,
    /** طلبات في الثانية أثناء الحلب (أدب مع المصدر). */
    val ratePerSecond: Double = 2.0,
    /** سقف أمان للصفحات لو كذب المصدر في hasNextPage. */
    val maxPages: Int = 5000,
)

@Serializable
data class CardSelectors(
    val card: String,
    /** رابط العمل داخل البطاقة؛ نصّه العنوان إن لم يُعطَ [title]. */
    val link: String = "a",
    val title: String? = null,
    val image: String? = "img",
    /** سمة الصورة (بعض المواقع تكسل التحميل في data-src). */
    val imageAttr: String = "src",
)

object ManifestParser {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    fun parse(text: String): Manifest = json.decodeFromString(Manifest.serializer(), text)

    /** أخطاء البيان تُرفض كاملة قبل أن تمس المحرك. */
    fun validate(m: Manifest): List<String> = buildList {
        val ids = mutableSetOf<String>()
        for (s in m.sources) {
            if (!ids.add(s.id)) add("مكرر: ${s.id}")
            if (!s.domains.current.startsWith("https://") && !s.domains.current.startsWith("http://")) add("${s.id}: current ليس رابطًا")
            s.extension?.let { e ->
                if (!Regex("^[0-9a-fA-F]{64}$").matches(e.sha256)) add("${s.id}: sha256 غير صالح")
                if (!e.apk.startsWith("https://")) add("${s.id}: رابط APK ليس https")
            }
            s.domains.fingerprint?.let { fp -> runCatching { Regex(fp) }.onFailure { add("${s.id}: بصمة ليست Regex صالحة") } }
            for (r in s.domains.rewrites) {
                if (!r.path.startsWith("/") || r.to?.startsWith("/") == false) add("${s.id}: مسار إعادة الكتابة يجب أن يبدأ بـ/")
            }
        }
    }
}
