package com.vantara.plugins.translation

/**
 * قياس صفحة واحدة على الجوال: زمن كل مرحلة وعدّاداتها (المربعات، الأسطر،
 * النماذج المحمّلة). يعود مع نتيجة `analyzePage`/`renderPage` إلى JavaScript،
 * فيُسجَّل مع زمن الشبكة وLuna والانتظار في سجل «أداء الترجمة».
 */
class Perf {
    /** بالنانوثانية، بترتيب أول ظهور. */
    val nanos = LinkedHashMap<String, Long>()
    val counts = LinkedHashMap<String, Int>()

    inline fun <T> time(stage: String, block: () -> T): T {
        val t = System.nanoTime()
        try {
            return block()
        } finally {
            add(stage, System.nanoTime() - t)
        }
    }

    fun add(stage: String, ns: Long) {
        nanos[stage] = (nanos[stage] ?: 0L) + ns
    }

    fun count(name: String, n: Int = 1) {
        counts[name] = (counts[name] ?: 0) + n
    }

    /** المراحل بالمللي ثانية (منزلة عشرية واحدة). */
    fun millis(): Map<String, Double> = nanos.mapValues { Math.round(it.value / 100_000.0) / 10.0 }
}
