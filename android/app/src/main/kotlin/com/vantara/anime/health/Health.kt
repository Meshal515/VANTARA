package com.vantara.anime.health

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min

/**
 * صحة كل مصدر وكل سيرفر فيديو.
 *
 * مفتاح واحد لكل «هدف»: `source:<id>` للمصدر، و`host:<مضيف>` لسيرفر الفيديو
 * (dood، ok.ru، mp4upload…). الهدف لا يعرف أي حلقة ولا أي أنمي: الصحة صفة
 * الطريق لا المحتوى.
 *
 * ثلاثة أسئلة يجيب عنها:
 *   - ما ترتيب المصادر/السيرفرات الآن؟ ([HealthPolicy.score])
 *   - هل نتجاوز هذا الهدف مؤقتًا؟ ([HealthPolicy.open]: قاطع دائرة بعد فشل متتالٍ)
 *   - ماذا نعرض في شاشة الصحة؟ ([Record])
 */
@Serializable
data class Record(
    val key: String,
    val ok: Int = 0,
    val fail: Int = 0,
    /** فشل متتالٍ منذ آخر نجاح: يفتح القاطع. */
    val streak: Int = 0,
    val lastOkAt: Long = 0,
    val lastFailAt: Long = 0,
    val lastError: String? = null,
    /** متوسط متحرّك أُسّي لزمن الاستجابة بالمللي ثانية. */
    val latencyMs: Double = 0.0,
    /** الدومين الذي نجح عليه آخر طلب (للمصادر). */
    val domain: String? = null,
    /** سبب حجب لا يحلّه الانتظار: تحقق Cloudflare يحتاج إنسانًا، دومين ميت… */
    val blocked: String? = null,
) {
    val total: Int get() = ok + fail
    val successRate: Double get() = if (total == 0) 1.0 else ok.toDouble() / total
}

object HealthPolicy {
    /** وزن القياس الجديد في المتوسط المتحرّك. */
    const val LATENCY_ALPHA = 0.3

    /** بعد هذا الفشل المتتالي يُتجاوز الهدف مؤقتًا. */
    const val TRIP_STREAK = 3

    /** مدة التجاوز الأولى، وتتضاعف مع كل فشل إضافي حتى [MAX_COOLDOWN_MS]. */
    const val BASE_COOLDOWN_MS = 2 * 60_000L
    const val MAX_COOLDOWN_MS = 60 * 60_000L

    /** السجل القديم يفقد وزنه: مصدر فشل قبل أسبوع لا يُعاقب اليوم. */
    const val DECAY_AFTER_MS = 3 * 24 * 3600_000L

    fun recordOk(r: Record, latencyMs: Long, now: Long, domain: String? = null): Record = r.copy(
        ok = r.ok + 1,
        streak = 0,
        lastOkAt = now,
        latencyMs = if (r.latencyMs == 0.0) latencyMs.toDouble() else r.latencyMs * (1 - LATENCY_ALPHA) + latencyMs * LATENCY_ALPHA,
        domain = domain ?: r.domain,
        blocked = null,
    )

    fun recordFail(r: Record, error: String, now: Long, blocked: String? = null): Record = r.copy(
        fail = r.fail + 1,
        streak = r.streak + 1,
        lastFailAt = now,
        lastError = error.take(200),
        blocked = blocked ?: r.blocked,
    )

    /** هل القاطع مفتوح الآن (نتجاوز الهدف)؟ */
    fun open(r: Record, now: Long): Boolean {
        if (r.streak < TRIP_STREAK) return false
        val cooldown = min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS shl min(10, r.streak - TRIP_STREAK))
        return now - r.lastFailAt < cooldown
    }

    /**
     * درجة الترتيب: أعلى = أفضل. نسبة النجاح (مع تمهيد بيزي كي لا يتصدّر
     * هدفٌ نجح مرة واحدة)، ناقص عقوبة البطء، ناقص عقوبة الفشل الحديث.
     * هدف بلا تاريخ يأخذ درجة وسطى: يُجرَّب لا يُهمل.
     */
    fun score(r: Record?, now: Long): Double {
        if (r == null) return 0.6
        if (r.blocked != null) return -1.0
        val stale = now - max(r.lastOkAt, r.lastFailAt) > DECAY_AFTER_MS
        val ok = if (stale) r.ok / 4.0 else r.ok.toDouble()
        val fail = if (stale) r.fail / 4.0 else r.fail.toDouble()
        val rate = (ok + 3) / (ok + fail + 5) // تمهيد: كأن لكل هدف 3 نجاحات من 5
        val slow = min(0.25, r.latencyMs / 40_000.0)
        val recent = if (open(r, now)) 1.0 else r.streak * 0.08
        return rate - slow - recent
    }
}

/**
 * التخزين: ملف JSON واحد، يُكتب بعد كل تغيير مؤجّلًا ومجمّعًا. القراءة من
 * الذاكرة دائمًا (ترتيب السيرفرات يُسأل عشرات المرات لكل حلقة).
 */
class HealthStore(private val file: File?, private val clock: () -> Long = System::currentTimeMillis) {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
    private val records = ConcurrentHashMap<String, Record>()
    @Volatile private var dirty = false

    init {
        file?.takeIf { it.isFile }?.let { f ->
            runCatching { json.decodeFromString<List<Record>>(f.readText()) }
                .getOrNull()?.forEach { records[it.key] = it }
        }
    }

    fun get(key: String): Record? = records[key]

    fun all(): List<Record> = records.values.sortedBy { it.key }

    fun ok(key: String, latencyMs: Long, domain: String? = null) = update(key) {
        HealthPolicy.recordOk(it, latencyMs, clock(), domain)
    }

    fun fail(key: String, error: String, blocked: String? = null) = update(key) {
        HealthPolicy.recordFail(it, error, clock(), blocked)
    }

    fun unblock(key: String) = update(key) { it.copy(blocked = null, streak = 0) }

    fun score(key: String): Double = HealthPolicy.score(records[key], clock())

    fun skip(key: String): Boolean {
        val r = records[key] ?: return false
        return r.blocked != null || HealthPolicy.open(r, clock())
    }

    /** يرتّب أهدافًا (مصادر أو سيرفرات) من الأصح إلى الأضعف، ويؤخّر المتجاوَزة. */
    fun <T> rank(items: List<T>, keyOf: (T) -> String): List<T> {
        val now = clock()
        return items.sortedWith(
            compareBy<T> { if (skip(keyOf(it))) 1 else 0 }
                .thenByDescending { HealthPolicy.score(records[keyOf(it)], now) },
        )
    }

    private fun update(key: String, f: (Record) -> Record) {
        records.compute(key) { _, old -> f(old ?: Record(key)) }
        dirty = true
    }

    /** يُنادى دوريًّا ومن `onPause`: كتابة واحدة لكل دفعة تغييرات. */
    fun flush() {
        val f = file ?: return
        if (!dirty) return
        dirty = false
        runCatching {
            val tmp = File(f.parentFile, f.name + ".tmp")
            tmp.writeText(json.encodeToString(kotlinx.serialization.builtins.ListSerializer(Record.serializer()), all()))
            tmp.renameTo(f)
        }
    }

    companion object {
        fun sourceKey(id: String) = "source:$id"
        fun hostKey(host: String) = "host:${host.removePrefix("www.").lowercase()}"
    }
}
