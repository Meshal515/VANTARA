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
    /** محوّل VANTARA أصلي بدل الإضافة (مثل `witanime-site`)؛ يُقدَّم عليها إن وُجد الاثنان. */
    val adapter: String? = null,
    val domains: Domains,
    /** سيرفرات الحلقة من صفحتها مباشرة، حين لا تجد الإضافة أي سيرفر (صفحة تغيّر شكلها). */
    val embeds: PageEmbeds? = null,
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

/**
 * مثال OkAnime: `<a class="ep-link" data-server="vk" data-umami-event-quality="720p"
 * @click="setServer('https://vkvideo.ru/…')">`. الإضافة 14.26 تبحث عن `data-src`.
 */
@Serializable
data class PageEmbeds(
    /** عناصر السيرفرات في صفحة الحلقة. */
    val selector: String,
    /** السمة التي تحمل رابط صفحة المشغّل. */
    val attr: String,
    /** Regex مجموعته الأولى هي الرابط داخل السمة؛ غيابه = السمة كلها رابط. */
    val pattern: String? = null,
    val nameAttr: String? = null,
    val qualityAttr: String? = null,
) {
    data class Embed(val url: String, val name: String, val quality: Int?)

    fun extract(html: String, pageUrl: String): List<Embed> {
        val re = pattern?.let(::Regex)
        return org.jsoup.Jsoup.parse(html, pageUrl).select(selector).mapNotNull { el ->
            val raw = el.attr(attr).ifBlank { return@mapNotNull null }
            val url = (if (re != null) re.find(raw)?.groupValues?.getOrNull(1) else raw)?.trim()
                ?.takeIf { it.startsWith("http") } ?: return@mapNotNull null
            val name = nameAttr?.let { el.attr(it) }?.ifBlank { null } ?: el.text().trim()
            val quality = qualityAttr?.let { el.attr(it) }?.let { com.vantara.anime.stream.StreamClassifier.quality(it) }
            Embed(url, name, quality)
        }.distinctBy { it.url }
    }
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

    /** المحوّلات الأصلية التي يعرفها هذا الإصدار من التطبيق. */
    val NATIVE_ADAPTERS = setOf(com.vantara.anime.adapters.WitAnimeSiteAdapter.KIND)

    fun parse(text: String): Manifest = json.decodeFromString(Manifest.serializer(), text)

    /** أخطاء البيان تُرفض كاملة قبل أن تمس المحرك. */
    fun validate(m: Manifest): List<String> = buildList {
        val ids = mutableSetOf<String>()
        for (s in m.sources) {
            if (!ids.add(s.id)) add("مكرر: ${s.id}")
            s.adapter?.let { if (it !in NATIVE_ADAPTERS) add("${s.id}: محوّل غير معروف «$it»") }
            s.embeds?.pattern?.let { p -> runCatching { Regex(p) }.onFailure { add("${s.id}: نمط السيرفرات ليس Regex صالحًا") } }
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
