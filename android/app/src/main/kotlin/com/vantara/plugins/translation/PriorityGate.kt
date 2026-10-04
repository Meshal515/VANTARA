package com.vantara.plugins.translation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred

/**
 * صفحة واحدة على المعالج في كل مرة (النماذج تستعمل كل الأنوية)، بترتيب ثابت لا
 * بسباق، والدور يُسلَّم مباشرة لمن بعده.
 *
 * صفحات القارئ بالمسافة من صفحتك **الآن** ([focus]): الصفحة التي أمامك أولًا، ثم
 * التالية، وهكذا؛ والمسافة تُحسب لحظة تسليم الدور لا لحظة الوصول، فقفزة للأمام
 * تقدّم صفحتك الجديدة على صفحات طلبتها قبلها. داخل المسافة نفسها: الرتبة ثم
 * الأسبق. المقدّمة والإكمال بعد كل صفحات القارئ.
 * زمن الانتظار يُسجَّل «queue» منفصلًا عن العمل، وزمن الانشغال يُجمع لنسبة
 * «المعالج مشغول» في التقرير.
 */
class PriorityGate {
    companion object {
        /** الكشف وحده (جزء من الثانية): صفحة بلا نص تنتهي ولا تنتظر الثقيل. */
        const val DETECT = 0
        /** إكمال صفحة بدأت (Luna ردّت): أقرب شيء لظهور العربي. */
        const val RENDER_READER = 1
        const val ANALYZE_READER = 2
        const val RENDER_JOB = 3
        const val ANALYZE_JOB = 4
        const val BACKGROUND = 5
    }

    /** صفحة في فصل: موضعها من موضع القارئ يحدد دورها. */
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

    /** موضع القارئ الآن (الفصل والصفحة). */
    fun focus(page: Page?) { focus = page }

    /** بُعد الصفحة عن موضع القارئ: أمامه بالترتيب، ثم خلفه، ثم فصول أخرى. */
    private fun distance(p: Page?): Int {
        val f = focus ?: return 0
        if (p == null) return 0
        if (p.chapter != f.chapter) return 100_000 + p.index
        val d = p.index - f.index
        return if (d >= 0) d else 10_000 - d
    }

    /**
     * صفحة القارئ التي انتهى تحليلها ووصل رد Luna لا نترك رسمها عالقًا فقط لأن
     * المستخدم مرّ للصفحة التالية. قبل هذا كان الانتقال صفحة واحدة يجعل الصفحة
     * السابقة «خلفك» بمسافة 10000، فتبدأ الصفحة الجديدة تحليل CTD/Bubble (عشرات
     * الثواني) قبل أن تُكمل السابقة؛ وهذا ظهر فعليًا كـ render.queue ≈ 31.5ث.
     *
     * نمنح Render للصفحة السابقة مباشرة مسافة الصفر: الكشف الخفيف للحالية يبقى
     * قبله بالرتبة، ثم نكمل الصفحة السابقة، ثم ندخل التحليل الثقيل للحالية.
     */
    private fun readerDistance(w: Waiter): Int {
        val f = focus
        val p = w.page
        if (w.rank == RENDER_READER && f != null && p != null && p.chapter == f.chapter && f.index - p.index == 1) return 0
        return distance(p)
    }

    private fun better(a: Waiter, b: Waiter): Boolean {
        val ga = if (a.rank <= ANALYZE_READER) 0 else 1
        val gb = if (b.rank <= ANALYZE_READER) 0 else 1
        if (ga != gb) return ga < gb
        if (ga == 0) {
            val da = readerDistance(a); val db = readerDistance(b)
            if (da != db) return da < db
        }
        if (a.rank != b.rank) return a.rank < b.rank
        return a.seq < b.seq
    }

    suspend fun <T> run(rank: Int, perf: Perf, page: Page? = null, block: () -> T): T {
        val started = System.nanoTime()
        val waiter = synchronized(this) {
            if (firstUse == 0L) firstUse = started
            if (!busy) { busy = true; null } else Waiter(rank, seq++, page).also { queue.add(it) }
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

    private fun release() {
        val next = synchronized(this) {
            var best: Waiter? = null
            for (w in queue) if (best == null || better(w, best)) best = w
            if (best == null) busy = false else queue.remove(best)
            best
        }
        next?.go?.complete(Unit)
    }

    /** نسبة الوقت الذي كان فيه المعالج يعمل منذ أول صفحة (0–100). */
    fun busyPercent(): Int = synchronized(this) {
        val wall = System.nanoTime() - firstUse
        if (firstUse == 0L || wall <= 0) 0 else (100 * busyNanos / wall).toInt()
    }
}
