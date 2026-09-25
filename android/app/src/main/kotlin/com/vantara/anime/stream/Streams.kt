package com.vantara.anime.stream

import com.vantara.anime.health.HealthStore
import kotlinx.serialization.Serializable
import java.net.URI

/**
 * طبقة التشغيل: من «حلقة» إلى قائمة مرشّحين مرتّبة يستلمها المشغّل.
 *
 * فرقان جوهريان عن محرك المانجا:
 *  - **الطريق يُحفظ، الرابط لا.** [ServerRoute] (المصدر + رابط الحلقة + اسم
 *    السيرفر) ثابت ويُحفظ. [Candidate] (رابط m3u8/mp4 النهائي) قصير العمر،
 *    يُحل وقت التشغيل وينتهي بـ[Candidate.expiresAt].
 *  - **الرابط لا يكفي وحده.** الهيدرز (Referer/Origin/User-Agent) والكوكيز
 *    (cf_clearance) والترجمات والمسارات الصوتية جزء من المرشّح نفسه.
 */

enum class Variant { SUB, DUB, RAW, UNKNOWN }

enum class Container { HLS, DASH, MP4, UNKNOWN }

@Serializable
data class ServerRoute(
    val sourceId: String,
    /** رابط الحلقة داخل المصدر (بلا دومين)، كما أرجعته الإضافة. */
    val episodeUrl: String,
    val episodeNumber: Float,
    val server: String,
)

@Serializable
data class TrackRef(val url: String, val lang: String)

@Serializable
data class Candidate(
    val id: String,
    val sourceId: String,
    val sourceName: String,
    /** اسم السيرفر كما يعرضه المصدر («Dood mirror», «ok.ru 720p»…). */
    val server: String,
    /** مضيف الفيديو الفعلي: مفتاح صحته. */
    val host: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val quality: Int? = null,
    val label: String = "",
    val variant: Variant = Variant.UNKNOWN,
    val container: Container = Container.UNKNOWN,
    val subtitles: List<TrackRef> = emptyList(),
    val audio: List<TrackRef> = emptyList(),
    val resolvedAt: Long,
    val expiresAt: Long,
)

object StreamClassifier {
    private val DUB = Regex("(مدبلج|دبلجة|dub(bed)?\\b|arabic\\s*dub)", RegexOption.IGNORE_CASE)
    private val SUB = Regex("(مترجم|ترجمة|\\bsub(bed|s)?\\b|softsub|hardsub)", RegexOption.IGNORE_CASE)
    private val RAW = Regex("\\braw\\b", RegexOption.IGNORE_CASE)
    private val QUALITY = Regex("(2160|1440|1080|720|576|480|360|240)\\s*p?", RegexOption.IGNORE_CASE)

    fun variant(vararg texts: String?): Variant {
        val t = texts.filterNotNull().joinToString(" ")
        return when {
            DUB.containsMatchIn(t) -> Variant.DUB
            RAW.containsMatchIn(t) -> Variant.RAW
            SUB.containsMatchIn(t) -> Variant.SUB
            else -> Variant.UNKNOWN
        }
    }

    fun quality(vararg texts: String?): Int? =
        texts.filterNotNull().firstNotNullOfOrNull { QUALITY.find(it)?.groupValues?.get(1)?.toIntOrNull() }

    fun container(url: String, contentType: String? = null): Container {
        val path = runCatching { URI(url).path.lowercase() }.getOrDefault(url.lowercase())
        val ct = contentType?.lowercase().orEmpty()
        return when {
            path.endsWith(".m3u8") || "mpegurl" in ct -> Container.HLS
            path.endsWith(".mpd") || "dash" in ct -> Container.DASH
            path.endsWith(".mp4") || path.endsWith(".mkv") || path.endsWith(".webm") || ct.startsWith("video/") -> Container.MP4
            else -> Container.UNKNOWN
        }
    }

    fun host(url: String): String = runCatching { URI(url).host?.removePrefix("www.")?.lowercase() }.getOrNull() ?: "unknown"

    /**
     * كم يعيش الرابط؟ روابط الاستضافات عادةً موقّعة بوقت: نعطيها أقل من أقصر
     * توقيع شائع. رابط فيه `expires=`/`e=` نقرأ وقته منه.
     */
    fun expiresAt(url: String, now: Long): Long {
        val q = runCatching { URI(url).rawQuery }.getOrNull().orEmpty()
        val explicit = Regex("(?:^|&)(?:expires|exp|e)=(\\d{10})").find(q)?.groupValues?.get(1)?.toLongOrNull()
        if (explicit != null) return minOf(explicit * 1000 - 30_000, now + DEFAULT_TTL_MS)
        return now + DEFAULT_TTL_MS
    }

