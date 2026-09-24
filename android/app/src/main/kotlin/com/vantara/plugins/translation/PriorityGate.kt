package com.vantara.plugins.translation

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import java.util.PriorityQueue

/**
 * صفحة واحدة على المعالج في كل مرة (النماذج تستعمل كل الأنوية)، بترتيب ثابت لا
 * بسباق: الرتبة الأصغر أولًا ثم الأسبق وصولًا، والدور يُسلَّم مباشرة لمن بعده.
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

    private class Waiter(val rank: Int, val seq: Long) {
        val go = CompletableDeferred<Unit>()
    }

    private val queue = PriorityQueue<Waiter>(compareBy<Waiter>({ it.rank }, { it.seq }))
    private var busy = false
    private var seq = 0L
    private var busyNanos = 0L
    private var firstUse = 0L

    suspend fun <T> run(rank: Int, perf: Perf, block: () -> T): T {
        val started = System.nanoTime()
        val waiter = synchronized(this) {
            if (firstUse == 0L) firstUse = started
            if (!busy) { busy = true; null } else Waiter(rank, seq++).also { queue.add(it) }
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
            queue.poll().also { if (it == null) busy = false }
        }
        next?.go?.complete(Unit)
    }

    /** نسبة الوقت الذي كان فيه المعالج يعمل منذ أول صفحة (0–100). */
    fun busyPercent(): Int = synchronized(this) {
        val wall = System.nanoTime() - firstUse
        if (firstUse == 0L || wall <= 0) 0 else (100 * busyNanos / wall).toInt()
    }
}
