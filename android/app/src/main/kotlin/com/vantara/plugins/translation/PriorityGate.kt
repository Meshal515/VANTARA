package com.vantara.plugins.translation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred

/**
 * بوابة واحدة للمسار المحلي الثقيل. الهدف ليس فقط أعلى throughput؛ الأهم أن
 * الصفحة التي انتهت من التحليل لا تبقى إنجليزية بينما صفحة لاحقة تبدأ CTD/LaMa.
 *
 * السياسة:
 *  - كشف RT-DETR للصفحة الحالية فقط يستطيع القفز أولًا.
 *  - Render القارئ يسبق أي كشف استباقي أو Analyze ثقيل آخر.
 *  - ملكية Native تنتهي بانتهاء النداء نفسه. Luna لا تملك ولا تحجز هذه البوابة.
 *  - ترتيب Render/Detect/Analyze يطبق فقط عند handoff بين نداءات Native الجاهزة.
 */
class PriorityGate {
    companion object {
        const val DETECT = 0
        const val RENDER_READER = 1
        const val ANALYZE_READER = 2
        const val RENDER_JOB = 3
        const val ANALYZE_JOB = 4
        const val BACKGROUND = 5
    }

    data class Page(val chapter: String, val index: Int)

    private class Waiter(val rank: Int, val seq: Long, val page: Page?) {
        val go = CompletableDeferred<Unit>()
    }

    private val queue = ArrayList<Waiter>()
    private var busy = false
    private var seq = 0L
    private var busyNanos = 0L
    private var firstUse = 0L
    @Volatile private var focus: Page? = null

    fun focus(page: Page?, pageCount: Int? = null) {
        val next = synchronized(this) {
            focus = page
            if (!busy) grantNextLocked() else null
        }
        next?.go?.complete(Unit)
    }

    private fun focused(page: Page?): Boolean = page != null && page == focus

    /**
     * Compatibility hooks for older bridge code. Stage-separated translation
     * deliberately keeps no Native reservation while Luna/network is pending.
     */
    fun expectRender(page: Page?) { @Suppress("UNUSED_VARIABLE") val ignored = page }
    fun cancelExpectedRender(page: Page?) { @Suppress("UNUSED_VARIABLE") val ignored = page }

    private fun distance(p: Page?): Int {
        val f = focus ?: return 0
        if (p == null) return 0
        if (p.chapter != f.chapter) return 100_000 + p.index
        if (p == f) return 0
        val d = p.index - f.index
        if (d == 0) return 0
        if (d > 0 && d <= 3) return d
        if (d < 0) return 10 + (-d)
        return 100 + d
    }

    /**
     * أولوية تجربة القراءة:
     * current detect -> any ready reader render -> other detect -> heavy reader analyze
     * -> foreground job render/analyze -> background refinement.
     */
    private fun priorityClass(w: Waiter): Int {
        if (w.rank == DETECT) {
            val f = focus
            return if (f == null || w.page == null || focused(w.page)) 0 else 2
        }
        return when (w.rank) {
            RENDER_READER -> 1
            RENDER_JOB -> if (focused(w.page)) 1 else 4
            ANALYZE_READER -> 3
            ANALYZE_JOB -> if (focused(w.page)) 3 else 5
            else -> 6
        }
    }

    private fun better(a: Waiter, b: Waiter): Boolean {
        val ca = priorityClass(a); val cb = priorityClass(b)
        if (ca != cb) return ca < cb
        // Reader and prefetch work inside the same class still follows distance.
        // Otherwise ANALYZE_JOB reverts to FIFO and a far future page can beat
        // the page the reader just reached.
        if (ca <= 5) {
            val da = distance(a.page); val db = distance(b.page)
            if (da != db) return da < db
        }
        if (a.rank != b.rank) return a.rank < b.rank
        return a.seq < b.seq
    }

    suspend fun <T> run(rank: Int, perf: Perf, page: Page? = null, block: () -> T): T {
        val started = System.nanoTime()
        val waiter = synchronized(this) {
            if (firstUse == 0L) firstUse = started
            val candidate = Waiter(rank, seq++, page)
            if (!busy) {
                busy = true
                null
            } else {
                queue.add(candidate)
                candidate
            }
        }
        if (waiter != null) {
            try {
                waiter.go.await()
            } catch (e: CancellationException) {
                val granted = synchronized(this) { !queue.remove(waiter) }
                if (granted) release()
                throw e
            }
        }
        perf.add("queue", System.nanoTime() - started)
        val t = System.nanoTime()
        try {
            return block()
        } finally {
            synchronized(this) { busyNanos += System.nanoTime() - t }
            release()
        }
    }

    /** يختار أول عمل مسموح به حاليًا؛ المحجوب يبقى في الطابور. */
    private fun grantNextLocked(): Waiter? {
        var best: Waiter? = null
        for (w in queue) {
            if (best == null || better(w, best)) best = w
        }
        if (best == null) return null
        queue.remove(best)
        busy = true
        return best
    }

    private fun release() {
        val next = synchronized(this) {
            busy = false
            grantNextLocked()
        }
        next?.go?.complete(Unit)
    }

    fun isBusy(): Boolean = synchronized(this) { busy }

    fun busyPercent(): Int = synchronized(this) {
        val wall = System.nanoTime() - firstUse
        if (firstUse == 0L || wall <= 0) 0 else (100 * busyNanos / wall).toInt()
    }
}