    const val DEFAULT_TTL_MS = 10 * 60_000L
}

data class Preferences(
    val quality: Int = 1080,
    val variant: Variant = Variant.SUB,
)

/**
 * ترتيب المرشّحين: الصحة أولًا (سيرفر يفشل كل مرة لا يهم أنه 1080)، ثم
 * النسخة المفضّلة (مترجم/مدبلج)، ثم قرب الجودة من المفضّلة، ثم الصيغة
 * (HLS/MP4 المباشر قبل المجهول).
 */
object StreamRanker {
    fun rank(items: List<Candidate>, health: HealthStore, prefs: Preferences, now: Long): List<Candidate> {
        val live = items.filter { it.expiresAt > now }
        return live.sortedWith(
            compareBy<Candidate> { if (health.skip(HealthStore.hostKey(it.host)) || health.skip(HealthStore.sourceKey(it.sourceId))) 1 else 0 }
                .thenByDescending { score(it, health, prefs) },
        )
    }

    fun score(c: Candidate, health: HealthStore, prefs: Preferences): Double {
        val h = health.score(HealthStore.hostKey(c.host)) * 2.0 + health.score(HealthStore.sourceKey(c.sourceId))
        val variant = when {
            c.variant == prefs.variant -> 0.6
            c.variant == Variant.UNKNOWN -> 0.3
            else -> 0.0
        }
        val q = c.quality?.let { 0.5 - kotlin.math.abs(it - prefs.quality) / 2000.0 } ?: 0.2
        val container = when (c.container) {
            Container.HLS, Container.MP4 -> 0.2
            Container.DASH -> 0.15
            Container.UNKNOWN -> 0.0
        }
        return h + variant + q + container
    }
}

/**
 * جلسة تشغيل حلقة: المشغّل يطلب «التالي» عند كل عطل، والجلسة تسجّل الفشل
 * في الصحة وتعطيه المرشّح التالي. تمتلئ وهي تعمل: ورقة السيرفرات تضيف كل
 * سيرفر يجهز ([append])، والمشغّل ينتظر ما يجهز إن فرغت ([changes]).
 *
 * يلمسها خيطان (المشغّل والحل في الخلفية)، فكل ما فيها متزامن.
 */
class PlaybackSession(
    candidates: List<Candidate>,
    private val health: HealthStore,
) {
    private val queue = ArrayDeque(candidates)
    private val tried = mutableListOf<Candidate>()
    private val failedIds = mutableSetOf<String>()

    /** يزيد مع كل إضافة: من ينتظر مرشّحًا جديدًا يراقبه. */
    val changes = kotlinx.coroutines.flow.MutableStateFlow(0)

    val remaining: Int get() = synchronized(this) { queue.size }

    fun next(): Candidate? = synchronized(this) { queue.removeFirstOrNull()?.also { tried += it } }

    /** اختيار المستخدم من ورقة السيرفرات: هذا المرشّح الآن، والباقي احتياط. */
    fun take(id: String): Candidate? = synchronized(this) {
        val c = queue.firstOrNull { it.id == id } ?: tried.firstOrNull { it.id == id && it.id !in failedIds } ?: return null
        queue.remove(c)
        if (c !in tried) tried += c
        c
    }

    fun started(c: Candidate, startupMs: Long) {
        health.ok(HealthStore.hostKey(c.host), startupMs)
        health.ok(HealthStore.sourceKey(c.sourceId), startupMs)
    }

    fun failed(c: Candidate, error: String): Candidate? {
        health.fail(HealthStore.hostKey(c.host), error)
        synchronized(this) {
            failedIds += c.id
            // سيرفر ميت لا يدين المصدر كله؛ المصدر يُدان فقط إذا ماتت كل سيرفراته
            if (queue.none { it.sourceId == c.sourceId } && tried.count { it.sourceId == c.sourceId } > 0) {
                health.fail(HealthStore.sourceKey(c.sourceId), "كل سيرفرات الحلقة فشلت: $error")
            }
        }
        return next()
    }

    fun isFailed(id: String): Boolean = synchronized(this) { id in failedIds }

    fun find(id: String): Candidate? = synchronized(this) { (tried + queue).firstOrNull { it.id == id } }

    fun append(more: List<Candidate>) {
        synchronized(this) {
            val seen = (tried + queue).map { it.url }.toSet()
            queue.addAll(more.filter { it.url !in seen })
        }
        changes.value = changes.value + 1
    }

    /** يعيد ترتيب ما لم يُجرَّب بعد (الأفضل أولًا) كلما جهز سيرفر جديد. */
    fun reorder(rank: (List<Candidate>) -> List<Candidate>) = synchronized(this) {
        val sorted = rank(queue.toList())
        queue.clear()
        queue.addAll(sorted)
    }
}
