package com.vantara.plugins.translation

import kotlinx.coroutines.delay

/**
 * صفحة واحدة على المعالج في كل مرة (النماذج تستعمل كل الأنوية)، والصفحة التي أمامك
 * قبل صفحات الترجمة المقدّمة: طلب عالٍ ينتظر ينال الدور التالي دائمًا. زمن الانتظار
 * يُسجَّل «queue» منفصلًا عن العمل، فالتقرير لا يخلط الانتظار بالمعالجة.
 */
class PriorityGate {
    private var busy = false
    private var highWaiting = 0

    suspend fun <T> run(high: Boolean, perf: Perf, block: () -> T): T {
        val started = System.nanoTime()
        var waiting = false
        try {
            while (true) {
                val got = synchronized(this) {
                    if (!busy && (high || highWaiting == 0)) {
                        busy = true
                        if (waiting) { highWaiting--; waiting = false }
                        true
                    } else {
                        if (high && !waiting) { highWaiting++; waiting = true }
                        false
                    }
                }
                if (got) break
                delay(25)
            }
        } finally {
            if (waiting) synchronized(this) { highWaiting-- }
        }
        perf.add("queue", System.nanoTime() - started)
        try {
            return block()
        } finally {
            synchronized(this) { busy = false }
        }
    }
}
