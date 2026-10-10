package com.vantara.anime.player.together

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sign

/**
 * VANTARA Together — الساعة المشتركة ومتحكّم الانحراف، نقلٌ حرفي لـ
 * `apps/web/lib/together/sync.js` (نفس القواعد ونفس الأرقام، ونفس الاختبارات).
 *
 *   |e| < 60ms           ← لا شيء.
 *   انحراف ثابت فوق 60ms ← سرعة متناسبة: 1 − e/2.5s بين ±1% و±8%، حتى 20ms ثم 1×.
 *   قفز                  ← 400ms إن كان الهدف داخل المخزَّن، وإلا 1.5s. ثم 3 ث بلا قفز.
 *   أمر المضيف           ← يُتبع فورًا. أثناء التحميل ← لا تصحيح.
 */
data class Timeline(
    val mediaKey: String?,
    val mediaLabel: String?,
    val started: Boolean,
    val playing: Boolean,
    val pos: Double,
    val at: Double,
    val rate: Double,
    val seq: Int,
)

data class Decision(val playing: Boolean, val rate: Double, val seekTo: Long?, val error: Double?, val reason: String)

object SyncRules {
    const val DEADBAND_MS = 60.0
    const val EXIT_MS = 20.0
    const val CONFIRM = 2
    const val TAU_MS = 2500.0
    const val MIN_STEP = 0.01
    const val MAX_STEP = 0.08
    const val SEEK_BUFFERED_MS = 400.0
    const val SEEK_MS = 1500.0
    const val SEEK_NO_RATE_MS = 1000.0
    const val COOLDOWN_MS = 3000.0
    const val HOST_CMD_SEEK_MS = 250.0
    const val PAUSED_SEEK_MS = 100.0
    const val SAMPLES = 3
}

/** ساعة الخادم من عينات ping/pong: أقل زمن ذهاب وإياب من آخر 8 عينات. [now] ساعة رتيبة بالمللي ثانية. */
class SharedClock(private val now: () -> Double, private val keep: Int = 8) {
    private data class Sample(val rtt: Double, val offset: Double)
    private val samples = ArrayDeque<Sample>()
    private var best: Sample? = null

    @Synchronized fun sample(t0: Double, ts: Double, t1: Double = now()) {
        val rtt = t1 - t0
        if (rtt < 0 || rtt.isNaN() || ts.isNaN()) return
        samples.addLast(Sample(rtt, ts - (t0 + rtt / 2)))
        while (samples.size > keep) samples.removeFirst()
        best = samples.minByOrNull { it.rtt }
    }
    val ready get() = best != null
    val offset get() = best?.offset ?: 0.0
    val rtt get() = best?.rtt
    fun serverNow(at: Double = now()) = at + offset
}

fun targetAt(t: Timeline, at: Double, offsetMs: Double = 0.0): Double {
    val base = if (t.playing) t.pos + max(0.0, at - t.at) * t.rate else t.pos
    return max(0.0, base + offsetMs)
}

/** وسيط محافظ: في العدد الزوجي الأقرب للصفر، فقراءة شاذة واحدة لا تقرّر وحدها. */
internal fun conservativeMedian(xs: List<Double>): Double {
    val s = xs.sorted()
    if (s.size % 2 == 1) return s[(s.size - 1) / 2]
    val a = s[s.size / 2 - 1]
    val b = s[s.size / 2]
    return if (abs(a) <= abs(b)) a else b
}

class DriftController {
    private var errors = ArrayList<Double>()
    private var correcting = false
    private var over = 0
    private var cooldownUntil = Double.NEGATIVE_INFINITY
    private var lastSeq: Int? = null
    var loadMs = 800.0
        private set
    private val drift = ArrayDeque<Double>()

    private fun reset() { errors = ArrayList(); correcting = false; over = 0 }

    private fun cheapSeek(e: Double, ahead: Double, behind: Double) = if (e < 0) ahead >= -e + 500 else behind >= e

    fun step(
        timeline: Timeline,
        pos: Double,
        at: Double,
        buffering: Boolean = false,
        canRate: Boolean = true,
        bufferedAhead: Double = 0.0,
        bufferedBehind: Double = 0.0,
        offsetMs: Double = 0.0,
    ): Decision {
        val target = targetAt(timeline, at, offsetMs)
        val e = pos - target
        val hostCommand = lastSeq != null && timeline.seq != lastSeq
        lastSeq = timeline.seq
        fun seekTarget(cheap: Boolean) = targetAt(timeline, at + if (cheap || !timeline.playing) 0.0 else loadMs, offsetMs).toLong()

        if (hostCommand) {
            reset()
            if (abs(e) > SyncRules.HOST_CMD_SEEK_MS) {
                cooldownUntil = at + SyncRules.COOLDOWN_MS
                return Decision(timeline.playing, 1.0, seekTarget(cheapSeek(e, bufferedAhead, bufferedBehind)), e, "host-command")
            }
        }
        if (buffering) { reset(); return Decision(timeline.playing, 1.0, null, e, "buffering") }
        if (!timeline.playing) {
            reset()
            val far = abs(e) > SyncRules.PAUSED_SEEK_MS
            return Decision(false, 1.0, if (far) target.toLong() else null, e, if (far) "paused-align" else "paused")
        }
        drift.addLast(abs(e))
        while (drift.size > 60) drift.removeFirst()
        errors.add(e)
        while (errors.size > SyncRules.SAMPLES) errors.removeAt(0)
        if (errors.size < 2) return Decision(true, 1.0, null, e, "settling")
        val sm = conservativeMedian(errors)
        val a = abs(sm)

        val cheap = cheapSeek(sm, bufferedAhead, bufferedBehind)
        val jumpAt = if (cheap) SyncRules.SEEK_BUFFERED_MS else if (canRate) SyncRules.SEEK_MS else SyncRules.SEEK_NO_RATE_MS
        if (a >= jumpAt && at >= cooldownUntil) {
            reset()
            cooldownUntil = at + SyncRules.COOLDOWN_MS
            return Decision(true, 1.0, seekTarget(cheap), e, if (cheap) "seek-buffered" else "seek")
        }
        if (!canRate) return Decision(true, 1.0, null, e, "no-rate")
        if (correcting) {
            if (a < SyncRules.EXIT_MS) { reset(); return Decision(true, 1.0, null, e, "in-sync") }
        } else if (a > SyncRules.DEADBAND_MS) {
            over += 1
            if (over >= SyncRules.CONFIRM) correcting = true
        } else over = 0
        if (!correcting) return Decision(true, 1.0, null, e, "in-sync")
        val step = min(SyncRules.MAX_STEP, max(SyncRules.MIN_STEP, a / SyncRules.TAU_MS))
        return Decision(true, 1 - sign(sm) * step, null, e, "rate")
    }

    fun seeked(msToReady: Long) {
        if (msToReady >= 0) loadMs = min(3000.0, loadMs * 0.6 + msToReady * 0.4)
    }

    /** p50 وp95 لـ|e|. */
    fun stats(): Pair<Long?, Long?> {
        if (drift.isEmpty()) return null to null
        val s = drift.sorted()
        fun q(p: Double) = Math.round(s[min(s.size - 1, floor(p * s.size).toInt())])
        return q(0.5) to q(0.95)
    }
}
